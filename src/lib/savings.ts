import type { AppState, Transaction } from '../store/types';
import { addMonths, monthOf, monthRange, todayISO } from './date';
import { formatMoney, sum } from './money';
import { detectRecurring, staleSeries, type RecurringSeries } from './recurring';
import {
  averageSurplus,
  categoryMap,
  expense,
  income,
  monthSeries,
  runwayMonths,
  spendByCategory,
  txInMonth,
  txInMonths,
} from '../store/selectors';
import { weightedApr } from './debt';

export type Effort = 'easy' | 'medium' | 'hard';

export interface Suggestion {
  key: string;
  title: string;
  detail: string;
  /** Estimated recurring saving, in cents per month. 0 for one-off or advisory items. */
  monthlySaving: number;
  annualSaving: number;
  effort: Effort;
  tag: 'Subscriptions' | 'Habits' | 'Rates' | 'Structure' | 'Risk' | 'Goals';
  /** Categories or payees the suggestion is about, for drill-down. */
  evidence: string[];
}

const money = (state: AppState, cents: number): string =>
  formatMoney(cents, { currency: state.settings.currency, locale: state.settings.locale });

/**
 * Transactions worth scanning for subscriptions. A standing transfer into the
 * house fund repeats like Netflix does, but cancelling it is not a saving.
 */
export function recurringCandidates(state: AppState, txs: Transaction[]): Transaction[] {
  const cats = categoryMap(state);
  return txs.filter((t) => t.amount < 0 && cats[t.categoryId]?.group !== 'Savings');
}

/**
 * The savings engine. Everything here is derived from the couple's own history —
 * no generic tips, only findings with an amount attached.
 */
export function findSavings(state: AppState, month: string): Suggestion[] {
  const out: Suggestion[] = [];
  const cats = categoryMap(state);
  const last6 = monthRange(month, 6);
  const recent = txInMonths(state, last6);
  const series = detectRecurring(recurringCandidates(state, recent));
  const summaries = monthSeries(state, month, 6).filter((m) => m.income > 0 || m.expense > 0);
  const avgIncome = summaries.length ? Math.round(sum(summaries.map((s) => s.income)) / summaries.length) : 0;
  const avgExpense = summaries.length ? Math.round(sum(summaries.map((s) => s.expense)) / summaries.length) : 0;

  out.push(...subscriptionFindings(state, series, money.bind(null, state)));
  out.push(...habitFindings(state, month, money.bind(null, state)));

  // --- Category creep: this month running hot against its own 3-month average.
  const prior = monthRange(addMonths(month, -1), 3);
  for (const row of spendByCategory(state, month)) {
    const cat = cats[row.categoryId];
    if (!cat || cat.essential) continue;
    const priorTotal = sum(
      txInMonths(state, prior)
        .filter((t) => t.categoryId === row.categoryId && t.amount < 0)
        .map((t) => Math.abs(t.amount)),
    );
    const avg = Math.round(priorTotal / 3);
    if (avg < 5000 || row.amount < avg * 1.25) continue;
    const excess = row.amount - avg;
    if (excess < 2500) continue;
    out.push({
      key: `creep:${row.categoryId}`,
      title: `${cat.name} is running ${Math.round((row.amount / avg - 1) * 100)}% above normal`,
      detail: `You have spent ${money(state, row.amount)} this month against a ${money(state, avg)} three-month average. Pulling back to average frees ${money(state, excess)}.`,
      monthlySaving: excess,
      annualSaving: excess * 12,
      effort: 'medium',
      tag: 'Habits',
      evidence: [cat.name],
    });
  }

  // --- Wants share of income against the 50/30/20 guideline.
  const wants = sum(
    txInMonths(state, last6)
      .filter((t) => t.amount < 0 && cats[t.categoryId] && !cats[t.categoryId].essential)
      .map((t) => Math.abs(t.amount)),
  );
  const wantsMonthly = Math.round(wants / Math.max(1, summaries.length));
  if (avgIncome > 0 && wantsMonthly / avgIncome > 0.3) {
    const trimTo = Math.round(avgIncome * 0.3);
    const saving = wantsMonthly - trimTo;
    out.push({
      key: 'wants-share',
      title: `Discretionary spending is ${Math.round((wantsMonthly / avgIncome) * 100)}% of income`,
      detail: `A common guideline caps wants at 30%. You average ${money(state, wantsMonthly)}/mo on non-essentials. Trimming to 30% of income would free ${money(state, saving)} every month.`,
      monthlySaving: saving,
      annualSaving: saving * 12,
      effort: 'hard',
      tag: 'Habits',
      evidence: ['Discretionary categories'],
    });
  }

  // --- Savings rate against the household's own target.
  const rate = avgIncome > 0 ? (avgIncome - avgExpense) / avgIncome : 0;
  if (avgIncome > 0 && rate < state.settings.savingsRateTarget) {
    const need = Math.round(avgIncome * state.settings.savingsRateTarget - (avgIncome - avgExpense));
    out.push({
      key: 'savings-rate',
      title: `Savings rate is ${Math.round(rate * 100)}%, target is ${Math.round(state.settings.savingsRateTarget * 100)}%`,
      detail: `You are saving ${money(state, avgIncome - avgExpense)} of ${money(state, avgIncome)} a month. Closing the gap means finding ${money(state, need)} a month — the suggestions on this page add up to more than that if you take the top few.`,
      monthlySaving: 0,
      annualSaving: 0,
      effort: 'medium',
      tag: 'Goals',
      evidence: [],
    });
  }

  out.push(...rateFindings(state, month));
  out.push(...structureFindings(state, month));

  return out
    .filter((s) => !state.dismissedSuggestions.includes(s.key))
    .sort((a, b) => b.annualSaving - a.annualSaving || a.effort.localeCompare(b.effort));
}

function subscriptionFindings(
  state: AppState,
  series: RecurringSeries[],
  money: (c: number) => string,
): Suggestion[] {
  const out: Suggestion[] = [];
  const cats = categoryMap(state);

  for (const s of series) {
    const cat = cats[s.categoryId];
    const discretionary = cat ? !cat.essential : true;
    if (!discretionary || s.annualCost < 3000) continue;
    out.push({
      key: `sub:${s.key}`,
      title: `${s.payee} — ${money(s.typicalAmount)} ${s.cadence}`,
      detail: `${s.occurrences} charges detected, most recently ${s.lastDate}. Cancelling frees ${money(s.annualCost)} a year.${
        s.priceIncrease > 0.05
          ? ` The price has risen ${Math.round(s.priceIncrease * 100)}% since the first charge — worth a renegotiation call.`
          : ''
      }`,
      monthlySaving: s.monthlyCost,
      annualSaving: s.annualCost,
      effort: 'easy',
      tag: 'Subscriptions',
      evidence: [s.payee],
    });
  }

  for (const s of staleSeries(series, todayISO())) {
    out.push({
      key: `stale:${s.key}`,
      title: `${s.payee} may have lapsed or be billing off-cycle`,
      detail: `Expected roughly every ${s.cadenceDays} days but nothing since ${s.lastDate}. Confirm it is actually cancelled — otherwise a surprise charge is coming.`,
      monthlySaving: 0,
      annualSaving: 0,
      effort: 'easy',
      tag: 'Subscriptions',
      evidence: [s.payee],
    });
  }

  // --- Overlapping services inside one category (three streaming apps, two gyms).
  const byCat = new Map<string, RecurringSeries[]>();
  for (const s of series) {
    const list = byCat.get(s.categoryId) ?? [];
    list.push(s);
    byCat.set(s.categoryId, list);
  }
  for (const [catId, list] of byCat) {
    if (list.length < 3) continue;
    const cat = cats[catId];
    if (!cat || cat.essential) continue;
    const keepTop = [...list].sort((a, b) => b.monthlyCost - a.monthlyCost).slice(2);
    const saving = sum(keepTop.map((s) => s.monthlyCost));
    if (saving < 500) continue;
    out.push({
      key: `overlap:${catId}`,
      title: `${list.length} overlapping ${cat.name.toLowerCase()} subscriptions`,
      detail: `${list.map((s) => s.payee).join(', ')} all bill on a schedule. Rotating down to the two you use most saves ${money(saving)} a month.`,
      monthlySaving: saving,
      annualSaving: saving * 12,
      effort: 'easy',
      tag: 'Subscriptions',
      evidence: list.map((s) => s.payee),
    });
  }
  return out;
}

const FEE_WORDS =
  /\b(fees?|overdraft|nsf|atm|interest charge|late charge|service charge|account maintenance)\b/i;

function habitFindings(state: AppState, month: string, money: (c: number) => string): Suggestion[] {
  const out: Suggestion[] = [];
  const cats = categoryMap(state);
  const months = monthRange(month, 3);
  const txs = txInMonths(state, months).filter((t) => t.amount < 0);

  // --- Small, frequent, discretionary purchases: the classic leak.
  const groups = new Map<string, { count: number; total: number; payee: string; cat: string }>();
  for (const t of txs) {
    const cat = cats[t.categoryId];
    if (!cat || cat.essential) continue;
    if (Math.abs(t.amount) > 3000) continue;
    const key = t.payee.toLowerCase().trim();
    const g = groups.get(key) ?? { count: 0, total: 0, payee: t.payee, cat: cat.name };
    g.count += 1;
    g.total += Math.abs(t.amount);
    groups.set(key, g);
  }
  for (const [key, g] of groups) {
    if (g.count < 12) continue; // 4+ visits a month across the window
    const monthly = Math.round(g.total / 3);
    const saving = Math.round(monthly / 2);
    if (saving < 1500) continue;
    out.push({
      key: `habit:${key}`,
      title: `${g.count} small purchases at ${g.payee} in three months`,
      detail: `That is ${money(monthly)} a month on ${g.cat.toLowerCase()}, in trips averaging ${money(Math.round(g.total / g.count))}. Halving the frequency saves ${money(saving)} a month without giving it up entirely.`,
      monthlySaving: saving,
      annualSaving: saving * 12,
      effort: 'medium',
      tag: 'Habits',
      evidence: [g.payee],
    });
  }

  // --- Bank and card fees: pure waste, almost always avoidable.
  const fees = txs.filter((t) => FEE_WORDS.test(t.payee) || FEE_WORDS.test(t.note));
  if (fees.length) {
    const monthly = Math.round(sum(fees.map((t) => Math.abs(t.amount))) / 3);
    if (monthly > 0) {
      out.push({
        key: 'fees',
        title: `${fees.length} bank or card fees in the last three months`,
        detail: `Fees cost you ${money(monthly)} a month. Switching to a no-fee account, turning on balance alerts, or setting autopay usually removes this entirely.`,
        monthlySaving: monthly,
        annualSaving: monthly * 12,
        effort: 'easy',
        tag: 'Rates',
        evidence: [...new Set(fees.map((t) => t.payee))].slice(0, 5),
      });
    }
  }

  // --- Weekend vs weekday discretionary skew, a useful behavioural nudge.
  const weekend = txs.filter((t) => {
    const d = new Date(t.date + 'T00:00:00').getDay();
    const cat = cats[t.categoryId];
    return (d === 0 || d === 6) && cat && !cat.essential;
  });
  const weekendTotal = sum(weekend.map((t) => Math.abs(t.amount)));
  const discTotal = sum(
    txs.filter((t) => cats[t.categoryId] && !cats[t.categoryId].essential).map((t) => Math.abs(t.amount)),
  );
  if (discTotal > 0 && weekendTotal / discTotal > 0.5 && weekendTotal > 30000) {
    const saving = Math.round(weekendTotal / 3 / 5);
    out.push({
      key: 'weekend-skew',
      title: `${Math.round((weekendTotal / discTotal) * 100)}% of discretionary spending happens at weekends`,
      detail: `Weekends cost you ${money(Math.round(weekendTotal / 3))} a month. Agreeing one planned "no-spend" weekend a month trims about ${money(saving)}.`,
      monthlySaving: saving,
      annualSaving: saving * 12,
      effort: 'medium',
      tag: 'Habits',
      evidence: ['Weekend spending'],
    });
  }

  return out;
}

/** Rate arbitrage: idle cash, expensive debt, and the gap between them. */
function rateFindings(state: AppState, month: string): Suggestion[] {
  const out: Suggestion[] = [];
  const m = (c: number) => money(state, c);
  const HYSA = 0.042;

  const idle = state.accounts.filter(
    (a) => !a.archived && (a.type === 'checking' || a.type === 'cash') && a.balance > 0,
  );
  const idleCash = sum(idle.map((a) => a.balance));
  const monthlyExpense = monthSeries(state, month, 3).reduce((a, s) => a + s.expense, 0) / 3;
  const buffer = Math.round(monthlyExpense * 1.5);
  const movable = idleCash - buffer;
  if (movable > 100000) {
    const gain = Math.round((movable * (HYSA - 0.001)) / 12);
    out.push({
      key: 'idle-cash',
      title: `${m(movable)} sitting in checking beyond your buffer`,
      detail: `Keeping 1.5 months of spending (${m(buffer)}) in checking is plenty. The rest earns roughly nothing where it is; at a ~4.2% savings rate it would make ${m(gain)} a month, ${m(gain * 12)} a year.`,
      monthlySaving: gain,
      annualSaving: gain * 12,
      effort: 'easy',
      tag: 'Rates',
      evidence: idle.map((a) => a.name),
    });
  }

  const expensive = state.debts.filter((d) => d.balance > 0 && d.apr > 0.1);
  if (expensive.length && idleCash > buffer) {
    const payable = Math.min(idleCash - buffer, sum(expensive.map((d) => d.balance)));
    if (payable > 50000) {
      const saved = Math.round((payable * weightedApr(expensive)) / 12);
      out.push({
        key: 'cash-vs-debt',
        title: `Cash is earning less than your debt is costing`,
        detail: `You hold ${m(idleCash)} in cash while carrying ${m(sum(expensive.map((d) => d.balance)))} at an average ${(weightedApr(expensive) * 100).toFixed(1)}% APR. Putting ${m(payable)} against the highest-rate balance stops about ${m(saved)} of interest a month.`,
        monthlySaving: saved,
        annualSaving: saved * 12,
        effort: 'medium',
        tag: 'Rates',
        evidence: expensive.map((d) => d.name),
      });
    }
  }

  const cards = state.accounts.filter((a) => a.type === 'credit' && a.balance > 0 && a.apr > 0.15);
  for (const c of cards) {
    const saving = Math.round((c.balance * (c.apr - 0.0)) / 12 / 2);
    if (saving < 1000) continue;
    out.push({
      key: `balance-transfer:${c.id}`,
      title: `${c.name} carries ${m(c.balance)} at ${(c.apr * 100).toFixed(1)}%`,
      detail: `A 0% balance-transfer offer (typically 3% fee, 12–18 months) would pause the interest. Even half a year of relief is worth roughly ${m(saving * 6)}.`,
      monthlySaving: saving,
      annualSaving: saving * 12,
      effort: 'medium',
      tag: 'Rates',
      evidence: [c.name],
    });
  }

  return out;
}

/** Structural findings: risk cover, envelope hygiene, and goal funding. */
function structureFindings(state: AppState, month: string): Suggestion[] {
  const out: Suggestion[] = [];
  const m = (c: number) => money(state, c);
  const runway = runwayMonths(state, month);

  if (runway < 3) {
    const monthlyEssential =
      sum(
        txInMonths(state, monthRange(month, 3))
          .filter((t) => t.amount < 0 && categoryMap(state)[t.categoryId]?.essential)
          .map((t) => Math.abs(t.amount)),
      ) / 3;
    out.push({
      key: 'runway',
      title: `Emergency fund covers ${runway.toFixed(1)} months of essentials`,
      detail: `Two incomes are two things that can stop. At ${m(Math.round(monthlyEssential))} of essential spending a month, a three-month cushion is ${m(Math.round(monthlyEssential * 3))}. This is the one goal worth funding before the fun ones.`,
      monthlySaving: 0,
      annualSaving: 0,
      effort: 'medium',
      tag: 'Risk',
      evidence: [],
    });
  }

  // --- Envelopes that consistently go unspent are budget theatre; redirect them.
  const lines = state.budget.filter((b) => b.month === month && b.planned > 0);
  for (const line of lines) {
    const spent = sum(
      txInMonth(state, month)
        .filter((t) => t.categoryId === line.categoryId && t.amount < 0)
        .map((t) => Math.abs(t.amount)),
    );
    const slack = line.planned - spent;
    const cat = categoryMap(state)[line.categoryId];
    if (!cat || slack < 5000 || spent / line.planned > 0.6) continue;
    out.push({
      key: `slack:${line.categoryId}`,
      title: `${cat.name} envelope is only ${Math.round((spent / line.planned) * 100)}% used`,
      detail: `You planned ${m(line.planned)} and spent ${m(spent)}. Moving ${m(slack)} to your top goal turns dead budget into progress.`,
      monthlySaving: 0,
      annualSaving: 0,
      effort: 'easy',
      tag: 'Goals',
      evidence: [cat.name],
    });
  }

  const surplus = averageSurplus(state, month, 3);
  const committed = sum(state.goals.filter((g) => !g.archived).map((g) => g.monthlyContribution));
  if (surplus - committed > 20000) {
    out.push({
      key: 'unassigned-surplus',
      title: `${m(surplus - committed)} a month is unassigned`,
      detail: `You clear ${m(surplus)} a month on average but only ${m(committed)} is pointed at a goal. Unassigned money gets spent — send it somewhere on the Goals page.`,
      monthlySaving: 0,
      annualSaving: 0,
      effort: 'easy',
      tag: 'Goals',
      evidence: [],
    });
  }

  return out;
}

/** Headline number: what taking every actionable suggestion would be worth. */
export function totalOpportunity(suggestions: Suggestion[]): { monthly: number; annual: number } {
  const monthly = sum(suggestions.map((s) => s.monthlySaving));
  return { monthly, annual: monthly * 12 };
}

export function spendMix(state: AppState, month: string): { needs: number; wants: number; savings: number } {
  const cats = categoryMap(state);
  const txs = txInMonth(state, month);
  const inc = income(txs);
  let needs = 0;
  let wants = 0;
  for (const t of txs) {
    if (t.amount >= 0) continue;
    const cat = cats[t.categoryId];
    if (cat?.group === 'Savings') continue;
    if (cat?.essential) needs += Math.abs(t.amount);
    else wants += Math.abs(t.amount);
  }
  return { needs, wants, savings: Math.max(0, inc - expense(state, txs)) };
}

export { monthOf };
