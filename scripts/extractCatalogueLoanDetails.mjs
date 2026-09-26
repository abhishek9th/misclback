/**
 * Catalogue-wide LOAN/EMI detail extraction.
 *
 * Turns each loan-flavoured scheme's free-form official `benefits`/`eligibility`
 * prose into machine-readable loan_* columns on public.myscheme_catalogue (see
 * supabase/migrations/20260926_catalogue_loan_details.sql) so the EMI calculator
 * on the scheme detail page can compute a real number instead of guessing.
 * Sibling to extractCatalogueEligibility.mjs — same Groq/batch/progress pattern.
 *
 * HONESTY (§5/§36): a numeric interest rate/amount/tenure is stored ONLY when the
 * official text explicitly states it. Never invent or default a rate. rate_type
 * records WHICH of the documented cases applies (fixed / range / lender-specific
 * / benchmark-linked / subsidy / not specified) so the UI never presents an
 * estimate as an official guarantee.
 *
 * Candidate schemes: rows already flagged benefit_types @> {loan} by
 * extractCatalogueEligibility.mjs, OR whose name/benefits text mentions
 * loan/credit/interest — a cheap prefilter so we don't burn Groq calls on the
 * ~4,500 non-loan schemes.
 *
 *   node backend/scripts/extractCatalogueLoanDetails.mjs [dataDir] \
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
const BATCH = Math.max(1, numArg('--batch', 8));
const CONCURRENCY = Math.max(1, numArg('--concurrency', 2));
const MODEL = strArg('--model', 'openai/gpt-oss-20b');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const RATE_TYPES = ['official_fixed', 'official_range', 'lender_specific', 'benchmark_linked', 'subsidy', 'not_specified'];
const CONFIDENCE = ['high', 'medium', 'low'];

const numOrNull = (v) => (Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : null);
const intOrNull = (v) => (Number.isFinite(Number(v)) && Number(v) >= 0 ? Math.round(Number(v)) : null);
const clip = (s, n) => (s ? String(s).replace(/\s+/g, ' ').trim().slice(0, n) : '');
const onlyKnown1 = (v, vocab, fallback) => (typeof v === 'string' && vocab.includes(v.toLowerCase()) ? v.toLowerCase() : fallback);

// Cheap prefilter so we only spend Groq calls on schemes that plausibly extend
// a loan/credit facility.
const LOAN_HINT_RE = /\b(loan|credit|emi|interest\s+rate|interest\s+subvention|interest\s+subsidy|margin\s+money|collateral|repayment)\b/i;

const SYSTEM = `You extract STRUCTURED LOAN/EMI DETAILS for Indian government schemes, from their OFFICIAL text only.
You receive a JSON array of schemes (name, benefits, eligibility). For EACH, decide if it is a LOAN/CREDIT scheme (it lends money, gives a credit facility, or subsidizes loan interest). If it is NOT a loan scheme, return is_loan_scheme:false and null/empty for the rest.

Use ONLY facts explicitly stated in the text. NEVER guess, invent, or default a number. If a value is not stated, use null (or [] for arrays). Do not assume a "typical" rate unless the text itself gives multiple lender rates.

Return STRICT JSON: {"results":[{...},...]}, one object per input scheme IN THE SAME ORDER, shaped exactly:
{
  "slug": string,
  "is_loan_scheme": boolean,
  "loan_amount_min": number|null,      // rupees; "50,000" => 50000
  "loan_amount_max": number|null,      // rupees; "up to Rs 5 lakh" => 500000
  "tenure_min_months": number|null,    // convert years to months (1 year = 12)
  "tenure_max_months": number|null,
  "rate_type": one of ["official_fixed","official_range","lender_specific","benchmark_linked","subsidy","not_specified"],
  "interest_rate": number|null,        // ONLY when rate_type="official_fixed" — the single stated annual % rate
  "interest_rate_min": number|null,    // ONLY when rate_type="official_range" or "lender_specific" (lowest observed) — lower bound %
  "interest_rate_max": number|null,    // ONLY when rate_type="official_range" or "lender_specific" (highest observed) — upper bound %
  "interest_subsidy_pct": number|null, // percentage-point subsidy/subvention, ONLY when rate_type="subsidy"
  "interest_subsidy_note": string|null,// short factual note on how the subsidy applies, e.g. cap amount / duration, ONLY when rate_type="subsidy"
  "lender_specific_rates": [{"lender": string, "rate": number}], // ONLY when rate_type="lender_specific" and the text names specific banks/lenders with specific rates
  "rate_source": string|null,          // short label, e.g. "Official Scheme Guidelines", "RBI circular", "NABARD notification" — only if the text names a source
  "rate_confidence": one of ["high","medium","low"]|null // high = explicit official number in the text; medium = derivable but not a single explicit figure; low = vague/benchmark-linked
}
Rules:
- rate_type="benchmark_linked" when the text says the rate is linked to MCLR/repo rate/base rate or is "as per bank norms"/"lender discretion" with no fixed figure.
- rate_type="not_specified" when no interest rate information exists at all — this is common and correct; do not force a case that isn't supported by the text.
- If BOTH a subsidy AND a lender-set base rate are mentioned, use rate_type="subsidy" and put the base rate (or its range) as interest_rate or interest_rate_min/max, plus the subsidy separately.
- Months: "up to 3 years" => tenure_min_months:null, tenure_max_months:36. "6 months to 5 years" => tenure_min_months:6, tenure_max_months:60.
JSON only, no prose.`;

function normalize(slug, j) {
  const isLoan = !!j?.is_loan_scheme;
  if (!isLoan) {
    return {
      slug, is_loan_scheme: false,
      loan_amount_min: null, loan_amount_max: null,
      tenure_min_months: null, tenure_max_months: null,
      interest_rate: null, interest_rate_min: null, interest_rate_max: null,
      rate_type: null, interest_subsidy_pct: null, interest_subsidy_note: null,
      lender_specific_rates: [], rate_source: null, rate_source_url: null, rate_confidence: null,
      loan_extracted: true, loan_extracted_at: new Date().toISOString(),
    };
  }
  const rateType = onlyKnown1(j?.rate_type, RATE_TYPES, 'not_specified');
  const lenderRates = Array.isArray(j?.lender_specific_rates)
    ? j.lender_specific_rates
        .filter((r) => r && r.lender && Number.isFinite(Number(r.rate)))
        .map((r) => ({ lender: clip(r.lender, 60), rate: Number(r.rate) }))
        .slice(0, 20)
    : [];
  return {
    slug,
    is_loan_scheme: true,
    loan_amount_min: numOrNull(j?.loan_amount_min),
    loan_amount_max: numOrNull(j?.loan_amount_max),
    tenure_min_months: intOrNull(j?.tenure_min_months),
    tenure_max_months: intOrNull(j?.tenure_max_months),
    rate_type: rateType,
    interest_rate: rateType === 'official_fixed' ? numOrNull(j?.interest_rate) : null,
    interest_rate_min: (rateType === 'official_range' || rateType === 'lender_specific') ? numOrNull(j?.interest_rate_min) : null,
    interest_rate_max: (rateType === 'official_range' || rateType === 'lender_specific') ? numOrNull(j?.interest_rate_max) : null,
    interest_subsidy_pct: rateType === 'subsidy' ? numOrNull(j?.interest_subsidy_pct) : null,
    interest_subsidy_note: rateType === 'subsidy' ? (clip(j?.interest_subsidy_note, 300) || null) : null,
    lender_specific_rates: rateType === 'lender_specific' ? lenderRates : [],
    rate_source: clip(j?.rate_source, 120) || null,
    rate_source_url: null, // not reliably extractable from prose; left for manual curation
    rate_confidence: onlyKnown1(j?.rate_confidence, CONFIDENCE, null),
    loan_extracted: true,
    loan_extracted_at: new Date().toISOString(),
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
      if (a < 2) { await sleep(1000 * (a + 1)); continue; }
      throw e;
    }
  }
  throw lastErr;
}

async function extractBatch(groq, items) {
  const payload = items.map((d) => ({
    slug: d.slug,
    name: d.name || d.slug,
    benefits: clip(d.detail_text?.benefits, 900),
    eligibility: clip(d.detail_text?.eligibility, 600),
  }));
  const res = await callWithRetry(() => groq.chat.completions.create({
    model: MODEL,
    temperature: 0,
    reasoning_effort: 'low',
    max_tokens: 1800,
    response_format: { type: 'json_object' },
    messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: JSON.stringify(payload) }],
  }));
  const parsed = JSON.parse(res.choices?.[0]?.message?.content || '{}');
  const results = Array.isArray(parsed.results) ? parsed.results : [];
  const bySlug = new Map(results.filter((r) => r && r.slug).map((r) => [r.slug, r]));
  return items.map((d, i) => normalize(d.slug, bySlug.get(d.slug) || results[i] || {}));
}

async function run() {
  const supabase = getSupabaseAdmin();
  const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

  const all = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'scheme_details.json'), 'utf8'));
  const details = all.filter((d) => {
    if (!d.slug || !d.detail_text) return false;
    const hay = `${d.name || ''} ${d.detail_text.benefits || ''} ${d.detail_text.eligibility || ''}`;
    return LOAN_HINT_RE.test(hay);
  });
  console.log(`Loan-flavoured candidates: ${details.length}/${all.length} | model=${MODEL} batch=${BATCH} conc=${CONCURRENCY}`);

  const PROGRESS = path.join(DATA_DIR, 'loan_extract.progress.json');
  let done = new Set();
  try { done = new Set(JSON.parse(fs.readFileSync(PROGRESS, 'utf8'))); } catch { /* fresh */ }

  const todo = details.filter((d) => !done.has(d.slug)).slice(0, LIMIT === Infinity ? undefined : LIMIT);
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
