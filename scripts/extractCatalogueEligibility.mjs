/**
 * Catalogue-wide ELIGIBILITY extraction.
 *
 * Turns each scheme's free-form official `eligibility` prose (scraped into
 * scheme_details.json) into machine-readable columns on public.myscheme_catalogue
 * so the eligibility MATCHER can run over every catalogue scheme, not just the
 * ~20 hand-curated ones. Complements decomposeScrapedRequirements.mjs (which
 * only handles the DOCUMENTS list).
 *
 * HONESTY (§5/§36): extraction is constrained to ONLY what the official text
 * states. Anything not stated is left null / empty (= no restriction), never a
 * fabricated one. Rows are marked eligibility_extracted=true and surfaced in the
 * UI as "AI-assisted — confirm on the official portal", never as verified.
 *
 * Resumable (extract.progress.json) + concurrent. Reuses the same Groq model as
 * the rest of the backend. Only UPDATEs existing catalogue rows (never inserts),
 * and only ever writes the eligibility_* columns.
 *
 *   node backend/scripts/extractCatalogueEligibility.mjs [dataDir] [--limit N] [--concurrency N]
 */
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import Groq from 'groq-sdk';
import { getSupabaseAdmin } from '../services/supabaseAdmin.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const DATA_DIR = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : './backend/data/myscheme-scrape';
const arg = (name, def) => (process.argv.includes(name) ? Number(process.argv[process.argv.indexOf(name) + 1]) : def);
const LIMIT = arg('--limit', Infinity);
const CONCURRENCY = arg('--concurrency', 6);
const MODEL = 'openai/gpt-oss-120b';

// Controlled vocabularies — the extractor is told to use ONLY these, and we
// defensively filter to them so a stray value never poisons the matcher.
const CATEGORIES = ['general', 'obc', 'sc', 'st', 'ews', 'minorities'];
const GENDERS = ['male', 'female', 'other'];
const EDUCATION = ['school', '10th', '12th', 'diploma', 'undergraduate', 'postgraduate', 'phd', 'vocational'];
const BENEFITS = ['scholarship', 'loan', 'subsidy', 'grant', 'training', 'pension', 'insurance', 'housing', 'equipment', 'stipend', 'fellowship', 'other'];
const AUDIENCES = ['student', 'farmer', 'woman', 'entrepreneur', 'worker', 'senior_citizen', 'disabled', 'minority', 'artisan', 'child', 'unemployed', 'sportsperson', 'researcher', 'msme', 'startup'];

const onlyKnown = (arr, vocab) => (Array.isArray(arr) ? [...new Set(arr.map((x) => String(x).toLowerCase().trim()).filter((x) => vocab.includes(x)))] : []);
const intOrNull = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Math.round(Number(v)) : null);

const SYSTEM = `You extract STRUCTURED ELIGIBILITY from the official text of an Indian government scheme.
Rules:
- Use ONLY facts explicitly present in the text. Never guess or infer. If something is not stated, leave it null or an empty array — an empty value means "no restriction".
- Output STRICT JSON only, with exactly these keys:
  {
    "income_limit": number|null,          // max annual FAMILY income in rupees the applicant may have; null if not stated
    "eligible_categories": string[],       // subset of ["general","obc","sc","st","ews","minorities"]; [] if open to all
    "eligible_genders": string[],          // subset of ["male","female","other"] ("other" also covers transgender); [] if all
    "education_levels": string[],          // subset of ["school","10th","12th","diploma","undergraduate","postgraduate","phd","vocational"]; [] if not education-gated
    "min_age": number|null,
    "max_age": number|null,
    "benefit_types": string[],             // subset of ["scholarship","loan","subsidy","grant","training","pension","insurance","housing","equipment","stipend","fellowship","other"]; what the scheme GIVES
    "audiences": string[]                  // subset of ["student","farmer","woman","entrepreneur","worker","senior_citizen","disabled","minority","artisan","child","unemployed","sportsperson","researcher","msme","startup"]
  }
- "women only" => eligible_genders ["female"]. "SC/ST only" => eligible_categories ["sc","st"]. Convert income like "2.5 lakh" to 250000.
- Do not add commentary. JSON object only.`;

function buildUserPrompt(name, elig, benefits, details) {
  const clip = (s, n) => (s ? String(s).slice(0, n) : '');
  return `SCHEME: ${name}

ELIGIBILITY (official):
${clip(elig, 2600) || '(none provided)'}

BENEFITS (official):
${clip(benefits, 1200)}

ABOUT (official):
${clip(details, 800)}

Return the JSON object.`;
}

async function extractOne(groq, d) {
  const dt = d.detail_text || {};
  const prompt = buildUserPrompt(d.name || d.slug, dt.eligibility, dt.benefits, dt.details);
  const res = await groq.chat.completions.create({
    model: MODEL,
    temperature: 0,
    response_format: { type: 'json_object' },
    messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: prompt }],
  });
  const raw = res.choices?.[0]?.message?.content || '{}';
  const j = JSON.parse(raw);
  return {
    income_limit: intOrNull(j.income_limit),
    eligible_categories: onlyKnown(j.eligible_categories, CATEGORIES),
    eligible_genders: onlyKnown(j.eligible_genders, GENDERS),
    education_levels: onlyKnown(j.education_levels, EDUCATION),
    min_age: intOrNull(j.min_age),
    max_age: intOrNull(j.max_age),
    benefit_types: onlyKnown(j.benefit_types, BENEFITS),
    audiences: onlyKnown(j.audiences, AUDIENCES),
    eligibility_extracted: true,
    eligibility_extracted_at: new Date().toISOString(),
  };
}

async function run() {
  const supabase = getSupabaseAdmin();
  const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

  const details = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'scheme_details.json'), 'utf8'))
    .filter((d) => d.slug && d.detail_text && (d.detail_text.eligibility || '').length > 10);
  console.log(`Schemes with eligibility text: ${details.length}`);

  const PROGRESS = path.join(DATA_DIR, 'extract.progress.json');
  let done = new Set();
  try { done = new Set(JSON.parse(fs.readFileSync(PROGRESS, 'utf8'))); } catch { /* fresh */ }

  const todo = details.filter((d) => !done.has(d.slug)).slice(0, LIMIT === Infinity ? undefined : LIMIT);
  console.log(`Remaining to extract: ${todo.length} (concurrency ${CONCURRENCY})`);

  let ok = 0; let fail = 0; let i = 0;
  const saveProgress = () => fs.writeFileSync(PROGRESS, JSON.stringify([...done]));

  async function worker() {
    while (i < todo.length) {
      const d = todo[i++];
      try {
        const fields = await extractOne(groq, d);
        const { error } = await supabase.from('myscheme_catalogue').update(fields).eq('slug', d.slug);
        if (error) throw new Error(error.message);
        done.add(d.slug); ok++;
      } catch (e) {
        fail++;
        if (fail <= 20) console.warn(`  ! ${d.slug}: ${e.message}`);
      }
      const n = ok + fail;
      if (n % 50 === 0) { saveProgress(); console.log(`  ${n}/${todo.length} processed (${ok} ok, ${fail} failed)`); }
    }
  }

  await Promise.all(Array.from({ length: Math.max(1, CONCURRENCY) }, worker));
  saveProgress();
  console.log(`\nDONE. Extracted ${ok} schemes, ${fail} failed. Total done: ${done.size}.`);
}

run().catch((e) => { console.error('FATAL', e); process.exit(1); });
