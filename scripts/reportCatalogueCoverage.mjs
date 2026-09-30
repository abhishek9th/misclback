/** Coverage report for the structured (eligibility-extracted) catalogue.  node backend/scripts/reportCatalogueCoverage.mjs */
import dotenv from 'dotenv'; import path from 'path'; import { fileURLToPath } from 'url';
dotenv.config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../.env') });
const { getSupabaseAdmin } = await import('../services/supabaseAdmin.js');
const sb = getSupabaseAdmin();
let rows = [];
for (let f = 0; ; f += 1000) {
  const { data, error } = await sb.from('myscheme_catalogue').select('slug,name,level,states,eligibility_extracted,eligible_categories,eligible_genders,audiences,benefit_types,income_limit,min_age,max_age,education_levels,eligibility_text,benefits_text,documents_required,application_process,source_url').range(f, f + 999);
  if (error) throw error; rows = rows.concat(data); if (data.length < 1000) break;
}
const ext = rows.filter((r) => r.eligibility_extracted);
const has = (a, list) => (a || []).some((x) => list.includes(x));
const ENT = (r) => has(r.audiences, ['entrepreneur', 'msme', 'startup', 'artisan']);
const MAR = (r) => has(r.eligible_categories, ['sc', 'st', 'obc', 'ews', 'minorities']) || has(r.audiences, ['minority', 'disabled']);
const ent = ext.filter(ENT), mar = ext.filter(MAR), target = ext.filter((r) => ENT(r) || MAR(r));
const complete = (r) => [r.eligibility_text, r.benefits_text, r.documents_required, r.application_process].every((t) => (t || '').trim().length > 15) && r.source_url;
console.log('Catalogue total:', rows.length);
console.log('Structured (eligibility extracted):', ext.length);
console.log('  entrepreneur / MSME / startup / artisan:', ent.length);
console.log('  marginalised (SC/ST/OBC/EWS/minority/PwD):', mar.length);
console.log('  TARGET (either segment):', target.length, `(${(100 * target.length / ext.length).toFixed(0)}% of structured)`);
console.log('  with complete official details (eligibility+benefits+documents+application+source URL):', ext.filter(complete).length, '| target & complete:', target.filter(complete).length);
const crit = (r) => [r.income_limit != null, (r.eligible_categories || []).length > 0, (r.eligible_genders || []).length > 0, (r.education_levels || []).length > 0, r.min_age != null || r.max_age != null].filter(Boolean).length;
console.log('  target schemes with ≥1 hard criterion (income/category/gender/education/age):', target.filter((r) => crit(r) >= 1).length);
const lvl = {}; target.forEach((r) => { const k = /central/i.test(r.level || '') ? 'central' : 'state'; lvl[k] = (lvl[k] || 0) + 1; }); console.log('  target by level:', JSON.stringify(lvl));
const st = new Set(); target.forEach((r) => (r.states || []).forEach((s) => st.add(s))); console.log('  states/UTs covered by target schemes:', st.size);
