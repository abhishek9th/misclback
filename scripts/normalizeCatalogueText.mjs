/**
 * One-time cleanup of double-encoded scraped catalogue text.
 *
 * application_process / documents_required / faqs were stored as JSON-encoded
 * STRINGS (e.g. '["Online\\nStep 1:..."]') instead of clean text, so they carried
 * visible brackets, quotes and literal "\n", plus leaked page-footer junk. This
 * rewrites each affected row's fields as clean, line-broken text (cutting off at
 * footer/junk markers), so every consumer gets clean data — not just the detail
 * view's display-layer fallback. Deterministic; no AI. Safe to re-run.
 *
 *   node backend/scripts/normalizeCatalogueText.mjs
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { getSupabaseAdmin } from '../services/supabaseAdmin.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const JUNK_RE = /^(frequently asked questions|disclaimer|terms\s*&?\s*conditions|dashboard|useful links|get in touch|last updated on|accessibility options|created by|copyright|©)/i;

function scrapedToText(v) {
  if (v == null) return null;
  let val = v;
  if (typeof val === 'string') {
    const t = val.trim();
    if (t.startsWith('[') || t.startsWith('{')) { try { val = JSON.parse(t); } catch { /* keep */ } }
  }
  const parts = Array.isArray(val) ? val : [val];
  const out = [];
  let cut = false;
  for (const part of parts) {
    if (cut) break;
    for (const raw of String(part ?? '').split('\n')) {
      const line = raw.replace(/﻿/g, '').trim();
      if (JUNK_RE.test(line)) { cut = true; break; }
      out.push(line);
    }
  }
  const text = out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return text || null;
}

// A field needs fixing if it's still an array or a JSON-looking string.
const needsFix = (v) => Array.isArray(v) || (typeof v === 'string' && /^\s*[[{]/.test(v));

const FIELDS = ['application_process', 'documents_required', 'faqs'];

async function run() {
  const sb = getSupabaseAdmin();

  // Load every row's target fields (paged — Supabase caps at 1000).
  let rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from('myscheme_catalogue')
      .select('slug, application_process, documents_required, faqs').range(from, from + 999);
    if (error) throw error;
    rows = rows.concat(data);
    if (data.length < 1000) break;
  }
  console.log(`Rows: ${rows.length}`);

  const todo = rows.filter((r) => FIELDS.some((f) => needsFix(r[f])));
  console.log(`Rows needing cleanup: ${todo.length}`);

  let done = 0; let changed = 0; let cleared = 0; let i = 0;
  async function worker() {
    while (i < todo.length) {
      const r = todo[i++];
      const patch = {};
      for (const f of FIELDS) {
        if (!needsFix(r[f])) continue;
        const cleaned = scrapedToText(r[f]);
        patch[f] = cleaned;
        if (cleaned == null) cleared++;
      }
      if (Object.keys(patch).length) {
        const { error } = await sb.from('myscheme_catalogue').update(patch).eq('slug', r.slug);
        if (!error) changed++;
        else if (changed < 10) console.warn(`  ! ${r.slug}: ${error.message}`);
      }
      if (++done % 200 === 0) console.log(`  ${done}/${todo.length} processed`);
    }
  }
  await Promise.all(Array.from({ length: 8 }, worker));
  console.log(`\nDONE. Cleaned ${changed} rows (${cleared} junk-only fields set null).`);
}

run().catch((e) => { console.error('FATAL', e); process.exit(1); });
