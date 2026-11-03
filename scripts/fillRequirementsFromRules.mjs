// Fills scheme_document_requirements for EVERY scheme in the catalogue using the stored text and rules
// (no AI, no tokens, takes a minute). AI-extracted rows (source 'ai') are never overwritten; run
// extractDocumentRequirements.mjs afterwards to upgrade rule rows to AI-read, category-aware ones.
//   node backend/scripts/fillRequirementsFromRules.mjs
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
dotenv.config({ path: fileURLToPath(new URL('../.env', import.meta.url)) });
import { getSupabaseAdmin } from '../services/supabaseAdmin.js';
import { fromRules } from '../services/documentRequirements.js';

const sb = getSupabaseAdmin();
const ai = new Set();
for (let f = 0; ; f += 1000) {
  const { data, error } = await sb.from('scheme_document_requirements').select('slug').eq('source', 'ai').range(f, f + 999);
  if (error) { console.error('Run the migration 20261106 first:', error.message); process.exit(1); }
  (data || []).forEach((r) => ai.add(r.slug));
  if (!data || data.length < 1000) break;
}
let rows = [];
for (let f = 0; ; f += 1000) {
  const { data } = await sb.from('myscheme_catalogue').select('slug,documents_required,income_limit').range(f, f + 999);
  rows = rows.concat(data || []);
  if (!data || data.length < 1000) break;
}
const out = [];
let noDocs = 0;
for (const r of rows) {
  if (ai.has(r.slug)) continue;
  const res = fromRules(r);
  if (!res.documents.length) { noDocs += 1; continue; }
  out.push({ slug: r.slug, documents: res.documents, category_notes: [], source: 'rules', extracted_at: new Date().toISOString() });
}
for (let i = 0; i < out.length; i += 200) {
  const { error } = await sb.from('scheme_document_requirements').upsert(out.slice(i, i + 200));
  if (error) { console.error('write failed:', error.message); process.exit(1); }
}
console.log(`Stored ${out.length} schemes from rules; ${noDocs} schemes list no readable documents; ${ai.size} AI rows kept.`);
process.exit(0);
