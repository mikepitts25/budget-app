import { describe, expect, it } from 'vitest';
import { testTransaction } from '../test-utils';
import type { AppState, Person, Transaction } from '../store/types';
import { fairness, settle, shareOf } from './split';
import { emptyState } from '../store/seed';
import { sum } from './money';

const people: Person[] = [
  { id: 'a', name: 'A', color: '#000', annualIncome: 12_000_000 },
  { id: 'b', name: 'B', color: '#111', annualIncome: 6_000_000 },
];

const tx = (over: Partial<Transaction> = {}): Transaction =>
  testTransaction({ id: 't1', amount: -10000, accountId: 'acc', paidBy: 'a', ...over });

describe('shareOf', () => {
  it('halves an even split', () => {
    expect(shareOf(tx(), people)).toEqual({ a: 5000, b: 5000 });
  });

  it('divides an income split in proportion to earnings', () => {
    expect(shareOf(tx({ splitRule: 'income' }), people)).toEqual({ a: 6667, b: 3333 });
  });

  it('assigns a personal cost entirely to the payer even with no shares recorded', () => {
    expect(shareOf(tx({ splitRule: 'personal', paidBy: 'b' }), people)).toEqual({ a: 0, b: 10000 });
  });

  it('honours explicit custom shares', () => {
    const shares = shareOf(tx({ splitRule: 'custom', splitShares: { a: 0.75, b: 0.25 } }), people);
    expect(shares).toEqual({ a: 7500, b: 2500 });
  });

  it('falls back to an even split when a custom rule has no shares', () => {
    expect(shareOf(tx({ splitRule: 'custom' }), people)).toEqual({ a: 5000, b: 5000 });
  });

  it('always allocates the whole amount, whatever the rule', () => {
    for (const rule of ['even', 'income', 'personal', 'custom'] as const) {
      const shares = shareOf(tx({ splitRule: rule, amount: -3333 }), people);
      expect(sum(Object.values(shares))).toBe(3333);
    }
  });
});

const stateWith = (transactions: Transaction[]): AppState => ({
  ...emptyState(),
  people,
  transactions,
});

describe('fairness', () => {
  it('nets to zero across both partners', () => {
    const { rows } = fairness(
      stateWith([]),
      [tx({ amount: -10000, paidBy: 'a' }), tx({ id: 't2', amount: -4000, paidBy: 'b' })],
    );
    expect(sum(rows.map((r) => r.net))).toBe(0);
  });

  it('credits the payer and debits the other partner', () => {
    const { rows, settlements } = fairness(stateWith([]), [tx({ amount: -10000, paidBy: 'a' })]);
    expect(rows.find((r) => r.personId === 'a')!.net).toBe(5000);
    expect(rows.find((r) => r.personId === 'b')!.net).toBe(-5000);
    expect(settlements).toEqual([{ from: 'b', to: 'a', amount: 5000 }]);
  });

  it('treats joint-account spending as funded by both, pro rata to income', () => {
    const { rows } = fairness(stateWith([]), [tx({ amount: -9000, paidBy: 'joint', splitRule: 'income' })]);
    // Paid and owed both follow income, so nobody ends up owing anybody.
    expect(rows.every((r) => r.net === 0)).toBe(true);
  });

  it('ignores income when working out who owes whom', () => {
    const { rows } = fairness(stateWith([]), [tx({ amount: 500000, paidBy: 'a' })]);
    expect(rows.every((r) => r.net === 0)).toBe(true);
  });

  it('leaves a personal purchase off the other partner entirely', () => {
    const { settlements } = fairness(
      stateWith([]),
      [tx({ amount: -8000, paidBy: 'b', splitRule: 'personal' })],
    );
    expect(settlements).toEqual([]);
  });
});

describe('settle', () => {
  it('needs at most n-1 transfers', () => {
    const rows = [
      { personId: 'a', paid: 0, owed: 0, net: 6000, incomeShare: 0, paidShare: 0 },
      { personId: 'b', paid: 0, owed: 0, net: -4000, incomeShare: 0, paidShare: 0 },
      { personId: 'c', paid: 0, owed: 0, net: -2000, incomeShare: 0, paidShare: 0 },
    ];
    const settlements = settle(rows);
    expect(settlements.length).toBeLessThanOrEqual(2);
    expect(sum(settlements.map((s) => s.amount))).toBe(6000);
  });

  it('ignores sub-cent noise rather than asking for a 3c transfer', () => {
    expect(
      settle([
        { personId: 'a', paid: 0, owed: 0, net: 3, incomeShare: 0, paidShare: 0 },
        { personId: 'b', paid: 0, owed: 0, net: -3, incomeShare: 0, paidShare: 0 },
      ]),
    ).toEqual([]);
  });
});
