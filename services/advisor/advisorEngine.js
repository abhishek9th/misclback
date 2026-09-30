// ============================================================================
// Financial Advisory engine — eligibility gate → funding/loan calculation →
// optimisation → ONE recommendation. Pure & deterministic (no I/O, no AI): the
// route feeds it data, the explainer only puts its output into words.
//
// HONESTY RULES (the reasons this is not "an AI guessing"):
//  • Only VERIFIED curated schemes can be the recommendation. Catalogue schemes
//    (AI-extracted terms) are listed as "options to check", never recommended.
//  • Nothing is invented: unknown rate → no EMI (never a made-up rate); the
//    user's own bank quote is the only way an "unspecified" rate gets a number.
//  • Affordability uses CURRENT income only — projected business income is never
//    assumed.
//  • Back-ended subsidies are not netted from the EMI (conservative).
// ============================================================================
import { loanCost, yearlySchedule, principalForEmi, affordability, maxRateForEmi } from './financeMath.js';
import { CURATED_TERMS, ENABLERS, resolveTerms, pickRate, catalogueTerms } from './schemeTerms.js';

export const SECTORS = ['manufacturing', 'services', 'retail_trading', 'food_processing', 'handicrafts', 'agriculture_allied', 'transport', 'tech_it', 'healthcare', 'tourism'];
const MAX_MONEY = 1e9;

function invalid(field, message) {
  const e = new Error(message);
  e.code = 'INVALID_INPUT'; e.field = field;
  return e;
}

// Validates + normalises the user's own description of their situation.
export function normalizeSituation(raw = {}) {
  const money = (key, { required = false, min = 0 } = {}) => {
    const v = raw[key];
    if (v === undefined || v === null || v === '') {
      if (required) throw invalid(key, `Please enter ${key}`);
      return 0;
    }
    const n = Number(v);
    if (!Number.isFinite(n) || n < min || n > MAX_MONEY) throw invalid(key, `${key} is not a valid amount`);
    return Math.round(n);
  };
  const goal = raw.goal === 'existing' ? 'existing' : 'new';
  const sector = SECTORS.includes(raw.sector) ? raw.sector : null;
  if (!sector) throw invalid('sector', 'Please choose your business sector');
  const area = raw.area === 'rural' ? 'rural' : 'urban';
  const projectCost = money('projectCost', { required: true, min: 1 });
  const tenureMonths = raw.tenureMonths ? Math.round(Number(raw.tenureMonths)) : null;
  if (tenureMonths !== null && (!Number.isFinite(tenureMonths) || tenureMonths < 6 || tenureMonths > 180)) throw invalid('tenureMonths', 'Repayment period must be 6–180 months');
  const quotedRate = raw.quotedRate === '' || raw.quotedRate == null ? null : Number(raw.quotedRate);
  if (quotedRate !== null && (!Number.isFinite(quotedRate) || quotedRate < 0 || quotedRate > 40)) throw invalid('quotedRate', 'Interest rate must be between 0% and 40%');
  const s = {
    goal, sector, area, projectCost,
    ownFunds: money('ownFunds'),
    monthlyIncome: money('monthlyIncome', { required: true, min: 1 }),
    monthlyExpenses: money('monthlyExpenses'),
    existingEmi: money('existingEmi'),
    tenureMonths, quotedRate,
  };
  if (s.monthlyExpenses + s.existingEmi > s.monthlyIncome * 3) throw invalid('monthlyExpenses', 'Expenses look far higher than income — please re-check the amounts');
  return s;
}

const fmt = (n) => `₹${Math.round(n).toLocaleString('en-IN')}`;

// ---- one scheme → one fully worked plan ------------------------------------
function workPlan({ terms, situation, profile }) {
  const { projectCost: cost, ownFunds } = situation;
  const flags = [];
  const covered = terms.sizeMax ? Math.min(cost, terms.sizeMax) : cost;
  const uncoveredExcess = Math.max(0, cost - covered);
  if (uncoveredExcess > 0) flags.push('partial_cover');

  // Government grant / subsidy
  let grant = null;
  if (terms.grant) {
    let amount = null;
    if (terms.grant.kind === 'flat') amount = terms.grant.amount;
    else if (terms.grant.pct != null) {
      amount = (covered * terms.grant.pct) / 100;
      if (terms.grant.cap != null) amount = Math.min(amount, terms.grant.cap);
    }
    if (amount != null) {
      grant = { amount: Math.round(amount), pct: terms.grant.pct, timing: terms.grant.timing, isCeiling: terms.grant.isCeiling };
      if (terms.grant.timing === 'back_ended') flags.push('grant_back_ended');
      if (terms.grant.timing === 'in_kind') flags.push('grant_in_kind');
      if (terms.grant.timing === 'unspecified') flags.push('grant_timing_unknown');
      if (terms.grant.isCeiling) flags.push('grant_is_ceiling');
    }
  }
  const grantUpfront = grant && grant.timing === 'upfront' ? grant.amount : 0;

  const ownRequired = terms.ownContributionPct != null ? Math.round((covered * terms.ownContributionPct) / 100) : null;
  const loanPrincipal = Math.max(0, covered - (ownRequired || 0) - grantUpfront);

  // What the USER must fund from their own pocket: the required contribution
  // plus anything above the scheme's size cap.
  const ownNeeded = (ownRequired || 0) + uncoveredExcess;
  const shortfall = Math.max(0, ownNeeded - ownFunds);
  const surplusOwnFunds = Math.max(0, ownFunds - ownNeeded);
  if (shortfall > 0) flags.push('own_funds_shortfall');
  if (terms.ownContributionPct == null && terms.fundingType !== 'grant') flags.push('own_contribution_unspecified');

  // Rate & tenure
  const rate = pickRate(terms.rate, { gender: profile.gender, quotedRate: situation.quotedRate });
  let tenure = situation.tenureMonths ?? terms.tenureDefault ?? 60;
  let tenureAssumed = situation.tenureMonths == null;
  if (terms.tenureMin && tenure < terms.tenureMin) tenure = terms.tenureMin;
  if (terms.tenureMax && tenure > terms.tenureMax) tenure = terms.tenureMax;
  if (tenureAssumed) flags.push('tenure_assumed');

  let loan = null, aff = null, schedule = null, maxAffordableLoan = null;
  if (loanPrincipal > 0) {
    if (rate) {
      const c = loanCost(loanPrincipal, rate.value, tenure);
      loan = { principal: loanPrincipal, rate, tenureMonths: tenure, tenureAssumed, ...c };
      schedule = yearlySchedule(loanPrincipal, rate.value, tenure);
      aff = affordability({ monthlyIncome: situation.monthlyIncome, monthlyExpenses: situation.monthlyExpenses, existingEmi: situation.existingEmi, newEmi: c.emi });
      maxAffordableLoan = principalForEmi(aff.maxComfortableEmi, rate.value, tenure);
      if (rate.isEstimate) flags.push('rate_estimated');
    } else {
      const cap = affordability({ monthlyIncome: situation.monthlyIncome, monthlyExpenses: situation.monthlyExpenses, existingEmi: situation.existingEmi, newEmi: 0 }).maxComfortableEmi;
      loan = {
        principal: loanPrincipal, rate: null, tenureMonths: tenure, tenureAssumed, emi: null, totalRepayment: null, totalInterest: null,
        // Never guess the bank's rate; instead say how high it could go before the EMI stops being comfortable.
        affordableUpToRate: maxRateForEmi(loanPrincipal, tenure, cap),
        comfortableEmiLimit: cap,
      };
      flags.push('rate_unknown');
    }
  }
  if (terms.verifyWithBank?.length) flags.push('verify_terms');

  const governmentBenefit = grant ? grant.amount : 0;
  return {
    funding: {
      projectCost: cost,
      coveredByScheme: covered,
      uncoveredExcess,
      ownContributionPct: terms.ownContributionPct,
      ownContributionRequired: ownRequired,
      ownFundsAvailable: ownFunds,
      ownFundsNeeded: ownNeeded,
      ownFundsShortfall: shortfall,
      surplusOwnFunds,
      grant,
      loanPrincipal,
    },
    loan, affordability: aff, yearlySchedule: schedule, maxAffordableLoan,
    governmentBenefit,
    netInterestCost: loan?.totalInterest ?? null,
    flags,
  };
}

// ---- orchestration -----------------------------------------------------------
// curatedEvaluated: evaluateAllSchemes().schemes ; curatedSchemes: SCHEMES ;
// catalogueRows: myscheme_catalogue loan rows already matched to this user.
export function buildAdvice({ situation, profile, curatedEvaluated, curatedSchemes, catalogueRows = [] }) {
  const evById = new Map(curatedEvaluated.map((e) => [e.scheme_id, e]));
  const schemeById = new Map(curatedSchemes.map((s) => [s.id, s]));
  const goalStatuses = situation.goal === 'new' ? ['new'] : ['existing', 'expansion'];
  const ctx = { sector: situation.sector, area: situation.area, profile };

  const considered = [];
  for (const [schemeId] of Object.entries(CURATED_TERMS)) {
    const scheme = schemeById.get(schemeId), ev = evById.get(schemeId);
    if (!scheme || !ev) continue;
    const terms = resolveTerms(schemeId, ctx);
    const base = {
      scheme_id: schemeId, name: scheme.name, name_hi: scheme.name_hi || scheme.name, official_link: scheme.official_link || null,
      verified: true, eligibility_status: ev.eligibility_status, readiness_score: ev.readiness_score,
      missing_documents: (ev.missing || []).map((m) => m.name), conflict: ev.conflict?.status === 'CONFLICT',
      verify_with_bank: terms.verifyWithBank, note: terms.note, term_sources: terms.sources,
    };

    const why = [];
    if (ev.bucket === 'not_eligible') why.push({ code: 'not_eligible', detail: ev.main_reason?.label || null });
    if (ev.conflict?.status === 'CONFLICT') why.push({ code: 'conflicts_with_your_applications' });
    if (Array.isArray(scheme.fields) && !scheme.fields.includes(situation.sector)) why.push({ code: 'sector_not_covered' });
    if (Array.isArray(scheme.business_status) && !scheme.business_status.some((b) => goalStatuses.includes(b))) why.push({ code: situation.goal === 'new' ? 'only_for_existing_businesses' : 'only_for_new_businesses' });
    if (terms.sizeMin && situation.projectCost < terms.sizeMin) why.push({ code: 'below_minimum_size', detail: terms.sizeMin });
    if (why.length) { considered.push({ ...base, status: 'excluded', why }); continue; }

    const plan = workPlan({ terms, situation, profile });
    // Eligibility we could not fully confirm: missing profile details, or a
    // precondition only the applicant can vouch for (e.g. being a listed artisan).
    const uncertain = ev.eligibility_status === 'POTENTIAL' || Boolean(terms.selfConfirm);
    if (ev.eligibility_status === 'POTENTIAL') plan.flags.push('eligibility_unconfirmed');
    if (terms.selfConfirm) plan.flags.push(terms.selfConfirm);
    const problems = [];
    if (plan.funding.ownFundsShortfall > 0) problems.push({ code: 'own_funds_short', detail: plan.funding.ownFundsShortfall });
    if (plan.affordability && ['risky', 'unaffordable'].includes(plan.affordability.status)) problems.push({ code: `emi_${plan.affordability.status}`, detail: plan.affordability.foirPct });
    if (plan.loan && !plan.loan.rate && plan.loan.affordableUpToRate === null) problems.push({ code: 'emi_too_high_any_rate', detail: plan.loan.comfortableEmiLimit });
    considered.push({
      ...base, ...plan,
      eligibility_uncertain: uncertain,
      status: problems.length ? 'blocked' : 'feasible', problems,
    });
  }

  // ---- optimisation: most government support you qualify for AND can afford --
  // Order: (1) schemes you clearly qualify for beat ones whose eligibility we
  // could not confirm; (2) most government support; (3) lowest interest cost
  // where both are known; (4) document readiness.
  const feasible = considered.filter((c) => c.status === 'feasible').sort((a, b) => {
    if ((a.eligibility_uncertain ? 1 : 0) !== (b.eligibility_uncertain ? 1 : 0)) return a.eligibility_uncertain ? 1 : -1;
    if (b.governmentBenefit !== a.governmentBenefit) return b.governmentBenefit - a.governmentBenefit;
    const ai = a.netInterestCost, bi = b.netInterestCost;
    if (ai !== null && bi !== null && ai !== bi) return ai - bi;
    return (b.readiness_score ?? 0) - (a.readiness_score ?? 0);
  });

  const recommended = feasible[0] || null;
  if (recommended) {
    recommended.status = 'recommended';
    feasible.slice(1).forEach((f, i) => {
      f.status = 'alternative';
      f.whyNotTop = f.governmentBenefit < recommended.governmentBenefit ? 'lower_government_support'
        : (f.netInterestCost !== null && recommended.netInterestCost !== null && f.netInterestCost > recommended.netInterestCost) ? 'higher_interest_cost'
        : 'lower_ranked';
      f.rank = i + 2;
    });
    recommended.rank = 1;
  }

  const enablers = recommended && recommended.funding.loanPrincipal > 0
    ? Object.entries(ENABLERS).filter(([id]) => (evById.get(id)?.bucket || 'x') !== 'not_eligible').map(([id, t]) => ({ scheme_id: id, name: schemeById.get(id)?.name || id, name_hi: schemeById.get(id)?.name_hi || schemeById.get(id)?.name || id, text: t.en, text_hi: t.hi }))
    : [];

  // ---- catalogue options (unverified, never recommended) --------------------
  const cost = situation.projectCost;
  const NOT_A_LOAN = /deposit|savings|pension|insurance|scholarship|annuity|bond|RD|PPF/i;
  const possible = catalogueRows.filter((row) => !NOT_A_LOAN.test(row.name || '') && Number(row.loan_amount_max) > 0).map((row) => {
    const t = catalogueTerms(row);
    const fits = (!t.sizeMax || cost <= t.sizeMax) && (!t.sizeMin || cost >= t.sizeMin);
    const principal = Math.min(cost, t.sizeMax || cost);
    const rate = pickRate(t.rate, { gender: profile.gender, quotedRate: situation.quotedRate });
    let tenure = situation.tenureMonths ?? 60;
    if (t.tenureMin && tenure < t.tenureMin) tenure = t.tenureMin;
    if (t.tenureMax && tenure > t.tenureMax) tenure = t.tenureMax;
    const c = rate && principal > 0 ? loanCost(principal, rate.value, tenure) : null;
    return {
      slug: row.slug, name: row.name, verified: false,
      official_link: `https://www.myscheme.gov.in/schemes/${row.slug}`,
      states: row.states || [],
      loan_min: t.sizeMin, loan_max: t.sizeMax,
      fits_your_project: fits,
      rate: rate ? { label: rate.label, labelHi: rate.labelHi, isEstimate: rate.isEstimate } : null,
      indicative_emi: c ? c.emi : null, tenureMonths: c ? tenure : null,
    };
  })
    .filter((p) => p.fits_your_project)
    .sort((a, b) => (b.rate ? 1 : 0) - (a.rate ? 1 : 0) || (a.indicative_emi ?? Infinity) - (b.indicative_emi ?? Infinity))
    .slice(0, 5);

  // ---- when nothing is feasible: say exactly what would change that ---------
  let adjustments = null;
  if (!recommended) {
    const blocked = considered.filter((c) => c.status === 'blocked');
    adjustments = blocked.map((b) => ({
      scheme_id: b.scheme_id, name: b.name,
      problems: b.problems,
      needs_more_own_funds: b.funding.ownFundsShortfall || 0,
      max_affordable_loan: b.maxAffordableLoan,
    }));
  }

  const assumptions = ['income_not_projected', 'terms_can_change', 'lender_decides_final'];
  // (tenure_assumed / rate_estimated are already shown as per-plan flags — not repeated here.)

  return {
    situation,
    recommended,
    alternatives: feasible.slice(1, 4),
    blocked: considered.filter((c) => c.status === 'blocked'),
    excluded: considered.filter((c) => c.status === 'excluded'),
    possible_catalogue_options: possible,
    enablers,
    adjustments,
    assumptions,
  };
}

// Every number the explainer may legitimately quote (used to reject any figure
// a language model adds that the engine did not compute).
export function collectAllowedNumbers(advice) {
  const out = new Set();
  const walk = (v) => {
    if (typeof v === 'number' && Number.isFinite(v)) out.add(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk({ recommended: advice.recommended, alternatives: advice.alternatives, blocked: advice.blocked, adjustments: advice.adjustments, situation: advice.situation });
  // Exact ratios of computed figures (loan share, own share, grant share of the
  // project) are legitimate to quote, so allow them — nothing else is derived.
  for (const p of [advice.recommended, ...advice.alternatives]) {
    const f = p?.funding;
    if (!f?.projectCost) continue;
    for (const part of [f.loanPrincipal, f.ownFundsNeeded, f.ownContributionRequired, f.grant?.amount, f.coveredByScheme]) {
      if (Number.isFinite(part)) { const pct = (part / f.projectCost) * 100; out.add(Math.round(pct)); out.add(Math.round(pct * 10) / 10); }
    }
  }
  return out;
}

export const _fmt = fmt;
