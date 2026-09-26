// Deterministic tests for the loan/EMI calculator (see src/utils/loanCalculator.js).
// Run: node backend/scripts/testLoanCalculator.mjs
import { resolveRate, calculateEmi, loanDetailsFromScheme } from '../../src/utils/loanCalculator.js';

let pass = 0, fail = 0;
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  (got ${JSON.stringify(got)}${ok ? '' : `, want ${JSON.stringify(want)}`})`);
  ok ? pass++ : fail++;
}

// CASE 1 — Fixed 8% interest, 3-year tenure (36 months) on Rs 2,00,000
{
  const rateInfo = resolveRate({ rateType: 'official_fixed', interestRate: 8 });
  check('C1 rate resolved as official fixed', { rate: rateInfo.rate, estimate: rateInfo.rateIsEstimate }, { rate: 8, estimate: false });
  const emi = calculateEmi(200000, rateInfo.rate, 36);
  // Known reducing-balance EMI for 2,00,000 @ 8% / 36mo ≈ 6267/mo
  check('C1 EMI ≈ 6267', emi.emi, 6267);
}

// CASE 2 — Interest range 7%-9% → midpoint is an ESTIMATE, never claimed as typical
{
  const rateInfo = resolveRate({ rateType: 'official_range', interestRateMin: 7, interestRateMax: 9 });
  check('C2 midpoint estimate', { rate: rateInfo.rate, estimate: rateInfo.rateIsEstimate }, { rate: 8, estimate: true });
  check('C2 note mentions range, not "most people"', /most people/i.test(rateInfo.note), false);
}

// CASE 3 — Multiple lender rates: mode computed only when data supports "typical"
{
  const majority = resolveRate({ rateType: 'lender_specific', lenderSpecificRates: [{ lender: 'A', rate: 8 }, { lender: 'B', rate: 8 }, { lender: 'C', rate: 8.5 }] });
  check('C3a majority mode is typical', { rate: majority.rate, estimate: majority.rateIsEstimate }, { rate: 8, estimate: false });

  const noMajority = resolveRate({ rateType: 'lender_specific', lenderSpecificRates: [{ lender: 'A', rate: 7.5 }, { lender: 'B', rate: 8 }, { lender: 'C', rate: 8.5 }] });
  check('C3b no majority → indicative, not "typical"', noMajority.rateIsEstimate, true);
}

// CASE 4 — Interest subsidy: base rate and subsidy kept separate, effective rate used for EMI
{
  const rateInfo = resolveRate({ rateType: 'subsidy', interestRate: 10, interestSubsidyPct: 3 });
  check('C4 effective = base - subsidy', rateInfo.rate, 7);
  check('C4 base rate preserved separately', rateInfo.baseRate, 10);

  const noBase = resolveRate({ rateType: 'subsidy', interestSubsidyPct: 3 });
  check('C4b subsidy without base rate → cannot calculate', noBase.canCalculate, false);
}

// CASE 5 — Benchmark-linked / profile-dependent: marked indicative, never a fake default
{
  const rateInfo = resolveRate({ rateType: 'benchmark_linked' });
  check('C5 no fixed figure → cannot calculate', rateInfo.canCalculate, false);
  const indicative = resolveRate({ rateType: 'benchmark_linked', interestRate: 9.5 });
  check('C5b with indicative figure, marked estimate', indicative.rateIsEstimate, true);
}

// CASE 6 — No reliable rate at all → no fake EMI
{
  const rateInfo = resolveRate({ rateType: 'not_specified' });
  check('C6 not specified → cannot calculate', rateInfo.canCalculate, false);
  check('C6 no rate value leaks through', rateInfo.rate, null);
}

// CASE 7 — loanDetailsFromScheme reads DB row shape correctly, and non-loan schemes yield null
{
  const scheme = { is_loan_scheme: true, loan_amount_min: 50000, loan_amount_max: 500000, tenure_min_months: 12, tenure_max_months: 36, interest_rate: 8, rate_type: 'official_fixed' };
  const d = loanDetailsFromScheme(scheme);
  check('C7 min/max amount mapped', { min: d.minLoanAmount, max: d.maxLoanAmount }, { min: 50000, max: 500000 });
  check('C7 non-loan scheme → null', loanDetailsFromScheme({ is_loan_scheme: false }), null);
}

console.log(`\n${pass} passed, ${fail} failed.`);
if (fail > 0) process.exit(1);
