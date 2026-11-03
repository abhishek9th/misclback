// Business feasibility engine — pure, deterministic. No I/O, no AI, no invented figures.
// Every number comes from what the user entered (or from a driver the user entered, such as animals x
// litres x price). Anything the user did not give is listed in missing_information and the analysis says
// so, instead of filling it with a guess. Risk scores are transparent heuristics, NOT validated
// probabilities, and say so.
import { emi, loanCost } from './financeMath.js';

const r0 = (n) => Math.round(n);
const r1 = (n) => Math.round(n * 10) / 10;
const num = (v) => (v === null || v === undefined || v === '' || Number.isNaN(Number(v)) ? null : Number(v));
const pos = (v) => { const n = num(v); return n !== null && n >= 0 ? n : null; };
const clamp = (n, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));

export const SECTORS = ['dairy', 'poultry', 'retail', 'manufacturing', 'other'];
const SECTOR_LABEL = { dairy: 'Dairy farming', poultry: 'Poultry farming', retail: 'Retail trading', manufacturing: 'Manufacturing', other: 'Other business' };

// ---- revenue and variable cost, from sector drivers or direct monthly figures -----------------------
function operatingModel(i) {
  const d = i.drivers || {};
  const out = { revenue: null, variable: null, basis: null, notes: [], missing: [] };
  const need = (cond, key) => { if (!cond) out.missing.push(key); return cond; };

  if (i.sector === 'dairy' && num(d.animals) !== null && num(d.milk_litres_per_animal_day) !== null && num(d.price_per_litre) !== null) {
    const animals = num(d.animals);
    const milking = d.milking_share_pct != null ? clamp(num(d.milking_share_pct) ?? 100) / 100 : 1;
    const litres = animals * milking * num(d.milk_litres_per_animal_day) * 30;
    out.revenue = litres * num(d.price_per_litre);
    out.variable = animals * (pos(d.feed_cost_per_animal_month) ?? 0) + (pos(d.vet_cost_month) ?? 0) + (pos(d.transport_cost_month) ?? 0);
    out.basis = `${animals} animals x ${r1(milking * 100)}% milking x ${num(d.milk_litres_per_animal_day)} L/day x 30 days x Rs ${num(d.price_per_litre)}/L`;
    if (d.mortality_pct != null && num(d.mortality_pct) > 0) {
      out.revenue *= 1 - clamp(num(d.mortality_pct)) / 100;
      out.notes.push(`Revenue reduced by your stated animal loss of ${num(d.mortality_pct)}%.`);
    }
    out.unit = { name: 'litres/month', perMonth: litres, price: num(d.price_per_litre) };
    for (const k of ['feed_cost_per_animal_month', 'vet_cost_month']) if (num(d[k]) === null) out.missing.push(`drivers.${k}`);
  } else if (i.sector === 'poultry' && num(d.birds) !== null && num(d.price_per_bird) !== null && num(d.cycles_per_year) !== null) {
    const mort = clamp(pos(d.mortality_pct) ?? 0) / 100;
    const sold = num(d.birds) * (1 - mort) * num(d.cycles_per_year) / 12;
    out.revenue = sold * num(d.price_per_bird);
    out.variable = num(d.birds) * num(d.cycles_per_year) / 12 * ((pos(d.feed_cost_per_bird_cycle) ?? 0) + (pos(d.other_cost_per_bird_cycle) ?? 0));
    out.basis = `${num(d.birds)} birds x ${num(d.cycles_per_year)} cycles/yr, ${r1(mort * 100)}% mortality, Rs ${num(d.price_per_bird)}/bird`;
    out.unit = { name: 'birds sold/month', perMonth: sold, price: num(d.price_per_bird) };
    if (d.mortality_pct == null) out.notes.push('No mortality rate entered, so none was applied.');
    if (num(d.feed_cost_per_bird_cycle) === null) out.missing.push('drivers.feed_cost_per_bird_cycle');
  } else if (i.sector === 'retail' && num(d.daily_sales) !== null && num(d.gross_margin_pct) !== null) {
    const days = pos(d.working_days_per_month) ?? 26;
    out.revenue = num(d.daily_sales) * days;
    out.variable = out.revenue * (1 - clamp(num(d.gross_margin_pct)) / 100);
    out.basis = `Rs ${num(d.daily_sales)}/day x ${days} days, gross margin ${num(d.gross_margin_pct)}%`;
    if (d.working_days_per_month == null) out.notes.push('26 working days a month was used because you did not enter it.');
  } else if (i.sector === 'manufacturing' && num(d.units_per_month) !== null && num(d.price_per_unit) !== null) {
    out.revenue = num(d.units_per_month) * num(d.price_per_unit);
    out.variable = num(d.units_per_month) * (pos(d.raw_material_per_unit) ?? 0) + (pos(d.electricity_month) ?? 0) + (pos(d.logistics_month) ?? 0);
    out.basis = `${num(d.units_per_month)} units/month x Rs ${num(d.price_per_unit)}/unit`;
    out.unit = { name: 'units/month', perMonth: num(d.units_per_month), price: num(d.price_per_unit) };
    if (num(d.raw_material_per_unit) === null) out.missing.push('drivers.raw_material_per_unit');
  } else if (num(i.monthly_revenue) !== null) {
    out.revenue = num(i.monthly_revenue);
    out.variable = pos(i.monthly_variable_costs);
    out.basis = 'Monthly revenue you entered';
    if (out.variable === null) { out.variable = 0; out.missing.push('monthly_variable_costs'); out.notes.push('No variable costs were entered, so none were deducted.'); }
  } else {
    need(false, 'monthly_revenue (or the sector inputs that produce it)');
  }
  return out;
}

// ---- main ---------------------------------------------------------------------------------------------
export function analyseBusiness(raw) {
  const i = { ...raw, sector: SECTORS.includes(raw.sector) ? raw.sector : 'other', stage: raw.stage === 'existing' ? 'existing' : 'new' };
  const missing = [];
  const assumptions = [
    'Income tax and GST are not included.',
    'Revenue is treated as steady month to month (no seasonality).',
    'Interest is averaged over the loan period for the net-profit figure; cash flow uses the full EMI.',
    'These are estimates built only from the figures you entered, not forecasts or guarantees.',
  ];

  const investment = pos(i.total_investment);
  const wcNeed = pos(i.working_capital) ?? 0;
  const savings = pos(i.own_savings);
  const hhIncome = pos(i.household_income_monthly);
  const hhExp = pos(i.household_expenses_monthly);
  const existingEmi = pos(i.existing_emi_monthly) ?? 0;
  if (investment === null) missing.push('total_investment');
  if (savings === null) missing.push('own_savings');
  if (hhIncome === null) missing.push('household_income_monthly');
  if (hhExp === null) missing.push('household_expenses_monthly');
  if (i.existing_emi_monthly == null) assumptions.push('No existing loan EMI was entered, so existing debt is taken as nil. Please confirm.');
  if (i.working_capital == null) assumptions.push('Working capital is taken as already included in the total investment.');

  const model = operatingModel(i);
  missing.push(...model.missing);

  const salaries = (pos(i.employees) ?? 0) * (pos(i.salary_per_employee_month) ?? 0);
  if ((pos(i.employees) ?? 0) > 0 && num(i.salary_per_employee_month) === null) missing.push('salary_per_employee_month');
  const fixedCash = (pos(i.rent_month) ?? 0) + salaries + (pos(i.other_fixed_month) ?? 0);
  const depreciation = pos(i.depreciation_month) ?? 0;
  if (i.depreciation_month == null) assumptions.push('Depreciation of machinery/equipment is taken as nil because it was not entered.');
  if (i.rent_month == null && i.other_fixed_month == null && salaries === 0) assumptions.push('No fixed monthly costs (rent, salaries, utilities) were entered, so none were deducted. This will overstate profit if you have any.');

  // required capital and financing
  const requirement = (investment ?? 0) + (i.working_capital != null ? wcNeed : 0);
  const loan = clamp(pos(i.loan_amount) ?? 0, 0, requirement || Infinity);
  const rate = num(i.loan_rate_annual);
  const tenure = pos(i.loan_tenure_months);
  const haveLoanTerms = loan > 0 && rate !== null && tenure !== null && tenure > 0;
  if (loan > 0 && rate === null) missing.push('loan_rate_annual');
  if (loan > 0 && (tenure === null || tenure <= 0)) missing.push('loan_tenure_months');

  const own = Math.max(0, requirement - loan);
  const lc = haveLoanTerms ? loanCost(loan, rate, tenure) : null;
  const monthlyEmi = lc ? lc.emi : 0;
  const avgInterest = lc ? lc.totalInterest / tenure : 0;

  const critical = [investment, model.revenue].some((x) => x === null);
  const R = model.revenue ?? 0;
  const V = model.variable ?? 0;

  const metrics = (rev, varCost, fixedExtra = 0) => {
    const gross = rev - varCost;
    const operating = gross - fixedCash - fixedExtra - depreciation;
    const net = operating - avgInterest;
    const cashPreDebt = operating + depreciation;
    const cashAfterDebt = cashPreDebt - monthlyEmi;
    return { gross, operating, net, cashPreDebt, cashAfterDebt };
  };
  const base = metrics(R, V);

  // reserve after investing (own cash left) and months it can carry fixed costs + EMI + household shortfall
  const reserve = savings === null ? null : savings - own;
  const monthlyBurn = fixedCash + monthlyEmi + (hhIncome !== null && hhExp !== null ? Math.max(0, hhExp + existingEmi - hhIncome) : 0);
  const reserveMonths = reserve !== null && monthlyBurn > 0 ? reserve / monthlyBurn : null;

  // ---- profitability
  const annualNet = base.net * 12;
  const roi = investment ? (annualNet / requirement) * 100 : null;
  const ratio = R > 0 ? (R - V) / R : null;
  const beRevenue = ratio && ratio > 0 ? (fixedCash + depreciation + avgInterest) / ratio : null;
  const payback = base.cashPreDebt > 0 && requirement ? requirement / base.cashPreDebt : null;
  const financial_analysis = {
    monthly_revenue: r0(R), monthly_expenses: r0(V + fixedCash + depreciation + avgInterest),
    gross_profit: r0(base.gross), operating_profit: r0(base.operating), net_profit: r0(base.net), annual_profit: r0(annualNet),
    monthly_cash_flow_before_debt: r0(base.cashPreDebt), monthly_cash_flow_after_debt: r0(base.cashAfterDebt),
    roi: roi === null ? null : r1(roi),
    break_even: beRevenue === null ? null : {
      revenue_per_month: r0(beRevenue),
      share_of_expected_revenue_pct: R > 0 ? r1((beRevenue / R) * 100) : null,
      units_per_month: model.unit && model.unit.price > 0 ? r1(beRevenue / model.unit.price) : null,
      unit_name: model.unit?.name || null,
    },
    payback_months: payback === null ? null : r1(payback),
    revenue_basis: model.basis, notes: model.notes,
    explanation: 'Revenue is what you expect to sell. Operating profit is revenue minus running costs. Net profit also deducts loan interest. Cash flow after debt is what is actually left each month after paying the EMI.',
  };

  // ---- stress tests
  const scenario = (key, label, revF, costF, delayMonths = 0) => {
    // costs: variable costs follow volume (revF) and are then inflated by costF; fixed costs inflate by costF
    const varC = V * revF * costF;
    const fixed = (fixedCash + depreciation) * costF;
    const operating = R * revF - varC - fixed;
    const cashPreDebt = operating + depreciation * costF;
    const cashAfterDebt = cashPreDebt - monthlyEmi;
    const net = operating - avgInterest;
    const dscr = monthlyEmi > 0 ? cashPreDebt / monthlyEmi : null;
    let survival;
    if (delayMonths > 0) {
      const cashNeeded = delayMonths * (fixedCash * costF + monthlyEmi);
      survival = { cash_needed_during_delay: r0(cashNeeded), reserve_available: reserve === null ? null : r0(reserve), covered: reserve === null ? null : reserve >= cashNeeded };
      return { scenario: key, label, monthly_operating_profit: r0(operating), monthly_net_profit: r0(net), monthly_cash_flow: r0(-(fixedCash * costF + monthlyEmi)), during_delay_months: delayMonths, dscr: null, loan_repayment_ok: survival.covered, survival, sustainable: survival.covered === true };
    }
    const burn = cashAfterDebt < 0 ? -cashAfterDebt : 0;
    const monthsCovered = burn > 0 && reserve !== null ? reserve / burn : null;
    const sustainable = cashAfterDebt >= 0 || (monthsCovered !== null && monthsCovered >= 12);
    return {
      scenario: key, label, monthly_operating_profit: r0(operating), monthly_net_profit: r0(net), monthly_cash_flow: r0(cashAfterDebt),
      dscr: dscr === null ? null : r1(dscr), loan_repayment_ok: monthlyEmi === 0 ? true : cashPreDebt >= monthlyEmi,
      reserve_after_investment: reserve === null ? null : r0(reserve), months_reserve_lasts: burn > 0 ? (monthsCovered === null ? null : r1(monthsCovered)) : null,
      sustainable,
    };
  };
  const stress_test = critical ? [] : [
    scenario('A', 'Expected performance', 1, 1),
    scenario('B', 'Revenue 20% lower', 0.8, 1),
    scenario('C', 'Operating costs 20% higher', 1, 1.2),
    scenario('D', 'Revenue 35% lower and costs 20% higher', 0.65, 1.2),
    scenario('E', 'No revenue for the first 3 months', 1, 1, 3),
  ];
  const firstFail = stress_test.find((s) => s.sustainable === false);

  // ---- loan analysis
  const dscrA = monthlyEmi > 0 ? base.cashPreDebt / monthlyEmi : null;
  const dti = hhIncome > 0 ? ((existingEmi + monthlyEmi) / hhIncome) * 100 : null;
  const disposable = hhIncome !== null && hhExp !== null ? hhIncome - hhExp - existingEmi - monthlyEmi : null;
  const loan_analysis = {
    total_requirement: r0(requirement), loan_amount: r0(loan), own_contribution: r0(own),
    savings_cover_own_contribution: savings === null ? null : savings >= own,
    savings_shortfall: savings === null ? null : r0(Math.max(0, own - savings)),
    emergency_reserve_after_investment: reserve === null ? null : r0(reserve),
    reserve_months: reserveMonths === null ? null : r1(reserveMonths),
    emi: lc ? lc.emi : null, total_interest: lc ? lc.totalInterest : null, total_repayment: lc ? lc.totalRepayment : null,
    debt_to_income_pct: dti === null ? null : r1(dti),
    debt_to_income_note: 'Measured against household income only. Business income is not counted because it is a projection.',
    dscr: dscrA === null ? null : r1(dscrA),
    household_disposable_after_emi: disposable === null ? null : r0(disposable),
    interest_rate_used: haveLoanTerms ? rate : null,
    rate_note: haveLoanTerms ? 'This is the rate you entered; an actual scheme or bank may quote a different one.' : 'No loan rate was entered, so no EMI is shown. Enter the rate your bank or scheme quotes.',
    tenure_options: haveLoanTerms ? [12, 24, 36, 60, 84].filter((t) => t !== tenure).concat([tenure]).sort((a, b) => a - b).map((t) => { const c = loanCost(loan, rate, t); return { months: t, emi: c.emi, total_interest: c.totalInterest, total_repayment: c.totalRepayment, selected: t === tenure }; }) : [],
    rate_sensitivity: haveLoanTerms ? [-2, 0, 2].map((dlt) => { const rt = Math.max(0, rate + dlt); const c = loanCost(loan, rt, tenure); return { rate: r1(rt), emi: c.emi, total_interest: c.totalInterest, selected: dlt === 0 }; }) : [],
    warning: loan >= requirement * 0.9 && requirement > 0 ? 'You are borrowing almost the whole requirement. Borrowing less keeps your savings buffer and repayments safer.' : null,
  };

  // ---- risks (transparent heuristics)
  const beShare = beRevenue !== null && R > 0 ? beRevenue / R : null;
  const bad = (s) => stress_test.find((x) => x.scenario === s);
  const heur = {
    dairy: { operational: 55, competition: 30, regulatory: 40 }, poultry: { operational: 65, competition: 40, regulatory: 45 },
    retail: { operational: 35, competition: 60, regulatory: 25 }, manufacturing: { operational: 50, competition: 45, regulatory: 45 }, other: { operational: 45, competition: 45, regulatory: 35 },
  }[i.sector];
  const level = (s) => (s <= 20 ? 'Very Low' : s <= 40 ? 'Low' : s <= 60 ? 'Moderate' : s <= 80 ? 'High' : 'Critical');
  const risk = (key, name, score, why, factors, ifHappens, mitigation, basis = 'calculated') => ({ key, name, score: r0(clamp(score)), level: level(clamp(score)), why, factors, if_it_happens: ifHappens, how_to_reduce: mitigation, basis });
  const noData = critical;
  const individual = noData ? [] : [
    risk('business_failure', 'Business failure', (beShare === null ? 80 : beShare * 70) + (i.stage === 'new' ? 15 : 0) + (base.net < 0 ? 15 : 0),
      beShare === null ? 'The contribution margin is zero or negative, so the business cannot cover its costs.' : `You must reach ${r0(beShare * 100)}% of expected sales just to break even.`,
      [`break-even at ${beShare === null ? 'n/a' : r0(beShare * 100)}% of expected revenue`, i.stage === 'new' ? 'new business (no sales history)' : 'running business', `net profit Rs ${financial_analysis.net_profit}/month`],
      'Savings and loan would be lost, and the loan would still have to be repaid.', 'Start smaller, confirm demand with real buyers first, and keep costs flexible.'),
    risk('loan_repayment', 'Loan repayment', monthlyEmi === 0 ? 5 : dscrA === null ? 50 : dscrA >= 2 ? 15 : dscrA >= 1.5 ? 30 : dscrA >= 1.2 ? 50 : dscrA >= 1 ? 70 : 90,
      monthlyEmi === 0 ? 'No EMI, so there is no repayment pressure.' : `Business cash covers the EMI ${dscrA === null ? '' : `${r1(dscrA)} times`}.`,
      [`EMI Rs ${monthlyEmi}`, `cash before debt Rs ${financial_analysis.monthly_cash_flow_before_debt}/month`], 'Missed EMIs, penalties and a damaged credit record.', 'Borrow less, lengthen the tenure, or lower fixed costs until cash covers the EMI at least 1.5 times.'),
    risk('cash_flow', 'Cash flow', (() => { const d = bad('D'); const b = bad('B'); let s = base.cashAfterDebt < 0 ? 85 : 20; if (b && b.monthly_cash_flow < 0) s += 25; if (d && d.monthly_cash_flow < 0) s += 15; return s; })(),
      base.cashAfterDebt < 0 ? 'Even in the expected case, cash after the EMI is negative.' : 'Expected cash after the EMI is positive, but weaker months may not be.',
      [`cash after debt Rs ${financial_analysis.monthly_cash_flow_after_debt}/month`, `revenue -20%: Rs ${bad('B')?.monthly_cash_flow}/month`], 'You may have to pay running costs from savings.', 'Keep a cash buffer of several months of fixed costs and EMI.'),
    risk('market_demand', 'Market demand', (bad('B') && bad('B').monthly_cash_flow < 0 ? 60 : 30) + (i.stage === 'new' ? 15 : 0) + (beShare !== null && beShare > 0.7 ? 15 : 0),
      'Sales depend on buyers you may not have yet. This cannot be measured from the numbers, so it is judged from how sensitive profit is to a sales drop.', [i.stage === 'new' ? 'new business' : 'existing customers', 'sensitivity to a 20% sales drop'],
      'Sales fall short of the plan.', 'Secure buyers or a buy-back arrangement before investing.', 'heuristic'),
    risk('operational', 'Operational', heur.operational, `${SECTOR_LABEL[i.sector]} has day-to-day operating risks (supply, quality, staff). This is a general sector baseline, not measured from your inputs.`,
      ['sector baseline'], 'Production or service interruptions reduce income.', 'Get training, a backup supplier and basic insurance.', 'heuristic'),
    risk('competition', 'Competition', heur.competition + (i.location === 'urban' ? 5 : 0), 'Competition cannot be read from your numbers. This is a general baseline for the sector.', ['sector baseline'], 'Prices or sales fall because of rivals.', 'Differentiate on quality, service or location; research local prices first.', 'heuristic'),
    risk('working_capital', 'Working capital', reserveMonths === null ? 60 : reserveMonths >= 6 ? 15 : reserveMonths >= 3 ? 40 : reserveMonths >= 1 ? 65 : 90,
      reserveMonths === null ? 'Savings were not entered, so the buffer is unknown.' : `After investing, your reserve covers about ${r1(reserveMonths)} months of fixed costs, EMI and household shortfall.`,
      [`reserve Rs ${reserve === null ? 'n/a' : r0(reserve)}`, `monthly burn Rs ${r0(monthlyBurn)}`], 'You cannot pay costs while waiting for sales.', 'Keep at least 6 months of fixed costs and EMI in reserve; borrow more only if it protects this buffer.'),
    risk('interest_rate', 'Interest rate', !haveLoanTerms ? 10 : (() => { const up = loanCost(loan, rate + 2, tenure).emi; const delta = up - monthlyEmi; return base.cashPreDebt > 0 ? clamp((delta / base.cashPreDebt) * 400) : 70; })(),
      !haveLoanTerms ? 'No loan, so no interest-rate exposure.' : 'Shows how much a 2-point rise in the rate would eat into business cash.', [`rate used ${rate ?? 'n/a'}%`], 'Higher EMI if the rate is floating.', 'Prefer a fixed rate or a scheme with interest subvention, where its official terms allow.'),
    risk('debt_burden', 'Debt burden', dti === null ? 50 : dti <= 20 ? 10 : dti <= 35 ? 25 : dti <= 50 ? 55 : dti <= 65 ? 75 : 90,
      dti === null ? 'Household income was not entered.' : `All EMIs are ${r1(dti)}% of household income.`, [`existing EMI Rs ${existingEmi}`, `new EMI Rs ${monthlyEmi}`], 'Little money left for the household.', 'Keep total EMIs within about 35-50% of household income.'),
    risk('regulatory', 'Regulatory', heur.regulatory, 'Licences and approvals (e.g. FSSAI, trade, pollution, animal husbandry) depend on the sector and state. This is a baseline, not an assessment of your papers.', ['sector baseline'], 'Delays or penalties if licences are missing.', 'Check the licences needed in your state before spending.', 'heuristic'),
  ];
  const W = { business_failure: 0.15, loan_repayment: 0.15, cash_flow: 0.15, market_demand: 0.12, operational: 0.08, competition: 0.07, working_capital: 0.12, interest_rate: 0.04, debt_burden: 0.08, regulatory: 0.04 };
  const overall = individual.length ? individual.reduce((a, r) => a + r.score * W[r.key], 0) / Object.values(W).reduce((a, b) => a + b, 0) : null;
  const risk_analysis = {
    overall_risk_score: overall === null ? null : r0(overall), risk_category: overall === null ? null : level(overall), individual_risks: individual,
    mitigation_strategies: individual.filter((r) => r.score > 40).sort((a, b) => b.score - a.score).slice(0, 5).map((r) => `${r.name}: ${r.how_to_reduce}`),
    note: 'Scores are transparent rules of thumb for comparing risks. They are not statistical probabilities. Items marked "heuristic" cannot be measured from your numbers.',
  };

  // ---- funding comparison
  const optionFor = (id, name, loanAmt) => {
    const ownC = Math.max(0, requirement - loanAmt);
    const feasible = savings === null ? null : savings >= ownC;
    const res = savings === null ? null : savings - ownC;
    const c = loanAmt > 0 && rate !== null && tenure ? loanCost(loanAmt, rate, tenure) : { emi: 0, totalInterest: 0, totalRepayment: 0 };
    const unknownTerms = loanAmt > 0 && (rate === null || !tenure);
    const burn = fixedCash + c.emi + (hhIncome !== null && hhExp !== null ? Math.max(0, hhExp + existingEmi - hhIncome) : 0);
    const resM = res !== null && burn > 0 ? res / burn : null;
    const cashAfter = base.cashPreDebt - c.emi;
    const dtiO = hhIncome > 0 ? ((existingEmi + c.emi) / hhIncome) * 100 : null;
    const netO = base.operating - (loanAmt > 0 && tenure ? c.totalInterest / tenure : 0);
    const dscrO = c.emi > 0 ? base.cashPreDebt / c.emi : null;
    // Sustainable = the business itself covers the EMI with a margin, savings are enough, and at least
    // 6 months of cover remain. Household-only debt ratio is shown as a warning, not used as the gate.
    const sustainable = !unknownTerms && feasible === true && cashAfter >= 0 && (dscrO === null || dscrO >= 1.25) && (resM === null || resM >= 6);
    return {
      id, name, borrowing: r0(loanAmt), savings_used: r0(ownC), savings_sufficient: feasible,
      reserve_left: res === null ? null : r0(res), reserve_months: resM === null ? null : r1(resM),
      emi: unknownTerms ? null : c.emi, interest_payable: unknownTerms ? null : c.totalInterest,
      monthly_cash_flow_after_debt: r0(cashAfter), net_profit_monthly: r0(netO),
      debt_to_income_pct: dtiO === null ? null : r1(dtiO), dscr: dscrO === null ? null : r1(dscrO),
      government_benefits: 'Depends on the scheme you qualify for; not assumed here.',
      sustainable, needs_rate_to_compare: unknownTerms,
    };
  };
  const minOwnPct = clamp(pos(i.min_own_contribution_pct) ?? 10, 0, 100);
  if (i.min_own_contribution_pct == null) assumptions.push('For the minimum-own-contribution option, 10% of the requirement was assumed as the lowest own share. Banks and schemes may ask for more.');
  const funding_comparison = critical || requirement <= 0 ? [] : [
    optionFor(1, 'Self-financing (no loan)', 0),
    optionFor(2, 'Partly own money + the loan you entered', loan > 0 ? loan : requirement * 0.5),
    optionFor(3, `Maximum external financing (own share ${minOwnPct}%)`, requirement * (1 - minOwnPct / 100)),
  ];
  const sustainableOptions = funding_comparison.filter((o) => o.sustainable);
  const best = sustainableOptions.length
    // Among the sustainable mixes, prefer the one that borrows LEAST (less interest, less risk). Savings are
    // protected by the 6-month reserve rule above, so this never drains them to avoid interest.
    ? sustainableOptions.slice().sort((a, b) => a.borrowing - b.borrowing)[0]
    : null;

  // ---- decision
  let decision; const reasoning = []; const warnings = []; const action_plan = [];
  const A = bad('A'); const B = bad('B'); const C = bad('C'); const D = bad('D');
  if (critical || savings === null || hhIncome === null || hhExp === null) {
    decision = 'INSUFFICIENT DATA';
    reasoning.push('Key figures are missing, so a reliable decision is not possible yet.');
  } else {
    const profitable = base.net > 0 && base.cashAfterDebt >= 0;
    const dscrOk = monthlyEmi === 0 || (dscrA !== null && dscrA >= 1.2);
    const survivesBC = !!(B && B.sustainable && C && C.sustainable);
    if (profitable && dscrOk && survivesBC && (overall ?? 100) <= 45 && (reserveMonths === null || reserveMonths >= 6)) decision = 'PROCEED';
    else if (profitable && (B?.sustainable || C?.sustainable)) decision = 'PROCEED WITH CAUTION';
    else decision = 'RECONSIDER';
    reasoning.push(`Expected net profit is Rs ${financial_analysis.net_profit}/month and cash after the EMI is Rs ${financial_analysis.monthly_cash_flow_after_debt}/month.`);
    if (roi !== null) reasoning.push(`Estimated annual return on the requirement is ${financial_analysis.roi}% (payback ${financial_analysis.payback_months ?? 'not reached'} months).`);
    reasoning.push(`Overall risk score is ${risk_analysis.overall_risk_score} (${risk_analysis.risk_category}).`);
    if (firstFail) reasoning.push(`The business becomes unsustainable in: "${firstFail.label}".`);
    if (loan_analysis.warning) warnings.push(loan_analysis.warning);
    if (savings < own) warnings.push(`Your savings (Rs ${r0(savings)}) are less than the own contribution needed (Rs ${r0(own)}).`);
    if (reserveMonths !== null && reserveMonths < 3) warnings.push('After investing you would have less than 3 months of cover. Keep more cash back.');
    if (dti !== null && dti > 50) warnings.push(`All EMIs would be ${r1(dti)}% of household income, which is high.`);
    if (base.cashAfterDebt < 0) warnings.push('In the expected case the business does not cover its EMI.');
    if (i.stage === 'new') warnings.push('A new business usually takes time to reach planned sales. Do not rely on the projection.');
    action_plan.push('Confirm the main inputs (prices, sales volume, costs) with at least two local sources before investing.');
    if (best) action_plan.push(`Most sustainable funding among those compared: "${best.name}".`);
    else if (funding_comparison.length) action_plan.push('None of the compared funding mixes is fully sustainable on your numbers: reduce the project size, raise own contribution or cut fixed costs.');
    action_plan.push('Check the exact eligibility and interest terms of the schemes below on their official pages before applying.');
    action_plan.push('Keep at least 6 months of fixed costs and EMI aside as an emergency reserve.');
  }
  if (decision === 'INSUFFICIENT DATA') action_plan.push('Fill in the missing information listed below and run the analysis again.');
  warnings.push('A good projection is not a guarantee of success, and loan eligibility is not loan approval; the bank still assesses you and your proposal.');

  const confidence = decision === 'INSUFFICIENT DATA' ? 'low' : (missing.length === 0 && assumptions.length <= 6 ? 'medium' : 'low-to-medium');
  return {
    business_overview: {
      sector: i.sector, sector_label: SECTOR_LABEL[i.sector], stage: i.stage, location: i.location || null,
      total_investment: investment === null ? null : r0(investment), working_capital_extra: i.working_capital != null ? r0(wcNeed) : null,
      own_savings: savings, employees: pos(i.employees) ?? 0, revenue_basis: model.basis,
    },
    financial_analysis, risk_analysis, stress_test, loan_analysis, funding_comparison,
    recommended_schemes: [],
    final_recommendation: {
      decision, best_funding_strategy: best ? best.name : null, reasoning, action_plan, warnings,
      first_failing_scenario: firstFail ? firstFail.label : null,
    },
    missing_information: [...new Set(missing)], assumptions, confidence,
    facts_vs_estimates: 'Everything shown is calculated from the figures you entered (facts you supplied) using fixed formulas (estimates). Nothing is a guarantee.',
  };
}
