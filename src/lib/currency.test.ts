import { describe, expect, it } from 'vitest';
import { convert, currencyMeta, foreignCurrencies, formatIn, rateFor, rateHealth } from './currency';
import { buildTransfer, migrate, reducer } from '../store/store';
import { emptyState } from '../store/seed';
import { accountBalance, accountBalancesBase, expense, income, netWorth, txInMonth } from '../store/selectors';
import { makeTransaction } from '../store/factory';
import { testAccount, testTransaction } from '../test-utils';
import type { AppState } from '../store/types';

const RATES = { EUR: { rate: 1.1, updated: '2026-06-01' } };

const dual = (): AppState => ({
  ...emptyState(),
  settings: { ...emptyState().settings, baseCurrency: 'USD' },
  rates: RATES,
  accounts: [
    testAccount({ id: 'usd', currency: 'USD', openingBalance: 500000 }),
    testAccount({ id: 'eur', name: 'Euro Account', currency: 'EUR', openingBalance: 200000 }),
  ],
});

describe('rateFor', () => {
  it('is exactly 1 for the base currency, never a stored number', () => {
    expect(rateFor('USD', RATES, 'USD')).toBe(1);
    expect(rateFor('USD', { USD: { rate: 42, updated: '' } }, 'USD')).toBe(1);
  });

  it('falls back to 1 for a currency with no rate rather than zeroing amounts', () => {
    expect(rateFor('JPY', RATES, 'USD')).toBe(1);
  });
});

describe('convert', () => {
  it('round-trips through the base currency', () => {
    expect(convert(11000, 'EUR', 'USD', RATES, 'USD')).toBe(12100);
    expect(convert(12100, 'USD', 'EUR', RATES, 'USD')).toBe(11000);
  });

  it('is identity within one currency', () => {
    expect(convert(9999, 'EUR', 'EUR', RATES, 'USD')).toBe(9999);
  });
});

describe('formatIn', () => {
  it('formats each currency in its own symbol', () => {
    expect(formatIn(123456, 'USD')).toBe('$1,234.56');
    expect(formatIn(123456, 'EUR')).toBe('€1,234.56');
    expect(formatIn(-5000, 'GBP')).toBe('-£50.00');
  });

  it('respects currencies with no minor unit', () => {
    expect(currencyMeta('JPY').digits).toBe(0);
    expect(formatIn(1234, 'JPY')).toBe('¥1,234');
  });

  it('does not throw on an unknown code', () => {
    expect(() => formatIn(1000, 'XYZ')).not.toThrow();
  });
});

describe('balances', () => {
  it('keeps native balances in their own currency', () => {
    const state = dual();
    expect(accountBalance(state, 'eur')).toBe(200000);
  });

  it('converts to base only when summing across currencies', () => {
    const state = dual();
    expect(accountBalancesBase(state).eur).toBe(220000);
    expect(netWorth(state).assets).toBe(500000 + 220000);
  });

  it('revalues held balances when the rate moves, since that is what they are worth now', () => {
    const state = dual();
    const stronger = reducer(state, { type: 'rate/set', code: 'EUR', rate: 1.2, updated: '2026-07-01' });
    expect(accountBalance(stronger, 'eur')).toBe(200000);
    expect(accountBalancesBase(stronger).eur).toBe(240000);
  });
});

describe('transactions', () => {
  it('records the native amount, the base amount and the rate', () => {
    const state = dual();
    const tx = makeTransaction(state, {
      date: '2026-06-03',
      amount: -245000,
      accountId: 'eur',
      categoryId: 'rent',
      payee: 'Landlord',
    });
    expect(tx.currency).toBe('EUR');
    expect(tx.amount).toBe(-245000);
    expect(tx.rate).toBe(1.1);
    expect(tx.baseAmount).toBe(-269500);
  });

  it('does not restate history when the rate later moves', () => {
    let state = dual();
    const tx = makeTransaction(state, {
      date: '2026-06-03',
      amount: -100000,
      accountId: 'eur',
      categoryId: 'rent',
      payee: 'Landlord',
    });
    state = reducer(state, { type: 'tx/add', tx });
    const before = expense(state, txInMonth(state, '2026-06'));
    state = reducer(state, { type: 'rate/set', code: 'EUR', rate: 2, updated: '2026-07-01' });
    expect(expense(state, txInMonth(state, '2026-06'))).toBe(before);
  });

  it('totals income and spending in base currency', () => {
    let state = dual();
    state = reducer(state, {
      type: 'tx/add',
      tx: makeTransaction(state, {
        date: '2026-06-01', amount: 300000, accountId: 'usd', categoryId: 'pay', payee: 'Payroll',
      }),
    });
    state = reducer(state, {
      type: 'tx/add',
      tx: makeTransaction(state, {
        date: '2026-06-03', amount: -100000, accountId: 'eur', categoryId: 'rent', payee: 'Landlord',
      }),
    });
    const month = txInMonth(state, '2026-06');
    expect(income(month, state)).toBe(300000);
    expect(expense(state, month)).toBe(110000);
  });
});

describe('cross-currency transfers', () => {
  const input = {
    date: '2026-06-01',
    amount: 110000,
    fromAccountId: 'usd',
    toAccountId: 'eur',
    categoryId: 'c',
    payee: 'Wise',
  };

  it('moves different native amounts but the same value', () => {
    const [out, into] = buildTransfer(dual(), input);
    expect(out.amount).toBe(-110000);
    expect(out.currency).toBe('USD');
    expect(into.amount).toBe(100000);
    expect(into.currency).toBe('EUR');
    expect(out.baseAmount + into.baseAmount).toBe(0);
  });

  it('honours the amount actually received, fees and spread included', () => {
    const [out, into] = buildTransfer(dual(), { ...input, receivedAmount: 98000 });
    expect(into.amount).toBe(98000);
    // Still the same value: a fee is a worse rate, not money vanishing.
    expect(out.baseAmount + into.baseAmount).toBe(0);
    expect(into.rate).toBeCloseTo(110000 / 98000, 6);
  });

  it('creates no income and no spending', () => {
    let state = dual();
    state = reducer(state, { type: 'tx/transfer', transfer: input });
    const month = txInMonth(state, '2026-06');
    expect(income(month, state)).toBe(0);
    expect(expense(state, month)).toBe(0);
    expect(netWorth(state).assets).toBe(netWorth(dual()).assets);
  });

  it('moves both balances in their own currencies', () => {
    const state = reducer(dual(), { type: 'tx/transfer', transfer: input });
    expect(accountBalance(state, 'usd')).toBe(390000);
    expect(accountBalance(state, 'eur')).toBe(300000);
  });
});

describe('changing the base currency', () => {
  it('re-expresses history so past months keep their meaning', () => {
    let state = dual();
    state = reducer(state, {
      type: 'tx/add',
      tx: makeTransaction(state, {
        date: '2026-06-03', amount: -110000, accountId: 'eur', categoryId: 'rent', payee: 'Landlord',
      }),
    });
    // 1100.00 EUR was 1210.00 USD.
    expect(expense(state, txInMonth(state, '2026-06'))).toBe(121000);

    const swapped = reducer(state, { type: 'currency/setBase', code: 'EUR' });
    expect(swapped.settings.baseCurrency).toBe('EUR');
    // The same rent, now reported in euros, is the euro amount again.
    expect(expense(swapped, txInMonth(swapped, '2026-06'))).toBe(110000);
    // The old base becomes a foreign currency with the reciprocal rate.
    expect(swapped.rates.USD.rate).toBeCloseTo(1 / 1.1, 6);
    expect(swapped.rates.EUR).toBeUndefined();
  });

  it('rescales budgets, goals and debts too', () => {
    const state: AppState = {
      ...dual(),
      budget: [{ month: '2026-06', categoryId: 'c', planned: 110000, rollover: false }],
      debts: [{ id: 'd', name: 'Card', balance: 220000, apr: 0.2, minPayment: 11000, kind: 'credit' }],
    };
    const swapped = reducer(state, { type: 'currency/setBase', code: 'EUR' });
    expect(swapped.budget[0].planned).toBe(100000);
    expect(swapped.debts[0].balance).toBe(200000);
    expect(swapped.debts[0].minPayment).toBe(10000);
  });

  it('is a no-op when the base is unchanged', () => {
    const state = dual();
    expect(reducer(state, { type: 'currency/setBase', code: 'USD' })).toBe(state);
  });
});

describe('rate health', () => {
  it('flags rates older than a month', () => {
    const state = { ...dual(), rates: { EUR: { rate: 1.1, updated: '2026-01-01' } } };
    const [eur] = rateHealth(state, '2026-06-01');
    expect(eur.stale).toBe(true);
    expect(eur.ageDays).toBeGreaterThan(30);
  });

  it('does not flag a fresh rate', () => {
    const [eur] = rateHealth(dual(), '2026-06-05');
    expect(eur.stale).toBe(false);
  });

  it('lists only currencies that need a rate', () => {
    expect(foreignCurrencies(dual())).toEqual(['EUR']);
  });
});

describe('migration to v3', () => {
  it('treats a single-currency file as base currency throughout, changing no number', () => {
    // A real v2 file has `currency` and no `baseCurrency` at all.
    const { baseCurrency: _dropped, ...v2Settings } = emptyState().settings;
    const v2 = {
      version: 2,
      settings: { ...v2Settings, currency: 'GBP' },
      people: emptyState().people,
      categories: emptyState().categories,
      accounts: [{ ...testAccount({ id: 'a', openingBalance: 100000 }), currency: undefined }],
      transactions: [
        { ...testTransaction({ id: 't', amount: -2500, accountId: 'a' }), currency: undefined, baseAmount: undefined, rate: undefined },
      ],
    };
    const migrated = migrate(v2);
    expect(migrated.settings.baseCurrency).toBe('GBP');
    expect(migrated.accounts[0].currency).toBe('GBP');
    expect(migrated.transactions[0].currency).toBe('GBP');
    expect(migrated.transactions[0].rate).toBe(1);
    expect(migrated.transactions[0].baseAmount).toBe(-2500);
    expect(accountBalance(migrated, 'a')).toBe(97500);
  });

  it('marks pre-v3 transactions manual so rules cannot silently reclassify history', () => {
    const migrated = migrate({
      ...emptyState(),
      version: 2,
      transactions: [{ ...testTransaction({ id: 't' }), categorySource: undefined }],
    });
    expect(migrated.transactions[0].categorySource).toBe('manual');
  });
});
