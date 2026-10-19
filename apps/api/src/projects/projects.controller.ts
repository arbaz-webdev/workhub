import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  HttpCode,
  MessageEvent,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Sse,
  UseGuards,
} from '@nestjs/common';
import {
  createColumnSchema,
  createCompanySchema,
  createLabelSchema,
  createProjectSchema,
  moveSchema,
  projectMemberSchema,
  updateColumnSchema,
  updateProjectSchema,
  type BoardDto,
  type ColumnDto,
  type CompanyDto,
  type CreateCompanyInput,
  type CreateLabelInput,
  type CreateProjectInput,
  type LabelDto,
  type ProjectSummaryDto,
  type UpdateColumnInput,
  type UpdateProjectInput,
} from '@workhub/shared';
import { and, asc, count, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { Observable } from 'rxjs';
import { audit } from '../audit/audit';
import { AuthContext, ClientIp, CurrentAuth, CurrentWorkspace, MinRole, WorkspaceContext } from '../common/request';
import { ZodPipe } from '../common/zod.pipe';
import { DbService, Tx } from '../db/db.service';
import {
  boardColumns,
  companies,
  labels,
  memberships,
  projectMembers,
  projects,
  tasks,
  users,
} from '../db/schema';
import { notify } from '../notifications/notify';
import { RealtimeService } from '../realtime/realtime.service';
import { WorkspaceGuard } from '../workspaces/workspace.guard';
import { asLabelColor, canEdit, canManage, cardsFor, columnPosition, GAP, loadColumn, loadProject, requireEdit, requireManage } from './board';

const DEFAULT_COLUMNS = ['To do', 'In progress', 'Review', 'Done'];

@Controller()
@UseGuards(WorkspaceGuard)
@MinRole('guest') // guests reach their own projects; each route enforces edit/manage rights
export class ProjectsController {
  constructor(
    private readonly db: DbService,
    private readonly realtime: RealtimeService,
  ) {}

  // ---- Clients (minimal until the CRM sprint) ------------------------------

  @Get('companies')
  @MinRole('member') // guests are often outsiders; they don't see the client list
  companies(@CurrentAuth() auth: AuthContext, @CurrentWorkspace() ws: WorkspaceContext): Promise<CompanyDto[]> {
    return this.db.withContext({ workspaceId: ws.id, userId: auth.userId }, (tx) =>
      tx
        .select({ id: companies.id, name: companies.name })
        .from(companies)
        .where(and(eq(companies.workspaceId, ws.id), isNull(companies.deletedAt)))
        .orderBy(asc(sql`lower(${companies.name})`)),
    );
  }

  @Post('companies')
  @MinRole('manager')
  async createCompany(
    @Body(new ZodPipe(createCompanySchema)) body: CreateCompanyInput,
    @CurrentAuth() auth: AuthContext,
    @CurrentWorkspace() ws: WorkspaceContext,
  ): Promise<CompanyDto> {
    const [row] = await this.db.withContext({ workspaceId: ws.id, userId: auth.userId }, (tx) =>
      tx
        .insert(companies)
        .values({ workspaceId: ws.id, name: body.name, createdBy: auth.userId })
        .returning({ id: companies.id, name: companies.name }),
    );
    return row!;
  }

  // ---- Projects --------------------------------------------------------------

  @Get('projects')
  list(@CurrentAuth() auth: AuthContext, @CurrentWorkspace() ws: WorkspaceContext): Promise<ProjectSummaryDto[]> {
    return this.db.withContext({ workspaceId: ws.id, userId: auth.userId }, (tx) =>
      this.summaries(tx, ws, auth.userId),
    );
  }

  @Post('projects')
  @MinRole('manager')
  async create(
    @Body(new ZodPipe(createProjectSchema)) body: CreateProjectInput,
    @CurrentAuth() auth: AuthContext,
    @CurrentWorkspace() ws: WorkspaceContext,
    @ClientIp() ip: string | undefined,
  ): Promise<ProjectSummaryDto> {
    return this.db.withContext({ workspaceId: ws.id, userId: auth.userId }, async (tx) => {
      if (body.clientId) await this.assertCompany(tx, ws.id, body.clientId);
      const [project] = await tx
        .insert(projects)
        .values({
          workspaceId: ws.id,
          name: body.name,
          description: body.description || null,
          clientId: body.clientId ?? null,
          budgetHours: body.budgetHours ?? null,
          createdBy: auth.userId,
        })
        .returning();
      await tx.insert(boardColumns).values(
        DEFAULT_COLUMNS.map((name, i) => ({ workspaceId: ws.id, projectId: project!.id, name, position: (i + 1) * GAP })),
      );
      await tx.insert(projectMembers).values({ workspaceId: ws.id, projectId: project!.id, userId: auth.userId });
      await audit(tx, {
        workspaceId: ws.id,
        actorUserId: auth.userId,
        action: 'project.created',
        entityType: 'project',
        entityId: project!.id,
        metadata: { name: body.name },
        ip,
      });
      return (await this.summaries(tx, ws, auth.userId, project!.id))[0]!;
    });
  }

  @Get('projects/:id')
  board(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentAuth() auth: AuthContext,
    @CurrentWorkspace() ws: WorkspaceContext,
  ): Promise<BoardDto> {
    return this.db.withContext({ workspaceId: ws.id, userId: auth.userId }, async (tx) => {
      const project = await loadProject(tx, ws, auth.userId, id);
      const [summary] = await this.summaries(tx, ws, auth.userId, id);
      return {
        project: { ...summary!, description: project.description },
        columns: await this.columns(tx, id),
        tasks: await cardsFor(tx, id),
        labels: await this.labels(tx, id),
        people: await this.people(tx, ws.id, id),
        canManage: canManage(ws),
        canEdit: canEdit(ws),
      };
    });
  }

  @Patch('projects/:id')
  @MinRole('manager')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(updateProjectSchema)) body: UpdateProjectInput,
    @CurrentAuth() auth: AuthContext,
    @CurrentWorkspace() ws: WorkspaceContext,
  ): Promise<ProjectSummaryDto> {
    const result = await this.db.withContext({ workspaceId: ws.id, userId: auth.userId }, async (tx) => {
      await loadProject(tx, ws, auth.userId, id);
      if (body.clientId) await this.assertCompany(tx, ws.id, body.clientId);
      if (Object.keys(body).length > 0) await tx.update(projects).set(body).where(eq(projects.id, id));
      return (await this.summaries(tx, ws, auth.userId, id))[0]!;
    });
    this.realtime.publish(ws.id, id, { type: 'project.changed' });
    return result;
  }

  @Post('projects/:id/members')
  @MinRole('manager')
  @HttpCode(204)
  async addMember(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(projectMemberSchema)) body: { userId: string },
    @CurrentAuth() auth: AuthContext,
    @CurrentWorkspace() ws: WorkspaceContext,
  ) {
    await this.db.withContext({ workspaceId: ws.id, userId: auth.userId }, async (tx) => {
      const project = await loadProject(tx, ws, auth.userId, id);
      const [m] = await tx
        .select({ userId: memberships.userId })
        .from(memberships)
        .where(and(eq(memberships.workspaceId, ws.id), eq(memberships.userId, body.userId)));
      if (!m) throw new BadRequestException('That person is not in this workspace');
      const added = await tx
        .insert(projectMembers)
        .values({ workspaceId: ws.id, projectId: id, userId: body.userId })
        .onConflictDoNothing()
        .returning({ userId: projectMembers.userId });
      if (added.length > 0 && body.userId !== auth.userId) {
        await notify(tx, ws.id, [body.userId], {
          type: 'project.added',
          title: `You were added to ${project.name}`,
          link: `/app/projects/${id}`,
        });
      }
    });
    this.realtime.publish(ws.id, id, { type: 'project.changed' });
  }

  @Delete('projects/:id/members/:userId')
  @MinRole('manager')
  @HttpCode(204)
  async removeMember(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('userId', ParseUUIDPipe) userId: string,
    @CurrentAuth() auth: AuthContext,
    @CurrentWorkspace() ws: WorkspaceContext,
  ) {
    await this.db.withContext({ workspaceId: ws.id, userId: auth.userId }, async (tx) => {
      await loadProject(tx, ws, auth.userId, id);
      await tx.delete(projectMembers).where(and(eq(projectMembers.projectId, id), eq(projectMembers.userId, userId)));
    });
    this.realtime.publish(ws.id, id, { type: 'project.changed' });
  }

  // ---- Live updates ------------------------------------------------------------

  /** Server-Sent Events for one board. The browser passes ?workspace= since EventSource can't send headers. */
  @Sse('projects/:id/events')
  async events(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentAuth() auth: AuthContext,
    @CurrentWorkspace() ws: WorkspaceContext,
  ): Promise<Observable<MessageEvent>> {
    await this.db.withContext({ workspaceId: ws.id, userId: auth.userId }, (tx) => loadProject(tx, ws, auth.userId, id));
    return this.realtime.board(ws.id, id);
  }

  // ---- Columns -------------------------------------------------------------------

  @Post('projects/:id/columns')
  async addColumn(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(createColumnSchema)) body: { name: string },
    @CurrentAuth() auth: AuthContext,
    @CurrentWorkspace() ws: WorkspaceContext,
  ): Promise<ColumnDto[]> {
    requireManage(ws);
    return this.columnsChanged(ws, auth, id, async (tx) => {
      const position = await columnPosition(tx, id, Number.MAX_SAFE_INTEGER);
      await tx.insert(boardColumns).values({ workspaceId: ws.id, projectId: id, name: body.name, position });
    });
  }

  @Patch('projects/:id/columns/:columnId')
  async updateColumn(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('columnId', ParseUUIDPipe) columnId: string,
    @Body(new ZodPipe(updateColumnSchema)) body: UpdateColumnInput,
    @CurrentAuth() auth: AuthContext,
    @CurrentWorkspace() ws: WorkspaceContext,
  ): Promise<ColumnDto[]> {
    requireManage(ws);
    return this.columnsChanged(ws, auth, id, async (tx) => {
      await loadColumn(tx, id, columnId);
      if (Object.keys(body).length > 0) await tx.update(boardColumns).set(body).where(eq(boardColumns.id, columnId));
    });
  }

  @Post('projects/:id/columns/:columnId/move')
  async moveColumn(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('columnId', ParseUUIDPipe) columnId: string,
    @Body(new ZodPipe(moveSchema)) body: { index: number },
    @CurrentAuth() auth: AuthContext,
    @CurrentWorkspace() ws: WorkspaceContext,
  ): Promise<ColumnDto[]> {
    requireManage(ws);
    return this.columnsChanged(ws, auth, id, async (tx) => {
      await loadColumn(tx, id, columnId);
      const position = await columnPosition(tx, id, body.index, columnId);
      await tx.update(boardColumns).set({ position }).where(eq(boardColumns.id, columnId));
    });
  }

  @Delete('projects/:id/columns/:columnId')
  async deleteColumn(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('columnId', ParseUUIDPipe) columnId: string,
    @CurrentAuth() auth: AuthContext,
    @CurrentWorkspace() ws: WorkspaceContext,
  ): Promise<ColumnDto[]> {
    requireManage(ws);
    return this.columnsChanged(ws, auth, id, async (tx) => {
      await loadColumn(tx, id, columnId);
      const [{ n }] = (await tx
        .select({ n: count() })
        .from(tasks)
        .where(and(eq(tasks.columnId, columnId), isNull(tasks.deletedAt)))) as [{ n: number }];
      if (n > 0) throw new ConflictException('Move or delete the tasks in this column first');
      const [{ cols }] = (await tx
        .select({ cols: count() })
        .from(boardColumns)
        .where(eq(boardColumns.projectId, id))) as [{ cols: number }];
      if (cols <= 1) throw new ConflictException('A board needs at least one column');
      // Deleted tasks still reference the column; remove them with it.
      await tx.delete(tasks).where(eq(tasks.columnId, columnId));
      await tx.delete(boardColumns).where(eq(boardColumns.id, columnId));
    });
  }

  // ---- Labels ----------------------------------------------------------------------

  @Post('projects/:id/labels')
  async addLabel(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(createLabelSchema)) body: CreateLabelInput,
    @CurrentAuth() auth: AuthContext,
    @CurrentWorkspace() ws: WorkspaceContext,
  ): Promise<LabelDto[]> {
    requireEdit(ws);
    const result = await this.db.withContext({ workspaceId: ws.id, userId: auth.userId }, async (tx) => {
      await loadProject(tx, ws, auth.userId, id);
      await tx.insert(labels).values({ workspaceId: ws.id, projectId: id, name: body.name, color: body.color });
      return this.labels(tx, id);
    });
    this.realtime.publish(ws.id, id, { type: 'labels.changed', labels: result });
    return result;
  }

  @Delete('projects/:id/labels/:labelId')
  async deleteLabel(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('labelId', ParseUUIDPipe) labelId: string,
    @CurrentAuth() auth: AuthContext,
    @CurrentWorkspace() ws: WorkspaceContext,
  ): Promise<LabelDto[]> {
    requireManage(ws);
    const result = await this.db.withContext({ workspaceId: ws.id, userId: auth.userId }, async (tx) => {
      await loadProject(tx, ws, auth.userId, id);
      const gone = await tx
        .delete(labels)
        .where(and(eq(labels.id, labelId), eq(labels.projectId, id)))
        .returning({ id: labels.id });
      if (gone.length === 0) throw new NotFoundException('Label not found');
      return this.labels(tx, id);
    });
    this.realtime.publish(ws.id, id, { type: 'labels.changed', labels: result });
    return result;
  }

  // ---- Internals -------------------------------------------------------------------

  private async columnsChanged(
    ws: WorkspaceContext,
    auth: AuthContext,
    projectId: string,
    change: (tx: Tx) => Promise<void>,
  ): Promise<ColumnDto[]> {
    const result = await this.db.withContext({ workspaceId: ws.id, userId: auth.userId }, async (tx) => {
      await loadProject(tx, ws, auth.userId, projectId);
      await change(tx);
      return this.columns(tx, projectId);
    });
    this.realtime.publish(ws.id, projectId, { type: 'columns.changed', columns: result });
    return result;
  }

  private async assertCompany(tx: Tx, workspaceId: string, companyId: string) {
    const [c] = await tx
      .select({ id: companies.id })
      .from(companies)
      .where(and(eq(companies.id, companyId), eq(companies.workspaceId, workspaceId), isNull(companies.deletedAt)));
    if (!c) throw new BadRequestException('Client not found');
  }

  private async columns(tx: Tx, projectId: string): Promise<ColumnDto[]> {
    return tx
      .select({ id: boardColumns.id, name: boardColumns.name, position: boardColumns.position, wipLimit: boardColumns.wipLimit })
      .from(boardColumns)
      .where(eq(boardColumns.projectId, projectId))
      .orderBy(asc(boardColumns.position));
  }

  private async labels(tx: Tx, projectId: string): Promise<LabelDto[]> {
    const rows = await tx
      .select({ id: labels.id, name: labels.name, color: labels.color })
      .from(labels)
      .where(eq(labels.projectId, projectId))
      .orderBy(asc(labels.name));
    return rows.map((r) => ({ ...r, color: asLabelColor(r.color) }));
  }

  /** Workspace members who can be assigned on this project (guests only if added to it). */
  private async people(tx: Tx, workspaceId: string, projectId: string) {
    const rows = await tx
      .select({ id: users.id, name: users.name, email: users.email, role: memberships.role })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(eq(memberships.workspaceId, workspaceId))
      .orderBy(asc(users.name));
    const guests = rows.filter((r) => r.role === 'guest').map((r) => r.id);
    const onProject = guests.length
      ? new Set(
          (
            await tx
              .select({ userId: projectMembers.userId })
              .from(projectMembers)
              .where(and(eq(projectMembers.projectId, projectId), inArray(projectMembers.userId, guests)))
          ).map((r) => r.userId),
        )
      : new Set<string>();
    return rows
      .filter((r) => r.role !== 'guest' || onProject.has(r.id))
      .map(({ id, name, email }) => ({ id, name, email }));
  }

  private async summaries(tx: Tx, ws: WorkspaceContext, userId: string, onlyId?: string): Promise<ProjectSummaryDto[]> {
    const guestFilter = canEdit(ws)
      ? sql``
      : sql`and exists (select 1 from project_members pm where pm.project_id = p.id and pm.user_id = ${userId})`;
    const result = await tx.execute<{
      id: string;
      name: string;
      status: ProjectSummaryDto['status'];
      client_id: string | null;
      client_name: string | null;
      budget_hours: string | null;
      estimate_hours: string;
      open_tasks: number;
      done_tasks: number;
      updated_at: Date;
    }>(sql`
      select p.id, p.name, p.status, c.id as client_id, c.name as client_name, p.budget_hours, p.updated_at,
             coalesce((select sum(t.estimate_hours) from tasks t
                       where t.project_id = p.id and t.deleted_at is null and t.parent_task_id is null), 0) as estimate_hours,
             (select count(*) from tasks t where t.project_id = p.id and t.deleted_at is null
                and t.parent_task_id is null and t.completed_at is null)::int as open_tasks,
             (select count(*) from tasks t where t.project_id = p.id and t.deleted_at is null
                and t.parent_task_id is null and t.completed_at is not null)::int as done_tasks
      from projects p
      left join companies c on c.id = p.client_id and c.deleted_at is null
      where p.workspace_id = ${ws.id} ${guestFilter} ${onlyId ? sql`and p.id = ${onlyId}` : sql``}
      order by (p.status = 'active') desc, p.updated_at desc`);
    return result.rows.map((r) => ({
      id: r.id,
      name: r.name,
      status: r.status,
      client: r.client_id ? { id: r.client_id, name: r.client_name! } : null,
      budgetHours: r.budget_hours === null ? null : Number(r.budget_hours),
      estimateHours: Number(r.estimate_hours),
      openTasks: r.open_tasks,
      doneTasks: r.done_tasks,
      updatedAt: new Date(r.updated_at).toISOString(),
    }));
  }
}
