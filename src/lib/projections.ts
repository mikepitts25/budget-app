import type { Goal, RetirementPlan } from '../store/types';
import { monthsUntil } from './date';

/** Future value of a starting balance plus a monthly contribution. */
export function futureValue(
  present: number,
  monthly: number,
  annualReturn: number,
  months: number,
): number {
  const r = annualReturn / 12;
  if (months <= 0) return present;
  if (r === 0) return present + monthly * months;
  const growth = Math.pow(1 + r, months);
  return Math.round(present * growth + monthly * ((growth - 1) / r));
}

/** Monthly contribution needed to reach `target` from `present` in `months`. */
export function requiredMonthly(
  present: number,
  target: number,
  annualReturn: number,
  months: number,
): number {
  if (months <= 0) return Math.max(0, target - present);
  const r = annualReturn / 12;
  if (r === 0) return Math.max(0, Math.round((target - present) / months));
  const growth = Math.pow(1 + r, months);
  const needed = (target - present * growth) / ((growth - 1) / r);
  return Math.max(0, Math.round(needed));
}

/** Months until `target` is reached at the current contribution, or null if never. */
export function monthsToTarget(
  present: number,
  monthly: number,
  annualReturn: number,
  target: number,
): number | null {
  if (present >= target) return 0;
  if (monthly <= 0 && annualReturn <= 0) return null;
  let balance = present;
  const r = annualReturn / 12;
  for (let m = 1; m <= 12 * 100; m++) {
    balance = balance * (1 + r) + monthly;
    if (balance >= target) return m;
  }
  return null;
}

export interface GoalStatus {
  goal: Goal;
  monthsLeft: number;
  required: number;
  gap: number;
  projected: number;
  progress: number;
  onTrack: boolean;
  /** Months at the current contribution; null if it never gets there. */
  etaMonths: number | null;
}

export function goalStatus(goal: Goal): GoalStatus {
  const monthsLeft = monthsUntil(goal.targetDate);
  const required = requiredMonthly(goal.saved, goal.target, goal.expectedReturn, monthsLeft);
  const projected = futureValue(goal.saved, goal.monthlyContribution, goal.expectedReturn, monthsLeft);
  return {
    goal,
    monthsLeft,
    required,
    gap: Math.max(0, required - goal.monthlyContribution),
    projected,
    progress: goal.target > 0 ? Math.min(1, goal.saved / goal.target) : 0,
    onTrack: projected >= goal.target,
    etaMonths: monthsToTarget(goal.saved, goal.monthlyContribution, goal.expectedReturn, goal.target),
  };
}

/**
 * Waterfall the couple's monthly surplus into goals by priority: each goal takes
 * what it needs to stay on track, and whatever is left flows to the next one.
 */
export function allocateSurplus(goals: Goal[], surplus: number): Record<string, number> {
  const ordered = [...goals]
    .filter((g) => !g.archived)
    .sort((a, b) => a.priority - b.priority || a.targetDate.localeCompare(b.targetDate));
  let left = Math.max(0, surplus);
  const out: Record<string, number> = {};
  for (const g of ordered) {
    const need = goalStatus(g).required;
    const give = Math.min(left, need);
    out[g.id] = give;
    left -= give;
  }
  if (left > 0 && ordered.length) out[ordered[0].id] += left;
  return out;
}

export interface RetirementProjection {
  /** Nest egg needed, in today's money, from the withdrawal rate. */
  numberToday: number;
  /** The same target inflated to the retirement date. */
  numberAtRetirement: number;
  yearsToRetirement: number;
  projectedAtRetirement: number;
  shortfall: number;
  requiredMonthly: number;
  /** Year-by-year balance track, for charting. */
  track: { year: number; age: number; balance: number; target: number }[];
  /** Age at which projected assets cover the inflated target, if ever. */
  coastAge: number | null;
}

export function projectRetirement(plan: RetirementPlan, personIds: string[]): RetirementProjection {
  const ages = personIds.map((id) => plan.currentAge[id] ?? 35);
  const retireAges = personIds.map((id) => plan.retireAge[id] ?? 65);
  // The couple retires together when the later partner hits their retirement age.
  const yearsList = personIds.map((_, i) => (retireAges[i] ?? 65) - (ages[i] ?? 35));
  const years = Math.max(0, Math.max(...(yearsList.length ? yearsList : [30])));
  const months = Math.round(years * 12);

  const numberToday = Math.round(plan.desiredAnnualSpend / plan.safeWithdrawalRate);
  const numberAtRetirement = Math.round(numberToday * Math.pow(1 + plan.inflation, years));
  const projected = futureValue(
    plan.currentSavings,
    plan.monthlyContribution,
    plan.expectedReturn,
    months,
  );

  const track: RetirementProjection['track'] = [];
  let balance = plan.currentSavings;
  const leadAge = Math.min(...(ages.length ? ages : [35]));
  let coastAge: number | null = null;
  for (let y = 0; y <= Math.max(years, 1); y++) {
    const target = Math.round(numberToday * Math.pow(1 + plan.inflation, y));
    track.push({ year: y, age: leadAge + y, balance: Math.round(balance), target });
    if (coastAge === null && balance >= target) coastAge = leadAge + y;
    balance = futureValue(balance, plan.monthlyContribution, plan.expectedReturn, 12);
  }

  return {
    numberToday,
    numberAtRetirement,
    yearsToRetirement: years,
    projectedAtRetirement: projected,
    shortfall: Math.max(0, numberAtRetirement - projected),
    requiredMonthly: requiredMonthly(
      plan.currentSavings,
      numberAtRetirement,
      plan.expectedReturn,
      months,
    ),
    track,
    coastAge,
  };
}

/** Monthly payment on an amortizing loan. */
export function loanPayment(principal: number, apr: number, years: number): number {
  const r = apr / 12;
  const n = years * 12;
  if (n <= 0) return principal;
  if (r === 0) return Math.round(principal / n);
  return Math.round((principal * r) / (1 - Math.pow(1 + r, -n)));
}

export interface HouseAffordability {
  maxPrice: number;
  downPayment: number;
  loanAmount: number;
  monthlyPI: number;
  monthlyTotal: number;
  frontRatio: number;
  backRatio: number;
}

/**
 * Back-solves the purchase price that keeps housing costs inside `maxHousingRatio`
 * of gross monthly income, given taxes, insurance and the down payment on hand.
 */
export function affordHouse(opts: {
  grossAnnualIncome: number;
  downPayment: number;
  apr: number;
  termYears: number;
  propertyTaxRate: number;
  insuranceAnnual: number;
  hoaMonthly: number;
  otherDebtMonthly: number;
  maxHousingRatio: number;
  maxTotalDebtRatio: number;
}): HouseAffordability {
  const grossMonthly = opts.grossAnnualIncome / 12;
  const budgetFromFront = grossMonthly * opts.maxHousingRatio;
  const budgetFromBack = grossMonthly * opts.maxTotalDebtRatio - opts.otherDebtMonthly;
  const housingBudget = Math.max(0, Math.min(budgetFromFront, budgetFromBack));

  let lo = 0;
  let hi = 500_000_00 * 20;
  for (let i = 0; i < 60; i++) {
    const price = Math.round((lo + hi) / 2);
    const loan = Math.max(0, price - opts.downPayment);
    const pi = loanPayment(loan, opts.apr, opts.termYears);
    const monthly =
      pi + (price * opts.propertyTaxRate) / 12 + opts.insuranceAnnual / 12 + opts.hoaMonthly;
    if (monthly > housingBudget) hi = price;
    else lo = price;
  }
  const maxPrice = Math.round(lo);
  const loanAmount = Math.max(0, maxPrice - opts.downPayment);
  const monthlyPI = loanPayment(loanAmount, opts.apr, opts.termYears);
  const monthlyTotal =
    monthlyPI + (maxPrice * opts.propertyTaxRate) / 12 + opts.insuranceAnnual / 12 + opts.hoaMonthly;

  return {
    maxPrice,
    downPayment: opts.downPayment,
    loanAmount,
    monthlyPI,
    monthlyTotal: Math.round(monthlyTotal),
    frontRatio: grossMonthly ? monthlyTotal / grossMonthly : 0,
    backRatio: grossMonthly ? (monthlyTotal + opts.otherDebtMonthly) / grossMonthly : 0,
  };
}
