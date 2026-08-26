/**
 * Multi-currency support.
 *
 * The household picks one base currency for reporting. Accounts each hold a
 * single currency, and every transaction stores three things: the native amount
 * in the account's currency, the amount converted to base, and the rate used at
 * the time. Storing the converted figure rather than converting on read means
 * last year's reports do not silently change when today's rate moves — which is
 * both what accounting requires and what makes month-to-month comparisons mean
 * anything.
 */

import type { AppState, CurrencyCode, ExchangeRates } from '../store/types';

export interface CurrencyMeta {
  code: CurrencyCode;
  name: string;
  symbol: string;
  /** Minor units. JPY has none; most have two. */
  digits: number;
}

export const CURRENCIES: CurrencyMeta[] = [
  { code: 'USD', name: 'US Dollar', symbol: '$', digits: 2 },
  { code: 'EUR', name: 'Euro', symbol: '€', digits: 2 },
  { code: 'GBP', name: 'Pound Sterling', symbol: '£', digits: 2 },
  { code: 'CHF', name: 'Swiss Franc', symbol: 'CHF', digits: 2 },
  { code: 'CAD', name: 'Canadian Dollar', symbol: 'CA$', digits: 2 },
  { code: 'AUD', name: 'Australian Dollar', symbol: 'A$', digits: 2 },
  { code: 'NZD', name: 'New Zealand Dollar', symbol: 'NZ$', digits: 2 },
  { code: 'JPY', name: 'Japanese Yen', symbol: '¥', digits: 0 },
  { code: 'SEK', name: 'Swedish Krona', symbol: 'kr', digits: 2 },
  { code: 'NOK', name: 'Norwegian Krone', symbol: 'kr', digits: 2 },
  { code: 'DKK', name: 'Danish Krone', symbol: 'kr', digits: 2 },
  { code: 'PLN', name: 'Polish Zloty', symbol: 'zł', digits: 2 },
  { code: 'CZK', name: 'Czech Koruna', symbol: 'Kč', digits: 2 },
  { code: 'MXN', name: 'Mexican Peso', symbol: 'MX$', digits: 2 },
  { code: 'BRL', name: 'Brazilian Real', symbol: 'R$', digits: 2 },
  { code: 'INR', name: 'Indian Rupee', symbol: '₹', digits: 2 },
  { code: 'SGD', name: 'Singapore Dollar', symbol: 'S$', digits: 2 },
  { code: 'HKD', name: 'Hong Kong Dollar', symbol: 'HK$', digits: 2 },
  { code: 'ZAR', name: 'South African Rand', symbol: 'R', digits: 2 },
  { code: 'AED', name: 'UAE Dirham', symbol: 'AED', digits: 2 },
];

export const currencyMeta = (code: CurrencyCode): CurrencyMeta =>
  CURRENCIES.find((c) => c.code === code) ?? { code, name: code, symbol: code, digits: 2 };

/**
 * Value of one unit of `code` expressed in the base currency. The base currency
 * is always exactly 1, never a stored number that could drift.
 */
export function rateFor(code: CurrencyCode, rates: ExchangeRates, base: CurrencyCode): number {
  if (code === base) return 1;
  const entry = rates[code];
  return entry && entry.rate > 0 ? entry.rate : 1;
}

/** Converts a minor-unit amount from one currency to another. */
export function convert(
  amount: number,
  from: CurrencyCode,
  to: CurrencyCode,
  rates: ExchangeRates,
  base: CurrencyCode,
): number {
  if (from === to) return amount;
  const inBase = amount * rateFor(from, rates, base);
  return Math.round(inBase / rateFor(to, rates, base));
}

export const toBase = (
  amount: number,
  from: CurrencyCode,
  rates: ExchangeRates,
  base: CurrencyCode,
): number => Math.round(amount * rateFor(from, rates, base));

/** Formats an amount in a specific currency, independent of the base currency. */
export function formatIn(
  cents: number,
  code: CurrencyCode,
  opts: { locale?: string; compact?: boolean; sign?: boolean } = {},
): string {
  const { locale = 'en-US', compact = false, sign = false } = opts;
  const meta = currencyMeta(code);
  const value = cents / Math.pow(10, meta.digits);
  const useCompact = compact && Math.abs(value) >= 10000;
  let out: string;
  try {
    out = new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: code,
      notation: useCompact ? 'compact' : 'standard',
      maximumFractionDigits: useCompact ? 1 : meta.digits,
      minimumFractionDigits: useCompact ? 0 : meta.digits,
    }).format(Math.abs(value));
  } catch {
    // An unknown ISO code must not take the page down.
    out = `${meta.symbol}${Math.abs(value).toFixed(meta.digits)}`;
  }
  if (cents < 0) return `-${out}`;
  return sign && cents > 0 ? `+${out}` : out;
}

/** Every currency actually in use, so pickers and rate tables stay relevant. */
export function currenciesInUse(state: AppState): CurrencyCode[] {
  const codes = new Set<CurrencyCode>([state.settings.baseCurrency]);
  for (const a of state.accounts) codes.add(a.currency);
  for (const t of state.transactions) codes.add(t.currency);
  return [...codes];
}

/** Currencies used by something, other than the base — the ones needing a rate. */
export const foreignCurrencies = (state: AppState): CurrencyCode[] =>
  currenciesInUse(state).filter((c) => c !== state.settings.baseCurrency);

/** True when the household actually deals in more than one currency. */
export const isMultiCurrency = (state: AppState): boolean => foreignCurrencies(state).length > 0;

export interface RateHealth {
  code: CurrencyCode;
  rate: number;
  updated: string;
  ageDays: number;
  stale: boolean;
}

/**
 * Rates are entered by hand, so the honest thing is to show how old they are.
 * A month-old rate is usually fine for budgeting and badly wrong for a transfer.
 */
export function rateHealth(state: AppState, today: string): RateHealth[] {
  return foreignCurrencies(state).map((code) => {
    const entry = state.rates[code];
    const updated = entry?.updated ?? '';
    const ageDays = updated
      ? Math.max(0, Math.round((Date.parse(today) - Date.parse(updated)) / 86_400_000))
      : Infinity;
    return {
      code,
      rate: entry?.rate ?? 1,
      updated,
      ageDays: isFinite(ageDays) ? ageDays : -1,
      stale: !entry || ageDays > 30,
    };
  });
}
