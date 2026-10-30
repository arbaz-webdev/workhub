/**
 * A calendar date (YYYY-MM-DD) for people to read in notifications and emails:
 * "26 Oct", or "28 Oct 2027" when the year matters.
 */
export function readableDate(date: string, withYear = false): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', ...(withYear ? { year: 'numeric' } : {}), timeZone: 'UTC' });
}
