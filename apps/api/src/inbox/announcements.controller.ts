import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, HttpCode, NotFoundException, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { announcementSchema, hasRole, type AnnouncementDto, type AnnouncementInput, type AnnouncementReceiptsDto } from '@workhub/shared';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { AnalyticsService } from '../analytics/analytics.service';
import { AuthContext, CurrentAuth, CurrentWorkspace, MinRole, WorkspaceContext } from '../common/request';
import { ZodPipe } from '../common/zod.pipe';
import { DbService, Tx } from '../db/db.service';
import { announcementReads, announcements, teams, users } from '../db/schema';
import { notify } from '../notifications/notify';
import { RealtimeService } from '../realtime/realtime.service';
import { WorkspaceGuard } from '../workspaces/workspace.guard';
import { announcementDtos, audienceOf, seesAll } from './announcements';

/**
 * Announcements from managers to everyone or to one team, with read receipts: each
 * person marks it read, and its author and managers see who has and who hasn't.
 */
@Controller('announcements')
@UseGuards(WorkspaceGuard)
@MinRole('member')
export class AnnouncementsController {
  constructor(
    private readonly db: DbService,
    private readonly realtime: RealtimeService,
    private readonly analytics: AnalyticsService,
  ) {}

  private ctx(auth: AuthContext, ws: WorkspaceContext) {
    return { workspaceId: ws.id, userId: auth.userId };
  }

  @Get()
  async list(@CurrentAuth() auth: AuthContext, @CurrentWorkspace() ws: WorkspaceContext): Promise<AnnouncementDto[]> {
    return this.db.withContext(this.ctx(auth, ws), (tx) => announcementDtos(tx, ws, auth.userId));
  }

  @Post()
  @MinRole('manager')
  async create(
    @Body(new ZodPipe(announcementSchema)) body: AnnouncementInput,
    @CurrentAuth() auth: AuthContext,
    @CurrentWorkspace() ws: WorkspaceContext,
  ): Promise<AnnouncementDto> {
    const id = randomUUID();
    const dto = await this.db.withContext(this.ctx(auth, ws), async (tx) => {
      await assertTeam(tx, ws.id, body.teamId);
      await tx.insert(announcements).values({ id, workspaceId: ws.id, authorId: auth.userId, ...body });
      const [me] = await tx.select({ name: users.name }).from(users).where(eq(users.id, auth.userId));
      const snippet = body.body.length > 120 ? `${body.body.slice(0, 117)}…` : body.body;
      await notify(tx, ws.id, await audienceOf(tx, ws.id, id), { type: 'announcement', title: `${me!.name}: ${body.title}`, body: snippet, link: `/app/announcements#${id}` });
      return (await announcementDtos(tx, ws, auth.userId, id))[0]!;
    });
    this.realtime.toStaff(ws.id, { type: 'announcement.changed' });
    this.analytics.capture('announcement posted', { userId: auth.userId, workspaceId: ws.id }, { team: !!body.teamId, pinned: body.pinned });
    return dto;
  }

  @Patch(':id')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(announcementSchema)) body: AnnouncementInput,
    @CurrentAuth() auth: AuthContext,
    @CurrentWorkspace() ws: WorkspaceContext,
  ): Promise<AnnouncementDto> {
    const dto = await this.db.withContext(this.ctx(auth, ws), async (tx) => {
      await loadOwn(tx, ws, auth.userId, id);
      await assertTeam(tx, ws.id, body.teamId);
      await tx.update(announcements).set({ ...body, editedAt: new Date() }).where(eq(announcements.id, id));
      return (await announcementDtos(tx, ws, auth.userId, id))[0]!;
    });
    this.realtime.toStaff(ws.id, { type: 'announcement.changed' });
    return dto;
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id', ParseUUIDPipe) id: string, @CurrentAuth() auth: AuthContext, @CurrentWorkspace() ws: WorkspaceContext) {
    await this.db.withContext(this.ctx(auth, ws), async (tx) => {
      await loadOwn(tx, ws, auth.userId, id);
      await tx.delete(announcements).where(eq(announcements.id, id));
    });
    this.realtime.toStaff(ws.id, { type: 'announcement.changed' });
  }

  @Post(':id/read')
  @HttpCode(204)
  async read(@Param('id', ParseUUIDPipe) id: string, @CurrentAuth() auth: AuthContext, @CurrentWorkspace() ws: WorkspaceContext) {
    const authorId = await this.db.withContext(this.ctx(auth, ws), async (tx) => {
      const [a] = await announcementDtos(tx, ws, auth.userId, id);
      if (!a) throw new NotFoundException('Announcement not found');
      await tx.insert(announcementReads).values({ workspaceId: ws.id, announcementId: id, userId: auth.userId }).onConflictDoNothing();
      return a.author?.id;
    });
    // The reader's other tabs, and the author watching the receipts.
    this.realtime.toPeople(ws.id, authorId ? [auth.userId, authorId] : [auth.userId], { type: 'announcement.changed' });
  }

  /** Who has read it and who hasn't: for its author and managers. */
  @Get(':id/receipts')
  async receipts(@Param('id', ParseUUIDPipe) id: string, @CurrentAuth() auth: AuthContext, @CurrentWorkspace() ws: WorkspaceContext): Promise<AnnouncementReceiptsDto> {
    return this.db.withContext(this.ctx(auth, ws), async (tx) => {
      const [a] = await announcementDtos(tx, ws, auth.userId, id);
      if (!a) throw new NotFoundException('Announcement not found');
      if (!a.receipts) throw new ForbiddenException('Only its author and managers can see who has read it.');
      const audience = await audienceOf(tx, ws.id, id);
      if (audience.length === 0) return { read: [], unread: [] };
      const people = await tx.select({ id: users.id, name: users.name, email: users.email }).from(users).where(inArray(users.id, audience)).orderBy(asc(users.name));
      const reads = await tx
        .select({ userId: announcementReads.userId, readAt: announcementReads.readAt })
        .from(announcementReads)
        .where(eq(announcementReads.announcementId, id));
      const readAt = new Map(reads.map((r) => [r.userId, r.readAt]));
      return {
        read: people
          .filter((p) => readAt.has(p.id))
          .map((person) => ({ person, readAt: readAt.get(person.id)!.toISOString() }))
          .sort((x, y) => x.readAt.localeCompare(y.readAt)),
        unread: people.filter((p) => !readAt.has(p.id)),
      };
    });
  }
}

async function assertTeam(tx: Tx, workspaceId: string, teamId: string | null) {
  if (!teamId) return;
  const [team] = await tx
    .select({ id: teams.id })
    .from(teams)
    .where(and(eq(teams.id, teamId), eq(teams.workspaceId, workspaceId), isNull(teams.deletedAt)));
  if (!team) throw new BadRequestException('Choose a team in this workspace.');
}

/** Its author or an admin may change or delete it. */
async function loadOwn(tx: Tx, ws: WorkspaceContext, userId: string, id: string) {
  const [a] = await tx
    .select({ authorId: announcements.authorId })
    .from(announcements)
    .where(and(eq(announcements.id, id), eq(announcements.workspaceId, ws.id)));
  if (!a || (!seesAll(ws) && a.authorId !== userId)) throw new NotFoundException('Announcement not found');
  if (a.authorId !== userId && !hasRole(ws.role, 'admin')) throw new ForbiddenException('Only its author or an admin can change it.');
}
