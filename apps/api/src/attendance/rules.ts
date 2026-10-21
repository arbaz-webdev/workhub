// Attendance rules as pure functions: which workday a check-in belongs to, and
// what a day adds up to. No database here, so every rule is unit-tested directly.
import { ATTENDANCE_FLAGS, type AttendanceEventType, type AttendanceFlag, type AttendanceStatus, type ShiftBreak } from '@workhub/shared';
import { addDays, clockMinutes, isoWeekday, zonedParts, zonedTime } from './zoned';

export interface ShiftRule {
  startTime: string;
  endTime: string;
  graceMinutes: number;
  fullDayMinutes: number;
  halfDayMinutes: number;
  workingDays: number[];
  breaks: ShiftBreak[];
}

/** How early before a shift a check-in still counts towards it. */
export const EARLY_CHECK_IN_MINUTES = 6 * 60;
/** A day with a schedule is "missed check-out" this long after the shift ends. */
export const MISSED_CHECK_OUT_AFTER_MINUTES = 4 * 60;
/** Without a schedule, a check-in left open this long is "missed check-out". */
export const MAX_OPEN_MINUTES = 16 * 60;

/** When the shift starts and ends for the workday `date`. Overnight shifts end the next day. */
export function shiftWindow(shift: Pick<ShiftRule, 'startTime' | 'endTime'>, date: string, timeZone: string) {
  const start = clockMinutes(shift.startTime);
  let end = clockMinutes(shift.endTime);
  if (end <= start) end += 24 * 60;
  return { start: zonedTime(date, start, timeZone), end: zonedTime(date, end, timeZone) };
}

/**
 * The workday a check-in at `at` counts towards. With a shift, it's the day whose
 * shift window (opening EARLY_CHECK_IN_MINUTES early) contains the moment, so 02:00
 * on an 18:00–03:00 shift belongs to the previous date. Otherwise, the local date.
 */
export function resolveWorkday(at: Date, shift: Pick<ShiftRule, 'startTime' | 'endTime'> | null, timeZone: string): string {
  const local = zonedParts(at, timeZone).date;
  if (!shift) return local;
  let best: { date: string; distance: number } | undefined;
  for (const date of [addDays(local, -1), local, addDays(local, 1)]) {
    const w = shiftWindow(shift, date, timeZone);
    if (at.getTime() >= w.start.getTime() - EARLY_CHECK_IN_MINUTES * 60_000 && at < w.end) {
      const distance = Math.abs(at.getTime() - w.start.getTime());
      if (!best || distance < best.distance) best = { date, distance };
    }
  }
  return best?.date ?? local;
}

/** The breaks a shift allows on a given date (some apply only on certain weekdays). */
export function breaksOn(breaks: ShiftBreak[], date: string): ShiftBreak[] {
  const day = isoWeekday(date);
  return breaks.filter((b) => b.days.length === 0 || b.days.includes(day));
}

export interface DayEvent {
  type: AttendanceEventType;
  at: Date;
  breakName: string | null;
  flags: AttendanceFlag[];
}

export interface DayInput {
  date: string;
  /** Under the shift (or the workspace's working days when there is no shift). */
  workingDay: boolean;
  graceMinutes: number;
  fullDayMinutes: number;
  halfDayMinutes: number;
  /** Breaks allowed on this date. */
  breaks: ShiftBreak[];
  scheduledStart: Date | null;
  scheduledEnd: Date | null;
  /** When the date is over, for days without a schedule (local midnight after it). */
  dayEnd: Date;
  /** Sorted by time. */
  events: DayEvent[];
  now: Date;
  /** Filled in by leave and holidays (sprint 6). */
  holiday?: boolean;
  onLeave?: boolean;
}

export interface DayResult {
  status: AttendanceStatus;
  flags: AttendanceFlag[];
  open: boolean;
  onBreak: string | null;
  checkInAt: Date | null;
  checkOutAt: Date | null;
  workedMinutes: number;
  breakMinutes: number;
  lateMinutes: number;
}

export type PunchState = 'out' | 'in' | 'on_break';

/** Where a sequence of events leaves the person. */
export function punchState(events: Pick<DayEvent, 'type'>[]): PunchState {
  const last = events.at(-1)?.type;
  if (last === 'check_in' || last === 'break_end') return 'in';
  if (last === 'break_start') return 'on_break';
  return 'out';
}

const minutes = (ms: number) => Math.max(0, Math.floor(ms / 60_000));

export function evaluateDay(input: DayInput): DayResult {
  const { events, now } = input;
  const flags = new Set<AttendanceFlag>();
  for (const e of events) for (const f of e.flags) flags.add(f);

  const firstIn = events.find((e) => e.type === 'check_in')?.at ?? null;
  if (!firstIn) {
    const over = now >= (input.scheduledEnd ?? input.dayEnd);
    const status: AttendanceStatus = input.holiday
      ? 'holiday'
      : input.onLeave
        ? 'on_leave'
        : !input.workingDay
          ? 'weekend'
          : over
            ? 'absent'
            : 'not_started';
    return { status, flags: order(flags), open: false, onBreak: null, checkInAt: null, checkOutAt: null, workedMinutes: 0, breakMinutes: 0, lateMinutes: 0 };
  }

  // Still checked in? Then the day runs until now, or is a forgotten check-out.
  const state = punchState(events);
  let cutoff = now;
  let open = state !== 'out';
  if (open) {
    const lastAt = events.at(-1)!.at;
    const missedAt = input.scheduledEnd
      ? new Date(input.scheduledEnd.getTime() + MISSED_CHECK_OUT_AFTER_MINUTES * 60_000)
      : new Date(lastAt.getTime() + MAX_OPEN_MINUTES * 60_000);
    if (now >= missedAt) {
      flags.add('missed_check_out');
      open = false;
      // Count up to the end of the shift (or a full day), never past it; a manager corrects the rest.
      const sessionStart = lastSessionStart(events);
      const limit = input.scheduledEnd ?? new Date(sessionStart.getTime() + input.fullDayMinutes * 60_000);
      cutoff = new Date(Math.max(lastAt.getTime(), limit.getTime()));
    }
  }

  let presentMs = 0;
  const breakMs = new Map<string, number>();
  let sessionStart: Date | null = null;
  let breakStart: { at: Date; name: string } | null = null;
  const closeBreak = (at: Date) => {
    if (!breakStart) return;
    breakMs.set(breakStart.name, (breakMs.get(breakStart.name) ?? 0) + Math.max(0, at.getTime() - breakStart.at.getTime()));
    breakStart = null;
  };
  let lastOut: Date | null = null;
  for (const e of events) {
    if (e.type === 'check_in') sessionStart = e.at;
    else if (e.type === 'break_start') breakStart = { at: e.at, name: e.breakName ?? 'Break' };
    else if (e.type === 'break_end') closeBreak(e.at);
    else if (e.type === 'check_out') {
      closeBreak(e.at);
      if (sessionStart) presentMs += Math.max(0, e.at.getTime() - sessionStart.getTime());
      sessionStart = null;
      lastOut = e.at;
    }
  }
  if (sessionStart) {
    closeBreak(cutoff);
    presentMs += Math.max(0, cutoff.getTime() - sessionStart.getTime());
  }

  // Paid breaks count as work up to their allowance; unpaid and unknown breaks don't.
  let unpaidMs = 0;
  let totalBreakMs = 0;
  for (const [name, ms] of breakMs) {
    totalBreakMs += ms;
    const rule = input.breaks.find((b) => b.name.toLowerCase() === name.toLowerCase());
    if (rule && minutes(ms) > rule.minutes) flags.add('long_break');
    unpaidMs += rule?.paid ? Math.max(0, ms - rule.minutes * 60_000) : ms;
  }
  const workedMinutes = minutes(presentMs - unpaidMs);
  const lateMinutes = input.scheduledStart ? minutes(firstIn.getTime() - input.scheduledStart.getTime()) : 0;
  const late = !!input.scheduledStart && lateMinutes > input.graceMinutes;

  const dayOff = !input.workingDay || !!input.holiday || !!input.onLeave;
  let status: AttendanceStatus;
  if (dayOff) {
    // Working on a day off: record it, but don't judge it as late or short.
    flags.add('day_off');
    status = 'present';
  } else {
    if (late) flags.add('late');
    // Until the shift is over someone who checked out may still come back (lunch, an
    // errand), so short days and leaving early are only judged once it has ended.
    const over = now >= (input.scheduledEnd ?? input.dayEnd);
    if (over && !open && lastOut && input.scheduledEnd && !flags.has('missed_check_out') && lastOut.getTime() < input.scheduledEnd.getTime() - input.graceMinutes * 60_000) {
      flags.add('left_early');
    }
    if (open || !over || workedMinutes >= input.fullDayMinutes) status = late ? 'late' : 'present';
    else if (workedMinutes >= input.halfDayMinutes) status = 'half_day';
    else {
      status = 'absent';
      flags.add('short_day');
    }
  }

  const onBreak = state === 'on_break' && open ? (events.at(-1)!.breakName ?? 'Break') : null;
  return {
    status,
    flags: order(flags),
    open,
    onBreak,
    checkInAt: firstIn,
    checkOutAt: state === 'out' ? lastOut : null,
    workedMinutes,
    breakMinutes: minutes(totalBreakMs),
    lateMinutes: late ? lateMinutes : 0,
  };
}

function lastSessionStart(events: DayEvent[]): Date {
  for (let i = events.length - 1; i >= 0; i--) if (events[i]!.type === 'check_in') return events[i]!.at;
  return events[0]!.at;
}

function order(flags: Set<AttendanceFlag>): AttendanceFlag[] {
  return ATTENDANCE_FLAGS.filter((f) => flags.has(f));
}
