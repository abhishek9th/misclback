/**
 * Step 1 of promoting catalogue schemes into the CURATED tier (src/data/schemes.js format).
 * Picks the best candidates from the structured catalogue and writes "review packets" —
 * each scheme's official text + extracted criteria — that a reviewer reads before writing
 * the curated record. Nothing is written to the database or to schemes.js here.
 *
 *   node backend/scripts/buildCurationPackets.mjs --out <dir> [--count 130] [--batch 26]
 */
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { getSupabaseAdmin } from '../services/supabaseAdmin.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
const arg = (n, d) => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1] : d);
const OUT = arg('--out', path.resolve(__dirname, '../data/curation/packets'));
const COUNT = Number(arg('--count', 130));
const BATCH = Number(arg('--batch', 26));
const PER_STATE = Number(arg('--per-state', 4));
fs.mkdirSync(OUT, { recursive: true });

const sb = getSupabaseAdmin();
let rows = [];
for (let f = 0; ; f += 1000) {
  const { data, error } = await sb.from('myscheme_catalogue')
    .select('slug,name,short_description,level,states,eligibility_extracted,income_limit,eligible_categories,eligible_genders,education_levels,min_age,max_age,benefit_types,audiences,eligibility_text,benefits_text,documents_required,application_process,source_url,ministries')
    .eq('eligibility_extracted', true).range(f, f + 999);
  if (error) throw error;
  rows = rows.concat(data);
  if (data.length < 1000) break;
}
const details = new Map(JSON.parse(fs.readFileSync(path.resolve(__dirname, '../data/myscheme-scrape/scheme_details.json'), 'utf8')).map((d) => [d.slug, d]));

// Already curated (do not duplicate): match on distinctive name words.
const { SCHEMES } = await import('../data/schemes.js');
const curatedWords = SCHEMES.map((s) => s.name.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w.length > 4));
const isDup = (name) => {
  const w = new Set(name.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((x) => x.length > 4));
  return curatedWords.some((cw) => cw.length >= 2 && cw.filter((x) => w.has(x)).length >= Math.min(3, cw.length));
};

const has = (a, l) => (a || []).some((x) => l.includes(x));
const len = (t) => (t || '').trim().length;
const AMOUNT = /(₹|rs\.?|inr)\s?[\d,]+|lakh|crore/i;
const JUNK = /puraskar|award|prize|competition|contest|olympiad/i;

const scored = rows
  .filter((r) => len(r.eligibility_text) >= 100 && len(r.benefits_text) >= 60 && len(r.documents_required) >= 20 && len(r.application_process) >= 80)
  .filter((r) => !JUNK.test(r.name) && !isDup(r.name))
  .map((r) => {
    const ent = has(r.audiences, ['entrepreneur', 'msme', 'startup', 'artisan']);
    const mar = has(r.eligible_categories, ['sc', 'st', 'obc', 'ews', 'minorities']) || has(r.audiences, ['minority', 'disabled']);
    const crit = [r.income_limit != null, (r.eligible_categories || []).length, (r.eligible_genders || []).length, r.min_age != null || r.max_age != null].filter(Boolean).length;
    let score = (ent ? 5 : 0) + (mar ? 5 : 0) + Math.min(crit, 3) + (AMOUNT.test(r.benefits_text) ? 2 : 0) + (has(r.benefit_types, ['loan', 'subsidy', 'grant']) ? 2 : 0);
    let type = 'welfare';
    if (has(r.audiences, ['student', 'researcher']) || has(r.benefit_types, ['scholarship', 'fellowship'])) type = 'student';
    if (ent || (has(r.benefit_types, ['loan', 'subsidy']) && has(r.audiences, ['worker', 'artisan', 'woman', 'farmer']) && /business|enterprise|unit|self.?employ/i.test(r.eligibility_text + r.short_description))) type = 'business';
    if (type === 'welfare' && has(r.audiences, ['unemployed']) || /skill (training|development)|vocational/i.test(r.name)) type = 'skill_employment';
    return { r, score, ent, mar, type };
  })
  .sort((a, b) => b.score - a.score);

// Balance: cap per state, keep business + marginalised weighted, and limit pure student picks.
const perState = {}; const picked = []; const typeCount = {};
const TYPE_CAP = { business: 70, student: 18, skill_employment: 8, welfare: 60 };
for (const x of scored) {
  const st = (x.r.states && x.r.states[0]) || 'ALL';
  const central = /central/i.test(x.r.level || '') || st === 'ALL';
  if (!central && (perState[st] || 0) >= PER_STATE) continue;
  if ((typeCount[x.type] || 0) >= TYPE_CAP[x.type]) continue;
  perState[st] = (perState[st] || 0) + 1; typeCount[x.type] = (typeCount[x.type] || 0) + 1;
  picked.push(x);
  if (picked.length >= COUNT) break;
}

const cut = (t, n) => String(t || '').replace(/\s+/g, ' ').trim().slice(0, n);
const packets = picked.map((x, i) => {
  const d = details.get(x.r.slug) || {};
  return {
    n: i + 1, slug: x.r.slug, name: x.r.name, level: x.r.level, states: x.r.states, suggested_type: x.type,
    ministries: (x.r.ministries || []).slice(0, 1),
    criteria_extracted: { income_limit: x.r.income_limit, categories: x.r.eligible_categories, genders: x.r.eligible_genders, education: x.r.education_levels, min_age: x.r.min_age, max_age: x.r.max_age, benefit_types: x.r.benefit_types, audiences: x.r.audiences },
    official_website: d.official_website || null,
    source_url: x.r.source_url,
    text: {
      about: cut(x.r.short_description, 200),
      eligibility: cut(x.r.eligibility_text, 560),
      benefits: cut(x.r.benefits_text, 430),
      documents: cut(x.r.documents_required, 260),
      process: cut(x.r.application_process, 300),
    },
  };
});
for (let i = 0; i < packets.length; i += BATCH) {
  fs.writeFileSync(path.join(OUT, `batch_${i / BATCH + 1}.jsonl`), packets.slice(i, i + BATCH).map((p) => JSON.stringify(p)).join(String.fromCharCode(10)));
}
console.log(`Eligible pool: ${scored.length} | packets: ${packets.length} in ${Math.ceil(packets.length / BATCH)} batches -> ${OUT}`);
console.log('By suggested type:', JSON.stringify(typeCount), '| central:', picked.filter((x) => /central/i.test(x.r.level || '')).length, '| states:', Object.keys(perState).length);
console.log('Segment: entrepreneur', picked.filter((x) => x.ent).length, '| marginalised', picked.filter((x) => x.mar).length, '| either', picked.filter((x) => x.ent || x.mar).length);
