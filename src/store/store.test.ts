import { describe, expect, it } from 'vitest';
import { testAccount, testTransaction } from '../test-utils';
import { buildTransfer, historyReducer, migrate, reducer, SCHEMA_VERSION, type History } from './store';
import { demoState, emptyState } from './seed';
import { accountBalance, expense, income, monthSummary, netWorth, txInMonth } from './selectors';
import type { AppState, Transaction } from './types';

const base = (): AppState => ({
  ...emptyState(),
  accounts: [
    testAccount({ id: 'chk', openingBalance: 100000 }),
    testAccount({ id: 'sav', name: 'Savings', type: 'savings', openingBalance: 500000, apr: 0.04 }),
  ],
});

const tx = (over: Partial<Transaction> = {}): Transaction =>
  testTransaction({ id: 't1', amount: -25000, accountId: 'chk', ...over });

describe('derived balances', () => {
  it('is opening plus every transaction on the account', () => {
    const state = reducer(base(), { type: 'tx/add', tx: tx() });
    expect(accountBalance(state, 'chk')).toBe(75000);
    expect(accountBalance(state, 'sav')).toBe(500000);
  });

  it('moves back when the transaction is removed', () => {
    let state = reducer(base(), { type: 'tx/add', tx: tx() });
    state = reducer(state, { type: 'tx/remove', id: 't1' });
    expect(accountBalance(state, 'chk')).toBe(100000);
  });
});

describe('transfers', () => {
  const transferInput = {
    date: '2026-06-10',
    amount: 40000,
    fromAccountId: 'chk',
    toAccountId: 'sav',
    categoryId: 'cat',
    payee: 'To savings',
  };

  it('creates two legs that net to zero', () => {
    const [out, into] = buildTransfer(base(), transferInput);
    expect(out.amount).toBe(-40000);
    expect(into.amount).toBe(40000);
    expect(out.transferId).toBe(into.transferId);
  });

  it('moves both balances', () => {
    const state = reducer(base(), { type: 'tx/transfer', transfer: transferInput });
    expect(accountBalance(state, 'chk')).toBe(60000);
    expect(accountBalance(state, 'sav')).toBe(540000);
  });

  it('leaves net worth unchanged', () => {
    const before = netWorth(base()).net;
    const state = reducer(base(), { type: 'tx/transfer', transfer: transferInput });
    expect(netWorth(state).net).toBe(before);
  });

  it('counts as neither income nor spending', () => {
    const state = reducer(base(), { type: 'tx/transfer', transfer: transferInput });
    const month = txInMonth(state, '2026-06');
    expect(income(month, state)).toBe(0);
    expect(expense(state, month)).toBe(0);
    expect(monthSummary(state, '2026-06').transfers).toBe(40000);
  });

  it('deletes both legs together, whichever one is removed', () => {
    const state = reducer(base(), { type: 'tx/transfer', transfer: transferInput });
    const [leg] = state.transactions;
    const after = reducer(state, { type: 'tx/remove', id: leg.id });
    expect(after.transactions).toHaveLength(0);
    expect(accountBalance(after, 'chk')).toBe(100000);
  });
});

describe('category removal', () => {
  it('never orphans history', () => {
    let state = emptyState();
    const misc = state.categories.find((c) => c.name === 'Miscellaneous')!;
    const groceries = state.categories.find((c) => c.name === 'Groceries')!;
    state = reducer(state, { type: 'tx/add', tx: tx({ categoryId: groceries.id }) });
    state = reducer(state, { type: 'category/remove', id: groceries.id });
    expect(state.transactions[0].categoryId).toBe(misc.id);
    expect(state.categories.some((c) => c.id === groceries.id)).toBe(false);
  });
});

describe('migrate', () => {
  it('back-solves opening balances from a v1 file so the number does not jump', () => {
    const v1 = {
      version: 1,
      people: [{ id: 'p1', name: 'A', color: '#000', annualIncome: 0 }],
      categories: emptyState().categories,
      accounts: [
        { id: 'chk', name: 'Checking', institution: '', type: 'checking', owner: 'joint', balance: 75000, apr: 0, archived: false },
      ],
      transactions: [{ ...tx(), cleared: true }],
      budget: [],
      goals: [],
      debts: [],
      netWorth: [],
      mindMaps: [],
      settings: emptyState().settings,
      retirement: emptyState().retirement,
      dismissedSuggestions: [],
    };
    const migrated = migrate(v1);
    expect(migrated.accounts[0].openingBalance).toBe(100000);
    expect(accountBalance(migrated, 'chk')).toBe(75000);
    expect(migrated.version).toBe(SCHEMA_VERSION);
  });

  it('converts cleared booleans into statuses', () => {
    // A genuine v1 record has `cleared` and no `status` at all.
    const v1Tx = (id: string, cleared: boolean) => {
      const { status, comments, approvals, private: _p, ...rest } = tx({ id });
      return { ...rest, cleared };
    };
    const migrated = migrate({
      ...emptyState(),
      version: 1,
      transactions: [v1Tx('a', true), v1Tx('b', false)],
    });
    expect(migrated.transactions.find((t) => t.id === 'a')!.status).toBe('cleared');
    expect(migrated.transactions.find((t) => t.id === 'b')!.status).toBe('pending');
    // The new per-transaction collections must exist, not be undefined.
    expect(migrated.transactions.every((t) => Array.isArray(t.comments))).toBe(true);
    expect(migrated.transactions.every((t) => Array.isArray(t.approvals))).toBe(true);
  });

  it('fills in collections added after the file was written', () => {
    const migrated = migrate({ ...emptyState(), version: 1, rules: undefined, scheduled: undefined });
    expect(migrated.rules).toEqual([]);
    expect(migrated.scheduled).toEqual([]);
  });

  it('repairs an active person who no longer exists', () => {
    const migrated = migrate({
      ...emptyState(),
      settings: { ...emptyState().settings, activePersonId: 'ghost' },
    });
    expect(migrated.people.some((p) => p.id === migrated.settings.activePersonId)).toBe(true);
  });

  it('is idempotent', () => {
    const once = migrate(demoState());
    const twice = migrate(once);
    expect(twice.accounts.map((a) => a.openingBalance)).toEqual(
      once.accounts.map((a) => a.openingBalance),
    );
  });
});

describe('demo data', () => {
  it('is internally consistent', () => {
    const state = demoState();
    expect(state.transactions.length).toBeGreaterThan(100);
    // Every transaction points at a real account and category.
    const accounts = new Set(state.accounts.map((a) => a.id));
    const categories = new Set(state.categories.map((c) => c.id));
    expect(state.transactions.every((t) => accounts.has(t.accountId))).toBe(true);
    expect(state.transactions.every((t) => categories.has(t.categoryId))).toBe(true);
    // Transfer legs cancel out in base currency. They do not cancel natively
    // when the legs are in different currencies — dollars out, euros in — which
    // is exactly why every total runs on base amounts.
    const byTransfer = new Map<string, number>();
    for (const t of state.transactions) {
      if (!t.transferId) continue;
      byTransfer.set(t.transferId, (byTransfer.get(t.transferId) ?? 0) + t.baseAmount);
    }
    expect([...byTransfer.values()].every((v) => v === 0)).toBe(true);

    // Every transaction carries a currency and a base amount consistent with it.
    expect(state.transactions.every((t) => Boolean(t.currency))).toBe(true);
    expect(
      state.transactions.every((t) => Math.abs(t.baseAmount - Math.round(t.amount * t.rate)) <= 1),
    ).toBe(true);
  });
});

describe('undo and redo', () => {
  const start = (): History => ({ past: [], present: base(), future: [] });

  it('restores the previous state', () => {
    let h = historyReducer(start(), { type: 'tx/add', tx: tx() });
    expect(h.present.transactions).toHaveLength(1);
    h = historyReducer(h, { type: 'undo' });
    expect(h.present.transactions).toHaveLength(0);
    expect(accountBalance(h.present, 'chk')).toBe(100000);
  });

  it('redoes what was undone', () => {
    let h = historyReducer(start(), { type: 'tx/add', tx: tx() });
    h = historyReducer(h, { type: 'undo' });
    h = historyReducer(h, { type: 'redo' });
    expect(h.present.transactions).toHaveLength(1);
  });

  it('does nothing at the ends of the stack', () => {
    const h = start();
    expect(historyReducer(h, { type: 'undo' })).toBe(h);
    expect(historyReducer(h, { type: 'redo' })).toBe(h);
  });

  it('abandons the redo branch after a new edit', () => {
    let h = historyReducer(start(), { type: 'tx/add', tx: tx({ id: 'a' }) });
    h = historyReducer(h, { type: 'undo' });
    h = historyReducer(h, { type: 'tx/add', tx: tx({ id: 'b' }) });
    expect(h.future).toHaveLength(0);
    expect(h.present.transactions.map((t) => t.id)).toEqual(['b']);
  });

  it('walks back through several edits in order', () => {
    let h = historyReducer(start(), { type: 'tx/add', tx: tx({ id: 'a' }) });
    h = historyReducer(h, { type: 'tx/add', tx: tx({ id: 'b', date: '2026-06-11' }) });
    h = historyReducer(h, { type: 'tx/add', tx: tx({ id: 'c', date: '2026-06-12' }) });
    expect(h.present.transactions).toHaveLength(3);
    h = historyReducer(h, { type: 'undo' });
    h = historyReducer(h, { type: 'undo' });
    expect(h.present.transactions.map((t) => t.id)).toEqual(['a']);
  });

  it('undoes a transfer as one step, not two', () => {
    let h = historyReducer(start(), {
      type: 'tx/transfer',
      transfer: {
        date: '2026-06-10',
        amount: 40000,
        fromAccountId: 'chk',
        toAccountId: 'sav',
        categoryId: 'cat',
        payee: 'To savings',
      },
    });
    expect(h.present.transactions).toHaveLength(2);
    h = historyReducer(h, { type: 'undo' });
    expect(h.present.transactions).toHaveLength(0);
    expect(accountBalance(h.present, 'sav')).toBe(500000);
  });

  it('keeps theme and person switches out of the undo stack', () => {
    const h = historyReducer(start(), { type: 'settings/update', patch: { theme: 'light' } });
    expect(h.present.settings.theme).toBe('light');
    expect(h.past).toHaveLength(0);
  });

  it('does not grow the stack when an action changes nothing', () => {
    const h = historyReducer(start(), { type: 'tx/remove', id: 'does-not-exist' });
    expect(h.past.length).toBeLessThanOrEqual(1);
  });

  it('caps the history so a long session cannot grow without bound', () => {
    let h = start();
    for (let i = 0; i < 80; i++) {
      h = historyReducer(h, { type: 'tx/add', tx: tx({ id: `t${i}`, date: '2026-06-10' }) });
    }
    expect(h.past.length).toBeLessThanOrEqual(50);
    expect(h.present.transactions).toHaveLength(80);
  });
});
