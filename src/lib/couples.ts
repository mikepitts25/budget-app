import type { AppState, ID, Transaction } from '../store/types';
import { categoryMap, isTransfer, monthSummary, txInMonth } from '../store/selectors';
import { fairness } from './split';
import { findSavings } from './savings';
import { findAnomalies, freedomMetrics, lifestyleCreep } from './analysis';
import { goalStatus } from './projections';
import { monthLabel } from './date';
import { formatMoney, sum } from './money';

export const activePerson = (state: AppState) =>
  state.people.find((p) => p.id === state.settings.activePersonId) ?? state.people[0];

/**
 * Private spending stays private in its detail, not in its total. The other
 * partner still sees the amount — it is shared money — but not the merchant.
 * Hiding the amount too would silently corrupt every total in the app.
 */
export function visiblePayee(state: AppState, tx: Transaction): string {
  if (!tx.private) return tx.payee;
  return tx.paidBy === state.settings.activePersonId ? tx.payee : 'Private';
}

export const canSeeDetail = (state: AppState, tx: Transaction): boolean =>
  !tx.private || tx.paidBy === state.settings.activePersonId;

/**
 * A big purchase worth checking in about. Deliberately narrow: the rent, the
 * insurance premium and anything already on the schedule were agreed long ago,
 * and a queue full of them would train both of you to ignore it. What is left is
 * genuine discretionary surprises.
 */
export function needsApproval(state: AppState, tx: Transaction): boolean {
  const threshold = state.settings.bigPurchaseThreshold;
  if (threshold <= 0) return false;
  if (tx.amount >= 0 || isTransfer(state, tx)) return false;
  if (Math.abs(tx.amount) < threshold) return false;
  if (categoryMap(state)[tx.categoryId]?.essential) return false;
  if (isScheduled(state, tx)) return false;
  return state.people.some((p) => !tx.approvals.includes(p.id));
}

/** Is this transaction one of the commitments the couple already planned for? */
export function isScheduled(state: AppState, tx: Transaction): boolean {
  const payee = tx.payee.toLowerCase();
  return state.scheduled.some(
    (s) => s.enabled && payee.includes(s.name.toLowerCase().slice(0, 8)),
  );
}

export const awaitingApproval = (state: AppState, month: string): Transaction[] =>
  txInMonth(state, month).filter((t) => needsApproval(state, t));

/* ------------------------------------------------------------- money date */

export interface MoneyDateItem {
  title: string;
  detail: string;
  amount?: number;
}

export interface MoneyDate {
  month: string;
  headline: string;
  wins: MoneyDateItem[];
  leaks: MoneyDateItem[];
  decisions: MoneyDateItem[];
  /** One line each partner should read out loud, because it concerns them. */
  perPerson: { personId: ID; line: string }[];
}

/**
 * Assembles the monthly review from every engine in the app. The output is
 * deliberately short: three wins, three leaks, three decisions. A report nobody
 * finishes reading changes nothing.
 */
export function buildMoneyDate(state: AppState, month: string): MoneyDate {
  const money = (c: number) =>
    formatMoney(c, { currency: state.settings.currency, locale: state.settings.locale });
  const cats = categoryMap(state);
  const summary = monthSummary(state, month);
  const previous = monthSummary(state, month.slice(0, 8) === '' ? month : prevMonth(month));

  const wins: MoneyDateItem[] = [];
  const leaks: MoneyDateItem[] = [];
  const decisions: MoneyDateItem[] = [];

  /* --- wins */
  if (summary.net > 0) {
    wins.push({
      title: `You kept ${money(summary.net)}`,
      detail: `${Math.round(summary.savingsRate * 100)}% of what came in, against a ${Math.round(
        state.settings.savingsRateTarget * 100,
      )}% target.`,
      amount: summary.net,
    });
  }
  if (summary.expense < previous.expense && previous.expense > 0) {
    wins.push({
      title: `Spending fell ${money(previous.expense - summary.expense)}`,
      detail: `Down from ${money(previous.expense)} last month.`,
      amount: previous.expense - summary.expense,
    });
  }
  if (summary.transfers > 0) {
    wins.push({
      title: `${money(summary.transfers)} moved into savings and investments`,
      detail: 'Money that left your spending accounts on purpose rather than by accident.',
      amount: summary.transfers,
    });
  }
  const funded = state.goals
    .filter((g) => !g.archived)
    .map(goalStatus)
    .filter((s) => s.onTrack);
  if (funded.length) {
    wins.push({
      title: `${funded.length} of ${state.goals.filter((g) => !g.archived).length} goals are on track`,
      detail: funded.map((f) => f.goal.name).join(', '),
    });
  }
  const freedom = freedomMetrics(state, month);
  if (freedom.daysBoughtThisMonth > 1) {
    wins.push({
      title: `This month bought ${Math.round(freedom.daysBoughtThisMonth)} days of freedom`,
      detail: 'At a 4% withdrawal rate, that is how long the surplus covers your own spending, forever.',
    });
  }

  /* --- leaks */
  for (const s of findSavings(state, month).slice(0, 3)) {
    leaks.push({ title: s.title, detail: s.detail, amount: s.annualSaving });
  }
  for (const a of findAnomalies(state, month).filter((x) => x.severity === 'high').slice(0, 2)) {
    leaks.push({ title: a.title, detail: a.detail, amount: a.amount });
  }
  const overspent = state.budget
    .filter((b) => b.month === month && b.planned > 0)
    .map((b) => {
      const actual = sum(
        txInMonth(state, month)
          .filter((t) => t.categoryId === b.categoryId && t.amount < 0)
          .map((t) => Math.abs(t.amount)),
      );
      return { b, actual, over: actual - b.planned };
    })
    .filter((r) => r.over > 0)
    .sort((a, b) => b.over - a.over);
  if (overspent.length) {
    leaks.push({
      title: `${overspent.length} envelopes went over`,
      detail: overspent
        .slice(0, 3)
        .map((r) => `${cats[r.b.categoryId]?.name} by ${money(r.over)}`)
        .join(', '),
      amount: sum(overspent.map((r) => r.over)),
    });
  }

  /* --- decisions */
  const { settlements } = fairness(state, txInMonth(state, month));
  for (const s of settlements) {
    decisions.push({
      title: `Settle up: ${state.people.find((p) => p.id === s.from)?.name} → ${
        state.people.find((p) => p.id === s.to)?.name
      }`,
      detail: `${money(s.amount)} squares the month under your current split rules.`,
      amount: s.amount,
    });
  }
  const pending = awaitingApproval(state, month);
  if (pending.length) {
    decisions.push({
      title: `${pending.length} purchases still need both of you to sign off`,
      detail: pending
        .slice(0, 3)
        .map((t) => `${visiblePayee(state, t)} ${money(Math.abs(t.amount))}`)
        .join(', '),
    });
  }
  const behind = state.goals
    .filter((g) => !g.archived)
    .map(goalStatus)
    .filter((s) => !s.onTrack);
  if (behind.length) {
    decisions.push({
      title: `${behind.length} goals need more money or more time`,
      detail: behind
        .slice(0, 3)
        .map((b) => `${b.goal.name} is ${money(b.gap)}/mo short`)
        .join(', '),
      amount: sum(behind.map((b) => b.gap)),
    });
  }
  const creep = lifestyleCreep(state, month);
  if (creep && creep.verdict === 'creep') {
    decisions.push({
      title: 'Decide where the extra spending is going',
      detail: `Spending is up ${Math.round(creep.spendingGrowth * 100)}% across the window while income is up ${Math.round(
        creep.incomeGrowth * 100,
      )}%. Worth naming what changed before it becomes the new baseline.`,
    });
  }

  /* --- per person */
  const { rows } = fairness(state, txInMonth(state, month));
  const perPerson = state.people.map((p) => {
    const row = rows.find((r) => r.personId === p.id);
    const personal = sum(
      txInMonth(state, month)
        .filter((t) => t.amount < 0 && t.splitRule === 'personal' && t.paidBy === p.id)
        .map((t) => Math.abs(t.amount)),
    );
    return {
      personId: p.id,
      line: `${p.name} paid ${money(row?.paid ?? 0)} of the shared costs against a ${money(
        row?.owed ?? 0,
      )} share, and spent ${money(personal)} personally.`,
    };
  });

  const headline =
    summary.net >= 0
      ? `You kept ${money(summary.net)} in ${monthLabel(month, 'long')}.`
      : `You spent ${money(-summary.net)} more than came in during ${monthLabel(month, 'long')}.`;

  return {
    month,
    headline,
    wins: wins.slice(0, 3),
    leaks: leaks.slice(0, 3),
    decisions: decisions.slice(0, 3),
    perPerson,
  };
}

const prevMonth = (month: string): string => {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

/** Plain-text version, for pasting into a message or a shared note. */
export function moneyDateText(state: AppState, report: MoneyDate): string {
  const lines: string[] = [
    `${state.settings.householdName} — money date, ${monthLabel(report.month, 'long')}`,
    report.headline,
    '',
  ];
  const section = (title: string, items: MoneyDateItem[]) => {
    if (!items.length) return;
    lines.push(title.toUpperCase());
    for (const i of items) lines.push(`- ${i.title}. ${i.detail}`);
    lines.push('');
  };
  section('Wins', report.wins);
  section('Leaks', report.leaks);
  section('Decisions', report.decisions);
  for (const p of report.perPerson) lines.push(p.line);
  return lines.join('\n');
}
