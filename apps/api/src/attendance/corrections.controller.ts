import { BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, HttpCode, NotFoundException, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { correctionSchema, decisionSchema, hasRole, type CorrectionDto, type CorrectionInput, type DecisionInput } from '@workhub/shared';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { audit } from '../audit/audit';
import { AuthContext, ClientIp, CurrentAuth, CurrentWorkspace, MinRole, WorkspaceContext } from '../common/request';
import { readableDate } from '../common/dates';
import { ZodPipe } from '../common/zod.pipe';
import { DbService, Tx } from '../db/db.service';
import { attendanceCorrections, attendanceEvents, memberships, users } from '../db/schema';
import { canDecide } from '../leave/leave.controller';
import { notify, notifyRoles } from '../notifications/notify';
import { WorkspaceGuard } from '../workspaces/workspace.guard';
import { eventsForDays, lockDay, peopleAttendance, workspaceInfo, type WorkspaceInfo } from './attendance';
import { addDays, zonedParts, zonedTime } from './zoned';

type CorrectionRow = typeof attendanceCorrections.$inferSelect;

/**
 * Replaces a day's check-in and check-out with the corrected times. The replaced
 * events stay in the database (voided) and are copied into the audit log.
 */
export async function applyCorrection(tx: Tx, info: WorkspaceInfo, c: CorrectionRow, actorUserId: string, ip?: string) {
  const person = (await peopleAttendance(tx, info.id, [c.userId])).get(c.userId);
  const day = await lockDay(tx, info, c.userId, c.workDate, person?.shift ?? null);
  const events = (await eventsForDays(tx, [day.id])).get(day.id) ?? [];
  // Punches go; breaks inside the corrected hours stay.
  const replaced = events.filter((e) => e.type === 'check_in' || e.type === 'check_out' || e.occurredAt < c.checkInAt || e.occurredAt > c.checkOutAt);
  if (replaced.length > 0) {
    await tx
      .update(attendanceEvents)
      .set({ voidedAt: new Date(), voidedBy: c.id })
      .where(inArray(attendanceEvents.id, replaced.map((e) => e.id)));
  }
  await tx.insert(attendanceEvents).values([
    { workspaceId: info.id, dayId: day.id, userId: c.userId, type: 'check_in', occurredAt: c.checkInAt, flags: ['corrected'], userAgent: 'correction' },
    { workspaceId: info.id, dayId: day.id, userId: c.userId, type: 'check_out', occurredAt: c.checkOutAt, flags: ['corrected'], userAgent: 'correction' },
  ]);
  await audit(tx, {
    workspaceId: info.id,
    actorUserId,
    action: 'attendance.corrected',
    entityType: 'attendance_day',
    entityId: day.id,
    metadata: {
      correctionId: c.id,
      userId: c.userId,
      date: c.workDate,
      reason: c.reason,
      new: { checkInAt: c.checkInAt.toISOString(), checkOutAt: c.checkOutAt.toISOString() },
      // The record as it was, so nothing is lost.
      original: replaced.map((e) => ({ type: e.type, occurredAt: e.occurredAt.toISOString(), flags: e.flags, ip: e.ip, breakName: e.breakName })),
    },
    ip,
  });
}

@Controller('attendance/corrections')
@UseGuards(WorkspaceGuard)
@MinRole('member')
export class CorrectionsController {
  constructor(private readonly db: DbService) {}

  /**
   * Ask for a day to be corrected, or (managers, for someone else) correct it outright.
   */
  @Post()
  create(@Body(new ZodPipe(correctionSchema)) body: CorrectionInput, @CurrentAuth() auth: AuthContext, @CurrentWorkspace() ws: WorkspaceContext, @ClientIp() ip?: string): Promise<CorrectionDto> {
    return this.db.withContext({ workspaceId: ws.id, userId: auth.userId }, async (tx) => {
      const info = await workspaceInfo(tx, ws.id);
      const userId = body.userId ?? auth.userId;
      const direct = userId !== auth.userId || ws.role === 'owner';
      if (userId !== auth.userId && !hasRole(ws.role, 'manager')) throw new ForbiddenException('Only managers can correct someone else’s attendance.');
      if (direct && !canDecide(ws, auth.userId, userId)) throw new ForbiddenException('Someone else has to approve your own correction.');
      const [member] = await tx.select({ id: memberships.id }).from(memberships).where(and(eq(memberships.workspaceId, ws.id), eq(memberships.userId, userId)));
      if (!member) throw new BadRequestException('That person isn’t in this workspace');

      const now = new Date();
      const checkIn = new Date(body.checkInAt);
      const checkOut = new Date(body.checkOutAt);
      if (body.date > zonedParts(now, info.timezone).date || checkOut > now) throw new BadRequestException('You can only correct days that have happened.');
      // The times must belong to that workday (night shifts run into the next morning).
      const earliest = zonedTime(body.date, 0, info.timezone).getTime() - 12 * 3600_000;
      const latest = zonedTime(addDays(body.date, 1), 0, info.timezone).getTime() + 12 * 3600_000;
      if (checkIn.getTime() < earliest || checkOut.getTime() > latest) throw new BadRequestException('Those times don’t belong to that day.');
      const [open] = await tx
        .select({ id: attendanceCorrections.id })
        .from(attendanceCorrections)
        .where(and(eq(attendanceCorrections.workspaceId, ws.id), eq(attendanceCorrections.userId, userId), eq(attendanceCorrections.workDate, body.date), eq(attendanceCorrections.status, 'pending')));
      if (open) throw new ConflictException('There’s already a correction waiting for that day.');

      const [row] = await tx
        .insert(attendanceCorrections)
        .values({
          workspaceId: ws.id,
          userId,
          workDate: body.date,
          checkInAt: checkIn,
          checkOutAt: checkOut,
          reason: body.reason,
          requestedBy: auth.userId,
          ...(direct ? { status: 'approved' as const, decidedBy: auth.userId, decidedAt: now } : {}),
        })
        .returning();
      if (direct) {
        await applyCorrection(tx, info, row!, auth.userId, ip);
        if (userId !== auth.userId) {
          await notify(tx, ws.id, [userId], { type: 'attendance.corrected', title: `Your attendance for ${readableDate(body.date)} was corrected`, body: body.reason, link: '/app/attendance' });
        }
      } else {
        const [me] = await tx.select({ name: users.name }).from(users).where(eq(users.id, auth.userId));
        await notifyRoles(tx, ws.id, ['owner', 'admin', 'manager'], { type: 'attendance.correction_requested', title: `${me!.name} asked to correct ${readableDate(body.date)}`, body: body.reason, link: '/app/attendance/team' }, auth.userId);
      }
      return (await this.dtos(tx, ws.id, eq(attendanceCorrections.id, row!.id)))[0]!;
    });
  }

  /** Managers see everyone's; others see their own. */
  @Get()
  list(@Query('status') status: string | undefined, @CurrentAuth() auth: AuthContext, @CurrentWorkspace() ws: WorkspaceContext): Promise<CorrectionDto[]> {
    return this.db.withContext({ workspaceId: ws.id, userId: auth.userId }, (tx) =>
      this.dtos(
        tx,
        ws.id,
        and(
          hasRole(ws.role, 'manager') ? undefined : eq(attendanceCorrections.userId, auth.userId),
          status === 'pending' || status === 'approved' || status === 'rejected' || status === 'cancelled' ? eq(attendanceCorrections.status, status) : undefined,
        ),
      ),
    );
  }

  @Post(':id/approve')
  @MinRole('manager')
  @HttpCode(200)
  approve(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(decisionSchema)) body: DecisionInput, @CurrentAuth() auth: AuthContext, @CurrentWorkspace() ws: WorkspaceContext, @ClientIp() ip?: string) {
    return this.decide(id, 'approved', body, auth, ws, ip);
  }

  @Post(':id/reject')
  @MinRole('manager')
  @HttpCode(200)
  reject(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(decisionSchema)) body: DecisionInput, @CurrentAuth() auth: AuthContext, @CurrentWorkspace() ws: WorkspaceContext, @ClientIp() ip?: string) {
    return this.decide(id, 'rejected', body, auth, ws, ip);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  cancel(@Param('id', ParseUUIDPipe) id: string, @CurrentAuth() auth: AuthContext, @CurrentWorkspace() ws: WorkspaceContext): Promise<CorrectionDto> {
    return this.db.withContext({ workspaceId: ws.id, userId: auth.userId }, async (tx) => {
      const c = await this.row(tx, ws.id, id);
      if (c.userId !== auth.userId) throw new ForbiddenException('You can only cancel your own request');
      if (c.status !== 'pending') throw new ConflictException('This request is already closed.');
      await tx.update(attendanceCorrections).set({ status: 'cancelled' }).where(eq(attendanceCorrections.id, id));
      return (await this.dtos(tx, ws.id, eq(attendanceCorrections.id, id)))[0]!;
    });
  }

  private decide(id: string, status: 'approved' | 'rejected', body: DecisionInput, auth: AuthContext, ws: WorkspaceContext, ip?: string): Promise<CorrectionDto> {
    return this.db.withContext({ workspaceId: ws.id, userId: auth.userId }, async (tx) => {
      const c = await this.row(tx, ws.id, id);
      if (!canDecide(ws, auth.userId, c.userId)) throw new ForbiddenException('Someone else has to approve your own correction.');
      if (c.status !== 'pending') throw new ConflictException('This request has already been decided.');
      const [updated] = await tx
        .update(attendanceCorrections)
        .set({ status, decidedBy: auth.userId, decidedAt: new Date(), decisionNote: body.note || null })
        .where(eq(attendanceCorrections.id, id))
        .returning();
      if (status === 'approved') await applyCorrection(tx, await workspaceInfo(tx, ws.id), updated!, auth.userId, ip);
      else await audit(tx, { workspaceId: ws.id, actorUserId: auth.userId, action: 'attendance.correction_rejected', entityType: 'attendance_correction', entityId: id, metadata: { note: body.note }, ip });
      await notify(tx, ws.id, [c.userId], { type: `attendance.correction_${status}`, title: `Your correction for ${readableDate(c.workDate)} was ${status}`, body: body.note, link: '/app/attendance' });
      return (await this.dtos(tx, ws.id, eq(attendanceCorrections.id, id)))[0]!;
    });
  }

  private async row(tx: Tx, workspaceId: string, id: string) {
    const [c] = await tx.select().from(attendanceCorrections).where(and(eq(attendanceCorrections.id, id), eq(attendanceCorrections.workspaceId, workspaceId)));
    if (!c) throw new NotFoundException('Correction not found');
    return c;
  }

  private async dtos(tx: Tx, workspaceId: string, where: ReturnType<typeof and> | undefined): Promise<CorrectionDto[]> {
    const rows = await tx
      .select({
        c: attendanceCorrections,
        name: users.name,
        email: users.email,
        requestedByName: sql<string | null>`(select name from users x where x.id = ${attendanceCorrections.requestedBy})`,
        decidedByName: sql<string | null>`(select name from users x where x.id = ${attendanceCorrections.decidedBy})`,
      })
      .from(attendanceCorrections)
      .innerJoin(users, eq(users.id, attendanceCorrections.userId))
      .where(and(eq(attendanceCorrections.workspaceId, workspaceId), where))
      .orderBy(desc(attendanceCorrections.createdAt))
      .limit(200);
    return rows.map(({ c, name, email, requestedByName, decidedByName }) => ({
      id: c.id,
      user: { id: c.userId, name, email },
      date: c.workDate,
      checkInAt: c.checkInAt.toISOString(),
      checkOutAt: c.checkOutAt.toISOString(),
      reason: c.reason,
      status: c.status,
      requestedByName,
      decidedByName,
      decidedAt: c.decidedAt?.toISOString() ?? null,
      decisionNote: c.decisionNote,
      createdAt: c.createdAt.toISOString(),
    }));
  }
}
