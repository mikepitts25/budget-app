import { describe, expect, it } from 'vitest';
import type { AppState, Scheduled } from '../store/types';
import { emptyState } from '../store/seed';
import { buildForecast } from './forecast';
import { monthlyEquivalent, nextDate, occurrencesBetween } from './schedule';

const account = {
  id: 'chk',
  name: 'Checking',
  institution: '',
  type: 'checking' as const,
  owner: 'joint' as const,
  openingBalance: 200000,
  apr: 0,
  archived: false,
};

const scheduled = (over: Partial<Scheduled> = {}): Scheduled => ({
  id: 's1',
  name: 'Rent',
  amount: -120000,
  accountId: 'chk',
  categoryId: 'cat',
  cadence: 'monthly',
  nextDate: '2026-06-01',
  paidBy: 'joint',
  splitRule: 'income',
  enabled: true,
  autoDetected: false,
  ...over,
});

const stateWith = (over: Partial<AppState> = {}): AppState => ({
  ...emptyState(),
  accounts: [account],
  ...over,
});

describe('nextDate', () => {
  it('advances each cadence', () => {
    expect(nextDate('2026-06-01', 'weekly')).toBe('2026-06-08');
    expect(nextDate('2026-06-01', 'biweekly')).toBe('2026-06-15');
    expect(nextDate('2026-06-01', 'monthly')).toBe('2026-07-01');
    expect(nextDate('2026-06-01', 'quarterly')).toBe('2026-09-01');
    expect(nextDate('2026-06-01', 'annual')).toBe('2027-06-01');
  });

  it('alternates the 1st and 15th for semimonthly', () => {
    expect(nextDate('2026-06-01', 'semimonthly')).toBe('2026-06-15');
    expect(nextDate('2026-06-15', 'semimonthly')).toBe('2026-07-01');
  });

  it('clamps a month-end date into a shorter month', () => {
    expect(nextDate('2026-01-31', 'monthly')).toBe('2026-02-28');
  });
});

describe('occurrencesBetween', () => {
  it('lists every occurrence in the window', () => {
    const out = occurrencesBetween(scheduled(), '2026-06-01', '2026-09-30');
    expect(out.map((o) => o.date)).toEqual(['2026-06-01', '2026-07-01', '2026-08-01', '2026-09-01']);
  });

  it('fast-forwards a stale schedule without emitting the past', () => {
    const out = occurrencesBetween(scheduled({ nextDate: '2020-01-01' }), '2026-06-01', '2026-07-31');
    expect(out.map((o) => o.date)).toEqual(['2026-06-01', '2026-07-01']);
  });

  it('respects an end date', () => {
    const out = occurrencesBetween(
      scheduled({ endDate: '2026-07-15' }),
      '2026-06-01',
      '2026-12-31',
    );
    expect(out).toHaveLength(2);
  });

  it('emits nothing when disabled', () => {
    expect(occurrencesBetween(scheduled({ enabled: false }), '2026-06-01', '2026-12-31')).toHaveLength(0);
  });
});

describe('monthlyEquivalent', () => {
  it('normalizes every cadence to a monthly figure', () => {
    expect(monthlyEquivalent(scheduled({ amount: -1200, cadence: 'annual' }))).toBe(-100);
    expect(monthlyEquivalent(scheduled({ amount: -1000, cadence: 'monthly' }))).toBe(-1000);
    expect(monthlyEquivalent(scheduled({ amount: -1000, cadence: 'semimonthly' }))).toBe(-2000);
    expect(monthlyEquivalent(scheduled({ amount: -300, cadence: 'quarterly' }))).toBe(-100);
  });
});

describe('buildForecast', () => {
  const noVariable = { includeVariable: false };

  it('starts from the spending accounts and applies scheduled items', () => {
    const state = stateWith({ scheduled: [scheduled({ nextDate: '2026-06-10' })] });
    const f = buildForecast(state, 30, '2026-06-01', noVariable);
    expect(f.startingBalance).toBe(200000);
    expect(f.days[0].balance).toBe(200000);
    expect(f.days[f.days.length - 1].balance).toBe(80000);
  });

  it('ignores savings accounts, since bills do not come out of the house fund', () => {
    const state = stateWith({
      accounts: [account, { ...account, id: 'sav', type: 'savings', openingBalance: 5000000 }],
    });
    expect(buildForecast(state, 30, '2026-06-01', noVariable).startingBalance).toBe(200000);
  });

  it('finds the low point and reports when it goes negative', () => {
    const state = stateWith({
      scheduled: [scheduled({ amount: -250000, nextDate: '2026-06-15' })],
    });
    const f = buildForecast(state, 30, '2026-06-01', noVariable);
    expect(f.low.balance).toBe(-50000);
    expect(f.low.date).toBe('2026-06-15');
    expect(f.daysUntilNegative).toBe(14);
  });

  it('bases safe-to-spend on the 30-day trough, not the next payday', () => {
    // Payday tomorrow, rent in a week: spending everything tomorrow is a trap.
    const state = stateWith({
      settings: { ...emptyState().settings, safeToSpendBuffer: 0 },
      scheduled: [
        scheduled({ id: 'pay', name: 'Payday', amount: 300000, nextDate: '2026-06-02', cadence: 'monthly' }),
        scheduled({ id: 'rent', name: 'Rent', amount: -450000, nextDate: '2026-06-09' }),
      ],
    });
    const f = buildForecast(state, 60, '2026-06-01', noVariable);
    // Before payday the trough is simply today's balance; the rent a week later
    // is what safe-to-spend must actually account for.
    expect(f.lowBeforeIncome).toBe(200000);
    expect(f.safeToSpend).toBe(f.lowNext30);
    expect(f.safeToSpend).toBe(50000);
    expect(f.safeToSpend).toBeLessThan(f.lowBeforeIncome);
  });

  it('subtracts the buffer from safe-to-spend', () => {
    const state = stateWith({
      settings: { ...emptyState().settings, safeToSpendBuffer: 50000 },
    });
    const f = buildForecast(state, 30, '2026-06-01', noVariable);
    expect(f.safeToSpend).toBe(150000);
  });

  it('includes future-dated entries already in the ledger', () => {
    const state = stateWith({
      transactions: [
        {
          id: 'x',
          date: '2026-06-05',
          amount: -30000,
          accountId: 'chk',
          categoryId: 'c',
          payee: 'Booked ahead',
          note: '',
          paidBy: 'joint',
          splitRule: 'even',
          splitShares: {},
          tags: [],
          status: 'pending',
          comments: [],
          approvals: [],
          private: false,
        },
      ],
    });
    const f = buildForecast(state, 30, '2026-06-01', noVariable);
    expect(f.days[f.days.length - 1].balance).toBe(170000);
  });
});
