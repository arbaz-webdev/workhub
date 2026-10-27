import type { AttendanceEventType, Presence, PresenceDto } from '@workhub/shared';
import { and, eq, gte, inArray, lte, ne, sql } from 'drizzle-orm';
import { MAX_SESSION_MINUTES, workspaceInfo } from '../attendance/attendance';
import { zonedParts } from '../attendance/zoned';
import type { Tx } from '../db/db.service';
import { leaveRequests, memberships } from '../db/schema';

/** What a punch says about where someone is. */
export function presenceAfter(type: AttendanceEventType): Presence {
  switch (type) {
    case 'check_in':
    case 'break_end':
      return 'in';
    case 'break_start':
      return 'break';
    case 'check_out':
      return 'out';
  }
}

/**
 * Presence for everyone in the workspace except guests, from their last punch within a
 * session's length; without one, on leave (approved, today) or away.
 */
export async function presenceFor(tx: Tx, workspaceId: string, now = new Date()): Promise<PresenceDto[]> {
  const people = await tx
    .select({ userId: memberships.userId })
    .from(memberships)
    .where(and(eq(memberships.workspaceId, workspaceId), ne(memberships.role, 'guest')));
  if (people.length === 0) return [];
  const since = new Date(now.getTime() - MAX_SESSION_MINUTES * 60_000);
  const punches = await tx.execute<{ user_id: string; type: AttendanceEventType; occurred_at: Date | string }>(sql`
    select distinct on (user_id) user_id, type, occurred_at
    from attendance_events
    where workspace_id = ${workspaceId} and voided_at is null and occurred_at > ${since.toISOString()} and occurred_at <= ${now.toISOString()}
    order by user_id, occurred_at desc
  `);
  const last = new Map(punches.rows.map((r) => [r.user_id, r]));

  const today = zonedParts(now, (await workspaceInfo(tx, workspaceId)).timezone).date;
  const away = await tx
    .select({ userId: leaveRequests.userId })
    .from(leaveRequests)
    .where(
      and(
        eq(leaveRequests.workspaceId, workspaceId),
        eq(leaveRequests.status, 'approved'),
        lte(leaveRequests.startDate, today),
        gte(leaveRequests.endDate, today),
        inArray(
          leaveRequests.userId,
          people.map((p) => p.userId),
        ),
      ),
    );
  const onLeave = new Set(away.map((r) => r.userId));

  return people.map(({ userId }) => {
    const punch = last.get(userId);
    const fromPunch = punch ? presenceAfter(punch.type) : null;
    // Checked in beats leave (a half day, or came in anyway); checked out on a leave day reads as leave.
    const presence: Presence = fromPunch === 'in' || fromPunch === 'break' ? fromPunch : onLeave.has(userId) ? 'leave' : (fromPunch ?? 'away');
    return { userId, presence, since: punch && presence === fromPunch ? new Date(punch.occurred_at).toISOString() : null };
  });
}
