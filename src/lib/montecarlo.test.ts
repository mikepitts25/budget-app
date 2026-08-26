import { describe, expect, it } from 'vitest';
import { simulateRetirement, type SimulationInput } from './montecarlo';

const base: SimulationInput = {
  startingBalance: 50_000_00,
  monthlyContribution: 2_000_00,
  yearsToRetirement: 25,
  yearsInRetirement: 30,
  expectedReturn: 0.065,
  volatility: 0.15,
  inflation: 0.025,
  annualSpend: 60_000_00,
  runs: 300,
  seed: 7,
};

describe('simulateRetirement', () => {
  it('is deterministic for a given seed', () => {
    const a = simulateRetirement(base);
    const b = simulateRetirement(base);
    expect(a.successRate).toBe(b.successRate);
    expect(a.atRetirement.p50).toBe(b.atRetirement.p50);
  });

  it('produces different results for different seeds', () => {
    const a = simulateRetirement({ ...base, seed: 1 });
    const b = simulateRetirement({ ...base, seed: 2 });
    expect(a.atRetirement.p50).not.toBe(b.atRetirement.p50);
  });

  it('orders the percentile bands correctly', () => {
    const r = simulateRetirement(base);
    expect(r.atRetirement.p10).toBeLessThanOrEqual(r.atRetirement.p50);
    expect(r.atRetirement.p50).toBeLessThanOrEqual(r.atRetirement.p90);
    for (const band of r.bands) {
      expect(band.p10).toBeLessThanOrEqual(band.p50);
      expect(band.p50).toBeLessThanOrEqual(band.p90);
    }
  });

  it('reports a success rate between zero and one', () => {
    const r = simulateRetirement(base);
    expect(r.successRate).toBeGreaterThanOrEqual(0);
    expect(r.successRate).toBeLessThanOrEqual(1);
  });

  it('succeeds more often when contributing more', () => {
    const lean = simulateRetirement({ ...base, monthlyContribution: 50_000 });
    const generous = simulateRetirement({ ...base, monthlyContribution: 600_000 });
    expect(generous.successRate).toBeGreaterThan(lean.successRate);
  });

  it('succeeds less often when spending more in retirement', () => {
    const modest = simulateRetirement({ ...base, annualSpend: 40_000_00 });
    const lavish = simulateRetirement({ ...base, annualSpend: 120_000_00 });
    expect(lavish.successRate).toBeLessThan(modest.successRate);
  });

  it('shows volatility drag: same average return, lower typical outcome', () => {
    const calm = simulateRetirement({ ...base, volatility: 0.02 });
    const wild = simulateRetirement({ ...base, volatility: 0.3 });
    // Compounding turns spread into a penalty: the median and the downside both
    // fall even though the arithmetic mean return is identical.
    expect(wild.atRetirement.p10).toBeLessThan(calm.atRetirement.p10);
    expect(wild.atRetirement.p50).toBeLessThan(calm.atRetirement.p50);
  });

  it('widens the spread of outcomes with volatility', () => {
    const calm = simulateRetirement({ ...base, volatility: 0.02 });
    const wild = simulateRetirement({ ...base, volatility: 0.3 });
    const spread = (r: typeof calm) => r.atRetirement.p90 - r.atRetirement.p10;
    expect(spread(wild)).toBeGreaterThan(spread(calm));
  });

  it('lets volatility rescue an underfunded plan through the lucky tail alone', () => {
    // Counter-intuitive but real: when the median plan fails either way, only the
    // upside tail succeeds, so more volatility can raise the success rate. This
    // is exactly why a success rate should never be read without the bands.
    const underfunded = { ...base, monthlyContribution: 20_000 };
    const calm = simulateRetirement({ ...underfunded, volatility: 0.02 });
    const wild = simulateRetirement({ ...underfunded, volatility: 0.3 });
    expect(calm.successRate).toBeLessThan(0.2);
    expect(wild.successRate).toBeGreaterThan(calm.successRate);
    expect(wild.atRetirement.p50).toBeLessThan(calm.atRetirement.p50);
  });

  it('never reports a negative balance', () => {
    const r = simulateRetirement({ ...base, annualSpend: 500_000_00 });
    expect(r.bands.every((b) => b.p10 >= 0)).toBe(true);
    expect(r.worstPath.every((v) => v >= 0)).toBe(true);
  });

  it('names a depletion year only when some runs fail', () => {
    const doomed = simulateRetirement({ ...base, startingBalance: 0, monthlyContribution: 0 });
    expect(doomed.successRate).toBe(0);
    expect(doomed.medianDepletionYear).not.toBeNull();

    const safe = simulateRetirement({ ...base, startingBalance: 500_000_000, annualSpend: 10_000_00 });
    expect(safe.successRate).toBe(1);
    expect(safe.medianDepletionYear).toBeNull();
  });

  it('tracks the whole horizon', () => {
    const r = simulateRetirement(base);
    expect(r.bands).toHaveLength(base.yearsToRetirement + base.yearsInRetirement + 1);
  });
});
