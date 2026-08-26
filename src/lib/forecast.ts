import type { AppState, ID } from '../store/types';
import { isTransfer, LIQUID_TYPES, txInMonths } from '../store/selectors';
import { addDays, dateRange, monthRange, todayISO } from './date';
import { allOccurrences, monthlyEquivalent, type Occurrence } from './schedule';

/**
 * Day-to-day spending that is not on the schedule — groceries, coffee, the
 * unplanned. A forecast built only from fixed bills is always too optimistic, so
 * this is subtracted as a daily drip.
 */
export function variableDailySpend(state: AppState, month: string, months = 3): number {
  const txs = txInMonths(state, monthRange(month, months)).filter(
    (t) => t.amount < 0 && !isTransfer(state, t),
  );
  const total = Math.abs(txs.reduce((a, t) => a + t.amount, 0));
  // Anything already represented on the schedule would otherwise be counted twice.
  const scheduledMonthly = state.scheduled
    .filter((s) => s.enabled && s.amount < 0)
    .reduce((a, s) => a + Math.abs(monthlyEquivalent(s)), 0);
  const variableMonthly = Math.max(0, total / months - scheduledMonthly);
  return Math.round(variableMonthly / 30.4);
}

export interface ForecastEvent {
  date: string;
  amount: number;
  name: string;
  kind: 'scheduled' | 'ledger';
  categoryId?: ID;
}

export interface ForecastDay {
  date: string;
  /** Projected balance at the end of this day. */
  balance: number;
  events: ForecastEvent[];
}

export interface Forecast {
  days: ForecastDay[];
  startingBalance: number;
  /** The worst day in the window. */
  low: { date: string; balance: number };
  /** Date money next arrives, if any is expected. */
  nextIncomeDate: string | null;
  /** The trough between now and that next arrival. */
  lowBeforeIncome: number;
  /** The trough over the next 30 days — what safe-to-spend is actually based on. */
  lowNext30: number;
  /**
   * What can be spent today without pushing the next 30 days below the buffer.
   * Deliberately not measured only to the next payday: with a paycheck two days
   * out that would say "spend everything" the day before the rent leaves.
   * Negative means the buffer is already breached.
   */
  safeToSpend: number;
  /** Days until the balance would go negative, if it would. */
  daysUntilNegative: number | null;
  totalIn: number;
  totalOut: number;
  /** Everyday spending assumed per day on top of the scheduled items. */
  dailyVariable: number;
}

/**
 * Projects the operating balance forward day by day from three inputs: what is in
 * the spending accounts now, transactions already in the ledger with future
 * dates, and every scheduled commitment.
 */
export function buildForecast(
  state: AppState,
  horizonDays = 60,
  from = todayISO(),
  opts: { includeVariable?: boolean } = {},
): Forecast {
  const to = addDays(from, horizonDays);
  const dailyVariable = opts.includeVariable === false ? 0 : variableDailySpend(state, from.slice(0, 7));

  // Only spendable accounts: savings should not silently absorb the bills.
  const operating = state.accounts.filter(
    (a) => !a.archived && (a.type === 'checking' || a.type === 'cash'),
  );
  const operatingIds = new Set(operating.map((a) => a.id));

  // The balance as of today only — future-dated entries are projected below, and
  // counting them here as well would double them.
  let startingBalance = operating.reduce((total, a) => total + a.openingBalance, 0);
  for (const t of state.transactions) {
    if (operatingIds.has(t.accountId) && t.date <= from) startingBalance += t.amount;
  }

  const events = new Map<string, ForecastEvent[]>();
  const push = (e: ForecastEvent) => {
    const list = events.get(e.date) ?? [];
    list.push(e);
    events.set(e.date, list);
  };

  // Future-dated entries the couple has already recorded.
  for (const t of state.transactions) {
    if (t.date <= from || t.date > to) continue;
    if (!operatingIds.has(t.accountId)) continue;
    push({ date: t.date, amount: t.amount, name: t.payee, kind: 'ledger', categoryId: t.categoryId });
  }

  // Scheduled commitments, skipping any already recorded in the ledger.
  const occurrences: Occurrence[] = allOccurrences(state.scheduled, addDays(from, 1), to);
  for (const o of occurrences) {
    if (!operatingIds.has(o.accountId)) continue;
    const alreadyRecorded = state.transactions.some(
      (t) =>
        t.date === o.date &&
        Math.abs(t.amount - o.amount) < 100 &&
        t.payee.toLowerCase().includes(o.name.toLowerCase().slice(0, 8)),
    );
    if (alreadyRecorded) continue;
    push({ date: o.date, amount: o.amount, name: o.name, kind: 'scheduled', categoryId: o.categoryId });
  }

  let balance = startingBalance;
  const days: ForecastDay[] = [];
  const allDates = dateRange(from, to);
  for (const date of allDates) {
    const dayEvents = events.get(date) ?? [];
    balance += dayEvents.reduce((total, e) => total + e.amount, 0);
    // Today is already spent; the drip starts tomorrow.
    if (date > from) balance -= dailyVariable;
    days.push({ date, balance, events: dayEvents });
  }

  const low = days.reduce((worst, d) => (d.balance < worst.balance ? d : worst), days[0]);
  const nextIncome = days.find((d) => d.events.some((e) => e.amount > 0) && d.date > from);
  const beforeIncome = nextIncome ? days.filter((d) => d.date <= nextIncome.date) : days;
  const lowBeforeIncome = Math.min(...beforeIncome.map((d) => d.balance));
  const horizon30 = addDays(from, 30);
  const next30 = days.filter((d) => d.date <= horizon30);
  const lowNext30 = Math.min(...(next30.length ? next30 : days).map((d) => d.balance));
  const negativeDay = days.find((d) => d.balance < 0);

  const allEvents = days.flatMap((d) => d.events);
  return {
    days,
    startingBalance,
    low: { date: low?.date ?? from, balance: low?.balance ?? startingBalance },
    nextIncomeDate: nextIncome?.date ?? null,
    lowBeforeIncome,
    lowNext30,
    safeToSpend: lowNext30 - state.settings.safeToSpendBuffer,
    daysUntilNegative: negativeDay
      ? dateRange(from, negativeDay.date).length - 1
      : null,
    totalIn: allEvents.filter((e) => e.amount > 0).reduce((a, e) => a + e.amount, 0),
    totalOut:
      Math.abs(allEvents.filter((e) => e.amount < 0).reduce((a, e) => a + e.amount, 0)) +
      dailyVariable * Math.max(0, allDates.length - 1),
    dailyVariable,
  };
}

/** Committed outflow per month implied by the schedule, for budget comparison. */
export function committedByMonth(state: AppState, months: string[]): Record<string, number> {
  const out: Record<string, number> = Object.fromEntries(months.map((m) => [m, 0]));
  if (!months.length) return out;
  const from = `${months[0]}-01`;
  const to = `${months[months.length - 1]}-28`;
  for (const o of allOccurrences(state.scheduled, from, to)) {
    if (o.amount >= 0) continue;
    const m = o.date.slice(0, 7);
    if (m in out) out[m] += Math.abs(o.amount);
  }
  return out;
}

export const LIQUID = LIQUID_TYPES;
