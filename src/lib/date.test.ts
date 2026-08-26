import { describe, expect, it } from 'vitest';
import {
  addDays,
  addMonths,
  addMonthsToDate,
  dateRange,
  daysBetweenDates,
  monthRange,
  monthsBetween,
} from './date';

describe('month arithmetic', () => {
  it('crosses year boundaries in both directions', () => {
    expect(addMonths('2026-01', -1)).toBe('2025-12');
    expect(addMonths('2026-12', 1)).toBe('2027-01');
    expect(addMonths('2026-06', 18)).toBe('2027-12');
  });

  it('produces an inclusive, ordered range ending at the given month', () => {
    expect(monthRange('2026-03', 3)).toEqual(['2026-01', '2026-02', '2026-03']);
    expect(monthRange('2026-01', 1)).toEqual(['2026-01']);
  });

  it('measures whole months between dates, floored at zero', () => {
    expect(monthsBetween('2026-01-15', '2026-04-01')).toBe(3);
    expect(monthsBetween('2026-04-01', '2026-01-15')).toBe(0);
  });
});

describe('date arithmetic', () => {
  it('adds days across month and year ends', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('clamps the day when the target month is shorter', () => {
    expect(addMonthsToDate('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonthsToDate('2024-01-31', 1)).toBe('2024-02-29'); // leap year
    expect(addMonthsToDate('2026-03-31', 1)).toBe('2026-04-30');
  });

  it('builds inclusive date ranges', () => {
    expect(dateRange('2026-02-26', '2026-03-02')).toEqual([
      '2026-02-26',
      '2026-02-27',
      '2026-02-28',
      '2026-03-01',
      '2026-03-02',
    ]);
  });

  it('counts days between dates', () => {
    expect(daysBetweenDates('2026-01-01', '2026-01-31')).toBe(30);
  });
});
