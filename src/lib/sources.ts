/**
 * Provider-agnostic ingestion.
 *
 * Every way transactions can enter the app — a CSV, an OFX file, a bank
 * aggregator — satisfies the same interface, so adding live bank connections
 * later means writing one adapter rather than touching the app. The adapters
 * that need a server say so explicitly instead of pretending to work in a
 * browser.
 */

import type { Account, AppState, ID, Transaction } from '../store/types';
import { uid } from './id';
import { learnPayeeCategories, matchCategory } from './csv';
import { parseStatement } from './ofx';
import { categorizeIncoming } from './rules';

export interface SourceTransaction {
  date: string;
  amount: number;
  payee: string;
  memo?: string;
  /** Stable id from the source, when it has one. */
  externalId?: string;
  pending?: boolean;
}

export interface SourceAccount {
  externalId: string;
  name: string;
  type?: string;
  balance?: number;
}

export interface FetchResult {
  accounts: SourceAccount[];
  transactions: SourceTransaction[];
  /** Cursor for the next incremental fetch, where the provider supports one. */
  cursor?: string;
  warnings: string[];
}

export interface TransactionSource {
  id: string;
  label: string;
  /** Whether this source can run entirely in the browser. */
  requiresBackend: boolean;
  description: string;
  /** File-based sources parse a blob; connected ones ignore it. */
  fetch(input: { file?: { name: string; text: string }; cursor?: string }): Promise<FetchResult>;
}

/* ------------------------------------------------------------ file sources */

export const ofxSource: TransactionSource = {
  id: 'ofx',
  label: 'OFX / QFX / QIF file',
  requiresBackend: false,
  description:
    'Bank exports in Quicken formats. Every transaction carries the bank’s own id, so re-importing an overlapping statement is exact rather than guessed.',
  async fetch({ file }) {
    if (!file) return { accounts: [], transactions: [], warnings: ['No file provided'] };
    const parsed = parseStatement(file.text, file.name);
    return {
      accounts: parsed.accountId
        ? [
            {
              externalId: parsed.accountId,
              name: `${parsed.accountType ?? 'Account'} ${parsed.accountId.slice(-4)}`,
              type: parsed.accountType,
              balance: parsed.balance,
            },
          ]
        : [],
      transactions: parsed.transactions.map((t) => ({
        date: t.date,
        amount: t.amount,
        payee: t.payee,
        memo: t.memo,
        externalId: t.externalId,
      })),
      warnings:
        parsed.transactions.length === 0
          ? ['No transactions found — the file may be a format this parser does not recognise.']
          : [],
    };
  },
};

/* ------------------------------------------------- connected-source stubs */

/**
 * SimpleFIN is the realistic option for a household: read-only, about $1.50 a
 * month, and no OAuth dance. It still cannot run from a page, because the access
 * token would be readable by anyone with the browser open and CORS will refuse
 * the request anyway.
 */
export const simplefinSource: TransactionSource = {
  id: 'simplefin',
  label: 'SimpleFIN Bridge',
  requiresBackend: true,
  description:
    'Read-only bank access for a few dollars a month. Needs a small server to hold the access token and proxy the request — see BANKING.md.',
  async fetch() {
    throw new Error(
      'SimpleFIN needs a backend to hold the access token. See BANKING.md for the minimal server.',
    );
  },
};

export const plaidSource: TransactionSource = {
  id: 'plaid',
  label: 'Plaid',
  requiresBackend: true,
  description:
    'Widest US coverage and the best developer experience. Requires a server for token exchange, webhooks and re-auth handling.',
  async fetch() {
    throw new Error('Plaid requires a backend for token exchange. See BANKING.md.');
  },
};

export const SOURCES: TransactionSource[] = [ofxSource, simplefinSource, plaidSource];

/* ------------------------------------------------------------ ingestion */

export interface IngestResult {
  transactions: Transaction[];
  duplicates: number;
  skipped: number;
  matchedByExternalId: number;
}

/**
 * Converts source rows into transactions for one account.
 *
 * Deduplication prefers the provider's own id and falls back to date, amount and
 * payee. That fallback is why file formats carrying a FITID are worth
 * preferring: a statement that overlaps last week's import is then exact.
 */
export function ingest(
  state: AppState,
  rows: SourceTransaction[],
  ctx: { account: Account; paidBy: ID | 'joint'; defaultCategoryId: ID },
): IngestResult {
  const byExternal = new Set(
    state.transactions.map((t) => t.externalId).filter(Boolean) as string[],
  );
  const bySignature = new Set(
    state.transactions.map((t) => `${t.date}|${t.amount}|${t.payee.toLowerCase()}`),
  );
  const learned = learnPayeeCategories(state.transactions);

  const out: Transaction[] = [];
  let duplicates = 0;
  let skipped = 0;
  let matchedByExternalId = 0;

  for (const row of rows) {
    if (!row.date || !row.amount) {
      skipped += 1;
      continue;
    }
    if (row.externalId && byExternal.has(row.externalId)) {
      duplicates += 1;
      matchedByExternalId += 1;
      continue;
    }
    const signature = `${row.date}|${row.amount}|${row.payee.toLowerCase()}`;
    if (!row.externalId && bySignature.has(signature)) {
      duplicates += 1;
      continue;
    }
    if (row.externalId) byExternal.add(row.externalId);
    bySignature.add(signature);

    out.push({
      id: uid('tx'),
      date: row.date,
      amount: row.amount,
      accountId: ctx.account.id,
      categoryId: matchCategory(row.payee, learned) ?? ctx.defaultCategoryId,
      payee: row.payee || 'Unknown',
      note: row.memo ?? '',
      paidBy: ctx.paidBy,
      splitRule: state.settings.defaultSplit,
      splitShares: {},
      tags: ['imported'],
      status: row.pending ? 'pending' : 'cleared',
      externalId: row.externalId,
      comments: [],
      approvals: [],
      private: false,
    });
  }

  // Rules get the final say, exactly as they do for anything typed in by hand.
  return {
    transactions: categorizeIncoming(state, out),
    duplicates,
    skipped,
    matchedByExternalId,
  };
}
