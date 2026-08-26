import type { Debt } from '../store/types';

export interface PayoffStep {
  month: number;
  balances: Record<string, number>;
  totalBalance: number;
  interestPaid: number;
}

export interface PayoffPlan {
  strategy: 'snowball' | 'avalanche';
  months: number;
  totalInterest: number;
  totalPaid: number;
  /** Debt id -> month it hits zero. */
  payoffMonth: Record<string, number>;
  track: PayoffStep[];
  /** True when the minimums do not even cover the interest. */
  impossible: boolean;
}

/**
 * Simulates payoff month by month. Every debt gets its minimum; whatever is left
 * of `monthlyBudget` is thrown at the focus debt, and freed-up minimums roll
 * forward as each debt clears.
 */
export function simulatePayoff(
  debts: Debt[],
  monthlyBudget: number,
  strategy: 'snowball' | 'avalanche',
  maxMonths = 600,
): PayoffPlan {
  const active = debts.filter((d) => d.balance > 0).map((d) => ({ ...d }));
  const payoffMonth: Record<string, number> = {};
  const track: PayoffStep[] = [];
  let totalInterest = 0;
  let totalPaid = 0;
  let month = 0;

  const order = () =>
    [...active]
      .filter((d) => d.balance > 0)
      .sort((a, b) =>
        strategy === 'snowball' ? a.balance - b.balance : b.apr - a.apr || a.balance - b.balance,
      );

  while (active.some((d) => d.balance > 0) && month < maxMonths) {
    month += 1;
    let budget = monthlyBudget;
    let interestThisMonth = 0;

    for (const d of active) {
      if (d.balance <= 0) continue;
      const interest = Math.round((d.balance * d.apr) / 12);
      d.balance += interest;
      interestThisMonth += interest;
    }

    // Minimums first.
    for (const d of active) {
      if (d.balance <= 0) continue;
      const pay = Math.min(d.balance, Math.min(d.minPayment, Math.max(0, budget)));
      d.balance -= pay;
      budget -= pay;
      totalPaid += pay;
      if (d.balance <= 0) payoffMonth[d.id] = month;
    }

    // Everything left goes to the focus debt, cascading as debts clear.
    for (const d of order()) {
      if (budget <= 0) break;
      const pay = Math.min(d.balance, budget);
      d.balance -= pay;
      budget -= pay;
      totalPaid += pay;
      if (d.balance <= 0) payoffMonth[d.id] = month;
    }

    totalInterest += interestThisMonth;
    track.push({
      month,
      balances: Object.fromEntries(active.map((d) => [d.id, Math.max(0, d.balance)])),
      totalBalance: active.reduce((a, d) => a + Math.max(0, d.balance), 0),
      interestPaid: totalInterest,
    });

    // No progress at all this month means the budget cannot beat the interest.
    if (month > 1 && track[month - 1].totalBalance >= track[month - 2].totalBalance) {
      return {
        strategy,
        months: Infinity,
        totalInterest,
        totalPaid,
        payoffMonth,
        track,
        impossible: true,
      };
    }
  }

  return {
    strategy,
    months: month,
    totalInterest,
    totalPaid,
    payoffMonth,
    track,
    impossible: month >= maxMonths,
  };
}

export const totalMinimums = (debts: Debt[]): number =>
  debts.filter((d) => d.balance > 0).reduce((a, d) => a + d.minPayment, 0);

export const totalDebt = (debts: Debt[]): number =>
  debts.reduce((a, d) => a + Math.max(0, d.balance), 0);

/** Blended interest rate across all balances. */
export function weightedApr(debts: Debt[]): number {
  const total = totalDebt(debts);
  if (!total) return 0;
  return debts.reduce((a, d) => a + (d.apr * Math.max(0, d.balance)) / total, 0);
}
