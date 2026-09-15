// ============================================================================
// Proactive Eligibility Engine — evaluates the user's profile against EVERY
// curated scheme at once, so the homepage can answer "what can I claim now?"
// without the user searching first.
//
// TWO SEPARATE, DETERMINISTIC SCORES (never AI-decided — see §6/§40/§43/§46 of
// the product spec):
//
//   1. Eligibility Match — do the user's PERMANENT profile attributes satisfy
//      the scheme's published eligibility rules? Computed here from the
//      structured fields already on each scheme (income_limit,
//      eligible_categories, eligible_genders, states/scope). Every dimension
//      resolves to MATCH / FAIL / UNKNOWN / NOT_RESTRICTED — crucially UNKNOWN
//      is NOT treated as FAIL (§43).
//
//   2. Application Readiness — does the user have the DOCUMENTS ready? Computed
//      by the existing requirementEngine over scheme_requirements rows.
//
// A user can be fully eligible (Match) yet not ready to apply (Readiness),
// and the two must stay visibly distinct.
//
// The engine NEVER invents a threshold, deadline, or benefit it wasn't given,
// and NEVER claims official/government eligibility — the caller surfaces the
// "final authority is the government department" caveat.
// ============================================================================

import {
  evaluateRequirements, computeEligibility, computeReadinessScore, classifyMissingByPriority,
} from './requirementEngine.js';
import { evaluateConflicts, computeClaimability, canonicalStatus } from './conflictEngine.js';

// ---- per-dimension eligibility checks (structured, explainable) -------------
// Each returns { key, label, user_value, required_value, status }.
// status: 'MATCH' | 'FAIL' | 'UNKNOWN' | 'NOT_RESTRICTED'
//   NOT_RESTRICTED = the scheme is open on this dimension (does not constrain
//   the user), which the user therefore satisfies.

function checkIncome(scheme, profile) {
  const base = { key: 'income', label: 'Family income', label_hi: 'पारिवारिक आय' };
  if (scheme.income_limit === null || scheme.income_limit === undefined) {
    return { ...base, user_value: null, required_value: null, status: 'NOT_RESTRICTED' };
  }
  const required_value = `≤ ₹${Number(scheme.income_limit).toLocaleString('en-IN')}`;
  if (profile.annual_income === null || profile.annual_income === undefined) {
    return { ...base, user_value: null, required_value, status: 'UNKNOWN' };
  }
  const user_value = `₹${Number(profile.annual_income).toLocaleString('en-IN')}`;
  return { ...base, user_value, required_value, status: profile.annual_income <= scheme.income_limit ? 'MATCH' : 'FAIL' };
}

function checkCategory(scheme, profile) {
  const base = { key: 'category', label: 'Social category', label_hi: 'सामाजिक श्रेणी' };
  const cats = scheme.eligible_categories || [];
  if (!cats.length || cats.includes('all')) {
    return { ...base, user_value: profile.category || null, required_value: 'Open to all', status: 'NOT_RESTRICTED' };
  }
  const required_value = cats.map((c) => c.toUpperCase()).join(', ');
  if (!profile.category) return { ...base, user_value: null, required_value, status: 'UNKNOWN' };
  return { ...base, user_value: profile.category.toUpperCase(), required_value, status: cats.includes(profile.category) ? 'MATCH' : 'FAIL' };
}

function checkGender(scheme, profile) {
  const base = { key: 'gender', label: 'Eligible applicants', label_hi: 'पात्र आवेदक' };
  const g = scheme.eligible_genders || [];
  if (!g.length || g.includes('all')) {
    return { ...base, user_value: null, required_value: 'Open to all', status: 'NOT_RESTRICTED' };
  }
  // 'pwd' is a disability restriction (not a gender), 'lgbtq' maps to the
  // 'other' gender value used at registration — see seedSchemeRequirements.mjs.
  if (g.includes('pwd')) {
    const required_value = 'Persons with disabilities';
    if (profile.disability_status === null || profile.disability_status === undefined) {
      return { ...base, key: 'disability', label: 'Disability status', label_hi: 'दिव्यांगता स्थिति', user_value: null, required_value, status: 'UNKNOWN' };
    }
    return { ...base, key: 'disability', label: 'Disability status', label_hi: 'दिव्यांगता स्थिति', user_value: profile.disability_status ? 'Yes' : 'No', required_value, status: profile.disability_status ? 'MATCH' : 'FAIL' };
  }
  if (g.includes('lgbtq')) {
    const required_value = 'Transgender applicants';
    if (!profile.gender) return { ...base, user_value: null, required_value, status: 'UNKNOWN' };
    return { ...base, user_value: profile.gender, required_value, status: profile.gender === 'other' ? 'MATCH' : 'FAIL' };
  }
  const required_value = g.join(', ');
  if (!profile.gender) return { ...base, user_value: null, required_value, status: 'UNKNOWN' };
  return { ...base, user_value: profile.gender, required_value, status: g.includes(profile.gender) ? 'MATCH' : 'FAIL' };
}

function checkState(scheme, profile) {
  const base = { key: 'state', label: 'State / coverage', label_hi: 'राज्य / कवरेज' };
  const states = scheme.states || [];
  if (scheme.scope === 'central' || !states.length || states.includes('all')) {
    return { ...base, user_value: profile.state || null, required_value: 'All India', status: 'NOT_RESTRICTED' };
  }
  const required_value = states.join(', ');
  if (!profile.state) return { ...base, user_value: null, required_value, status: 'UNKNOWN' };
  return { ...base, user_value: profile.state, required_value, status: states.includes(profile.state) ? 'MATCH' : 'FAIL' };
}

// Weight a dimension's contribution to the match score.
const STATUS_WEIGHT = { MATCH: 1, NOT_RESTRICTED: 1, UNKNOWN: 0.5, FAIL: 0 };

// For a failing/unknown check, classify whether the user could ever change the
// outcome — so the "why not eligible" view can tell them honestly instead of
// giving false hope or telling them to falsify anything (§8/§9).
//   'permanent' — a fixed attribute (category/gender/disability): cannot change
//   'income'    — income exceeds the limit: only a genuine income change helps
//   'location'  — state/domicile based
//   'info'      — we just don't know this yet; providing it may change the result
function classifyChangeability(check) {
  if (check.status === 'UNKNOWN') return 'info';
  if (check.status !== 'FAIL') return null;
  if (check.key === 'category' || check.key === 'gender' || check.key === 'disability') return 'permanent';
  if (check.key === 'income') return 'income';
  if (check.key === 'state') return 'location';
  return 'permanent';
}

export function evaluateSchemeEligibility(scheme, profile) {
  const checks = [checkIncome(scheme, profile), checkCategory(scheme, profile), checkGender(scheme, profile), checkState(scheme, profile)]
    .map((c) => ({ ...c, changeability: classifyChangeability(c) }));

  const sum = checks.reduce((a, c) => a + (STATUS_WEIGHT[c.status] ?? 0), 0);
  const matchScore = Math.round((sum / checks.length) * 100);

  const hasFail = checks.some((c) => c.status === 'FAIL');
  const hasUnknown = checks.some((c) => c.status === 'UNKNOWN');
  let status;
  if (hasFail) status = 'NOT_ELIGIBLE';
  else if (hasUnknown) status = 'POTENTIAL';
  else status = 'ELIGIBLE';

  return { checks, matchScore, status, failedChecks: checks.filter((c) => c.status === 'FAIL') };
}

// ---- combine eligibility (structured fields) + readiness (documents) -------
// requirementRows: the scheme_requirements rows for this scheme (may be empty).
// reqProfile: the snapshot shape requirementEngine expects.
export function evaluateSchemeForUser(scheme, structuredProfile, reqProfile, requirementRows, documents, availability, alreadyApplied, applications = []) {
  const elig = evaluateSchemeEligibility(scheme, structuredProfile);

  // Readiness + any extra eligibility signals the requirement rows encode
  // (e.g. a hard min-age failure), which can override to NOT_ELIGIBLE.
  let readinessScore = null;
  let missing = [];
  let reqEligibility = { status: 'UNKNOWN', failedChecks: [] };
  if (requirementRows && requirementRows.length) {
    const results = evaluateRequirements(requirementRows, reqProfile, documents, availability);
    reqEligibility = computeEligibility(results);
    const r = computeReadinessScore(results);
    readinessScore = r.score;
    missing = r.missing.map((m) => ({ key: m.requirement_key, name: m.requirement_name, delay_risk: m.delay_risk }));
  }

  // Merge the two eligibility signals — worst case wins (a hard requirement
  // failure like underage must not be masked by a passing field match).
  let finalStatus = elig.status;
  if (reqEligibility.status === 'NOT_ELIGIBLE') finalStatus = 'NOT_ELIGIBLE';
  else if (finalStatus === 'ELIGIBLE' && reqEligibility.status === 'UNKNOWN' && requirementRows?.some((r) => r.requirement_type === 'eligibility')) {
    // only downgrade to POTENTIAL if there was a real eligibility rule we couldn't resolve
    finalStatus = 'POTENTIAL';
  }

  // Conflict check against the user's other applications (§33). A BLOCKING
  // conflict overrides "ready to apply" (§15).
  const conflict = evaluateConflicts(scheme.id, applications);
  const ownApp = applications.find((a) => a.scheme_id === scheme.id);
  const ownStatus = ownApp ? canonicalStatus(ownApp.status) : null;

  // Classify into the homepage buckets (§4).
  let bucket;
  if (conflict.status === 'CONFLICT') bucket = 'conflict';
  else if (alreadyApplied) bucket = 'already_applied';
  else if (finalStatus === 'NOT_ELIGIBLE') bucket = 'not_eligible';
  else if (finalStatus === 'POTENTIAL') bucket = 'potential';
  else if (readinessScore === null || readinessScore >= 100) bucket = 'ready';
  else bucket = 'action_required';

  const claimability = computeClaimability({
    eligibilityStatus: finalStatus, readinessScore, ownStatus, conflict,
  });

  // The single headline reason a not-eligible user was ruled out, plus whether
  // it can ever change — drives the honest "why not eligible" view (§8/§9).
  let mainReason = null;
  if (bucket === 'not_eligible') {
    const firstFail = elig.checks.find((c) => c.status === 'FAIL')
      || (reqEligibility.failedChecks || []).map((f) => ({ key: f.requirement_key, label: f.requirement_name, status: 'FAIL', changeability: 'permanent' }))[0];
    if (firstFail) mainReason = { key: firstFail.key, label: firstFail.label, changeability: firstFail.changeability || 'permanent' };
  }

  return {
    scheme_id: scheme.id,
    name: scheme.name,
    name_hi: scheme.name_hi || scheme.name,
    type: scheme.type || null,
    benefit_max: scheme.max_financial_assistance ?? null,
    // Honest benefit label — a ceiling, never a promise (§51).
    benefit_label_en: scheme.max_financial_assistance ? `Up to ₹${Number(scheme.max_financial_assistance).toLocaleString('en-IN')}` : null,
    official_link: scheme.official_link || null,
    match_score: elig.matchScore,
    eligibility_status: finalStatus,
    readiness_score: readinessScore,
    checks: elig.checks,
    missing,
    already_applied: Boolean(alreadyApplied),
    bucket,
    main_reason: mainReason,
    conflict: { status: conflict.status, severity: conflict.severity, count: conflict.conflicts.length, items: conflict.conflicts },
    claimability,
  };
}

// ---- rank for the homepage (§10) -------------------------------------------
const BUCKET_RANK = { ready: 0, action_required: 1, potential: 2, already_applied: 3, conflict: 4, not_eligible: 5 };

export function evaluateAllSchemes({ schemes, structuredProfile, reqProfile, requirementsBySchemeId, documents, availability, appliedSchemeIds, applications = [] }) {
  const applied = new Set(appliedSchemeIds || []);
  const evaluated = schemes.map((s) =>
    evaluateSchemeForUser(s, structuredProfile, reqProfile, requirementsBySchemeId[s.id] || [], documents, availability, applied.has(s.id), applications));

  evaluated.sort((a, b) => {
    if (BUCKET_RANK[a.bucket] !== BUCKET_RANK[b.bucket]) return BUCKET_RANK[a.bucket] - BUCKET_RANK[b.bucket];
    if (b.match_score !== a.match_score) return b.match_score - a.match_score;
    return (b.readiness_score ?? 0) - (a.readiness_score ?? 0);
  });

  // Maximum potential benefit — a CEILING across the schemes the user could
  // still pursue (ready/action/potential), explicitly not a guaranteed or
  // additive total. Conflict/mutual-exclusion modelling is deferred (§2),
  // so this is labelled as a maximum, never a sum the user will receive.
  const claimable = evaluated.filter((e) => ['ready', 'action_required', 'potential'].includes(e.bucket));
  const maxPotentialBenefit = claimable.reduce((a, e) => a + (e.benefit_max || 0), 0);

  const summary = {
    total_matched: claimable.length,
    ready: evaluated.filter((e) => e.bucket === 'ready').length,
    action_required: evaluated.filter((e) => e.bucket === 'action_required').length,
    potential: evaluated.filter((e) => e.bucket === 'potential').length,
    already_applied: evaluated.filter((e) => e.bucket === 'already_applied').length,
    conflict: evaluated.filter((e) => e.bucket === 'conflict').length,
    not_eligible: evaluated.filter((e) => e.bucket === 'not_eligible').length,
    max_potential_benefit: maxPotentialBenefit,
  };

  return { summary, schemes: evaluated };
}

export const _internal = { checkIncome, checkCategory, checkGender, checkState };
