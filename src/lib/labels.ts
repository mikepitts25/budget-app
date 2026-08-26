/**
 * Reviewing what the app decided for you.
 *
 * Automatic categorization is useful precisely because it is not asked for, so
 * the price of it is that people must be able to see what was guessed and
 * disagree cheaply. Every transaction records how it got its category; this
 * module turns that into a queue worth working through and nothing more.
 */

import type { AppState, CategorySource, ID, Transaction } from '../store/types';
import { txInMonth } from '../store/selectors';

export const AUTOMATIC_SOURCES: CategorySource[] = ['rule', 'learned', 'imported', 'default'];

export const isAutomatic = (tx: Transaction): boolean =>
  AUTOMATIC_SOURCES.includes(tx.categorySource);

export interface LabelExplanation {
  label: string;
  detail: string;
  /** Lower means more likely to be wrong, so it sorts to the top of the queue. */
  confidence: number;
}

/** Plain-language account of why a transaction has the category it has. */
export function explainLabel(state: AppState, tx: Transaction): LabelExplanation {
  switch (tx.categorySource) {
    case 'manual':
      return { label: 'You chose this', detail: 'Set by hand, and rules will not overwrite it.', confidence: 1 };
    case 'rule': {
      const rule = state.rules.find((r) => r.id === tx.categoryRuleId);
      return {
        label: rule ? `Rule: ${rule.name}` : 'Filed by a rule',
        detail: rule
          ? `Matched "${rule.match.payeeContains ?? rule.match.payeeRegex ?? 'your conditions'}".`
          : 'The rule that filed this has since been deleted.',
        confidence: 0.9,
      };
    }
    case 'learned':
      return {
        label: 'Matched a payee you have filed before',
        detail: `About ${Math.round((tx.categoryConfidence ?? 0) * 100)}% of past transactions from this payee used this category.`,
        confidence: tx.categoryConfidence ?? 0.5,
      };
    case 'imported':
      return {
        label: 'Category came from the file',
        detail: 'Your bank or the export named this category. Banks are frequently wrong about this.',
        confidence: 0.6,
      };
    case 'default':
      return {
        label: 'Nothing matched',
        detail: 'No rule and no past payee matched, so it landed in the fallback category.',
        confidence: 0,
      };
  }
}

export interface ReviewQueue {
  items: Transaction[];
  /** Everything automatic in the month, including the confident ones. */
  automatic: number;
  byCertainty: { low: number; medium: number; high: number };
}

/**
 * What is worth a person's attention, worst first. Confident matches are
 * counted but not queued: a review list that includes everything gets abandoned,
 * which is worse than not offering one.
 */
export function reviewQueue(state: AppState, month: string, threshold = 0.8): ReviewQueue {
  const automatic = txInMonth(state, month).filter(isAutomatic);
  const scored = automatic
    .map((tx) => ({ tx, confidence: explainLabel(state, tx).confidence }))
    .sort((a, b) => a.confidence - b.confidence || Math.abs(b.tx.baseAmount) - Math.abs(a.tx.baseAmount));

  return {
    items: scored.filter((s) => s.confidence < threshold).map((s) => s.tx),
    automatic: automatic.length,
    byCertainty: {
      low: scored.filter((s) => s.confidence < 0.4).length,
      medium: scored.filter((s) => s.confidence >= 0.4 && s.confidence < threshold).length,
      high: scored.filter((s) => s.confidence >= threshold).length,
    },
  };
}

/** Accepting a guess makes it a decision, so nothing re-files it later. */
export const acceptLabel = (tx: Transaction): Transaction => ({
  ...tx,
  categorySource: 'manual',
  categoryConfidence: undefined,
});

/** Correcting a guess both fixes this transaction and teaches future matching. */
export const correctLabel = (tx: Transaction, categoryId: ID): Transaction => ({
  ...tx,
  categoryId,
  categorySource: 'manual',
  categoryRuleId: undefined,
  categoryConfidence: undefined,
});

/**
 * Other transactions from the same payee that the correction should probably
 * apply to as well — the "and the other eleven" case.
 */
export function similarTransactions(
  state: AppState,
  tx: Transaction,
  categoryId: ID,
): Transaction[] {
  const payee = tx.payee.toLowerCase().trim();
  if (payee.length < 3) return [];
  return state.transactions.filter(
    (t) =>
      t.id !== tx.id &&
      t.payee.toLowerCase().trim() === payee &&
      t.categoryId !== categoryId &&
      t.categorySource !== 'manual',
  );
}
