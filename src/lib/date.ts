/** Date helpers. Months are 'YYYY-MM'; days are 'YYYY-MM-DD'. All local time. */

export const todayISO = (): string => toISODate(new Date());

export function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export const monthOf = (isoDate: string): string => isoDate.slice(0, 7);

export const currentMonth = (): string => monthOf(todayISO());

export function addMonths(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function monthRange(endMonth: string, count: number): string[] {
  const out: string[] = [];
  for (let i = count - 1; i >= 0; i--) out.push(addMonths(endMonth, -i));
  return out;
}

export function monthLabel(month: string, style: 'short' | 'long' = 'short'): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 1, 1);
  return d.toLocaleDateString('en-US', {
    month: style,
    year: style === 'long' ? 'numeric' : '2-digit',
  });
}

export function dateLabel(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function daysInMonth(month: string): number {
  const [y, m] = month.split('-').map(Number);
  return new Date(y, m, 0).getDate();
}

/** Whole months from `from` to `to`, floored at 0. */
export function monthsBetween(from: string, to: string): number {
  const [fy, fm] = from.slice(0, 7).split('-').map(Number);
  const [ty, tm] = to.slice(0, 7).split('-').map(Number);
  return Math.max(0, (ty - fy) * 12 + (tm - fm));
}

export function monthsUntil(isoDate: string): number {
  return monthsBetween(todayISO(), isoDate);
}

export function addYears(iso: string, years: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  return toISODate(new Date(y + years, m - 1, d));
}
