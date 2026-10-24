// Holidays and approved leave for a range of dates, in the shape day views need.
import { and, eq, gte, inArray, isNull, lte } from 'drizzle-orm';
import type { Tx } from '../db/db.service';
import { holidays, leaveRequests, leaveTypes } from '../db/schema';
import { leaveDates } from '../leave/leave-rules';
import type { DayExtras, PersonAttendance, WorkspaceInfo } from './attendance';

export type LeaveOnDay = NonNullable<DayExtras['leave']>;

/** Holiday name by date. Two holidays on one date read "A · B". */
export async function holidayMap(tx: Tx, workspaceId: string, from: string, to: string): Promise<Map<string, string>> {
  const rows = await tx
    .select({ date: holidays.date, name: holidays.name })
    .from(holidays)
    .where(and(eq(holidays.workspaceId, workspaceId), gte(holidays.date, from), lte(holidays.date, to)));
  const map = new Map<string, string>();
  for (const h of rows) map.set(h.date, map.has(h.date) ? `${map.get(h.date)} · ${h.name}` : h.name);
  return map;
}

/** The working days a person's shift (or the workspace) expects. */
export function workingDaysOf(person: PersonAttendance | undefined, ws: WorkspaceInfo): number[] {
  return person?.shift?.workingDays ?? ws.workingDays;
}

/**
 * Approved leave per person per date, counting only the days leave actually takes
 * (working days that aren't holidays), the same way requests are counted.
 */
export async function leaveMap(
  tx: Tx,
  ws: WorkspaceInfo,
  people: Map<string, PersonAttendance>,
  from: string,
  to: string,
  holidayDates: Map<string, string>,
  statuses: ('approved' | 'pending')[] = ['approved'],
): Promise<Map<string, Map<string, LeaveOnDay & { status: 'approved' | 'pending'; color: string }>>> {
  const userIds = [...people.keys()];
  const out = new Map<string, Map<string, LeaveOnDay & { status: 'approved' | 'pending'; color: string }>>();
  if (userIds.length === 0) return out;
  const rows = await tx
    .select({
      userId: leaveRequests.userId,
      startDate: leaveRequests.startDate,
      endDate: leaveRequests.endDate,
      halfDay: leaveRequests.halfDay,
      status: leaveRequests.status,
      typeName: leaveTypes.name,
      paid: leaveTypes.paid,
      color: leaveTypes.color,
    })
    .from(leaveRequests)
    .innerJoin(leaveTypes, eq(leaveTypes.id, leaveRequests.leaveTypeId))
    .where(
      and(
        eq(leaveRequests.workspaceId, ws.id),
        inArray(leaveRequests.userId, userIds),
        inArray(leaveRequests.status, statuses),
        lte(leaveRequests.startDate, to),
        gte(leaveRequests.endDate, from),
      ),
    );
  const holidaySet = new Set(holidayDates.keys());
  for (const r of rows) {
    const days = leaveDates(r.startDate, r.endDate, r.halfDay, workingDaysOf(people.get(r.userId), ws), holidaySet);
    const mine = out.get(r.userId) ?? new Map();
    for (const d of days) {
      if (d.date < from || d.date > to) continue;
      mine.set(d.date, { typeName: r.typeName, fraction: d.fraction, paid: r.paid, status: r.status as 'approved' | 'pending', color: r.color });
    }
    out.set(r.userId, mine);
  }
  return out;
}

/** Leave types still in use, for lookups. */
export async function activeLeaveTypes(tx: Tx, workspaceId: string) {
  return tx.select().from(leaveTypes).where(and(eq(leaveTypes.workspaceId, workspaceId), isNull(leaveTypes.archivedAt)));
}
