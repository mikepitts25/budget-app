import type { AppState, Cadence, Scheduled, Transaction } from '../store/types';
import { addDays, addMonthsToDate, todayISO } from './date';
import { uid } from './id';
import { detectRecurring, type RecurringSeries } from './recurring';
import { recurringCandidates } from './savings';
import { monthRange } from './date';
import { txInMonths } from '../store/selectors';

/** Advance one occurrence. Semimonthly means the 1st and the 15th. */
export function nextDate(date: string, cadence: Cadence): string {
  switch (cadence) {
    case 'weekly':
      return addDays(date, 7);
    case 'biweekly':
      return addDays(date, 14);
    case 'semimonthly': {
      const day = Number(date.slice(8, 10));
      if (day < 15) return `${date.slice(0, 8)}15`;
      return `${addMonthsToDate(date, 1).slice(0, 8)}01`;
    }
    case 'monthly':
      return addMonthsToDate(date, 1);
    case 'quarterly':
      return addMonthsToDate(date, 3);
    case 'annual':
      return addMonthsToDate(date, 12);
  }
}

export interface Occurrence {
  date: string;
  amount: number;
  name: string;
  scheduledId: string;
  categoryId: string;
  accountId: string;
}

/** Every occurrence of one scheduled item within a window. */
export function occurrencesBetween(item: Scheduled, from: string, to: string): Occurrence[] {
  if (!item.enabled) return [];
  const out: Occurrence[] = [];
  let cursor = item.nextDate;

  // Fast-forward a stale schedule to the window without emitting the past.
  let guard = 0;
  while (cursor < from && guard++ < 500) cursor = nextDate(cursor, item.cadence);

  while (cursor <= to && out.length < 400) {
    if (item.endDate && cursor > item.endDate) break;
    out.push({
      date: cursor,
      amount: item.amount,
      name: item.name,
      scheduledId: item.id,
      categoryId: item.categoryId,
      accountId: item.accountId,
    });
    cursor = nextDate(cursor, item.cadence);
  }
  return out;
}

export const allOccurrences = (items: Scheduled[], from: string, to: string): Occurrence[] =>
  items
    .flatMap((i) => occurrencesBetween(i, from, to))
    .sort((a, b) => a.date.localeCompare(b.date));

/**
 * The same figure converted to base currency. Any total that adds several
 * schedules together must use this — a euro rent and a dollar gym membership
 * cannot be summed in their own units.
 */
export const monthlyEquivalentBase = (state: AppState, item: Scheduled): number => {
  const rate =
    item.currency === state.settings.baseCurrency
      ? 1
      : (state.rates?.[item.currency]?.rate ?? 1);
  return Math.round(monthlyEquivalent(item) * rate);
};

/** Normalized monthly cost of a schedule, in its own currency. */
export const monthlyEquivalent = (item: Scheduled): number => {
  const perMonth: Record<Cadence, number> = {
    weekly: 52 / 12,
    biweekly: 26 / 12,
    semimonthly: 2,
    monthly: 1,
    quarterly: 1 / 3,
    annual: 1 / 12,
  };
  return Math.round(item.amount * perMonth[item.cadence]);
};

const CADENCE_FROM_SERIES: Record<RecurringSeries['cadence'], Cadence> = {
  weekly: 'weekly',
  biweekly: 'biweekly',
  monthly: 'monthly',
  quarterly: 'quarterly',
  annual: 'annual',
  irregular: 'monthly',
};

/**
 * Turns detected recurring series into schedule candidates the couple can accept.
 * Series already accepted are skipped, so the same subscription is never proposed
 * twice.
 */
export function proposeSchedules(state: AppState, month: string): Scheduled[] {
  const known = new Set(state.scheduled.map((s) => s.sourceKey).filter(Boolean));
  const series = detectRecurring(
    recurringCandidates(state, txInMonths(state, monthRange(month, 6))),
  );
  const today = todayISO();

  return series
    .filter((s) => !known.has(s.key) && s.cadence !== 'irregular')
    .map((s) => {
      const last = s.transactions[s.transactions.length - 1];
      let next = nextDate(s.lastDate, CADENCE_FROM_SERIES[s.cadence]);
      let guard = 0;
      while (next < today && guard++ < 60) next = nextDate(next, CADENCE_FROM_SERIES[s.cadence]);
      return {
        id: uid('sch'),
        name: s.payee,
        amount: -s.typicalAmount,
        currency: last.currency,
        accountId: last.accountId,
        categoryId: s.categoryId,
        cadence: CADENCE_FROM_SERIES[s.cadence],
        nextDate: next,
        paidBy: last.paidBy,
        splitRule: last.splitRule,
        enabled: true,
        autoDetected: true,
        sourceKey: s.key,
      };
    });
}

/** Detects the pay pattern from actual income, so forecasts know when money lands. */
export function proposeIncome(state: AppState, month: string): Scheduled[] {
  const known = new Set(state.scheduled.map((s) => s.sourceKey).filter(Boolean));
  const incomeTx = txInMonths(state, monthRange(month, 6)).filter((t) => t.amount > 0 && !t.transferId);
  const series = detectRecurring(incomeTx.map((t) => ({ ...t, amount: -t.amount }) as Transaction));
  const today = todayISO();

  return series
    .filter((s) => !known.has(`income:${s.key}`))
    .map((s) => {
      const last = s.transactions[s.transactions.length - 1];
      let next = nextDate(s.lastDate, CADENCE_FROM_SERIES[s.cadence]);
      let guard = 0;
      while (next < today && guard++ < 60) next = nextDate(next, CADENCE_FROM_SERIES[s.cadence]);
      return {
        id: uid('sch'),
        name: s.payee,
        amount: s.typicalAmount,
        currency: last.currency,
        accountId: last.accountId,
        categoryId: last.categoryId,
        cadence: CADENCE_FROM_SERIES[s.cadence],
        nextDate: next,
        paidBy: last.paidBy,
        splitRule: last.splitRule,
        enabled: true,
        autoDetected: true,
        sourceKey: `income:${s.key}`,
      };
    });
}
