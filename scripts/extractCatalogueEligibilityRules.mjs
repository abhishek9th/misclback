/**
 * Zero-token eligibility extraction. Applies services/eligibilityRules.js to the
 * already-scraped official text of the given schemes and writes the structured
 * columns to public.myscheme_catalogue — no LLM, no API quota.
 *
 *   node backend/scripts/extractCatalogueEligibilityRules.mjs --slugs priority_slugs.json [--dry]
 *
 * • Only schemes NOT already extracted are touched (existing LLM extractions stay).
 * • A scheme is only marked eligibility_extracted when the rules found at least one
 *   criterion in its text; otherwise it is left alone (never marked "open to all"
 *   just because nothing matched).
 * • The phrase behind every value is saved to rules_evidence.json for audit.
 */
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { getSupabaseAdmin } from '../services/supabaseAdmin.js';
import { extractEligibility, signalCount } from '../services/eligibilityRules.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
const arg = (n, d) => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1] : d);
const DRY = process.argv.includes('--dry');
const SLUGS_FILE = arg('--slugs', path.resolve(__dirname, '../data/myscheme-scrape/priority_slugs.json'));
const EVIDENCE = path.resolve(__dirname, '../data/myscheme-scrape/rules_evidence.json');

const supabase = getSupabaseAdmin();
const slugs = JSON.parse(fs.readFileSync(SLUGS_FILE, 'utf8'));
const allow = new Set(slugs);

let rows = [];
for (let from = 0; ; from += 1000) {
  const { data, error } = await supabase.from('myscheme_catalogue')
    .select('slug,name,short_description,eligibility_text,benefits_text,eligibility_extracted').range(from, from + 999);
  if (error) throw error;
  rows = rows.concat(data);
  if (data.length < 1000) break;
}
const todo = rows.filter((r) => allow.has(r.slug) && !r.eligibility_extracted);
console.log(`Requested ${slugs.length} | not yet extracted: ${todo.length}${DRY ? ' | DRY RUN' : ''}`);

let evidence = {};
try { evidence = JSON.parse(fs.readFileSync(EVIDENCE, 'utf8')); } catch { /* fresh */ }

let written = 0, noSignal = 0, failed = 0;
const dist = {};
for (const r of todo) {
  const x = extractEligibility(r);
  const n = signalCount(x);
  dist[n] = (dist[n] || 0) + 1;
  if (n < 1) { noSignal++; continue; }
  const { _evidence, ...cols } = x;
  evidence[r.slug] = _evidence;
  if (DRY) { written++; continue; }
  const { error } = await supabase.from('myscheme_catalogue')
    .update({ ...cols, eligibility_extracted: true, eligibility_extracted_at: new Date().toISOString() })
    .eq('slug', r.slug);
  if (error) { failed++; console.warn('  ! ', r.slug, error.message); } else written++;
}
if (!DRY) fs.writeFileSync(EVIDENCE, JSON.stringify(evidence, null, 1));
console.log(`Written: ${written} | no criteria found (left untouched): ${noSignal} | failed: ${failed}`);
console.log('Criteria found per scheme (count of dimensions):', JSON.stringify(dist));
