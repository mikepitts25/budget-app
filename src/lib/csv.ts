import type { Account, AppState, Category, ID, Transaction } from '../store/types';
import { toCents } from './money';
import { makeTransaction } from '../store/factory';

/** RFC4180-ish parser: handles quoted fields, embedded commas and newlines. */
export function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const src = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

export function toCSV(rows: (string | number)[][]): string {
  return rows
    .map((r) =>
      r
        .map((cell) => {
          const s = String(cell ?? '');
          return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        })
        .join(','),
    )
    .join('\n');
}

export interface ColumnMap {
  date: number;
  amount: number;
  payee: number;
  /** Some exports use separate debit/credit columns instead of a signed amount. */
  debit?: number;
  credit?: number;
  category?: number;
  note?: number;
}

const HEADER_HINTS: Record<keyof ColumnMap, RegExp> = {
  date: /^(date|transaction date|posted|posting date|when)$/i,
  amount: /^(amount|value|transaction amount)$/i,
  payee: /^(payee|description|merchant|name|details|memo)$/i,
  debit: /^(debit|withdrawal|money out|paid out)$/i,
  credit: /^(credit|deposit|money in|paid in)$/i,
  category: /^(category|type|class)$/i,
  note: /^(note|notes|memo|reference)$/i,
};

/** Best-effort header detection so most bank exports import without mapping. */
export function guessColumns(header: string[]): Partial<ColumnMap> {
  const out: Partial<ColumnMap> = {};
  header.forEach((raw, i) => {
    const h = raw.trim();
    (Object.keys(HEADER_HINTS) as (keyof ColumnMap)[]).forEach((key) => {
      if (out[key] === undefined && HEADER_HINTS[key].test(h)) out[key] = i;
    });
  });
  return out;
}

const normalizeDate = (raw: string): string => {
  const s = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const mdy = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (mdy) {
    const [, a, b, c] = mdy;
    const year = c.length === 2 ? `20${c}` : c;
    return `${year}-${a.padStart(2, '0')}-${b.padStart(2, '0')}`;
  }
  const parsed = Date.parse(s);
  if (!isNaN(parsed)) return new Date(parsed).toISOString().slice(0, 10);
  return '';
};

export interface ImportResult {
  transactions: Transaction[];
  skipped: number;
  duplicates: number;
}

/**
 * Turns parsed CSV rows into transactions, auto-categorizing by payee history
 * and skipping rows that already exist (same date, amount and payee).
 */
export function rowsToTransactions(
  rows: string[][],
  map: Partial<ColumnMap>,
  ctx: {
    state: AppState;
    account: Account;
    categories: Category[];
    existing: Transaction[];
    defaultCategoryId: ID;
    paidBy: ID | 'joint';
    hasHeader: boolean;
  },
): ImportResult {
  const body = ctx.hasHeader ? rows.slice(1) : rows;
  const seen = new Set(ctx.existing.map((t) => `${t.date}|${t.amount}|${t.payee.toLowerCase()}`));
  const learned = learnPayeeCategories(ctx.existing);
  const out: Transaction[] = [];
  let skipped = 0;
  let duplicates = 0;

  for (const row of body) {
    const date = normalizeDate(row[map.date ?? 0] ?? '');
    const payee = (row[map.payee ?? 1] ?? '').trim();
    let amount = 0;
    if (map.amount !== undefined && row[map.amount]) amount = toCents(row[map.amount]);
    else {
      const debit = map.debit !== undefined ? toCents(row[map.debit] ?? '0') : 0;
      const credit = map.credit !== undefined ? toCents(row[map.credit] ?? '0') : 0;
      amount = credit - Math.abs(debit);
    }
    if (!date || !amount) {
      skipped += 1;
      continue;
    }
    const sig = `${date}|${amount}|${payee.toLowerCase()}`;
    if (seen.has(sig)) {
      duplicates += 1;
      continue;
    }
    seen.add(sig);

    const namedCategory =
      map.category !== undefined
        ? ctx.categories.find(
            (c) => c.name.toLowerCase() === (row[map.category!] ?? '').trim().toLowerCase(),
          )?.id
        : undefined;
    const learnedMatch = matchCategory(payee, learned);

    out.push(
      makeTransaction(ctx.state, {
        date,
        amount,
        accountId: ctx.account.id,
        categoryId: namedCategory ?? learnedMatch?.categoryId ?? ctx.defaultCategoryId,
        payee: payee || 'Unknown',
        note: map.note !== undefined ? (row[map.note] ?? '').trim() : '',
        paidBy: ctx.paidBy,
        splitRule: 'even',
        tags: ['imported'],
        categorySource: namedCategory ? 'imported' : learnedMatch ? 'learned' : 'default',
        categoryConfidence: namedCategory ? undefined : learnedMatch?.confidence,
      }),
    );
  }
  return { transactions: out, skipped, duplicates };
}

const keyOf = (payee: string): string =>
  payee.toLowerCase().replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();

export interface LearnedCategory {
  categoryId: ID;
  /** Share of this payee's history that used the winning category, 0..1. */
  confidence: number;
  samples: number;
}

/**
 * Payee -> most-used category, learned from what the couple has already filed.
 * A category a person chose by hand counts for more than one the app guessed,
 * so correcting a mislabelled transaction actually teaches the matcher rather
 * than being outvoted by the guesses it is meant to fix.
 */
export function learnPayeeCategories(existing: Transaction[]): Map<string, LearnedCategory> {
  const MANUAL_WEIGHT = 4;
  const counts = new Map<string, Map<ID, number>>();
  for (const t of existing) {
    const k = keyOf(t.payee);
    if (!k) continue;
    const weight = t.categorySource === 'manual' ? MANUAL_WEIGHT : 1;
    const inner = counts.get(k) ?? new Map<ID, number>();
    inner.set(t.categoryId, (inner.get(t.categoryId) ?? 0) + weight);
    counts.set(k, inner);
  }

  const out = new Map<string, LearnedCategory>();
  for (const [k, inner] of counts) {
    const entries = [...inner.entries()].sort((a, b) => b[1] - a[1]);
    const total = entries.reduce((sum, [, n]) => sum + n, 0);
    const [categoryId, weight] = entries[0];
    out.set(k, { categoryId, confidence: total ? weight / total : 0, samples: total });
  }
  return out;
}

export function matchCategory(
  payee: string,
  learned: Map<string, LearnedCategory>,
): LearnedCategory | undefined {
  const k = keyOf(payee);
  if (!k) return undefined;
  const exact = learned.get(k);
  if (exact) return exact;
  // Fall back to the longest known payee that is a substring of this one, and
  // discount it, since a partial name is weaker evidence than an exact one.
  let best: { key: string; match: LearnedCategory } | undefined;
  for (const [known, match] of learned) {
    if (known.length < 4) continue;
    if (k.includes(known) && (!best || known.length > best.key.length)) best = { key: known, match };
  }
  return best ? { ...best.match, confidence: best.match.confidence * 0.75 } : undefined;
}

export function transactionsToCSV(
  txs: Transaction[],
  categories: Category[],
  accounts: Account[],
): string {
  const cat = new Map(categories.map((c) => [c.id, c.name]));
  const acc = new Map(accounts.map((a) => [a.id, a.name]));
  const rows: (string | number)[][] = [
    ['Date', 'Payee', 'Amount', 'Category', 'Account', 'Paid by', 'Split', 'Note', 'Tags'],
    ...txs.map((t) => [
      t.date,
      t.payee,
      (t.amount / 100).toFixed(2),
      cat.get(t.categoryId) ?? '',
      acc.get(t.accountId) ?? '',
      t.paidBy,
      t.splitRule,
      t.note,
      t.tags.join(' '),
    ]),
  ];
  return toCSV(rows);
}
