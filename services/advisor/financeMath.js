// ============================================================================
// Financial Calculation Engine — pure, deterministic money math. No I/O, no AI.
// Every number the advisor shows the user is produced here (or in
// advisorEngine.js from these functions), never by a language model.
// ============================================================================

const r0 = (n) => Math.round(n);
const r2 = (n) => Math.round(n * 100) / 100;

// Standard reducing-balance monthly EMI. rate is an ANNUAL percentage.
export function emi(principal, annualRatePct, months) {
  const P = Number(principal), n = Math.round(Number(months));
  if (!(P > 0) || !(n > 0)) return 0;
  const i = Number(annualRatePct) / 12 / 100;
  if (!(i > 0)) return P / n; // interest-free
  const f = Math.pow(1 + i, n);
  return (P * i * f) / (f - 1);
}

export function loanCost(principal, annualRatePct, months) {
  const monthly = emi(principal, annualRatePct, months);
  const totalRepayment = monthly * Math.round(months);
  return {
    emi: r0(monthly),
    totalRepayment: r0(totalRepayment),
    totalInterest: Math.max(0, r0(totalRepayment - principal)),
  };
}

// Year-by-year principal/interest split so the user can see the loan plan.
export function yearlySchedule(principal, annualRatePct, months) {
  const n = Math.round(months);
  const i = Number(annualRatePct) / 12 / 100;
  const pay = emi(principal, annualRatePct, n);
  let balance = principal;
  const years = [];
  let yearPrincipal = 0, yearInterest = 0;
  for (let m = 1; m <= n; m++) {
    const interest = balance * (i > 0 ? i : 0);
    const princ = Math.min(balance, pay - interest);
    balance -= princ;
    yearPrincipal += princ;
    yearInterest += interest;
    if (m % 12 === 0 || m === n) {
      years.push({ year: Math.ceil(m / 12), principalPaid: r0(yearPrincipal), interestPaid: r0(yearInterest), closingBalance: Math.max(0, r0(balance)) });
      yearPrincipal = 0; yearInterest = 0;
    }
  }
  return years;
}

// Largest principal whose EMI fits a monthly budget.
export function principalForEmi(monthlyBudget, annualRatePct, months) {
  const B = Number(monthlyBudget), n = Math.round(months);
  if (!(B > 0) || !(n > 0)) return 0;
  const i = Number(annualRatePct) / 12 / 100;
  if (!(i > 0)) return r0(B * n);
  const f = Math.pow(1 + i, n);
  return r0((B * (f - 1)) / (i * f));
}

// Household affordability of a NEW EMI. Uses the fixed-obligation-to-income
// ratio (FOIR) banks themselves use. Only the user's CURRENT income is used —
// projected business income is never assumed, and the caller says so.
//   comfortable ≤ 35%   stretched ≤ 50%   risky > 50%   unaffordable: no cash left
export const FOIR = { comfortable: 0.35, stretched: 0.5 };

export function affordability({ monthlyIncome, monthlyExpenses, existingEmi = 0, newEmi }) {
  const income = Number(monthlyIncome), expenses = Number(monthlyExpenses) || 0, existing = Number(existingEmi) || 0;
  if (!(income > 0)) return { status: 'unknown', reason: 'no_income' };
  const freeBefore = income - expenses - existing;
  const freeAfter = freeBefore - newEmi;
  const foir = (existing + newEmi) / income;
  let status;
  if (freeAfter < 0) status = 'unaffordable';
  else if (foir <= FOIR.comfortable) status = 'comfortable';
  else if (foir <= FOIR.stretched) status = 'stretched';
  else status = 'risky';
  return {
    status,
    foirPct: r2(foir * 100),
    freeCashBefore: r0(freeBefore),
    freeCashAfter: r0(freeAfter),
    // Highest EMI that keeps total obligations within the comfortable band AND
    // leaves non-negative cash, whichever is tighter.
    maxComfortableEmi: Math.max(0, r0(Math.min(income * FOIR.comfortable - existing, freeBefore))),
  };
}

export const money = { r0, r2 };

// Highest annual rate (%) at which the EMI still fits `maxEmi`, or null if even
// an interest-free loan does not fit. Lets us say "affordable if your bank's
// rate is at most X%" without ever inventing the bank's rate.
export function maxRateForEmi(principal, months, maxEmi) {
  if (!(maxEmi > 0) || emi(principal, 0, months) > maxEmi) return null;
  if (emi(principal, 40, months) <= maxEmi) return 40;
  let lo = 0, hi = 40;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (emi(principal, mid, months) <= maxEmi) lo = mid; else hi = mid;
  }
  return Math.floor(lo * 10) / 10;
}
