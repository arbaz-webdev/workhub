// Attendance from fingerprint and face devices (ZKTeco and compatible), from either:
//  - attlog.dat, downloaded from the device to a USB stick: one punch per line,
//    "<user number>\t<YYYY-MM-DD HH:MM:SS>\t<verify>\t<state>…"; or
//  - a CSV or text export from ZKTime / ZKBio, with a header naming the columns.
// Punch states (in/out) are often wrong on real devices, so they're ignored: each
// workday's first punch is the check-in and its last the check-out.
import type { AttendanceFlag, DeviceImportResultDto } from '@workhub/shared';
import { and, eq, gte, inArray, lte } from 'drizzle-orm';
import { parseCsv } from '../crm/csv';
import type { Tx } from '../db/db.service';
import { attendanceDays, attendanceEvents } from '../db/schema';
import { eventsForDays, lockDay, peopleAttendance, shiftRule, type WorkspaceInfo } from './attendance';
import { resolveWorkday } from './rules';
import { zonedTime } from './zoned';

export interface Punch {
  deviceUserId: string;
  name: string | null;
  /** Wall-clock time on the device: YYYY-MM-DD and seconds after midnight. */
  date: string;
  seconds: number;
}

export interface ParsedFile {
  format: 'attlog' | 'csv';
  punches: Punch[];
  unreadable: number;
  examples: string[];
}

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * A device date-time as written by ZKTeco software: year first (2027-06-07 09:02:11,
 * 2027/06/07 9:02) or day first, as Pakistan writes dates (07/06/2027 09:02, 7-6-2027 9:02 AM).
 */
export function parseDeviceTime(text: string): { date: string; seconds: number } | null {
  const s = text.trim().replace(/\s+/g, ' ');
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?(?: ?([AaPp])\.?[Mm]\.?)?$/.exec(s);
  let y: number, mo: number, d: number;
  if (m) {
    [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  } else {
    m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4}) (\d{1,2}):(\d{2})(?::(\d{2}))?(?: ?([AaPp])\.?[Mm]\.?)?$/.exec(s);
    if (!m) return null;
    [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
  }
  let h = Number(m[4]);
  const min = Number(m[5]);
  const sec = Number(m[6] ?? 0);
  const ampm = m[7]?.toLowerCase();
  if (ampm) {
    if (h < 1 || h > 12) return null;
    h = (h % 12) + (ampm === 'p' ? 12 : 0);
  }
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || min > 59 || sec > 59) return null;
  const date = `${y}-${pad(mo)}-${pad(d)}`;
  // Reject dates like 31/02.
  if (new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) return null;
  return { date, seconds: h * 3600 + min * 60 + sec };
}

const ID_HEADER = /^(ac[-\s]?no\.?|user ?id|user ?no\.?|emp(loyee)? ?(no|id|code)\.?|no\.?|id|badge( ?(no|number))?|person ?id|enroll ?(no|number)|pin)$/i;
const NAME_HEADER = /^((employee |user )?name|first ?name)$/i;
const DATETIME_HEADER = /^(date ?time|date and time|check ?time|punch ?time|att(endance)? ?time|record ?time|time ?stamp|clock ?time|time)$/i;

export function parseDeviceFile(text: string): ParsedFile {
  const clean = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const lines = clean.split(/\r?\n/).filter((l) => l.trim() !== '');
  const punches: Punch[] = [];
  const bad: string[] = [];

  // attlog.dat: most lines are "<id>\t<date time>…" (a stray line shouldn't make it look like a CSV).
  const attlog = /^\s*([A-Za-z0-9]+)\t(\d{4}-\d{2}-\d{2} \d{1,2}:\d{2}(?::\d{2})?)/;
  if (lines.length > 0 && lines.slice(0, 20).filter((l) => attlog.test(l)).length > Math.min(lines.length, 20) / 2) {
    for (const line of lines) {
      const m = attlog.exec(line);
      const t = m && parseDeviceTime(m[2]!);
      if (m && t) punches.push({ deviceUserId: m[1]!, name: null, ...t });
      else bad.push(line);
    }
    return { format: 'attlog', punches, unreadable: bad.length, examples: bad.slice(0, 3) };
  }

  const rows = parseCsv(clean).filter((r) => r.some((c) => c.trim() !== ''));
  const header = (rows[0] ?? []).map((h) => h.trim());
  const idCol = header.findIndex((h) => ID_HEADER.test(h));
  const nameCol = header.findIndex((h) => NAME_HEADER.test(h));
  const dateCol = header.findIndex((h) => /^date$/i.test(h));
  const timeCol = header.findIndex((h) => /^time$/i.test(h));
  const dtCol = dateCol >= 0 && timeCol >= 0 ? -1 : header.findIndex((h) => DATETIME_HEADER.test(h));
  if (idCol < 0 || (dtCol < 0 && (dateCol < 0 || timeCol < 0))) {
    return { format: 'csv', punches: [], unreadable: rows.length, examples: [header.join(', ') || '(empty file)'] };
  }
  for (const r of rows.slice(1)) {
    const id = (r[idCol] ?? '').trim();
    const t = parseDeviceTime(dtCol >= 0 ? (r[dtCol] ?? '') : `${r[dateCol] ?? ''} ${r[timeCol] ?? ''}`);
    if (id && /^[A-Za-z0-9._-]{1,40}$/.test(id) && t) punches.push({ deviceUserId: id, name: nameCol >= 0 ? r[nameCol]!.trim() || null : null, ...t });
    else bad.push(r.join(', '));
  }
  return { format: 'csv', punches, unreadable: bad.length, examples: bad.slice(0, 3) };
}

/**
 * Writes punches as check-ins and check-outs, one pair per workday (night shifts run past
 * midnight, as for check-ins in the app). Days already recorded in the app are kept as
 * they are; days from an earlier import are replaced, so importing a file twice changes nothing.
 */
export async function importPunches(tx: Tx, info: WorkspaceInfo, byUser: Map<string, Punch[]>, now = new Date()): Promise<Omit<DeviceImportResultDto, 'unmatchedPunches'>> {
  const result = { days: 0, singlePunchDays: 0, keptExisting: 0, alreadyImported: 0, futurePunches: 0 };
  const people = await peopleAttendance(tx, info.id, [...byUser.keys()]);

  for (const [userId, punches] of byUser) {
    const shift = people.get(userId)?.shift ?? null;
    const rule = shift ? shiftRule(shift) : null;
    // Each punch, as an instant, under its workday.
    const days = new Map<string, Date[]>();
    for (const p of punches) {
      const at = new Date(zonedTime(p.date, 0, info.timezone).getTime() + p.seconds * 1000);
      if (at > now) {
        result.futurePunches += 1;
        continue;
      }
      const day = resolveWorkday(at, rule, info.timezone);
      days.set(day, [...(days.get(day) ?? []), at]);
    }
    if (days.size === 0) continue;

    // What's already there for these days.
    const dates = [...days.keys()].sort();
    const existing = await tx
      .select({ id: attendanceDays.id, workDate: attendanceDays.workDate })
      .from(attendanceDays)
      .where(and(eq(attendanceDays.workspaceId, info.id), eq(attendanceDays.userId, userId), gte(attendanceDays.workDate, dates[0]!), lte(attendanceDays.workDate, dates.at(-1)!)));
    const eventsByDay = await eventsForDays(tx, existing.map((d) => d.id));
    const dayIdByDate = new Map(existing.map((d) => [d.workDate, d.id]));

    for (const date of dates) {
      const times = days.get(date)!.sort((a, b) => a.getTime() - b.getTime());
      const first = times[0]!;
      const last = times.at(-1)!;
      const hasOut = times.length > 1 && last.getTime() - first.getTime() >= 60_000;
      const before = eventsByDay.get(dayIdByDate.get(date) ?? '') ?? [];
      const fromApp = before.filter((e) => !e.flags.includes('device'));
      if (fromApp.some((e) => e.type === 'check_in' || e.type === 'check_out')) {
        result.keptExisting += 1;
        continue;
      }
      const fromDevice = before.filter((e) => e.flags.includes('device'));
      const same =
        fromDevice.length === (hasOut ? 2 : 1) &&
        fromDevice.some((e) => e.type === 'check_in' && e.occurredAt.getTime() === first.getTime()) &&
        (!hasOut || fromDevice.some((e) => e.type === 'check_out' && e.occurredAt.getTime() === last.getTime()));
      if (same) {
        result.alreadyImported += 1;
        continue;
      }
      // A later file can hold more of the day (a check-out the first file didn't have).
      if (fromDevice.length) await tx.update(attendanceEvents).set({ voidedAt: new Date() }).where(inArray(attendanceEvents.id, fromDevice.map((e) => e.id)));

      const day = await lockDay(tx, info, userId, date, shift);
      const flags: AttendanceFlag[] = ['device'];
      await tx.insert(attendanceEvents).values([
        { workspaceId: info.id, dayId: day.id, userId, type: 'check_in', occurredAt: first, flags, userAgent: 'device import' },
        ...(hasOut ? [{ workspaceId: info.id, dayId: day.id, userId, type: 'check_out' as const, occurredAt: last, flags, userAgent: 'device import' }] : []),
      ]);
      result.days += 1;
      if (!hasOut) result.singlePunchDays += 1;
    }
  }
  return result;
}
