import { describe, expect, it } from 'vitest';
import type { Debt } from '../store/types';
import { simulatePayoff, totalDebt, totalMinimums, weightedApr } from './debt';

const debts: Debt[] = [
  { id: 'card', name: 'Card', balance: 500000, apr: 0.24, minPayment: 15000, kind: 'credit' },
  { id: 'auto', name: 'Auto', balance: 1200000, apr: 0.06, minPayment: 30000, kind: 'auto' },
  { id: 'small', name: 'Store card', balance: 80000, apr: 0.18, minPayment: 3000, kind: 'credit' },
];

describe('debt aggregates', () => {
  it('sums balances and minimums', () => {
    expect(totalDebt(debts)).toBe(1780000);
    expect(totalMinimums(debts)).toBe(48000);
  });

  it('weights the rate by balance, not by count', () => {
    const apr = weightedApr(debts);
    expect(apr).toBeGreaterThan(0.06);
    expect(apr).toBeLessThan(0.24);
    expect(apr).toBeCloseTo((0.24 * 500000 + 0.06 * 1200000 + 0.18 * 80000) / 1780000, 10);
  });
});

describe('simulatePayoff', () => {
  it('clears every balance and reports when', () => {
    const plan = simulatePayoff(debts, 80000, 'avalanche');
    expect(plan.impossible).toBe(false);
    expect(plan.months).toBeGreaterThan(0);
    expect(Object.keys(plan.payoffMonth)).toHaveLength(3);
    expect(plan.track[plan.track.length - 1].totalBalance).toBe(0);
  });

  it('costs less on avalanche than snowball for the same budget', () => {
    const budget = 80000;
    const avalanche = simulatePayoff(debts, budget, 'avalanche');
    const snowball = simulatePayoff(debts, budget, 'snowball');
    expect(avalanche.totalInterest).toBeLessThanOrEqual(snowball.totalInterest);
  });

  it('clears the smallest balance first on snowball', () => {
    const snowball = simulatePayoff(debts, 80000, 'snowball');
    expect(snowball.payoffMonth.small).toBeLessThanOrEqual(snowball.payoffMonth.card);
  });

  it('attacks the highest rate first on avalanche', () => {
    const avalanche = simulatePayoff(debts, 80000, 'avalanche');
    expect(avalanche.payoffMonth.card).toBeLessThanOrEqual(avalanche.payoffMonth.auto);
  });

  it('pays less interest when the budget rises', () => {
    const lean = simulatePayoff(debts, 60000, 'avalanche');
    const generous = simulatePayoff(debts, 120000, 'avalanche');
    expect(generous.totalInterest).toBeLessThan(lean.totalInterest);
    expect(generous.months).toBeLessThan(lean.months);
  });

  it('flags a budget that cannot beat the interest', () => {
    const drowning = simulatePayoff(
      [{ id: 'x', name: 'X', balance: 1000000, apr: 0.3, minPayment: 1000, kind: 'credit' }],
      1000,
      'avalanche',
    );
    expect(drowning.impossible).toBe(true);
  });

  it('never pays more than the balance owed', () => {
    const plan = simulatePayoff(debts, 500000, 'avalanche');
    expect(plan.totalPaid).toBeLessThanOrEqual(totalDebt(debts) + plan.totalInterest + 1);
  });

  it('handles an empty list', () => {
    const plan = simulatePayoff([], 50000, 'snowball');
    expect(plan.months).toBe(0);
    expect(plan.totalInterest).toBe(0);
  });
});
