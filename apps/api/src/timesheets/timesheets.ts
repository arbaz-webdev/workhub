// Weekly timesheets: built from logged time, locked once submitted or approved.
import { ConflictException } from '@nestjs/common';
import type { TimesheetDto } from '@workhub/shared';
import { and, eq, gte, lte, sql } from 'drizzle-orm';
import { addDays } from '../attendance/zoned';
import type { Tx } from '../db/db.service';
import { projects, tasks, timeEntries, timesheets, users } from '../db/schema';
import { weekStart } from '../leave/leave-rules';

/** Refuses changes to time in a week that's been submitted or approved. */
export async function assertWeekOpen(tx: Tx, workspaceId: string, userId: string, workDate: string) {
  const [sheet] = await tx
    .select({ status: timesheets.status })
    .from(timesheets)
    .where(and(eq(timesheets.workspaceId, workspaceId), eq(timesheets.userId, userId), eq(timesheets.weekStart, weekStart(workDate))));
  if (sheet && sheet.status !== 'rejected') {
    throw new ConflictException(`That week’s timesheet is ${sheet.status}, so its time can’t change. ${sheet.status === 'submitted' ? 'Ask your manager to send it back.' : ''}`.trim());
  }
}

export async function buildTimesheet(tx: Tx, workspaceId: string, userId: string, anyDayOfWeek: string): Promise<TimesheetDto> {
  const start = weekStart(anyDayOfWeek);
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const [person] = await tx.select({ id: users.id, name: users.name, email: users.email }).from(users).where(eq(users.id, userId));
  const [sheet] = await tx
    .select({
      id: timesheets.id,
      status: timesheets.status,
      decisionNote: timesheets.decisionNote,
      decidedByName: sql<string | null>`(select name from users d where d.id = ${timesheets.decidedBy})`,
    })
    .from(timesheets)
    .where(and(eq(timesheets.workspaceId, workspaceId), eq(timesheets.userId, userId), eq(timesheets.weekStart, start)));
  const entries = await tx
    .select({
      taskId: timeEntries.taskId,
      taskTitle: tasks.title,
      projectId: timeEntries.projectId,
      projectName: projects.name,
      workDate: timeEntries.workDate,
      minutes: timeEntries.minutes,
      billable: timeEntries.billable,
      source: timeEntries.source,
    })
    .from(timeEntries)
    .innerJoin(projects, eq(projects.id, timeEntries.projectId))
    .leftJoin(tasks, eq(tasks.id, timeEntries.taskId))
    .where(and(eq(timeEntries.workspaceId, workspaceId), eq(timeEntries.userId, userId), gte(timeEntries.workDate, days[0]!), lte(timeEntries.workDate, days[6]!)));

  const rows = new Map<string, TimesheetDto['rows'][number]>();
  const dayTotals = Array(7).fill(0) as number[];
  let billable = 0;
  let fromTimer = 0;
  for (const e of entries) {
    const key = `${e.projectId}:${e.taskId ?? ''}`;
    const row = rows.get(key) ?? { taskId: e.taskId, taskTitle: e.taskTitle ?? 'Project time', projectId: e.projectId, projectName: e.projectName, minutes: Array(7).fill(0), total: 0, billable: 0 };
    const i = days.indexOf(e.workDate);
    row.minutes[i] = (row.minutes[i] ?? 0) + e.minutes;
    row.total += e.minutes;
    if (e.billable) row.billable += e.minutes;
    rows.set(key, row);
    dayTotals[i] = (dayTotals[i] ?? 0) + e.minutes;
    if (e.billable) billable += e.minutes;
    if (e.source === 'timer') fromTimer += e.minutes;
  }
  const total = dayTotals.reduce((a, b) => a + b, 0);
  return {
    id: sheet?.id ?? null,
    user: person!,
    weekStart: start,
    days,
    status: sheet?.status ?? 'draft',
    decidedByName: sheet?.decidedByName ?? null,
    decisionNote: sheet?.decisionNote ?? null,
    rows: [...rows.values()].sort((a, b) => a.projectName.localeCompare(b.projectName) || a.taskTitle.localeCompare(b.taskTitle)),
    dayTotals,
    total,
    billable,
    fromTimer,
    manual: total - fromTimer,
  };
}
