import { BadRequestException, Body, ConflictException, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import {
  CRM_ENTITIES,
  companySchema,
  contactSchema,
  convertLeadSchema,
  customFieldSchema,
  LEAD_SOURCES,
  LEAD_STATUSES,
  leadSchema,
  updateCustomFieldSchema,
  updateLeadSchema,
  type CompanyInput,
  type ClientOverviewDto,
  type ContactDto,
  type ContactInput,
  type ConvertLeadInput,
  type CrmCompanyDto,
  type CrmEntity,
  type CustomFieldDto,
  type CustomFieldInput,
  type DuplicateDto,
  type LeadDto,
  type LeadInput,
  type Page,
  type UpdateLeadInput,
} from '@workhub/shared';
import { and, asc, desc, eq, ilike, inArray, isNull, max, or, sql, type SQL } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { Track } from '../analytics/track';
import { workspaceInfo } from '../attendance/attendance';
import { zonedParts } from '../attendance/zoned';
import { audit } from '../audit/audit';
import { isUniqueViolation } from '../common/db-errors';
import { AuthContext, ClientIp, CurrentAuth, CurrentWorkspace, MinRole, WorkspaceContext } from '../common/request';
import { ZodPipe } from '../common/zod.pipe';
import { DbService, Tx } from '../db/db.service';
import { activities, attachments, companies, contacts, customFields, deals, leads, projects, tasks, workspaces } from '../db/schema';
import { INLINE_IMAGE_TYPES } from '../storage/storage.service';
import { WorkspaceGuard } from '../workspaces/workspace.guard';
import {
  assertCompany,
  assertOwner,
  canDelete,
  cleanCustom,
  companyDtos,
  companyDuplicates,
  companyValues,
  contactDtos,
  contactValues,
  domainOf,
  forbidDelete,
  leadDtos,
  likeTerm,
  loadCompany,
  loadContact,
  loadLead,
  normaliseWebsite,
  personDuplicates,
  phoneKey,
  splitName,
} from './crm';
import { activityDtos, dealDtos, endOfStage, resolveStage, sumByCurrency } from './deals';

const PAGE_SIZE = 50;
const pageOf = (p: string | undefined) => Math.max(1, Math.min(10_000, Number.parseInt(p ?? '1', 10) || 1));
const partial = <T extends z.ZodObject>(s: T) => s.partial();

/**
 * The CRM core: companies, contacts and leads, with custom fields and duplicate checks.
 * Everyone but guests can read and edit; deleting is for whoever added a record and
 * managers; custom fields are managed by managers.
 */
@Controller('crm')
@UseGuards(WorkspaceGuard)
@MinRole('member')
export class CrmController {
  constructor(private readonly db: DbService) {}

  private ctx(auth: AuthContext, ws: WorkspaceContext) {
    return { workspaceId: ws.id, userId: auth.userId };
  }

  // ---- Companies -----------------------------------------------------------------------

  @Get('companies')
  async companies(@Query('q') q: string | undefined, @Query('page') page: string | undefined, @CurrentAuth() auth: AuthContext, @CurrentWorkspace() ws: WorkspaceContext): Promise<Page<CrmCompanyDto>> {
    return this.db.withContext(this.ctx(auth, ws), async (tx) => {
      const term = q?.trim().slice(0, 100);
      const where = and(
        eq(companies.workspaceId, ws.id),
        isNull(companies.deletedAt),
        term ? or(ilike(companies.name, likeTerm(term)), ilike(companies.domain, likeTerm(term)), ilike(companies.city, likeTerm(term)), ilike(companies.industry, likeTerm(term))) : undefined,
      );
      const rows = await tx
        .select()
        .from(companies)
        .where(where)
        .orderBy(asc(sql`lower(${companies.name})`))
        .limit(PAGE_SIZE)
        .offset((pageOf(page) - 1) * PAGE_SIZE);
      const [{ n }] = (await tx.select({ n: sql<number>`count(*)::int` }).from(companies).where(where)) as [{ n: number }];
      return { items: await companyDtos(tx, rows), total: n };
    });
  }

  @Post('companies')
  async createCompany(@Body(new ZodPipe(companySchema)) body: CompanyInput, @CurrentAuth() auth: AuthContext, @CurrentWorkspace() ws: WorkspaceContext): Promise<CrmCompanyDto> {
    return this.db.withContext(this.ctx(auth, ws), async (tx) => {
      await assertOwner(tx, ws.id, body.ownerId);
      const [row] = await tx
        .insert(companies)
        .values({
          workspaceId: ws.id,
          ...companyValues(body),
          ownerId: body.ownerId ?? auth.userId,
          custom: await cleanCustom(tx, ws.id, 'company', body.custom),
          createdBy: auth.userId,
        })
        .returning();
      return (await companyDtos(tx, [row!]))[0]!;
    });
  }

  /**
   * Client 360: a company with its people, deals, projects (and the hours on them),
   * money won and in the pipeline, recent activity and files.
   */
  @Get('companies/:id')
  async company(@Param('id', ParseUUIDPipe) id: string, @CurrentAuth() auth: AuthContext, @CurrentWorkspace() ws: WorkspaceContext): Promise<ClientOverviewDto> {
    return this.db.withContext(this.ctx(auth, ws), async (tx) => {
      const row = await loadCompany(tx, ws.id, id);
      const people = await tx
        .select()
        .from(contacts)
        .where(and(eq(contacts.companyId, id), isNull(contacts.deletedAt)))
        .orderBy(asc(sql`lower(${contacts.firstName})`));
      const dealRows = await tx
        .select()
        .from(deals)
        .where(and(eq(deals.companyId, id), isNull(deals.deletedAt)))
        .orderBy(desc(deals.createdAt))
        .limit(200);
      const dealList = await dealDtos(tx, dealRows);

      const { timezone } = await workspaceInfo(tx, ws.id);
      const monthStart = `${zonedParts(new Date(), timezone).date.slice(0, 7)}-01`;
      const work = await tx
        .select({
          id: projects.id,
          name: projects.name,
          status: projects.status,
          budgetHours: projects.budgetHours,
          minutes: sql<number>`coalesce((select sum(t.minutes) from time_entries t where t.project_id = "projects"."id"), 0)::int`,
          billable: sql<number>`coalesce((select sum(t.minutes) from time_entries t where t.project_id = "projects"."id" and t.billable), 0)::int`,
          month: sql<number>`coalesce((select sum(t.minutes) from time_entries t where t.project_id = "projects"."id" and t.work_date >= ${monthStart}::date), 0)::int`,
        })
        .from(projects)
        .where(eq(projects.clientId, id))
        .orderBy(desc(projects.createdAt));
      const hours = (m: number) => Math.round((m / 60) * 10) / 10;

      // Activity on the company itself, its people and its deals.
      const personIds = people.map((p) => p.id);
      const dealIds = dealRows.map((d) => d.id);
      const actRows = await tx
        .select()
        .from(activities)
        .where(
          and(
            eq(activities.workspaceId, ws.id),
            or(
              eq(activities.companyId, id),
              personIds.length ? inArray(activities.contactId, personIds) : undefined,
              dealIds.length ? inArray(activities.dealId, dealIds) : undefined,
            ),
          ),
        )
        .orderBy(desc(activities.createdAt))
        .limit(40);

      const projectIds = work.map((p) => p.id);
      const files = projectIds.length
        ? await tx
            .select({
              id: attachments.id,
              fileName: attachments.fileName,
              contentType: attachments.contentType,
              sizeBytes: attachments.sizeBytes,
              createdAt: attachments.createdAt,
              projectId: tasks.projectId,
              projectName: projects.name,
            })
            .from(attachments)
            .innerJoin(tasks, eq(tasks.id, attachments.taskId))
            .innerJoin(projects, eq(projects.id, tasks.projectId))
            .where(and(inArray(tasks.projectId, projectIds), isNull(tasks.deletedAt)))
            .orderBy(desc(attachments.createdAt))
            .limit(12)
        : [];

      const open = dealList.filter((d) => d.status === 'open');
      return {
        company: (await companyDtos(tx, [row]))[0]!,
        contacts: await contactDtos(tx, people),
        deals: dealList,
        projects: work.map((p) => ({ id: p.id, name: p.name, status: p.status, budgetHours: p.budgetHours, hours: hours(p.minutes), billableHours: hours(p.billable) })),
        totals: {
          won: sumByCurrency(dealList.filter((d) => d.status === 'won')),
          open: sumByCurrency(open),
          weighted: sumByCurrency(open.map((d) => ({ ...d, weight: d.probability / 100 }))),
          hoursThisMonth: hours(work.reduce((n, p) => n + p.month, 0)),
          hoursTotal: hours(work.reduce((n, p) => n + p.minutes, 0)),
        },
        activities: await activityDtos(tx, actRows),
        files: files.map((f) => ({
          id: f.id,
          fileName: f.fileName,
          sizeBytes: f.sizeBytes,
          url: `/attachments/${f.id}?workspace=${ws.id}`,
          isImage: INLINE_IMAGE_TYPES.has(f.contentType),
          projectId: f.projectId,
          projectName: f.projectName,
          createdAt: f.createdAt.toISOString(),
        })),
      };
    });
  }

  @Patch('companies/:id')
  async updateCompany(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(partial(companySchema))) body: Partial<CompanyInput>,
    @CurrentAuth() auth: AuthContext,
    @CurrentWorkspace() ws: WorkspaceContext,
  ): Promise<CrmCompanyDto> {
    return this.db.withContext(this.ctx(auth, ws), async (tx) => {
      const row = await loadCompany(tx, ws.id, id);
      await assertOwner(tx, ws.id, body.ownerId);
      const merged = companySchema.parse({ ...row, ...body, custom: {} });
      const [updated] = await tx
        .update(companies)
        .set({
          ...companyValues(merged),
          ...(body.ownerId !== undefined ? { ownerId: body.ownerId } : {}),
          custom: await cleanCustom(tx, ws.id, 'company', body.custom ?? {}, row.custom),
        })
        .where(eq(companies.id, id))
        .returning();
      return (await companyDtos(tx, [updated!]))[0]!;
    });
  }

  /** Its contacts stay (without a company) and its projects lose their client. */
  @Delete('companies/:id')
  @HttpCode(204)
  async deleteCompany(@Param('id', ParseUUIDPipe) id: string, @CurrentAuth() auth: AuthContext, @CurrentWorkspace() ws: WorkspaceContext, @ClientIp() ip: string | undefined) {
    await this.db.withContext(this.ctx(auth, ws), async (tx) => {
      const row = await loadCompany(tx, ws.id, id);
      if (!canDelete(ws, row, auth.userId)) forbidDelete();
      await tx.update(companies).set({ deletedAt: new Date() }).where(eq(companies.id, id));
      await tx.update(contacts).set({ companyId: null }).where(eq(contacts.companyId, id));
      await tx.update(projects).set({ clientId: null }).where(eq(projects.clientId, id));
      await audit(tx, { workspaceId: ws.id, actorUserId: auth.userId, action: 'company.deleted', entityType: 'company', entityId: id, metadata: { name: row.name }, ip });
    });
  }

  // ---- Contacts -----------------------------------------------------------------------

  @Get('contacts')
  async contacts(
    @Query('q') q: string | undefined,
    @Query('companyId') companyId: string | undefined,
    @Query('page') page: string | undefined,
    @CurrentAuth() auth: AuthContext,
    @CurrentWorkspace() ws: WorkspaceContext,
  ): Promise<Page<ContactDto>> {
    if (companyId && !z.string().uuid().safeParse(companyId).success) throw new BadRequestException('companyId must be an id');
    return this.db.withContext(this.ctx(auth, ws), async (tx) => {
      const term = q?.trim().slice(0, 100);
      const digits = term?.replace(/\D/g, '');
      const where = and(
        eq(contacts.workspaceId, ws.id),
        isNull(contacts.deletedAt),
        companyId ? eq(contacts.companyId, companyId) : undefined,
        term
          ? or(
              sql`(${contacts.firstName} || ' ' || coalesce(${contacts.lastName}, '')) ilike ${likeTerm(term)}`,
              ilike(contacts.email, likeTerm(term)),
              ilike(contacts.title, likeTerm(term)),
              digits && digits.length >= 4 ? sql`${contacts.phoneKey} like ${`%${digits.replace(/^0/, '')}%`}` : undefined,
            )
          : undefined,
      );
      const rows = await tx
        .select()
        .from(contacts)
        .where(where)
        .orderBy(asc(sql`lower(${contacts.firstName})`), asc(sql`lower(coalesce(${contacts.lastName}, ''))`))
        .limit(PAGE_SIZE)
        .offset((pageOf(page) - 1) * PAGE_SIZE);
      const [{ n }] = (await tx.select({ n: sql<number>`count(*)::int` }).from(contacts).where(where)) as [{ n: number }];
      return { items: await contactDtos(tx, rows), total: n };
    });
  }

  @Post('contacts')
  async createContact(@Body(new ZodPipe(contactSchema)) body: ContactInput, @CurrentAuth() auth: AuthContext, @CurrentWorkspace() ws: WorkspaceContext): Promise<ContactDto> {
    return this.db.withContext(this.ctx(auth, ws), async (tx) => {
      await assertOwner(tx, ws.id, body.ownerId);
      await assertCompany(tx, ws.id, body.companyId);
      const [row] = await tx
        .insert(contacts)
        .values({
          workspaceId: ws.id,
          ...contactValues(body),
          ownerId: body.ownerId ?? auth.userId,
          custom: await cleanCustom(tx, ws.id, 'contact', body.custom),
          createdBy: auth.userId,
        })
        .returning();
      return (await contactDtos(tx, [row!]))[0]!;
    });
  }

  @Get('contacts/:id')
  async contact(@Param('id', ParseUUIDPipe) id: string, @CurrentAuth() auth: AuthContext, @CurrentWorkspace() ws: WorkspaceContext): Promise<ContactDto> {
    return this.db.withContext(this.ctx(auth, ws), async (tx) => (await contactDtos(tx, [await loadContact(tx, ws.id, id)]))[0]!);
  }

  @Patch('contacts/:id')
  async updateContact(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(partial(contactSchema))) body: Partial<ContactInput>,
    @CurrentAuth() auth: AuthContext,
    @CurrentWorkspace() ws: WorkspaceContext,
  ): Promise<ContactDto> {
    return this.db.withContext(this.ctx(auth, ws), async (tx) => {
      const row = await loadContact(tx, ws.id, id);
      await assertOwner(tx, ws.id, body.ownerId);
      await assertCompany(tx, ws.id, body.companyId);
      const merged = contactSchema.parse({ ...row, ...body, custom: {} });
      const [updated] = await tx
        .update(contacts)
        .set({
          ...contactValues(merged),
          ...(body.ownerId !== undefined ? { ownerId: body.ownerId } : {}),
          custom: await cleanCustom(tx, ws.id, 'contact', body.custom ?? {}, row.custom),
        })
        .where(eq(contacts.id, id))
        .returning();
      return (await contactDtos(tx, [updated!]))[0]!;
    });
  }

  @Delete('contacts/:id')
  @HttpCode(204)
  async deleteContact(@Param('id', ParseUUIDPipe) id: string, @CurrentAuth() auth: AuthContext, @CurrentWorkspace() ws: WorkspaceContext, @ClientIp() ip: string | undefined) {
    await this.db.withContext(this.ctx(auth, ws), async (tx) => {
      const row = await loadContact(tx, ws.id, id);
      if (!canDelete(ws, row, auth.userId)) forbidDelete();
      await tx.update(contacts).set({ deletedAt: new Date() }).where(eq(contacts.id, id));
      await audit(tx, { workspaceId: ws.id, actorUserId: auth.userId, action: 'contact.deleted', entityType: 'contact', entityId: id, metadata: { name: `${row.firstName} ${row.lastName ?? ''}`.trim() }, ip });
    });
  }

  // ---- Leads --------------------------------------------------------------------------

  @Get('leads')
  async leads(
    @Query('q') q: string | undefined,
    @Query('status') status: string | undefined,
    @Query('source') source: string | undefined,
    @Query('page') page: string | undefined,
    @CurrentAuth() auth: AuthContext,
    @CurrentWorkspace() ws: WorkspaceContext,
  ): Promise<Page<LeadDto>> {
    const st = status ? z.enum(LEAD_STATUSES).safeParse(status) : null;
    const src = source ? z.enum(LEAD_SOURCES).safeParse(source) : null;
    if (st && !st.success) throw new BadRequestException(`status must be one of ${LEAD_STATUSES.join(', ')}`);
    if (src && !src.success) throw new BadRequestException(`source must be one of ${LEAD_SOURCES.join(', ')}`);
    return this.db.withContext(this.ctx(auth, ws), async (tx) => {
      const term = q?.trim().slice(0, 100);
      const where = and(
        eq(leads.workspaceId, ws.id),
        isNull(leads.deletedAt),
        st?.data ? eq(leads.status, st.data) : undefined,
        src?.data ? eq(leads.source, src.data) : undefined,
        term ? or(ilike(leads.name, likeTerm(term)), ilike(leads.companyName, likeTerm(term)), ilike(leads.email, likeTerm(term)), ilike(leads.phone, likeTerm(term))) : undefined,
      );
      const rows = await tx
        .select()
        .from(leads)
        .where(where)
        .orderBy(desc(leads.createdAt))
        .limit(PAGE_SIZE)
        .offset((pageOf(page) - 1) * PAGE_SIZE);
      const [{ n }] = (await tx.select({ n: sql<number>`count(*)::int` }).from(leads).where(where)) as [{ n: number }];
      return { items: await leadDtos(tx, rows), total: n };
    });
  }

  @Post('leads')
  @Track('lead created')
  async createLead(@Body(new ZodPipe(leadSchema)) body: LeadInput, @CurrentAuth() auth: AuthContext, @CurrentWorkspace() ws: WorkspaceContext): Promise<LeadDto> {
    return this.db.withContext(this.ctx(auth, ws), async (tx) => {
      await assertOwner(tx, ws.id, body.ownerId);
      const [w] = await tx.select({ currency: workspaces.currency }).from(workspaces).where(eq(workspaces.id, ws.id));
      const [row] = await tx
        .insert(leads)
        .values({
          workspaceId: ws.id,
          name: body.name,
          companyName: body.companyName,
          email: body.email,
          phone: body.phone,
          phoneKey: phoneKey(body.phone),
          source: body.source,
          sourceDetail: body.sourceDetail,
          status: body.status,
          value: body.value ?? null,
          currency: body.currency ?? w!.currency,
          notes: body.notes,
          ownerId: body.ownerId ?? auth.userId,
          custom: await cleanCustom(tx, ws.id, 'lead', body.custom),
          createdBy: auth.userId,
        })
        .returning();
      return (await leadDtos(tx, [row!]))[0]!;
    });
  }

  @Get('leads/:id')
  async lead(@Param('id', ParseUUIDPipe) id: string, @CurrentAuth() auth: AuthContext, @CurrentWorkspace() ws: WorkspaceContext): Promise<LeadDto> {
    return this.db.withContext(this.ctx(auth, ws), async (tx) => (await leadDtos(tx, [await loadLead(tx, ws.id, id)]))[0]!);
  }

  @Patch('leads/:id')
  async updateLead(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(updateLeadSchema)) body: UpdateLeadInput,
    @CurrentAuth() auth: AuthContext,
    @CurrentWorkspace() ws: WorkspaceContext,
  ): Promise<LeadDto> {
    return this.db.withContext(this.ctx(auth, ws), async (tx) => {
      const row = await loadLead(tx, ws.id, id);
      if (row.status === 'converted' && body.status) throw new ConflictException('This lead was converted; its status can’t change.');
      await assertOwner(tx, ws.id, body.ownerId);
      const [updated] = await tx
        .update(leads)
        .set({
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.companyName !== undefined ? { companyName: body.companyName } : {}),
          ...(body.email !== undefined ? { email: body.email } : {}),
          ...(body.phone !== undefined ? { phone: body.phone, phoneKey: phoneKey(body.phone) } : {}),
          ...(body.source !== undefined ? { source: body.source } : {}),
          ...(body.sourceDetail !== undefined ? { sourceDetail: body.sourceDetail } : {}),
          ...(body.status !== undefined ? { status: body.status } : {}),
          ...(body.value !== undefined ? { value: body.value } : {}),
          ...(body.currency !== undefined ? { currency: body.currency } : {}),
          ...(body.notes !== undefined ? { notes: body.notes } : {}),
          ...(body.ownerId !== undefined ? { ownerId: body.ownerId } : {}),
          custom: await cleanCustom(tx, ws.id, 'lead', body.custom ?? {}, row.custom),
        })
        .where(eq(leads.id, id))
        .returning();
      return (await leadDtos(tx, [updated!]))[0]!;
    });
  }

  @Delete('leads/:id')
  @HttpCode(204)
  async deleteLead(@Param('id', ParseUUIDPipe) id: string, @CurrentAuth() auth: AuthContext, @CurrentWorkspace() ws: WorkspaceContext, @ClientIp() ip: string | undefined) {
    await this.db.withContext(this.ctx(auth, ws), async (tx) => {
      const row = await loadLead(tx, ws.id, id);
      if (!canDelete(ws, row, auth.userId)) forbidDelete();
      await tx.update(leads).set({ deletedAt: new Date() }).where(eq(leads.id, id));
      await audit(tx, { workspaceId: ws.id, actorUserId: auth.userId, action: 'lead.deleted', entityType: 'lead', entityId: id, metadata: { name: row.name }, ip });
    });
  }

  /** Turns a lead into a contact, and its company into a company record (new or existing). */
  @Post('leads/:id/convert')
  @Track('lead converted')
  async convert(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(convertLeadSchema)) body: ConvertLeadInput,
    @CurrentAuth() auth: AuthContext,
    @CurrentWorkspace() ws: WorkspaceContext,
  ): Promise<{ lead: LeadDto; contactId: string; companyId: string | null; dealId: string | null }> {
    return this.db.withContext(this.ctx(auth, ws), async (tx) => {
      const lead = await loadLead(tx, ws.id, id);
      if (lead.status === 'converted') throw new ConflictException('This lead was already converted.');
      let companyId: string | null = null;
      if (body.company === 'existing') {
        await assertCompany(tx, ws.id, body.companyId);
        companyId = body.companyId!;
      } else if (body.company === 'new') {
        if (!lead.companyName) throw new BadRequestException('The lead has no company name. Add one, or link an existing company.');
        const website = null;
        const [c] = await tx
          .insert(companies)
          .values({
            workspaceId: ws.id,
            name: lead.companyName,
            website,
            domain: domainOf(website, lead.email),
            ownerId: lead.ownerId ?? auth.userId,
            createdBy: auth.userId,
          })
          .returning({ id: companies.id });
        companyId = c!.id;
      }
      const contactId = randomUUID();
      // Custom values carry over where the contact has a field with the same key.
      const contactCustom = await cleanCustom(tx, ws.id, 'contact', lead.custom).catch(() => ({}));
      await tx.insert(contacts).values({
        id: contactId,
        workspaceId: ws.id,
        companyId,
        ...splitName(lead.name),
        email: lead.email,
        phone: lead.phone,
        phoneKey: lead.phoneKey,
        notes: lead.notes,
        ownerId: lead.ownerId ?? auth.userId,
        leadId: lead.id,
        custom: contactCustom,
        createdBy: auth.userId,
      });
      const [updated] = await tx
        .update(leads)
        .set({ status: 'converted', convertedContactId: contactId, convertedCompanyId: companyId, convertedAt: new Date() })
        .where(eq(leads.id, id))
        .returning();
      let dealId: string | null = null;
      if (body.createDeal) {
        const stage = await resolveStage(tx, ws.id);
        const [deal] = await tx
          .insert(deals)
          .values({
            workspaceId: ws.id,
            pipelineId: stage.pipelineId,
            stageId: stage.id,
            title: lead.companyName ?? lead.name,
            value: lead.value,
            currency: lead.currency,
            companyId,
            contactId,
            leadId: lead.id,
            ownerId: lead.ownerId ?? auth.userId,
            notes: lead.notes,
            position: await endOfStage(tx, stage.id),
            createdBy: auth.userId,
          })
          .returning({ id: deals.id });
        dealId = deal!.id;
      }
      return { lead: (await leadDtos(tx, [updated!]))[0]!, contactId, companyId, dealId };
    });
  }

  // ---- Duplicates ---------------------------------------------------------------------

  /** Records that look like the one being entered: same email or phone, or same website or name for companies. */
  @Get('duplicates')
  async duplicates(
    @Query('entity') entity: string | undefined,
    @Query('email') email: string | undefined,
    @Query('phone') phone: string | undefined,
    @Query('name') nameQ: string | undefined,
    @Query('website') website: string | undefined,
    @Query('except') except: string | undefined,
    @CurrentAuth() auth: AuthContext,
    @CurrentWorkspace() ws: WorkspaceContext,
  ): Promise<DuplicateDto[]> {
    const kind = z.enum(CRM_ENTITIES).safeParse(entity);
    if (!kind.success) throw new BadRequestException('entity must be company, contact or lead');
    return this.db.withContext(this.ctx(auth, ws), async (tx) => {
      if (kind.data === 'company') {
        let site: string | null = null;
        try {
          site = website?.trim() ? normaliseWebsite(website.trim()) : null;
        } catch {
          site = null;
        }
        return companyDuplicates(tx, ws.id, { name: nameQ?.trim() || null, domain: domainOf(site, email?.trim() || null), except });
      }
      return personDuplicates(tx, ws.id, { email: email?.trim().toLowerCase() || null, phone: phone?.trim() || null, except });
    });
  }

  // ---- Custom fields ------------------------------------------------------------------

  @Get('fields')
  async fields(@Query('entity') entity: string | undefined, @CurrentAuth() auth: AuthContext, @CurrentWorkspace() ws: WorkspaceContext): Promise<CustomFieldDto[]> {
    const kind = entity ? z.enum(CRM_ENTITIES).safeParse(entity) : null;
    if (kind && !kind.success) throw new BadRequestException('entity must be company, contact or lead');
    return this.db.withContext(this.ctx(auth, ws), (tx) => listFields(tx, ws.id, kind?.data));
  }

  @Post('fields')
  @MinRole('manager')
  async createField(@Body(new ZodPipe(customFieldSchema)) body: CustomFieldInput, @CurrentAuth() auth: AuthContext, @CurrentWorkspace() ws: WorkspaceContext): Promise<CustomFieldDto> {
    const base =
      body.label
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .replace(/^(\d)/, 'f_$1')
        .slice(0, 32) || 'field';
    try {
      return await this.db.withContext(this.ctx(auth, ws), async (tx) => {
        const taken = new Set(
          (await tx.select({ key: customFields.key }).from(customFields).where(and(eq(customFields.workspaceId, ws.id), eq(customFields.entity, body.entity)))).map((r) => r.key),
        );
        let key = /^[a-z]/.test(base) ? base : `f_${base}`;
        for (let i = 2; taken.has(key); i++) key = `${base}_${i}`;
        const [{ top }] = (await tx
          .select({ top: max(customFields.position) })
          .from(customFields)
          .where(and(eq(customFields.workspaceId, ws.id), eq(customFields.entity, body.entity)))) as [{ top: number | null }];
        const [row] = await tx
          .insert(customFields)
          .values({ workspaceId: ws.id, entity: body.entity, key, label: body.label, type: body.type, options: body.type === 'select' ? [...new Set(body.options)] : [], position: (top ?? -1) + 1 })
          .returning();
        return fieldDto(row!);
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw new ConflictException('A field with that name already exists.');
      throw err;
    }
  }

  @Patch('fields/:id')
  @MinRole('manager')
  async updateField(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(updateCustomFieldSchema)) body: z.infer<typeof updateCustomFieldSchema>,
    @CurrentAuth() auth: AuthContext,
    @CurrentWorkspace() ws: WorkspaceContext,
  ): Promise<CustomFieldDto> {
    return this.db.withContext(this.ctx(auth, ws), async (tx) => {
      const [row] = await tx
        .select()
        .from(customFields)
        .where(and(eq(customFields.id, id), eq(customFields.workspaceId, ws.id), isNull(customFields.archivedAt)));
      if (!row) throw new BadRequestException('Field not found');
      if (body.options && row.type === 'select' && body.options.length === 0) throw new BadRequestException('Add at least one option');
      const [updated] = await tx
        .update(customFields)
        .set({
          ...(body.label ? { label: body.label } : {}),
          ...(body.options && row.type === 'select' ? { options: [...new Set(body.options)] } : {}),
          ...(body.position !== undefined ? { position: body.position } : {}),
        })
        .where(eq(customFields.id, id))
        .returning();
      return fieldDto(updated!);
    });
  }

  /** Hides the field; values already saved stay on the records. */
  @Delete('fields/:id')
  @MinRole('manager')
  @HttpCode(204)
  async deleteField(@Param('id', ParseUUIDPipe) id: string, @CurrentAuth() auth: AuthContext, @CurrentWorkspace() ws: WorkspaceContext) {
    await this.db.withContext(this.ctx(auth, ws), (tx) =>
      tx
        .update(customFields)
        .set({ archivedAt: new Date() })
        .where(and(eq(customFields.id, id), eq(customFields.workspaceId, ws.id))),
    );
  }
}

function fieldDto(r: typeof customFields.$inferSelect): CustomFieldDto {
  return { id: r.id, entity: r.entity, key: r.key, label: r.label, type: r.type, options: r.options, position: r.position };
}

export async function listFields(tx: Tx, workspaceId: string, entity?: CrmEntity): Promise<CustomFieldDto[]> {
  const where: SQL | undefined = and(eq(customFields.workspaceId, workspaceId), isNull(customFields.archivedAt), entity ? eq(customFields.entity, entity) : undefined);
  const rows = await tx.select().from(customFields).where(where).orderBy(asc(customFields.entity), asc(customFields.position), asc(customFields.createdAt));
  return rows.map(fieldDto);
}
