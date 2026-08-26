import { describe, expect, it } from 'vitest';
import type { AppState, Rule } from '../store/types';
import { emptyState } from '../store/seed';
import { testAccount, testTransaction } from '../test-utils';
import {
  acceptLabel,
  correctLabel,
  explainLabel,
  isAutomatic,
  reviewQueue,
  similarTransactions,
} from './labels';
import { categorizeIncoming, runRules } from './rules';

const state = (over: Partial<AppState> = {}): AppState => ({
  ...emptyState(),
  accounts: [testAccount({ id: 'chk' })],
  ...over,
});

const rule = (over: Partial<Rule> = {}): Rule => ({
  id: 'r1',
  name: 'Coffee is dining',
  enabled: true,
  order: 1,
  match: { payeeContains: 'grind' },
  set: { categoryId: 'restaurants' },
  ...over,
});

describe('isAutomatic', () => {
  it('counts every non-manual source', () => {
    for (const source of ['rule', 'learned', 'imported', 'default'] as const) {
      expect(isAutomatic(testTransaction({ categorySource: source }))).toBe(true);
    }
    expect(isAutomatic(testTransaction({ categorySource: 'manual' }))).toBe(false);
  });
});

describe('explainLabel', () => {
  it('names the rule that filed it', () => {
    const s = state({ rules: [rule()] });
    const why = explainLabel(s, testTransaction({ categorySource: 'rule', categoryRuleId: 'r1' }));
    expect(why.label).toContain('Coffee is dining');
  });

  it('copes with a rule that has since been deleted', () => {
    const why = explainLabel(state(), testTransaction({ categorySource: 'rule', categoryRuleId: 'gone' }));
    expect(why.detail).toContain('deleted');
  });

  it('reports the confidence of a learned match', () => {
    const why = explainLabel(
      state(),
      testTransaction({ categorySource: 'learned', categoryConfidence: 0.6 }),
    );
    expect(why.detail).toContain('60%');
    expect(why.confidence).toBe(0.6);
  });

  it('ranks an unmatched transaction lowest', () => {
    expect(explainLabel(state(), testTransaction({ categorySource: 'default' })).confidence).toBe(0);
    expect(explainLabel(state(), testTransaction({ categorySource: 'manual' })).confidence).toBe(1);
  });
});

describe('reviewQueue', () => {
  const month = '2026-06';
  const build = () =>
    state({
      transactions: [
        testTransaction({ id: 'a', date: `${month}-01`, categorySource: 'manual' }),
        testTransaction({ id: 'b', date: `${month}-02`, categorySource: 'default' }),
        testTransaction({ id: 'c', date: `${month}-03`, categorySource: 'learned', categoryConfidence: 0.95 }),
        testTransaction({ id: 'd', date: `${month}-04`, categorySource: 'learned', categoryConfidence: 0.5 }),
      ],
    });

  it('queues only the uncertain ones', () => {
    const q = reviewQueue(build(), month);
    expect(q.items.map((t) => t.id)).toEqual(['b', 'd']);
  });

  it('counts everything automatic, queued or not', () => {
    const q = reviewQueue(build(), month);
    expect(q.automatic).toBe(3);
    expect(q.byCertainty.high).toBe(1);
  });

  it('puts the least certain first', () => {
    expect(reviewQueue(build(), month).items[0].id).toBe('b');
  });

  it('never queues something a person chose', () => {
    const q = reviewQueue(build(), month);
    expect(q.items.some((t) => t.categorySource === 'manual')).toBe(false);
  });
});

describe('accepting and correcting', () => {
  it('accepting freezes the guess as a decision', () => {
    const accepted = acceptLabel(testTransaction({ categorySource: 'learned', categoryConfidence: 0.5 }));
    expect(accepted.categorySource).toBe('manual');
    expect(accepted.categoryConfidence).toBeUndefined();
  });

  it('correcting sets the category and clears the rule that got it wrong', () => {
    const corrected = correctLabel(
      testTransaction({ categorySource: 'rule', categoryRuleId: 'r1' }),
      'groceries',
    );
    expect(corrected.categoryId).toBe('groceries');
    expect(corrected.categorySource).toBe('manual');
    expect(corrected.categoryRuleId).toBeUndefined();
  });
});

describe('similarTransactions', () => {
  it('finds other automatic transactions from the same payee', () => {
    const s = state({
      transactions: [
        testTransaction({ id: 'a', payee: 'Daily Grind', categorySource: 'learned' }),
        testTransaction({ id: 'b', payee: 'daily grind', categorySource: 'default' }),
        testTransaction({ id: 'c', payee: 'Daily Grind', categorySource: 'manual' }),
        testTransaction({ id: 'd', payee: 'Somewhere Else', categorySource: 'default' }),
      ],
    });
    const others = similarTransactions(s, s.transactions[0], 'restaurants');
    expect(others.map((t) => t.id)).toEqual(['b']);
  });

  it('leaves already-correct transactions alone', () => {
    const s = state({
      transactions: [
        testTransaction({ id: 'a', payee: 'Shop', categoryId: 'x', categorySource: 'learned' }),
        testTransaction({ id: 'b', payee: 'Shop', categoryId: 'target', categorySource: 'learned' }),
      ],
    });
    expect(similarTransactions(s, s.transactions[0], 'target')).toHaveLength(0);
  });
});

describe('rules respect corrections', () => {
  const txs = [
    testTransaction({ id: 'auto', payee: 'Daily Grind', categoryId: 'coffee', categorySource: 'learned' }),
    testTransaction({ id: 'fixed', payee: 'Daily Grind', categoryId: 'groceries', categorySource: 'manual' }),
  ];

  it('does not overwrite a category a person chose', () => {
    const { changed } = runRules([rule()], txs, [{ id: 'p' }]);
    expect(changed.map((t) => t.id)).toEqual(['auto']);
    expect(changed[0].categoryId).toBe('restaurants');
    expect(changed[0].categorySource).toBe('rule');
  });

  it('overwrites corrections only when explicitly asked', () => {
    const { changed } = runRules([rule()], txs, [{ id: 'p' }], { respectManual: false });
    expect(changed.map((t) => t.id).sort()).toEqual(['auto', 'fixed']);
  });

  it('files brand-new transactions on the way in', () => {
    const s = state({ rules: [rule()] });
    const [filed] = categorizeIncoming(s, [
      testTransaction({ payee: 'Daily Grind', categoryId: 'misc' }),
    ]);
    expect(filed.categoryId).toBe('restaurants');
    expect(filed.categorySource).toBe('rule');
    expect(filed.categoryRuleId).toBe('r1');
  });
});
