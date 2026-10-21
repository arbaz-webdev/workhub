// Attendance data access: effective shifts, day views built from stored events, and
// the checks that decide which day a new event belongs to.
import { ConflictException } from '@nestjs/common';
import type { AttendanceDayDto, AttendanceEventDto, AttendanceFlag, AttendanceTodayDto, ShiftDto } from '@workhub/shared';
import { and, asc, desc, eq, gte, inArray, lt, lte, sql } from 'drizzle-orm';
import type { Tx } from '../db/db.service';
import { attendanceDays, attendanceEvents, attendanceSites, memberships, shifts, teams, workspaces, type DayPolicy } from '../db/schema';
import { deviceLabel, type SiteRule } from './location';
import { breaksOn, evaluateDay, punchState, resolveWorkday, shiftWindow, type DayEvent, type ShiftRule } from './rules';
import { addDays, isoWeekday, zonedParts, zonedTime } from './zoned';

export type ShiftRow = typeof shifts.$inferSelect;
export type DayRow = typeof attendanceDays.$inferSelect;
export type EventRow = typeof attendanceEvents.$inferSelect;

/** An open session older than this can't be checked out of; it's a forgotten check-out. */
export const MAX_SESSION_MINUTES = 20 * 60;
/** How long a finished day stays on the attendance page before the next one takes over. */
export const RECENT_DAY_MINUTES = 8 * 60;

export interface WorkspaceInfo {
  id: string;
  timezone: string;
  workingDays: number[];
  requireSelfie: boolean;
}

export async function workspaceInfo(tx: Tx, workspaceId: string): Promise<WorkspaceInfo> {
  const [w] = await tx
    .select({ id: workspaces.id, timezone: workspaces.timezone, workingDays: workspaces.workingDays, requireSelfie: workspaces.attendanceRequireSelfie })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId));
  return w!;
}

export function shiftDto(s: ShiftRow): ShiftDto {
  const start = s.startTime.slice(0, 5);
  const end = s.endTime.slice(0, 5);
  return {
    id: s.id,
    name: s.name,
    startTime: start,
    endTime: end,
    overnight: end <= start,
    graceMinutes: s.graceMinutes,
    fullDayMinutes: s.fullDayMinutes,
    halfDayMinutes: s.halfDayMinutes,
    workingDays: s.workingDays,
    breaks: s.breaks,
    isDefault: s.isDefault,
  };
}

export function shiftRule(s: ShiftRow): ShiftRule {
  return {
    startTime: s.startTime,
    endTime: s.endTime,
    graceMinutes: s.graceMinutes,
    fullDayMinutes: s.fullDayMinutes,
    halfDayMinutes: s.halfDayMinutes,
    workingDays: s.workingDays,
    breaks: s.breaks,
  };
}

export interface PersonAttendance {
  userId: string;
  joinedAt: Date;
  remote: boolean;
  teamId: string | null;
  shift: ShiftRow | null;
}

/** Everyone's effective shift: their own, else their team's, else the workspace default. */
export async function peopleAttendance(tx: Tx, workspaceId: string, userIds?: string[]): Promise<Map<string, PersonAttendance>> {
  const allShifts = await tx.select().from(shifts).where(eq(shifts.workspaceId, workspaceId));
  const byId = new Map(allShifts.map((s) => [s.id, s]));
  const fallback = allShifts.find((s) => s.isDefault) ?? null;
  const rows = await tx
    .select({ userId: memberships.userId, joinedAt: memberships.createdAt, shiftId: memberships.shiftId, teamId: memberships.teamId, remote: memberships.attendanceRemote, teamShiftId: teams.shiftId })
    .from(memberships)
    .leftJoin(teams, eq(teams.id, memberships.teamId))
    .where(and(eq(memberships.workspaceId, workspaceId), userIds ? inArray(memberships.userId, userIds) : undefined));
  return new Map(
    rows.map((r) => [
      r.userId,
      {
        userId: r.userId,
        joinedAt: r.joinedAt,
        remote: r.remote,
        teamId: r.teamId,
        shift: (r.shiftId && byId.get(r.shiftId)) || (r.teamShiftId && byId.get(r.teamShiftId)) || fallback,
      },
    ]),
  );
}

/** The schedule and rules for a date under a shift (or the workspace's working days without one). */
export function scheduleFor(shift: ShiftRow | null, date: string, ws: WorkspaceInfo) {
  if (!shift) {
    const policy: DayPolicy = { graceMinutes: 0, fullDayMinutes: 480, halfDayMinutes: 240, breaks: [], workingDay: ws.workingDays.includes(isoWeekday(date)) };
    return { shiftId: null, shiftName: null, scheduledStart: null, scheduledEnd: null, policy };
  }
  const w = shiftWindow(shift, date, ws.timezone);
  const policy: DayPolicy = {
    graceMinutes: shift.graceMinutes,
    fullDayMinutes: shift.fullDayMinutes,
    halfDayMinutes: shift.halfDayMinutes,
    breaks: shift.breaks,
    workingDay: shift.workingDays.includes(isoWeekday(date)),
  };
  return { shiftId: shift.id, shiftName: shift.name, scheduledStart: w.start, scheduledEnd: w.end, policy };
}

const toDayEvents = (events: EventRow[]): DayEvent[] =>
  events.map((e) => ({ type: e.type, at: e.occurredAt, breakName: e.breakName, flags: e.flags as AttendanceFlag[] }));

export function eventDto(e: EventRow, workspaceId: string, siteNames: Map<string, string>): AttendanceEventDto {
  return {
    id: e.id,
    type: e.type,
    occurredAt: e.occurredAt.toISOString(),
    breakName: e.breakName,
    inZone: e.inZone,
    siteName: e.siteId ? (siteNames.get(e.siteId) ?? null) : null,
    flags: e.flags as AttendanceFlag[],
    device: deviceLabel(e.userAgent),
    ip: e.ip,
    selfieUrl: e.selfieKey ? `/attendance/events/${e.id}/selfie?workspace=${workspaceId}` : null,
  };
}

/** A day as the person (or their manager) sees it. Days never checked into have no row. */
export function buildDay(
  date: string,
  row: DayRow | undefined,
  events: EventRow[],
  shift: ShiftRow | null,
  ws: WorkspaceInfo,
  siteNames: Map<string, string>,
  now: Date,
): AttendanceDayDto {
  // A recorded day keeps the rules it started under; others use today's shift.
  const sched = row
    ? { shiftName: row.shiftName, scheduledStart: row.scheduledStart, scheduledEnd: row.scheduledEnd, policy: row.policy }
    : scheduleFor(shift, date, ws);
  const r = evaluateDay({
    date,
    workingDay: sched.policy.workingDay,
    graceMinutes: sched.policy.graceMinutes,
    fullDayMinutes: sched.policy.fullDayMinutes,
    halfDayMinutes: sched.policy.halfDayMinutes,
    breaks: breaksOn(sched.policy.breaks, date),
    scheduledStart: sched.scheduledStart,
    scheduledEnd: sched.scheduledEnd,
    dayEnd: zonedTime(addDays(date, 1), 0, ws.timezone),
    events: toDayEvents(events),
    now,
  });
  return {
    date,
    status: r.status,
    flags: r.flags,
    open: r.open,
    onBreak: r.onBreak,
    checkInAt: r.checkInAt?.toISOString() ?? null,
    checkOutAt: r.checkOutAt?.toISOString() ?? null,
    workedMinutes: r.workedMinutes,
    breakMinutes: r.breakMinutes,
    lateMinutes: r.lateMinutes,
    shiftName: sched.shiftName,
    scheduledStart: sched.scheduledStart?.toISOString() ?? null,
    scheduledEnd: sched.scheduledEnd?.toISOString() ?? null,
    events: events.map((e) => eventDto(e, ws.id, siteNames)),
  };
}

/**
 * The first date the workspace tracked attendance (its first shift or check-in), or
 * null if it hasn't yet. Days before it, or before someone joined, are never "absent".
 */
export async function trackingStart(tx: Tx, ws: WorkspaceInfo): Promise<string | null> {
  const { rows } = await tx.execute<{ t: Date | null }>(sql`
    select least(
      (select min(created_at) from shifts where workspace_id = ${ws.id}),
      (select min(created_at) from attendance_days where workspace_id = ${ws.id})
    ) as t`);
  const t = rows[0]?.t;
  return t ? zonedParts(new Date(t), ws.timezone).date : null;
}

/** The first day that counts for this person: tracking had started and they had joined. */
export function firstCountedDay(start: string | null, joinedAt: Date | undefined, ws: WorkspaceInfo, now: Date): string {
  const joined = joinedAt ? zonedParts(joinedAt, ws.timezone).date : '0000-01-01';
  const tracked = start ?? zonedParts(now, ws.timezone).date;
  return joined > tracked ? joined : tracked;
}

export async function siteRules(tx: Tx, workspaceId: string): Promise<SiteRule[]> {
  return tx
    .select({
      id: attendanceSites.id,
      name: attendanceSites.name,
      latitude: attendanceSites.latitude,
      longitude: attendanceSites.longitude,
      radiusMeters: attendanceSites.radiusMeters,
      ipRanges: attendanceSites.ipRanges,
    })
    .from(attendanceSites)
    .where(eq(attendanceSites.workspaceId, workspaceId))
    .orderBy(asc(attendanceSites.name));
}

export async function eventsForDays(tx: Tx, dayIds: string[]): Promise<Map<string, EventRow[]>> {
  const map = new Map<string, EventRow[]>();
  if (dayIds.length === 0) return map;
  const rows = await tx
    .select()
    .from(attendanceEvents)
    .where(inArray(attendanceEvents.dayId, dayIds))
    .orderBy(asc(attendanceEvents.occurredAt), asc(attendanceEvents.receivedAt));
  for (const e of rows) map.set(e.dayId, [...(map.get(e.dayId) ?? []), e]);
  return map;
}

/**
 * The person's open day (checked in, not out) if its session started within
 * MAX_SESSION_MINUTES of `at`. Older open days are forgotten check-outs.
 */
export async function openDay(tx: Tx, workspaceId: string, userId: string, at: Date): Promise<{ row: DayRow; events: EventRow[] } | null> {
  const recent = await tx
    .select()
    .from(attendanceDays)
    .where(and(eq(attendanceDays.workspaceId, workspaceId), eq(attendanceDays.userId, userId)))
    .orderBy(desc(attendanceDays.workDate))
    .limit(3);
  const events = await eventsForDays(
    tx,
    recent.map((d) => d.id),
  );
  for (const row of recent) {
    const evs = events.get(row.id) ?? [];
    if (punchState(evs) === 'out') continue;
    const sessionStart = [...evs].reverse().find((e) => e.type === 'check_in')!.occurredAt;
    if (at.getTime() - sessionStart.getTime() <= MAX_SESSION_MINUTES * 60_000) return { row, events: evs };
  }
  return null;
}

export async function siteNameMap(tx: Tx, workspaceId: string) {
  const sites = await tx.select({ id: attendanceSites.id, name: attendanceSites.name }).from(attendanceSites).where(eq(attendanceSites.workspaceId, workspaceId));
  return new Map(sites.map((s) => [s.id, s.name]));
}

/** What the attendance page shows: today's (or tonight's) workday and where the person stands. */
export async function todayFor(tx: Tx, ws: WorkspaceInfo, userId: string, now: Date): Promise<AttendanceTodayDto> {
  const person = (await peopleAttendance(tx, ws.id, [userId])).get(userId);
  const shift = person?.shift ?? null;
  const siteNames = await siteNameMap(tx, ws.id);
  const open = await openDay(tx, ws.id, userId, now);
  let date: string;
  let row: DayRow | undefined;
  let events: EventRow[];
  if (open) {
    ({ row, events } = open);
    date = row.workDate;
  } else {
    date = resolveWorkday(now, shift ? shiftRule(shift) : null, ws.timezone);
    [row] = await tx
      .select()
      .from(attendanceDays)
      .where(and(eq(attendanceDays.workspaceId, ws.id), eq(attendanceDays.userId, userId), eq(attendanceDays.workDate, date)));
    events = row ? ((await eventsForDays(tx, [row.id])).get(row.id) ?? []) : [];
    if (!row) {
      // Just finished a shift (say, checked out of a night shift at 03:00)? Keep showing
      // it for a while rather than jumping straight to tonight's empty one.
      const [recent] = await tx
        .select()
        .from(attendanceDays)
        .where(and(eq(attendanceDays.workspaceId, ws.id), eq(attendanceDays.userId, userId), lt(attendanceDays.workDate, date)))
        .orderBy(desc(attendanceDays.workDate))
        .limit(1);
      const recentEvents = recent ? ((await eventsForDays(tx, [recent.id])).get(recent.id) ?? []) : [];
      const last = recentEvents.at(-1);
      if (recent && last && now.getTime() - last.occurredAt.getTime() < RECENT_DAY_MINUTES * 60_000) {
        row = recent;
        date = recent.workDate;
        events = recentEvents;
      }
    }
  }
  const policyBreaks = row ? row.policy.breaks : (shift?.breaks ?? []);
  return {
    date,
    state: open ? punchState(open.events) : 'out',
    day: buildDay(date, row, events, shift, ws, siteNames, now),
    shift: shift ? shiftDto(shift) : null,
    breaks: breaksOn(policyBreaks, date),
    requireSelfie: ws.requireSelfie,
    timezone: ws.timezone,
  };
}

/** A person's days from `from` to `to` (inclusive), newest first. */
export async function daysFor(tx: Tx, ws: WorkspaceInfo, userId: string, from: string, to: string, now: Date): Promise<AttendanceDayDto[]> {
  const person = (await peopleAttendance(tx, ws.id, [userId])).get(userId);
  const shift = person?.shift ?? null;
  const counted = firstCountedDay(await trackingStart(tx, ws), person?.joinedAt, ws, now);
  const rows = await tx
    .select()
    .from(attendanceDays)
    .where(and(eq(attendanceDays.workspaceId, ws.id), eq(attendanceDays.userId, userId), gte(attendanceDays.workDate, from), lte(attendanceDays.workDate, to)));
  const byDate = new Map(rows.map((r) => [r.workDate, r]));
  const events = await eventsForDays(
    tx,
    rows.map((r) => r.id),
  );
  const siteNames = await siteNameMap(tx, ws.id);
  const out: AttendanceDayDto[] = [];
  for (let d = to; d >= from; d = addDays(d, -1)) {
    const row = byDate.get(d);
    if (!row && d < counted) continue; // before they joined, or before attendance was set up
    out.push(buildDay(d, row, row ? (events.get(row.id) ?? []) : [], shift, ws, siteNames, now));
  }
  return out;
}

/** Creates the day row (copying the shift's rules) if needed, and locks it for this event. */
export async function lockDay(tx: Tx, ws: WorkspaceInfo, userId: string, date: string, shift: ShiftRow | null): Promise<DayRow> {
  const sched = scheduleFor(shift, date, ws);
  await tx
    .insert(attendanceDays)
    .values({ workspaceId: ws.id, userId, workDate: date, ...sched })
    .onConflictDoNothing({ target: [attendanceDays.workspaceId, attendanceDays.userId, attendanceDays.workDate] });
  const [row] = await tx.execute<{ id: string }>(
    sql`select id from attendance_days where workspace_id = ${ws.id} and user_id = ${userId} and work_date = ${date} for update`,
  ).then((r) => r.rows);
  const [day] = await tx.select().from(attendanceDays).where(eq(attendanceDays.id, row!.id));
  return day!;
}

export function conflict(message: string): never {
  throw new ConflictException(message);
}
