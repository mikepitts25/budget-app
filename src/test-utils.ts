/**
 * Fixtures for the test suite.
 *
 * Records are built here rather than inline so that adding a required field to
 * the model is a one-line change in this file instead of an edit to every test.
 */

import type { Account, AppState, Scheduled, Transaction } from './store/types';
import { emptyState } from './store/seed';

let seq = 0;

export function testTransaction(over: Partial<Transaction> = {}): Transaction {
  const amount = over.amount ?? -5000;
  const rate = over.rate ?? 1;
  return {
    id: `t${seq++}`,
    date: '2026-06-10',
    amount,
    currency: 'USD',
    baseAmount: over.baseAmount ?? Math.round(amount * rate),
    rate,
    accountId: 'chk',
    categoryId: 'cat',
    payee: 'Shop',
    note: '',
    paidBy: 'joint',
    splitRule: 'even',
    splitShares: {},
    tags: [],
    status: 'cleared',
    comments: [],
    approvals: [],
    private: false,
    categorySource: 'manual',
    ...over,
  };
}

export function testAccount(over: Partial<Account> = {}): Account {
  return {
    id: 'chk',
    name: 'Checking',
    institution: '',
    type: 'checking',
    owner: 'joint',
    currency: 'USD',
    openingBalance: 0,
    apr: 0,
    archived: false,
    ...over,
  };
}

export function testScheduled(over: Partial<Scheduled> = {}): Scheduled {
  return {
    id: 's1',
    name: 'Rent',
    amount: -120000,
    currency: 'USD',
    accountId: 'chk',
    categoryId: 'cat',
    cadence: 'monthly',
    nextDate: '2026-06-01',
    paidBy: 'joint',
    splitRule: 'income',
    enabled: true,
    autoDetected: false,
    ...over,
  };
}

/** A state with the given accounts and transactions and nothing else unusual. */
export function testState(over: Partial<AppState> = {}): AppState {
  return { ...emptyState(), ...over };
}
