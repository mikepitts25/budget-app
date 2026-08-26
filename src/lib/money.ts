/** Money helpers. Everything internal is whole cents to avoid float drift. */

export const toCents = (value: number | string): number => {
  const n = typeof value === 'string' ? parseFloat(value.replace(/[^0-9.-]/g, '')) : value;
  if (!isFinite(n)) return 0;
  return Math.round(n * 100);
};

export const toUnits = (cents: number): number => cents / 100;

export function formatMoney(
  cents: number,
  opts: { currency?: string; locale?: string; compact?: boolean; sign?: boolean } = {},
): string {
  const { currency = 'USD', locale = 'en-US', compact = false, sign = false } = opts;
  const value = cents / 100;
  const fmt = new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    notation: compact && Math.abs(value) >= 10000 ? 'compact' : 'standard',
    maximumFractionDigits: compact && Math.abs(value) >= 10000 ? 1 : 2,
    minimumFractionDigits: compact && Math.abs(value) >= 10000 ? 0 : 2,
  });
  const out = fmt.format(Math.abs(value));
  if (cents < 0) return `-${out}`;
  return sign && cents > 0 ? `+${out}` : out;
}

export const formatPercent = (decimal: number, digits = 1): string =>
  `${(decimal * 100).toFixed(digits)}%`;

export const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0);

export const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

/** Split `cents` into `weights` without losing or inventing a cent. */
export function allocate(cents: number, weights: number[]): number[] {
  const total = sum(weights);
  if (total <= 0) return weights.map(() => 0);
  const raw = weights.map((w) => (cents * w) / total);
  const floored = raw.map(Math.floor);
  let remainder = cents - sum(floored);
  // Hand out the leftover cents to the largest fractional parts first.
  const order = raw
    .map((r, i) => ({ i, frac: r - Math.floor(r) }))
    .sort((a, b) => b.frac - a.frac);
  for (const { i } of order) {
    if (remainder <= 0) break;
    floored[i] += 1;
    remainder -= 1;
  }
  return floored;
}
