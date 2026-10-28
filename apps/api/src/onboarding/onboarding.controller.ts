import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { onboardingSchema, type Industry, type OnboardingDto, type OnboardingInput, type OnboardingResultDto } from '@workhub/shared';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { zonedParts } from '../attendance/zoned';
import { audit } from '../audit/audit';
import { AuthContext, ClientIp, CurrentAuth, CurrentWorkspace, MinRole, WorkspaceContext } from '../common/request';
import { ZodPipe } from '../common/zod.pipe';
import { ensureDefaultPipeline } from '../crm/deals';
import { DbService } from '../db/db.service';
import { deals, holidays, pipelines, pipelineStages, shifts, teams, workspaces } from '../db/schema';
import { pakistanHolidays } from '../leave/holidays-pk';
import { createProject } from '../projects/create';
import { BUILTIN_TEMPLATES } from '../projects/templates';
import { WorkspaceGuard } from '../workspaces/workspace.guard';

const WEEKDAYS = [1, 2, 3, 4, 5];

/** Sensible starting points per industry; every one can be changed in the wizard. */
export const PRESETS: OnboardingDto['presets'] = {
  software_house: {
    teams: ['Engineering', 'Design', 'QA', 'Sales'],
    shift: { name: 'Office hours', startTime: '09:00', endTime: '18:00' },
    workingDays: WEEKDAYS,
    template: 'builtin:mobile-app',
    stages: [
      { name: 'New', probability: 10 },
      { name: 'Discovery call', probability: 25 },
      { name: 'Proposal sent', probability: 50 },
      { name: 'Negotiation', probability: 75 },
    ],
  },
  agency: {
    teams: ['Creative', 'Content', 'Accounts', 'Sales'],
    shift: { name: 'Office hours', startTime: '10:00', endTime: '19:00' },
    workingDays: WEEKDAYS,
    template: 'builtin:marketing',
    stages: [
      { name: 'New lead', probability: 10 },
      { name: 'Brief received', probability: 25 },
      { name: 'Proposal sent', probability: 50 },
      { name: 'Negotiation', probability: 75 },
    ],
  },
  bpo: {
    teams: ['Operations', 'Quality', 'Support', 'HR'],
    // US daytime is Pakistan's night.
    shift: { name: 'Night shift', startTime: '20:00', endTime: '05:00' },
    workingDays: WEEKDAYS,
    template: null,
    stages: [
      { name: 'New', probability: 10 },
      { name: 'Requirements', probability: 25 },
      { name: 'Pilot', probability: 50 },
      { name: 'Contract', probability: 80 },
    ],
  },
  consultancy: {
    teams: ['Consulting', 'Finance', 'Admin'],
    shift: { name: 'Office hours', startTime: '09:00', endTime: '17:00' },
    workingDays: WEEKDAYS,
    template: null,
    stages: [
      { name: 'New', probability: 10 },
      { name: 'First meeting', probability: 25 },
      { name: 'Proposal sent', probability: 50 },
      { name: 'Engagement letter', probability: 80 },
    ],
  },
  other: {
    teams: ['Operations', 'Sales'],
    shift: { name: 'Office hours', startTime: '09:00', endTime: '18:00' },
    workingDays: WEEKDAYS,
    template: null,
    stages: [
      { name: 'New', probability: 10 },
      { name: 'Qualified', probability: 25 },
      { name: 'Proposal sent', probability: 50 },
      { name: 'Negotiation', probability: 75 },
    ],
  },
};

/** The first-run wizard: industry, hours, teams, holidays, a sample project and pipeline. */
@Controller('onboarding')
@UseGuards(WorkspaceGuard)
@MinRole('admin')
export class OnboardingController {
  constructor(private readonly db: DbService) {}

  @Get()
  @MinRole('guest')
  async status(@CurrentAuth() auth: AuthContext, @CurrentWorkspace() ws: WorkspaceContext): Promise<OnboardingDto> {
    return this.db.withContext({ workspaceId: ws.id, userId: auth.userId }, async (tx) => {
      const [w] = await tx.select({ industry: workspaces.industry, onboardedAt: workspaces.onboardedAt }).from(workspaces).where(eq(workspaces.id, ws.id));
      return { done: !!w?.onboardedAt, industry: (w?.industry as Industry | null) ?? null, presets: PRESETS };
    });
  }

  /** Applies the wizard's choices. Safe to run again: it only adds what isn't there. */
  @Post()
  async complete(
    @Body(new ZodPipe(onboardingSchema)) body: OnboardingInput,
    @CurrentAuth() auth: AuthContext,
    @CurrentWorkspace() ws: WorkspaceContext,
    @ClientIp() ip: string | undefined,
  ): Promise<OnboardingResultDto> {
    if (!Intl.supportedValuesOf('timeZone').includes(body.timezone) && body.timezone !== 'UTC') {
      body.timezone = 'Asia/Karachi';
    }
    const preset = PRESETS[body.industry];
    return this.db.withContext({ workspaceId: ws.id, userId: auth.userId }, async (tx) => {
      const workingDays = [...new Set(body.workingDays)].sort();
      await tx
        .update(workspaces)
        .set({ industry: body.industry, timezone: body.timezone, currency: body.currency, workingDays, onboardedAt: new Date() })
        .where(eq(workspaces.id, ws.id));

      // A first shift, unless they already have one.
      if (body.shift) {
        const [existing] = await tx.select({ id: shifts.id }).from(shifts).where(eq(shifts.workspaceId, ws.id)).limit(1);
        if (!existing) {
          await tx.insert(shifts).values({ workspaceId: ws.id, name: body.shift.name, startTime: `${body.shift.startTime}:00`, endTime: `${body.shift.endTime}:00`, workingDays, isDefault: true });
        }
      }

      let teamCount = 0;
      for (const name of [...new Set(body.teams.map((t) => t.trim()).filter(Boolean))]) {
        const [taken] = await tx
          .select({ id: teams.id })
          .from(teams)
          .where(and(eq(teams.workspaceId, ws.id), isNull(teams.deletedAt), sql`lower(${teams.name}) = ${name.toLowerCase()}`));
        if (taken) continue;
        await tx.insert(teams).values({ workspaceId: ws.id, name, createdBy: auth.userId });
        teamCount += 1;
      }

      let holidayCount = 0;
      if (body.loadHolidays) {
        const today = zonedParts(new Date(), body.timezone).date;
        const year = Number(today.slice(0, 4));
        // Late in the year, next year's too.
        const years = today.slice(5, 7) >= '11' ? [year, year + 1] : [year];
        for (const y of years) {
          const added = await tx
            .insert(holidays)
            .values(pakistanHolidays(y).map((p) => ({ workspaceId: ws.id, date: p.date, name: p.name, kind: 'public' as const, estimated: p.estimated, presetKey: p.key })))
            .onConflictDoNothing({ target: [holidays.workspaceId, holidays.presetKey] })
            .returning({ id: holidays.id });
          holidayCount += added.length;
        }
      }

      // The sales pipeline's stages, if no deals depend on them yet.
      await ensureDefaultPipeline(tx, ws.id);
      const [pipeline] = await tx
        .select({ id: pipelines.id })
        .from(pipelines)
        .where(and(eq(pipelines.workspaceId, ws.id), eq(pipelines.isDefault, true), isNull(pipelines.archivedAt)));
      if (pipeline) {
        const [{ n }] = (await tx
          .select({ n: sql<number>`count(*)::int` })
          .from(deals)
          .where(eq(deals.pipelineId, pipeline.id))) as [{ n: number }];
        if (n === 0) {
          await tx.delete(pipelineStages).where(and(eq(pipelineStages.pipelineId, pipeline.id), eq(pipelineStages.kind, 'open')));
          await tx.insert(pipelineStages).values(preset.stages.map((s, i) => ({ workspaceId: ws.id, pipelineId: pipeline.id, name: s.name, probability: s.probability, kind: 'open' as const, position: i })));
        }
      }

      let projectId: string | null = null;
      if (body.sampleProject && preset.template) {
        const template = BUILTIN_TEMPLATES.find((t) => `builtin:${t.key}` === preset.template);
        projectId = await createProject(tx, ws.id, auth.userId, { name: `Sample: ${template?.name ?? 'Project'}`, description: 'A starting point from the setup wizard. Rename it, or delete it when you’re ready.', templateId: preset.template }, ip, 'onboarding');
      }

      await audit(tx, { workspaceId: ws.id, actorUserId: auth.userId, action: 'workspace.onboarded', entityType: 'workspace', entityId: ws.id, metadata: { industry: body.industry, teams: teamCount, holidays: holidayCount, sampleProject: !!projectId }, ip });
      return { teams: teamCount, holidays: holidayCount, projectId };
    });
  }
}
