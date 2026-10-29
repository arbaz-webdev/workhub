// Wall-clock times in the workspace's time zone (not the browser's), using Intl only.

function offsetMs(at: Date, timeZone: string) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
      .formatToParts(at)
      .map((x) => [x.type, x.value]),
  );
  const asUtc = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour) % 24, Number(p.minute), Number(p.second));
  return asUtc - (at.getTime() - at.getUTCMilliseconds());
}

/** "2026-10-21" + "09:30" in Asia/Karachi → the ISO instant. `nextDay` for night shifts. */
export function zonedToIso(date: string, time: string, timeZone: string, nextDay = false): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const [hh, mm] = time.split(':').map(Number) as [number, number];
  const guess = Date.UTC(y, m - 1, d + (nextDay ? 1 : 0), hh, mm);
  const first = offsetMs(new Date(guess), timeZone);
  let t = guess - first;
  const second = offsetMs(new Date(t), timeZone);
  if (second !== first) t = guess - second;
  return new Date(t).toISOString();
}

/** "HH:MM" of an instant in the zone. */
export function zonedClock(iso: string, timeZone: string): string {
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone });
}

/** Today's date where the user is (not in UTC, which can still be yesterday in Pakistan). */
export function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** Monday of the week containing `date`. */
export function mondayOf(date: string): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay() || 7;
  return addDays(date, 1 - weekday);
}

/** 125 → "2:05". */
export function hhmm(minutes: number) {
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`;
}

export function dayLabel(date: string, opts: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'short' }) {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString(undefined, { ...opts, timeZone: 'UTC' });
}
