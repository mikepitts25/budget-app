import type { Transaction } from '../store/types';
import { monthOf } from './date';

/** Base-currency value, so a euro subscription ranks against a dollar one. */
const value = (tx: Transaction): number => tx.baseAmount ?? tx.amount;

export interface RecurringSeries {
  key: string;
  payee: string;
  categoryId: string;
  /** Median amount per occurrence, in cents (positive magnitude). */
  typicalAmount: number;
  /** Median gap between charges, in days. */
  cadenceDays: number;
  cadence: 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'annual' | 'irregular';
  occurrences: number;
  lastDate: string;
  monthlyCost: number;
  annualCost: number;
  /** Charge grew by more than 5% between the first and last occurrence. */
  priceIncrease: number;
  transactions: Transaction[];
}

const norm = (payee: string): string =>
  payee
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\b(inc|llc|ltd|co|com|www|http|https|payment|autopay|recurring|pos|debit|card)\b/g, '')
    .replace(/\d{3,}/g, '')
    .replace(/\s+/g, ' ')
    .trim();

const median = (xs: number[]): number => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
};

const daysBetween = (a: string, b: string): number =>
  Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);

function classify(days: number): RecurringSeries['cadence'] {
  if (days >= 5 && days <= 9) return 'weekly';
  if (days >= 12 && days <= 16) return 'biweekly';
  if (days >= 26 && days <= 35) return 'monthly';
  if (days >= 84 && days <= 98) return 'quarterly';
  if (days >= 350 && days <= 380) return 'annual';
  return 'irregular';
}

const perMonth: Record<RecurringSeries['cadence'], number> = {
  weekly: 52 / 12,
  biweekly: 26 / 12,
  monthly: 1,
  quarterly: 1 / 3,
  annual: 1 / 12,
  irregular: 1,
};

/**
 * Groups outgoing transactions by normalized payee and keeps the groups that
 * look like a subscription: 3+ charges at a steady cadence and a steady price.
 */
export function detectRecurring(transactions: Transaction[]): RecurringSeries[] {
  const groups = new Map<string, Transaction[]>();
  for (const tx of transactions) {
    if (value(tx) >= 0) continue;
    const key = norm(tx.payee);
    if (key.length < 3) continue;
    const list = groups.get(key) ?? [];
    list.push(tx);
    groups.set(key, list);
  }

  const out: RecurringSeries[] = [];
  for (const [key, txsRaw] of groups) {
    if (txsRaw.length < 3) continue;
    const txs = [...txsRaw].sort((a, b) => a.date.localeCompare(b.date));
    const gaps: number[] = [];
    for (let i = 1; i < txs.length; i++) gaps.push(daysBetween(txs[i - 1].date, txs[i].date));
    const cadenceDays = median(gaps);
    if (cadenceDays < 5) continue; // several charges a week is shopping, not a subscription

    const amounts = txs.map((t) => Math.abs(value(t)));
    const typical = median(amounts);
    if (typical <= 0) continue;
    // Prices must be stable: 80% of charges within 15% of the median.
    const stable = amounts.filter((a) => Math.abs(a - typical) / typical <= 0.15).length;
    if (stable / amounts.length < 0.8) continue;
    // Cadence must be regular: 70% of gaps within 25% of the median gap.
    const regular = gaps.filter((g) => Math.abs(g - cadenceDays) / cadenceDays <= 0.25).length;
    if (regular / gaps.length < 0.7) continue;

    const cadence = classify(cadenceDays);
    const monthlyCost = Math.round(typical * perMonth[cadence]);
    out.push({
      key,
      payee: txs[txs.length - 1].payee,
      categoryId: txs[txs.length - 1].categoryId,
      typicalAmount: typical,
      cadenceDays,
      cadence,
      occurrences: txs.length,
      lastDate: txs[txs.length - 1].date,
      monthlyCost,
      annualCost: monthlyCost * 12,
      priceIncrease: Math.abs(value(txs[0])) > 0
        ? (amounts[amounts.length - 1] - amounts[0]) / amounts[0]
        : 0,
      transactions: txs,
    });
  }
  return out.sort((a, b) => b.annualCost - a.annualCost);
}

/** Series with no charge in the last two months — likely cancelled or forgotten. */
export function staleSeries(series: RecurringSeries[], today: string): RecurringSeries[] {
  return series.filter(
    (s) => s.cadence !== 'annual' && daysBetween(s.lastDate, today) > Math.max(45, s.cadenceDays * 2),
  );
}

/** Total committed monthly outflow implied by all detected series. */
export function committedMonthly(series: RecurringSeries[]): number {
  return series.reduce((a, s) => a + s.monthlyCost, 0);
}

export function occurrencesByMonth(series: RecurringSeries): Record<string, number> {
  const out: Record<string, number> = {};
  for (const tx of series.transactions) {
    const m = monthOf(tx.date);
    out[m] = (out[m] ?? 0) + Math.abs(value(tx));
  }
  return out;
}
