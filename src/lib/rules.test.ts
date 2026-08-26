import { describe, expect, it } from 'vitest';
import { testTransaction } from '../test-utils';
import type { Rule, Transaction } from '../store/types';
import { matches, runRules } from './rules';

const people = [{ id: 'a' }, { id: 'b' }];

// These exercise rule matching, so the subject is a transaction nobody has
// filed by hand yet. Protection of manual choices is covered in labels.test.ts.
const tx = (over: Partial<Transaction> = {}): Transaction =>
  testTransaction({
    amount: -4500,
    accountId: 'acc1',
    categoryId: 'unsorted',
    payee: 'SAFEWAY #1123',
    paidBy: 'a',
    categorySource: 'default',
    ...over,
  });

const rule = (over: Partial<Rule> = {}): Rule => ({
  id: 'r1',
  name: 'Groceries',
  enabled: true,
  order: 1,
  match: { payeeContains: 'safeway' },
  set: { categoryId: 'groceries' },
  ...over,
});

describe('matches', () => {
  it('matches payee text case-insensitively', () => {
    expect(matches(rule(), tx())).toBe(true);
    expect(matches(rule(), tx({ payee: 'Trader Joes' }))).toBe(false);
  });

  it('matches on a regex', () => {
    expect(matches(rule({ match: { payeeRegex: '^SAFE\\w+' } }), tx())).toBe(true);
  });

  it('treats an invalid regex as matching nothing', () => {
    expect(matches(rule({ match: { payeeRegex: '([unclosed' } }), tx())).toBe(false);
  });

  it('never matches when no condition is set', () => {
    expect(matches(rule({ match: {} }), tx())).toBe(false);
    expect(matches(rule({ match: { payeeContains: '' } }), tx())).toBe(false);
  });

  it('matches amount ranges on the absolute value', () => {
    expect(matches(rule({ match: { minAmount: 4000, maxAmount: 5000 } }), tx())).toBe(true);
    expect(matches(rule({ match: { minAmount: 5000 } }), tx())).toBe(false);
  });

  it('matches direction', () => {
    expect(matches(rule({ match: { direction: 'out' } }), tx())).toBe(true);
    expect(matches(rule({ match: { direction: 'in' } }), tx())).toBe(false);
  });

  it('matches account', () => {
    expect(matches(rule({ match: { accountId: 'acc1' } }), tx())).toBe(true);
    expect(matches(rule({ match: { accountId: 'other' } }), tx())).toBe(false);
  });

  it('requires every condition to hold', () => {
    const r = rule({ match: { payeeContains: 'safeway', minAmount: 100000 } });
    expect(matches(r, tx())).toBe(false);
  });
});

describe('runRules', () => {
  it('applies actions and reports only what changed', () => {
    const { changed, hits } = runRules([rule()], [tx(), tx({ payee: 'Elsewhere' })], people);
    expect(changed).toHaveLength(1);
    expect(changed[0].categoryId).toBe('groceries');
    expect(hits.r1).toBe(1);
  });

  it('lets a later rule override an earlier one', () => {
    const broad = rule({ id: 'broad', order: 1, set: { categoryId: 'groceries' } });
    const narrow = rule({
      id: 'narrow',
      order: 2,
      match: { payeeContains: 'safeway', minAmount: 4000 },
      set: { categoryId: 'bulk-shop' },
    });
    const { changed } = runRules([narrow, broad], [tx()], people);
    expect(changed[0].categoryId).toBe('bulk-shop');
  });

  it('skips disabled rules', () => {
    const { changed } = runRules([rule({ enabled: false })], [tx()], people);
    expect(changed).toHaveLength(0);
  });

  it('adds tags without dropping existing ones, and does not duplicate', () => {
    const r = rule({ set: { addTags: ['weekly', 'food'] } });
    const { changed } = runRules([r], [tx({ tags: ['weekly'] })], people);
    expect(changed[0].tags.sort()).toEqual(['food', 'weekly']);
  });

  it('assigns a personal split entirely to the payer', () => {
    const r = rule({ set: { splitRule: 'personal' } });
    const { changed } = runRules([r], [tx({ paidBy: 'b' })], people);
    expect(changed[0].splitShares).toEqual({ a: 0, b: 1 });
  });

  it('renames messy bank descriptions', () => {
    const { changed } = runRules([rule({ set: { renamePayee: 'Safeway' } })], [tx()], people);
    expect(changed[0].payee).toBe('Safeway');
  });

  it('is idempotent — a second run changes nothing', () => {
    const rules = [rule()];
    const first = runRules(rules, [tx()], people).changed;
    expect(runRules(rules, first, people).changed).toHaveLength(0);
  });
});
