import { BadRequestException, Body, Controller, Get, Param, ParseUUIDPipe, Patch, Put, Query, UseGuards } from '@nestjs/common';
import {
  costSettingsSchema,
  hasRole,
  memberCostSchema,
  monthSchema,
  projectRateSchema,
  type CostSettingsDto,
  type CostSettingsInput,
  type DashboardDto,
  type ProfitabilityDto,
  type SalesReportDto,
  type UtilisationDto,
} from '@workhub/shared';
import { and, asc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { addDays, zonedParts } from '../attendance/zoned';
import { audit } from '../audit/audit';
import { AuthContext, ClientIp, CurrentAuth, CurrentWorkspace, MinRole, WorkspaceContext } from '../common/request';
import { ZodPipe } from '../common/zod.pipe';
import { DbService } from '../db/db.service';
import { companies, memberships, projects, users, workspaces } from '../db/schema';
import { WorkspaceGuard } from '../workspaces/workspace.guard';
import { costInfo, dashboard, monthsBetween, profitability, salesReport, utilisation } from './reports';

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** A period of whole months, up to two years; this month back to `back` months by default. */
function monthRange(from: string | undefined, to: string | undefined, today: string, back = 5) {
  const thisMonth = today.slice(0, 7);
  const f = from ?? monthsBetween('2000-01', thisMonth).at(-1 - back)!;
  const t = to ?? thisMonth;
  if (!monthSchema.safeParse(f).success || !monthSchema.safeParse(t).success) throw new BadRequestException('Use from=YYYY-MM and to=YYYY-MM');
  if (f > t) throw new BadRequestException('from must be before to');
  if (monthsBetween(f, t).length > 24) throw new BadRequestException('Choose up to 24 months');
  return { from: f, to: t };
}

/** A period of days, up to a year; this month so far by default. */
function dayRange(from: string | undefined, to: string | undefined, today: string) {
  const f = from ?? `${today.slice(0, 7)}-01`;
  const t = to ?? today;
  if (!date.safeParse(f).success || !date.safeParse(t).success || Number.isNaN(Date.parse(f)) || Number.isNaN(Date.parse(t))) throw new BadRequestException('Use from=YYYY-MM-DD and to=YYYY-MM-DD');
  if (f > t) throw new BadRequestException('from must be before to');
  if (addDays(f, 366) < t) throw new BadRequestException('Choose up to a year');
  return { from: f, to: t };
}

/**
 * Reports: client profitability and cost settings for owners and admins (they involve
 * salaries); utilisation and sales for managers; the dashboard for everyone.
 */
@Controller()
@UseGuards(WorkspaceGuard)
@MinRole('manager')
export class ReportsController {
  constructor(private readonly db: DbService) {}

  private ctx(auth: AuthContext, ws: WorkspaceContext) {
    return { workspaceId: ws.id, userId: auth.userId };
  }

  private async today(ws: WorkspaceContext, auth: AuthContext) {
    const info = await this.db.withContext(this.ctx(auth, ws), (tx) => costInfo(tx, ws.id));
    return zonedParts(new Date(), info.timezone).date;
  }

  @Get('dashboard')
  @MinRole('guest')
  async dashboard(@CurrentAuth() auth: AuthContext, @CurrentWorkspace() ws: WorkspaceContext): Promise<DashboardDto> {
    return this.db.withContext(this.ctx(auth, ws), (tx) => dashboard(tx, ws.id, auth.userId, hasRole(ws.role, 'manager')));
  }

  @Get('reports/profitability')
  @MinRole('admin')
  async profitability(@Query('from') from: string | undefined, @Query('to') to: string | undefined, @CurrentAuth() auth: AuthContext, @CurrentWorkspace() ws: WorkspaceContext): Promise<ProfitabilityDto> {
    const range = monthRange(from, to, await this.today(ws, auth));
    return this.db.withContext(this.ctx(auth, ws), (tx) => profitability(tx, ws.id, range.from, range.to));
  }

  @Get('reports/utilisation')
  async utilisation(@Query('from') from: string | undefined, @Query('to') to: string | undefined, @CurrentAuth() auth: AuthContext, @CurrentWorkspace() ws: WorkspaceContext): Promise<UtilisationDto> {
    const range = dayRange(from, to, await this.today(ws, auth));
    return this.db.withContext(this.ctx(auth, ws), (tx) => utilisation(tx, ws.id, range.from, range.to));
  }

  @Get('reports/sales')
  async sales(@Query('from') from: string | undefined, @Query('to') to: string | undefined, @CurrentAuth() auth: AuthContext, @CurrentWorkspace() ws: WorkspaceContext): Promise<SalesReportDto> {
    const today = await this.today(ws, auth);
    // Default: the last 90 days.
    const range = dayRange(from ?? addDays(today, -89), to, today);
    return this.db.withContext(this.ctx(auth, ws), (tx) => salesReport(tx, ws.id, range.from, range.to));
  }

  // ---- Cost settings (salaries, rates, exchange rates) ---------------------------------------

  @Get('reports/costs')
  @MinRole('admin')
  async costs(@CurrentAuth() auth: AuthContext, @CurrentWorkspace() ws: WorkspaceContext): Promise<CostSettingsDto> {
    return this.db.withContext(this.ctx(auth, ws), async (tx) => {
      const info = await costInfo(tx, ws.id);
      const people = await tx
        .select({ id: users.id, name: users.name, email: users.email, role: memberships.role, monthlyCost: memberships.monthlyCost })
        .from(memberships)
        .innerJoin(users, eq(users.id, memberships.userId))
        .where(and(eq(memberships.workspaceId, ws.id), sql`${memberships.role} <> 'guest'`))
        .orderBy(asc(users.name));
      const work = await tx
        .select({ id: projects.id, name: projects.name, clientId: projects.clientId, clientName: companies.name, hourlyRate: projects.hourlyRate, rateCurrency: projects.rateCurrency })
        .from(projects)
        .leftJoin(companies, eq(companies.id, projects.clientId))
        .where(and(eq(projects.workspaceId, ws.id), sql`${projects.status} <> 'archived'`))
        .orderBy(asc(projects.name));
      return {
        currency: info.currency,
        monthlyHours: info.monthlyHours,
        fxRates: info.fxRates,
        people: people.map((p) => ({
          person: { id: p.id, name: p.name, email: p.email },
          role: p.role,
          monthlyCost: p.monthlyCost,
          hourlyCost: p.monthlyCost === null ? null : Math.round((p.monthlyCost / info.monthlyHours) * 100) / 100,
        })),
        projects: work.map((p) => ({ id: p.id, name: p.name, client: p.clientId && p.clientName ? { id: p.clientId, name: p.clientName } : null, hourlyRate: p.hourlyRate, rateCurrency: p.rateCurrency })),
      };
    });
  }

  @Patch('reports/costs')
  @MinRole('admin')
  async updateCostSettings(
    @Body(new ZodPipe(costSettingsSchema)) body: CostSettingsInput,
    @CurrentAuth() auth: AuthContext,
    @CurrentWorkspace() ws: WorkspaceContext,
    @ClientIp() ip: string | undefined,
  ): Promise<CostSettingsDto> {
    await this.db.withContext(this.ctx(auth, ws), async (tx) => {
      await tx.update(workspaces).set({ monthlyHours: body.monthlyHours, fxRates: body.fxRates as Record<string, number> }).where(eq(workspaces.id, ws.id));
      await audit(tx, { workspaceId: ws.id, actorUserId: auth.userId, action: 'reports.settings_changed', entityType: 'workspace', entityId: ws.id, metadata: { monthlyHours: body.monthlyHours, fxRates: body.fxRates }, ip });
    });
    return this.costs(auth, ws);
  }

  /** A person's monthly cost. The amount isn't written to the audit log, only that it changed. */
  @Put('reports/costs/people/:userId')
  @MinRole('admin')
  async setMemberCost(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body(new ZodPipe(memberCostSchema)) body: z.infer<typeof memberCostSchema>,
    @CurrentAuth() auth: AuthContext,
    @CurrentWorkspace() ws: WorkspaceContext,
    @ClientIp() ip: string | undefined,
  ) {
    await this.db.withContext(this.ctx(auth, ws), async (tx) => {
      const updated = await tx
        .update(memberships)
        .set({ monthlyCost: body.monthlyCost })
        .where(and(eq(memberships.workspaceId, ws.id), eq(memberships.userId, userId)))
        .returning({ id: memberships.id });
      if (updated.length === 0) throw new BadRequestException('That person isn’t in this workspace.');
      await audit(tx, { workspaceId: ws.id, actorUserId: auth.userId, action: 'member.cost_changed', entityType: 'user', entityId: userId, metadata: {}, ip });
    });
    return { ok: true };
  }

  @Put('reports/costs/projects/:projectId')
  @MinRole('admin')
  async setProjectRate(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body(new ZodPipe(projectRateSchema)) body: z.infer<typeof projectRateSchema>,
    @CurrentAuth() auth: AuthContext,
    @CurrentWorkspace() ws: WorkspaceContext,
  ) {
    await this.db.withContext(this.ctx(auth, ws), async (tx) => {
      const updated = await tx
        .update(projects)
        .set({ hourlyRate: body.hourlyRate, rateCurrency: body.hourlyRate === null ? null : body.currency })
        .where(and(eq(projects.id, projectId), eq(projects.workspaceId, ws.id)))
        .returning({ id: projects.id });
      if (updated.length === 0) throw new BadRequestException('Project not found');
    });
    return { ok: true };
  }
}

