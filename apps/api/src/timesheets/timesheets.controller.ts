import { BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, HttpCode, NotFoundException, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import {
  decisionSchema,
  submitTimesheetSchema,
  type DecisionInput,
  type TimerDto,
  type TimesheetDto,
  type TimesheetSummaryDto,
} from '@workhub/shared';
import { and, asc, eq, ne, sql } from 'drizzle-orm';
import { workspaceInfo } from '../attendance/attendance';
import { zonedParts } from '../attendance/zoned';
import { audit } from '../audit/audit';
import { AuthContext, ClientIp, CurrentAuth, CurrentWorkspace, MinRole, WorkspaceContext } from '../common/request';
import { readableDate } from '../common/dates';
import { ZodPipe } from '../common/zod.pipe';
import { DbService, Tx } from '../db/db.service';
import { memberships, projects, taskTimers, tasks, timeEntries, timesheets, users } from '../db/schema';
import { canDecide } from '../leave/leave.controller';
import { weekStart } from '../leave/leave-rules';
import { notify, notifyRoles } from '../notifications/notify';
import { checkBudget, loadTask, requireEdit } from '../projects/board';
import { RealtimeService } from '../realtime/realtime.service';
import { WorkspaceGuard } from '../workspaces/workspace.guard';
import { assertWeekOpen, buildTimesheet } from './timesheets';
import { Track } from '../analytics/track';

interface Stopped {
  loggedMinutes: number;
  taskId: string;
  projectId: string | null;
}

/** A running timer is cut off at this; anything longer was almost certainly forgotten. */
const MAX_TIMER_MINUTES = 12 * 60;

@Controller()
@UseGuards(WorkspaceGuard)
@MinRole('member')
export class TimesheetsController {
  constructor(
    private readonly db: DbService,
    private readonly realtime: RealtimeService,
  ) {}

  // ---- Timer ------------------------------------------------------------------------

  @Get('timer')
  timer(@CurrentAuth() auth: AuthContext, @CurrentWorkspace() ws: WorkspaceContext): Promise<TimerDto | null> {
    return this.db.withContext({ workspaceId: ws.id, userId: auth.userId }, (tx) => this.current(tx, ws.id, auth.userId));
  }

  /** Starts timing a task. A timer already running for another task is stopped and logged. */
  @Post('tasks/:id/timer/start')
  @HttpCode(200)
  async start(@Param('id', ParseUUIDPipe) id: string, @CurrentAuth() auth: AuthContext, @CurrentWorkspace() ws: WorkspaceContext): Promise<TimerDto> {
    requireEdit(ws);
    let stopped: Stopped | null = null;
    const timer = await this.db.withContext({ workspaceId: ws.id, userId: auth.userId }, async (tx) => {
      await loadTask(tx, ws, auth.userId, id);
      const running = await this.current(tx, ws.id, auth.userId);
      if (running?.taskId === id) return running;
      if (running) stopped = await this.stopRunning(tx, ws, auth.userId);
      await tx.insert(taskTimers).values({ workspaceId: ws.id, userId: auth.userId, taskId: id });
      return (await this.current(tx, ws.id, auth.userId))!;
    });
    this.announce(ws.id, stopped);
    return timer;
  }

  /** Stops the timer and logs the time (under a minute is discarded). */
  @Post('timer/stop')
  @HttpCode(200)
  async stop(@CurrentAuth() auth: AuthContext, @CurrentWorkspace() ws: WorkspaceContext): Promise<{ loggedMinutes: number; taskId: string } | null> {
    const ctx = { workspaceId: ws.id, userId: auth.userId };
    let stopped: Stopped | null;
    try {
      stopped = await this.db.withContext(ctx, (tx) => this.stopRunning(tx, ws, auth.userId));
    } catch (err) {
      // The week it ran in is locked: don't leave a timer that can never be stopped.
      if (!(err instanceof ConflictException)) throw err;
      await this.db.withContext(ctx, (tx) => tx.delete(taskTimers).where(and(eq(taskTimers.workspaceId, ws.id), eq(taskTimers.userId, auth.userId))));
      throw new ConflictException(`${err.message} The timer was stopped without logging its time.`);
    }
    this.announce(ws.id, stopped);
    return stopped && { loggedMinutes: stopped.loggedMinutes, taskId: stopped.taskId };
  }

  // ---- Timesheets -------------------------------------------------------------------

  @Get('timesheets/me')
  mine(@Query('week') week: string | undefined, @CurrentAuth() auth: AuthContext, @CurrentWorkspace() ws: WorkspaceContext): Promise<TimesheetDto> {
    return this.db.withContext({ workspaceId: ws.id, userId: auth.userId }, async (tx) => buildTimesheet(tx, ws.id, auth.userId, await this.weekDate(tx, ws.id, week)));
  }

  /** Everyone's week, for approvals. People who haven't submitted show as drafts. */
  @Get('timesheets')
  @MinRole('manager')
  team(@Query('week') week: string | undefined, @CurrentAuth() auth: AuthContext, @CurrentWorkspace() ws: WorkspaceContext): Promise<TimesheetSummaryDto[]> {
    return this.db.withContext({ workspaceId: ws.id, userId: auth.userId }, async (tx) => {
      const start = weekStart(await this.weekDate(tx, ws.id, week));
      const end = sql`(${start}::date + 6)`;
      const rows = await tx
        .select({
          id: users.id,
          name: users.name,
          email: users.email,
          timesheetId: timesheets.id,
          status: timesheets.status,
          total: sql<number>`coalesce((select sum(minutes) from time_entries t where t.workspace_id = ${ws.id} and t.user_id = ${users.id} and t.work_date between ${start}::date and ${end}), 0)::int`,
          billable: sql<number>`coalesce((select sum(minutes) from time_entries t where t.workspace_id = ${ws.id} and t.user_id = ${users.id} and t.billable and t.work_date between ${start}::date and ${end}), 0)::int`,
        })
        .from(memberships)
        .innerJoin(users, eq(users.id, memberships.userId))
        .leftJoin(timesheets, and(eq(timesheets.workspaceId, ws.id), eq(timesheets.userId, users.id), eq(timesheets.weekStart, start)))
        .where(and(eq(memberships.workspaceId, ws.id), ne(memberships.role, 'guest')))
        .orderBy(asc(users.name));
      return rows.map((r) => ({ user: { id: r.id, name: r.name, email: r.email }, timesheetId: r.timesheetId, status: r.status ?? 'draft', total: r.total, billable: r.billable }));
    });
  }

  @Get('timesheets/people/:userId')
  @MinRole('manager')
  person(@Param('userId', ParseUUIDPipe) userId: string, @Query('week') week: string | undefined, @CurrentAuth() auth: AuthContext, @CurrentWorkspace() ws: WorkspaceContext): Promise<TimesheetDto> {
    return this.db.withContext({ workspaceId: ws.id, userId: auth.userId }, async (tx) => {
      const [member] = await tx.select({ id: memberships.id }).from(memberships).where(and(eq(memberships.workspaceId, ws.id), eq(memberships.userId, userId)));
      if (!member) throw new NotFoundException('That person isn’t in this workspace');
      return buildTimesheet(tx, ws.id, userId, await this.weekDate(tx, ws.id, week));
    });
  }

  @Post('timesheets/submit')
  @Track('timesheet submitted')
  @HttpCode(200)
  submit(@Body(new ZodPipe(submitTimesheetSchema)) body: { weekStart: string }, @CurrentAuth() auth: AuthContext, @CurrentWorkspace() ws: WorkspaceContext): Promise<TimesheetDto> {
    return this.db.withContext({ workspaceId: ws.id, userId: auth.userId }, async (tx) => {
      const sheet = await buildTimesheet(tx, ws.id, auth.userId, body.weekStart);
      if (sheet.status === 'submitted' || sheet.status === 'approved') throw new ConflictException(`This week is already ${sheet.status}.`);
      if (sheet.total === 0) throw new BadRequestException('There’s no time logged this week.');
      const running = await this.current(tx, ws.id, auth.userId);
      if (running && weekStart(zonedParts(new Date(running.startedAt), (await workspaceInfo(tx, ws.id)).timezone).date) === sheet.weekStart) {
        throw new ConflictException('Stop your running timer first.');
      }
      await tx
        .insert(timesheets)
        .values({ workspaceId: ws.id, userId: auth.userId, weekStart: sheet.weekStart, status: 'submitted' })
        .onConflictDoUpdate({
          target: [timesheets.workspaceId, timesheets.userId, timesheets.weekStart],
          set: { status: 'submitted', submittedAt: new Date(), decidedBy: null, decidedAt: null, decisionNote: null },
        });
      const [me] = await tx.select({ name: users.name }).from(users).where(eq(users.id, auth.userId));
      await notifyRoles(
        tx,
        ws.id,
        ['owner', 'admin', 'manager'],
        { type: 'timesheet.submitted', title: `${me!.name} submitted a timesheet (${Math.round(sheet.total / 6) / 10}h)`, body: `Week of ${readableDate(sheet.weekStart)}`, link: `/app/timesheets/approvals?week=${sheet.weekStart}` },
        auth.userId,
      );
      return buildTimesheet(tx, ws.id, auth.userId, sheet.weekStart);
    });
  }

  @Post('timesheets/:id/approve')
  @MinRole('manager')
  @HttpCode(200)
  approve(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(decisionSchema)) body: DecisionInput, @CurrentAuth() auth: AuthContext, @CurrentWorkspace() ws: WorkspaceContext, @ClientIp() ip?: string) {
    return this.decide(id, 'approved', body, auth, ws, ip);
  }

  /** Sends a week back: it's editable again and can be resubmitted. */
  @Post('timesheets/:id/reject')
  @MinRole('manager')
  @HttpCode(200)
  reject(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(decisionSchema)) body: DecisionInput, @CurrentAuth() auth: AuthContext, @CurrentWorkspace() ws: WorkspaceContext, @ClientIp() ip?: string) {
    return this.decide(id, 'rejected', body, auth, ws, ip);
  }

  // ---- Internals --------------------------------------------------------------------

  private decide(id: string, status: 'approved' | 'rejected', body: DecisionInput, auth: AuthContext, ws: WorkspaceContext, ip?: string): Promise<TimesheetDto> {
    return this.db.withContext({ workspaceId: ws.id, userId: auth.userId }, async (tx) => {
      const [sheet] = await tx.select().from(timesheets).where(and(eq(timesheets.id, id), eq(timesheets.workspaceId, ws.id)));
      if (!sheet) throw new NotFoundException('Timesheet not found');
      if (!canDecide(ws, auth.userId, sheet.userId)) throw new ForbiddenException('Someone else has to approve your own timesheet.');
      if (sheet.status !== 'submitted') throw new ConflictException(`This timesheet is ${sheet.status}, not waiting for approval.`);
      await tx.update(timesheets).set({ status, decidedBy: auth.userId, decidedAt: new Date(), decisionNote: body.note || null }).where(eq(timesheets.id, id));
      await audit(tx, { workspaceId: ws.id, actorUserId: auth.userId, action: `timesheet.${status}`, entityType: 'timesheet', entityId: id, metadata: { userId: sheet.userId, weekStart: sheet.weekStart, note: body.note }, ip });
      await notify(tx, ws.id, [sheet.userId], {
        type: `timesheet.${status}`,
        title: `Your timesheet for the week of ${readableDate(sheet.weekStart)} was ${status === 'approved' ? 'approved' : 'sent back'}`,
        body: body.note,
        link: `/app/timesheets?week=${sheet.weekStart}`,
      });
      return buildTimesheet(tx, ws.id, sheet.userId, sheet.weekStart);
    });
  }

  private async current(tx: Tx, workspaceId: string, userId: string): Promise<TimerDto | null> {
    const [t] = await tx
      .select({ taskId: taskTimers.taskId, startedAt: taskTimers.startedAt, taskTitle: tasks.title, projectId: tasks.projectId, projectName: projects.name })
      .from(taskTimers)
      .innerJoin(tasks, eq(tasks.id, taskTimers.taskId))
      .innerJoin(projects, eq(projects.id, tasks.projectId))
      .where(and(eq(taskTimers.workspaceId, workspaceId), eq(taskTimers.userId, userId)));
    return t ? { ...t, startedAt: t.startedAt.toISOString() } : null;
  }

  /** Tells open boards the task's time changed, once the change is committed. */
  private announce(workspaceId: string, stopped: Stopped | null) {
    if (stopped?.projectId) this.realtime.publish(workspaceId, stopped.projectId, { type: 'task.changed', taskId: stopped.taskId });
  }

  private async stopRunning(tx: Tx, ws: WorkspaceContext, userId: string): Promise<Stopped | null> {
    const [t] = await tx.delete(taskTimers).where(and(eq(taskTimers.workspaceId, ws.id), eq(taskTimers.userId, userId))).returning();
    if (!t) return null;
    const minutes = Math.min(Math.floor((Date.now() - t.startedAt.getTime()) / 60_000), MAX_TIMER_MINUTES);
    if (minutes < 1) return { loggedMinutes: 0, taskId: t.taskId, projectId: null };
    const info = await workspaceInfo(tx, ws.id);
    const workDate = zonedParts(t.startedAt, info.timezone).date;
    await assertWeekOpen(tx, ws.id, userId, workDate);
    const [task] = await tx.select({ projectId: tasks.projectId }).from(tasks).where(eq(tasks.id, t.taskId));
    await tx.insert(timeEntries).values({ workspaceId: ws.id, projectId: task!.projectId, taskId: t.taskId, userId, workDate, minutes, source: 'timer', startedAt: t.startedAt, billable: true });
    await checkBudget(tx, ws.id, task!.projectId);
    return { loggedMinutes: minutes, taskId: t.taskId, projectId: task!.projectId };
  }

  private async weekDate(tx: Tx, workspaceId: string, week: string | undefined): Promise<string> {
    if (!week) return zonedParts(new Date(), (await workspaceInfo(tx, workspaceId)).timezone).date;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(week) || Number.isNaN(Date.parse(week))) throw new BadRequestException('Use week=YYYY-MM-DD');
    return week;
  }
}

