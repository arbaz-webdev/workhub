// Calendar arithmetic on YYYY-MM-DD strings, done in UTC so no time zone can shift a day.

const toDate = (d: string) => new Date(`${d}T00:00:00Z`);
const toStr = (d: Date) => d.toISOString().slice(0, 10);

export function addDays(date: string, days: number): string {
  const d = toDate(date);
  d.setUTCDate(d.getUTCDate() + days);
  return toStr(d);
}

/** Whole days from `a` to `b` (negative when b is earlier). */
export function daysBetween(a: string, b: string): number {
  return Math.round((toDate(b).getTime() - toDate(a).getTime()) / 86_400_000);
}

/** The Monday on or before `date`. */
export function mondayOf(date: string): string {
  const day = toDate(date).getUTCDay(); // 0 = Sunday
  return addDays(date, day === 0 ? -6 : 1 - day);
}

export function addMonths(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return toStr(new Date(Date.UTC(y, m - 1 + n, 1))).slice(0, 7);
}

/** The six Monday-first weeks that show a month (YYYY-MM), as date strings. */
export function monthGrid(month: string): string[][] {
  const start = mondayOf(`${month}-01`);
  return Array.from({ length: 6 }, (_, w) => Array.from({ length: 7 }, (_, d) => addDays(start, w * 7 + d)));
}

export const monthTitle = (month: string) => toDate(`${month}-01`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
export const dayMonth = (date: string) => toDate(date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
export const weekdayShort = (date: string) => toDate(date).toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' });

/** A task's span on a timeline: start to due, or one day when only one is set. */
export function span(t: { startDate: string | null; dueDate: string | null }): { from: string; to: string } | null {
  const from = t.startDate ?? t.dueDate;
  const to = t.dueDate ?? t.startDate;
  return from && to ? { from, to } : null;
}
