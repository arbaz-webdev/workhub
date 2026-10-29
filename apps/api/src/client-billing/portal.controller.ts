import { BadRequestException, Body, ConflictException, Controller, Delete, ForbiddenException, Get, HttpCode, NotFoundException, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import {
  hasRole,
  portalInviteSchema,
  portalVisibilitySchema,
  type ClientDocumentDto,
  type CompanyPortalDto,
  type PortalDto,
  type PortalInviteInput,
  type PortalProjectDto,
} from '@workhub/shared';
import { and, asc, desc, eq, gt, inArray, isNull, ne, sql } from 'drizzle-orm';
import { z } from 'zod';
import { audit } from '../audit/audit';
import { addDays } from '../attendance/zoned';
import { RateLimiter } from '../common/rate-limiter';
import { AuthContext, ClientIp, CurrentAuth, CurrentWorkspace, MinRole, WorkspaceContext } from '../common/request';
import { hashToken, newToken } from '../common/tokens';
import { ZodPipe } from '../common/zod.pipe';
import { assertCompany, loadCompany } from '../crm/crm';
import { DbService, Tx } from '../db/db.service';
import { boardColumns, clientDocuments, companies, invitations, memberships, projects, tasks, timeEntries, users, workspaces } from '../db/schema';
import { EmailService } from '../email/email.service';
import { portalInviteMessage } from '../email/templates';
import { INVITE_TTL, inviteUrl } from '../invitations/invitations.controller';
import { WorkspaceGuard } from '../workspaces/workspace.guard';
import { documentDto, loadDoc, summaryDto, workspaceToday } from './client-docs';

/** What a client sees of the documents sent to it: never drafts or voided invoices. */
const CLIENT_VISIBLE = ['sent', 'accepted', 'declined', 'paid'] as const;

const hours = (minutes: number) => Math.round((minutes / 60) * 100) / 100;

/** Time whose person's timesheet for that week is approved. */
const approved = sql`exists (select 1 from timesheets t where t.workspace_id = ${timeEntries.workspaceId} and t.user_id = ${timeEntries.userId}
  and t.status = 'approved' and ${timeEntries.workDate} >= t.week_start and ${timeEntries.workDate} < t.week_start + 7)`;

/**
 * The client portal: a client's contacts (guests linked to the client) see its shared
 * projects, approved hours, and the quotes and invoices sent to it. Managers and up can
 * preview any client's portal, choose what's shared, and invite contacts.
 */
@Controller('portal')
@UseGuards(WorkspaceGuard)
@MinRole('guest')
export class PortalController {
  private readonly inviteLimiter = new RateLimiter('portal.invite', 100, 24 * 60 * 60 * 1000);

  constructor(
    private readonly db: DbService,
    private readonly email: EmailService,
  ) {}

  private ctx(auth: AuthContext, ws: WorkspaceContext) {
    return { workspaceId: ws.id, userId: auth.userId };
  }

  /** The client this person may see: their own (contacts), or the one asked for (staff previewing). */
  private async clientFor(tx: Tx, ws: WorkspaceContext, auth: AuthContext, companyId: string | undefined): Promise<string> {
    if (ws.role === 'guest') {
      const [m] = await tx
        .select({ clientCompanyId: memberships.clientCompanyId })
        .from(memberships)
        .where(and(eq(memberships.workspaceId, ws.id), eq(memberships.userId, auth.userId)));
      if (!m?.clientCompanyId) throw new ForbiddenException('The client portal is for client contacts.');
      return m.clientCompanyId;
    }
    if (!hasRole(ws.role, 'manager')) throw new ForbiddenException('The client portal is for client contacts.');
    if (!companyId) throw new BadRequestException('Choose a client to preview.');
    await assertCompany(tx, ws.id, companyId);
    return companyId;
  }

  @Get()
  portal(@Query('companyId') companyId: string | undefined, @CurrentAuth() auth: AuthContext, @CurrentWorkspace() ws: WorkspaceContext): Promise<PortalDto> {
    return this.db.withContext(this.ctx(auth, ws), async (tx) => {
      const clientId = await this.clientFor(tx, ws, auth, companyId);
      const today = await workspaceToday(tx, ws.id);
      const [client] = await tx.select({ id: companies.id, name: companies.name }).from(companies).where(eq(companies.id, clientId));
      const [w] = await tx.select({ name: workspaces.name }).from(workspaces).where(eq(workspaces.id, ws.id));

      const shared = await tx
        .select()
        .from(projects)
        .where(and(eq(projects.workspaceId, ws.id), eq(projects.clientId, clientId), eq(projects.portalVisible, true), ne(projects.status, 'archived')))
        .orderBy(asc(projects.name));
      const ids = shared.map((p) => p.id);
      const monthStart = `${today.slice(0, 7)}-01`;

      const out: PortalProjectDto[] = [];
      for (const p of shared) {
        const live = and(eq(tasks.projectId, p.id), isNull(tasks.deletedAt), isNull(tasks.parentTaskId));
        const [counts] = await tx
          .select({ total: sql<number>`count(*)::int`, done: sql<number>`count(${tasks.completedAt})::int`, updated: sql<Date | null>`max(${tasks.updatedAt})` })
          .from(tasks)
          .where(live);
        const columns = await tx
          .select({ name: boardColumns.name, open: sql<number>`count(${tasks.id}) filter (where ${tasks.completedAt} is null)::int` })
          .from(boardColumns)
          .leftJoin(tasks, and(eq(tasks.columnId, boardColumns.id), isNull(tasks.deletedAt), isNull(tasks.parentTaskId)))
          .where(eq(boardColumns.projectId, p.id))
          .groupBy(boardColumns.id, boardColumns.name, boardColumns.position)
          .orderBy(asc(boardColumns.position));
        const [time] = await tx
          .select({
            all: sql<number>`coalesce(sum(${timeEntries.minutes}), 0)::int`,
            month: sql<number>`coalesce(sum(${timeEntries.minutes}) filter (where ${timeEntries.workDate} >= ${monthStart}), 0)::int`,
          })
          .from(timeEntries)
          .where(and(eq(timeEntries.projectId, p.id), approved));
        const upcoming = await tx
          .select({ title: tasks.title, dueDate: tasks.dueDate })
          .from(tasks)
          .where(and(live, isNull(tasks.completedAt), sql`${tasks.dueDate} between ${today} and ${addDays(today, 14)}`))
          .orderBy(asc(tasks.dueDate))
          .limit(5);
        const total = counts?.total ?? 0;
        const done = counts?.done ?? 0;
        out.push({
          id: p.id,
          name: p.name,
          status: p.status,
          tasks: { total, done, percent: total ? Math.round((done / total) * 100) : 0 },
          columns,
          budgetHours: p.budgetHours,
          approvedHours: hours(time?.all ?? 0),
          hoursThisMonth: hours(time?.month ?? 0),
          upcoming: upcoming.map((u) => ({ title: u.title, dueDate: u.dueDate! })),
          updatedAt: counts?.updated ? new Date(counts.updated).toISOString() : null,
        });
      }

      // The last six months, including this one.
      const first = new Date(`${monthStart}T00:00:00Z`);
      first.setUTCMonth(first.getUTCMonth() - 5);
      const from = first.toISOString().slice(0, 10);
      const byMonth = ids.length
        ? await tx
            .select({ month: sql<string>`to_char(${timeEntries.workDate}, 'YYYY-MM')`, minutes: sql<number>`sum(${timeEntries.minutes})::int` })
            .from(timeEntries)
            .where(and(inArray(timeEntries.projectId, ids), approved, sql`${timeEntries.workDate} >= ${from}`))
            .groupBy(sql`1`)
        : [];
      const hoursByMonth = Array.from({ length: 6 }, (_, i) => {
        const d = new Date(first);
        d.setUTCMonth(d.getUTCMonth() + i);
        const month = d.toISOString().slice(0, 7);
        return { month, hours: hours(byMonth.find((m) => m.month === month)?.minutes ?? 0) };
      });

      const docs = await tx
        .select()
        .from(clientDocuments)
        .where(and(eq(clientDocuments.workspaceId, ws.id), eq(clientDocuments.companyId, clientId), inArray(clientDocuments.status, [...CLIENT_VISIBLE])))
        .orderBy(desc(clientDocuments.issueDate), desc(clientDocuments.number))
        .limit(100);

      return {
        workspaceName: w?.name ?? '',
        company: { id: client!.id, name: client!.name },
        projects: out,
        hoursByMonth,
        documents: docs.map((d) => summaryDto(d, client!.name, today)),
      };
    });
  }

  /** One quote or invoice sent to the client. */
  @Get('docs/:id')
  doc(@Param('id', ParseUUIDPipe) id: string, @Query('companyId') companyId: string | undefined, @CurrentAuth() auth: AuthContext, @CurrentWorkspace() ws: WorkspaceContext): Promise<ClientDocumentDto> {
    return this.db.withContext(this.ctx(auth, ws), async (tx) => {
      const clientId = await this.clientFor(tx, ws, auth, companyId);
      const doc = await loadDoc(tx, ws.id, id);
      if (doc.companyId !== clientId || !(CLIENT_VISIBLE as readonly string[]).includes(doc.status)) throw new NotFoundException('Not found');
      return documentDto(tx, ws.id, doc);
    });
  }

  // ---- Staff: who sees a client's portal, and what's shared --------------------------------

  @Get('companies/:id')
  @MinRole('manager')
  company(@Param('id', ParseUUIDPipe) id: string, @CurrentAuth() auth: AuthContext, @CurrentWorkspace() ws: WorkspaceContext): Promise<CompanyPortalDto> {
    return this.db.withContext(this.ctx(auth, ws), async (tx) => {
      await loadCompany(tx, ws.id, id);
      return this.companyPortal(tx, ws.id, id);
    });
  }

  private async companyPortal(tx: Tx, workspaceId: string, companyId: string): Promise<CompanyPortalDto> {
    const people = await tx
      .select({ userId: users.id, name: users.name, email: users.email })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(and(eq(memberships.workspaceId, workspaceId), eq(memberships.clientCompanyId, companyId), eq(memberships.role, 'guest')))
      .orderBy(asc(users.name));
    const invites = await tx
      .select({ id: invitations.id, email: invitations.email, expiresAt: invitations.expiresAt })
      .from(invitations)
      .where(and(eq(invitations.workspaceId, workspaceId), eq(invitations.clientCompanyId, companyId), isNull(invitations.acceptedAt), isNull(invitations.revokedAt), gt(invitations.expiresAt, new Date())))
      .orderBy(desc(invitations.createdAt));
    const list = await tx
      .select({ id: projects.id, name: projects.name, status: projects.status, portalVisible: projects.portalVisible })
      .from(projects)
      .where(and(eq(projects.workspaceId, workspaceId), eq(projects.clientId, companyId), ne(projects.status, 'archived')))
      .orderBy(asc(projects.name));
    return { people, invites: invites.map((i) => ({ id: i.id, email: i.email ?? '', expiresAt: i.expiresAt.toISOString() })), projects: list };
  }

  @Post('projects/:id/visibility')
  @MinRole('manager')
  @HttpCode(200)
  async visibility(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(portalVisibilitySchema)) body: z.infer<typeof portalVisibilitySchema>,
    @CurrentAuth() auth: AuthContext,
    @CurrentWorkspace() ws: WorkspaceContext,
    @ClientIp() ip: string | undefined,
  ) {
    return this.db.withContext(this.ctx(auth, ws), async (tx) => {
      const [p] = await tx.select({ clientId: projects.clientId, name: projects.name }).from(projects).where(and(eq(projects.id, id), eq(projects.workspaceId, ws.id)));
      if (!p) throw new NotFoundException('Project not found');
      if (!p.clientId) throw new BadRequestException('Give the project a client first; it’s shown on that client’s portal.');
      await tx.update(projects).set({ portalVisible: body.visible }).where(eq(projects.id, id));
      await audit(tx, { workspaceId: ws.id, actorUserId: auth.userId, action: body.visible ? 'portal.project_shared' : 'portal.project_hidden', entityType: 'project', entityId: id, metadata: { name: p.name }, ip });
      return this.companyPortal(tx, ws.id, p.clientId);
    });
  }

  /** Invites someone at the client as its contact: a free guest who sees the portal. */
  @Post('companies/:id/invite')
  @MinRole('admin')
  async invite(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(portalInviteSchema)) body: PortalInviteInput,
    @CurrentAuth() auth: AuthContext,
    @CurrentWorkspace() ws: WorkspaceContext,
    @ClientIp() ip: string | undefined,
  ): Promise<CompanyPortalDto> {
    await this.inviteLimiter.consume(ws.id);
    const result = await this.db.withContext(this.ctx(auth, ws), async (tx) => {
      const client = await loadCompany(tx, ws.id, id);
      const [existing] = await tx
        .select({ userId: memberships.userId, role: memberships.role })
        .from(memberships)
        .innerJoin(users, eq(users.id, memberships.userId))
        .where(and(eq(memberships.workspaceId, ws.id), sql`lower(${users.email}) = ${body.email}`));
      if (existing && existing.role !== 'guest') throw new ConflictException('That person is on your team already. Client contacts are guests.');
      if (existing) {
        // Already a guest: link them to this client straight away.
        await tx.update(memberships).set({ clientCompanyId: id }).where(and(eq(memberships.workspaceId, ws.id), eq(memberships.userId, existing.userId)));
        await audit(tx, { workspaceId: ws.id, actorUserId: auth.userId, action: 'portal.contact_added', entityType: 'company', entityId: id, metadata: { email: body.email }, ip });
        return { send: null, portal: await this.companyPortal(tx, ws.id, id) };
      }
      await tx
        .update(invitations)
        .set({ revokedAt: new Date() })
        .where(and(eq(invitations.workspaceId, ws.id), eq(invitations.kind, 'email'), eq(invitations.email, body.email), isNull(invitations.acceptedAt), isNull(invitations.revokedAt)));
      const token = newToken();
      const [inv] = await tx
        .insert(invitations)
        .values({ workspaceId: ws.id, kind: 'email', email: body.email, role: 'guest', clientCompanyId: id, tokenHash: hashToken(token), invitedBy: auth.userId, expiresAt: new Date(Date.now() + INVITE_TTL) })
        .returning({ id: invitations.id });
      await audit(tx, { workspaceId: ws.id, actorUserId: auth.userId, action: 'invitation.created', entityType: 'invitation', entityId: inv!.id, metadata: { email: body.email, role: 'guest', client: client.name }, ip });
      const [w] = await tx.select({ name: workspaces.name }).from(workspaces).where(eq(workspaces.id, ws.id));
      const [me] = await tx.select({ name: users.name }).from(users).where(eq(users.id, auth.userId));
      return { send: { token, workspace: w!.name, inviter: me!.name, client: client.name }, portal: await this.companyPortal(tx, ws.id, id) };
    });
    if (result.send) {
      const s = result.send;
      await this.email.send(portalInviteMessage(body.email, s.inviter, s.workspace, s.client, inviteUrl(s.token))).catch(() => {});
    }
    return result.portal;
  }

  /** Removes a contact's access to the workspace. */
  @Delete('companies/:id/people/:userId')
  @MinRole('admin')
  async removeContact(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('userId', ParseUUIDPipe) userId: string,
    @CurrentAuth() auth: AuthContext,
    @CurrentWorkspace() ws: WorkspaceContext,
    @ClientIp() ip: string | undefined,
  ): Promise<CompanyPortalDto> {
    return this.db.withContext(this.ctx(auth, ws), async (tx) => {
      const removed = await tx
        .delete(memberships)
        .where(and(eq(memberships.workspaceId, ws.id), eq(memberships.userId, userId), eq(memberships.clientCompanyId, id), eq(memberships.role, 'guest')))
        .returning({ userId: memberships.userId });
      if (removed.length === 0) throw new NotFoundException('Not a contact of this client');
      await audit(tx, { workspaceId: ws.id, actorUserId: auth.userId, action: 'portal.contact_removed', entityType: 'company', entityId: id, metadata: { userId }, ip });
      return this.companyPortal(tx, ws.id, id);
    });
  }

  @Delete('companies/:id/invites/:inviteId')
  @MinRole('admin')
  async revokeInvite(@Param('id', ParseUUIDPipe) id: string, @Param('inviteId', ParseUUIDPipe) inviteId: string, @CurrentAuth() auth: AuthContext, @CurrentWorkspace() ws: WorkspaceContext): Promise<CompanyPortalDto> {
    return this.db.withContext(this.ctx(auth, ws), async (tx) => {
      await tx
        .update(invitations)
        .set({ revokedAt: new Date() })
        .where(and(eq(invitations.id, inviteId), eq(invitations.workspaceId, ws.id), eq(invitations.clientCompanyId, id), isNull(invitations.acceptedAt)));
      return this.companyPortal(tx, ws.id, id);
    });
  }
}
