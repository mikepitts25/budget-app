import type { AppState, ID, Rule, Transaction } from '../store/types';
import { uid } from './id';

/** Does this rule's matcher select the transaction? */
export function matches(rule: Rule, tx: Transaction): boolean {
  const m = rule.match;
  const payee = tx.payee.toLowerCase();
  const magnitude = Math.abs(tx.amount);

  if (m.payeeContains && !payee.includes(m.payeeContains.toLowerCase())) return false;
  if (m.payeeRegex) {
    try {
      if (!new RegExp(m.payeeRegex, 'i').test(tx.payee)) return false;
    } catch {
      return false; // A malformed pattern matches nothing rather than everything.
    }
  }
  if (m.noteContains && !tx.note.toLowerCase().includes(m.noteContains.toLowerCase())) return false;
  if (m.accountId && tx.accountId !== m.accountId) return false;
  if (m.minAmount !== undefined && magnitude < m.minAmount) return false;
  if (m.maxAmount !== undefined && magnitude > m.maxAmount) return false;
  if (m.direction === 'in' && tx.amount <= 0) return false;
  if (m.direction === 'out' && tx.amount >= 0) return false;

  // A matcher with no conditions would rewrite the whole ledger.
  return Object.keys(m).some((k) => m[k as keyof typeof m] !== undefined && m[k as keyof typeof m] !== '');
}

/** Applies one rule's actions, returning a new transaction. */
export function applyRule(rule: Rule, tx: Transaction, people: { id: ID }[]): Transaction {
  const next: Transaction = { ...tx };
  const s = rule.set;
  if (s.categoryId) next.categoryId = s.categoryId;
  if (s.paidBy) next.paidBy = s.paidBy;
  if (s.renamePayee) next.payee = s.renamePayee;
  if (s.private !== undefined) next.private = s.private;
  if (s.addTags?.length) next.tags = [...new Set([...next.tags, ...s.addTags])];
  if (s.splitRule) {
    next.splitRule = s.splitRule;
    if (s.splitRule === 'personal') {
      next.splitShares = Object.fromEntries(
        people.map((p) => [p.id, p.id === next.paidBy ? 1 : 0]),
      );
    } else if (s.splitRule === 'custom' && !Object.keys(next.splitShares).length) {
      next.splitShares = Object.fromEntries(people.map((p) => [p.id, 1 / people.length]));
    }
  }
  return next;
}

export interface RuleRun {
  /** Only the transactions a rule actually changed. */
  changed: Transaction[];
  /** Rule id -> how many transactions it touched. */
  hits: Record<ID, number>;
}

/**
 * Runs every enabled rule over the given transactions, in order. Later rules can
 * override earlier ones, which is what makes a general rule plus a specific
 * exception work.
 */
export function runRules(
  rules: Rule[],
  txs: Transaction[],
  people: { id: ID }[],
): RuleRun {
  const ordered = rules.filter((r) => r.enabled).sort((a, b) => a.order - b.order);
  const hits: Record<ID, number> = Object.fromEntries(ordered.map((r) => [r.id, 0]));
  const changed: Transaction[] = [];

  for (const tx of txs) {
    let next = tx;
    let touched = false;
    for (const rule of ordered) {
      if (!matches(rule, next)) continue;
      const applied = applyRule(rule, next, people);
      if (JSON.stringify(applied) !== JSON.stringify(next)) {
        next = applied;
        touched = true;
        hits[rule.id] += 1;
      }
    }
    if (touched) changed.push(next);
  }
  return { changed, hits };
}

/** Applies rules to transactions on their way in, before they hit the store. */
export const categorizeIncoming = (state: AppState, txs: Transaction[]): Transaction[] => {
  const ordered = state.rules.filter((r) => r.enabled).sort((a, b) => a.order - b.order);
  return txs.map((tx) => {
    let next = tx;
    for (const rule of ordered) if (matches(rule, next)) next = applyRule(rule, next, state.people);
    return next;
  });
};

/** How many existing transactions a rule would affect — shown before saving it. */
export const previewRule = (rule: Rule, state: AppState): Transaction[] =>
  state.transactions.filter((t) => matches(rule, t));

export function blankRule(order: number): Rule {
  return {
    id: uid('rule'),
    name: 'New rule',
    enabled: true,
    order,
    match: { payeeContains: '' },
    set: {},
  };
}

/**
 * Turns a transaction into a starting rule — "always file things from this payee
 * like this" is the way people actually think about rules.
 */
export function ruleFromTransaction(tx: Transaction, order: number): Rule {
  return {
    id: uid('rule'),
    name: `${tx.payee} → this category`,
    enabled: true,
    order,
    match: { payeeContains: tx.payee.slice(0, 24) },
    set: { categoryId: tx.categoryId, splitRule: tx.splitRule },
  };
}
