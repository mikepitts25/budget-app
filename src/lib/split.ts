import type { AppState, ID, Person, Transaction } from '../store/types';
import { allocate, sum } from './money';

/**
 * Fairness is worked out in base currency. Who owes whom cannot be decided by
 * adding a euro rent to a dollar grocery run.
 */
const value = (tx: Transaction): number => tx.baseAmount ?? tx.amount;

/** Weights each person should carry for a given transaction, under its split rule. */
export function shareWeights(tx: Transaction, people: Person[]): Record<ID, number> {
  switch (tx.splitRule) {
    case 'even':
      return Object.fromEntries(people.map((p) => [p.id, 1]));
    case 'income': {
      const total = sum(people.map((p) => p.annualIncome));
      if (total <= 0) return Object.fromEntries(people.map((p) => [p.id, 1]));
      return Object.fromEntries(people.map((p) => [p.id, p.annualIncome]));
    }
    case 'personal':
    case 'custom': {
      const explicit = people.reduce<Record<ID, number>>((acc, p) => {
        acc[p.id] = tx.splitShares[p.id] ?? 0;
        return acc;
      }, {});
      if (sum(Object.values(explicit)) > 0) return explicit;
      // No shares recorded: a personal cost belongs to whoever paid it, and an
      // unconfigured custom split falls back to even. Either way the weights must
      // total something, or the cost would be paid by someone and owed by nobody.
      if (tx.splitRule === 'personal' && tx.paidBy !== 'joint') {
        return Object.fromEntries(people.map((p) => [p.id, p.id === tx.paidBy ? 1 : 0]));
      }
      return Object.fromEntries(people.map((p) => [p.id, 1]));
    }
  }
}

/** Cents of a transaction each person is responsible for (always positive magnitudes). */
export function shareOf(tx: Transaction, people: Person[]): Record<ID, number> {
  const weights = shareWeights(tx, people);
  const ordered = people.map((p) => weights[p.id] ?? 0);
  const parts = allocate(Math.abs(value(tx)), ordered);
  return Object.fromEntries(people.map((p, i) => [p.id, parts[i]]));
}

export interface FairnessRow {
  personId: ID;
  /** What they actually paid out of pocket this period. */
  paid: number;
  /** What they were responsible for under the split rules. */
  owed: number;
  /** paid - owed. Positive means the household owes them. */
  net: number;
  incomeShare: number;
  paidShare: number;
}

export interface Settlement {
  from: ID;
  to: ID;
  amount: number;
}

/**
 * Who has carried more than their share this period, and the smallest set of
 * transfers that squares everyone up.
 */
export function fairness(
  state: AppState,
  transactions: Transaction[],
): { rows: FairnessRow[]; settlements: Settlement[] } {
  const people = state.people;
  const paid: Record<ID, number> = Object.fromEntries(people.map((p) => [p.id, 0]));
  const owed: Record<ID, number> = Object.fromEntries(people.map((p) => [p.id, 0]));

  const spend = transactions.filter((t) => value(t) < 0);
  for (const tx of spend) {
    const shares = shareOf(tx, people);
    for (const p of people) owed[p.id] += shares[p.id] ?? 0;
    if (tx.paidBy === 'joint') {
      // A joint account is funded by both, pro rata to income.
      const contribution = allocate(
        Math.abs(value(tx)),
        people.map((p) => Math.max(1, p.annualIncome)),
      );
      people.forEach((p, i) => (paid[p.id] += contribution[i]));
    } else {
      paid[tx.paidBy] = (paid[tx.paidBy] ?? 0) + Math.abs(value(tx));
    }
  }

  const totalIncome = sum(people.map((p) => p.annualIncome)) || 1;
  const totalPaid = sum(people.map((p) => paid[p.id])) || 1;
  const rows: FairnessRow[] = people.map((p) => ({
    personId: p.id,
    paid: paid[p.id],
    owed: owed[p.id],
    net: paid[p.id] - owed[p.id],
    incomeShare: p.annualIncome / totalIncome,
    paidShare: paid[p.id] / totalPaid,
  }));

  return { rows, settlements: settle(rows) };
}

/** Greedy largest-creditor / largest-debtor matching: at most n-1 transfers. */
export function settle(rows: FairnessRow[]): Settlement[] {
  const creditors = rows.filter((r) => r.net > 0).map((r) => ({ id: r.personId, amt: r.net }));
  const debtors = rows.filter((r) => r.net < 0).map((r) => ({ id: r.personId, amt: -r.net }));
  creditors.sort((a, b) => b.amt - a.amt);
  debtors.sort((a, b) => b.amt - a.amt);

  const out: Settlement[] = [];
  let i = 0;
  let j = 0;
  while (i < debtors.length && j < creditors.length) {
    const amount = Math.min(debtors[i].amt, creditors[j].amt);
    if (amount > 0) out.push({ from: debtors[i].id, to: creditors[j].id, amount });
    debtors[i].amt -= amount;
    creditors[j].amt -= amount;
    if (debtors[i].amt <= 0) i += 1;
    if (creditors[j].amt <= 0) j += 1;
  }
  return out.filter((s) => s.amount > 50); // ignore sub-50c noise
}
