import { describe, expect, it } from 'vitest';
import { affordHouse, futureValue, loanPayment, monthsToTarget, requiredMonthly } from './projections';

describe('futureValue', () => {
  it('is simple addition at zero return', () => {
    expect(futureValue(100000, 10000, 0, 12)).toBe(220000);
  });

  it('compounds monthly', () => {
    // 1200.00 at 12% for a year, no contributions.
    expect(futureValue(120000, 0, 0.12, 12)).toBeCloseTo(120000 * 1.01 ** 12, -1);
  });

  it('returns the present value for a zero horizon', () => {
    expect(futureValue(500000, 10000, 0.07, 0)).toBe(500000);
  });
});

describe('requiredMonthly', () => {
  it('is the round-trip inverse of futureValue', () => {
    const needed = requiredMonthly(100000, 5000000, 0.06, 120);
    expect(futureValue(100000, needed, 0.06, 120)).toBeCloseTo(5000000, -2);
  });

  it('is zero when the target is already met', () => {
    expect(requiredMonthly(600000, 500000, 0.05, 24)).toBe(0);
  });

  it('falls back to the plain shortfall with no time left', () => {
    expect(requiredMonthly(100000, 250000, 0.05, 0)).toBe(150000);
  });
});

describe('monthsToTarget', () => {
  it('is zero when already funded', () => {
    expect(monthsToTarget(100000, 1000, 0.04, 50000)).toBe(0);
  });

  it('returns null when it will never get there', () => {
    expect(monthsToTarget(1000, 0, 0, 500000)).toBeNull();
  });

  it('agrees with futureValue at the month it reports', () => {
    const months = monthsToTarget(0, 50000, 0.05, 1000000)!;
    expect(futureValue(0, 50000, 0.05, months)).toBeGreaterThanOrEqual(1000000);
    expect(futureValue(0, 50000, 0.05, months - 1)).toBeLessThan(1000000);
  });
});

describe('loanPayment', () => {
  it('divides evenly at zero interest', () => {
    expect(loanPayment(1200000, 0, 10)).toBe(10000);
  });

  it('matches the standard amortization formula', () => {
    // $300,000 at 6% over 30 years is about $1,798.65/month.
    expect(loanPayment(30000000, 0.06, 30)).toBeCloseTo(179865, -2);
  });
});

describe('affordHouse', () => {
  const base = {
    grossAnnualIncome: 15000000,
    downPayment: 6000000,
    apr: 0.065,
    termYears: 30,
    propertyTaxRate: 0.011,
    insuranceAnnual: 180000,
    hoaMonthly: 0,
    otherDebtMonthly: 40000,
    maxHousingRatio: 0.28,
    maxTotalDebtRatio: 0.36,
  };

  it('keeps the payment inside the front-end ratio', () => {
    const result = affordHouse(base);
    expect(result.frontRatio).toBeLessThanOrEqual(0.281);
    expect(result.maxPrice).toBeGreaterThan(base.downPayment);
  });

  it('buys less house when rates rise', () => {
    const cheap = affordHouse({ ...base, apr: 0.04 });
    const dear = affordHouse({ ...base, apr: 0.09 });
    expect(dear.maxPrice).toBeLessThan(cheap.maxPrice);
  });

  it('buys more house with a bigger deposit', () => {
    const more = affordHouse({ ...base, downPayment: 12000000 });
    expect(more.maxPrice).toBeGreaterThan(affordHouse(base).maxPrice);
  });

  it('lets existing debt reduce the budget through the back-end ratio', () => {
    const burdened = affordHouse({ ...base, otherDebtMonthly: 300000 });
    expect(burdened.maxPrice).toBeLessThan(affordHouse(base).maxPrice);
  });
});
