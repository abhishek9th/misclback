import test from 'node:test';
import assert from 'node:assert/strict';
import { analyseBusiness } from '../services/advisor/businessFeasibility.js';

const dairy = {
  sector: 'dairy', stage: 'new', location: 'rural', total_investment: 800000, own_savings: 400000,
  household_income_monthly: 25000, household_expenses_monthly: 15000, existing_emi_monthly: 0,
  employees: 1, salary_per_employee_month: 8000, other_fixed_month: 3000,
  loan_amount: 500000, loan_rate_annual: 9, loan_tenure_months: 60,
  drivers: { animals: 10, milk_litres_per_animal_day: 8, price_per_litre: 40, feed_cost_per_animal_month: 3000, vet_cost_month: 2000, transport_cost_month: 3000 },
};

test('dairy numbers follow the stated formulas', () => {
  const r = analyseBusiness(dairy);
  const f = r.financial_analysis;
  assert.equal(f.monthly_revenue, 96000);          // 10 x 8 L x 30 days x Rs 40
  assert.equal(f.gross_profit, 61000);             // 96,000 - 35,000 variable
  assert.equal(f.operating_profit, 50000);         // - 11,000 fixed
  assert.equal(r.loan_analysis.emi, 10379);        // reducing balance, 5L, 9%, 60 months
  assert.equal(f.payback_months, 16);              // 8,00,000 / 50,000
  assert.equal(f.roi, 71.9);                       // annual net 5,75,450 / 8,00,000
  assert.equal(f.break_even.revenue_per_month, 20531);
});

test('missing figures give INSUFFICIENT DATA and are listed, never invented', () => {
  const r = analyseBusiness({ sector: 'retail' });
  assert.equal(r.final_recommendation.decision, 'INSUFFICIENT DATA');
  assert.ok(r.missing_information.includes('total_investment'));
  assert.deepEqual(r.stress_test, []);
});

test('no loan rate entered => no EMI is made up', () => {
  const r = analyseBusiness({ ...dairy, loan_rate_annual: undefined });
  assert.equal(r.loan_analysis.emi, null);
  assert.ok(r.missing_information.includes('loan_rate_annual'));
});

test('all five stress scenarios run and a delay in revenue is checked against savings', () => {
  const r = analyseBusiness(dairy);
  assert.deepEqual(r.stress_test.map((s) => s.scenario), ['A', 'B', 'C', 'D', 'E']);
  assert.ok(r.stress_test[1].monthly_cash_flow < r.stress_test[0].monthly_cash_flow);   // revenue -20%
  assert.ok(r.stress_test[2].monthly_cash_flow < r.stress_test[0].monthly_cash_flow);   // costs +20%
  assert.ok(r.stress_test[4].survival.cash_needed_during_delay > 0);
});

test('a business that cannot pay its EMI is not recommended', () => {
  const r = analyseBusiness({ ...dairy, drivers: { ...dairy.drivers, price_per_litre: 18 }, loan_amount: 700000 });
  assert.ok(r.financial_analysis.monthly_cash_flow_after_debt < 0);
  assert.equal(r.final_recommendation.decision, 'RECONSIDER');
});

test('ten risks are scored 0-100 with levels, and heuristic ones are labelled', () => {
  const r = analyseBusiness(dairy);
  assert.equal(r.risk_analysis.individual_risks.length, 10);
  for (const k of r.risk_analysis.individual_risks) assert.ok(k.score >= 0 && k.score <= 100 && k.level);
  assert.ok(r.risk_analysis.individual_risks.some((k) => k.basis === 'heuristic'));
});

test('funding comparison never recommends draining savings: reserve of 6 months is required', () => {
  const r = analyseBusiness(dairy);
  assert.equal(r.funding_comparison.length, 3);
  const best = r.funding_comparison.find((o) => o.name === r.final_recommendation.best_funding_strategy);
  if (best) assert.ok(best.reserve_months === null || best.reserve_months >= 6);
  const selfFinance = r.funding_comparison[0];
  assert.equal(selfFinance.savings_sufficient, false);   // 8L needed, 4L saved
});
