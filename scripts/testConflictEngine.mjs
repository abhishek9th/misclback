// Deterministic tests for the conflict engine (§41). Run: node backend/scripts/testConflictEngine.mjs
import { evaluateConflicts, computeClaimability } from '../services/conflictEngine.js';

let pass = 0, fail = 0;
function check(name, got, want) {
  const ok = got === want;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  (got ${got}${ok ? '' : `, want ${want}`})`);
  ok ? pass++ : fail++;
}

// CASE 1 — nothing applied → no conflict
check('C1 no applications', evaluateConflicts('scheme_pm_vishwakarma', []).status, 'NO_CONFLICT');

// CASE 2 — received PMEGP, target PM Vishwakarma (verified prior-beneficiary rule) → BLOCKING
check('C2 PMEGP received blocks PM Vishwakarma',
  evaluateConflicts('scheme_pm_vishwakarma', [{ scheme_id: 'scheme_pmegp', status: 'approved' }]).status, 'CONFLICT');

// CASE 3 — applied to an unrelated scheme (no rule) → no conflict
check('C3 unrelated application',
  evaluateConflicts('scheme_pm_vishwakarma', [{ scheme_id: 'scheme_vidya_lakshmi', status: 'approved' }]).status, 'NO_CONFLICT');

// CASE 4 — receiving another scholarship, target scholarship → BLOCKING (group rule, but source unverified → capped to WARNING → POSSIBLE)
check('C4 scholarship group (unverified source capped to possible)',
  evaluateConflicts('scheme_csss_scholarship', [{ scheme_id: 'scheme_post_matric_scholarship', status: 'approved' }]).status, 'POSSIBLE_CONFLICT');

// CASE 5 — PMEGP application REJECTED, target PM Vishwakarma → no active benefit → no conflict
check('C5 rejected does not block',
  evaluateConflicts('scheme_pm_vishwakarma', [{ scheme_id: 'scheme_pmegp', status: 'rejected' }]).status, 'NO_CONFLICT');

// CASE 6 — PMEGP WITHDRAWN, target PM Vishwakarma → no conflict
check('C6 withdrawn does not block',
  evaluateConflicts('scheme_pm_vishwakarma', [{ scheme_id: 'scheme_pmegp', status: 'withdrawn' }]).status, 'NO_CONFLICT');

// CASE 7 — PMEGP only SUBMITTED (not yet received), target PM Vishwakarma rule is PREVIOUSLY_RECEIVED → possible
check('C7 submitted-only is possible not blocking',
  evaluateConflicts('scheme_pm_vishwakarma', [{ scheme_id: 'scheme_pmegp', status: 'applied' }]).status, 'POSSIBLE_CONFLICT');

// CASE 8 — multiple existing schemes → all relevant conflicts returned
const multi = evaluateConflicts('scheme_pm_vishwakarma', [
  { scheme_id: 'scheme_pmegp', status: 'approved' },
  { scheme_id: 'scheme_mudra_kishore', status: 'approved' },
  { scheme_id: 'scheme_vidya_lakshmi', status: 'approved' },
]);
check('C8 multiple conflicts count', String(multi.conflicts.length), '2');

// CASE 9 — 'registered' (saved, not applied) never conflicts
check('C9 saved/registered no conflict',
  evaluateConflicts('scheme_pm_vishwakarma', [{ scheme_id: 'scheme_pmegp', status: 'registered' }]).status, 'NO_CONFLICT');

// CLAIMABILITY — blocking conflict overrides ready (§15)
check('CL1 blocking conflict overrides ready',
  computeClaimability({ eligibilityStatus: 'ELIGIBLE', readinessScore: 100, ownStatus: null, conflict: { status: 'CONFLICT' } }).status, 'CONFLICT');
check('CL2 eligible+ready+no conflict → READY_TO_APPLY',
  computeClaimability({ eligibilityStatus: 'ELIGIBLE', readinessScore: 100, ownStatus: null, conflict: { status: 'NO_CONFLICT' } }).status, 'READY_TO_APPLY');
check('CL3 eligible missing docs → ELIGIBLE_NOT_READY',
  computeClaimability({ eligibilityStatus: 'ELIGIBLE', readinessScore: 40, ownStatus: null, conflict: { status: 'NO_CONFLICT' } }).status, 'ELIGIBLE_NOT_READY');
check('CL4 own approved → ALREADY_RECEIVING',
  computeClaimability({ eligibilityStatus: 'ELIGIBLE', readinessScore: 100, ownStatus: 'APPROVED', conflict: { status: 'NO_CONFLICT' } }).status, 'ALREADY_RECEIVING');
check('CL5 own submitted → ALREADY_APPLIED',
  computeClaimability({ eligibilityStatus: 'ELIGIBLE', readinessScore: 100, ownStatus: 'SUBMITTED', conflict: { status: 'NO_CONFLICT' } }).status, 'ALREADY_APPLIED');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
