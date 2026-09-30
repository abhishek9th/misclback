/**
 * Compares the zero-token rule extractor (services/eligibilityRules.js) with the
 * LLM-extracted values already stored for ~526 schemes, field by field. The LLM
 * output is a reference, not ground truth — this tells us where the rules agree,
 * miss, or over-claim.   node backend/scripts/benchmarkEligibilityRules.mjs
 */
import path from 'path';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { getSupabaseAdmin } from '../services/supabaseAdmin.js';
import { extractEligibility } from '../services/eligibilityRules.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const supabase = getSupabaseAdmin();
let rows = [];
for (let from = 0; ; from += 1000) {
  const { data, error } = await supabase.from('myscheme_catalogue')
    .select('slug,name,short_description,eligibility_text,benefits_text,income_limit,eligible_categories,eligible_genders,education_levels,min_age,max_age,benefit_types,audiences,eligibility_extracted')
    .eq('eligibility_extracted', true).range(from, from + 999);
  if (error) throw error;
  rows = rows.concat(data);
  if (data.length < 1000) break;
}

const setEq = (a, b) => a.length === b.length && a.every((x) => b.includes(x));
const inter = (a, b) => a.filter((x) => b.includes(x)).length;
const stat = () => ({ n: 0, agree: 0, ruleMiss: 0, ruleExtra: 0, conflict: 0 });
const S = { income: stat(), age_min: stat(), age_max: stat(), categories: stat(), genders: stat() };
let audRef = 0, audHit = 0, audRule = 0, benRef = 0, benHit = 0, benRule = 0;
const examples = { income: [], categories: [], genders: [] };

for (const r of rows) {
  const x = extractEligibility(r);
  const cmpNum = (key, ref, val) => {
    const s = S[key]; s.n++;
    if (ref == null && val == null) s.agree++;
    else if (ref != null && val == null) s.ruleMiss++;
    else if (ref == null && val != null) s.ruleExtra++;
    else if (Number(ref) === Number(val)) s.agree++;
    else { s.conflict++; if (examples.income.length < 6 && key === 'income') examples.income.push([r.name.slice(0, 50), ref, val]); }
  };
  cmpNum('income', r.income_limit, x.income_limit);
  cmpNum('age_min', r.min_age, x.min_age);
  cmpNum('age_max', r.max_age, x.max_age);
  const cmpSet = (key, ref, val) => {
    const s = S[key]; s.n++;
    if (setEq(ref, val)) s.agree++;
    else if (ref.length && !val.length) s.ruleMiss++;
    else if (!ref.length && val.length) { s.ruleExtra++; if (examples[key].length < 5) examples[key].push([r.name.slice(0, 50), ref, val]); }
    else { s.conflict++; if (examples[key].length < 5) examples[key].push([r.name.slice(0, 50), ref, val]); }
  };
  cmpSet('categories', r.eligible_categories || [], x.eligible_categories);
  cmpSet('genders', r.eligible_genders || [], x.eligible_genders);
  audRef += (r.audiences || []).length; audHit += inter(r.audiences || [], x.audiences); audRule += x.audiences.length;
  benRef += (r.benefit_types || []).length; benHit += inter(r.benefit_types || [], x.benefit_types); benRule += x.benefit_types.length;
}

console.log(`Benchmarked on ${rows.length} LLM-extracted schemes\n`);
for (const [k, s] of Object.entries(S)) {
  console.log(k.padEnd(11), `agree ${(100 * s.agree / s.n).toFixed(0)}%`, `| rules missed a value ${s.ruleMiss}`, `| rules added one the LLM did not ${s.ruleExtra}`, `| conflicting ${s.conflict}`);
}
console.log(`audiences   recall ${(100 * audHit / audRef).toFixed(0)}% (of LLM's ${audRef}) | precision ${(100 * audHit / audRule).toFixed(0)}% (of rules' ${audRule})`);
console.log(`benefits    recall ${(100 * benHit / benRef).toFixed(0)}% | precision ${(100 * benHit / benRule).toFixed(0)}%`);
console.log('\nExamples:', JSON.stringify(examples));
