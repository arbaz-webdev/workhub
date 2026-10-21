import { BadRequestException, Body, Controller, Delete, Get, HttpCode, NotFoundException, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import {
  assignAttendanceSchema,
  shiftSchema,
  siteSchema,
  teamShiftSchema,
  updateAttendanceSettingsSchema,
  type AssignAttendanceInput,
  type AttendanceSettingsDto,
  type ShiftDto,
  type SiteDto,
} from '@workhub/shared';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import type { z } from 'zod';
import { audit } from '../audit/audit';
import { AuthContext, ClientIp, CurrentAuth, CurrentWorkspace, MinRole, WorkspaceContext } from '../common/request';
import { ZodPipe } from '../common/zod.pipe';
import { DbService, Tx } from '../db/db.service';
import { attendanceSites, memberships, shifts, teams, users, workspaces } from '../db/schema';
import { WorkspaceGuard } from '../workspaces/workspace.guard';
import { peopleAttendance, shiftDto, workspaceInfo } from './attendance';
import { isValidRange } from './location';

type ShiftValues = z.output<typeof shiftSchema>;
type SiteValues = z.output<typeof siteSchema>;

function siteDto(s: typeof attendanceSites.$inferSelect): SiteDto {
  return { id: s.id, name: s.name, latitude: s.latitude, longitude: s.longitude, radiusMeters: s.radiusMeters, ipRanges: s.ipRanges };
}

/** Stores IP ranges as networks ("203.0.113.7/24" → "203.0.113.0/24"); refuses invalid ones. */
function ipRangesSql(ranges: string[]) {
  const bad = ranges.find((r) => !isValidRange(r));
  if (bad) throw new BadRequestException({ message: 'Validation failed', errors: [{ path: 'ipRanges', message: `${bad} isn’t a valid IP address or range` }] });
  // One JSON parameter: Drizzle would spread a JS array into separate parameters.
  return sql`array(select distinct network(x::inet) from json_array_elements_text(${JSON.stringify(ranges)}::json) as x)::cidr[]`;
}

const shiftColumns = (b: ShiftValues) => ({
  name: b.name,
  startTime: b.startTime,
  endTime: b.endTime,
  graceMinutes: b.graceMinutes,
  fullDayMinutes: b.fullDayMinutes,
  halfDayMinutes: b.halfDayMinutes,
  workingDays: b.workingDays,
  breaks: b.breaks,
  isDefault: b.isDefault,
});

/** Shifts, office sites and who works when. Admins and owners only. */
@Controller('attendance')
@UseGuards(WorkspaceGuard)
@MinRole('admin')
export class AttendanceSettingsController {
  constructor(private readonly db: DbService) {}

  @Get('settings')
  settings(@CurrentAuth() auth: AuthContext, @CurrentWorkspace() ws: WorkspaceContext): Promise<AttendanceSettingsDto> {
    return this.db.withContext({ workspaceId: ws.id, userId: auth.userId }, (tx) => this.load(tx, ws.id));
  }

  @Patch('settings')
  updateSettings(
    @Body(new ZodPipe(updateAttendanceSettingsSchema)) body: { requireSelfie: boolean },
    @CurrentAuth() auth: AuthContext,
    @CurrentWorkspace() ws: WorkspaceContext,
    @ClientIp() ip?: string,
  ): Promise<AttendanceSettingsDto> {
    return this.db.withContext({ workspaceId: ws.id, userId: auth.userId }, async (tx) => {
      await tx.update(workspaces).set({ attendanceRequireSelfie: body.requireSelfie }).where(eq(workspaces.id, ws.id));
      await audit(tx, { workspaceId: ws.id, actorUserId: auth.userId, action: 'attendance.settings_updated', entityType: 'workspace', entityId: ws.id, metadata: body, ip });
      return this.load(tx, ws.id);
    });
  }

  // ---- Shifts ----------------------------------------------------------------------

  @Post('shifts')
  createShift(
    @Body(new ZodPipe(shiftSchema)) body: ShiftValues,
    @CurrentAuth() auth: AuthContext,
    @CurrentWorkspace() ws: WorkspaceContext,
    @ClientIp() ip?: string,
  ): Promise<ShiftDto> {
    return this.db.withContext({ workspaceId: ws.id, userId: auth.userId }, async (tx) => {
      // The first shift becomes the default, so everyone has a schedule straight away.
      const [existing] = await tx.select({ id: shifts.id }).from(shifts).where(eq(shifts.workspaceId, ws.id)).limit(1);
      const isDefault = body.isDefault || !existing;
      if (isDefault) await tx.update(shifts).set({ isDefault: false }).where(eq(shifts.workspaceId, ws.id));
      const [row] = await tx
        .insert(shifts)
        .values({ workspaceId: ws.id, ...shiftColumns(body), isDefault })
        .returning();
      await audit(tx, { workspaceId: ws.id, actorUserId: auth.userId, action: 'shift.created', entityType: 'shift', entityId: row!.id, metadata: { name: body.name }, ip });
      return shiftDto(row!);
    });
  }

  @Patch('shifts/:id')
  updateShift(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(shiftSchema)) body: ShiftValues,
    @CurrentAuth() auth: AuthContext,
    @CurrentWorkspace() ws: WorkspaceContext,
    @ClientIp() ip?: string,
  ): Promise<ShiftDto> {
    return this.db.withContext({ workspaceId: ws.id, userId: auth.userId }, async (tx) => {
      const current = await this.shift(tx, ws.id, id);
      if (body.isDefault) await tx.update(shifts).set({ isDefault: false }).where(eq(shifts.workspaceId, ws.id));
      // Turning off the only default would leave people without a schedule; keep it unless another takes over.
      const isDefault = body.isDefault || current.isDefault;
      const [row] = await tx
        .update(shifts)
        .set({ ...shiftColumns(body), isDefault })
        .where(eq(shifts.id, id))
        .returning();
      await audit(tx, { workspaceId: ws.id, actorUserId: auth.userId, action: 'shift.updated', entityType: 'shift', entityId: id, metadata: { name: body.name }, ip });
      return shiftDto(row!);
    });
  }

  @Delete('shifts/:id')
  @HttpCode(204)
  async deleteShift(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentAuth() auth: AuthContext,
    @CurrentWorkspace() ws: WorkspaceContext,
    @ClientIp() ip?: string,
  ) {
    await this.db.withContext({ workspaceId: ws.id, userId: auth.userId }, async (tx) => {
      const current = await this.shift(tx, ws.id, id);
      // Past days keep a copy of their rules, so deleting a shift doesn't change history.
      await tx.delete(shifts).where(eq(shifts.id, id));
      if (current.isDefault) {
        const [next] = await tx.select({ id: shifts.id }).from(shifts).where(eq(shifts.workspaceId, ws.id)).orderBy(asc(shifts.createdAt)).limit(1);
        if (next) await tx.update(shifts).set({ isDefault: true }).where(eq(shifts.id, next.id));
      }
      await audit(tx, { workspaceId: ws.id, actorUserId: auth.userId, action: 'shift.deleted', entityType: 'shift', entityId: id, metadata: { name: current.name }, ip });
    });
  }

  // ---- Sites -----------------------------------------------------------------------

  @Post('sites')
  createSite(
    @Body(new ZodPipe(siteSchema)) body: SiteValues,
    @CurrentAuth() auth: AuthContext,
    @CurrentWorkspace() ws: WorkspaceContext,
    @ClientIp() ip?: string,
  ): Promise<SiteDto> {
    return this.db.withContext({ workspaceId: ws.id, userId: auth.userId }, async (tx) => {
      const [row] = await tx
        .insert(attendanceSites)
        .values({ workspaceId: ws.id, name: body.name, latitude: body.latitude, longitude: body.longitude, radiusMeters: body.radiusMeters, ipRanges: ipRangesSql(body.ipRanges) })
        .returning();
      await audit(tx, { workspaceId: ws.id, actorUserId: auth.userId, action: 'attendance_site.created', entityType: 'attendance_site', entityId: row!.id, metadata: { name: body.name }, ip });
      return siteDto(row!);
    });
  }

  @Patch('sites/:id')
  updateSite(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(siteSchema)) body: SiteValues,
    @CurrentAuth() auth: AuthContext,
    @CurrentWorkspace() ws: WorkspaceContext,
    @ClientIp() ip?: string,
  ): Promise<SiteDto> {
    return this.db.withContext({ workspaceId: ws.id, userId: auth.userId }, async (tx) => {
      const [row] = await tx
        .update(attendanceSites)
        .set({ name: body.name, latitude: body.latitude, longitude: body.longitude, radiusMeters: body.radiusMeters, ipRanges: ipRangesSql(body.ipRanges) })
        .where(and(eq(attendanceSites.id, id), eq(attendanceSites.workspaceId, ws.id)))
        .returning();
      if (!row) throw new NotFoundException('Site not found');
      await audit(tx, { workspaceId: ws.id, actorUserId: auth.userId, action: 'attendance_site.updated', entityType: 'attendance_site', entityId: id, metadata: { name: body.name }, ip });
      return siteDto(row);
    });
  }

  @Delete('sites/:id')
  @HttpCode(204)
  async deleteSite(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentAuth() auth: AuthContext,
    @CurrentWorkspace() ws: WorkspaceContext,
    @ClientIp() ip?: string,
  ) {
    await this.db.withContext({ workspaceId: ws.id, userId: auth.userId }, async (tx) => {
      const [row] = await tx
        .delete(attendanceSites)
        .where(and(eq(attendanceSites.id, id), eq(attendanceSites.workspaceId, ws.id)))
        .returning({ name: attendanceSites.name });
      if (!row) throw new NotFoundException('Site not found');
      await audit(tx, { workspaceId: ws.id, actorUserId: auth.userId, action: 'attendance_site.deleted', entityType: 'attendance_site', entityId: id, metadata: { name: row.name }, ip });
    });
  }

  // ---- Who works when ----------------------------------------------------------------

  @Patch('people/:userId')
  assignPerson(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body(new ZodPipe(assignAttendanceSchema)) body: AssignAttendanceInput,
    @CurrentAuth() auth: AuthContext,
    @CurrentWorkspace() ws: WorkspaceContext,
    @ClientIp() ip?: string,
  ): Promise<AttendanceSettingsDto> {
    return this.db.withContext({ workspaceId: ws.id, userId: auth.userId }, async (tx) => {
      if (body.teamId) {
        const [t] = await tx.select({ id: teams.id }).from(teams).where(and(eq(teams.id, body.teamId), eq(teams.workspaceId, ws.id), isNull(teams.deletedAt)));
        if (!t) throw new BadRequestException('Unknown team');
      }
      if (body.shiftId) await this.shift(tx, ws.id, body.shiftId, true);
      const set: Partial<typeof memberships.$inferInsert> = {};
      if (body.teamId !== undefined) set.teamId = body.teamId;
      if (body.shiftId !== undefined) set.shiftId = body.shiftId;
      if (body.remote !== undefined) set.attendanceRemote = body.remote;
      if (Object.keys(set).length > 0) {
        const updated = await tx
          .update(memberships)
          .set(set)
          .where(and(eq(memberships.workspaceId, ws.id), eq(memberships.userId, userId)))
          .returning({ id: memberships.id });
        if (updated.length === 0) throw new NotFoundException('That person isn’t in this workspace');
        await audit(tx, { workspaceId: ws.id, actorUserId: auth.userId, action: 'attendance.assignment_updated', entityType: 'user', entityId: userId, metadata: body, ip });
      }
      return this.load(tx, ws.id);
    });
  }

  @Patch('teams/:teamId')
  assignTeam(
    @Param('teamId', ParseUUIDPipe) teamId: string,
    @Body(new ZodPipe(teamShiftSchema)) body: { shiftId: string | null },
    @CurrentAuth() auth: AuthContext,
    @CurrentWorkspace() ws: WorkspaceContext,
    @ClientIp() ip?: string,
  ): Promise<AttendanceSettingsDto> {
    return this.db.withContext({ workspaceId: ws.id, userId: auth.userId }, async (tx) => {
      if (body.shiftId) await this.shift(tx, ws.id, body.shiftId, true);
      const updated = await tx
        .update(teams)
        .set({ shiftId: body.shiftId })
        .where(and(eq(teams.id, teamId), eq(teams.workspaceId, ws.id), isNull(teams.deletedAt)))
        .returning({ id: teams.id });
      if (updated.length === 0) throw new NotFoundException('Team not found');
      await audit(tx, { workspaceId: ws.id, actorUserId: auth.userId, action: 'team.shift_updated', entityType: 'team', entityId: teamId, metadata: body, ip });
      return this.load(tx, ws.id);
    });
  }

  // ---- Internals -------------------------------------------------------------------

  private async shift(tx: Tx, workspaceId: string, id: string, asInput = false) {
    const [row] = await tx.select().from(shifts).where(and(eq(shifts.id, id), eq(shifts.workspaceId, workspaceId)));
    if (!row) throw asInput ? new BadRequestException('Unknown shift') : new NotFoundException('Shift not found');
    return row;
  }

  private async load(tx: Tx, workspaceId: string): Promise<AttendanceSettingsDto> {
    const info = await workspaceInfo(tx, workspaceId);
    const allShifts = await tx.select().from(shifts).where(eq(shifts.workspaceId, workspaceId)).orderBy(asc(shifts.startTime), asc(shifts.name));
    const sites = await tx.select().from(attendanceSites).where(eq(attendanceSites.workspaceId, workspaceId)).orderBy(asc(attendanceSites.name));
    const teamRows = await tx
      .select({ id: teams.id, name: teams.name, shiftId: teams.shiftId })
      .from(teams)
      .where(and(eq(teams.workspaceId, workspaceId), isNull(teams.deletedAt)))
      .orderBy(asc(teams.name));
    const people = await tx
      .select({ userId: users.id, name: users.name, email: users.email, role: memberships.role, teamId: memberships.teamId, shiftId: memberships.shiftId, remote: memberships.attendanceRemote })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(and(eq(memberships.workspaceId, workspaceId), sql`${memberships.role} <> 'guest'`))
      .orderBy(asc(users.name));
    const effective = await peopleAttendance(tx, workspaceId);
    return {
      requireSelfie: info.requireSelfie,
      timezone: info.timezone,
      shifts: allShifts.map(shiftDto),
      sites: sites.map(siteDto),
      teams: teamRows,
      people: people.map((p) => ({ ...p, effectiveShiftId: effective.get(p.userId)?.shift?.id ?? null })),
    };
  }
}
