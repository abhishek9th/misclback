/**
 * Catalogue-wide ELIGIBILITY extraction.
 *
 * Turns each scheme's free-form official `eligibility` prose (scraped into
 * scheme_details.json) into machine-readable columns on public.myscheme_catalogue
 * so the eligibility MATCHER can run over every catalogue scheme, not just the
 * ~20 hand-curated ones. Complements decomposeScrapedRequirements.mjs (docs).
 *
 * HONESTY (§5/§36): extraction is constrained to ONLY what the official text
 * states. Anything not stated is left null / empty (= no restriction), never a
 * fabricated one. Rows are marked eligibility_extracted=true and surfaced in the
 * UI as "AI-assisted — confirm on the official portal", never as verified.
 *
 * Built for the Groq FREE tier (~8k tokens/min): schemes are BATCHED per request
 * to amortise the fixed prompt cost, and 429s are respected with backoff (using
 * the "try again in Xs" hint) so nothing is dropped — it just paces itself.
 * Resumable via extract.progress.json.
 *
 *   node backend/scripts/extractCatalogueEligibility.mjs [dataDir] \
 *        [--limit N] [--batch N] [--concurrency N] [--model NAME]
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
const numArg = (name, def) => (process.argv.includes(name) ? Number(process.argv[process.argv.indexOf(name) + 1]) : def);
const strArg = (name, def) => (process.argv.includes(name) ? String(process.argv[process.argv.indexOf(name) + 1]) : def);
const LIMIT = numArg('--limit', Infinity);
const BATCH = Math.max(1, numArg('--batch', 10));
const CONCURRENCY = Math.max(1, numArg('--concurrency', 2));
const MODEL = strArg('--model', 'openai/gpt-oss-20b'); // small + higher free throughput

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Controlled vocabularies — the extractor is told to use ONLY these, and we
// defensively filter to them so a stray value never poisons the matcher.
const CATEGORIES = ['general', 'obc', 'sc', 'st', 'ews', 'minorities'];
const GENDERS = ['male', 'female', 'other'];
const EDUCATION = ['school', '10th', '12th', 'diploma', 'undergraduate', 'postgraduate', 'phd', 'vocational'];
const BENEFITS = ['scholarship', 'loan', 'subsidy', 'grant', 'training', 'pension', 'insurance', 'housing', 'equipment', 'stipend', 'fellowship', 'other'];
const AUDIENCES = ['student', 'farmer', 'woman', 'entrepreneur', 'worker', 'senior_citizen', 'disabled', 'minority', 'artisan', 'child', 'unemployed', 'sportsperson', 'researcher', 'msme', 'startup'];

const onlyKnown = (arr, vocab) => (Array.isArray(arr) ? [...new Set(arr.map((x) => String(x).toLowerCase().trim()).filter((x) => vocab.includes(x)))] : []);
const intOrNull = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Math.round(Number(v)) : null);
const clip = (s, n) => (s ? String(s).replace(/\s+/g, ' ').trim().slice(0, n) : '');

const SYSTEM = `You extract STRUCTURED ELIGIBILITY for Indian government schemes.
You receive a JSON array of schemes. For EACH, use ONLY facts explicitly present in its text — never guess. If something is not stated, use null or an empty array (meaning "no restriction").
Return STRICT JSON: {"results":[{...},...]} with one object per input scheme IN THE SAME ORDER, each shaped:
{
 "slug": string,                        // echo the input slug
 "income_limit": number|null,           // max annual FAMILY income (rupees); "2.5 lakh" => 250000
 "eligible_categories": string[],       // from ["general","obc","sc","st","ews","minorities"]; [] = all
 "eligible_genders": string[],          // from ["male","female","other"] ("other"=transgender); [] = all
 "education_levels": string[],          // from ["school","10th","12th","diploma","undergraduate","postgraduate","phd","vocational"]; [] = not gated
 "min_age": number|null,
 "max_age": number|null,
 "benefit_types": string[],             // from ["scholarship","loan","subsidy","grant","training","pension","insurance","housing","equipment","stipend","fellowship","other"] (what it GIVES)
 "audiences": string[]                  // from ["student","farmer","woman","entrepreneur","worker","senior_citizen","disabled","minority","artisan","child","unemployed","sportsperson","researcher","msme","startup"]
}
"women only" => eligible_genders ["female"]. "SC/ST only" => eligible_categories ["sc","st"]. JSON only, no prose.`;

function normalize(slug, j) {
  return {
    slug,
    income_limit: intOrNull(j?.income_limit),
    eligible_categories: onlyKnown(j?.eligible_categories, CATEGORIES),
    eligible_genders: onlyKnown(j?.eligible_genders, GENDERS),
    education_levels: onlyKnown(j?.education_levels, EDUCATION),
    min_age: intOrNull(j?.min_age),
    max_age: intOrNull(j?.max_age),
    benefit_types: onlyKnown(j?.benefit_types, BENEFITS),
    audiences: onlyKnown(j?.audiences, AUDIENCES),
    eligibility_extracted: true,
    eligibility_extracted_at: new Date().toISOString(),
  };
}

async function callWithRetry(fn, tries = 8) {
  let lastErr;
  for (let a = 0; a < tries; a++) {
    try { return await fn(); }
    catch (e) {
      lastErr = e;
      const msg = String(e?.message || e);
      const is429 = e?.status === 429 || /rate_limit|429/i.test(msg);
      if (is429) {
        const m = msg.match(/try again in ([\d.]+)s/i);
        await sleep((m ? parseFloat(m[1]) : Math.min(30, 2 ** a)) * 1000 + 600);
        continue;
      }
      if (a < 2) { await sleep(1000 * (a + 1)); continue; } // transient 5xx/network
      throw e;
    }
  }
  throw lastErr;
}

async function extractBatch(groq, items) {
  const payload = items.map((d) => ({
    slug: d.slug,
    name: d.name || d.slug,
    eligibility: clip(d.detail_text?.eligibility, 900),
    benefits: clip(d.detail_text?.benefits, 300),
  }));
  const res = await callWithRetry(() => groq.chat.completions.create({
    model: MODEL,
    temperature: 0,
    // gpt-oss models burn large hidden "reasoning" token budgets by default,
    // which blows past the 8k tokens/min free cap. This is a mechanical
    // extraction, so minimise reasoning and cap output to keep each call small.
    reasoning_effort: 'low',
    max_tokens: 1200,
    response_format: { type: 'json_object' },
    messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: JSON.stringify(payload) }],
  }));
  const parsed = JSON.parse(res.choices?.[0]?.message?.content || '{}');
  const results = Array.isArray(parsed.results) ? parsed.results : [];
  const bySlug = new Map(results.filter((r) => r && r.slug).map((r) => [r.slug, r]));
  // Match by slug; fall back to positional if the model dropped/renamed slugs.
  return items.map((d, i) => normalize(d.slug, bySlug.get(d.slug) || results[i] || {}));
}

async function run() {
  const supabase = getSupabaseAdmin();
  const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

  const details = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'scheme_details.json'), 'utf8'))
    .filter((d) => d.slug && d.detail_text && (d.detail_text.eligibility || '').length > 10);
  console.log(`Schemes with eligibility text: ${details.length} | model=${MODEL} batch=${BATCH} conc=${CONCURRENCY}`);

  const PROGRESS = path.join(DATA_DIR, 'extract.progress.json');
  let done = new Set();
  try { done = new Set(JSON.parse(fs.readFileSync(PROGRESS, 'utf8'))); } catch { /* fresh */ }

  // Optional allow-list (--slugs file.json): only extract these slugs, so we can
  // run a small category-BALANCED subset instead of the whole catalogue.
  let allow = null;
  const slugsFile = strArg('--slugs', null);
  if (slugsFile) {
    try { allow = new Set(JSON.parse(fs.readFileSync(slugsFile, 'utf8'))); console.log(`Allow-list: ${allow.size} slugs`); }
    catch (e) { console.error(`Could not read --slugs ${slugsFile}: ${e.message}`); process.exit(1); }
  }

  const todo = details
    .filter((d) => !done.has(d.slug) && (!allow || allow.has(d.slug)))
    .slice(0, LIMIT === Infinity ? undefined : LIMIT);
  const batches = [];
  for (let i = 0; i < todo.length; i += BATCH) batches.push(todo.slice(i, i + BATCH));
  console.log(`Remaining: ${todo.length} in ${batches.length} batches`);

  let ok = 0; let fail = 0; let bi = 0;
  const saveProgress = () => fs.writeFileSync(PROGRESS, JSON.stringify([...done]));

  async function worker() {
    while (bi < batches.length) {
      const batch = batches[bi++];
      try {
        const rows = await extractBatch(groq, batch);
        for (const row of rows) {
          const { error } = await supabase.from('myscheme_catalogue').update(row).eq('slug', row.slug);
          if (error) { fail++; continue; }
          done.add(row.slug); ok++;
        }
      } catch (e) {
        fail += batch.length;
        if (fail <= 40) console.warn(`  ! batch @${bi}: ${String(e.message).slice(0, 140)}`);
      }
      saveProgress();
      if (bi % 5 === 0) console.log(`  batch ${bi}/${batches.length} — ${ok} ok, ${fail} failed`);
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  saveProgress();
  console.log(`\nDONE. Extracted ${ok}, failed ${fail}. Total done: ${done.size}/${details.length}.`);
}

run().catch((e) => { console.error('FATAL', e); process.exit(1); });
