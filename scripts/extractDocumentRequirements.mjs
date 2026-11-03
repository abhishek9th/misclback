// One-time / occasional batch job: read each scheme's official text with AI and store its document
// requirements (per category and income) in scheme_document_requirements. Opening a scheme never
// calls AI; it only reads these stored rows.
//
//   node backend/scripts/extractDocumentRequirements.mjs --limit 100      (next 100 schemes not done yet)
//   node backend/scripts/extractDocumentRequirements.mjs --slug pmegp      (one scheme, re-extracted)
//
// Safe to stop and rerun: schemes already stored are skipped. Mind the Groq daily token limit: roughly
// 1,000-1,500 tokens per scheme, so ~100-150 schemes per key per day on the free tier.
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
dotenv.config({ path: fileURLToPath(new URL('../.env', import.meta.url)) });
import { getSupabaseAdmin } from '../services/supabaseAdmin.js';
import { extractWithAI, saveRequirements } from '../services/documentRequirements.js';

const arg = (n) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : null; };
const limit = Number(arg('limit') || 50);
const onlySlug = arg('slug');
const sb = getSupabaseAdmin();

let rows;
if (onlySlug) {
  const { data } = await sb.from('myscheme_catalogue').select('slug,name,documents_required,eligibility_text,application_process').eq('slug', onlySlug);
  rows = data || [];
} else {
  const done = new Set();
  for (let f = 0; ; f += 1000) {
    const { data, error } = await sb.from('scheme_document_requirements').select('slug').eq('source', 'ai').range(f, f + 999);
    if (error) { console.error('Run the migration 20261106 first:', error.message); process.exit(1); }
    (data || []).forEach((r) => done.add(r.slug));
    if (!data || data.length < 1000) break;
  }
  rows = [];
  for (let f = 0; rows.length < limit; f += 1000) {
    const { data } = await sb.from('myscheme_catalogue').select('slug,name,documents_required,eligibility_text,application_process').not('documents_required', 'is', null).range(f, f + 999);
    if (!data || !data.length) break;
    for (const r of data) if (!done.has(r.slug) && String(r.documents_required).trim().length > 20) { rows.push(r); if (rows.length >= limit) break; }
    if (data.length < 1000) break;
  }
}

console.log(`Extracting ${rows.length} scheme(s)…`);
let ok = 0; let failed = 0;
for (const row of rows) {
  try {
    const r = await extractWithAI(row);
    await saveRequirements(row.slug, r, 'ai');
    ok += 1;
    console.log(`  ✓ ${row.slug} (${r.documents.length} documents)`);
  } catch (e) {
    failed += 1;
    console.error(`  ✗ ${row.slug}: ${e.message}`);
    if (/daily limit/i.test(e.message)) { console.error('All Groq keys are over the daily limit — stop and rerun tomorrow.'); break; }
  }
}
console.log(`Done: ${ok} stored, ${failed} failed.`);
process.exit(0);
