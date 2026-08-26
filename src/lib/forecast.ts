import type { AppState, CurrencyCode, ID } from '../store/types';
import { base, isTransfer, LIQUID_TYPES, rateOf, txInMonths } from '../store/selectors';
import { addDays, dateRange, monthRange, todayISO } from './date';
import { allOccurrences, monthlyEquivalentBase, type Occurrence } from './schedule';

/**
 * Day-to-day spending that is not on the schedule — groceries, coffee, the
 * unplanned. A forecast built only from fixed bills is always too optimistic, so
 * this is subtracted as a daily drip.
 */
export function variableDailySpend(state: AppState, month: string, months = 3): number {
  const txs = txInMonths(state, monthRange(month, months)).filter(
    (t) => base(t) < 0 && !isTransfer(state, t),
  );
  const total = Math.abs(txs.reduce((a, t) => a + base(t), 0));
  // Anything already represented on the schedule would otherwise be counted twice.
  const scheduledMonthly = state.scheduled
    .filter((s) => s.enabled && s.amount < 0)
    .reduce((a, s) => a + Math.abs(monthlyEquivalentBase(state, s)), 0);
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
  /**
   * The same projection run separately per currency, in native amounts.
   *
   * A combined base-currency forecast can look healthy while one currency is
   * about to run dry — dollars in a US account do not pay euro rent on the 3rd
   * without somebody making a transfer first. This is the number that catches
   * that.
   */
  byCurrency: CurrencyProjection[];
}

export interface CurrencyProjection {
  currency: CurrencyCode;
  startingBalance: number;
  low: number;
  lowDate: string;
  endBalance: number;
  /** Total leaving this currency's accounts across the window. */
  outflow: number;
  /** Total arriving, including transfers in. */
  inflow: number;
  shortfall: boolean;
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

  // Everything below is in base currency: adding a euro balance to a dollar one
  // would be meaningless. Per-currency figures are computed separately.
  const rateOfAccount = (accountId: ID): number => {
    const account = state.accounts.find((a) => a.id === accountId);
    return rateOf(state, account?.currency ?? state.settings.baseCurrency);
  };

  // The balance as of today only — future-dated entries are projected below, and
  // counting them here as well would double them.
  let startingBalance = operating.reduce(
    (total, a) => total + Math.round(a.openingBalance * rateOf(state, a.currency)),
    0,
  );
  for (const t of state.transactions) {
    if (operatingIds.has(t.accountId) && t.date <= from) startingBalance += t.baseAmount;
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
    push({
      date: t.date,
      amount: t.baseAmount,
      name: t.payee,
      kind: 'ledger',
      categoryId: t.categoryId,
    });
  }

  // Scheduled commitments, skipping any already recorded in the ledger.
  const occurrences: Occurrence[] = allOccurrences(state.scheduled, addDays(from, 1), to);
  for (const o of occurrences) {
    if (!operatingIds.has(o.accountId)) continue;
    // Both sides are native amounts on the same account, so no conversion here.
    const alreadyRecorded = state.transactions.some(
      (t) =>
        t.date === o.date &&
        t.accountId === o.accountId &&
        Math.abs(t.amount - o.amount) < 100 &&
        t.payee.toLowerCase().includes(o.name.toLowerCase().slice(0, 8)),
    );
    if (alreadyRecorded) continue;
    push({
      date: o.date,
      amount: Math.round(o.amount * rateOfAccount(o.accountId)),
      name: o.name,
      kind: 'scheduled',
      categoryId: o.categoryId,
    });
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

  const byCurrency = projectPerCurrency(state, operating, from, to, allDates);

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
    byCurrency,
  };
}

/**
 * Runs the projection once per currency, in that currency's own units. No
 * variable-spending drip here: it is a base-currency estimate and cannot be
 * attributed to one currency honestly.
 */
function projectPerCurrency(
  state: AppState,
  operating: AppState['accounts'],
  from: string,
  to: string,
  allDates: string[],
): CurrencyProjection[] {
  const currencies = [...new Set(operating.map((a) => a.currency))];
  if (currencies.length < 2) return [];

  return currencies.map((currency) => {
    const accounts = operating.filter((a) => a.currency === currency);
    const ids = new Set(accounts.map((a) => a.id));

    let starting = accounts.reduce((total, a) => total + a.openingBalance, 0);
    for (const t of state.transactions) {
      if (ids.has(t.accountId) && t.date <= from) starting += t.amount;
    }

    const events = new Map<string, number>();
    let inflow = 0;
    let outflow = 0;
    const add = (date: string, amount: number) => {
      events.set(date, (events.get(date) ?? 0) + amount);
      if (amount > 0) inflow += amount;
      else outflow += Math.abs(amount);
    };

    for (const t of state.transactions) {
      if (!ids.has(t.accountId) || t.date <= from || t.date > to) continue;
      add(t.date, t.amount);
    }
    for (const o of allOccurrences(state.scheduled, addDays(from, 1), to)) {
      if (!ids.has(o.accountId)) continue;
      add(o.date, o.amount);
    }

    let balance = starting;
    let low = starting;
    let lowDate = from;
    for (const date of allDates) {
      balance += events.get(date) ?? 0;
      if (balance < low) {
        low = balance;
        lowDate = date;
      }
    }

    return {
      currency,
      startingBalance: starting,
      low,
      lowDate,
      endBalance: balance,
      inflow,
      outflow,
      shortfall: low < 0,
    };
  });
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
