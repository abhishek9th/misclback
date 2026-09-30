/**
 * Picks WHICH catalogue schemes to run eligibility extraction on next, so the
 * structured set is weighted towards entrepreneurs and marginalised communities
 * instead of an arbitrary topic-balanced sample.
 *
 *   node backend/scripts/selectPriorityCatalogueSlugs.mjs [--count 420] [--out file.json] [--per-state 14]
 *
 * Only UNEXTRACTED schemes with scraped eligibility text are considered. Each is
 * scored from its OWN official name / description / eligibility text:
 *   entrepreneur segment : startup, MSME, enterprise, self-employment, business
 *                          loan/subsidy, artisan/weaver, FPO, cooperative, etc.
 *   marginalised segment : SC, ST, OBC, minorities, PwD/Divyang, transgender,
 *                          tribal, denotified/nomadic tribes, safai karamchari,
 *                          BPL/Antyodaya, EWS, destitute/widow.
 * Women-only schemes are NOT counted as "marginalised" on their own (they are
 * numerous and would swamp the set) — women entrepreneurs still qualify through
 * the entrepreneur signals.
 * A per-state cap keeps the set from being dominated by one state.
 */
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { getSupabaseAdmin } from '../services/supabaseAdmin.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const arg = (n, d) => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1] : d);
const COUNT = Number(arg('--count', 420));
const PER_STATE = Number(arg('--per-state', 14));
const MIN_SCORE = Number(arg('--min-score', 2));
const OUT = arg('--out', path.resolve(__dirname, '../data/myscheme-scrape/priority_slugs.json'));

export const ENT = /entrepreneur|start-?up|msme|micro,? small|micro enterprise|small enterprise|enterprise|self[- ]?employ|business|industr(y|ies|ial)|manufactur|venture|incubat|credit guarantee|mudra|artisan|weaver|handloom|handicraft|cottage|trader|street vendor|fpo|producer (company|organi[sz]ation)|cooperative|working capital|term loan|margin money|capital subsidy|sme\b/i;
export const MAR = /scheduled castes?|scheduled tribes?|\bsc\/st\b|\bsc\b|\bst\b|\bobc\b|backward class|minorit(y|ies)|muslim|christian|sikh|buddhist|jain|parsi|divyang|disabilit|handicapped|person with disab|\bpwd\b|transgender|tribal|denotified|nomadic|safai|scaveng|antyodaya|below poverty|\bbpl\b|economically weaker|\bews\b|dalit|adivasi|destitute|widow/i;
const FUNDING = /loan|subsid|grant|credit|financial assistance|margin money|working capital|incentive/i;

const stateOf = (r) => (r.states && r.states[0]) || 'ALL';

async function main() {
  const supabase = getSupabaseAdmin();
  let rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from('myscheme_catalogue')
      .select('slug,name,short_description,level,states,category_tags,eligibility_extracted,eligibility_text,benefits_text').range(from, from + 999);
    if (error) throw error;
    rows = rows.concat(data);
    if (data.length < 1000) break;
  }

  const scored = rows
    .filter((r) => !r.eligibility_extracted && (r.eligibility_text || '').length > 40)
    .map((r) => {
      const head = `${r.name} ${r.short_description || ''}`;
      const body = `${(r.eligibility_text || '').slice(0, 900)} ${(r.category_tags || []).join(' ')}`;
      const entHead = ENT.test(head), marHead = MAR.test(head);
      const entBody = ENT.test(body), marBody = MAR.test(body);
      let score = 0;
      if (entHead) score += 3; else if (entBody) score += 1;
      if (marHead) score += 3; else if (marBody) score += 1;
      if (FUNDING.test(`${head} ${(r.benefits_text || '').slice(0, 300)}`)) score += 1;
      if (/central/i.test(r.level || '')) score += 1; // wider reach
      return { r, score, ent: entHead || entBody, mar: marHead || marBody };
    })
    .filter((x) => x.score >= MIN_SCORE && (x.ent || x.mar))
    .sort((a, b) => b.score - a.score);

  const perState = {};
  const picked = [];
  for (const x of scored) {
    const st = stateOf(x.r);
    const isCentral = /central/i.test(x.r.level || '') || st === 'ALL';
    if (!isCentral && (perState[st] || 0) >= PER_STATE) continue;
    perState[st] = (perState[st] || 0) + 1;
    picked.push(x);
    if (picked.length >= COUNT) break;
  }

  fs.writeFileSync(OUT, JSON.stringify(picked.map((x) => x.r.slug), null, 1));
  const seg = { entrepreneur: picked.filter((x) => x.ent).length, marginalised: picked.filter((x) => x.mar).length, both: picked.filter((x) => x.ent && x.mar).length };
  console.log(`Candidates scored: ${scored.length} | selected: ${picked.length} -> ${OUT}`);
  console.log('Segments in selection:', JSON.stringify(seg), '| central:', picked.filter((x) => /central/i.test(x.r.level || '')).length, '| states covered:', Object.keys(perState).length);
  console.log('Sample:', picked.slice(0, 8).map((x) => `${x.score} ${x.r.name}`).join(' || '));
}

main().catch((e) => { console.error(e); process.exit(1); });
