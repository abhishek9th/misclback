import { WEIGHTS, bandOf } from './config.js';
import { educationOk } from '../catalogueMatcher.js';

// Pure, deterministic scoring + eligibility. No network, no AI — the AI only supplies the
// `judge` input (how well the scheme's text fits the request); everything the user sees as a
// score or eligibility status is computed here from stored scheme fields and known user facts.

const has = (a) => Array.isArray(a) && a.length > 0;
const overlap = (a, b) => has(a) && has(b) && a.some((x) => b.includes(x));

export const GAP_LABEL = {
  state: 'Your state',
  district: 'Your district',
  annual_income: 'Annual family income',
  social_category: 'Social category (General/OBC/SC/ST)',
  gender: 'Gender',
  age: 'Age',
  education_level: 'Education level',
};

// Hard eligibility check against KNOWN facts only. Unknown facts become gaps, never rejections.
//   profile: { state, income, category, gender, education, age }
// returns { conflict: string|null, gaps: string[], passed: number, checked: number }
export function checkEligibility(r, profile) {
  const gaps = [];
  let passed = 0;
  let checked = 0;
  let conflict = null;
  const test = (applies, known, ok, gapKey, why) => {
    if (!applies) return;
    checked += 1;
    if (!known) { gaps.push(gapKey); return; }
    if (ok) passed += 1; else if (!conflict) conflict = why;
  };
  test(has(r.states), !!profile.state, has(r.states) && r.states.includes(profile.state), 'state', `Only for ${(r.states || []).join(', ')}`);
  test(r.income_limit != null, profile.income != null && profile.income !== '', Number(profile.income) <= Number(r.income_limit), 'annual_income', `Income limit ₹${Number(r.income_limit).toLocaleString('en-IN')}`);
  test(has(r.eligible_categories), !!profile.category, has(r.eligible_categories) && r.eligible_categories.includes(profile.category), 'social_category', `Only for ${(r.eligible_categories || []).join('/').toUpperCase()}`);
  test(has(r.eligible_genders), !!profile.gender, has(r.eligible_genders) && r.eligible_genders.includes(profile.gender), 'gender', `Only for ${(r.eligible_genders || []).join('/')}`);
  test(has(r.education_levels), !!profile.education, educationOk(r, profile.education), 'education_level', 'Education requirement not met');
  const ageKnown = profile.age != null && profile.age !== '';
  test(r.min_age != null || r.max_age != null, ageKnown,
    !((r.min_age != null && profile.age < r.min_age) || (r.max_age != null && profile.age > r.max_age)), 'age', 'Age requirement not met');
  return { conflict, gaps, passed, checked };
}

// fit: the AI judge's view ('likely' | 'maybe' | 'no' | null)
export function eligibilityStatus(check, scheme, fit) {
  if (check.conflict) return 'not_eligible';
  if (check.checked === 0) return scheme.eligibility_extracted ? 'potentially_eligible' : 'not_verified';
  if (check.gaps.length === 0) return fit === 'maybe' ? 'potentially_eligible' : 'eligible';
  return check.gaps.length >= 2 ? 'more_info_required' : 'potentially_eligible';
}

export const ELIGIBILITY_TEXT = {
  eligible: 'Eligible based on the information you provided',
  potentially_eligible: 'Potentially eligible',
  more_info_required: 'More information required',
  not_eligible: 'Not eligible based on a stated condition',
  not_verified: 'Eligibility not verified',
};

// -------------------------------------------------------------------------- components (0..1)
function beneficiaryScore(r, plan) {
  if (!has(r.audiences)) return 0.5;               // open to everyone
  if (!has(plan.audiences)) return 0.5;
  return overlap(r.audiences, plan.audiences) ? 1 : 0.1;
}

function locationScore(r, profile) {
  if (!has(r.states)) return 0.85;                 // central scheme
  if (!profile.state) return 0.4;                  // state-specific, user state unknown
  return r.states.includes(profile.state) ? 1 : 0; // mismatch is filtered out before scoring
}

function assistanceScore(r, plan) {
  if (!has(plan.benefit_types)) return 0.6;
  if (!has(r.benefit_types)) return 0.5;
  return overlap(r.benefit_types, plan.benefit_types) ? 1 : 0.2;
}

const SEMANTIC_TIER = { exact: 1, group: 0.7, general: 0.4 };

// judge: { relevance 0-10, match 'exact|group|general', fit } or null when the AI is unavailable.
// kw: keyword retrieval score (used as the purpose/semantic proxy when there is no judge).
export function scoreScheme(r, { plan, profile, judge, kw = 0 }) {
  const kwNorm = Math.max(0, Math.min(1, kw / 25));
  const purpose = judge ? Math.max(0, Math.min(1, Number(judge.relevance) / 10)) : kwNorm;
  const semantic = judge ? (SEMANTIC_TIER[judge.match] ?? 0.4) : kwNorm;
  const check = checkEligibility(r, profile);
  const eligibilityComponent = check.checked === 0 ? 0.5 : (check.passed + 0.4 * check.gaps.length) / check.checked;

  const parts = {
    purpose,
    beneficiary: beneficiaryScore(r, plan),
    eligibility: eligibilityComponent,
    location: locationScore(r, profile),
    assistance: assistanceScore(r, plan),
    semantic,
  };
  let score = 0;
  for (const k of Object.keys(WEIGHTS)) score += WEIGHTS[k] * parts[k];
  score = Math.round(score * 100);

  // Purpose is a gate, not just a weight: a scheme whose purpose does not clearly fit can never
  // rank as relevant, however well location/eligibility/semantics line up.
  if (judge) {
    const cap = purpose < 0.5 ? 55 : purpose < 0.7 ? 79 : 100;
    score = Math.min(score, cap);
  }

  // A relevant-looking scheme with a verified conflict is never a recommendation, however
  // well its text matches.
  const status = eligibilityStatus(check, r, judge?.fit);
  return { score, band: bandOf(score), parts, check, status };
}
