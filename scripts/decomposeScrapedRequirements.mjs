/**
 * Catalogue-wide requirement decomposition.
 *
 * The scraped "Documents Required" text (scheme_details.json) is already an
 * official, newline-separated list — one document per line. This turns that
 * list into individual, typed, checkable `scheme_requirements` rows for EVERY
 * scheme, keyed by the myScheme slug (so the readiness engine can run on any
 * of the ~4,679 catalogue schemes, not just the 20 curated ones).
 *
 * Fully DETERMINISTIC — no AI, no fabrication (§36). Each line is kept verbatim
 * from the official source; recognised documents get a canonical key (so a
 * user's uploaded Aadhaar satisfies "Aadhaar" across every scheme), and the
 * source_url points at the scheme's official myScheme page.
 *
 * Resumable + batched. Never touches the hand-authored curated scheme_* rows
 * (catalogue slugs don't collide with 'scheme_pmfme' etc.).
 */
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { getSupabaseAdmin } from '../services/supabaseAdmin.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const DATA_DIR = process.argv[2] || './backend/data/myscheme-scrape';
const LIMIT = process.argv.includes('--limit') ? Number(process.argv[process.argv.indexOf('--limit') + 1]) : Infinity;

// Lines that leaked from adjacent scraped sections — cut the doc list here.
const STOP_MARKERS = /^(frequently asked questions|sources? and references|feedback|was this helpful|news and updates|submission of paper|application process)/i;

// Recognised document -> canonical key + type + UI category. Order matters
// (first match wins). Anything unrecognised is kept as its own generic doc.
const CLASSIFIERS = [
  { re: /aadhaar|aadhar|आधार/i, key: 'aadhaar', type: 'identity', cat: 'Identity' },
  { re: /pan card|pan\b|पैन/i, key: 'pan_card', type: 'identity', cat: 'Identity' },
  { re: /passport/i, key: 'passport', type: 'identity', cat: 'Identity' },
  { re: /voter|epic/i, key: 'voter_id', type: 'identity', cat: 'Identity' },
  { re: /photograph|photo\b|फोटो/i, key: 'photo', type: 'document', cat: 'Identity' },
  { re: /caste|category certificate|sc\/st|obc|जाति/i, key: 'caste_certificate', type: 'category_specific', cat: 'Category & Eligibility' },
  { re: /disabilit|udid|divyang|दिव्यांग/i, key: 'disability_certificate', type: 'disability_specific', cat: 'Category & Eligibility' },
  { re: /income certificate|income proof|आय प्रमाण/i, key: 'income_certificate', type: 'financial_information', cat: 'Financial' },
  { re: /bank (account|details|statement|passbook)|passbook|cancelled cheque|बैंक/i, key: 'bank_account', type: 'bank', cat: 'Financial' },
  { re: /domicile|residence proof|residential|address proof|निवास/i, key: 'address_proof', type: 'address', cat: 'Address & Premises' },
  { re: /ration card|राशन/i, key: 'ration_card', type: 'document', cat: 'Documents' },
  { re: /project report|dpr|detailed project/i, key: 'project_report', type: 'project_information', cat: 'Project' },
  { re: /marksheet|mark sheet|marks card|degree|academic (certificate|record)|transcript|अंक/i, key: 'academic_marksheet', type: 'education', cat: 'Education' },
  { re: /admission|enrol|bonafide|fee receipt|प्रवेश/i, key: 'admission_proof', type: 'document', cat: 'Education' },
  { re: /gst|udyam|msme registration|business registration|license|licence/i, key: 'business_registration', type: 'document', cat: 'Business' },
  { re: /fssai/i, key: 'fssai', type: 'document', cat: 'Business' },
  { re: /land|khasra|khatauni|ownership|rent|lease|भूमि/i, key: 'land_proof', type: 'address', cat: 'Address & Premises' },
  { re: /mobile number|email/i, key: 'contact_info', type: 'personal_information', cat: 'Profile Information' },
];

function slugify(s) {
  return s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '_').replace(/^_+|_+$/g, '').slice(0, 48);
}

function decomposeDocs(text) {
  if (!text) return [];
  const lines = text.split('\n').map((l) => l.trim().replace(/^[•\-–*]\s*/, '')).filter(Boolean);
  const out = [];
  const seen = new Set();
  let idx = 0;
  for (const line of lines) {
    if (STOP_MARKERS.test(line)) break;                 // cut off leaked sections
    if (line.length < 3 || line.length > 200) continue; // skip noise / prose paragraphs
    if (/[?？]$/.test(line)) continue;                   // skip stray FAQ questions
    const cls = CLASSIFIERS.find((c) => c.re.test(line));
    const key = cls ? cls.key : `doc_${idx}_${slugify(line)}`;
    if (seen.has(key)) continue;                         // legit dedupe: same document named twice
    seen.add(key);
    out.push({
      requirement_key: key,
      requirement_name: line,
      requirement_type: cls ? cls.type : 'document',
      category: cls ? cls.cat : 'Documents',
    });
    idx++;
  }
  return out;
}

function loadDetails() {
  const f = path.join(DATA_DIR, 'scheme_details.json');
  return JSON.parse(fs.readFileSync(f, 'utf8'));
}

async function run() {
  const supabase = getSupabaseAdmin();
  const details = loadDetails().filter((d) => !d.error && !d.notFound && d.detail_text?.documents_required);
  console.log(`Schemes with scraped documents: ${details.length}`);

  const PROGRESS = path.join(DATA_DIR, 'decompose.progress.json');
  let done = new Set();
  try { done = new Set(JSON.parse(fs.readFileSync(PROGRESS, 'utf8'))); } catch { /* fresh */ }

  let processed = 0; let totalReqs = 0; let n = 0;
  const schemeRows = [];
  const reqRows = [];

  const flush = async () => {
    if (schemeRows.length) {
      await supabase.from('schemes').upsert(schemeRows.splice(0), { onConflict: 'scheme_id' });
    }
    if (reqRows.length) {
      const batch = reqRows.splice(0);
      const { error } = await supabase.from('scheme_requirements').upsert(batch, { onConflict: 'scheme_id,requirement_key' });
      if (error) console.error('req upsert error:', error.message);
    }
    fs.writeFileSync(PROGRESS, JSON.stringify([...done]));
  };

  for (const d of details) {
    if (n >= LIMIT) break;
    if (done.has(d.slug)) continue;
    const reqs = decomposeDocs(d.detail_text.documents_required);
    if (!reqs.length) { done.add(d.slug); continue; }

    schemeRows.push({ scheme_id: d.slug, name: d.name || d.slug, is_active: true });
    for (const r of reqs) {
      reqRows.push({
        scheme_id: d.slug,
        requirement_key: r.requirement_key,
        requirement_name: r.requirement_name,
        requirement_type: r.requirement_type,
        required: true,
        condition: { category: r.category, source: 'scraped_official' },
        source_name: 'myScheme — Government of India',
        source_url: d.source_url || `https://www.myscheme.gov.in/schemes/${d.slug}`,
        source_type: 'official_portal',
        source_last_verified: new Date().toISOString().slice(0, 10),
        priority: 2,
        delay_risk: 'MEDIUM',
        rejection_risk: 'MEDIUM',
      });
    }
    totalReqs += reqs.length;
    done.add(d.slug);
    processed++; n++;

    if (reqRows.length >= 400) await flush();
    if (processed % 500 === 0) console.log(`  ${processed} schemes decomposed, ${totalReqs} requirements`);
  }
  await flush();

  console.log(`\nDONE. Decomposed ${processed} schemes into ${totalReqs} individual requirements.`);
}

run().catch((e) => { console.error('FATAL', e); process.exit(1); });
