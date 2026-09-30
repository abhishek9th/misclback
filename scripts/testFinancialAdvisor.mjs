// Run: node backend/scripts/testFinancialAdvisor.mjs
// Exercises the financial advisor engine on the REAL curated schemes (no DB, no AI).
import assert from 'node:assert/strict';
import { emi, loanCost, principalForEmi, affordability, maxRateForEmi, yearlySchedule } from '../services/advisor/financeMath.js';
import { normalizeSituation, buildAdvice, collectAllowedNumbers } from '../services/advisor/advisorEngine.js';
import { validateNumbers, templateExplanation } from '../services/advisor/advisorExplainer.js';
import { evaluateAllSchemes } from '../services/eligibilityEngine.js';
import { SCHEMES } from '../data/schemes.js';

let pass = 0;
const t = (name, fn) => { try { fn(); pass++; console.log('  ✓', name); } catch (e) { console.error('  ✗', name, '\n   ', e.message); process.exitCode = 1; } };

console.log('Math');
t('EMI ₹1,00,000 @12% for 12 months ≈ ₹8,885', () => assert.equal(Math.round(emi(100000, 12, 12)), 8885));
t('0% loan EMI = principal / months', () => assert.equal(emi(120000, 0, 12), 10000));
t('total interest is repayment − principal', () => { const c = loanCost(100000, 12, 12); assert.equal(c.totalRepayment - 100000, c.totalInterest); });
t('principalForEmi inverts emi', () => assert.ok(Math.abs(principalForEmi(emi(500000, 10, 60), 10, 60) - 500000) <= 2));
t('yearly schedule repays the whole principal', () => { const y = yearlySchedule(300000, 9, 36); assert.equal(y.at(-1).closingBalance, 0); assert.ok(Math.abs(y.reduce((a, r) => a + r.principalPaid, 0) - 300000) <= 3); });
t('maxRateForEmi: null when even 0% does not fit', () => assert.equal(maxRateForEmi(1200000, 12, 50000), null));
t('maxRateForEmi round-trips', () => { const r = maxRateForEmi(500000, 60, 12000); assert.ok(emi(500000, r, 60) <= 12000 && emi(500000, r + 0.2, 60) > 12000); });
t('affordability bands', () => {
  assert.equal(affordability({ monthlyIncome: 50000, monthlyExpenses: 20000, newEmi: 10000 }).status, 'comfortable');
  assert.equal(affordability({ monthlyIncome: 50000, monthlyExpenses: 20000, newEmi: 20000 }).status, 'stretched'); // 40%
  assert.equal(affordability({ monthlyIncome: 50000, monthlyExpenses: 20000, newEmi: 27000 }).status, 'risky'); // 54%
  assert.equal(affordability({ monthlyIncome: 50000, monthlyExpenses: 40000, newEmi: 15000 }).status, 'unaffordable');
});

console.log('Input validation');
const base = { goal: 'new', sector: 'manufacturing', area: 'rural', projectCost: 1000000, ownFunds: 200000, monthlyIncome: 70000, monthlyExpenses: 15000, existingEmi: 0 };
t('rejects missing/garbage amounts', () => {
  assert.throws(() => normalizeSituation({ ...base, projectCost: -5 }), /amount/);
  assert.throws(() => normalizeSituation({ ...base, sector: 'nope' }), /sector/);
  assert.throws(() => normalizeSituation({ ...base, monthlyIncome: 0 }), /amount/);
  assert.throws(() => normalizeSituation({ ...base, quotedRate: 90 }), /between/);
});

const run = (profile, sit) => {
  const situation = normalizeSituation({ ...base, ...sit });
  const structuredProfile = { annual_income: 480000, category: profile.category ?? null, gender: profile.gender ?? null, disability_status: false, state: profile.state ?? null };
  const reqProfile = { age: 30, category: profile.category ?? null, gender: profile.gender ?? null, disability_status: false, occupation_status: null, annual_income: 480000, state: profile.state ?? null, district: null, education_level: null, business_status: 'new' };
  const { schemes } = evaluateAllSchemes({ schemes: SCHEMES, structuredProfile, reqProfile, requirementsBySchemeId: {}, documents: [], availability: [], appliedSchemeIds: [], applications: [] });
  return buildAdvice({ situation, profile: structuredProfile, curatedEvaluated: schemes, curatedSchemes: SCHEMES });
};

console.log('Recommendation logic');
t('picks the scheme with the most government support (PMEGP) and never invents a rate', () => {
  const a = run({ category: 'sc', gender: 'female', state: 'Jharkhand' }, {});
  const r = a.recommended;
  assert.equal(r.scheme_id, 'scheme_pmegp');
  assert.equal(r.funding.grant.pct, 35); // rural + special category
  assert.equal(r.funding.grant.amount, 350000);
  assert.equal(r.funding.ownContributionRequired, 50000); // 5% for special category
  assert.equal(r.funding.loanPrincipal, 950000);
  assert.equal(r.loan.rate, null); // bank sets it → no EMI invented
  assert.equal(r.loan.emi, null);
  assert.ok(r.flags.includes('rate_unknown') && r.flags.includes('grant_back_ended'));
  assert.ok(typeof r.loan.affordableUpToRate === 'number'); // break-even instead of a guess
});
t("user's own bank quote unlocks the EMI", () => {
  const r = run({ category: 'sc', gender: 'female', state: 'Jharkhand' }, { quotedRate: 11 }).recommended;
  assert.equal(r.loan.rate.value, 11);
  assert.ok(r.loan.emi > 0 && r.affordability);
  assert.equal(r.loan.rate.isEstimate, false);
});
t('general-category urban applicant gets the lower PMEGP subsidy and 10% own contribution', () => {
  const r = run({ category: 'general', gender: 'male', state: 'Jharkhand' }, { area: 'urban' }).recommended;
  assert.equal(r.funding.grant.pct, 15);
  assert.equal(r.funding.ownContributionRequired, 100000);
});
t('tiny project is below PMEGP minimum → Mudra Shishu, with an estimated (not official) rate flagged', () => {
  const a = run({ category: 'general', gender: 'male', state: 'Jharkhand' }, { projectCost: 30000, ownFunds: 0, sector: 'services' });
  assert.equal(a.recommended.scheme_id, 'scheme_mudra_shishu');
  assert.ok(a.excluded.some((e) => e.scheme_id === 'scheme_pmegp' && e.why.some((w) => w.code === 'below_minimum_size')));
  assert.ok(a.recommended.flags.includes('rate_estimated'));
});
t('Bihar scheme applies only in Bihar; women get the 0% rate', () => {
  const inBihar = run({ category: 'general', gender: 'female', state: 'Bihar' }, { projectCost: 500000, sector: 'services', area: 'urban' });
  const bihar = [inBihar.recommended, ...inBihar.alternatives].find((p) => p?.scheme_id === 'scheme_bihar_udyam');
  assert.ok(bihar, 'Bihar scheme should be considered');
  assert.equal(bihar.loan.rate.value, 0);
  assert.equal(bihar.funding.grant.amount, 250000);
  assert.equal(bihar.funding.loanPrincipal, 250000);
  const elsewhere = run({ category: 'general', gender: 'female', state: 'Kerala' }, { projectCost: 500000, sector: 'services', area: 'urban' });
  assert.ok(![elsewhere.recommended, ...elsewhere.alternatives, ...elsewhere.blocked].some((p) => p?.scheme_id === 'scheme_bihar_udyam'));
});
t('unaffordable loan is NOT recommended, and the advice says what to change', () => {
  const a = run({ category: 'general', gender: 'male', state: 'Jharkhand' }, { projectCost: 500000, sector: 'services', monthlyIncome: 12000, monthlyExpenses: 9000, ownFunds: 0 });
  assert.equal(a.recommended, null);
  assert.ok(a.adjustments.length > 0);
});
t('shortfall in own funds blocks a scheme instead of hiding it', () => {
  const a = run({ category: 'general', gender: 'male', state: 'Jharkhand' }, { ownFunds: 10000, area: 'urban' });
  const pmegp = a.blocked.find((b) => b.scheme_id === 'scheme_pmegp');
  assert.ok(pmegp && pmegp.funding.ownFundsShortfall === 90000);
});
t('ineligible schemes are excluded with a reason (Stand-Up India is for women/SC/ST)', () => {
  const a = run({ category: 'general', gender: 'male', state: 'Jharkhand' }, { projectCost: 2000000, ownFunds: 400000, monthlyIncome: 150000, monthlyExpenses: 30000 });
  assert.ok(a.excluded.some((e) => e.scheme_id === 'scheme_standup_india'));
});

console.log('Explanation guard');
const advice = run({ category: 'sc', gender: 'female', state: 'Jharkhand' }, { quotedRate: 11 });
const allowed = collectAllowedNumbers(advice);
t('accepts figures the engine computed (incl. lakh/crore phrasing)', () => {
  assert.deepEqual(validateNumbers([`Subsidy of ₹3,50,000 and a loan of ₹9.5 lakh at 11%`], allowed), []);
});
t('rejects a figure the engine never produced', () => {
  assert.ok(validateNumbers(['You will save ₹7,77,777 in interest'], allowed).length > 0);
  assert.ok(validateNumbers(['The rate is 6.5%'], allowed).length > 0);
});
t('template fallback works without the model and quotes only real numbers', () => {
  const ex = templateExplanation(advice, 'en');
  assert.equal(ex.source, 'template');
  assert.deepEqual(validateNumbers([ex.headline, ex.why_this_scheme, ex.plan_walkthrough, ...ex.cautions, ...ex.next_steps], allowed), []);
  const hi = templateExplanation(advice, 'hi');
  assert.ok(hi.headline.length > 0 && hi.plan_walkthrough.length > 0);
});

console.log(`\n${pass} checks passed${process.exitCode ? ' — with FAILURES' : ''}`);
