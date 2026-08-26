import type { AppState, Category, ID, Transaction } from './types';
import { addMonths, monthOf, monthRange } from '../lib/date';
import { sum } from '../lib/money';

export const byId = <T extends { id: ID }>(xs: T[]): Record<ID, T> =>
  Object.fromEntries(xs.map((x) => [x.id, x]));

export const categoryMap = (state: AppState): Record<ID, Category> => byId(state.categories);

export const txInMonth = (state: AppState, month: string): Transaction[] =>
  state.transactions.filter((t) => monthOf(t.date) === month);

export const txInMonths = (state: AppState, months: string[]): Transaction[] => {
  const set = new Set(months);
  return state.transactions.filter((t) => set.has(monthOf(t.date)));
};

export const income = (txs: Transaction[], state?: AppState): number =>
  sum(
    txs
      .filter((t) => t.amount > 0 && !(state && isTransfer(state, t)))
      .map((t) => t.amount),
  );

/**
 * Money moved between your own accounts, or into savings and investments, is not
 * consumption — it is the point. Counting it as spending would make every
 * disciplined month look like an expensive one.
 */
export const isTransfer = (state: AppState, tx: Transaction): boolean =>
  Boolean(tx.transferId) || categoryMap(state)[tx.categoryId]?.group === 'Savings';

/** Outflow that was actually consumed: excludes transfers between your accounts. */
export const expense = (state: AppState, txs: Transaction[]): number =>
  Math.abs(sum(txs.filter((t) => t.amount < 0 && !isTransfer(state, t)).map((t) => t.amount)));

/** Outflow that went into savings, investments or goal funding. */
export const transfers = (state: AppState, txs: Transaction[]): number =>
  Math.abs(sum(txs.filter((t) => t.amount < 0 && isTransfer(state, t)).map((t) => t.amount)));

export interface MonthSummary {
  month: string;
  income: number;
  /** Consumption only. */
  expense: number;
  /** Deliberate moves into savings and investments. */
  transfers: number;
  /** Income minus consumption — what the month actually kept. */
  net: number;
  savingsRate: number;
}

export function monthSummary(state: AppState, month: string): MonthSummary {
  const txs = txInMonth(state, month);
  const inc = income(txs, state);
  const exp = expense(state, txs);
  return {
    month,
    income: inc,
    expense: exp,
    transfers: transfers(state, txs),
    net: inc - exp,
    savingsRate: inc > 0 ? (inc - exp) / inc : 0,
  };
}

export const monthSeries = (state: AppState, endMonth: string, count: number): MonthSummary[] =>
  monthRange(endMonth, count).map((m) => monthSummary(state, m));

/** Spend per category for a month (positive cents), largest first. */
export function spendByCategory(
  state: AppState,
  month: string,
  includeTransfers = true,
): { categoryId: ID; amount: number }[] {
  const cats = categoryMap(state);
  const totals = new Map<ID, number>();
  for (const t of txInMonth(state, month)) {
    if (t.amount >= 0) continue;
    if (t.transferId) continue;
    if (!includeTransfers && cats[t.categoryId]?.group === 'Savings') continue;
    totals.set(t.categoryId, (totals.get(t.categoryId) ?? 0) + Math.abs(t.amount));
  }
  return [...totals.entries()]
    .map(([categoryId, amount]) => ({ categoryId, amount }))
    .sort((a, b) => b.amount - a.amount);
}

/** Monthly essential spending, averaged over the trailing window. */
export function essentialMonthly(state: AppState, endMonth: string, months = 3): number {
  const cats = categoryMap(state);
  return Math.round(
    sum(
      txInMonths(state, monthRange(endMonth, months))
        .filter((t) => t.amount < 0 && !isTransfer(state, t) && cats[t.categoryId]?.essential)
        .map((t) => Math.abs(t.amount)),
    ) / months,
  );
}

/** Average monthly spend in a category over the N months ending at `endMonth`. */
export function categoryAverage(
  state: AppState,
  categoryId: ID,
  endMonth: string,
  months = 3,
): number {
  const range = monthRange(endMonth, months);
  const total = sum(
    txInMonths(state, range)
      .filter((t) => t.categoryId === categoryId && t.amount < 0)
      .map((t) => Math.abs(t.amount)),
  );
  return Math.round(total / months);
}

export interface BudgetStatus {
  categoryId: ID;
  planned: number;
  actual: number;
  remaining: number;
  /** Carried in from prior months on rollover envelopes. */
  carried: number;
  available: number;
  pace: number;
  over: boolean;
}

export function budgetStatus(state: AppState, month: string): BudgetStatus[] {
  const spend = new Map(spendByCategory(state, month).map((s) => [s.categoryId, s.amount]));
  const lines = state.budget.filter((b) => b.month === month);
  const seen = new Set<ID>();
  const rows: BudgetStatus[] = [];

  for (const line of lines) {
    seen.add(line.categoryId);
    const actual = spend.get(line.categoryId) ?? 0;
    const carried = line.rollover ? rolloverBalance(state, line.categoryId, month) : 0;
    const available = line.planned + carried - actual;
    rows.push({
      categoryId: line.categoryId,
      planned: line.planned,
      actual,
      carried,
      remaining: line.planned - actual,
      available,
      pace: line.planned > 0 ? actual / line.planned : actual > 0 ? Infinity : 0,
      over: actual > line.planned + carried,
    });
  }
  // Spending in a category with no envelope still needs to be visible.
  for (const [categoryId, actual] of spend) {
    if (seen.has(categoryId)) continue;
    rows.push({
      categoryId,
      planned: 0,
      actual,
      carried: 0,
      remaining: -actual,
      available: -actual,
      pace: Infinity,
      over: true,
    });
  }
  return rows;
}

/** Unspent envelope money carried forward from earlier months (rollover only). */
function rolloverBalance(state: AppState, categoryId: ID, month: string): number {
  let carried = 0;
  for (let i = 1; i <= 12; i++) {
    const m = addMonths(month, -i);
    const line = state.budget.find((b) => b.month === m && b.categoryId === categoryId);
    if (!line || !line.rollover) break;
    const actual = sum(
      txInMonth(state, m)
        .filter((t) => t.categoryId === categoryId && t.amount < 0)
        .map((t) => Math.abs(t.amount)),
    );
    carried += line.planned - actual;
  }
  return Math.max(0, carried);
}

export const LIABILITY_TYPES = new Set(['credit', 'loan']);

/**
 * Live balance for one account: what it opened with, plus everything that has
 * moved through it since. Nothing writes a balance directly.
 */
export function accountBalance(state: AppState, accountId: ID): number {
  let balance = state.accounts.find((a) => a.id === accountId)?.openingBalance ?? 0;
  for (const t of state.transactions) if (t.accountId === accountId) balance += t.amount;
  return balance;
}

/** Every account's live balance in one pass, for pages that need them all. */
export function accountBalances(state: AppState): Record<ID, number> {
  const out: Record<ID, number> = Object.fromEntries(
    state.accounts.map((a) => [a.id, a.openingBalance]),
  );
  for (const t of state.transactions) {
    if (t.accountId in out) out[t.accountId] += t.amount;
  }
  return out;
}

/** Balance counting only settled money — what the bank would agree with today. */
export function clearedBalance(state: AppState, accountId: ID): number {
  let balance = state.accounts.find((a) => a.id === accountId)?.openingBalance ?? 0;
  for (const t of state.transactions) {
    if (t.accountId === accountId && t.status !== 'pending') balance += t.amount;
  }
  return balance;
}

export function netWorth(state: AppState): { assets: number; liabilities: number; net: number } {
  const balances = accountBalances(state);
  let assets = 0;
  let liabilities = 0;
  for (const a of state.accounts) {
    if (a.archived) continue;
    const balance = balances[a.id] ?? 0;
    if (LIABILITY_TYPES.has(a.type)) liabilities += Math.abs(balance);
    else assets += balance;
  }
  liabilities += state.debts.reduce((acc, d) => acc + Math.max(0, d.balance), 0);
  return { assets, liabilities, net: assets - liabilities };
}

export const LIQUID_TYPES = new Set(['checking', 'savings', 'cash']);

/** Cash you could actually reach today. */
export function liquidCash(state: AppState): number {
  const balances = accountBalances(state);
  return state.accounts
    .filter((a) => !a.archived && LIQUID_TYPES.has(a.type))
    .reduce((total, a) => total + (balances[a.id] ?? 0), 0);
}

/** Months of essential spending covered by liquid savings. */
export function runwayMonths(state: AppState, endMonth: string): number {
  const liquid = liquidCash(state);
  const monthly = essentialMonthly(state, endMonth, 3);
  return monthly > 0 ? liquid / monthly : 0;
}

/** Take-home income minus spending, averaged over N months — the real surplus. */
export function averageSurplus(state: AppState, endMonth: string, months = 3): number {
  const s = monthSeries(state, endMonth, months);
  return Math.round(sum(s.map((m) => m.net)) / months);
}
