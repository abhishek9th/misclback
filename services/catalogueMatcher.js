import { getSupabaseAdmin } from './supabaseAdmin.js';

// Strict, sector-aware matcher over the structured myScheme catalogue.
// Unlike the SQL matcher (which only BOOSTS audience matches), this one EXCLUDES
// schemes that are not about the chosen sector — an Agriculture search returns
// agriculture schemes, a Healthcare search healthcare schemes, and so on. When a
// scheme has a criterion the user's profile can't answer (blank income, age,
// category...), the scheme is still shown but that gap is reported so it can be
// added to the user's readiness checklist instead of being silently ignored.

const COLS = 'slug,name,short_description,level,states,benefit_types,scheme_type,source_url,income_limit,' +
  'eligible_categories,eligible_genders,education_levels,audiences,min_age,max_age';

// Business "field" -> what a scheme must look like to belong to it.
// A scheme qualifies when its name/summary matches `words` OR it targets one of `audiences`.
const SECTORS = {
  agriculture_allied: {
    audiences: ['farmer'],
    words: /agricultur|farm|kisan|crop|dairy|livestock|poultry|fisher|aquacultur|horticult|animal husbandry|cattle|sericultur|beekeep|apicultur|irrigation|seed|fertili|tractor|mandi|agri\b|agro/i,
  },
  dairy_livestock: {
    audiences: [],
    words: /dairy|milk|livestock|cattle|cow|gau|gopal|goat|sheep|poultry|piggery|pig|fisher|fish|aquacultur|animal husbandry|pashu|veterinar|apicultur|beekeep|honey|buffalo|breed|semen|hatchery|shrimp/i,
    not: /fellowship|conference|scholarship/i,
  },
  food_processing: {
    audiences: [],
    words: /food|processing|dairy|agro|fruit|vegetable|spice|bakery|pickle|beverage|flour|oil mill|dal mill|cold chain|packag/i,
  },
  manufacturing: {
    audiences: [],
    words: /manufactur|industr|factory|production unit|msme|micro and small|micro, small|cluster|fabricat|machinery/i,
  },
  retail_trading: {
    audiences: [],
    words: /retail|trader|shop|vendor|street vend|svanidhi|trading|merchant|market linkage/i,
  },
  tech_it: {
    audiences: ['startup'],
    words: /startup|start-up|software|\bit\b|incubat|electronics|cyber|artificial intelligence|deep tech|digital/i,
  },
  transport: {
    audiences: [],
    words: /transport|vehicle|truck|taxi|electric vehicle|\bev\b|rickshaw|logistic|fleet|e-mobility|cab\b/i,
  },
  tourism: {
    audiences: [],
    words: /touris|hospitality|homestay|hotel|travel agen|resort|pilgrim/i,
    not: /conference|fellowship|cultural/i,
  },
  handicrafts: {
    audiences: ['artisan'],
    words: /handicraft|handloom|artisan|craft|weaver|khadi|village industr|textile|potter|leather|carpet|embroider|vishwakarma|tailor/i,
  },
  healthcare: {
    audiences: [],
    words: /health|medical|hospital|pharma|medicine|nursing|diagnostic|ayush|ayushman|ambulance|janaushadhi|therapy/i,
    not: /agri|doctoral|fellowship|conference/i,
  },
  services: {
    audiences: [],
    words: /self.?employ|salon|beauty|service provider|vendor|artisan|entrepreneur|tailor/i,
  },
};

// Dairy schemes are addressed to farmers too, so match on farmer audience only if the text agrees.
let cache = { at: 0, rows: null };
const TTL_MS = 10 * 60 * 1000;

async function loadPool() {
  if (cache.rows && Date.now() - cache.at < TTL_MS) return cache.rows;
  const supabase = getSupabaseAdmin();
  let rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from('myscheme_catalogue').select(COLS)
      .eq('eligibility_extracted', true).range(from, from + 999);
    if (error) throw error;
    rows = rows.concat(data);
    if (data.length < 1000) break;
  }
  cache = { at: Date.now(), rows };
  return rows;
}

const has = (arr) => Array.isArray(arr) && arr.length > 0;
const overlap = (a, b) => has(a) && has(b) && a.some((x) => b.includes(x));

export function inSector(row, sector) {
  const def = SECTORS[sector];
  if (!def) return true;
  const name = row.name || '';
  const desc = row.short_description || '';
  if (def.not && def.not.test(`${name} ${desc}`)) return false;
  if (overlap(row.audiences, def.audiences)) return true;
  if (def.words.test(name)) return true; // title says it's about this sector
  // Otherwise the summary must be clearly about it (several sector terms), not a passing mention.
  const g = new RegExp(def.words.source, 'gi');
  return (desc.match(g) || []).length >= 2;
}

// Education: for schemes that name a qualification (loans, jobs, training, grants) the listed
// level is the MINIMUM — a graduate meets "12th pass". For student schemes the listed levels are
// the course the student is CURRENTLY in, so those must match exactly.
const EDU_RANK = { school: 0, '10th': 1, '12th': 2, vocational: 2, diploma: 3, undergraduate: 4, postgraduate: 5, phd: 6 };
export function educationOk(scheme, userEdu) {
  const levels = scheme.education_levels;
  if (!has(levels) || !userEdu) return true;
  if (levels.includes(userEdu)) return true;
  if (has(scheme.audiences) && scheme.audiences.includes('student')) return false;
  const ranks = levels.map((l) => EDU_RANK[l]).filter((n) => n != null);
  if (!ranks.length || EDU_RANK[userEdu] == null) return false;
  return EDU_RANK[userEdu] >= Math.min(...ranks);
}

// profile: { income, category, gender, education, state, age }
// params:  { benefitTypes, audiences, sector, limit }
export async function matchCatalogue(profile, params = {}) {
  const pool = await loadPool();
  const { benefitTypes = [], audiences = [], sector = null, limit = 20 } = params;
  const out = [];

  for (const r of pool) {
    // --- Strict relevance: sector, audience and benefit type must fit ---
    if (sector && !inSector(r, sector)) continue;
    if (!sector && has(audiences) && !overlap(r.audiences, audiences)) continue;
    // Benefit type (loan / subsidy / grant / amount ...) never excludes — every kind of
    // benefit is shown; a match only ranks higher.

    // --- Hard eligibility: only excluded when the user's value is KNOWN and fails ---
    const gaps = [];
    if (has(r.states)) {
      if (!profile.state) gaps.push('state');
      else if (!r.states.includes(profile.state)) continue;
    }
    if (r.income_limit != null) {
      if (profile.income == null) gaps.push('annual_income');
      else if (Number(profile.income) > Number(r.income_limit)) continue;
    }
    if (has(r.eligible_categories)) {
      if (!profile.category) gaps.push('social_category');
      else if (!r.eligible_categories.includes(profile.category)) continue;
    }
    if (has(r.eligible_genders)) {
      if (!profile.gender) gaps.push('gender');
      else if (!r.eligible_genders.includes(profile.gender)) continue;
    }
    if (has(r.education_levels)) {
      if (!profile.education) gaps.push('education_level');
      else if (!educationOk(r, profile.education)) continue;
    }
    if (r.min_age != null || r.max_age != null) {
      if (profile.age == null) gaps.push('age');
      else if ((r.min_age != null && profile.age < r.min_age) || (r.max_age != null && profile.age > r.max_age)) continue;
    }

    // --- Ranking: specific & well-matched first, fewer unknowns first ---
    let score = 0;
    if (sector && inSector(r, sector)) score += 4;
    if (overlap(r.audiences, audiences)) score += 3;
    if (profile.state && has(r.states) && r.states.includes(profile.state)) score += 3;
    if (profile.category && has(r.eligible_categories) && r.eligible_categories.includes(profile.category)) score += 3;
    if (profile.gender && has(r.eligible_genders) && r.eligible_genders.includes(profile.gender)) score += 2;
    if (overlap(r.benefit_types, benefitTypes)) score += 2;
    score -= gaps.length;
    out.push({ ...r, profile_gaps: gaps, match_score: score });
  }

  out.sort((a, b) => b.match_score - a.match_score || a.name.localeCompare(b.name));
  return { total: out.length, schemes: out.slice(0, limit) };
}

const RS = (n) => `₹${Number(n).toLocaleString('en-IN')}`;

// Per-scheme readiness checklist built from the scheme's structured criteria vs the profile.
// status: 'met' | 'unmet' | 'missing' (profile has no value — user should add it).
export function buildReadiness(scheme, profile) {
  const items = [];
  const push = (key, label, requirement, status) => items.push({ key, label, requirement, status });

  if (scheme.income_limit != null) {
    push('annual_income', 'Annual family income', `Up to ${RS(scheme.income_limit)}`,
      profile.income == null ? 'missing' : Number(profile.income) <= Number(scheme.income_limit) ? 'met' : 'unmet');
  }
  if (has(scheme.eligible_categories)) {
    push('social_category', 'Social category', scheme.eligible_categories.map((c) => c.toUpperCase()).join(' / '),
      !profile.category ? 'missing' : scheme.eligible_categories.includes(profile.category) ? 'met' : 'unmet');
  }
  if (has(scheme.eligible_genders)) {
    push('gender', 'Gender', scheme.eligible_genders.join(' / '),
      !profile.gender ? 'missing' : scheme.eligible_genders.includes(profile.gender) ? 'met' : 'unmet');
  }
  if (scheme.min_age != null || scheme.max_age != null) {
    const req = scheme.min_age != null && scheme.max_age != null ? `${scheme.min_age}–${scheme.max_age} years`
      : scheme.min_age != null ? `${scheme.min_age}+ years` : `Up to ${scheme.max_age} years`;
    const bad = profile.age != null && ((scheme.min_age != null && profile.age < scheme.min_age) || (scheme.max_age != null && profile.age > scheme.max_age));
    push('age', 'Age', req, profile.age == null ? 'missing' : bad ? 'unmet' : 'met');
  }
  if (has(scheme.education_levels)) {
    const isStudent = has(scheme.audiences) && scheme.audiences.includes('student');
    push('education_level', 'Education', (isStudent ? '' : 'At least ') + scheme.education_levels.join(' / '),
      !profile.education ? 'missing' : educationOk(scheme, profile.education) ? 'met' : 'unmet');
  }
  if (has(scheme.states)) {
    push('state', 'State of residence', scheme.states.join(', '),
      !profile.state ? 'missing' : scheme.states.includes(profile.state) ? 'met' : 'unmet');
  }
  return items;
}
