import { BadRequestException, Body, ConflictException, Controller, Delete, ForbiddenException, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import {
  activitySchema,
  dealSchema,
  hasRole,
  moveDealSchema,
  pipelineSchema,
  updateActivitySchema,
  updateDealSchema,
  winDealSchema,
  type CrmActivityDto,
  type ActivityInput,
  type DealDto,
  type DealInput,
  type MoveDealInput,
  type PipelineDto,
  type PipelineInput,
  type UpdateActivityInput,
  type UpdateDealInput,
  type WinDealInput,
} from '@workhub/shared';
import { and, asc, desc, eq, ilike, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { Track } from '../analytics/track';
import { audit } from '../audit/audit';
import { isUniqueViolation } from '../common/db-errors';
import { AuthContext, ClientIp, CurrentAuth, CurrentWorkspace, MinRole, WorkspaceContext } from '../common/request';
import { ZodPipe } from '../common/zod.pipe';
import { DbService, Tx } from '../db/db.service';
import { activities, contacts, deals, leads, pipelines, pipelineStages, workspaces } from '../db/schema';
import { createProject } from '../projects/create';
import { WorkspaceGuard } from '../workspaces/workspace.guard';
import { assertCompany, assertOwner, canDelete, forbidDelete, likeTerm, loadCompany } from './crm';
import { activityDtos, dealDtos, endOfStage, ensureDefaultPipeline, loadDeal, loadStage, pipelineDtos, positionAt, resolveStage, writeStages } from './deals';

const id = z.string().uuid();

async function assertContact(tx: Tx, workspaceId: string, contactId: string | null | undefined) {
  if (!contactId) return;
  const [c] = await tx
    .select({ id: contacts.id })
    .from(contacts)
    .where(and(eq(contacts.id, contactId), eq(contacts.workspaceId, workspaceId), isNull(contacts.deletedAt)));
  if (!c) throw new BadRequestException('Choose a contact in this workspace.');
}

async function assertLead(tx: Tx, workspaceId: string, leadId: string | null | undefined) {
  if (!leadId) return;
  const [l] = await tx
    .select({ id: leads.id })
    .from(leads)
    .where(and(eq(leads.id, leadId), eq(leads.workspaceId, workspaceId), isNull(leads.deletedAt)));
  if (!l) throw new BadRequestException('Choose a lead in this workspace.');
}

/**
 * Sales pipelines and deals (a Kanban board per pipeline, any currency), activities on
 * any CRM record, follow-ups with reminders, and won deals that start a project.
 */
@Controller('crm')
@UseGuards(WorkspaceGuard)
@MinRole('member')
export class DealsController {
  constructor(private readonly db: DbService) {}

  private ctx(auth: AuthContext, ws: WorkspaceContext) {
    return { workspaceId: ws.id, userId: auth.userId };
  }

  // ---- Pipelines -----------------------------------------------------------------------

  @Get('pipelines')
  async pipelines(@CurrentAuth() auth: AuthContext, @CurrentWorkspace() ws: WorkspaceContext): Promise<PipelineDto[]> {
    return this.db.withContext(this.ctx(auth, ws), async (tx) => {
      await ensureDefaultPipeline(tx, ws.id);
      return pipelineDtos(tx, ws.id);
    });
  }

  @Post('pipelines')
  @MinRole('manager')
  async createPipeline(@Body(new ZodPipe(pipelineSchema)) body: PipelineInput, @CurrentAuth() auth: AuthContext, @CurrentWorkspace() ws: WorkspaceContext): Promise<PipelineDto> {
    try {
      return await this.db.withContext(this.ctx(auth, ws), async (tx) => {
        await ensureDefaultPipeline(tx, ws.id);
        const [p] = await tx.insert(pipelines).values({ workspaceId: ws.id, name: body.name, position: 1 }).returning({ id: pipelines.id });
        await writeStages(tx, ws.id, p!.id, body.stages);
        return (await pipelineDtos(tx, ws.id, p!.id))[0]!;
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw new ConflictException(`There’s already a pipeline called ${body.name}.`);
      throw err;
    }
  }

  /** Renames a pipeline and sets its open stages: kept (by id), renamed, reordered, added or removed. */
  @Patch('pipelines/:id')
  @MinRole('manager')
  async updatePipeline(
    @Param('id', ParseUUIDPipe) pipelineId: string,
    @Body(new ZodPipe(pipelineSchema)) body: PipelineInput,
    @CurrentAuth() auth: AuthContext,
    @CurrentWorkspace() ws: WorkspaceContext,
  ): Promise<PipelineDto> {
    try {
      return await this.db.withContext(this.ctx(auth, ws), async (tx) => {
        const [current] = await pipelineDtos(tx, ws.id, pipelineId);
        if (!current) throw new BadRequestException('Pipeline not found');
        const open = current.stages.filter((s) => s.kind === 'open');
        const keep = new Set(body.stages.map((s) => s.id).filter(Boolean));
        for (const s of body.stages) if (s.id && !open.some((o) => o.id === s.id)) throw new BadRequestException('A stage belongs to another pipeline.');
        const removed = open.filter((s) => !keep.has(s.id));
        if (removed.length > 0) {
          const [{ n }] = (await tx
            .select({ n: sql<number>`count(*)::int` })
            .from(deals)
            .where(
              and(
                inArray(
                  deals.stageId,
                  removed.map((s) => s.id),
                ),
                isNull(deals.deletedAt),
              ),
            )) as [{ n: number }];
          if (n > 0) throw new ConflictException(`Move the ${n} deal${n === 1 ? '' : 's'} out of ${removed.map((s) => s.name).join(', ')} first.`);
          await tx.delete(pipelineStages).where(
            inArray(
              pipelineStages.id,
              removed.map((s) => s.id),
            ),
          );
        }
        await tx.update(pipelines).set({ name: body.name }).where(eq(pipelines.id, pipelineId));
        for (const [i, s] of body.stages.entries()) {
          if (s.id) await tx.update(pipelineStages).set({ name: s.name, probability: s.probability, position: i }).where(eq(pipelineStages.id, s.id));
          else await tx.insert(pipelineStages).values({ workspaceId: ws.id, pipelineId, name: s.name, probability: s.probability, kind: 'open', position: i });
        }
        return (await pipelineDtos(tx, ws.id, pipelineId))[0]!;
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw new ConflictException(`There’s already a pipeline called ${body.name}.`);
      throw err;
    }
  }

  @Delete('pipelines/:id')
  @MinRole('manager')
  @HttpCode(204)
  async deletePipeline(@Param('id', ParseUUIDPipe) pipelineId: string, @CurrentAuth() auth: AuthContext, @CurrentWorkspace() ws: WorkspaceContext) {
    await this.db.withContext(this.ctx(auth, ws), async (tx) => {
      const [p] = await tx
        .select()
        .from(pipelines)
        .where(and(eq(pipelines.id, pipelineId), eq(pipelines.workspaceId, ws.id), isNull(pipelines.archivedAt)));
      if (!p) throw new BadRequestException('Pipeline not found');
      if (p.isDefault) throw new BadRequestException('The default pipeline can’t be removed.');
      const [{ n }] = (await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(deals)
        .where(and(eq(deals.pipelineId, pipelineId), eq(deals.status, 'open'), isNull(deals.deletedAt)))) as [{ n: number }];
      if (n > 0) throw new ConflictException(`It still has ${n} open deal${n === 1 ? '' : 's'}.`);
      await tx.update(pipelines).set({ archivedAt: new Date() }).where(eq(pipelines.id, pipelineId));
    });
  }

  // ---- Deals ---------------------------------------------------------------------------

  /** Deals in a pipeline (the default one if not given), for the board or the list. */
  @Get('deals')
  async deals(
    @Query('pipelineId') pipelineId: string | undefined,
    @Query('status') status: string | undefined,
    @Query('companyId') companyId: string | undefined,
    @Query('q') q: string | undefined,
    @CurrentAuth() auth: AuthContext,
    @CurrentWorkspace() ws: WorkspaceContext,
  ): Promise<DealDto[]> {
    if ((pipelineId && !id.safeParse(pipelineId).success) || (companyId && !id.safeParse(companyId).success)) throw new BadRequestException('Ids must be ids');
    const st = status ? z.enum(['open', 'won', 'lost']).safeParse(status) : null;
    if (st && !st.success) throw new BadRequestException('status must be open, won or lost');
    return this.db.withContext(this.ctx(auth, ws), async (tx) => {
      await ensureDefaultPipeline(tx, ws.id);
      let pid = pipelineId;
      if (!pid && !companyId) {
        const [p] = await tx
          .select({ id: pipelines.id })
          .from(pipelines)
          .where(and(eq(pipelines.workspaceId, ws.id), eq(pipelines.isDefault, true), isNull(pipelines.archivedAt)));
        pid = p?.id;
      }
      const term = q?.trim().slice(0, 100);
      const rows = await tx
        .select()
        .from(deals)
        .where(
          and(
            eq(deals.workspaceId, ws.id),
            isNull(deals.deletedAt),
            pid ? eq(deals.pipelineId, pid) : undefined,
            companyId ? eq(deals.companyId, companyId) : undefined,
            st?.data ? eq(deals.status, st.data) : undefined,
            term ? ilike(deals.title, likeTerm(term)) : undefined,
          ),
        )
        .orderBy(asc(deals.position), desc(deals.createdAt))
        .limit(1000);
      return dealDtos(tx, rows);
    });
  }

  @Post('deals')
  @Track('deal created')
  async createDeal(@Body(new ZodPipe(dealSchema)) body: DealInput, @CurrentAuth() auth: AuthContext, @CurrentWorkspace() ws: WorkspaceContext): Promise<DealDto> {
    return this.db.withContext(this.ctx(auth, ws), async (tx) => {
      await assertOwner(tx, ws.id, body.ownerId);
      await assertCompany(tx, ws.id, body.companyId);
      await assertContact(tx, ws.id, body.contactId);
      const stage = await resolveStage(tx, ws.id, body.pipelineId, body.stageId);
      if (stage.kind !== 'open') throw new BadRequestException('Start a deal in an open stage.');
      const [w] = await tx.select({ currency: workspaces.currency }).from(workspaces).where(eq(workspaces.id, ws.id));
      const [row] = await tx
        .insert(deals)
        .values({
          workspaceId: ws.id,
          pipelineId: stage.pipelineId,
          stageId: stage.id,
          title: body.title,
          value: body.value ?? null,
          currency: body.currency ?? w!.currency,
          companyId: body.companyId ?? null,
          contactId: body.contactId ?? null,
          ownerId: body.ownerId === undefined ? auth.userId : body.ownerId,
          expectedClose: body.expectedClose ?? null,
          notes: body.notes || null,
          position: await endOfStage(tx, stage.id),
          createdBy: auth.userId,
        })
        .returning();
      return (await dealDtos(tx, [row!]))[0]!;
    });
  }

  @Get('deals/:id')
  async deal(@Param('id', ParseUUIDPipe) dealId: string, @CurrentAuth() auth: AuthContext, @CurrentWorkspace() ws: WorkspaceContext): Promise<DealDto> {
    return this.db.withContext(this.ctx(auth, ws), async (tx) => (await dealDtos(tx, [await loadDeal(tx, ws.id, dealId)]))[0]!);
  }

  @Patch('deals/:id')
  async updateDeal(
    @Param('id', ParseUUIDPipe) dealId: string,
    @Body(new ZodPipe(updateDealSchema)) body: UpdateDealInput,
    @CurrentAuth() auth: AuthContext,
    @CurrentWorkspace() ws: WorkspaceContext,
  ): Promise<DealDto> {
    return this.db.withContext(this.ctx(auth, ws), async (tx) => {
      await loadDeal(tx, ws.id, dealId);
      await assertOwner(tx, ws.id, body.ownerId);
      await assertCompany(tx, ws.id, body.companyId);
      await assertContact(tx, ws.id, body.contactId);
      const [row] = await tx
        .update(deals)
        .set({
          ...(body.title !== undefined ? { title: body.title } : {}),
          ...(body.value !== undefined ? { value: body.value } : {}),
          ...(body.currency !== undefined ? { currency: body.currency } : {}),
          ...(body.companyId !== undefined ? { companyId: body.companyId } : {}),
          ...(body.contactId !== undefined ? { contactId: body.contactId } : {}),
          ...(body.ownerId !== undefined ? { ownerId: body.ownerId } : {}),
          ...(body.expectedClose !== undefined ? { expectedClose: body.expectedClose } : {}),
          ...(body.notes !== undefined ? { notes: body.notes || null } : {}),
        })
        .where(eq(deals.id, dealId))
        .returning();
      return (await dealDtos(tx, [row!]))[0]!;
    });
  }

  /** Moves a deal on the board. Into Won or Lost it's closed; back into an open stage it's reopened. */
  @Post('deals/:id/move')
  async move(
    @Param('id', ParseUUIDPipe) dealId: string,
    @Body(new ZodPipe(moveDealSchema)) body: MoveDealInput,
    @CurrentAuth() auth: AuthContext,
    @CurrentWorkspace() ws: WorkspaceContext,
  ): Promise<DealDto> {
    return this.db.withContext(this.ctx(auth, ws), async (tx) => {
      const deal = await loadDeal(tx, ws.id, dealId);
      const stage = await loadStage(tx, ws.id, body.stageId);
      if (stage.pipelineId !== deal.pipelineId) throw new BadRequestException('That stage belongs to another pipeline.');
      const now = new Date();
      const [row] = await tx
        .update(deals)
        .set({
          stageId: stage.id,
          status: stage.kind,
          position: body.index === undefined ? await endOfStage(tx, stage.id) : await positionAt(tx, stage.id, body.index, dealId),
          wonAt: stage.kind === 'won' ? (deal.wonAt ?? now) : null,
          lostAt: stage.kind === 'lost' ? (deal.lostAt ?? now) : null,
          lostReason: stage.kind === 'lost' ? (body.lostReason || deal.lostReason) : null,
        })
        .where(eq(deals.id, dealId))
        .returning();
      return (await dealDtos(tx, [row!]))[0]!;
    });
  }

  /** Marks a deal won and, if asked, starts its project for the deal's company. */
  @Post('deals/:id/win')
  @Track('deal won')
  async win(
    @Param('id', ParseUUIDPipe) dealId: string,
    @Body(new ZodPipe(winDealSchema)) body: WinDealInput,
    @CurrentAuth() auth: AuthContext,
    @CurrentWorkspace() ws: WorkspaceContext,
    @ClientIp() ip: string | undefined,
  ): Promise<DealDto> {
    if (body.project && !hasRole(ws.role, 'manager')) throw new ForbiddenException('Only managers can create projects. Mark it won, and ask a manager to start the project.');
    return this.db.withContext(this.ctx(auth, ws), async (tx) => {
      const deal = await loadDeal(tx, ws.id, dealId);
      if (body.project && deal.projectId) throw new ConflictException('This deal already has a project.');
      const [won] = await tx
        .select()
        .from(pipelineStages)
        .where(and(eq(pipelineStages.pipelineId, deal.pipelineId), eq(pipelineStages.kind, 'won')));
      let projectId = deal.projectId;
      if (body.project) {
        if (deal.companyId) await loadCompany(tx, ws.id, deal.companyId);
        projectId = await createProject(
          tx,
          ws.id,
          auth.userId,
          { name: body.project.name, templateId: body.project.templateId, clientId: deal.companyId, description: deal.notes ?? undefined },
          ip,
          `deal:${deal.id}`,
        );
      }
      const [row] = await tx
        .update(deals)
        .set({ stageId: won!.id, status: 'won', wonAt: deal.wonAt ?? new Date(), lostAt: null, lostReason: null, projectId, position: deal.status === 'won' ? deal.position : await endOfStage(tx, won!.id) })
        .where(eq(deals.id, dealId))
        .returning();
      return (await dealDtos(tx, [row!]))[0]!;
    });
  }

  @Delete('deals/:id')
  @HttpCode(204)
  async deleteDeal(@Param('id', ParseUUIDPipe) dealId: string, @CurrentAuth() auth: AuthContext, @CurrentWorkspace() ws: WorkspaceContext, @ClientIp() ip: string | undefined) {
    await this.db.withContext(this.ctx(auth, ws), async (tx) => {
      const deal = await loadDeal(tx, ws.id, dealId);
      if (!canDelete(ws, deal, auth.userId)) forbidDelete();
      await tx.update(deals).set({ deletedAt: new Date() }).where(eq(deals.id, dealId));
      await audit(tx, { workspaceId: ws.id, actorUserId: auth.userId, action: 'deal.deleted', entityType: 'deal', entityId: dealId, metadata: { title: deal.title }, ip });
    });
  }

  // ---- Activities ----------------------------------------------------------------------

  /** Activities on one record, newest first; open follow-ups first. */
  @Get('activities')
  async activities(
    @Query('dealId') dealId: string | undefined,
    @Query('companyId') companyId: string | undefined,
    @Query('contactId') contactId: string | undefined,
    @Query('leadId') leadId: string | undefined,
    @CurrentAuth() auth: AuthContext,
    @CurrentWorkspace() ws: WorkspaceContext,
  ): Promise<CrmActivityDto[]> {
    const ids = { dealId, companyId, contactId, leadId };
    for (const v of Object.values(ids)) if (v && !id.safeParse(v).success) throw new BadRequestException('Ids must be ids');
    if (!dealId && !companyId && !contactId && !leadId) throw new BadRequestException('Give a dealId, companyId, contactId or leadId');
    return this.db.withContext(this.ctx(auth, ws), async (tx) => {
      const rows = await tx
        .select()
        .from(activities)
        .where(
          and(
            eq(activities.workspaceId, ws.id),
            dealId ? eq(activities.dealId, dealId) : undefined,
            companyId ? eq(activities.companyId, companyId) : undefined,
            contactId ? eq(activities.contactId, contactId) : undefined,
            leadId ? eq(activities.leadId, leadId) : undefined,
          ),
        )
        .orderBy(sql`${activities.doneAt} is null and ${activities.dueAt} is not null desc`, asc(activities.dueAt), desc(activities.createdAt))
        .limit(200);
      return activityDtos(tx, rows);
    });
  }

  /** Open follow-ups: yours, or (for managers) everyone's. Overdue first. */
  @Get('follow-ups')
  async followUps(@Query('scope') scope: string | undefined, @CurrentAuth() auth: AuthContext, @CurrentWorkspace() ws: WorkspaceContext): Promise<CrmActivityDto[]> {
    const everyone = scope === 'all' && hasRole(ws.role, 'manager');
    return this.db.withContext(this.ctx(auth, ws), async (tx) => {
      const rows = await tx
        .select()
        .from(activities)
        .where(and(eq(activities.workspaceId, ws.id), isNull(activities.doneAt), isNotNull(activities.dueAt), everyone ? undefined : eq(activities.ownerId, auth.userId)))
        .orderBy(asc(activities.dueAt))
        .limit(300);
      return activityDtos(tx, rows);
    });
  }

  @Post('activities')
  @Track('activity logged')
  async createActivity(@Body(new ZodPipe(activitySchema)) body: ActivityInput, @CurrentAuth() auth: AuthContext, @CurrentWorkspace() ws: WorkspaceContext): Promise<CrmActivityDto> {
    return this.db.withContext(this.ctx(auth, ws), async (tx) => {
      await assertOwner(tx, ws.id, body.ownerId);
      let companyId = body.companyId ?? null;
      if (body.dealId) {
        const deal = await loadDeal(tx, ws.id, body.dealId);
        // An activity on a deal also shows on its company.
        companyId ??= deal.companyId;
      }
      await assertCompany(tx, ws.id, companyId);
      await assertContact(tx, ws.id, body.contactId);
      await assertLead(tx, ws.id, body.leadId);
      const now = new Date();
      const [row] = await tx
        .insert(activities)
        .values({
          workspaceId: ws.id,
          kind: body.kind,
          subject: body.subject,
          body: body.body || null,
          dueAt: body.dueAt ? new Date(body.dueAt) : null,
          // Logged after the fact (a call that happened) unless it's scheduled for later.
          doneAt: body.done || (!body.dueAt && body.kind !== 'task') ? now : null,
          dealId: body.dealId ?? null,
          companyId,
          contactId: body.contactId ?? null,
          leadId: body.leadId ?? null,
          ownerId: body.ownerId === undefined ? auth.userId : body.ownerId,
          // A follow-up set in the past needs no reminder.
          remindedAt: body.dueAt && new Date(body.dueAt) <= now ? now : null,
          createdBy: auth.userId,
        })
        .returning();
      return (await activityDtos(tx, [row!]))[0]!;
    });
  }

  @Patch('activities/:id')
  async updateActivity(
    @Param('id', ParseUUIDPipe) activityId: string,
    @Body(new ZodPipe(updateActivitySchema)) body: UpdateActivityInput,
    @CurrentAuth() auth: AuthContext,
    @CurrentWorkspace() ws: WorkspaceContext,
  ): Promise<CrmActivityDto> {
    return this.db.withContext(this.ctx(auth, ws), async (tx) => {
      const [row] = await tx
        .select()
        .from(activities)
        .where(and(eq(activities.id, activityId), eq(activities.workspaceId, ws.id)));
      if (!row) throw new BadRequestException('Activity not found');
      await assertOwner(tx, ws.id, body.ownerId);
      const dueChanged = body.dueAt !== undefined && (body.dueAt ? new Date(body.dueAt).getTime() : null) !== (row.dueAt?.getTime() ?? null);
      const [updated] = await tx
        .update(activities)
        .set({
          ...(body.kind !== undefined ? { kind: body.kind } : {}),
          ...(body.subject !== undefined ? { subject: body.subject } : {}),
          ...(body.body !== undefined ? { body: body.body || null } : {}),
          ...(body.dueAt !== undefined ? { dueAt: body.dueAt ? new Date(body.dueAt) : null } : {}),
          // A new due time gets a new reminder.
          ...(dueChanged ? { remindedAt: body.dueAt && new Date(body.dueAt) <= new Date() ? new Date() : null } : {}),
          ...(body.done !== undefined ? { doneAt: body.done ? (row.doneAt ?? new Date()) : null } : {}),
          ...(body.ownerId !== undefined ? { ownerId: body.ownerId } : {}),
        })
        .where(eq(activities.id, activityId))
        .returning();
      return (await activityDtos(tx, [updated!]))[0]!;
    });
  }

  @Delete('activities/:id')
  @HttpCode(204)
  async deleteActivity(@Param('id', ParseUUIDPipe) activityId: string, @CurrentAuth() auth: AuthContext, @CurrentWorkspace() ws: WorkspaceContext) {
    await this.db.withContext(this.ctx(auth, ws), async (tx) => {
      const [row] = await tx
        .select()
        .from(activities)
        .where(and(eq(activities.id, activityId), eq(activities.workspaceId, ws.id)));
      if (!row) throw new BadRequestException('Activity not found');
      if (!canDelete(ws, row, auth.userId)) forbidDelete();
      await tx.delete(activities).where(eq(activities.id, activityId));
    });
  }
}

