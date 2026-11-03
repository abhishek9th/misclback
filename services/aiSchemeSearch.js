import Groq from 'groq-sdk';
import { getSupabaseAdmin } from './supabaseAdmin.js';
import { inSector } from './catalogueMatcher.js';
import { extractDocuments } from './eligibilityRules.js';
import { scoreScheme, checkEligibility, GAP_LABEL, ELIGIBILITY_TEXT } from './recommender/scoring.js';
import { BANDS } from './recommender/config.js';

// Hybrid recommendation pipeline.
//   1. UNDERSTAND  Groq turns the flow answers + profile + free text into a structured
//                  profile (who, which crop/activity, what help) and a search plan.
//   2. RETRIEVE    keyword/audience retrieval over the full stored catalogue text, then HARD
//                  filters on KNOWN facts (location, income, category, gender, age, education,
//                  other-crop schemes). Unknown facts never exclude.
//   3. JUDGE       Groq reads each shortlisted scheme's real text against the citizen
//                  (relevance 0-10, crop match, fit, reason). It never sets eligibility.
//   4. SCORE       recommender/scoring.js combines six weighted components into a 0-100
//                  relevance score and, separately, an eligibility status. Weights are
//                  configurable (recommender/config.js). Below the "hide" band = not shown.
// If Groq is down, stages 1 and 3 fall back to rules so search still works (flagged ai:false).

// Override with GROQ_MODEL. openai/gpt-oss-20b is a little faster (about 13s vs 17s in a test) and
// gave similar results; qwen/qwen3.8-27b was slower (36s).
const MODEL = process.env.GROQ_MODEL || 'openai/gpt-oss-120b';
// The judge/pick steps use a lighter model: it is faster AND has its own per-minute token budget, so
// the plan (big model) and the judging (light model) do not compete for the same rate limit.
const FAST_MODEL = process.env.GROQ_FAST_MODEL || 'openai/gpt-oss-20b';
const isReasoning = (m) => /gpt-oss/.test(m);
// Several Groq keys can be supplied (GROQ_API_KEY, GROQ_API_KEY_2 ... or GROQ_API_KEYS=a,b,c).
// When one hits its daily token cap the next is used, so search keeps working.
const groqKeys = () => [...new Set([
  process.env.GROQ_API_KEY, process.env.GROQ_API_KEY_2, process.env.GROQ_API_KEY_3, process.env.GROQ_API_KEY_4, process.env.GROQ_API_KEYS,
].flatMap((v) => String(v || '').split(',')).map((k) => k.trim()).filter(Boolean))];
const exhaustedUntil = new Map();
let rr = 0;
// Round-robin over keys that are not over their daily cap, so parallel calls spread across accounts.
const coolUntil = new Map();   // short per-minute rate-limit pauses (a few seconds)
const pickKey = () => {
  const now = Date.now();
  const live = groqKeys().filter((k) => (exhaustedUntil.get(k) || 0) < now && (coolUntil.get(k) || 0) < now);
  return live.length ? live[rr++ % live.length] : null;
};
// When no key is free right now: how long until one is (null = every key is over its DAILY cap).
const msUntilKeyFree = () => {
  const now = Date.now();
  const waits = groqKeys().filter((k) => (exhaustedUntil.get(k) || 0) < now).map((k) => Math.max(0, (coolUntil.get(k) || 0) - now));
  return waits.length ? Math.min(...waits) : null;
};
const hasGroq = () => groqKeys().length > 0;

const COLS = 'slug,name,short_description,level,states,benefit_types,scheme_type,source_url,income_limit,' +
  'eligible_categories,eligible_genders,education_levels,audiences,min_age,max_age,category_tags,keyword_tags,' +
  'eligibility_text,benefits_text,eligibility_extracted,documents_required,official_website,detail_scraped_at,' +
  'loan_amount_max,interest_subsidy_pct,interest_subsidy_note,interest_rate';

const AUDIENCES = ['farmer', 'student', 'entrepreneur', 'msme', 'startup', 'artisan', 'worker', 'unemployed', 'woman', 'senior', 'disabled', 'researcher'];
const BENEFITS = ['loan', 'subsidy', 'grant', 'scholarship', 'stipend', 'training', 'insurance', 'pension', 'equipment', 'housing', 'fellowship', 'other'];
const CATEGORIES = ['general', 'obc', 'sc', 'st', 'ews', 'minorities'];

let cache = { at: 0, rows: null };
const TTL_MS = 15 * 60 * 1000;

async function loadAll() {
  if (cache.rows && Date.now() - cache.at < TTL_MS) return cache.rows;
  const supabase = getSupabaseAdmin();
  let rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from('myscheme_catalogue').select(COLS).range(from, from + 999);
    if (error) throw error;
    rows = rows.concat(data.map((r) => {
      const elig = String(r.eligibility_text || '').slice(0, 500);
      const ben = String(r.benefits_text || '').slice(0, 300);
      return {
        ...r,
        eligibility_text: elig,
        benefits_text: ben,
        documents_required: String(r.documents_required || '').slice(0, 600),
        _hay_name: (r.name || '').toLowerCase(),
        _hay_desc: `${r.short_description || ''}`.toLowerCase(),
        _hay_body: `${elig} ${ben}`.toLowerCase(),
        _hay_tags: [...(r.category_tags || []), ...(r.keyword_tags || [])].join(' ').toLowerCase(),
      };
    }));
    if (data.length < 1000) break;
  }
  cache = { at: Date.now(), rows };
  return rows;
}

const SECTOR_NOT_NAME = {
  agriculture_allied: /poultry|dairy|livestock|piggery|pig|fisher|aquacultur|animal husbandry|cattle|cow|gau|goat|sheep|apicultur|beekeep|honey|pashu|semen|hatchery|shrimp/i,
};
const has = (a) => Array.isArray(a) && a.length > 0;
const overlap = (a, b) => has(a) && has(b) && a.some((x) => b.includes(x));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- Claude (optional). When ANTHROPIC_API_KEY is set, Claude does the understanding and judging
// (better at nuance than the free Groq models); Groq stays as the automatic fallback.
//   CLAUDE_PLAN_MODEL  (default claude-sonnet-5-5)  - understands the request
//   CLAUDE_FAST_MODEL  (default claude-haiku-5-5)   - judges candidates, picks chatbot schemes
const claudeKey = () => (process.env.ANTHROPIC_API_KEY || '').trim();
const hasClaude = () => claudeKey().length > 0;
let claudeDownUntil = 0;
async function claudeJson(system, user, maxTokens, model) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': claudeKey(), 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model, max_tokens: Math.max(1500, maxTokens), temperature: 0.1, system: `${system}
Return ONLY the JSON object, no other text.`, messages: [{ role: 'user', content: user }] }),
    signal: AbortSignal.timeout(45000),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw Object.assign(new Error(`Claude ${res.status}: ${t.slice(0, 160)}`), { status: res.status });
  }
  const data = await res.json();
  const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
  const m = /\{[\s\S]*\}/.exec(text);
  if (!m) throw new Error('Claude returned no JSON');
  return JSON.parse(m[0]);
}

// role: 'plan' | 'fast'. Tries Claude, then Groq.
export const hasAI = () => hasClaude() || hasGroq();
export async function aiJson(role, system, user, maxTokens) {
  if (hasClaude() && Date.now() > claudeDownUntil) {
    try {
      return await claudeJson(system, user, maxTokens, role === 'plan' ? (process.env.CLAUDE_PLAN_MODEL || 'claude-sonnet-5-5') : (process.env.CLAUDE_FAST_MODEL || 'claude-haiku-5-5'));
    } catch (e) {
      console.error('Claude call failed, falling back to Groq:', e.message);
      if (e.status === 401 || e.status === 403 || e.status === 429 || e.status === 400) claudeDownUntil = Date.now() + 10 * 60 * 1000;
    }
  }
  return groqJson(system, user, maxTokens, 0, role === 'plan' ? MODEL : FAST_MODEL);
}

// Free-tier Groq has a small tokens-per-minute budget; on a 429/413 wait and retry.
async function groqJson(system, user, maxTokens = 2500, attempt = 0, model = MODEL) {
  let key = pickKey();
  if (!key) {
    const wait = msUntilKeyFree();
    if (wait === null) throw new Error('All Groq keys are over their daily limit');
    await sleep(wait + 200);                       // keys are only pausing for the per-minute limit
    key = pickKey();
    if (!key) throw new Error('Groq is busy, try again');
  }
  try {
    return await groqJsonOnce(system, user, maxTokens, key, model);
  } catch (e) {
    if (/per day|TPD/i.test(String(e?.message))) {          // daily cap on this key: switch keys
      exhaustedUntil.set(key, Date.now() + 30 * 60 * 1000);
      if (pickKey()) return groqJson(system, user, maxTokens, attempt, model);
    }
    if (/timed out|timeout|ECONN|ETIMEDOUT|fetch failed/i.test(String(e?.message)) && attempt < 3) {
      return groqJson(system, user, maxTokens, attempt + 1, model);   // transient network slowness: try again
    }
    const limited = e?.status === 429 || e?.status === 413 || /rate_limit/.test(String(e?.message));
    if (limited && attempt < 4) {
      const m = /try again in ([\d.]+)s/i.exec(String(e?.message));
      const waitMs = Math.min(25000, (m ? parseFloat(m[1]) * 1000 : 12000) + 1000);
      coolUntil.set(key, Date.now() + waitMs);               // this key is cooling down (per-minute limit)
      if (pickKey()) return groqJson(system, user, maxTokens, attempt + 1, model); // another key is free: use it NOW
      await sleep(waitMs);
      return groqJson(system, user, maxTokens, attempt + 1, model);
    }
    throw e;
  }
}

const keyUse = new Map();   // calls per key (last 4 chars shown in the log), to confirm load is spread
export const keyUsage = () => Object.fromEntries([...keyUse].map(([k, n]) => ['…' + k.slice(-4), n]));

async function groqJsonOnce(system, user, maxTokens, key, model) {
  keyUse.set(key, (keyUse.get(key) || 0) + 1);
  const res = await new Groq({ apiKey: key, timeout: 40000, maxRetries: 0 }).chat.completions.create({
    model,
    temperature: 0.1,
    ...(isReasoning(model) ? { reasoning_effort: 'low' } : {}),
    max_tokens: maxTokens,
    response_format: { type: 'json_object' },
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
  });
  return JSON.parse(res.choices[0].message.content);
}

// ---------------------------------------------------------------- stage 1
const PLAN_SYSTEM = `You help an Indian government-scheme portal find schemes for a citizen.
You get the citizen's answers from a guided flow, their saved profile, and optionally a free-text note (may be Hindi/Hinglish).
IMPORTANT: the person typing may be asking for SOMEONE ELSE (father, mother, spouse ...). Work out who the beneficiary is.
NEVER assume caste/category, gender, income, age or landholding. Only fill a profile field if the note or flow answers state it.
Return ONLY JSON:
{
  "summary": "one plain sentence: who the beneficiary is and what they need",
  "domain": "short phrase for the primary domain, e.g. farming and allied agriculture",
  "beneficiary": "self | father | mother | spouse | child | family | other",
  "profile": {
    "occupation": string|null, "activity": string|null, "business_type": string|null,
    "state": string|null, "district": string|null,
    "category": one of ${JSON.stringify(CATEGORIES)} or null, "gender": "male|female|other"|null,
    "age": number|null, "annual_income": number|null,
    "investment_required": number|null (rupees the person says they need or will invest),
    "business_stage": "new|existing"|null, "business_type": "individual|shg|company|cooperative|partnership|other"|null,
    "landholding": "marginal|small|medium|large"|null
  },
  "audiences": [subset of ${JSON.stringify(AUDIENCES)} that describe the BENEFICIARY],
  "benefit_types": [subset of ${JSON.stringify(BENEFITS)} they are likely after; be generous],
  "keywords": [25-40 lowercase terms scheme names/descriptions in this domain would contain: English, official scheme-name words, Hindi in Roman script],
  "avoid_keywords": [terms meaning a scheme is OUT of this domain],
  "crop_profile": null OR (when a crop/animal is named) {
    "name": "e.g. soybean",
    "season": "kharif | rabi | zaid | perennial | year-round | n/a",
    "group": "cereal | pulse | oilseed | fibre | sugar | plantation | spice | fruit | vegetable | flower | dairy | poultry | fishery | other",
    "related_terms": [lowercase words a scheme for THIS crop or its group would contain],
    "other_crop_terms": [lowercase names of crops/groups of DIFFERENT groups whose dedicated schemes are irrelevant]
  },
  "follow_ups": [up to 3 {"key": one of "state|district|landholding|category|annual_income|age|gender|crop|investment_required|business_stage", "question_en": string, "question_hi": string} — ONLY facts that are missing AND would change which schemes apply]
}
Field meaning: flow_answers.field 'agriculture_allied' = crop farming, horticulture, irrigation, farm inputs and machinery ONLY; dairy, poultry, fisheries and other livestock belong to the separate field 'dairy_livestock', so do not include them for 'agriculture_allied' (and the reverse).
When a crop is given, first work out its group and season; match schemes to that group, not to farming in general.
Be broad on keywords (recall matters; a later step filters). Never invent scheme names.`;

function fallbackPlan(criteria = {}) {
  const f = criteria.field;
  const words = {
    agriculture_allied: ['agriculture', 'farmer', 'kisan', 'krishi', 'crop', 'dairy', 'livestock', 'fisheries', 'horticulture', 'irrigation', 'seed', 'fasal', 'bima', 'soil', 'organic', 'tractor', 'cattle', 'poultry'],
  }[f] || [];
  return { summary: '', domain: f || '', beneficiary: 'self', profile: {}, audiences: [], benefit_types: [], keywords: words, avoid_keywords: [], crop_profile: null, follow_ups: [] };
}

const arr = (v) => (Array.isArray(v) ? v.map((x) => String(x).toLowerCase().trim()).filter(Boolean) : []);
const numOrNull = (v) => (v === null || v === undefined || v === '' || Number.isNaN(Number(v)) ? null : Number(v));

async function understand(criteria, profile, query, remembered = null) {
  if (!hasGroq() && !hasClaude()) return { plan: fallbackPlan(criteria), ai: false };
  try {
    const plan = await aiJson('plan', PLAN_SYSTEM, JSON.stringify({ flow_answers: criteria, saved_profile: profile, remembered_from_earlier_searches: remembered, note: query || null }), 2400);
    const p = plan.profile && typeof plan.profile === 'object' ? plan.profile : {};
    return {
      ai: true,
      plan: {
        summary: String(plan.summary || ''),
        domain: String(plan.domain || ''),
        beneficiary: String(plan.beneficiary || 'self').toLowerCase(),
        profile: {
          occupation: p.occupation || null, activity: p.activity || null, business_type: p.business_type || null,
          state: p.state || null, district: p.district || null,
          category: CATEGORIES.includes(String(p.category || '').toLowerCase()) ? String(p.category).toLowerCase() : null,
          gender: ['male', 'female', 'other'].includes(String(p.gender || '').toLowerCase()) ? String(p.gender).toLowerCase() : null,
          age: numOrNull(p.age), annual_income: numOrNull(p.annual_income),
          investment_required: numOrNull(p.investment_required),
          business_stage: ['new', 'existing'].includes(String(p.business_stage || '').toLowerCase()) ? String(p.business_stage).toLowerCase() : null,
          business_type: p.business_type ? String(p.business_type).toLowerCase() : null,
          landholding: ['marginal', 'small', 'medium', 'large'].includes(String(p.landholding || '').toLowerCase()) ? String(p.landholding).toLowerCase() : null,
        },
        audiences: arr(plan.audiences).filter((a) => AUDIENCES.includes(a)),
        benefit_types: arr(plan.benefit_types).filter((b) => BENEFITS.includes(b)),
        keywords: arr(plan.keywords).slice(0, 50),
        avoid_keywords: arr(plan.avoid_keywords).slice(0, 30),
        crop_profile: plan.crop_profile && typeof plan.crop_profile === 'object' ? {
          name: String(plan.crop_profile.name || ''),
          season: String(plan.crop_profile.season || ''),
          group: String(plan.crop_profile.group || ''),
          related_terms: arr(plan.crop_profile.related_terms).slice(0, 20),
          other_crop_terms: arr(plan.crop_profile.other_crop_terms).slice(0, 25),
        } : null,
        follow_ups: (Array.isArray(plan.follow_ups) ? plan.follow_ups : []).slice(0, 3)
          .filter((f) => f && f.key && f.question_en)
          .map((f) => ({ key: String(f.key), question_en: String(f.question_en), question_hi: String(f.question_hi || f.question_en) })),
      },
    };
  } catch (e) {
    console.error('AI plan failed, using rules:', e.message);
    return { plan: fallbackPlan(criteria), ai: false };
  }
}

// The profile used for eligibility. If the beneficiary is not the person typing, the saved
// profile's category/income/gender/age/education belong to the USER, not the beneficiary, so
// they are dropped; only what the beneficiary's own details (note / answers) state is used.
// Location is kept because it is usually shared and is stated by the user's state.
export function effectiveProfile(saved, plan, answers = {}) {
  const forSelf = !plan.beneficiary || plan.beneficiary === 'self';
  const ai = plan.profile || {};
  const base = forSelf ? { ...saved } : { state: saved.state || null, income: null, category: null, gender: null, education: null, age: null };
  const pick = (a, b, c) => [a, b, c].find((v) => v !== null && v !== undefined && v !== '') ?? null;
  return {
    state: pick(answers.state, ai.state, base.state),
    district: pick(answers.district, ai.district, null),
    income: pick(numOrNull(answers.annual_income), ai.annual_income, base.income),
    category: pick(answers.category, ai.category, base.category),
    gender: pick(answers.gender, ai.gender, base.gender),
    education: base.education ?? null,
    age: pick(numOrNull(answers.age), ai.age, base.age),
    landholding: pick(answers.landholding, ai.landholding, null),
    investment_required: pick(numOrNull(answers.investment_required), ai.investment_required, null),
    business_stage: pick(answers.business_stage, ai.business_stage, null),
    business_type: pick(answers.business_type, ai.business_type, null),
  };
}

// ---------------------------------------------------------------- stage 2
// Returns { list, excluded }: `excluded` counts schemes that looked relevant by text but were
// removed by a hard rule (a stated eligibility condition, or another crop's dedicated scheme).
export function retrieve(pool, plan, profile, criteria, limit) {
  const crop = plan.crop_profile;
  const related = crop ? crop.related_terms.filter((k) => k.length > 2) : [];
  const otherCrops = crop ? crop.other_crop_terms.filter((k) => k.length > 2) : [];
  const kws = [...new Set([...plan.keywords, ...related])].filter((k) => k.length > 2);
  const avoid = plan.avoid_keywords.filter((k) => k.length > 2);
  const out = [];
  let excluded = 0;
  for (const r of pool) {
    // Crop farming must not pull in livestock/poultry/fisheries schemes (that is the 'dairy_livestock' field).
    if (criteria.field === 'agriculture_allied' && SECTOR_NOT_NAME.agriculture_allied.test(r.name || '')) continue;
    let score = 0;
    for (const k of related) {
      if (r._hay_name.includes(k)) score += 6;
      else if (r._hay_desc.includes(k) || r._hay_body.includes(k)) score += 3;
    }
    for (const k of kws) {
      if (r._hay_name.includes(k)) score += 5;
      else if (r._hay_tags.includes(k)) score += 3;
      else if (r._hay_desc.includes(k)) score += 2;
      else if (r._hay_body.includes(k)) score += 1;
    }
    if (overlap(r.audiences, plan.audiences)) score += 6;
    if (overlap(r.benefit_types, plan.benefit_types)) score += 1;
    if (criteria.field && inSector(r, criteria.field)) score += 5;
    for (const k of avoid) if (r._hay_name.includes(k)) score -= 4;
    if (score <= 2) continue; // not about this at all — not counted as "excluded"

    // --- hard filters (KNOWN facts only) ---
    if (otherCrops.some((k) => r._hay_name.includes(k)) && !related.some((k) => r._hay_name.includes(k))) { excluded += 1; continue; }
    if (checkEligibility(r, profile).conflict) { excluded += 1; continue; }

    if (profile.state && has(r.states) && r.states.includes(profile.state)) score += 2;
    out.push({ r, score });
  }
  out.sort((a, b) => b.score - a.score);
  return { list: out.slice(0, limit).map((x) => ({ ...x.r, _kw: x.score })), excluded };
}

// ---------------------------------------------------------------- stage 3
const JUDGE_SYSTEM = `You judge which Indian government schemes genuinely suit ONE citizen (the beneficiary).
Input JSON: citizen { summary, domain, crop_profile, profile } and candidates [{id,name,about,eligibility,benefits}].
For EACH candidate decide, using ONLY the text given (never invent rules, amounts or dates):
- relevance 0-10: does the scheme's purpose belong to the citizen's need/activity? Be STRICT: a farmer must not get research fellowships, a healthcare seeker must not get farm schemes; a scheme for a different occupation, crop group or activity scores 0-2. A scheme restricted to a DIFFERENT industry or product (e.g. telecom, textiles, defence, a research fellowship) scores 0-3 even if it is also 'manufacturing' or 'export'. A general scheme open to everyone in the domain scores 5-7 unless it clearly serves the stated need; reserve 8-10 for schemes whose stated purpose directly matches the stated activity.
- match: "exact" (names their crop/animal/activity), "group" (their crop group, season or sub-sector), "general" (open to all in the domain). If a crop is given, a scheme dedicated to a different crop group scores relevance 0-2.
- fit: "likely" (profile meets what is stated), "maybe" (relevant but criteria can't be confirmed from the profile), "no" (stated criteria exclude this person).
- reason: max 14 words, simple English, why it suits them.
- conditions: up to 3 short strings of things the citizen must still check, taken ONLY from the scheme text: whether new businesses/this activity are allowed (or on a negative list), project-cost/loan ceilings compared with citizen.profile.investment_required, entity type, enrolment windows.
- missing: list of facts needed to confirm (from: annual_income, social_category, gender, age, education_level, state, district, land_holding, crop_season, other).
Return ONLY JSON: {"results":[{"id":number,"relevance":number,"match":"exact|group|general","fit":"likely|maybe|no","reason":string,"conditions":[string],"missing":[string]}]} covering every candidate.`;

const clip = (s, n) => String(s || '').replace(/\s+/g, ' ').slice(0, n);

async function judge(candidates, plan, profile) {
  const results = new Map();
  results.failed = new Set();
  const BATCH = 20;
  // With 2+ keys the batches run in parallel (each lands on a different key); with one key they run
  // one after another so the per-minute token limit is respected.
  const starts = [];
  for (let i = 0; i < candidates.length; i += BATCH) starts.push(i);
  const parallel = hasClaude() || groqKeys().length > 1;
  const runBatch = async (i) => {
    const slice = candidates.slice(i, i + BATCH);
    try {
      const out = await aiJson('fast', JUDGE_SYSTEM, JSON.stringify({
        citizen: { summary: plan.summary, domain: plan.domain, crop_profile: plan.crop_profile, profile },
        candidates: slice.map((c, idx) => ({
          id: i + idx, name: c.name, about: clip(c.short_description, 140),
          eligibility: clip(c.eligibility_text, 140), benefits: clip(c.benefits_text, 50),
        })),
      }), 2400);
      for (const x of out.results || []) results.set(Number(x.id), x);
    } catch (e) {
      console.error('AI judge batch failed:', e.message);
      for (let k = i; k < i + slice.length; k++) results.failed.add(k);
    }
  };
  if (parallel) await Promise.all(starts.map(runBatch));
  else for (const i of starts) await runBatch(i);
  return results;
}

// ---------------------------------------------------------------- de-duplication
// Variants/components of one parent scheme (e.g. "X: Nursery", "X: Harvesting Tools", Mudra Shishu/
// Kishore/Tarun) become ONE recommendation; the best-scoring member leads and the rest are listed.
const familyKey = (s) => {
  const base = String(s.name || '').toLowerCase()
    .replace(/pradhan mantri|prime minister'?s?/g, 'pm')
    .split(/:| - |– |- /)[0]
    .replace(/\b(yojana|yojna|scheme|programme|program|mission|the|of|for|and)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ').trim().replace(/s\b/g, '');
  return `${base}|${(s.states || []).slice().sort().join(',')}`;
};
function groupFamilies(sorted) {
  const out = new Map();
  for (const s of sorted) {
    const k = familyKey(s);
    const lead = out.get(k);
    if (!lead) { out.set(k, { ...s, variants: [] }); continue; }
    lead.variants.push({ slug: s.slug, name: s.name });
  }
  return [...out.values()];
}

// ---------------------------------------------------------------- stage 4 + public
const memo = new Map();

function buildWhy(r, c, judged, plan, profile) {
  const why = [];
  if (judged?.reason) why.push(judged.reason);
  if (judged?.match === 'exact' && plan.crop_profile?.name) why.push(`Names your crop/activity (${plan.crop_profile.name})`);
  else if (judged?.match === 'group' && plan.crop_profile?.group) why.push(`Covers the ${plan.crop_profile.group} group your crop belongs to`);
  if (overlap(r.audiences, plan.audiences)) why.push(`Aimed at ${r.audiences.filter((a) => plan.audiences.includes(a)).join('/')}`);
  if (!has(r.states)) why.push('Central scheme — applies across India');
  else if (profile.state && r.states.includes(profile.state)) why.push(`Available in ${profile.state}`);
  if (c.check.passed > 0) why.push(`${c.check.passed} stated condition${c.check.passed > 1 ? 's' : ''} match what you told us`);
  return [...new Set(why)].slice(0, 4);
}

const inflight = new Map();
// Identical searches that arrive together (the page can fire the same request twice) share ONE run,
// so they do not each spend tokens.
export function aiSearch(params) {
  const key = JSON.stringify([params.criteria, params.profile, params.query, params.answers, params.remembered, params.limit]);
  if (inflight.has(key)) return inflight.get(key);
  const p = aiSearchRun(params).finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

async function aiSearchRun({ criteria = {}, profile = {}, query = '', answers = {}, remembered = null, limit = 30 }) {
  const key = JSON.stringify([criteria, profile, query, answers, remembered, limit]);
  const hit = memo.get(key);
  if (hit && Date.now() - hit.at < 10 * 60 * 1000) return hit.value;

  const t0 = Date.now();
  const pool = await loadAll();
  const t1 = Date.now();
  const { plan, ai } = await understand(criteria, profile, query, remembered);
  const t2 = Date.now();
  const eff = effectiveProfile(profile, plan, answers);
  const { list: shortlist, excluded: hardExcluded } = retrieve(pool, plan, eff, criteria, 40);

  let judged = new Map();
  const t3 = Date.now();
  if (ai && shortlist.length) judged = await judge(shortlist, plan, eff);
  console.log(`aiSearch timing: catalogue ${t1 - t0}ms, plan ${t2 - t1}ms, retrieve ${t3 - t2}ms, judge ${Date.now() - t3}ms | calls per key ${JSON.stringify(keyUsage())}`);
  const judgedOk = judged.size > 0;

  const counts = { highly_relevant: 0, relevant: 0, potentially_relevant: 0, needs_info: 0, excluded: hardExcluded };
  const schemes = [];
  shortlist.forEach((r, idx) => {
    const j = judged.get(idx) || null;
    if (judgedOk && !j && !judged.failed.has(idx)) { counts.excluded += 1; return; } // judge left it out => irrelevant
    if (j && (j.fit === 'no' || Number(j.relevance) < 3)) { counts.excluded += 1; return; }
    // When the request names a specific crop/activity, only schemes that actually serve it are
    // shown: its own crop or crop group, or a general scheme the judge rates as a strong fit.
    // Anything vaguer is dropped rather than padded in.
    if (plan.crop_profile?.name && j && j.match === 'general' && Number(j.relevance) < 8) { counts.excluded += 1; return; }
    const sc = scoreScheme(r, { plan, profile: eff, judge: j, kw: r._kw });
    if (sc.band === 'not_relevant') { counts.excluded += 1; return; }
    if (sc.status === 'more_info_required' || sc.status === 'not_verified') counts.needs_info += 1;
    counts[sc.band] += 1;

    const toVerify = sc.check.gaps.map((g) => GAP_LABEL[g] || g);
    for (const c of j?.conditions || []) if (c && !toVerify.includes(c)) toVerify.push(String(c).slice(0, 160));
    for (const m of j?.missing || []) {
      const label = GAP_LABEL[m] || ({ land_holding: 'Landholding size', crop_season: 'Crop and season' }[m]) || null;
      if (label && !toVerify.includes(label)) toVerify.push(label);
    }
    if (sc.status === 'not_verified') toVerify.push("This scheme's eligibility rules could not be read automatically — check the official page");

    const { _hay_name, _hay_desc, _hay_body, _hay_tags, eligibility_text, benefits_text, documents_required, _kw, ...rest } = r;
    schemes.push({
      ...rest,
      relevance_score: sc.score,
      relevance_band: sc.band,
      score_parts: Object.fromEntries(Object.entries(sc.parts).map(([k, v]) => [k, Math.round(v * 100)])),
      eligibility_status: sc.status,
      eligibility_label: ELIGIBILITY_TEXT[sc.status],
      match_level: j?.match || null,
      why: buildWhy(r, sc, j, plan, eff),
      to_verify: toVerify,
      benefit_summary: clip(benefits_text, 220) || null,
      documents: extractDocuments(documents_required || '').map((d) => d.label),
      application_url: r.official_website || r.source_url || `https://www.myscheme.gov.in/schemes/${r.slug}`,
      last_checked_at: r.detail_scraped_at || null,
      ai_judged: Boolean(j),
    });
  });

  const tier = { exact: 2, group: 1, general: 0 };
  schemes.sort((a, b) => b.relevance_score - a.relevance_score || (tier[b.match_level] ?? 0) - (tier[a.match_level] ?? 0));

  const value = {
    ai: ai && judgedOk,
    summary: plan.summary,
    domain: plan.domain,
    beneficiary: plan.beneficiary,
    crop: plan.crop_profile,
    profile_used: eff,
    follow_ups: plan.follow_ups.filter((f) => !answers[f.key]),
    bands: { highly_relevant: BANDS.highly, relevant: BANDS.relevant, potentially_relevant: BANDS.potential },
    counts,
    total: schemes.length,
    schemes: groupFamilies(schemes).slice(0, limit),
    extracted: { beneficiary: plan.beneficiary, profile: plan.profile, crop: plan.crop_profile, summary: plan.summary },
  };
  memo.set(key, { at: Date.now(), value });
  if (memo.size > 200) memo.delete(memo.keys().next().value);
  return value;
}

// ---------------------------------------------------------------- chatbot retrieval
const CHAT_PICK_SYSTEM = `You pick government schemes that genuinely fit ONE citizen's request.
Input: citizen {summary, domain, crop_profile, profile} and candidates [{id,name,states,about}].
Return ONLY JSON {"pick":[ids]} ordered best first, at most 6. Include a candidate only if its purpose really matches what the citizen asked for (their activity/crop/need); omit anything about a different occupation, crop group or purpose, and omit schemes tied to a state other than the citizen's state (if the state is known). If nothing fits, return {"pick":[]}. Never invent ids.`;

// Finds candidate schemes for a chat message using the same AI plan + full-catalogue retrieval,
// but WITHOUT the slow per-scheme judge, so the chatbot stays quick. The chatbot's answer step then
// picks from these (and may only name schemes in this list). Returns '' when nothing was found.
export async function searchForChat({ query, currentProfile = {}, limit = 8 }) {
  if ((!hasGroq() && !hasClaude()) || !query || !query.trim()) return '';
  const saved = {
    state: currentProfile.state || null,
    category: currentProfile.socialCategory || null,
    gender: currentProfile.gender || null,
    income: currentProfile.annualFamilyIncome ?? null,
  };
  const context = [currentProfile.businessField, currentProfile.businessSubField, currentProfile.studentType, currentProfile.category]
    .filter(Boolean).join(', ');
  const note = context ? `${query}\n(earlier in this chat: ${context})` : query;
  const pool = await loadAll();
  const { plan, ai } = await understand({}, saved, note);
  if (!ai) return '';
  const eff = effectiveProfile(saved, plan, {});
  // Without a known state, a scheme tied to some other state is far less likely to help than a
  // central one, so central schemes are preferred; variants of one scheme are collapsed.
  const { list: raw } = retrieve(pool, plan, eff, {}, 120);
  const ordered = eff.state ? raw : [...raw.filter((r) => !has(r.states)), ...raw.filter((r) => has(r.states))];
  const seen = new Set();
  const cands = [];
  for (const r of ordered) {
    const k = familyKey(r);
    if (seen.has(k)) continue;
    seen.add(k);
    cands.push(r);
    if (cands.length >= 24) break;
  }
  if (!cands.length) return '';
  // One small AI call chooses which candidates genuinely fit; everything else is dropped.
  let list = cands.slice(0, limit);
  try {
    const out = await aiJson('fast', CHAT_PICK_SYSTEM, JSON.stringify({
      citizen: { summary: plan.summary, domain: plan.domain, crop_profile: plan.crop_profile, profile: eff },
      candidates: cands.map((c, i) => ({ id: i, name: c.name, states: c.states, about: clip(c.short_description, 110) })),
    }), 900);
    const ids = (Array.isArray(out.pick) ? out.pick : []).map(Number).filter((i) => cands[i]);
    list = [...new Set(ids)].slice(0, limit).map((i) => cands[i]);
  } catch (e) { console.error('chat pick failed:', e.message); }
  if (!list.length) return '';
  return list.map((r) => [
    `- ${r.name}${has(r.states) ? ` (${r.states.join(', ')})` : ' (central)'}`,
    r.short_description && `  ${clip(r.short_description, 240)}`,
    r.benefits_text && `  Benefits: ${clip(r.benefits_text, 220)}`,
    r.eligibility_text && `  Eligibility: ${clip(r.eligibility_text, 240)}`,
    `  Official: ${r.official_website || r.source_url || `https://www.myscheme.gov.in/schemes/${r.slug}`}`,
  ].filter(Boolean).join('\n')).join('\n');
}

// Load the whole catalogue into memory at start-up and keep it fresh, so the first search does not
// pay for downloading ~4,700 rows.
export function warmUp() {
  const go = () => loadAll().then((r) => console.log(`Scheme catalogue cached (${r.length} schemes)`)).catch((e) => console.error('catalogue warm-up failed:', e.message));
  go();
  setInterval(() => { cache.at = 0; go(); }, TTL_MS - 60 * 1000).unref();
}
