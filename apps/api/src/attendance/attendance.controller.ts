import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ATTENDANCE_STATUSES,
  attendanceEventSchema,
  hasRole,
  MAX_SELFIE_BYTES,
  type AttendanceDayDto,
  type AttendanceEventInput,
  type AttendanceFlag,
  type AttendanceStatus,
  type AttendanceTodayDto,
  type TeamAttendanceDto,
} from '@workhub/shared';
import { and, asc, eq, inArray, ne } from 'drizzle-orm';
import type { Response } from 'express';
import { randomUUID } from 'node:crypto';
import { AuthContext, ClientIp, CurrentAuth, CurrentWorkspace, MinRole, WorkspaceContext } from '../common/request';
import { ZodPipe } from '../common/zod.pipe';
import { AnalyticsService } from '../analytics/analytics.service';
import { DbService } from '../db/db.service';
import { attendanceDays, attendanceEvents, memberships, shifts, teams, users } from '../db/schema';
import { presenceAfter } from '../inbox/presence';
import { RealtimeService } from '../realtime/realtime.service';
import { StorageService } from '../storage/storage.service';
import { WorkspaceGuard } from '../workspaces/workspace.guard';
import {
  buildDay,
  conflict,
  daysFor,
  eventsForDays,
  extrasLoader,
  firstCountedDay,
  lockDay,
  openDay,
  peopleAttendance,
  shiftRule,
  siteNameMap,
  siteRules,
  todayFor,
  trackingStart,
  workspaceInfo,
} from './attendance';
import { monthReport, toCsv, toXlsx } from './export';
import { checkZone, normalizeIp } from './location';
import { breaksOn, punchState, resolveWorkday } from './rules';
import { addDays, zonedParts } from './zoned';

/** Device clocks are trusted to within this; beyond it the event was queued offline. */
const CLOCK_SKEW_MS = 2 * 60_000;
/** Offline check-ins older than this are refused (too easy to back-date). */
const MAX_OFFLINE_AGE_MS = 72 * 3600_000;

/** Selfies must really be images, whatever the browser claims. */
function selfieType(buf: Buffer): string | null {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

const SELFIE_EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const SELFIE_TYPE = Object.fromEntries(Object.entries(SELFIE_EXT).map(([t, e]) => [e, t]));

const isUniqueViolation = (err: unknown) =>
  typeof err === 'object' && err !== null && ((err as { code?: string }).code === '23505' || (err as { cause?: { code?: string } }).cause?.code === '23505');

@Controller('attendance')
@UseGuards(WorkspaceGuard)
@MinRole('member') // guests are outside collaborators; they don't clock in
export class AttendanceController {
  constructor(
    private readonly db: DbService,
    private readonly storage: StorageService,
    private readonly realtime: RealtimeService,
    private readonly analytics: AnalyticsService,
  ) {}

  @Get('today')
  today(@CurrentAuth() auth: AuthContext, @CurrentWorkspace() ws: WorkspaceContext): Promise<AttendanceTodayDto> {
    return this.db.withContext({ workspaceId: ws.id, userId: auth.userId }, async (tx) => todayFor(tx, await workspaceInfo(tx, ws.id), auth.userId, new Date()));
  }

  /** The caller's days in a month (YYYY-MM), newest first, up to today. */
  @Get('me')
  me(@Query('month') month: string | undefined, @CurrentAuth() auth: AuthContext, @CurrentWorkspace() ws: WorkspaceContext): Promise<AttendanceDayDto[]> {
    return this.db.withContext({ workspaceId: ws.id, userId: auth.userId }, async (tx) => {
      const info = await workspaceInfo(tx, ws.id);
      const now = new Date();
      const today = zonedParts(now, info.timezone).date;
      const m = month ?? today.slice(0, 7);
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(m)) throw new BadRequestException('Use month=YYYY-MM');
      const from = `${m}-01`;
      const lastOfMonth = addDays(`${addDays(from, 32).slice(0, 7)}-01`, -1);
      const to = lastOfMonth < today ? lastOfMonth : today;
      if (to < from) return [];
      return daysFor(tx, info, auth.userId, from, to, now);
    });
  }

  /**
   * Check in or out, or start or end a break. Multipart, with an optional "selfie" image.
   * Devices that were offline send occurredAt and a clientEventId, so a retry is
   * recorded once.
   */
  @Post('events')
  @HttpCode(200)
  @UseInterceptors(FileInterceptor('selfie', { limits: { fileSize: MAX_SELFIE_BYTES, files: 1, fields: 20 } }))
  async record(
    @Body(new ZodPipe(attendanceEventSchema)) body: AttendanceEventInput,
    @UploadedFile() selfie: Express.Multer.File | undefined,
    @Headers('user-agent') userAgent: string | undefined,
    @ClientIp() rawIp: string | undefined,
    @CurrentAuth() auth: AuthContext,
    @CurrentWorkspace() ws: WorkspaceContext,
  ): Promise<AttendanceTodayDto> {
    const received = new Date();
    let at = received;
    let offline = false;
    if (body.occurredAt) {
      const t = new Date(body.occurredAt);
      if (t.getTime() > received.getTime() + CLOCK_SKEW_MS) throw new BadRequestException('That time is in the future. Check the device clock.');
      if (received.getTime() - t.getTime() > MAX_OFFLINE_AGE_MS) throw new BadRequestException('This was recorded more than 3 days ago. Ask your manager to correct it.');
      if (received.getTime() - t.getTime() > CLOCK_SKEW_MS) {
        at = t;
        offline = true;
      }
    }
    let selfieMime: string | null = null;
    if (selfie) {
      selfieMime = selfieType(selfie.buffer);
      if (!selfieMime) throw new BadRequestException('The selfie must be a JPEG, PNG or WebP photo.');
    }
    const ip = normalizeIp(rawIp);
    const ctx = { workspaceId: ws.id, userId: auth.userId };

    // A retried event is answered with the current state, not recorded twice.
    const replay = async () => this.today(auth, ws);
    const recorded = async () => {
      if (!body.clientEventId) return false;
      const [seen] = await this.db.withContext(ctx, (tx) =>
        tx
          .select({ id: attendanceEvents.id })
          .from(attendanceEvents)
          .where(and(eq(attendanceEvents.userId, auth.userId), eq(attendanceEvents.clientEventId, body.clientEventId!))),
      );
      return !!seen;
    };
    if (await recorded()) return replay();

    const eventId = randomUUID();
    let storedKey: string | null = null;
    try {
      const today = await this.db.withContext(ctx, async (tx) => {
        const info = await workspaceInfo(tx, ws.id);
        const punch = body.type === 'check_in' || body.type === 'check_out';
        if (punch && info.requireSelfie && !selfie) throw new BadRequestException(`Take a selfie to ${body.type === 'check_in' ? 'check in' : 'check out'}.`);
        const person = (await peopleAttendance(tx, ws.id, [auth.userId])).get(auth.userId);
        const shift = person?.shift ?? null;

        // Which day this belongs to, locked so two taps can't both check in.
        let day;
        if (body.type === 'check_in') {
          const open = await openDay(tx, ws.id, auth.userId, at);
          if (open) conflict('You’re already checked in.');
          day = await lockDay(tx, info, auth.userId, resolveWorkday(at, shift ? shiftRule(shift) : null, info.timezone), shift);
        } else {
          const open = await openDay(tx, ws.id, auth.userId, at);
          if (!open) conflict('You’re not checked in. Check in first.');
          day = await lockDay(tx, info, auth.userId, open.row.workDate, shift);
        }
        const events = (await eventsForDays(tx, [day.id])).get(day.id) ?? [];
        const state = punchState(events);
        const last = events.at(-1);
        if (last && at < last.occurredAt) conflict('This is older than your last check-in or break. Refresh and try again.');
        switch (body.type) {
          case 'check_in':
            if (state !== 'out') conflict('You’re already checked in.');
            break;
          case 'break_start': {
            if (state === 'on_break') conflict('You’re already on a break.');
            if (state !== 'in') conflict('You’re not checked in. Check in first.');
            const allowed = breaksOn(day.policy.breaks, day.workDate);
            const ok = allowed.length === 0 ? body.breakName!.toLowerCase() === 'break' : allowed.some((b) => b.name.toLowerCase() === body.breakName!.toLowerCase());
            if (!ok) throw new BadRequestException('That break isn’t part of your shift today.');
            break;
          }
          case 'break_end':
            if (state !== 'on_break') conflict('You’re not on a break.');
            break;
          case 'check_out':
            if (state === 'out') conflict('You’re not checked in. Check in first.');
            break;
        }

        const flags: AttendanceFlag[] = offline ? ['offline'] : [];
        let zone: { inZone: boolean | null; siteId: string | null } = { inZone: null, siteId: null };
        if (punch) {
          const z = checkZone(await siteRules(tx, ws.id), { ip, latitude: body.latitude, longitude: body.longitude, accuracyMeters: body.accuracyMeters }, person?.remote ?? false);
          zone = z;
          flags.push(...z.flags);
        }
        if (selfie && selfieMime) {
          storedKey = `${ws.id}/selfies/${auth.userId}/${eventId}.${SELFIE_EXT[selfieMime]}`;
          await this.storage.put(storedKey, selfie.buffer, selfieMime);
        }
        await tx.insert(attendanceEvents).values({
          id: eventId,
          workspaceId: ws.id,
          dayId: day.id,
          userId: auth.userId,
          type: body.type,
          occurredAt: at,
          receivedAt: received,
          clientEventId: body.clientEventId ?? null,
          breakName: body.type === 'break_start' ? body.breakName! : body.type === 'break_end' ? (last?.breakName ?? null) : null,
          ip,
          userAgent: userAgent?.slice(0, 300) ?? null,
          deviceId: body.deviceId ?? null,
          latitude: body.latitude ?? null,
          longitude: body.longitude ?? null,
          accuracyMeters: body.accuracyMeters ?? null,
          inZone: zone.inZone,
          siteId: zone.siteId,
          flags,
          selfieKey: storedKey,
        });
        return todayFor(tx, info, auth.userId, new Date());
      });
      // Colleagues see them come in, step out for a break and leave.
      this.realtime.toStaff(ws.id, { type: 'presence.changed', userId: auth.userId, presence: presenceAfter(body.type), since: at.toISOString() });
      this.analytics.capture('attendance recorded', { userId: auth.userId, workspaceId: ws.id }, { type: body.type, offline, selfie: !!selfie });
      return today;
    } catch (err) {
      if (storedKey) await this.storage.delete(storedKey).catch(() => undefined);
      // Two copies of the same queued event raced: if the other copy was recorded, this
      // one's conflict (or duplicate key) is just the echo of it, so answer as a retry.
      if ((isUniqueViolation(err) || err instanceof ConflictException) && (await recorded())) return replay();
      throw err;
    }
  }

  /** A selfie, to the person who took it and to managers and above. Kept 30 days. */
  @Get('events/:eventId/selfie')
  async selfie(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @CurrentAuth() auth: AuthContext,
    @CurrentWorkspace() ws: WorkspaceContext,
    @Res() res: Response,
  ) {
    const e = await this.db.withContext({ workspaceId: ws.id, userId: auth.userId }, async (tx) => {
      const [row] = await tx
        .select({ userId: attendanceEvents.userId, key: attendanceEvents.selfieKey })
        .from(attendanceEvents)
        .where(eq(attendanceEvents.id, eventId));
      return row;
    });
    if (!e?.key) throw new NotFoundException('No selfie for this check-in (they are kept for 30 days).');
    if (e.userId !== auth.userId && !hasRole(ws.role, 'manager')) throw new ForbiddenException('Only managers can see other people’s selfies.');
    const ext = e.key.split('.').pop() ?? 'jpg';
    const contentType = SELFIE_TYPE[ext] ?? 'image/jpeg';
    const result = await this.storage.download(e.key, { fileName: `selfie.${ext}`, contentType, inline: true });
    if (result.kind === 'redirect') {
      res.redirect(302, result.url);
      return;
    }
    // Only JPEG, PNG or WebP are ever stored (checked by their bytes on upload).
    res.setHeader('content-type', contentType);
    res.setHeader('cache-control', 'private, no-store');
    res.setHeader('content-disposition', `inline; filename="selfie.${ext}"`);
    result.stream.pipe(res);
  }

  /**
   * A month for payroll: .xlsx with a Summary and a Daily sheet, or the summary as CSV.
   */
  @Get('export')
  @MinRole('manager')
  async export(
    @Query('month') month: string | undefined,
    @Query('format') format: string | undefined,
    @CurrentAuth() auth: AuthContext,
    @CurrentWorkspace() ws: WorkspaceContext,
    @Res() res: Response,
  ) {
    if (!month || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new BadRequestException('Use month=YYYY-MM');
    const csv = format === 'csv';
    const file = await this.db.withContext({ workspaceId: ws.id, userId: auth.userId }, async (tx) => {
      const info = await workspaceInfo(tx, ws.id);
      const report = await monthReport(tx, info, month);
      return csv ? toCsv(report) : toXlsx(report, info);
    });
    res.setHeader('content-type', csv ? 'text/csv; charset=utf-8' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('content-disposition', `attachment; filename="attendance-${month}.${csv ? 'csv' : 'xlsx'}"`);
    res.setHeader('cache-control', 'private, no-store');
    res.send(file);
  }

  /** Everyone's attendance for one workday (managers and above). */
  @Get('team')
  @MinRole('manager')
  team(@Query('date') date: string | undefined, @CurrentAuth() auth: AuthContext, @CurrentWorkspace() ws: WorkspaceContext): Promise<TeamAttendanceDto> {
    return this.db.withContext({ workspaceId: ws.id, userId: auth.userId }, async (tx) => {
      const info = await workspaceInfo(tx, ws.id);
      const now = new Date();
      // Default to the current workday under the default shift: at 01:00 a night shift
      // that started at 18:00 is still yesterday's workday.
      let d = date;
      if (!d) {
        const [fallback] = await tx.select().from(shifts).where(and(eq(shifts.workspaceId, ws.id), eq(shifts.isDefault, true)));
        d = resolveWorkday(now, fallback ? shiftRule(fallback) : null, info.timezone);
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || Number.isNaN(Date.parse(d))) throw new BadRequestException('Use date=YYYY-MM-DD');
      const people = await tx
        .select({ userId: users.id, name: users.name, teamName: teams.name })
        .from(memberships)
        .innerJoin(users, eq(users.id, memberships.userId))
        .leftJoin(teams, eq(teams.id, memberships.teamId))
        .where(and(eq(memberships.workspaceId, ws.id), ne(memberships.role, 'guest')))
        .orderBy(asc(users.name));
      const attendance = await peopleAttendance(tx, ws.id);
      const rows = await tx
        .select()
        .from(attendanceDays)
        .where(and(eq(attendanceDays.workspaceId, ws.id), eq(attendanceDays.workDate, d), people.length ? inArray(attendanceDays.userId, people.map((p) => p.userId)) : undefined));
      const byUser = new Map(rows.map((r) => [r.userId, r]));
      const events = await eventsForDays(
        tx,
        rows.map((r) => r.id),
      );
      const siteNames = await siteNameMap(tx, ws.id);
      const extras = await extrasLoader(tx, info, attendance, d, d);
      const start = await trackingStart(tx, info);
      const summary = Object.fromEntries(ATTENDANCE_STATUSES.map((s) => [s, 0])) as Record<AttendanceStatus, number>;
      const counted = people.filter((p) => byUser.has(p.userId) || d >= firstCountedDay(start, attendance.get(p.userId)?.joinedAt, info, now));
      const out = counted.map((p) => {
        const row = byUser.get(p.userId);
        const a = attendance.get(p.userId);
        const day = buildDay(d, row, row ? (events.get(row.id) ?? []) : [], a?.shift ?? null, info, siteNames, now, extras(p.userId, d));
        summary[day.status] += 1;
        return { userId: p.userId, name: p.name, teamName: p.teamName, remote: a?.remote ?? false, day };
      });
      return { date: d, timezone: info.timezone, summary, rows: out };
    });
  }
}
