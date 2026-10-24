// Monthly attendance for payroll: a Summary row per person and a Daily sheet, as
// .xlsx, or the summary as CSV (with a BOM so Excel reads Urdu names correctly).
import type { AttendanceDayDto } from '@workhub/shared';
import { and, asc, eq, gte, inArray, lte, ne } from 'drizzle-orm';
import type { Tx } from '../db/db.service';
import { attendanceDays, memberships, teams, users } from '../db/schema';
import { buildDay, eventsForDays, extrasLoader, firstCountedDay, peopleAttendance, siteNameMap, trackingStart, type WorkspaceInfo } from './attendance';
import { addDays, zonedParts } from './zoned';

// The package's CommonJS build (what Node's require loads) exports the function itself;
// its types are published for the ES module build, so borrow them from there.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const writeXlsxFile = require('write-excel-file/node') as typeof import('write-excel-file/node', { with: { 'resolution-mode': 'import' } }).default;

export interface PersonMonth {
  userId: string;
  name: string;
  email: string;
  team: string | null;
  days: AttendanceDayDto[];
}

export interface MonthSummary {
  counted: number;
  present: number;
  late: number;
  halfDays: number;
  absent: number;
  paidLeave: number;
  unpaidLeave: number;
  holidays: number;
  daysOff: number;
  workedDaysOff: number;
  workedHours: number;
  lateMinutes: number;
  /** Days counted, less absences, half days and unpaid leave. */
  payableDays: number;
}

export async function monthReport(tx: Tx, ws: WorkspaceInfo, month: string, now = new Date()) {
  const from = `${month}-01`;
  const lastOfMonth = addDays(`${addDays(from, 32).slice(0, 7)}-01`, -1);
  const today = zonedParts(now, ws.timezone).date;
  const to = lastOfMonth < today ? lastOfMonth : today;
  const people = await tx
    .select({ userId: users.id, name: users.name, email: users.email, team: teams.name })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .leftJoin(teams, eq(teams.id, memberships.teamId))
    .where(and(eq(memberships.workspaceId, ws.id), ne(memberships.role, 'guest')))
    .orderBy(asc(users.name));
  const result: PersonMonth[] = [];
  if (to < from || people.length === 0) return { from, to, people: result };

  const attendance = await peopleAttendance(tx, ws.id);
  const rows = await tx
    .select()
    .from(attendanceDays)
    .where(
      and(
        eq(attendanceDays.workspaceId, ws.id),
        inArray(
          attendanceDays.userId,
          people.map((p) => p.userId),
        ),
        gte(attendanceDays.workDate, from),
        lte(attendanceDays.workDate, to),
      ),
    );
  const byKey = new Map(rows.map((r) => [`${r.userId}:${r.workDate}`, r]));
  const events = await eventsForDays(
    tx,
    rows.map((r) => r.id),
  );
  const extras = await extrasLoader(tx, ws, attendance, from, to);
  const siteNames = await siteNameMap(tx, ws.id);
  const start = await trackingStart(tx, ws);
  for (const p of people) {
    const a = attendance.get(p.userId);
    const counted = firstCountedDay(start, a?.joinedAt, ws, now);
    const days: AttendanceDayDto[] = [];
    for (let d = from; d <= to; d = addDays(d, 1)) {
      const row = byKey.get(`${p.userId}:${d}`);
      if (!row && d < counted) continue;
      days.push(buildDay(d, row, row ? (events.get(row.id) ?? []) : [], a?.shift ?? null, ws, siteNames, now, extras(p.userId, d)));
    }
    result.push({ ...p, days });
  }
  return { from, to, people: result };
}

export function summarize(days: AttendanceDayDto[]): MonthSummary {
  const s: MonthSummary = { counted: 0, present: 0, late: 0, halfDays: 0, absent: 0, paidLeave: 0, unpaidLeave: 0, holidays: 0, daysOff: 0, workedDaysOff: 0, workedHours: 0, lateMinutes: 0, payableDays: 0 };
  let deductions = 0;
  for (const d of days) {
    if (d.status === 'not_started') continue; // today, not over yet
    s.counted += 1;
    s.workedHours += d.workedMinutes / 60;
    s.lateMinutes += d.lateMinutes;
    const leave = d.leave?.fraction ?? 0;
    if (d.leave) {
      if (d.leave.paid) s.paidLeave += leave;
      else {
        s.unpaidLeave += leave;
        deductions += leave;
      }
    }
    if (d.flags.includes('day_off')) s.workedDaysOff += 1;
    switch (d.status) {
      case 'present':
        if (!d.flags.includes('day_off')) s.present += 1;
        break;
      case 'late':
        s.late += 1;
        break;
      case 'half_day':
        s.halfDays += 1;
        deductions += 0.5;
        break;
      case 'absent':
        // With half the day on leave, only the other half is missing.
        s.absent += 1 - leave;
        deductions += 1 - leave;
        break;
      case 'holiday':
        s.holidays += 1;
        break;
      case 'weekend':
        s.daysOff += 1;
        break;
    }
  }
  s.workedHours = Math.round(s.workedHours * 100) / 100;
  s.payableDays = Math.max(0, s.counted - deductions);
  return s;
}

const SUMMARY_HEADERS = [
  'Employee',
  'Email',
  'Team',
  'Days counted',
  'Present',
  'Late',
  'Half days',
  'Absent',
  'Paid leave',
  'Unpaid leave',
  'Holidays',
  'Days off',
  'Worked days off',
  'Hours worked',
  'Late minutes',
  'Payable days',
];

function summaryRow(p: PersonMonth): (string | number)[] {
  const s = summarize(p.days);
  return [p.name, p.email, p.team ?? '', s.counted, s.present, s.late, s.halfDays, s.absent, s.paidLeave, s.unpaidLeave, s.holidays, s.daysOff, s.workedDaysOff, s.workedHours, s.lateMinutes, s.payableDays];
}

const STATUS_TEXT: Record<AttendanceDayDto['status'], string> = {
  present: 'Present',
  late: 'Late',
  half_day: 'Half day',
  absent: 'Absent',
  on_leave: 'On leave',
  holiday: 'Holiday',
  weekend: 'Day off',
  not_started: 'Not finished',
};

function clock(iso: string | null, timeZone: string) {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone });
}

export async function toXlsx(report: Awaited<ReturnType<typeof monthReport>>, ws: WorkspaceInfo): Promise<Buffer> {
  const bold = (value: string) => ({ value, fontWeight: 'bold' as const });
  const summary = [SUMMARY_HEADERS.map(bold), ...report.people.map((p) => summaryRow(p).map((value) => ({ value })))];
  const daily = [
    ['Date', 'Employee', 'Status', 'Leave', 'Holiday', 'Shift', 'In', 'Out', 'Hours worked', 'Late minutes', 'Notes'].map(bold),
    ...report.people.flatMap((p) =>
      p.days.map((d) =>
        [
          d.date,
          p.name,
          STATUS_TEXT[d.status],
          d.leave ? `${d.leave.typeName}${d.leave.fraction < 1 ? ' (half)' : ''}` : '',
          d.holidayName ?? '',
          d.shiftName ?? '',
          clock(d.checkInAt, ws.timezone),
          clock(d.checkOutAt, ws.timezone),
          Math.round((d.workedMinutes / 60) * 100) / 100,
          d.lateMinutes,
          d.flags.filter((f) => f !== 'late').join(', '),
        ].map((value) => ({ value })),
      ),
    ),
  ];
  const result = writeXlsxFile([
    { data: summary, sheet: 'Summary', stickyRowsCount: 1, columns: [{ width: 24 }, { width: 28 }, { width: 16 }, ...Array(13).fill({ width: 12 })] },
    { data: daily, sheet: 'Daily', stickyRowsCount: 1, columns: [{ width: 12 }, { width: 24 }, { width: 12 }, { width: 16 }, { width: 20 }, { width: 16 }, { width: 8 }, { width: 8 }, { width: 12 }, { width: 12 }, { width: 30 }] },
  ]);
  return Buffer.from(await result.toBuffer());
}

function csvCell(v: string | number) {
  const s = String(v);
  // Quote anything with separators, and neutralise formulas (CSV injection).
  const safe = /^[=+\-@\t\r]/.test(s) && typeof v === 'string' ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function toCsv(report: Awaited<ReturnType<typeof monthReport>>): Buffer {
  const lines = [SUMMARY_HEADERS, ...report.people.map(summaryRow)].map((r) => r.map(csvCell).join(','));
  // A byte-order mark tells Excel the file is UTF-8 (otherwise Urdu names come out garbled).
  return Buffer.from(String.fromCharCode(0xfeff) + lines.join(String.fromCharCode(13, 10)) + String.fromCharCode(13, 10), 'utf8');
}
