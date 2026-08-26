import { describe, expect, it } from 'vitest';
import { allocate, clamp, formatMoney, formatPercent, sum, toCents, toUnits } from './money';

describe('toCents', () => {
  it('rounds to whole cents and tolerates currency noise', () => {
    expect(toCents(12.34)).toBe(1234);
    expect(toCents('$1,234.56')).toBe(123456);
    expect(toCents('-42.10')).toBe(-4210);
    expect(toCents(0.1 + 0.2)).toBe(30); // the classic float trap
    expect(toCents('nonsense')).toBe(0);
  });
});

describe('allocate', () => {
  it('never loses or invents a cent', () => {
    for (const total of [1, 2, 100, 333, 1000, 99999]) {
      for (const weights of [[1, 1], [1, 1, 1], [2, 1], [7, 3], [1, 1, 1, 1, 1, 1, 1]]) {
        const parts = allocate(total, weights);
        expect(sum(parts)).toBe(total);
        expect(parts.every((p) => p >= 0)).toBe(true);
      }
    }
  });

  it('splits an odd penny to the largest fractional share', () => {
    expect(allocate(1, [1, 1])).toEqual([1, 0]);
    expect(allocate(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(allocate(10, [7, 3])).toEqual([7, 3]);
  });

  it('handles zero and empty weights without dividing by zero', () => {
    expect(allocate(100, [0, 0])).toEqual([0, 0]);
    expect(allocate(0, [1, 1])).toEqual([0, 0]);
  });
});

describe('formatting', () => {
  it('formats currency with sign and compact options', () => {
    expect(formatMoney(123456)).toBe('$1,234.56');
    expect(formatMoney(-5000)).toBe('-$50.00');
    expect(formatMoney(5000, { sign: true })).toBe('+$50.00');
    expect(formatMoney(1234567, { compact: true })).toBe('$12.3K');
  });

  it('formats percentages from decimals', () => {
    expect(formatPercent(0.0625, 2)).toBe('6.25%');
    expect(formatPercent(0.2, 0)).toBe('20%');
  });

  it('round-trips units and cents', () => {
    expect(toUnits(toCents(19.99))).toBe(19.99);
  });

  it('clamps', () => {
    expect(clamp(5, 0, 3)).toBe(3);
    expect(clamp(-5, 0, 3)).toBe(0);
  });
});
