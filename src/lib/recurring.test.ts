import { describe, expect, it } from 'vitest';
import type { Transaction } from '../store/types';
import { committedMonthly, detectRecurring, staleSeries } from './recurring';

let seq = 0;
const tx = (date: string, amount: number, payee: string): Transaction => ({
  id: `t${seq++}`,
  date,
  amount,
  accountId: 'acc',
  categoryId: 'cat',
  payee,
  note: '',
  paidBy: 'joint',
  splitRule: 'even',
  splitShares: {},
  tags: [],
  status: 'cleared',
  comments: [],
  approvals: [],
  private: false,
});

const monthlySeries = (payee: string, amount: number, months: string[]) =>
  months.map((m) => tx(`${m}-14`, -amount, payee));

describe('detectRecurring', () => {
  it('finds a steady monthly subscription', () => {
    const series = detectRecurring(
      monthlySeries('Netflix', 1599, ['2026-01', '2026-02', '2026-03', '2026-04']),
    );
    expect(series).toHaveLength(1);
    expect(series[0].cadence).toBe('monthly');
    expect(series[0].typicalAmount).toBe(1599);
    expect(series[0].monthlyCost).toBe(1599);
    expect(series[0].annualCost).toBe(1599 * 12);
  });

  it('ignores a payee seen only twice', () => {
    expect(detectRecurring(monthlySeries('Rare', 5000, ['2026-01', '2026-02']))).toHaveLength(0);
  });

  it('ignores wildly varying amounts', () => {
    const noisy = [
      tx('2026-01-05', -2000, 'Grocery'),
      tx('2026-02-05', -18000, 'Grocery'),
      tx('2026-03-05', -4000, 'Grocery'),
      tx('2026-04-05', -25000, 'Grocery'),
    ];
    expect(detectRecurring(noisy)).toHaveLength(0);
  });

  it('ignores irregular timing even at a steady price', () => {
    const erratic = [
      tx('2026-01-05', -1000, 'Whenever'),
      tx('2026-01-27', -1000, 'Whenever'),
      tx('2026-05-14', -1000, 'Whenever'),
      tx('2026-05-20', -1000, 'Whenever'),
    ];
    expect(detectRecurring(erratic)).toHaveLength(0);
  });

  it('classifies weekly and biweekly cadences', () => {
    const weekly = ['2026-03-02', '2026-03-09', '2026-03-16', '2026-03-23'].map((d) =>
      tx(d, -1200, 'Weekly Box'),
    );
    expect(detectRecurring(weekly)[0].cadence).toBe('weekly');

    const biweekly = ['2026-03-02', '2026-03-16', '2026-03-30', '2026-04-13'].map((d) =>
      tx(d, -4000, 'Fortnight Co'),
    );
    expect(detectRecurring(biweekly)[0].cadence).toBe('biweekly');
  });

  it('normalizes annual charges to a monthly cost', () => {
    const annual = ['2024-02-01', '2025-02-01', '2026-02-01'].map((d) => tx(d, -12000, 'Domain Co'));
    const [series] = detectRecurring(annual);
    expect(series.cadence).toBe('annual');
    expect(series.monthlyCost).toBe(1000);
  });

  it('measures a price increase across the series', () => {
    const rising = [
      tx('2026-01-10', -1000, 'Streamly'),
      tx('2026-02-10', -1050, 'Streamly'),
      tx('2026-03-10', -1100, 'Streamly'),
      tx('2026-04-10', -1150, 'Streamly'),
    ];
    expect(detectRecurring(rising)[0].priceIncrease).toBeCloseTo(0.15, 2);
  });

  it('ignores income', () => {
    const payroll = ['2026-01-15', '2026-02-15', '2026-03-15'].map((d) => tx(d, 500000, 'Payroll'));
    expect(detectRecurring(payroll)).toHaveLength(0);
  });

  it('groups messy merchant strings together', () => {
    const messy = [
      tx('2026-01-10', -1599, 'NETFLIX.COM 8887'),
      tx('2026-02-10', -1599, 'NETFLIX.COM'),
      tx('2026-03-10', -1599, 'Netflix.com Inc'),
    ];
    expect(detectRecurring(messy)).toHaveLength(1);
  });
});

describe('staleSeries', () => {
  it('flags a monthly series that has gone quiet', () => {
    const series = detectRecurring(
      monthlySeries('Gym', 5900, ['2025-11', '2025-12', '2026-01', '2026-02']),
    );
    expect(staleSeries(series, '2026-06-01')).toHaveLength(1);
    expect(staleSeries(series, '2026-03-01')).toHaveLength(0);
  });
});

describe('committedMonthly', () => {
  it('adds up the monthly cost of every series', () => {
    const series = detectRecurring([
      ...monthlySeries('Streamly', 1000, ['2026-01', '2026-02', '2026-03']),
      ...monthlySeries('Cloud Drive', 2000, ['2026-01', '2026-02', '2026-03']),
    ]);
    expect(series).toHaveLength(2);
    expect(committedMonthly(series)).toBe(3000);
  });

  it('discards payee strings too short to be a real merchant', () => {
    // Two-character payees are noise from bad exports, not subscriptions.
    expect(detectRecurring(monthlySeries('X', 1000, ['2026-01', '2026-02', '2026-03']))).toHaveLength(0);
  });
});
