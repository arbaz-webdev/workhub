import { BadRequestException, Controller, Get, NotFoundException, Param, ParseUUIDPipe, Query, UseGuards } from '@nestjs/common';
import { CLIENT_INVOICE_STATUSES, LEAD_STATUSES, PROJECT_STATUSES, REQUEST_STATUSES, STAGE_KINDS } from '@workhub/shared';
import { and, asc, eq, gte, inArray, isNotNull, isNull, lte, not, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { workspaceInfo } from '../attendance/attendance';
import { monthReport } from '../attendance/export';
import { AuthContext, CurrentAuth, CurrentWorkspace, Public, WorkspaceContext } from '../common/request';
import { ZodPipe } from '../common/zod.pipe';
import { DbService, Tx } from '../db/db.service';
import {
  activities,
  boardColumns,
  clientDocumentLines,
  clientDocuments,
  companies,
  contacts,
  deals,
  leads,
  leaveRequests,
  leaveTypes,
  memberships,
  pipelines,
  pipelineStages,
  projects,
  taskAssignees,
  tasks,
  teams,
  timeEntries,
  users,
  workspaces,
} from '../db/schema';
import { ApiKeyGuard } from './api-key.guard';
import { date, iso, keyset, pageQuery, toPage, updatedSince, type Page } from './paging';

const bool = z.enum(['true', 'false']).transform((v) => v === 'true');

const peopleQuery = pageQuery;
const attendanceQuery = z.object({ month: z.string().regex(/^\d{4}-\d{2}$/, 'Use a month like 2027-01') });
const leaveQuery = pageQuery.extend({ status: z.enum(REQUEST_STATUSES).optional(), from: date.optional(), to: date.optional() });
const timeQuery = pageQuery.extend({ from: date, to: date, projectId: z.uuid().optional(), userId: z.uuid().optional(), approved: bool.optional() });
const projectsQuery = pageQuery.extend({ status: z.enum(PROJECT_STATUSES).optional() });
const tasksQuery = pageQuery.extend({ projectId: z.uuid().optional(), completed: bool.optional(), updatedSince });
const syncQuery = pageQuery.extend({ updatedSince });
const leadsQuery = syncQuery.extend({ status: z.enum(LEAD_STATUSES).optional() });
const dealsQuery = syncQuery.extend({ status: z.enum(STAGE_KINDS).optional() });
const activitiesQuery = syncQuery.extend({ dealId: z.uuid().optional(), companyId: z.uuid().optional(), contactId: z.uuid().optional(), leadId: z.uuid().optional() });
const invoicesQuery = pageQuery.extend({ status: z.enum(CLIENT_INVOICE_STATUSES).optional(), companyId: z.uuid().optional() });

/** Time entries may be asked for a year at a time. */
const MAX_RANGE_DAYS = 366;

/** A time entry's week was approved on its person's timesheet: the rule client invoices use too. */
const approvedHours = sql<boolean>`exists (select 1 from timesheets t where t.workspace_id = ${timeEntries.workspaceId} and t.user_id = ${timeEntries.userId}
  and t.status = 'approved' and ${timeEntries.workDate} >= t.week_start and ${timeEntries.workDate} < t.week_start + 7)`;

const where = (...parts: (SQL | undefined)[]) => and(...parts.filter((p): p is SQL => !!p));

/**
 * The public API, version 1: read access to a workspace's data with an API key.
 * Shapes here are a promise to customers, so change them only by adding fields.
 */
@Controller('v1')
@Public()
@UseGuards(ApiKeyGuard)
export class PublicApiV1Controller {
  constructor(private readonly db: DbService) {}

  private run<T>(auth: AuthContext, ws: WorkspaceContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.db.withContext({ workspaceId: ws.id, userId: auth.userId }, fn);
  }

  /** Which workspace and person a key acts as: a quick way to check a key works. */
  @Get('me')
  me(@CurrentAuth() auth: AuthContext, @CurrentWorkspace() ws: WorkspaceContext) {
    return this.run(auth, ws, async (tx) => {
      const [w] = await tx.select({ id: workspaces.id, name: workspaces.name, timezone: workspaces.timezone }).from(workspaces).where(eq(workspaces.id, ws.id));
      const [u] = await tx.select({ id: users.id, name: users.name, email: users.email }).from(users).where(eq(users.id, auth.userId));
      return { workspace: w!, actingAs: { ...u!, role: ws.role } };
    });
  }

  @Get('people')
  people(@Query(new ZodPipe(peopleQuery)) q: z.infer<typeof peopleQuery>, @CurrentAuth() auth: AuthContext, @CurrentWorkspace() ws: WorkspaceContext) {
    return this.run(auth, ws, async (tx) => {
      const page = keyset(memberships.createdAt, memberships.id, q.cursor);
      const rows = await tx
        .select({
          id: memberships.id,
          createdAt: memberships.createdAt,
          userId: users.id,
          name: users.name,
          email: users.email,
          role: memberships.role,
          employeeCode: memberships.employeeCode,
          team: teams.name,
          clientCompanyId: memberships.clientCompanyId,
        })
        .from(memberships)
        .innerJoin(users, eq(users.id, memberships.userId))
        .leftJoin(teams, eq(teams.id, memberships.teamId))
        .where(where(eq(memberships.workspaceId, ws.id), page.after))
        .orderBy(...page.order)
        .limit(q.limit + 1);
      return toPage(rows, q.limit, (r) => ({
        id: r.userId,
        name: r.name,
        email: r.email,
        role: r.role,
        employeeCode: r.employeeCode,
        team: r.team,
        clientCompanyId: r.clientCompanyId,
        joinedAt: r.createdAt.toISOString(),
      }));
    });
  }

  /** One row per person per day of a month, worked out exactly as the payroll export does. */
  @Get('attendance')
  attendance(@Query(new ZodPipe(attendanceQuery)) q: z.infer<typeof attendanceQuery>, @CurrentAuth() auth: AuthContext, @CurrentWorkspace() ws: WorkspaceContext) {
    return this.run(auth, ws, async (tx) => {
      const report = await monthReport(tx, await workspaceInfo(tx, ws.id), q.month);
      return {
        month: q.month,
        from: report.from,
        to: report.to,
        data: report.people.flatMap((p) =>
          p.days.map((d) => ({
            userId: p.userId,
            name: p.name,
            employeeCode: p.employeeCode,
            date: d.date,
            status: d.status,
            flags: d.flags,
            checkInAt: d.checkInAt,
            checkOutAt: d.checkOutAt,
            workedMinutes: d.workedMinutes,
            breakMinutes: d.breakMinutes,
            lateMinutes: d.lateMinutes,
            shiftName: d.shiftName,
            holidayName: d.holidayName,
            leave: d.leave,
          })),
        ),
      };
    });
  }

  @Get('leave-requests')
  leave(@Query(new ZodPipe(leaveQuery)) q: z.infer<typeof leaveQuery>, @CurrentAuth() auth: AuthContext, @CurrentWorkspace() ws: WorkspaceContext) {
    return this.run(auth, ws, async (tx) => {
      const page = keyset(leaveRequests.createdAt, leaveRequests.id, q.cursor);
      const rows = await tx
        .select({ request: leaveRequests, userName: users.name, typeName: leaveTypes.name, paid: leaveTypes.paid })
        .from(leaveRequests)
        .innerJoin(users, eq(users.id, leaveRequests.userId))
        .innerJoin(leaveTypes, eq(leaveTypes.id, leaveRequests.leaveTypeId))
        .where(
          where(
            eq(leaveRequests.workspaceId, ws.id),
            q.status ? eq(leaveRequests.status, q.status) : undefined,
            // Requests that overlap the range.
            q.from ? gte(leaveRequests.endDate, q.from) : undefined,
            q.to ? lte(leaveRequests.startDate, q.to) : undefined,
            page.after,
          ),
        )
        .orderBy(...page.order)
        .limit(q.limit + 1);
      return toPage(
        rows.map((r) => ({ ...r, id: r.request.id, createdAt: r.request.createdAt })),
        q.limit,
        ({ request: l, userName, typeName, paid }) => ({
          id: l.id,
          userId: l.userId,
          userName,
          leaveType: { id: l.leaveTypeId, name: typeName, paid },
          startDate: l.startDate,
          endDate: l.endDate,
          halfDay: l.halfDay,
          days: Number(l.days),
          reason: l.reason,
          status: l.status,
          decidedBy: l.decidedBy,
          decidedAt: iso(l.decidedAt),
          decisionNote: l.decisionNote,
          createdAt: l.createdAt.toISOString(),
        }),
      );
    });
  }

  @Get('time-entries')
  time(@Query(new ZodPipe(timeQuery)) q: z.infer<typeof timeQuery>, @CurrentAuth() auth: AuthContext, @CurrentWorkspace() ws: WorkspaceContext) {
    const days = (Date.parse(q.to) - Date.parse(q.from)) / 86_400_000;
    if (days < 0) throw new BadRequestException('"to" must be on or after "from"');
    if (days >= MAX_RANGE_DAYS) throw new BadRequestException(`Ask for at most ${MAX_RANGE_DAYS} days at a time`);
    return this.run(auth, ws, async (tx) => {
      const page = keyset(timeEntries.createdAt, timeEntries.id, q.cursor);
      const rows = await tx
        .select({ entry: timeEntries, approved: approvedHours })
        .from(timeEntries)
        .where(
          where(
            eq(timeEntries.workspaceId, ws.id),
            gte(timeEntries.workDate, q.from),
            lte(timeEntries.workDate, q.to),
            q.projectId ? eq(timeEntries.projectId, q.projectId) : undefined,
            q.userId ? eq(timeEntries.userId, q.userId) : undefined,
            q.approved === undefined ? undefined : q.approved ? approvedHours : not(approvedHours),
            page.after,
          ),
        )
        .orderBy(...page.order)
        .limit(q.limit + 1);
      return toPage(
        rows.map((r) => ({ ...r, id: r.entry.id, createdAt: r.entry.createdAt })),
        q.limit,
        ({ entry: e, approved }) => ({
          id: e.id,
          userId: e.userId,
          projectId: e.projectId,
          taskId: e.taskId,
          date: e.workDate,
          minutes: e.minutes,
          note: e.note,
          billable: e.billable,
          source: e.source,
          approved,
          invoiceId: e.invoiceId,
          createdAt: e.createdAt.toISOString(),
        }),
      );
    });
  }

  @Get('projects')
  projects(@Query(new ZodPipe(projectsQuery)) q: z.infer<typeof projectsQuery>, @CurrentAuth() auth: AuthContext, @CurrentWorkspace() ws: WorkspaceContext) {
    return this.run(auth, ws, async (tx) => {
      const page = keyset(projects.createdAt, projects.id, q.cursor);
      const rows = await tx
        .select()
        .from(projects)
        .where(where(eq(projects.workspaceId, ws.id), q.status ? eq(projects.status, q.status) : undefined, page.after))
        .orderBy(...page.order)
        .limit(q.limit + 1);
      return toPage(rows, q.limit, (p) => ({
        id: p.id,
        name: p.name,
        description: p.description,
        status: p.status,
        clientId: p.clientId,
        budgetHours: p.budgetHours,
        hourlyRate: p.hourlyRate,
        rateCurrency: p.rateCurrency,
        createdAt: p.createdAt.toISOString(),
        updatedAt: p.updatedAt.toISOString(),
      }));
    });
  }

  @Get('tasks')
  tasks(@Query(new ZodPipe(tasksQuery)) q: z.infer<typeof tasksQuery>, @CurrentAuth() auth: AuthContext, @CurrentWorkspace() ws: WorkspaceContext) {
    return this.run(auth, ws, async (tx) => {
      const page = keyset(tasks.createdAt, tasks.id, q.cursor);
      const rows = await tx
        .select({ task: tasks, column: boardColumns.name })
        .from(tasks)
        .innerJoin(boardColumns, eq(boardColumns.id, tasks.columnId))
        .where(
          where(
            eq(tasks.workspaceId, ws.id),
            isNull(tasks.deletedAt),
            q.projectId ? eq(tasks.projectId, q.projectId) : undefined,
            q.completed === undefined ? undefined : q.completed ? isNotNull(tasks.completedAt) : isNull(tasks.completedAt),
            q.updatedSince ? gte(tasks.updatedAt, new Date(q.updatedSince)) : undefined,
            page.after,
          ),
        )
        .orderBy(...page.order)
        .limit(q.limit + 1);
      const assignees = await assigneesOf(
        tx,
        rows.map((r) => r.task.id),
      );
      return toPage(
        rows.map((r) => ({ ...r, id: r.task.id, createdAt: r.task.createdAt })),
        q.limit,
        ({ task, column }) => taskOut(task, column, assignees.get(task.id) ?? []),
      );
    });
  }

  @Get('companies')
  companies(@Query(new ZodPipe(syncQuery)) q: z.infer<typeof syncQuery>, @CurrentAuth() auth: AuthContext, @CurrentWorkspace() ws: WorkspaceContext) {
    return this.run(auth, ws, async (tx) => {
      const page = keyset(companies.createdAt, companies.id, q.cursor);
      const rows = await tx
        .select()
        .from(companies)
        .where(
          where(eq(companies.workspaceId, ws.id), isNull(companies.deletedAt), q.updatedSince ? gte(companies.updatedAt, new Date(q.updatedSince)) : undefined, page.after),
        )
        .orderBy(...page.order)
        .limit(q.limit + 1);
      return toPage(rows, q.limit, (c) => ({
        id: c.id,
        name: c.name,
        website: c.website,
        email: c.email,
        phone: c.phone,
        industry: c.industry,
        city: c.city,
        country: c.country,
        address: c.address,
        notes: c.notes,
        ownerId: c.ownerId,
        custom: c.custom,
        createdAt: c.createdAt.toISOString(),
        updatedAt: c.updatedAt.toISOString(),
      }));
    });
  }

  @Get('contacts')
  contacts(@Query(new ZodPipe(syncQuery)) q: z.infer<typeof syncQuery>, @CurrentAuth() auth: AuthContext, @CurrentWorkspace() ws: WorkspaceContext) {
    return this.run(auth, ws, async (tx) => {
      const page = keyset(contacts.createdAt, contacts.id, q.cursor);
      const rows = await tx
        .select()
        .from(contacts)
        .where(
          where(eq(contacts.workspaceId, ws.id), isNull(contacts.deletedAt), q.updatedSince ? gte(contacts.updatedAt, new Date(q.updatedSince)) : undefined, page.after),
        )
        .orderBy(...page.order)
        .limit(q.limit + 1);
      return toPage(rows, q.limit, contactOut);
    });
  }

  @Get('leads')
  leads(@Query(new ZodPipe(leadsQuery)) q: z.infer<typeof leadsQuery>, @CurrentAuth() auth: AuthContext, @CurrentWorkspace() ws: WorkspaceContext) {
    return this.run(auth, ws, async (tx) => {
      const page = keyset(leads.createdAt, leads.id, q.cursor);
      const rows = await tx
        .select()
        .from(leads)
        .where(
          where(
            eq(leads.workspaceId, ws.id),
            isNull(leads.deletedAt),
            q.status ? eq(leads.status, q.status) : undefined,
            q.updatedSince ? gte(leads.updatedAt, new Date(q.updatedSince)) : undefined,
            page.after,
          ),
        )
        .orderBy(...page.order)
        .limit(q.limit + 1);
      return toPage(rows, q.limit, leadOut);
    });
  }

  @Get('deals')
  deals(@Query(new ZodPipe(dealsQuery)) q: z.infer<typeof dealsQuery>, @CurrentAuth() auth: AuthContext, @CurrentWorkspace() ws: WorkspaceContext) {
    return this.run(auth, ws, async (tx) => {
      const page = keyset(deals.createdAt, deals.id, q.cursor);
      const rows = await tx
        .select({ deal: deals, pipeline: pipelines.name, stage: pipelineStages.name })
        .from(deals)
        .innerJoin(pipelines, eq(pipelines.id, deals.pipelineId))
        .innerJoin(pipelineStages, eq(pipelineStages.id, deals.stageId))
        .where(
          where(
            eq(deals.workspaceId, ws.id),
            isNull(deals.deletedAt),
            q.status ? eq(deals.status, q.status) : undefined,
            q.updatedSince ? gte(deals.updatedAt, new Date(q.updatedSince)) : undefined,
            page.after,
          ),
        )
        .orderBy(...page.order)
        .limit(q.limit + 1);
      return toPage(
        rows.map((r) => ({ ...r, id: r.deal.id, createdAt: r.deal.createdAt })),
        q.limit,
        ({ deal: d, pipeline, stage }) => ({
          id: d.id,
          title: d.title,
          value: d.value,
          currency: d.currency,
          pipeline: { id: d.pipelineId, name: pipeline },
          stage: { id: d.stageId, name: stage },
          status: d.status,
          companyId: d.companyId,
          contactId: d.contactId,
          leadId: d.leadId,
          ownerId: d.ownerId,
          projectId: d.projectId,
          expectedClose: d.expectedClose,
          wonAt: iso(d.wonAt),
          lostAt: iso(d.lostAt),
          lostReason: d.lostReason,
          notes: d.notes,
          createdAt: d.createdAt.toISOString(),
          updatedAt: d.updatedAt.toISOString(),
        }),
      );
    });
  }

  /** CRM activities: calls, meetings, notes and follow-ups, on a deal, company, contact or lead. */
  @Get('activities')
  activities(@Query(new ZodPipe(activitiesQuery)) q: z.infer<typeof activitiesQuery>, @CurrentAuth() auth: AuthContext, @CurrentWorkspace() ws: WorkspaceContext) {
    return this.run(auth, ws, async (tx) => {
      const page = keyset(activities.createdAt, activities.id, q.cursor);
      const rows = await tx
        .select()
        .from(activities)
        .where(
          where(
            eq(activities.workspaceId, ws.id),
            q.dealId ? eq(activities.dealId, q.dealId) : undefined,
            q.companyId ? eq(activities.companyId, q.companyId) : undefined,
            q.contactId ? eq(activities.contactId, q.contactId) : undefined,
            q.leadId ? eq(activities.leadId, q.leadId) : undefined,
            q.updatedSince ? gte(activities.updatedAt, new Date(q.updatedSince)) : undefined,
            page.after,
          ),
        )
        .orderBy(...page.order)
        .limit(q.limit + 1);
      return toPage(rows, q.limit, activityOut);
    });
  }

  /** Invoices to clients (not WorkHub's own bills to the workspace). */
  @Get('invoices')
  invoices(@Query(new ZodPipe(invoicesQuery)) q: z.infer<typeof invoicesQuery>, @CurrentAuth() auth: AuthContext, @CurrentWorkspace() ws: WorkspaceContext): Promise<Page<InvoiceDto>> {
    return this.run(auth, ws, async (tx) => {
      const page = keyset(clientDocuments.createdAt, clientDocuments.id, q.cursor);
      const rows = await tx
        .select()
        .from(clientDocuments)
        .where(
          where(
            eq(clientDocuments.workspaceId, ws.id),
            eq(clientDocuments.kind, 'invoice'),
            q.status ? eq(clientDocuments.status, q.status) : undefined,
            q.companyId ? eq(clientDocuments.companyId, q.companyId) : undefined,
            page.after,
          ),
        )
        .orderBy(...page.order)
        .limit(q.limit + 1);
      return toPage(rows, q.limit, invoiceDto);
    });
  }

  @Get('invoices/:id')
  invoice(@Param('id', ParseUUIDPipe) id: string, @CurrentAuth() auth: AuthContext, @CurrentWorkspace() ws: WorkspaceContext) {
    return this.run(auth, ws, async (tx) => {
      const [doc] = await tx
        .select()
        .from(clientDocuments)
        .where(and(eq(clientDocuments.id, id), eq(clientDocuments.workspaceId, ws.id), eq(clientDocuments.kind, 'invoice')));
      if (!doc) throw new NotFoundException('Invoice not found');
      const lines = await tx
        .select()
        .from(clientDocumentLines)
        .where(eq(clientDocumentLines.documentId, id))
        .orderBy(asc(clientDocumentLines.position));
      return {
        ...invoiceDto(doc),
        lines: lines.map((l) => ({ description: l.description, quantity: l.quantity, unitPrice: l.unitPrice, amount: l.amount, projectId: l.projectId })),
      };
    });
  }
}

// Record shapes shared by the read and write endpoints.

export function taskOut(t: typeof tasks.$inferSelect, column: string, assigneeIds: string[]) {
  return {
    id: t.id,
    projectId: t.projectId,
    parentTaskId: t.parentTaskId,
    column,
    title: t.title,
    description: t.description,
    priority: t.priority,
    startDate: t.startDate,
    dueDate: t.dueDate,
    estimateHours: t.estimateHours,
    assigneeIds,
    completed: t.completedAt !== null,
    completedAt: iso(t.completedAt),
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  };
}

export function contactOut(c: typeof contacts.$inferSelect) {
  return {
    id: c.id,
    companyId: c.companyId,
    firstName: c.firstName,
    lastName: c.lastName,
    email: c.email,
    phone: c.phone,
    title: c.title,
    notes: c.notes,
    ownerId: c.ownerId,
    leadId: c.leadId,
    custom: c.custom,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}

export function leadOut(l: typeof leads.$inferSelect) {
  return {
    id: l.id,
    name: l.name,
    companyName: l.companyName,
    email: l.email,
    phone: l.phone,
    source: l.source,
    sourceDetail: l.sourceDetail,
    status: l.status,
    value: l.value,
    currency: l.currency,
    notes: l.notes,
    ownerId: l.ownerId,
    custom: l.custom,
    convertedContactId: l.convertedContactId,
    convertedCompanyId: l.convertedCompanyId,
    convertedAt: iso(l.convertedAt),
    createdAt: l.createdAt.toISOString(),
    updatedAt: l.updatedAt.toISOString(),
  };
}

export function activityOut(a: typeof activities.$inferSelect) {
  return {
    id: a.id,
    kind: a.kind,
    subject: a.subject,
    body: a.body,
    dueAt: iso(a.dueAt),
    done: a.doneAt !== null,
    doneAt: iso(a.doneAt),
    ownerId: a.ownerId,
    dealId: a.dealId,
    companyId: a.companyId,
    contactId: a.contactId,
    leadId: a.leadId,
    createdBy: a.createdBy,
    createdAt: a.createdAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
  };
}

/** One task in the shape the API returns, or 404. */
export async function loadTaskOut(tx: Tx, workspaceId: string, id: string) {
  const [row] = await tx
    .select({ task: tasks, column: boardColumns.name })
    .from(tasks)
    .innerJoin(boardColumns, eq(boardColumns.id, tasks.columnId))
    .where(and(eq(tasks.id, id), eq(tasks.workspaceId, workspaceId), isNull(tasks.deletedAt)));
  if (!row) throw new NotFoundException('Task not found');
  return taskOut(row.task, row.column, (await assigneesOf(tx, [id])).get(id) ?? []);
}

type InvoiceDto = ReturnType<typeof invoiceDto>;

function invoiceDto(d: typeof clientDocuments.$inferSelect) {
  return {
    id: d.id,
    number: d.number,
    companyId: d.companyId,
    status: d.status,
    currency: d.currency,
    issueDate: d.issueDate,
    dueDate: d.dueDate,
    subtotal: d.subtotal,
    taxLabel: d.taxLabel,
    taxRate: d.taxRate,
    taxAmount: d.taxAmount,
    total: d.total,
    sentAt: iso(d.sentAt),
    paidAt: iso(d.paidAt),
    createdAt: d.createdAt.toISOString(),
  };
}

async function assigneesOf(tx: Tx, taskIds: string[]): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  if (taskIds.length === 0) return map;
  const rows = await tx.select().from(taskAssignees).where(inArray(taskAssignees.taskId, taskIds));
  for (const r of rows) map.set(r.taskId, [...(map.get(r.taskId) ?? []), r.userId]);
  return map;
}
