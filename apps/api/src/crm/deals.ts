// Pipelines, deals and activities: defaults, positions and DTOs. All run inside the
// caller's tenant transaction.
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import type { CrmActivityDto, DealDto, MoneyDto, PersonDto, PipelineDto } from '@workhub/shared';
import { and, asc, eq, inArray, isNull, max, sql } from 'drizzle-orm';
import type { Tx } from '../db/db.service';
import { activities, companies, contacts, deals, leads, pipelines, pipelineStages, users } from '../db/schema';
import { fullName } from './crm';

export type DealRow = typeof deals.$inferSelect;
export type StageRow = typeof pipelineStages.$inferSelect;
export type ActivityRow = typeof activities.$inferSelect;

const GAP = 1024;

/** A first pipeline for agencies and software houses; every workspace gets one. */
const DEFAULT_STAGES: [string, number][] = [
  ['New', 10],
  ['Qualified', 25],
  ['Proposal sent', 50],
  ['Negotiation', 75],
];

export async function ensureDefaultPipeline(tx: Tx, workspaceId: string): Promise<void> {
  const [existing] = await tx
    .select({ id: pipelines.id })
    .from(pipelines)
    .where(and(eq(pipelines.workspaceId, workspaceId), isNull(pipelines.archivedAt)))
    .limit(1);
  if (existing) return;
  const [p] = await tx.insert(pipelines).values({ workspaceId, name: 'Sales', isDefault: true }).onConflictDoNothing().returning({ id: pipelines.id });
  // Another request created it at the same moment.
  if (!p) return;
  await writeStages(
    tx,
    workspaceId,
    p.id,
    DEFAULT_STAGES.map(([name, probability]) => ({ name, probability })),
  );
}

/** Inserts open stages in order, then Won and Lost. */
export async function writeStages(tx: Tx, workspaceId: string, pipelineId: string, open: { name: string; probability: number }[]) {
  await tx.insert(pipelineStages).values([
    ...open.map((s, i) => ({ workspaceId, pipelineId, name: s.name, probability: s.probability, kind: 'open' as const, position: i })),
    { workspaceId, pipelineId, name: 'Won', probability: 100, kind: 'won' as const, position: 1000 },
    { workspaceId, pipelineId, name: 'Lost', probability: 0, kind: 'lost' as const, position: 1001 },
  ]);
}

export async function pipelineDtos(tx: Tx, workspaceId: string, only?: string): Promise<PipelineDto[]> {
  const rows = await tx
    .select()
    .from(pipelines)
    .where(and(eq(pipelines.workspaceId, workspaceId), isNull(pipelines.archivedAt), only ? eq(pipelines.id, only) : undefined))
    .orderBy(sql`${pipelines.isDefault} desc`, asc(pipelines.position), asc(pipelines.createdAt));
  if (rows.length === 0) return [];
  const stages = await tx
    .select()
    .from(pipelineStages)
    .where(
      inArray(
        pipelineStages.pipelineId,
        rows.map((r) => r.id),
      ),
    )
    .orderBy(asc(pipelineStages.position));
  return rows.map((p) => ({
    id: p.id,
    name: p.name,
    isDefault: p.isDefault,
    stages: stages.filter((s) => s.pipelineId === p.id).map((s) => ({ id: s.id, name: s.name, probability: s.probability, kind: s.kind, position: s.position })),
  }));
}

export async function loadStage(tx: Tx, workspaceId: string, stageId: string): Promise<StageRow> {
  const [s] = await tx
    .select()
    .from(pipelineStages)
    .where(and(eq(pipelineStages.id, stageId), eq(pipelineStages.workspaceId, workspaceId)));
  if (!s) throw new BadRequestException('Choose a stage in this pipeline.');
  return s;
}

/** The pipeline to use: the one given, or the default; and the stage: the one given, or its first. */
export async function resolveStage(tx: Tx, workspaceId: string, pipelineId?: string, stageId?: string): Promise<StageRow> {
  if (stageId) {
    const s = await loadStage(tx, workspaceId, stageId);
    if (pipelineId && s.pipelineId !== pipelineId) throw new BadRequestException('That stage belongs to another pipeline.');
    return s;
  }
  await ensureDefaultPipeline(tx, workspaceId);
  const [p] = await tx
    .select({ id: pipelines.id })
    .from(pipelines)
    .where(and(eq(pipelines.workspaceId, workspaceId), isNull(pipelines.archivedAt), pipelineId ? eq(pipelines.id, pipelineId) : eq(pipelines.isDefault, true)));
  if (!p) throw new BadRequestException('Choose a pipeline in this workspace.');
  const [first] = await tx
    .select()
    .from(pipelineStages)
    .where(and(eq(pipelineStages.pipelineId, p.id), eq(pipelineStages.kind, 'open')))
    .orderBy(asc(pipelineStages.position))
    .limit(1);
  // Only while another request is still writing the default pipeline's stages.
  if (!first) throw new ConflictException('The pipeline is being set up. Try again in a moment.');
  return first;
}

/** A position at the end of a stage's column. */
export async function endOfStage(tx: Tx, stageId: string): Promise<number> {
  const [{ top }] = (await tx
    .select({ top: max(deals.position) })
    .from(deals)
    .where(and(eq(deals.stageId, stageId), isNull(deals.deletedAt)))) as [{ top: number | null }];
  return (top ?? 0) + GAP;
}

/** A position for slot `index` in a stage's column, leaving `movingId` out of the count. */
export async function positionAt(tx: Tx, stageId: string, index: number, movingId: string): Promise<number> {
  const rows = await tx
    .select({ id: deals.id, position: deals.position })
    .from(deals)
    .where(and(eq(deals.stageId, stageId), isNull(deals.deletedAt)))
    .orderBy(asc(deals.position));
  const others = rows.filter((r) => r.id !== movingId);
  const before = others[index - 1]?.position;
  const after = others[index]?.position;
  if (before === undefined && after === undefined) return GAP;
  if (before === undefined) return after! / 2;
  if (after === undefined) return before + GAP;
  return (before + after) / 2;
}

export async function loadDeal(tx: Tx, workspaceId: string, id: string): Promise<DealRow> {
  const [row] = await tx
    .select()
    .from(deals)
    .where(and(eq(deals.id, id), eq(deals.workspaceId, workspaceId), isNull(deals.deletedAt)));
  if (!row) throw new NotFoundException('Deal not found');
  return row;
}

async function peopleById(tx: Tx, ids: (string | null)[]): Promise<Map<string, PersonDto>> {
  const unique = [...new Set(ids.filter((i): i is string => !!i))];
  if (unique.length === 0) return new Map();
  const rows = await tx.select({ id: users.id, name: users.name, email: users.email }).from(users).where(inArray(users.id, unique));
  return new Map(rows.map((u) => [u.id, u]));
}

async function companiesById(tx: Tx, ids: (string | null)[]) {
  const unique = [...new Set(ids.filter((i): i is string => !!i))];
  if (unique.length === 0) return new Map<string, { id: string; name: string }>();
  const rows = await tx
    .select({ id: companies.id, name: companies.name })
    .from(companies)
    .where(and(inArray(companies.id, unique), isNull(companies.deletedAt)));
  return new Map(rows.map((c) => [c.id, c]));
}

async function contactsById(tx: Tx, ids: (string | null)[]) {
  const unique = [...new Set(ids.filter((i): i is string => !!i))];
  if (unique.length === 0) return new Map<string, { id: string; name: string }>();
  const rows = await tx
    .select({ id: contacts.id, firstName: contacts.firstName, lastName: contacts.lastName })
    .from(contacts)
    .where(and(inArray(contacts.id, unique), isNull(contacts.deletedAt)));
  return new Map(rows.map((c) => [c.id, { id: c.id, name: fullName(c.firstName, c.lastName) }]));
}

export async function dealDtos(tx: Tx, rows: DealRow[]): Promise<DealDto[]> {
  if (rows.length === 0) return [];
  const stageRows = await tx
    .select()
    .from(pipelineStages)
    .where(
      inArray(
        pipelineStages.id,
        rows.map((r) => r.stageId),
      ),
    );
  const people = await peopleById(
    tx,
    rows.map((r) => r.ownerId),
  );
  const firms = await companiesById(
    tx,
    rows.map((r) => r.companyId),
  );
  const persons = await contactsById(
    tx,
    rows.map((r) => r.contactId),
  );
  // The next open follow-up per deal.
  const next = await tx
    .selectDistinctOn([activities.dealId], { dealId: activities.dealId, id: activities.id, subject: activities.subject, dueAt: activities.dueAt })
    .from(activities)
    .where(
      and(
        inArray(
          activities.dealId,
          rows.map((r) => r.id),
        ),
        isNull(activities.doneAt),
        sql`${activities.dueAt} is not null`,
      ),
    )
    .orderBy(activities.dealId, asc(activities.dueAt));
  return rows.map((r) => {
    const stage = stageRows.find((s) => s.id === r.stageId);
    const n = next.find((x) => x.dealId === r.id);
    return {
      id: r.id,
      title: r.title,
      pipelineId: r.pipelineId,
      stageId: r.stageId,
      stageName: stage?.name ?? '',
      probability: stage?.probability ?? 0,
      value: r.value,
      currency: r.currency,
      company: r.companyId ? (firms.get(r.companyId) ?? null) : null,
      contact: r.contactId ? (persons.get(r.contactId) ?? null) : null,
      owner: r.ownerId ? (people.get(r.ownerId) ?? null) : null,
      expectedClose: r.expectedClose,
      status: r.status,
      wonAt: r.wonAt?.toISOString() ?? null,
      lostAt: r.lostAt?.toISOString() ?? null,
      lostReason: r.lostReason,
      projectId: r.projectId,
      position: r.position,
      notes: r.notes,
      nextActivity: n?.dueAt ? { id: n.id, subject: n.subject, dueAt: n.dueAt.toISOString() } : null,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    };
  });
}

export async function activityDtos(tx: Tx, rows: ActivityRow[], now = new Date()): Promise<CrmActivityDto[]> {
  if (rows.length === 0) return [];
  const people = await peopleById(tx, [...rows.map((r) => r.ownerId), ...rows.map((r) => r.createdBy)]);
  const firms = await companiesById(
    tx,
    rows.map((r) => r.companyId),
  );
  const persons = await contactsById(
    tx,
    rows.map((r) => r.contactId),
  );
  const dealIds = [...new Set(rows.map((r) => r.dealId).filter((i): i is string => !!i))];
  const dealRows = dealIds.length ? await tx.select({ id: deals.id, title: deals.title }).from(deals).where(inArray(deals.id, dealIds)) : [];
  const leadIds = [...new Set(rows.map((r) => r.leadId).filter((i): i is string => !!i))];
  const leadRows = leadIds.length ? await tx.select({ id: leads.id, name: leads.name }).from(leads).where(inArray(leads.id, leadIds)) : [];
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    subject: r.subject,
    body: r.body,
    dueAt: r.dueAt?.toISOString() ?? null,
    doneAt: r.doneAt?.toISOString() ?? null,
    overdue: !r.doneAt && !!r.dueAt && r.dueAt < now,
    owner: r.ownerId ? (people.get(r.ownerId) ?? null) : null,
    createdBy: r.createdBy ? (people.get(r.createdBy) ?? null) : null,
    deal: dealRows.find((d) => d.id === r.dealId) ?? null,
    company: r.companyId ? (firms.get(r.companyId) ?? null) : null,
    contact: r.contactId ? (persons.get(r.contactId) ?? null) : null,
    lead: leadRows.find((l) => l.id === r.leadId) ?? null,
    createdAt: r.createdAt.toISOString(),
  }));
}

/** Adds up values per currency, optionally weighting each by a factor. */
export function sumByCurrency(items: { value: number | null; currency: string; weight?: number }[]): MoneyDto[] {
  const totals = new Map<string, number>();
  for (const i of items) {
    if (i.value === null) continue;
    totals.set(i.currency, (totals.get(i.currency) ?? 0) + i.value * (i.weight ?? 1));
  }
  return [...totals].map(([currency, value]) => ({ currency, value: Math.round(value * 100) / 100 })).sort((a, b) => b.value - a.value);
}
