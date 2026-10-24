// Leave arithmetic as pure functions: which dates a request covers, how many days that
// is, and how much a person has earned. Unit-tested without a database.
import type { HalfDay } from '@workhub/shared';
import { addDays, isoWeekday } from '../attendance/zoned';

/** Dates from `start` to `end` inclusive. */
export function datesBetween(start: string, end: string): string[] {
  const out: string[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) out.push(d);
  return out;
}

/**
 * The dates a leave request actually takes: working days only (holidays and days off
 * don't use leave), each with the share of the day taken.
 */
export function leaveDates(
  start: string,
  end: string,
  halfDay: HalfDay,
  workingDays: number[],
  holidays: Set<string>,
): { date: string; fraction: number }[] {
  return datesBetween(start, end)
    .filter((d) => workingDays.includes(isoWeekday(d)) && !holidays.has(d))
    .map((date) => ({ date, fraction: halfDay === 'none' ? 1 : 0.5 }));
}

export const sumDays = (dates: { fraction: number }[]) => dates.reduce((s, d) => s + d.fraction, 0);

const floorHalf = (n: number) => Math.floor(n * 2) / 2;

/**
 * Days earned in `year` up to `today`. Yearly types give the whole year's days at once;
 * monthly ones give a twelfth at the start of each month. Someone joining mid-year gets
 * the share for the months they're here (the joining month counts).
 */
export function entitlement(
  type: { daysPerYear: number | null; accrual: 'yearly' | 'monthly' },
  year: number,
  joined: string,
  today: string,
): number | null {
  if (type.daysPerYear === null) return null;
  const joinYear = Number(joined.slice(0, 4));
  if (joinYear > year) return 0;
  const firstMonth = joinYear === year ? Number(joined.slice(5, 7)) : 1;
  const thisYear = Number(today.slice(0, 4));
  if (thisYear < year) return 0;
  if (type.accrual === 'yearly') return floorHalf((type.daysPerYear * (13 - firstMonth)) / 12);
  const lastMonth = thisYear > year ? 12 : Number(today.slice(5, 7));
  const months = Math.max(0, lastMonth - firstMonth + 1);
  return floorHalf((type.daysPerYear * months) / 12);
}

/** Monday of the week containing `date`. */
export function weekStart(date: string): string {
  return addDays(date, 1 - isoWeekday(date));
}
