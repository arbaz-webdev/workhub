import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  decisionSchema,
  hasRole,
  holidaySchema,
  leaveAdjustmentSchema,
  leaveRequestSchema,
  leaveTypeSchema,
  type DecisionInput,
  type HalfDay,
  type HolidayDto,
  type HolidayInput,
  type LeaveAdjustmentInput,
  type LeaveBalanceDto,
  type LeaveCalendarDto,
  type LeaveRequestDto,
  type LeaveTypeDto,
  type MyLeaveDto,
} from '@workhub/shared';
import { and, asc, desc, eq, gte, inArray, isNull, lte, ne, sql } from 'drizzle-orm';
import type { z } from 'zod';
import { peopleAttendance, workspaceInfo, type WorkspaceInfo } from '../attendance/attendance';
import { holidayMap, leaveMap, workingDaysOf } from '../attendance/calendar';
import { addDays, zonedParts } from '../attendance/zoned';
import { audit } from '../audit/audit';
import { AuthContext, ClientIp, CurrentAuth, CurrentWorkspace, MinRole, WorkspaceContext } from '../common/request';
import { ZodPipe } from '../common/zod.pipe';
import { DbService, Tx } from '../db/db.service';
import { holidays, leaveAdjustments, leaveRequests, leaveTypes, memberships, users } from '../db/schema';
import { notify, notifyRoles } from '../notifications/notify';
import { WorkspaceGuard } from '../workspaces/workspace.guard';
import { pakistanHolidays, PRESET_YEARS } from './holidays-pk';
import { entitlement, leaveDates, sumDays } from './leave-rules';
import { Track } from '../analytics/track';

type LeaveTypeRow = typeof leaveTypes.$inferSelect;
type LeaveTypeValues = z.output<typeof leaveTypeSchema>;
type LeaveRequestValues = z.output<typeof leaveRequestSchema>;

/** Common Pakistani defaults; every workspace can change them. */
const DEFAULT_TYPES = [
  { name: 'Annual', paid: true, daysPerYear: '14', accrual: 'monthly', color: 'blue' },
  { name: 'Casual', paid: true, daysPerYear: '10', accrual: 'yearly', color: 'teal' },
  { name: 'Sick', paid: true, daysPerYear: '8', accrual: 'yearly', color: 'amber' },
  { name: 'Unpaid', paid: false, daysPerYear: null, accrual: 'yearly', color: 'gray' },
] as const;

function typeDto(t: LeaveTypeRow): LeaveTypeDto {
  return {
    id: t.id,
    name: t.name,
    paid: t.paid,
    daysPerYear: t.daysPerYear === null ? null : Number(t.daysPerYear),
    accrual: t.accrual,
    color: t.color as LeaveTypeDto['color'],
  };
}

function holidayDto(h: typeof holidays.$inferSelect): HolidayDto {
  return { id: h.id, date: h.date, name: h.name, kind: h.kind, estimated: h.estimated };
}

const APPROVERS = ['owner', 'admin', 'manager'] as const;

/** Managers decide others' requests; owners may also decide their own (nobody is above them). */
export function canDecide(ws: WorkspaceContext, decider: string, requester: string) {
  if (!hasRole(ws.role, 'manager')) return false;
  return decider !== requester || ws.role === 'owner';
}

@Controller()
@UseGuards(WorkspaceGuard)
@MinRole('member')
export class LeaveController {
  constructor(private readonly db: DbService) {}

  // ---- Holidays ---------------------------------------------------------------------

  @Get('holidays')
  listHolidays(@Query('year') year: string | undefined, @CurrentAuth() auth: AuthContext, @CurrentWorkspace() ws: WorkspaceContext): Promise<HolidayDto[]> {
    return this.db.withContext({ workspaceId: ws.id, userId: auth.userId }, async (tx) => {
      const y = year ? Number(year) : Number(zonedParts(new Date(), (await workspaceInfo(tx, ws.id)).timezone).date.slice(0, 4));
      if (!Number.isInteger(y) || y < 2000 || y > 2100) throw new BadRequestException('Use year=YYYY');
      const rows = await tx
        .select()
        .from(holidays)
        .where(and(eq(holidays.workspaceId, ws.id), gte(holidays.date, `${y}-01-01`), lte(holidays.date, `${y}-12-31`)))
        .orderBy(asc(holidays.date), asc(holidays.name));
      return rows.map(holidayDto);
    });
  }

  @Post('holidays')
  @MinRole('admin')
  createHoliday(
    @Body(new ZodPipe(holidaySchema)) body: HolidayInput,
    @CurrentAuth() auth: AuthContext,
    @CurrentWorkspace() ws: WorkspaceContext,
    @ClientIp() ip?: string,
  ): Promise<HolidayDto> {
    return this.db.withContext({ workspaceId: ws.id, userId: auth.userId }, async (tx) => {
      const [row] = await tx.insert(holidays).values({ workspaceId: ws.id, date: body.date, name: body.name, kind: 'company' }).returning();
      await audit(tx, { workspaceId: ws.id, actorUserId: auth.userId, action: 'holiday.created', entityType: 'holiday', entityId: row!.id, metadata: body, ip });
      return holidayDto(row!);
    });
  }

  /** Editing a date confirms it (an estimated Eid date once announced, say). */
  @Patch('holidays/:id')
  @MinRole('admin')
  updateHoliday(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(holidaySchema)) body: HolidayInput,
    @CurrentAuth() auth: AuthContext,
    @CurrentWorkspace() ws: WorkspaceContext,
    @ClientIp() ip?: string,
  ): Promise<HolidayDto> {
    return this.db.withContext({ workspaceId: ws.id, userId: auth.userId }, async (tx) => {
      const [row] = await tx
        .update(holidays)
        .set({ date: body.date, name: body.name, estimated: false })
        .where(and(eq(holidays.id, id), eq(holidays.workspaceId, ws.id)))
        .returning();
      if (!row) throw new NotFoundException('Holiday not found');
      await audit(tx, { workspaceId: ws.id, actorUserId: auth.userId, action: 'holiday.updated', entityType: 'holiday', entityId: id, metadata: body, ip });
      return holidayDto(row);
    });
  }

  @Delete('holidays/:id')
  @MinRole('admin')
  @HttpCode(204)
  async deleteHoliday(@Param('id', ParseUUIDPipe) id: string, @CurrentAuth() auth: AuthContext, @CurrentWorkspace() ws: WorkspaceContext, @ClientIp() ip?: string) {
    await this.db.withContext({ workspaceId: ws.id, userId: auth.userId }, async (tx) => {
      const [row] = await tx.delete(holidays).where(and(eq(holidays.id, id), eq(holidays.workspaceId, ws.id))).returning({ name: holidays.name, date: holidays.date });
      if (!row) throw new NotFoundException('Holiday not found');
      await audit(tx, { workspaceId: ws.id, actorUserId: auth.userId, action: 'holiday.deleted', entityType: 'holiday', entityId: id, metadata: row, ip });
    });
  }

  /** Adds Pakistan's public holidays for a year. Safe to run again; edits are kept. */
  @Post('holidays/load-pakistan')
  @MinRole('admin')
  loadPakistan(@Body() body: { year?: unknown }, @CurrentAuth() auth: AuthContext, @CurrentWorkspace() ws: WorkspaceContext, @ClientIp() ip?: string): Promise<HolidayDto[]> {
    const year = Number(body?.year);
    if (!Number.isInteger(year) || year < 2000 || year > 2100) throw new BadRequestException('Choose a year');
    return this.db.withContext({ workspaceId: ws.id, userId: auth.userId }, async (tx) => {
      const presets = pakistanHolidays(year);
      await tx
        .insert(holidays)
        .values(presets.map((p) => ({ workspaceId: ws.id, date: p.date, name: p.name, kind: 'public' as const, estimated: p.estimated, presetKey: p.key })))
        .onConflictDoNothing({ target: [holidays.workspaceId, holidays.presetKey] });
      await audit(tx, {
        workspaceId: ws.id,
        actorUserId: auth.userId,
        action: 'holiday.loaded_pakistan',
        entityType: 'workspace',
        entityId: ws.id,
        metadata: { year, islamicDatesIncluded: PRESET_YEARS.includes(year) },
        ip,
      });
      const rows = await tx
        .select()
        .from(holidays)
        .where(and(eq(holidays.workspaceId, ws.id), gte(holidays.date, `${year}-01-01`), lte(holidays.date, `${year}-12-31`)))
        .orderBy(asc(holidays.date));
      return rows.map(holidayDto);
    });
  }

  // ---- Leave types ------------------------------------------------------------------

  @Get('leave/types')
  types(@CurrentAuth() auth: AuthContext, @CurrentWorkspace() ws: WorkspaceContext): Promise<LeaveTypeDto[]> {
    return this.db.withContext({ workspaceId: ws.id, userId: auth.userId }, async (tx) => (await this.ensureTypes(tx, ws.id)).map(typeDto));
  }

  @Post('leave/types')
  @MinRole('admin')
  createType(@Body(new ZodPipe(leaveTypeSchema)) body: LeaveTypeValues, @CurrentAuth() auth: AuthContext, @CurrentWorkspace() ws: WorkspaceContext, @ClientIp() ip?: string): Promise<LeaveTypeDto> {
    return this.db.withContext({ workspaceId: ws.id, userId: auth.userId }, async (tx) => {
      await this.ensureTypes(tx, ws.id);
      await this.uniqueName(tx, ws.id, body.name);
      const [row] = await tx
        .insert(leaveTypes)
        .values({ workspaceId: ws.id, ...body, daysPerYear: body.daysPerYear === null ? null : String(body.daysPerYear) })
        .returning();
      await audit(tx, { workspaceId: ws.id, actorUserId: auth.userId, action: 'leave_type.created', entityType: 'leave_type', entityId: row!.id, metadata: body, ip });
      return typeDto(row!);
    });
  }

  @Patch('leave/types/:id')
  @MinRole('admin')
  updateType(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(leaveTypeSchema)) body: LeaveTypeValues,
    @CurrentAuth() auth: AuthContext,
    @CurrentWorkspace() ws: WorkspaceContext,
    @ClientIp() ip?: string,
  ): Promise<LeaveTypeDto> {
    return this.db.withContext({ workspaceId: ws.id, userId: auth.userId }, async (tx) => {
      await this.uniqueName(tx, ws.id, body.name, id);
      const [row] = await tx
        .update(leaveTypes)
        .set({ ...body, daysPerYear: body.daysPerYear === null ? null : String(body.daysPerYear) })
        .where(and(eq(leaveTypes.id, id), eq(leaveTypes.workspaceId, ws.id), isNull(leaveTypes.archivedAt)))
        .returning();
      if (!row) throw new NotFoundException('Leave type not found');
      await audit(tx, { workspaceId: ws.id, actorUserId: auth.userId, action: 'leave_type.updated', entityType: 'leave_type', entityId: id, metadata: body, ip });
      return typeDto(row);
    });
  }

  /** Archived, not deleted: past requests still refer to it. */
  @Delete('leave/types/:id')
  @MinRole('admin')
  @HttpCode(204)
  async archiveType(@Param('id', ParseUUIDPipe) id: string, @CurrentAuth() auth: AuthContext, @CurrentWorkspace() ws: WorkspaceContext, @ClientIp() ip?: string) {
    await this.db.withContext({ workspaceId: ws.id, userId: auth.userId }, async (tx) => {
      const [row] = await tx
        .update(leaveTypes)
        .set({ archivedAt: new Date() })
        .where(and(eq(leaveTypes.id, id), eq(leaveTypes.workspaceId, ws.id), isNull(leaveTypes.archivedAt)))
        .returning({ name: leaveTypes.name });
      if (!row) throw new NotFoundException('Leave type not found');
      await audit(tx, { workspaceId: ws.id, actorUserId: auth.userId, action: 'leave_type.archived', entityType: 'leave_type', entityId: id, metadata: row, ip });
    });
  }

  // ---- My leave ---------------------------------------------------------------------

  @Get('leave/me')
  me(@Query('year') year: string | undefined, @CurrentAuth() auth: AuthContext, @CurrentWorkspace() ws: WorkspaceContext): Promise<MyLeaveDto> {
    return this.db.withContext({ workspaceId: ws.id, userId: auth.userId }, async (tx) => {
      const info = await workspaceInfo(tx, ws.id);
      const y = year ? Number(year) : Number(zonedParts(new Date(), info.timezone).date.slice(0, 4));
      if (!Number.isInteger(y) || y < 2000 || y > 2100) throw new BadRequestException('Use year=YYYY');
      const balances = await this.balances(tx, info, auth.userId, y);
      const rows = await this.requestRows(tx, ws.id, and(eq(leaveRequests.userId, auth.userId), gte(leaveRequests.startDate, `${y}-01-01`), lte(leaveRequests.startDate, `${y}-12-31`)));
      return { year: y, balances, requests: rows.map((r) => this.requestDto(r, true)) };
    });
  }

  /** How many days a request would take, before sending it. */
  @Get('leave/preview')
  preview(
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
    @Query('halfDay') halfDay: string | undefined,
    @CurrentAuth() auth: AuthContext,
    @CurrentWorkspace() ws: WorkspaceContext,
  ): Promise<{ days: number; dates: string[] }> {
    const parsed = leaveRequestSchema.safeParse({ leaveTypeId: '00000000-0000-0000-0000-000000000000', startDate, endDate, halfDay: halfDay ?? 'none' });
    if (!parsed.success) throw new BadRequestException(parsed.error.issues[0]?.message ?? 'Check the dates');
    return this.db.withContext({ workspaceId: ws.id, userId: auth.userId }, async (tx) => {
      const dates = await this.takenDates(tx, await workspaceInfo(tx, ws.id), auth.userId, parsed.data.startDate, parsed.data.endDate, parsed.data.halfDay);
      return { days: sumDays(dates), dates: dates.map((d) => d.date) };
    });
  }

  @Post('leave/requests')
  @Track('leave requested')
  request(
    @Body(new ZodPipe(leaveRequestSchema)) body: LeaveRequestValues,
    @CurrentAuth() auth: AuthContext,
    @CurrentWorkspace() ws: WorkspaceContext,
  ): Promise<LeaveRequestDto> {
    return this.db.withContext({ workspaceId: ws.id, userId: auth.userId }, async (tx) => {
      const info = await workspaceInfo(tx, ws.id);
      const type = await this.activeType(tx, ws.id, body.leaveTypeId);
      const dates = await this.takenDates(tx, info, auth.userId, body.startDate, body.endDate, body.halfDay);
      const days = sumDays(dates);
      if (days === 0) throw new BadRequestException('Those dates are all days off or holidays, so no leave is needed.');
      await this.noOverlap(tx, ws.id, auth.userId, body.startDate, body.endDate);
      await this.checkBalance(tx, info, auth.userId, type, Number(body.startDate.slice(0, 4)), days);
      const [row] = await tx
        .insert(leaveRequests)
        .values({ workspaceId: ws.id, userId: auth.userId, leaveTypeId: type.id, startDate: body.startDate, endDate: body.endDate, halfDay: body.halfDay, days: String(days), reason: body.reason || null })
        .returning({ id: leaveRequests.id });
      const [me] = await tx.select({ name: users.name }).from(users).where(eq(users.id, auth.userId));
      await notifyRoles(
        tx,
        ws.id,
        [...APPROVERS],
        { type: 'leave.requested', title: `${me!.name} asked for ${days} ${days === 1 ? 'day' : 'days'} of ${type.name.toLowerCase()} leave`, body: rangeText(body.startDate, body.endDate), link: '/app/leave/approvals' },
        auth.userId,
      );
      return this.requestDto((await this.requestRows(tx, ws.id, eq(leaveRequests.id, row!.id)))[0]!, true);
    });
  }

  /** Withdraw a request that's pending, or approved and not yet started. */
  @Post('leave/requests/:id/cancel')
  @HttpCode(200)
  cancel(@Param('id', ParseUUIDPipe) id: string, @CurrentAuth() auth: AuthContext, @CurrentWorkspace() ws: WorkspaceContext): Promise<LeaveRequestDto> {
    return this.db.withContext({ workspaceId: ws.id, userId: auth.userId }, async (tx) => {
      const r = await this.requestRow(tx, ws.id, id);
      if (r.userId !== auth.userId) throw new ForbiddenException('You can only cancel your own leave');
      const today = zonedParts(new Date(), (await workspaceInfo(tx, ws.id)).timezone).date;
      if (r.status === 'approved' ? r.startDate <= today : r.status !== 'pending') {
        throw new ConflictException(r.status === 'approved' ? 'Leave that has started can’t be cancelled; ask your manager.' : 'This request is already closed.');
      }
      await tx.update(leaveRequests).set({ status: 'cancelled' }).where(eq(leaveRequests.id, id));
      return this.requestDto((await this.requestRows(tx, ws.id, eq(leaveRequests.id, id)))[0]!, true);
    });
  }

  // ---- Approvals --------------------------------------------------------------------

  @Get('leave/requests')
  @MinRole('manager')
  list(@Query('status') status: string | undefined, @CurrentAuth() auth: AuthContext, @CurrentWorkspace() ws: WorkspaceContext): Promise<LeaveRequestDto[]> {
    return this.db.withContext({ workspaceId: ws.id, userId: auth.userId }, async (tx) => {
      const filter = status === 'pending' || status === 'approved' || status === 'rejected' || status === 'cancelled' ? eq(leaveRequests.status, status) : undefined;
      const rows = await this.requestRows(tx, ws.id, filter, 200);
      return rows.map((r) => this.requestDto(r, true));
    });
  }

  @Post('leave/requests/:id/approve')
  @MinRole('manager')
  @HttpCode(200)
  approve(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(decisionSchema)) body: DecisionInput, @CurrentAuth() auth: AuthContext, @CurrentWorkspace() ws: WorkspaceContext, @ClientIp() ip?: string) {
    return this.decide(id, 'approved', body, auth, ws, ip);
  }

  @Post('leave/requests/:id/reject')
  @MinRole('manager')
  @HttpCode(200)
  reject(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(decisionSchema)) body: DecisionInput, @CurrentAuth() auth: AuthContext, @CurrentWorkspace() ws: WorkspaceContext, @ClientIp() ip?: string) {
    return this.decide(id, 'rejected', body, auth, ws, ip);
  }

  /** Who's away when: approved and pending leave for everyone, without reasons. */
  @Get('leave/calendar')
  calendar(@Query('month') month: string | undefined, @CurrentAuth() auth: AuthContext, @CurrentWorkspace() ws: WorkspaceContext): Promise<LeaveCalendarDto> {
    return this.db.withContext({ workspaceId: ws.id, userId: auth.userId }, async (tx) => {
      const info = await workspaceInfo(tx, ws.id);
      const m = month ?? zonedParts(new Date(), info.timezone).date.slice(0, 7);
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(m)) throw new BadRequestException('Use month=YYYY-MM');
      const from = `${m}-01`;
      const to = addDays(`${addDays(from, 32).slice(0, 7)}-01`, -1);
      const people = await peopleAttendance(tx, ws.id);
      const names = await tx
        .select({ userId: users.id, name: users.name })
        .from(memberships)
        .innerJoin(users, eq(users.id, memberships.userId))
        .where(and(eq(memberships.workspaceId, ws.id), ne(memberships.role, 'guest')))
        .orderBy(asc(users.name));
      const holidayNames = await holidayMap(tx, ws.id, from, to);
      const leave = await leaveMap(tx, info, people, from, to, holidayNames, ['approved', 'pending']);
      const holidayRows = await tx
        .select()
        .from(holidays)
        .where(and(eq(holidays.workspaceId, ws.id), gte(holidays.date, from), lte(holidays.date, to)))
        .orderBy(asc(holidays.date));
      return {
        month: m,
        holidays: holidayRows.map(holidayDto),
        people: names.map((p) => ({
          userId: p.userId,
          name: p.name,
          entries: [...(leave.get(p.userId)?.entries() ?? [])].map(([date, l]) => ({ date, typeName: l.typeName, color: l.color, status: l.status, fraction: l.fraction })),
        })),
      };
    });
  }

  /** Manual changes to someone's balance: carry-over, leave taken before joining… */
  @Post('leave/adjustments')
  @MinRole('admin')
  async adjust(@Body(new ZodPipe(leaveAdjustmentSchema)) body: LeaveAdjustmentInput, @CurrentAuth() auth: AuthContext, @CurrentWorkspace() ws: WorkspaceContext, @ClientIp() ip?: string): Promise<LeaveBalanceDto[]> {
    return this.db.withContext({ workspaceId: ws.id, userId: auth.userId }, async (tx) => {
      const [member] = await tx.select({ id: memberships.id }).from(memberships).where(and(eq(memberships.workspaceId, ws.id), eq(memberships.userId, body.userId)));
      if (!member) throw new BadRequestException('That person isn’t in this workspace');
      await this.activeType(tx, ws.id, body.leaveTypeId);
      await tx.insert(leaveAdjustments).values({ workspaceId: ws.id, userId: body.userId, leaveTypeId: body.leaveTypeId, year: body.year, days: String(body.days), reason: body.reason, createdBy: auth.userId });
      await audit(tx, { workspaceId: ws.id, actorUserId: auth.userId, action: 'leave.adjusted', entityType: 'user', entityId: body.userId, metadata: body, ip });
      return this.balances(tx, await workspaceInfo(tx, ws.id), body.userId, body.year);
    });
  }

  /** Anyone's balances, for managers. */
  @Get('leave/balances/:userId')
  @MinRole('manager')
  balancesOf(@Param('userId', ParseUUIDPipe) userId: string, @Query('year') year: string | undefined, @CurrentAuth() auth: AuthContext, @CurrentWorkspace() ws: WorkspaceContext) {
    return this.db.withContext({ workspaceId: ws.id, userId: auth.userId }, async (tx) => {
      const info = await workspaceInfo(tx, ws.id);
      const y = year ? Number(year) : Number(zonedParts(new Date(), info.timezone).date.slice(0, 4));
      return this.balances(tx, info, userId, y);
    });
  }

  // ---- Internals --------------------------------------------------------------------

  private async decide(id: string, status: 'approved' | 'rejected', body: DecisionInput, auth: AuthContext, ws: WorkspaceContext, ip?: string): Promise<LeaveRequestDto> {
    return this.db.withContext({ workspaceId: ws.id, userId: auth.userId }, async (tx) => {
      const r = await this.requestRow(tx, ws.id, id);
      if (!canDecide(ws, auth.userId, r.userId)) throw new ForbiddenException('Someone else has to approve your own leave.');
      if (r.status !== 'pending') throw new ConflictException('This request has already been decided.');
      if (status === 'approved') {
        // Things may have changed since it was asked for.
        const info = await workspaceInfo(tx, ws.id);
        await this.noOverlap(tx, ws.id, r.userId, r.startDate, r.endDate, id);
        const type = await this.activeType(tx, ws.id, r.leaveTypeId);
        await this.checkBalance(tx, info, r.userId, type, Number(r.startDate.slice(0, 4)), Number(r.days), id);
      }
      await tx.update(leaveRequests).set({ status, decidedBy: auth.userId, decidedAt: new Date(), decisionNote: body.note || null }).where(eq(leaveRequests.id, id));
      await audit(tx, { workspaceId: ws.id, actorUserId: auth.userId, action: `leave.${status}`, entityType: 'leave_request', entityId: id, metadata: { userId: r.userId, startDate: r.startDate, endDate: r.endDate, days: r.days, note: body.note }, ip });
      await notify(tx, ws.id, [r.userId], {
        type: `leave.${status}`,
        title: `Your leave ${rangeText(r.startDate, r.endDate)} was ${status}`,
        body: body.note,
        link: '/app/leave',
      });
      return this.requestDto((await this.requestRows(tx, ws.id, eq(leaveRequests.id, id)))[0]!, true);
    });
  }

  /** Creates the default leave types the first time they're needed. */
  private async ensureTypes(tx: Tx, workspaceId: string): Promise<LeaveTypeRow[]> {
    const existing = await tx.select().from(leaveTypes).where(eq(leaveTypes.workspaceId, workspaceId));
    if (existing.length === 0) {
      await tx.insert(leaveTypes).values(DEFAULT_TYPES.map((t) => ({ workspaceId, ...t })));
    }
    return tx
      .select()
      .from(leaveTypes)
      .where(and(eq(leaveTypes.workspaceId, workspaceId), isNull(leaveTypes.archivedAt)))
      .orderBy(asc(leaveTypes.createdAt), asc(leaveTypes.name));
  }

  private async uniqueName(tx: Tx, workspaceId: string, name: string, exceptId?: string) {
    const [clash] = await tx
      .select({ id: leaveTypes.id })
      .from(leaveTypes)
      .where(and(eq(leaveTypes.workspaceId, workspaceId), isNull(leaveTypes.archivedAt), sql`lower(${leaveTypes.name}) = lower(${name})`, exceptId ? ne(leaveTypes.id, exceptId) : undefined));
    if (clash) throw new ConflictException('There’s already a leave type with that name');
  }

  private async activeType(tx: Tx, workspaceId: string, id: string): Promise<LeaveTypeRow> {
    const [t] = await tx.select().from(leaveTypes).where(and(eq(leaveTypes.id, id), eq(leaveTypes.workspaceId, workspaceId), isNull(leaveTypes.archivedAt)));
    if (!t) throw new BadRequestException('Unknown leave type');
    return t;
  }

  /** The dates a request takes for this person: their working days, minus holidays. */
  private async takenDates(tx: Tx, info: WorkspaceInfo, userId: string, start: string, end: string, halfDay: HalfDay) {
    const person = (await peopleAttendance(tx, info.id, [userId])).get(userId);
    const holidayNames = await holidayMap(tx, info.id, start, end);
    return leaveDates(start, end, halfDay, workingDaysOf(person, info), new Set(holidayNames.keys()));
  }

  private async noOverlap(tx: Tx, workspaceId: string, userId: string, start: string, end: string, exceptId?: string) {
    const [clash] = await tx
      .select({ id: leaveRequests.id })
      .from(leaveRequests)
      .where(
        and(
          eq(leaveRequests.workspaceId, workspaceId),
          eq(leaveRequests.userId, userId),
          inArray(leaveRequests.status, ['pending', 'approved']),
          lte(leaveRequests.startDate, end),
          gte(leaveRequests.endDate, start),
          exceptId ? ne(leaveRequests.id, exceptId) : undefined,
        ),
      );
    if (clash) throw new ConflictException('You already have leave requested for some of those days.');
  }

  private async checkBalance(tx: Tx, info: WorkspaceInfo, userId: string, type: LeaveTypeRow, year: number, days: number, exceptId?: string) {
    if (type.daysPerYear === null) return;
    const [b] = await this.balances(tx, info, userId, year, [type], exceptId);
    if (b!.available !== null && days > b!.available) {
      throw new BadRequestException(`Not enough ${type.name.toLowerCase()} leave: ${days} requested, ${b!.available} available.`);
    }
  }

  private async balances(tx: Tx, info: WorkspaceInfo, userId: string, year: number, onlyTypes?: LeaveTypeRow[], exceptId?: string): Promise<LeaveBalanceDto[]> {
    const types = onlyTypes ?? (await this.ensureTypes(tx, info.id));
    const [member] = await tx.select({ joinedAt: memberships.createdAt }).from(memberships).where(and(eq(memberships.workspaceId, info.id), eq(memberships.userId, userId)));
    const joined = member ? zonedParts(member.joinedAt, info.timezone).date : `${year}-01-01`;
    const today = zonedParts(new Date(), info.timezone).date;
    const used = await tx
      .select({ typeId: leaveRequests.leaveTypeId, status: leaveRequests.status, days: sql<string>`sum(${leaveRequests.days})` })
      .from(leaveRequests)
      .where(
        and(
          eq(leaveRequests.workspaceId, info.id),
          eq(leaveRequests.userId, userId),
          inArray(leaveRequests.status, ['pending', 'approved']),
          gte(leaveRequests.startDate, `${year}-01-01`),
          lte(leaveRequests.startDate, `${year}-12-31`),
          exceptId ? ne(leaveRequests.id, exceptId) : undefined,
        ),
      )
      .groupBy(leaveRequests.leaveTypeId, leaveRequests.status);
    const adjustments = await tx
      .select({ typeId: leaveAdjustments.leaveTypeId, days: sql<string>`sum(${leaveAdjustments.days})` })
      .from(leaveAdjustments)
      .where(and(eq(leaveAdjustments.workspaceId, info.id), eq(leaveAdjustments.userId, userId), eq(leaveAdjustments.year, year)))
      .groupBy(leaveAdjustments.leaveTypeId);
    return types.map((t) => {
      const dto = typeDto(t);
      const entitled = entitlement(dto, year, joined, today);
      const adj = Number(adjustments.find((a) => a.typeId === t.id)?.days ?? 0);
      const usedDays = Number(used.find((u) => u.typeId === t.id && u.status === 'approved')?.days ?? 0);
      const pending = Number(used.find((u) => u.typeId === t.id && u.status === 'pending')?.days ?? 0);
      return {
        leaveType: dto,
        year,
        entitled,
        adjustments: adj,
        used: usedDays,
        pending,
        available: entitled === null ? null : Math.round((entitled + adj - usedDays - pending) * 2) / 2,
      };
    });
  }

  private requestRows(tx: Tx, workspaceId: string, where: ReturnType<typeof and> | undefined, limit = 500) {
    return tx
      .select({ r: leaveRequests, type: leaveTypes, userName: users.name, userEmail: users.email, decidedByName: sql<string | null>`(select name from users d where d.id = ${leaveRequests.decidedBy})` })
      .from(leaveRequests)
      .innerJoin(leaveTypes, eq(leaveTypes.id, leaveRequests.leaveTypeId))
      .innerJoin(users, eq(users.id, leaveRequests.userId))
      .where(and(eq(leaveRequests.workspaceId, workspaceId), where))
      .orderBy(desc(leaveRequests.startDate), desc(leaveRequests.createdAt))
      .limit(limit);
  }

  private async requestRow(tx: Tx, workspaceId: string, id: string) {
    const [r] = await tx.select().from(leaveRequests).where(and(eq(leaveRequests.id, id), eq(leaveRequests.workspaceId, workspaceId)));
    if (!r) throw new NotFoundException('Leave request not found');
    return r;
  }

  private requestDto(row: Awaited<ReturnType<LeaveController['requestRows']>>[number], withReason: boolean): LeaveRequestDto {
    const { r, type } = row;
    return {
      id: r.id,
      user: { id: r.userId, name: row.userName, email: row.userEmail },
      leaveType: { id: type.id, name: type.name, color: type.color as LeaveTypeDto['color'], paid: type.paid },
      startDate: r.startDate,
      endDate: r.endDate,
      halfDay: r.halfDay,
      days: Number(r.days),
      reason: withReason ? r.reason : null,
      status: r.status,
      decidedByName: row.decidedByName,
      decidedAt: r.decidedAt?.toISOString() ?? null,
      decisionNote: r.decisionNote,
      createdAt: r.createdAt.toISOString(),
    };
  }
}

function rangeText(start: string, end: string) {
  const fmt = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  return start === end ? fmt(start) : `${fmt(start)} – ${fmt(end)}`;
}
