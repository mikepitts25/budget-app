import type { AppState, ID, Transaction } from '../store/types';
import {
  accountBalances,
  categoryMap,
  essentialMonthly,
  isTransfer,
  liquidCash,
  monthSeries,
  txInMonths,
} from '../store/selectors';
import { addMonths, currentMonth, dayOfMonth, dayOfWeek, monthRange } from './date';
import { sum } from './money';
import { monthlyEquivalent } from './schedule';

/**
 * Trend comparisons must not include the month in progress: a window ending on
 * the 8th would read as a collapse in both income and spending. Anything
 * comparing periods should anchor on the last complete month instead.
 */
export const lastCompleteMonth = (month: string): string =>
  month === currentMonth() ? addMonths(month, -1) : month;

/* ------------------------------------------------------------------ stats */

export const mean = (xs: number[]): number => (xs.length ? sum(xs) / xs.length : 0);

/** Median, which one-off bonuses and outliers cannot drag around. */
export function median(xs: number[]): number {
  if (!xs.length) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function stdev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(sum(xs.map((x) => (x - m) ** 2)) / (xs.length - 1));
}

/** Standard deviations from the mean. 0 when there is no spread to speak of. */
export const zScore = (value: number, xs: number[]): number => {
  const sd = stdev(xs);
  return sd === 0 ? 0 : (value - mean(xs)) / sd;
};

/** Spread relative to size — the honest way to compare volatility across people. */
export const coefficientOfVariation = (xs: number[]): number => {
  const m = mean(xs);
  return m === 0 ? 0 : stdev(xs) / m;
};

/* ------------------------------------------------- fixed vs variable costs */

export interface CostStructure {
  fixed: number;
  variable: number;
  income: number;
  /** Share of income already committed before you decide anything. */
  fixedShare: number;
  /** What is left after the committed costs — your actual room to manoeuvre. */
  flexible: number;
}

/**
 * Committed costs are what the schedule says plus anything in an essential
 * category; everything else is discretionary and can flex month to month.
 */
export function costStructure(state: AppState, month: string, months = 3): CostStructure {
  const cats = categoryMap(state);
  const txs = txInMonths(state, monthRange(month, months)).filter(
    (t) => t.amount < 0 && !isTransfer(state, t),
  );
  const scheduledMonthly = sum(
    state.scheduled.filter((s) => s.enabled && s.amount < 0).map((s) => Math.abs(monthlyEquivalent(s))),
  );
  const essential = sum(txs.filter((t) => cats[t.categoryId]?.essential).map((t) => Math.abs(t.amount))) / months;
  const discretionary =
    sum(txs.filter((t) => !cats[t.categoryId]?.essential).map((t) => Math.abs(t.amount))) / months;

  // The schedule and essential categories overlap; take the larger as fixed.
  const fixed = Math.round(Math.max(essential, scheduledMonthly));
  const variable = Math.round(Math.max(0, essential + discretionary - fixed));
  const income = Math.round(mean(monthSeries(state, month, months).map((m) => m.income)));

  return {
    fixed,
    variable,
    income,
    fixedShare: income > 0 ? fixed / income : 0,
    flexible: income - fixed,
  };
}

/* --------------------------------------------------------- income stability */

export interface IncomeStability {
  monthly: number[];
  average: number;
  volatility: number;
  /** 'steady' | 'variable' | 'lumpy' — drives the emergency fund target. */
  band: 'steady' | 'variable' | 'lumpy';
  recommendedMonths: number;
  recommendedFund: number;
  currentMonths: number;
}

/**
 * Two salaries that never move need a smaller cushion than freelance income that
 * swings. The recommended emergency fund follows from the volatility rather than
 * a fixed rule of thumb.
 */
export function incomeStability(state: AppState, month: string, months = 12): IncomeStability {
  const monthly = monthSeries(state, lastCompleteMonth(month), months)
    .map((m) => m.income)
    .filter((v) => v > 0);
  const volatility = coefficientOfVariation(monthly);
  const band = volatility < 0.1 ? 'steady' : volatility < 0.25 ? 'variable' : 'lumpy';
  const recommendedMonths = band === 'steady' ? 3 : band === 'variable' ? 6 : 9;
  const essential = essentialMonthly(state, month, 3);
  const liquid = liquidCash(state);

  return {
    monthly,
    average: Math.round(mean(monthly)),
    volatility,
    band,
    recommendedMonths,
    recommendedFund: essential * recommendedMonths,
    currentMonths: essential > 0 ? liquid / essential : 0,
  };
}

/* ------------------------------------------------------- anomaly detection */

export type AnomalyKind = 'category-spike' | 'duplicate' | 'new-merchant' | 'trial-converted' | 'large';

export interface Anomaly {
  key: string;
  kind: AnomalyKind;
  title: string;
  detail: string;
  amount: number;
  date: string;
  severity: 'high' | 'medium' | 'low';
  transactionIds: ID[];
}

/** Things worth a second look this month, ranked by how odd they are. */
export function findAnomalies(state: AppState, month: string): Anomaly[] {
  const cats = categoryMap(state);
  const out: Anomaly[] = [];
  const history = monthRange(addMonths(month, -1), 6);
  const thisMonth = txInMonths(state, [month]).filter((t) => t.amount < 0 && !isTransfer(state, t));
  const past = txInMonths(state, history).filter((t) => t.amount < 0 && !isTransfer(state, t));

  // --- Category spikes, measured against that category's own history.
  const byCategoryMonth = new Map<ID, number[]>();
  for (const m of history) {
    const monthTotals = new Map<ID, number>();
    for (const t of past.filter((x) => x.date.slice(0, 7) === m)) {
      monthTotals.set(t.categoryId, (monthTotals.get(t.categoryId) ?? 0) + Math.abs(t.amount));
    }
    for (const cat of state.categories) {
      const list = byCategoryMonth.get(cat.id) ?? [];
      list.push(monthTotals.get(cat.id) ?? 0);
      byCategoryMonth.set(cat.id, list);
    }
  }
  const currentByCategory = new Map<ID, number>();
  for (const t of thisMonth) {
    currentByCategory.set(t.categoryId, (currentByCategory.get(t.categoryId) ?? 0) + Math.abs(t.amount));
  }
  for (const [categoryId, amount] of currentByCategory) {
    const series = byCategoryMonth.get(categoryId) ?? [];
    if (series.filter((v) => v > 0).length < 3) continue;
    const z = zScore(amount, series);
    if (z < 2 || amount - mean(series) < 5000) continue;
    out.push({
      key: `spike:${month}:${categoryId}`,
      kind: 'category-spike',
      title: `${cats[categoryId]?.name ?? 'A category'} is unusually high`,
      detail: `${Math.round(z * 10) / 10} standard deviations above its own six-month pattern — normally around ${Math.round(mean(series) / 100)}, this month ${Math.round(amount / 100)}.`,
      amount: Math.round(amount - mean(series)),
      date: `${month}-01`,
      severity: z > 3 ? 'high' : 'medium',
      transactionIds: thisMonth.filter((t) => t.categoryId === categoryId).map((t) => t.id),
    });
  }

  // --- Same merchant, same amount, within three days: usually a double charge.
  const recent = txInMonths(state, monthRange(month, 2)).filter((t) => t.amount < 0);
  for (let i = 0; i < recent.length; i++) {
    for (let j = i + 1; j < recent.length; j++) {
      const a = recent[i];
      const b = recent[j];
      if (a.amount !== b.amount) continue;
      if (a.payee.toLowerCase() !== b.payee.toLowerCase()) continue;
      const gap = Math.abs(Date.parse(a.date) - Date.parse(b.date)) / 86_400_000;
      if (gap > 3) continue;
      if (Math.abs(a.amount) < 500) continue;
      out.push({
        key: `dupe:${a.id}:${b.id}`,
        kind: 'duplicate',
        title: `Possible double charge at ${a.payee}`,
        detail: `Two identical charges of ${Math.abs(a.amount) / 100} within ${Math.round(gap)} day(s). Worth checking the statement before it ages out of the dispute window.`,
        amount: Math.abs(a.amount),
        date: b.date,
        severity: 'high',
        transactionIds: [a.id, b.id],
      });
    }
  }

  // --- Merchants never seen before this month, above a meaningful size.
  const knownPayees = new Set(past.map((t) => t.payee.toLowerCase()));
  const seenThisMonth = new Set<string>();
  for (const t of thisMonth) {
    const key = t.payee.toLowerCase();
    if (knownPayees.has(key) || seenThisMonth.has(key)) continue;
    seenThisMonth.add(key);
    if (Math.abs(t.amount) < 10000) continue;
    out.push({
      key: `new:${t.id}`,
      kind: 'new-merchant',
      title: `First time at ${t.payee}`,
      detail: `A new merchant taking ${Math.abs(t.amount) / 100}. If this is the start of something recurring, schedule it so the forecast knows.`,
      amount: Math.abs(t.amount),
      date: t.date,
      severity: 'low',
      transactionIds: [t.id],
    });
  }

  // --- A small charge from a merchant that then bills full price: a trial ending.
  const byPayee = new Map<string, Transaction[]>();
  for (const t of txInMonths(state, monthRange(month, 4)).filter((x) => x.amount < 0)) {
    const key = t.payee.toLowerCase();
    byPayee.set(key, [...(byPayee.get(key) ?? []), t]);
  }
  for (const [, list] of byPayee) {
    if (list.length < 2) continue;
    const sorted = [...list].sort((a, b) => a.date.localeCompare(b.date));
    const first = Math.abs(sorted[0].amount);
    const latest = Math.abs(sorted[sorted.length - 1].amount);
    if (first > 200 || latest < 500) continue;
    out.push({
      key: `trial:${sorted[sorted.length - 1].id}`,
      kind: 'trial-converted',
      title: `${sorted[0].payee} went from a trial to full price`,
      detail: `Started at ${first / 100} and now charges ${latest / 100}. If you have not used it since signing up, this is the easiest cancellation on the list.`,
      amount: latest,
      date: sorted[sorted.length - 1].date,
      severity: 'medium',
      transactionIds: sorted.map((t) => t.id),
    });
  }

  return out
    .sort((a, b) => {
      const rank = { high: 0, medium: 1, low: 2 };
      return rank[a.severity] - rank[b.severity] || b.amount - a.amount;
    })
    .slice(0, 25);
}

/* ------------------------------------------------------------- seasonality */

export interface SeasonalLump {
  categoryId: ID;
  /** 1-12 */
  month: number;
  monthName: string;
  typical: number;
  /** What to set aside every month to be ready for it. */
  monthlySinkingFund: number;
}

/**
 * Categories that spike in particular months — insurance, the holidays, tax.
 * Each one becomes a sinking fund suggestion rather than an annual shock.
 */
export function seasonalLumps(state: AppState, month: string): SeasonalLump[] {
  const cats = categoryMap(state);
  const txs = txInMonths(state, monthRange(lastCompleteMonth(month), 24)).filter(
    (t) => t.amount < 0 && !isTransfer(state, t),
  );
  const byCatMonth = new Map<string, number>();
  const byCat = new Map<ID, number[]>();

  for (const t of txs) {
    const key = `${t.categoryId}|${t.date.slice(5, 7)}`;
    byCatMonth.set(key, (byCatMonth.get(key) ?? 0) + Math.abs(t.amount));
  }
  for (const [key, total] of byCatMonth) {
    const [categoryId] = key.split('|');
    byCat.set(categoryId, [...(byCat.get(categoryId) ?? []), total]);
  }

  const out: SeasonalLump[] = [];
  for (const [key, total] of byCatMonth) {
    const [categoryId, mm] = key.split('|');
    const series = byCat.get(categoryId) ?? [];
    if (series.length < 4 || total < 20000) continue;
    const others = series.filter((v) => v !== total);
    if (!others.length) continue;
    const ratio = total / Math.max(1, mean(others));
    if (ratio < 2.5) continue;
    out.push({
      categoryId,
      month: Number(mm),
      monthName: new Date(2000, Number(mm) - 1, 1).toLocaleDateString('en-US', { month: 'long' }),
      typical: Math.round(total),
      monthlySinkingFund: Math.round(total / 12),
    });
  }
  return out
    .filter((l) => cats[l.categoryId])
    .sort((a, b) => b.typical - a.typical)
    .slice(0, 8);
}

/* ------------------------------------------------------- lifestyle creep */

export type CreepVerdict = 'creep' | 'squeeze' | 'healthy' | 'tightening';

export interface Creep {
  incomeGrowth: number;
  spendingGrowth: number;
  /** Positive means spending is outrunning income. */
  gap: number;
  /** Extra money earned that was also spent, per month. */
  absorbed: number;
  /**
   * creep      — earning more and spending most of it
   * squeeze    — earning less but spending more
   * tightening — spending falling
   * healthy    — spending growing no faster than income
   */
  verdict: CreepVerdict;
  early: { income: number; spending: number };
  late: { income: number; spending: number };
}

/** Compares the first half of a window against the second. */
export function lifestyleCreep(state: AppState, month: string, months = 12): Creep | null {
  const series = monthSeries(state, lastCompleteMonth(month), months).filter((m) => m.income > 0);
  if (series.length < 6) return null;
  // Medians, not means: a single bonus in one half would otherwise read as a pay
  // rise in that half and a pay cut in the other.
  const half = Math.floor(series.length / 2);
  const early = {
    income: median(series.slice(0, half).map((m) => m.income)),
    spending: median(series.slice(0, half).map((m) => m.expense)),
  };
  const late = {
    income: median(series.slice(half).map((m) => m.income)),
    spending: median(series.slice(half).map((m) => m.expense)),
  };
  const incomeGrowth = early.income ? (late.income - early.income) / early.income : 0;
  const spendingGrowth = early.spending ? (late.spending - early.spending) / early.spending : 0;
  const extraEarned = late.income - early.income;
  const extraSpent = late.spending - early.spending;

  const verdict: CreepVerdict =
    spendingGrowth < -0.02
      ? 'tightening'
      : // 5%, not 2%: ordinary payroll variance should not read as a pay cut.
        incomeGrowth < -0.05 && spendingGrowth > 0
        ? 'squeeze'
        : spendingGrowth > incomeGrowth + 0.02
          ? 'creep'
          : 'healthy';

  return {
    incomeGrowth,
    spendingGrowth,
    gap: spendingGrowth - incomeGrowth,
    absorbed: extraEarned > 0 ? Math.round(Math.min(extraSpent, extraEarned)) : Math.round(extraSpent),
    verdict,
    early: { income: Math.round(early.income), spending: Math.round(early.spending) },
    late: { income: Math.round(late.income), spending: Math.round(late.spending) },
  };
}

/* --------------------------------------------------------- freedom metrics */

export interface FreedomMetrics {
  invested: number;
  annualSpending: number;
  /** Invested assets as a multiple of a year's spending. */
  fiRatio: number;
  /** Progress toward 25x annual spending. */
  fiProgress: number;
  /** Years of spending already covered. */
  yearsCovered: number;
  /** Days of future freedom bought by this month's saving. */
  daysBoughtThisMonth: number;
  monthlySurplus: number;
}

/**
 * Reframes saving as time rather than money: at a 4% withdrawal rate, every 25
 * saved covers one of spending forever, so a month's surplus buys a countable
 * number of days you will not need to work.
 */
export function freedomMetrics(state: AppState, month: string): FreedomMetrics {
  const balances = accountBalances(state);
  const invested = state.accounts
    .filter((a) => !a.archived && (a.type === 'investment' || a.type === 'retirement'))
    .reduce((total, a) => total + (balances[a.id] ?? 0), 0);

  const recent = monthSeries(state, month, 3);
  const annualSpending = Math.round(mean(recent.map((m) => m.expense)) * 12);
  const monthlySurplus = Math.round(mean(recent.map((m) => m.net)));
  const dailySpend = annualSpending / 365;

  return {
    invested,
    annualSpending,
    fiRatio: annualSpending > 0 ? invested / annualSpending : 0,
    fiProgress: annualSpending > 0 ? Math.min(1, invested / (annualSpending * 25)) : 0,
    yearsCovered: annualSpending > 0 ? invested / annualSpending : 0,
    // Money saved supports 4% a year forever, so it covers 25x its own value.
    daysBoughtThisMonth: dailySpend > 0 ? Math.max(0, (monthlySurplus * 25) / dailySpend) : 0,
    monthlySurplus,
  };
}

/* --------------------------------------------------- net worth attribution */

export interface Attribution {
  month: string;
  total: number;
  saved: number;
  debtPaid: number;
  marketMove: number;
}

/**
 * Splits each month's net-worth change into the part you caused and the part the
 * market did. A bad market month should not read as a personal failure.
 */
export function netWorthAttribution(state: AppState, month: string, months = 6): Attribution[] {
  const cats = categoryMap(state);
  return monthRange(month, months).map((m) => {
    const txs = txInMonths(state, [m]);
    const saved = sum(
      txs.filter((t) => t.amount < 0 && isTransfer(state, t)).map((t) => Math.abs(t.amount)),
    );
    const debtPaid = sum(
      txs
        .filter((t) => t.amount < 0 && cats[t.categoryId]?.group === 'Debt')
        .map((t) => Math.abs(t.amount)),
    );
    const snapshot = state.netWorth.find((s) => s.month === m);
    const previous = state.netWorth.find((s) => s.month === addMonths(m, -1));
    const total =
      snapshot && previous
        ? snapshot.assets - snapshot.liabilities - (previous.assets - previous.liabilities)
        : saved + debtPaid;
    return {
      month: m,
      total,
      saved,
      debtPaid,
      marketMove: total - saved - debtPaid,
    };
  });
}

/* ------------------------------------------------------- merchant inflation */

export interface BasketInflation {
  categoryId: ID;
  /** Average spend per visit, earlier window vs later. */
  earlyPerVisit: number;
  latePerVisit: number;
  change: number;
  /** Visits per active month, so uneven window lengths do not distort it. */
  visitsEarly: number;
  visitsLate: number;
  /** Change in how often, as opposed to how much per trip. */
  frequencyChange: number;
}

/**
 * Separates "it costs more" from "we bought more" by comparing spend per visit
 * against visit count.
 */
export function basketInflation(state: AppState, month: string, months = 12): BasketInflation[] {
  const cats = categoryMap(state);
  const anchor = lastCompleteMonth(month);
  const half = Math.floor(months / 2);
  const lateMonths = monthRange(anchor, half);
  const earlyMonths = monthRange(addMonths(anchor, -half), months - half);
  const early = txInMonths(state, earlyMonths).filter((t) => t.amount < 0 && !isTransfer(state, t));
  const late = txInMonths(state, lateMonths).filter((t) => t.amount < 0 && !isTransfer(state, t));

  // Windows can hold different amounts of real history — the ledger may simply
  // not go back far enough — so frequency is measured per active month.
  const activeMonths = (txs: typeof early): number =>
    new Set(txs.map((t) => t.date.slice(0, 7))).size || 1;
  const earlyActive = activeMonths(early);
  const lateActive = activeMonths(late);

  const out: BasketInflation[] = [];
  for (const cat of state.categories) {
    if (cat.kind !== 'expense') continue;
    const e = early.filter((t) => t.categoryId === cat.id);
    const l = late.filter((t) => t.categoryId === cat.id);
    if (e.length < 5 || l.length < 5) continue;
    const earlyPerVisit = Math.round(sum(e.map((t) => Math.abs(t.amount))) / e.length);
    const latePerVisit = Math.round(sum(l.map((t) => Math.abs(t.amount))) / l.length);
    if (earlyPerVisit === 0) continue;
    const earlyRate = e.length / earlyActive;
    const lateRate = l.length / lateActive;
    out.push({
      categoryId: cat.id,
      earlyPerVisit,
      latePerVisit,
      change: (latePerVisit - earlyPerVisit) / earlyPerVisit,
      visitsEarly: Math.round(earlyRate * 10) / 10,
      visitsLate: Math.round(lateRate * 10) / 10,
      frequencyChange: earlyRate > 0 ? (lateRate - earlyRate) / earlyRate : 0,
    });
  }
  return out
    .filter((r) => cats[r.categoryId])
    .sort((a, b) => Math.abs(b.change) - Math.abs(a.change))
    .slice(0, 10);
}

/* ---------------------------------------------------------------- heatmaps */

export interface Heat {
  /** 0 = Sunday. */
  weekday: number[];
  /** Index 0 = 1st of the month. */
  monthday: number[];
  busiestWeekday: number;
  weekendShare: number;
}

/** When money leaves, rather than where it goes. */
export function spendingHeat(state: AppState, month: string, months = 6): Heat {
  const txs = txInMonths(state, monthRange(month, months)).filter(
    (t) => t.amount < 0 && !isTransfer(state, t),
  );
  const weekday = new Array(7).fill(0);
  const monthday = new Array(31).fill(0);
  for (const t of txs) {
    weekday[dayOfWeek(t.date)] += Math.abs(t.amount);
    monthday[Math.min(30, dayOfMonth(t.date) - 1)] += Math.abs(t.amount);
  }
  const total = sum(weekday) || 1;
  return {
    weekday,
    monthday,
    busiestWeekday: weekday.indexOf(Math.max(...weekday)),
    weekendShare: (weekday[0] + weekday[6]) / total,
  };
}
