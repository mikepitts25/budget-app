import type { RetirementPlan } from '../store/types';

/**
 * Deterministic PRNG so a given plan always produces the same simulation. A
 * projection that reshuffles every render is impossible to discuss with anyone.
 */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Box-Muller: two uniforms in, one standard normal out. */
function normal(rand: () => number): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = rand();
  while (v === 0) v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export interface SimulationInput {
  startingBalance: number;
  monthlyContribution: number;
  yearsToRetirement: number;
  yearsInRetirement: number;
  /** Expected annual return while accumulating and while drawing down. */
  expectedReturn: number;
  /** Annual standard deviation of returns. ~15% is typical for equity-heavy. */
  volatility: number;
  inflation: number;
  /** Spending per year in retirement, in today's money. */
  annualSpend: number;
  runs: number;
  seed?: number;
}

export interface SimulationResult {
  runs: number;
  /** Share of runs where the money outlasted the plan. */
  successRate: number;
  /** Balance at retirement, by percentile. */
  atRetirement: { p10: number; p50: number; p90: number };
  /** Balance at the end of the drawdown, by percentile. */
  atEnd: { p10: number; p50: number; p90: number };
  /** Median year the money runs out in failing runs, relative to retirement. */
  medianDepletionYear: number | null;
  /** Percentile bands over time, for charting. Index 0 = today. */
  bands: { year: number; p10: number; p50: number; p90: number }[];
  /** The single worst run, which is what sequence-of-returns risk looks like. */
  worstPath: number[];
}

const percentile = (sorted: number[], p: number): number => {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor((p / 100) * sorted.length)));
  return sorted[idx];
};

/**
 * Simulates accumulation and drawdown with random annual returns. The point is
 * not a better number than the straight-line projection — it is showing that the
 * order of good and bad years matters, which a single average hides entirely.
 */
export function simulateRetirement(input: SimulationInput): SimulationResult {
  const {
    startingBalance,
    monthlyContribution,
    yearsToRetirement,
    yearsInRetirement,
    expectedReturn,
    volatility,
    inflation,
    annualSpend,
    runs,
  } = input;

  const rand = mulberry32(input.seed ?? 424242);
  const totalYears = Math.max(1, Math.round(yearsToRetirement + yearsInRetirement));
  const paths: number[][] = [];
  const atRetirement: number[] = [];
  const atEnd: number[] = [];
  const depletionYears: number[] = [];
  let successes = 0;

  for (let run = 0; run < runs; run++) {
    let balance = startingBalance;
    const path: number[] = [balance];
    let depleted: number | null = null;

    for (let year = 1; year <= totalYears; year++) {
      // Log-normal-ish annual return: mean expectedReturn, spread by volatility.
      const shock = expectedReturn + normal(rand) * volatility;
      balance *= 1 + shock;

      if (year <= yearsToRetirement) {
        balance += monthlyContribution * 12;
      } else {
        // Withdrawals rise with inflation from the retirement date onward.
        const withdrawal = annualSpend * Math.pow(1 + inflation, year - 1);
        balance -= withdrawal;
        if (balance <= 0 && depleted === null) {
          depleted = year - yearsToRetirement;
          balance = 0;
        }
      }
      path.push(Math.max(0, balance));
      if (year === Math.round(yearsToRetirement)) atRetirement.push(Math.max(0, balance));
    }

    paths.push(path);
    atEnd.push(Math.max(0, balance));
    if (depleted === null) successes += 1;
    else depletionYears.push(depleted);
  }

  const bands: SimulationResult['bands'] = [];
  for (let year = 0; year <= totalYears; year++) {
    const slice = paths.map((p) => p[year] ?? 0).sort((a, b) => a - b);
    bands.push({
      year,
      p10: Math.round(percentile(slice, 10)),
      p50: Math.round(percentile(slice, 50)),
      p90: Math.round(percentile(slice, 90)),
    });
  }

  const sortedRetirement = [...atRetirement].sort((a, b) => a - b);
  const sortedEnd = [...atEnd].sort((a, b) => a - b);
  const sortedDepletion = [...depletionYears].sort((a, b) => a - b);
  const worstIndex = paths.reduce(
    (worst, p, i) => (p[p.length - 1] < paths[worst][paths[worst].length - 1] ? i : worst),
    0,
  );

  return {
    runs,
    successRate: runs > 0 ? successes / runs : 0,
    atRetirement: {
      p10: Math.round(percentile(sortedRetirement, 10)),
      p50: Math.round(percentile(sortedRetirement, 50)),
      p90: Math.round(percentile(sortedRetirement, 90)),
    },
    atEnd: {
      p10: Math.round(percentile(sortedEnd, 10)),
      p50: Math.round(percentile(sortedEnd, 50)),
      p90: Math.round(percentile(sortedEnd, 90)),
    },
    medianDepletionYear: sortedDepletion.length ? percentile(sortedDepletion, 50) : null,
    bands,
    worstPath: paths[worstIndex].map((v) => Math.round(v)),
  };
}

/** Pulls the simulation inputs out of the saved plan. */
export function inputsFromPlan(
  plan: RetirementPlan,
  personIds: string[],
  overrides: Partial<SimulationInput> = {},
): SimulationInput {
  const ages = personIds.map((id) => plan.currentAge[id] ?? 35);
  const retireAges = personIds.map((id) => plan.retireAge[id] ?? 65);
  const years = Math.max(
    0,
    Math.max(...personIds.map((_, i) => (retireAges[i] ?? 65) - (ages[i] ?? 35))),
  );
  return {
    startingBalance: plan.currentSavings,
    monthlyContribution: plan.monthlyContribution,
    yearsToRetirement: years,
    yearsInRetirement: 30,
    expectedReturn: plan.expectedReturn,
    volatility: 0.15,
    inflation: plan.inflation,
    annualSpend: plan.desiredAnnualSpend,
    runs: 1000,
    ...overrides,
  };
}

/**
 * How much the couple would need to change to reach a target success rate.
 * Searches contribution first, since it is the lever they actually control.
 */
export function requiredContributionFor(
  input: SimulationInput,
  targetSuccess = 0.9,
): number {
  let lo = 0;
  let hi = Math.max(input.monthlyContribution * 4, 1_000_00);
  // Fewer runs while searching: precision here is false comfort anyway.
  const probe = (monthly: number) =>
    simulateRetirement({ ...input, monthlyContribution: monthly, runs: 200 }).successRate;

  if (probe(hi) < targetSuccess) return hi;
  for (let i = 0; i < 18; i++) {
    const mid = Math.round((lo + hi) / 2);
    if (probe(mid) >= targetSuccess) hi = mid;
    else lo = mid;
  }
  return hi;
}
