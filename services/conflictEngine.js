// ============================================================================
// Scheme Conflict Engine — deterministic, rule-driven (§39/§40/§47).
//
// Answers: "Given the schemes this user has already applied for / is receiving,
// does an OFFICIAL rule prevent them from claiming THIS target scheme?"
//
// It NEVER treats a prior application as an automatic conflict (§2/§40) — a
// conflict requires a rule in schemeConflicts.js that matches, AND the existing
// application's status to satisfy that rule's trigger. Rejected/withdrawn
// applications never block (§27/§28). Groq is not consulted for the verdict.
// ============================================================================

import { SCHEME_META, CONFLICT_RULES } from '../data/schemeConflicts.js';

// Map the stored scheme_applications.status (and any richer user-reported
// status) to a canonical state the rules reason about.
const STATUS_MAP = {
  registered: 'SAVED',            // saved in SchemeSetu, not actually applied
  draft: 'SAVED',
  applied: 'SUBMITTED',
  submitted: 'SUBMITTED',
  under_review: 'UNDER_REVIEW',
  approved: 'APPROVED',
  benefit_active: 'BENEFIT_ACTIVE',
  benefit_received: 'BENEFIT_RECEIVED',
  completed: 'COMPLETED',
  rejected: 'REJECTED',
  withdrawn: 'WITHDRAWN',
  cancelled: 'CANCELLED',
  expired: 'EXPIRED',
};
export function canonicalStatus(s) {
  return STATUS_MAP[(s || '').toLowerCase()] || 'UNKNOWN';
}

function groupOf(schemeId) {
  return SCHEME_META[schemeId]?.group || null;
}

// Does a given rule's conflicts_with target this existing scheme?
function ruleMatchesExisting(rule, existingSchemeId, targetSchemeId) {
  if (existingSchemeId === targetSchemeId) return false; // a scheme never conflicts with itself as an "existing" app
  const cw = rule.conflicts_with || {};
  if (cw.scheme_ids) return cw.scheme_ids.includes(existingSchemeId);
  if (cw.group) return groupOf(existingSchemeId) === cw.group;
  return false;
}

// Does a rule guard this target scheme?
function ruleGuardsTarget(rule, targetSchemeId) {
  const t = rule.target || {};
  if (t.scheme_id) return t.scheme_id === targetSchemeId;
  if (t.group) return groupOf(targetSchemeId) === t.group;
  return false;
}

// applications: [{ scheme_id, scheme_name, status, status_source }]
// schemeNameById: optional map for friendly names.
export function evaluateConflicts(targetSchemeId, applications = [], schemeNameById = {}) {
  const conflicts = [];
  const rules = CONFLICT_RULES.filter((r) => ruleGuardsTarget(r, targetSchemeId));

  for (const rule of rules) {
    for (const app of applications) {
      if (!ruleMatchesExisting(rule, app.scheme_id, targetSchemeId)) continue;
      const st = canonicalStatus(app.status);

      let severity = null;
      if (rule.blocking_statuses?.includes(st)) severity = rule.severity_default === 'WARNING' ? 'WARNING' : 'BLOCKING';
      else if (rule.possible_statuses?.includes(st)) severity = 'WARNING';
      else continue; // SAVED / REJECTED / WITHDRAWN / etc. -> no conflict from this app

      // An unverified source can never produce a BLOCKING conflict (§44) — cap it.
      if (rule.verification_status !== 'verified' && severity === 'BLOCKING') severity = 'WARNING';

      conflicts.push({
        rule_id: rule.id,
        existing_scheme_id: app.scheme_id,
        existing_scheme_name: app.scheme_name || schemeNameById[app.scheme_id] || app.scheme_id,
        existing_status: st,
        existing_status_source: app.status_source || 'USER_REPORTED',
        conflict_type: rule.conflict_type,
        trigger: rule.trigger,
        severity,
        description_en: rule.description_en,
        description_hi: rule.description_hi,
        source: { url: rule.source_url, title: rule.source_title, verification_status: rule.verification_status, last_verified_at: rule.last_verified_at },
      });
    }
  }

  const hasBlocking = conflicts.some((c) => c.severity === 'BLOCKING');
  const hasWarning = conflicts.some((c) => c.severity === 'WARNING');
  let status = 'NO_CONFLICT';
  if (hasBlocking) status = 'CONFLICT';
  else if (hasWarning) status = 'POSSIBLE_CONFLICT';

  return {
    status,
    severity: hasBlocking ? 'BLOCKING' : hasWarning ? 'WARNING' : 'NONE',
    conflicts,
  };
}

// ---- claimability (§14) — the single final state combining everything -------
// eligibilityStatus: ELIGIBLE | POTENTIAL | NOT_ELIGIBLE | UNKNOWN
// readinessScore: 0..100 | null ; alreadyApplied: canonical status of the
// user's own application to THIS scheme (or null).
export function computeClaimability({ eligibilityStatus, readinessScore, ownStatus, conflict, deadlineOpen = true }) {
  // A BLOCKING conflict overrides "ready to apply" (§15).
  if (conflict?.status === 'CONFLICT') return { status: 'CONFLICT', reason: 'A verified rule conflicts with a scheme you already have.' };

  if (ownStatus && !['SAVED', 'REJECTED', 'WITHDRAWN', 'CANCELLED'].includes(ownStatus)) {
    if (['APPROVED', 'BENEFIT_ACTIVE', 'BENEFIT_RECEIVED'].includes(ownStatus)) return { status: 'ALREADY_RECEIVING', reason: 'You are already receiving this benefit.' };
    return { status: 'ALREADY_APPLIED', reason: 'You have an application in progress for this scheme.' };
  }

  if (deadlineOpen === false) return { status: 'APPLICATION_CLOSED', reason: 'Applications are currently closed.' };
  if (eligibilityStatus === 'NOT_ELIGIBLE') return { status: 'NOT_ELIGIBLE', reason: 'You do not meet a mandatory eligibility rule.' };
  if (eligibilityStatus === 'UNKNOWN' || eligibilityStatus === 'POTENTIAL') return { status: 'POTENTIALLY_ELIGIBLE', reason: 'More information is needed to confirm eligibility.' };

  // eligible
  if (readinessScore !== null && readinessScore < 100) {
    const base = conflict?.status === 'POSSIBLE_CONFLICT'
      ? { status: 'ELIGIBLE_NOT_READY', reason: 'Eligible, but missing documents — and verify a possible conflict.' }
      : { status: 'ELIGIBLE_NOT_READY', reason: 'You appear eligible but are missing some requirements.' };
    return base;
  }
  if (conflict?.status === 'POSSIBLE_CONFLICT') return { status: 'ELIGIBLE_NOT_READY', reason: 'Eligible and ready, but please verify a possible conflict first.' };
  return { status: 'READY_TO_APPLY', reason: 'You appear eligible and your requirements are ready.' };
}
