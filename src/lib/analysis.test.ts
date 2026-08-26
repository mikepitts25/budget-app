import { describe, expect, it } from 'vitest';
import type { AppState, Transaction } from '../store/types';
import { emptyState } from '../store/seed';
import {
  coefficientOfVariation,
  findAnomalies,
  freedomMetrics,
  incomeStability,
  lastCompleteMonth,
  lifestyleCreep,
  mean,
  median,
  stdev,
  zScore,
} from './analysis';
import { currentMonth, addMonths } from './date';

let seq = 0;
const tx = (over: Partial<Transaction> = {}): Transaction => ({
  id: `t${seq++}`,
  date: '2026-06-10',
  amount: -5000,
  accountId: 'chk',
  categoryId: 'food',
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
  ...over,
});

function stateWith(transactions: Transaction[]): AppState {
  const base = emptyState();
  const food = base.categories.find((c) => c.name === 'Groceries')!;
  const fun = base.categories.find((c) => c.name === 'Restaurants')!;
  return {
    ...base,
    accounts: [
      {
        id: 'chk',
        name: 'Checking',
        institution: '',
        type: 'checking',
        owner: 'joint',
        openingBalance: 500000,
        apr: 0,
        archived: false,
      },
    ],
    transactions: transactions.map((t) => ({
      ...t,
      categoryId: t.categoryId === 'food' ? food.id : t.categoryId === 'fun' ? fun.id : t.categoryId,
    })),
  };
}

describe('statistics', () => {
  it('computes mean, median and standard deviation', () => {
    expect(mean([2, 4, 6])).toBe(4);
    expect(median([5, 1, 3])).toBe(3);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(stdev([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2.138, 2);
  });

  it('resists outliers in the median but not the mean', () => {
    const withBonus = [100, 100, 100, 100, 900];
    expect(median(withBonus)).toBe(100);
    expect(mean(withBonus)).toBe(260);
  });

  it('returns a zero z-score when there is no spread', () => {
    expect(zScore(5, [5, 5, 5])).toBe(0);
  });

  it('reports volatility relative to size', () => {
    expect(coefficientOfVariation([100, 100, 100])).toBe(0);
    expect(coefficientOfVariation([50, 150])).toBeCloseTo(0.707, 2);
    // Same spread, bigger numbers: less volatile in relative terms.
    expect(coefficientOfVariation([1050, 950])).toBeLessThan(coefficientOfVariation([150, 50]));
  });
});

describe('lastCompleteMonth', () => {
  it('steps back from the month in progress but leaves past months alone', () => {
    expect(lastCompleteMonth(currentMonth())).toBe(addMonths(currentMonth(), -1));
    expect(lastCompleteMonth('2020-03')).toBe('2020-03');
  });
});

describe('incomeStability', () => {
  const salaryMonths = (amounts: number[]) =>
    amounts.map((amount, i) =>
      tx({ amount, date: `${addMonths(lastCompleteMonth(currentMonth()), -i)}-15`, payee: 'Payroll' }),
    );

  it('recommends a short runway for steady income', () => {
    const state = stateWith(salaryMonths([500000, 500000, 500000, 500000, 500000, 500000]));
    const s = incomeStability(state, currentMonth());
    expect(s.band).toBe('steady');
    expect(s.recommendedMonths).toBe(3);
  });

  it('recommends a deep runway for lumpy income', () => {
    const state = stateWith(salaryMonths([100000, 900000, 200000, 1200000, 50000, 700000]));
    const s = incomeStability(state, currentMonth());
    expect(s.band).toBe('lumpy');
    expect(s.recommendedMonths).toBe(9);
  });
});

describe('findAnomalies', () => {
  it('spots a duplicate charge within three days', () => {
    const month = currentMonth();
    const state = stateWith([
      tx({ amount: -12000, date: `${month}-10`, payee: 'Hardware Store' }),
      tx({ amount: -12000, date: `${month}-11`, payee: 'Hardware Store' }),
    ]);
    const dupes = findAnomalies(state, month).filter((a) => a.kind === 'duplicate');
    expect(dupes).toHaveLength(1);
    expect(dupes[0].amount).toBe(12000);
  });

  it('does not flag the same amount a fortnight apart', () => {
    const month = currentMonth();
    const state = stateWith([
      tx({ amount: -12000, date: `${month}-01`, payee: 'Hardware Store' }),
      tx({ amount: -12000, date: `${month}-20`, payee: 'Hardware Store' }),
    ]);
    expect(findAnomalies(state, month).filter((a) => a.kind === 'duplicate')).toHaveLength(0);
  });

  it('spots a trial converting to full price', () => {
    const month = currentMonth();
    const state = stateWith([
      tx({ amount: -100, date: `${addMonths(month, -2)}-05`, payee: 'Streamly' }),
      tx({ amount: -1599, date: `${month}-05`, payee: 'Streamly' }),
    ]);
    expect(findAnomalies(state, month).some((a) => a.kind === 'trial-converted')).toBe(true);
  });

  it('is quiet when nothing is unusual', () => {
    const month = currentMonth();
    const state = stateWith([tx({ amount: -2000, date: `${month}-05`, payee: 'Corner Shop' })]);
    expect(findAnomalies(state, month).filter((a) => a.severity === 'high')).toHaveLength(0);
  });
});

describe('lifestyleCreep', () => {
  it('returns null without enough history', () => {
    expect(lifestyleCreep(stateWith([tx()]), currentMonth())).toBeNull();
  });

  it('calls it creep when spending outruns flat income', () => {
    const anchor = lastCompleteMonth(currentMonth());
    const txs: Transaction[] = [];
    for (let i = 0; i < 10; i++) {
      const month = addMonths(anchor, -i);
      txs.push(tx({ amount: 600000, date: `${month}-15`, payee: 'Payroll' }));
      // Recent months spend much more.
      txs.push(tx({ amount: i < 5 ? -400000 : -200000, date: `${month}-20`, categoryId: 'fun' }));
    }
    const creep = lifestyleCreep(stateWith(txs), currentMonth());
    expect(creep!.verdict).toBe('creep');
    expect(creep!.spendingGrowth).toBeGreaterThan(0);
  });

  it('calls it tightening when spending falls', () => {
    const anchor = lastCompleteMonth(currentMonth());
    const txs: Transaction[] = [];
    for (let i = 0; i < 10; i++) {
      const month = addMonths(anchor, -i);
      txs.push(tx({ amount: 600000, date: `${month}-15`, payee: 'Payroll' }));
      txs.push(tx({ amount: i < 5 ? -150000 : -400000, date: `${month}-20`, categoryId: 'fun' }));
    }
    expect(lifestyleCreep(stateWith(txs), currentMonth())!.verdict).toBe('tightening');
  });
});

describe('freedomMetrics', () => {
  it('turns a surplus into days of freedom at a 4% withdrawal rate', () => {
    const month = currentMonth();
    const state = stateWith([
      tx({ amount: 1000000, date: `${month}-01`, payee: 'Payroll' }),
      tx({ amount: -700000, date: `${month}-05`, categoryId: 'fun' }),
    ]);
    const f = freedomMetrics(state, month);
    expect(f.monthlySurplus).toBeGreaterThan(0);
    expect(f.daysBoughtThisMonth).toBeGreaterThan(0);
  });

  it('reports no freedom bought when nothing is left over', () => {
    const month = currentMonth();
    const state = stateWith([
      tx({ amount: 500000, date: `${month}-01`, payee: 'Payroll' }),
      tx({ amount: -500000, date: `${month}-05`, categoryId: 'fun' }),
    ]);
    expect(freedomMetrics(state, month).daysBoughtThisMonth).toBe(0);
  });
});
