/**
 * Constructors for the record types.
 *
 * Everything that creates a transaction — the UI, CSV and OFX import, the demo
 * data, the tests — goes through here, so a new required field is added once
 * rather than in a dozen places, and currency conversion can never be forgotten
 * at a call site.
 */

import type { Account, AppState, CurrencyCode, Scheduled, Transaction } from './types';
import { uid } from '../lib/id';
import { todayISO } from '../lib/date';

export type NewTransaction = Partial<Transaction> &
  Pick<Transaction, 'date' | 'amount' | 'accountId' | 'categoryId' | 'payee'>;

/**
 * Builds a transaction, deriving currency from its account and converting to
 * base at the rate in force now. `baseAmount` is then frozen: it is what this
 * transaction was worth when it happened.
 */
export function makeTransaction(state: AppState, input: NewTransaction): Transaction {
  const account = state.accounts.find((a) => a.id === input.accountId);
  const currency = input.currency ?? account?.currency ?? state.settings.baseCurrency;
  const rate =
    input.rate ??
    (currency === state.settings.baseCurrency ? 1 : (state.rates?.[currency]?.rate ?? 1));
  const amount = input.amount;

  return {
    id: uid('tx'),
    note: '',
    paidBy: 'joint',
    splitRule: state.settings.defaultSplit,
    splitShares: {},
    tags: [],
    status: 'cleared',
    comments: [],
    approvals: [],
    private: false,
    categorySource: 'manual',
    ...input,
    currency,
    rate,
    // An explicit baseAmount wins, so a re-import can preserve a historical rate.
    baseAmount: input.baseAmount ?? Math.round(amount * rate),
  };
}

/** Recomputes the base amount from a (possibly new) native amount and rate. */
export const withBase = (tx: Transaction, amount: number, rate = tx.rate): Transaction => ({
  ...tx,
  amount,
  rate,
  baseAmount: Math.round(amount * rate),
});

export function makeAccount(state: AppState, input: Partial<Account> = {}): Account {
  return {
    id: uid('ac'),
    name: 'New account',
    institution: '',
    type: 'checking',
    owner: 'joint',
    currency: state.settings.baseCurrency,
    openingBalance: 0,
    apr: 0,
    archived: false,
    ...input,
  };
}

export function makeScheduled(state: AppState, input: Partial<Scheduled> = {}): Scheduled {
  const accountId = input.accountId ?? state.accounts[0]?.id ?? '';
  const currency =
    input.currency ??
    state.accounts.find((a) => a.id === accountId)?.currency ??
    state.settings.baseCurrency;
  return {
    id: uid('sch'),
    name: '',
    amount: 0,
    currency,
    accountId,
    categoryId:
      state.categories.find((c) => c.name === 'Miscellaneous' && !c.archived)?.id ??
      state.categories.find((c) => c.kind === 'expense')?.id ??
      '',
    cadence: 'monthly',
    nextDate: todayISO(),
    paidBy: 'joint',
    splitRule: state.settings.defaultSplit,
    enabled: true,
    autoDetected: false,
    ...input,
  };
}

/** The category a transaction falls into when nothing else matched. */
export const fallbackCategoryId = (state: AppState, currency?: CurrencyCode): string => {
  void currency;
  return (
    state.categories.find((c) => c.name === 'Miscellaneous' && !c.archived)?.id ??
    state.categories[0]?.id ??
    ''
  );
};
