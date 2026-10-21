// Wall-clock maths in a workspace's time zone, using only the built-in Intl data.
// Dates are "YYYY-MM-DD"; times of day are minutes after midnight.

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string) {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(timeZone, f);
  }
  return f;
}

function wallClock(at: Date, timeZone: string) {
  const p = Object.fromEntries(formatter(timeZone).formatToParts(at).map((x) => [x.type, x.value]));
  return {
    year: Number(p.year),
    month: Number(p.month),
    day: Number(p.day),
    hour: Number(p.hour) % 24,
    minute: Number(p.minute),
    second: Number(p.second),
  };
}

/** How far the zone's wall clock is ahead of UTC at this instant, in ms. */
function offsetMs(at: Date, timeZone: string) {
  const w = wallClock(at, timeZone);
  const asUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
  return asUtc - (at.getTime() - at.getUTCMilliseconds());
}

const pad = (n: number) => String(n).padStart(2, '0');

/** The calendar date and time of day at this instant in the zone. */
export function zonedParts(at: Date, timeZone: string): { date: string; minutes: number } {
  const w = wallClock(at, timeZone);
  return { date: `${w.year}-${pad(w.month)}-${pad(w.day)}`, minutes: w.hour * 60 + w.minute };
}

/** The instant at which the zone's clock shows `minutes` after midnight on `date` (minutes may exceed a day). */
export function zonedTime(date: string, minutes: number, timeZone: string): Date {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const guess = Date.UTC(y, m - 1, d, 0, minutes);
  const first = offsetMs(new Date(guess), timeZone);
  let t = guess - first;
  // Around a DST change the offset at the answer can differ from the offset at the guess.
  const second = offsetMs(new Date(t), timeZone);
  if (second !== first) t = guess - second;
  return new Date(t);
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** ISO weekday: 1 = Monday … 7 = Sunday. */
export function isoWeekday(date: string): number {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay() || 7;
}

/** "HH:MM" or "HH:MM:SS" → minutes after midnight. */
export function clockMinutes(clock: string): number {
  const [h, m] = clock.split(':').map(Number) as [number, number];
  return h * 60 + m;
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    formatter(timeZone);
    return true;
  } catch {
    return false;
  }
}
