// ============================================================================
// Application Readiness — requirement engine.
//
// Pure, data-driven evaluator: takes verified scheme_requirements rows (the
// source of truth, curated from official sources — see
// supabase/migrations/20260919_application_readiness.sql) and a user's
// profile snapshot, and decides which requirements APPLY to this specific
// user, and whether each is satisfied. No category/gender/etc. branching is
// hardcoded here — every conditional check is driven by the requirement
// row's own applicable_* columns, so adding/adjusting a scheme's rules never
// requires a code change.
//
// This module NEVER calls an AI model. Groq (see groqExplainer.js) only
// phrases the results this engine has already computed — it cannot alter the
// eligibility verdict, the readiness score, or any risk classification.
// ============================================================================

// ---- applicability -------------------------------------------------------
// A requirement applies to this user only if EVERY non-null/non-empty filter
// on the row matches. Array filters are "one of"; missing user data on a
// filtered field means the requirement is treated as inapplicable (never
// guessed into existence).
export function requirementApplies(req, profile) {
  if (req.applicable_categories?.length) {
    if (!profile.category || !req.applicable_categories.includes(profile.category)) return false;
  }
  if (req.applicable_gender?.length) {
    if (!profile.gender || !req.applicable_gender.includes(profile.gender)) return false;
  }
  if (req.applicable_disability_status !== null && req.applicable_disability_status !== undefined) {
    if (Boolean(profile.disability_status) !== Boolean(req.applicable_disability_status)) return false;
  }
  if (req.applicable_occupation?.length) {
    if (!profile.occupation_status || !req.applicable_occupation.includes(profile.occupation_status)) return false;
  }
  // NOTE: applicable_age_min/max are purely APPLICABILITY filters — "does this
  // requirement apply to someone of this age" (e.g. an age-relaxation rule
  // that only concerns applicants already at/above some age). They must NOT
  // be used as the eligibility threshold itself (see requirement_key
  // 'min_age', which stores its own pass/fail threshold in `condition.min_age`
  // and is evaluated in evaluateNonDocumentRequirement instead) — conflating
  // the two would hide a failing age-eligibility check as "not applicable"
  // rather than surfacing it as NOT_ELIGIBLE.
  if (req.applicable_age_min !== null && req.applicable_age_min !== undefined) {
    if (profile.age === null || profile.age === undefined || profile.age < req.applicable_age_min) return false;
  }
  if (req.applicable_age_max !== null && req.applicable_age_max !== undefined) {
    if (profile.age !== null && profile.age !== undefined && profile.age > req.applicable_age_max) return false;
  }
  return true;
}

// ---- document status -------------------------------------------------------
const DOC_STATUSES = ['READY', 'MISSING', 'UPLOADED', 'VERIFICATION_REQUIRED', 'EXPIRED', 'NOT_APPLICABLE', 'CONDITIONAL', 'UNKNOWN', 'ALTERNATIVE_SATISFIED'];

// A single document key's raw availability (READY / VERIFICATION_REQUIRED /
// EXPIRED / MISSING), keyed by document_type across the vault + availability.
function rawDocStatus(key, documentsByType, availabilityByType) {
  const doc = documentsByType.get(key);
  const avail = availabilityByType.get(key);
  if (doc) {
    if (doc.expiry_date && new Date(doc.expiry_date) < new Date()) return 'EXPIRED';
    if (doc.verification_status === 'verified') return 'READY';
    if (doc.verification_status === 'rejected') return 'MISSING';
    return 'VERIFICATION_REQUIRED';
  }
  if (avail) {
    if (avail.status === 'available_physical' || avail.status === 'available_online' || avail.status === 'verified') return 'READY';
    if (avail.status === 'expired') return 'EXPIRED';
    if (avail.status === 'missing') return 'MISSING';
  }
  return 'MISSING';
}

// Resolve a document requirement, honouring alternative-document groups (§7):
// the requirement is SATISFIED if its own key OR any accepted alternative is
// available. Returns { status, satisfied, satisfied_by }.
function resolveDocumentStatus(req, documentsByType, availabilityByType) {
  const primary = rawDocStatus(req.requirement_key, documentsByType, availabilityByType);
  if (primary === 'READY') return { status: 'READY', satisfied: true, satisfied_by: null };
  if (primary === 'VERIFICATION_REQUIRED') return { status: 'VERIFICATION_REQUIRED', satisfied: false, satisfied_by: null };
  if (primary === 'EXPIRED') return { status: 'EXPIRED', satisfied: false, satisfied_by: null };

  const alternatives = req.condition?.alternatives || [];
  for (const alt of alternatives) {
    if (rawDocStatus(alt.key || alt, documentsByType, availabilityByType) === 'READY') {
      return { status: 'ALTERNATIVE_SATISFIED', satisfied: true, satisfied_by: alt.name || alt.key || alt };
    }
  }
  return { status: 'MISSING', satisfied: false, satisfied_by: null };
}

// ---- conditional applicability (§6/§10) ------------------------------------
// A requirement can carry condition.applies_when = { field, in:[...] }. It only
// applies when the user's value for `field` is one of the listed values. If we
// DON'T KNOW the field's value, the requirement is CONDITIONAL (we ask), never
// silently dropped and never a failure.
function evaluateCondition(req, profile) {
  const cond = req.condition?.applies_when;
  if (!cond || !cond.field) return { state: 'APPLIES' };
  const val = profile[cond.field];
  if (val === null || val === undefined || val === '') {
    return { state: 'UNKNOWN', question: req.condition?.question || null, field: cond.field, options: cond.options || null };
  }
  const wanted = cond.in || (cond.equals !== undefined ? [cond.equals] : []);
  return wanted.includes(val)
    ? { state: 'APPLIES' }
    : { state: 'NOT_APPLICABLE', reason: req.condition?.not_applicable_reason || null };
}

// ---- the main evaluation ---------------------------------------------------
export function evaluateRequirements(schemeRequirements, profile, documents = [], availability = []) {
  const documentsByType = new Map();
  for (const d of documents) {
    const existing = documentsByType.get(d.document_type);
    if (!existing || new Date(d.uploaded_at) > new Date(existing.uploaded_at)) {
      documentsByType.set(d.document_type, d);
    }
  }
  const availabilityByType = new Map(availability.map((a) => [a.document_type, a]));

  const results = [];
  for (const req of schemeRequirements) {
    // 1. Profile-filter applicability (category/gender/age/etc.).
    if (!requirementApplies(req, profile)) {
      results.push({ ...baseResult(req), applies: false, status: 'NOT_APPLICABLE', not_applicable_reason: 'Does not apply to your profile' });
      continue;
    }

    // 2. Conditional applicability (premises owned/rented, new/existing, etc.).
    const cond = evaluateCondition(req, profile);
    if (cond.state === 'NOT_APPLICABLE') {
      results.push({ ...baseResult(req), applies: false, status: 'NOT_APPLICABLE', not_applicable_reason: cond.reason });
      continue;
    }
    if (cond.state === 'UNKNOWN') {
      results.push({ ...baseResult(req), applies: true, status: 'CONDITIONAL', satisfied: false, condition_question: cond.question, condition_field: cond.field, condition_options: cond.options });
      continue;
    }

    // 3. Satisfaction — documents vs profile-information.
    let status; let satisfied; let satisfied_by = null;
    if (isDocumentLike(req)) {
      const r = resolveDocumentStatus(req, documentsByType, availabilityByType);
      status = r.status; satisfied = r.satisfied; satisfied_by = r.satisfied_by;
    } else {
      const check = evaluateNonDocumentRequirement(req, profile);
      status = check.status; satisfied = check.satisfied;
    }

    results.push({ ...baseResult(req), applies: true, status, satisfied, satisfied_by });
  }
  return results;
}

// Document-type requirements (things the user HOLDS), vs profile-information /
// eligibility requirements (things the user IS/STATES). Anything not a pure
// eligibility/profile/application field is treated as a document.
const NON_DOCUMENT_TYPES = ['eligibility', 'personal_information', 'application_specific'];
function isDocumentLike(req) {
  return !NON_DOCUMENT_TYPES.includes(req.requirement_type) && !!req.requirement_key;
}

function baseResult(req) {
  const alts = req.condition?.alternatives || [];
  return {
    requirement_key: req.requirement_key,
    requirement_name: req.requirement_name,
    description: req.description,
    requirement_type: req.requirement_type,
    required: req.required,
    priority: req.priority,
    delay_risk: req.delay_risk,
    rejection_risk: req.rejection_risk,
    source_name: req.source_name,
    source_url: req.source_url,
    source_type: req.source_type,
    source_last_verified: req.source_last_verified,
    // UI-facing structured metadata (encoded in the condition JSONB).
    category: req.condition?.category || defaultCategory(req.requirement_type),
    mandatory: req.required,
    accepted_alternatives: alts.map((a) => a.name || a.key || a),
  };
}

// UI grouping fallback when a requirement doesn't declare condition.category.
function defaultCategory(type) {
  return {
    identity: 'Identity', address: 'Address & Premises', bank: 'Financial',
    financial_information: 'Financial', project_information: 'Project', education: 'Education',
    personal_information: 'Profile Information', category_specific: 'Category & Eligibility',
    disability_specific: 'Category & Eligibility', gender_specific: 'Category & Eligibility',
    eligibility: 'Eligibility', document: 'Documents', application_specific: 'Application',
  }[type] || 'Other';
}

// Deterministic checks for non-document requirement types. Anything this
// function can't determine from the given profile fields returns UNKNOWN —
// it never guesses, and the explanation layer must say so verbatim.
function evaluateNonDocumentRequirement(req, profile) {
  // Generic profile-information check: the requirement declares which profile
  // field satisfies it (condition.profile_field). Present -> READY, else MISSING;
  // absent field name -> UNKNOWN (we don't guess).
  const pf = req.condition?.profile_field;
  if (pf) {
    const v = profile[pf];
    const present = v !== null && v !== undefined && v !== '';
    return { status: present ? 'READY' : 'MISSING', satisfied: present };
  }
  switch (req.requirement_key) {
    case 'min_age': {
      if (profile.age === null || profile.age === undefined) return { status: 'UNKNOWN', satisfied: false };
      // Threshold lives in `condition.min_age`, NOT applicable_age_min (that
      // column is an applicability filter for other requirements — see
      // requirementApplies() above).
      const threshold = req.condition?.min_age ?? 18;
      const ok = profile.age >= threshold;
      return { status: ok ? 'READY' : 'MISSING', satisfied: ok };
    }
    case 'age_relaxation_category':
    case 'age_relaxation_gender':
    case 'age_relaxation_disability':
      // requirementApplies() already matched the qualifying attribute AND the
      // relaxed age ceiling — reaching here means the relaxation is satisfied.
      return { status: 'READY', satisfied: true };
    case 'business_new':
      if (profile.business_status === undefined || profile.business_status === null) return { status: 'UNKNOWN', satisfied: false };
      return { status: profile.business_status === 'new' ? 'READY' : 'MISSING', satisfied: profile.business_status === 'new' };
    case 'min_education':
      if (!profile.education_level) return { status: 'UNKNOWN', satisfied: false };
      return { status: 'READY', satisfied: true }; // presence of any recorded education level; fine-grained level comparison needs richer scheme data
    default:
      // Generic financial/personal-information fallback: present -> READY.
      if (req.requirement_type === 'financial_information') {
        return { status: profile.annual_income !== null && profile.annual_income !== undefined ? 'READY' : 'MISSING', satisfied: profile.annual_income !== null && profile.annual_income !== undefined };
      }
      return { status: 'UNKNOWN', satisfied: false };
  }
}

// ---- eligibility vs readiness (kept strictly separate, per spec) ---------
export function computeEligibility(results) {
  const eligibilityChecks = results.filter((r) => r.applies && r.requirement_type === 'eligibility' && r.required);
  if (eligibilityChecks.length === 0) return { status: 'UNKNOWN', failedChecks: [] };
  const failed = eligibilityChecks.filter((r) => r.status === 'MISSING');
  const unknown = eligibilityChecks.filter((r) => r.status === 'UNKNOWN');
  if (failed.length > 0) return { status: 'NOT_ELIGIBLE', failedChecks: failed };
  if (unknown.length > 0) return { status: 'UNKNOWN', failedChecks: unknown };
  return { status: 'ELIGIBLE', failedChecks: [] };
}

const SATISFIED_STATUSES = new Set(['READY', 'UPLOADED', 'ALTERNATIVE_SATISFIED']);

// Application readiness (§15) — kept separate from eligibility. Denominator is
// the requirements we KNOW apply and can evaluate; CONDITIONAL items (we don't
// yet know if they apply, e.g. premises owned/rented) are excluded from the
// score and surfaced separately, so readiness never collapses just because a
// conditional question is unanswered. NOT_APPLICABLE items are excluded too.
export function computeReadinessScore(results) {
  const scored = results.filter((r) => r.applies && r.status !== 'CONDITIONAL');
  const conditional = results.filter((r) => r.status === 'CONDITIONAL');
  const notApplicable = results.filter((r) => !r.applies);
  const weight = (p) => Math.max(1, 6 - (p || 3));
  let total = 0;
  let earned = 0;
  const ready = [];
  const missing = [];
  for (const r of scored) {
    const w = weight(r.priority);
    total += w;
    if (SATISFIED_STATUSES.has(r.status)) { earned += w; ready.push(r); } else { missing.push(r); }
  }
  const score = total > 0 ? Math.round((earned / total) * 100) : 0;
  return {
    score, ready, missing, conditional, not_applicable: notApplicable,
    applicable_count: scored.length, satisfied_count: ready.length, missing_count: missing.length,
  };
}

export function classifyMissingByPriority(missing) {
  const buckets = { CRITICAL: [], HIGH: [], MEDIUM: [], LOW: [] };
  for (const r of missing) {
    const bucket = r.delay_risk && buckets[r.delay_risk] ? r.delay_risk : 'MEDIUM';
    buckets[bucket].push(r);
  }
  return buckets;
}

export const _internal = { DOC_STATUSES };
