// Quotes and invoices a workspace sends its clients. All run inside the caller's tenant
// transaction, so RLS keeps every read and write to the workspace.
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import {
  documentTotals,
  type ClientDocKind,
  type ClientDocLineInput,
  type ClientDocStatus,
  type ClientDocSummaryDto,
  type ClientDocumentDto,
  type Currency,
  type UnbilledProjectDto,
} from '@workhub/shared';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { workspaceInfo } from '../attendance/attendance';
import { zonedParts } from '../attendance/zoned';
import type { Tx } from '../db/db.service';
import { clientDocumentCounters, clientDocumentLines, clientDocuments, companies, projects, subscriptions, timeEntries, workspaces } from '../db/schema';

export type ClientDocRow = typeof clientDocuments.$inferSelect;

const PREFIX: Record<ClientDocKind, string> = { quote: 'Q', invoice: 'INV' };

/** Which status each status may move to. Paid and void are final; a voided invoice frees its hours. */
const NEXT: Record<ClientDocKind, Partial<Record<ClientDocStatus, ClientDocStatus[]>>> = {
  quote: { draft: ['sent'], sent: ['accepted', 'declined', 'draft'], accepted: ['sent'], declined: ['sent'] },
  invoice: { draft: ['sent', 'void'], sent: ['paid', 'void', 'draft'], paid: ['sent'] },
};

export function canMove(kind: ClientDocKind, from: ClientDocStatus, to: ClientDocStatus): boolean {
  return NEXT[kind][from]?.includes(to) ?? false;
}

/** Today in the workspace's time zone. */
export async function workspaceToday(tx: Tx, workspaceId: string): Promise<string> {
  return zonedParts(new Date(), (await workspaceInfo(tx, workspaceId)).timezone).date;
}

/** Q-0001, INV-0001…: the next number of a kind, counted per workspace. */
export async function nextNumber(tx: Tx, workspaceId: string, kind: ClientDocKind): Promise<string> {
  const [row] = await tx
    .insert(clientDocumentCounters)
    .values({ workspaceId, kind, lastNumber: 1 })
    .onConflictDoUpdate({ target: [clientDocumentCounters.workspaceId, clientDocumentCounters.kind], set: { lastNumber: sql`${clientDocumentCounters.lastNumber} + 1` } })
    .returning({ n: clientDocumentCounters.lastNumber });
  return `${PREFIX[kind]}-${String(row!.n).padStart(4, '0')}`;
}

export async function loadDoc(tx: Tx, workspaceId: string, id: string): Promise<ClientDocRow> {
  const [row] = await tx.select().from(clientDocuments).where(and(eq(clientDocuments.id, id), eq(clientDocuments.workspaceId, workspaceId)));
  if (!row) throw new NotFoundException('Not found');
  return row;
}

export function assertDraft(doc: ClientDocRow) {
  if (doc.status !== 'draft') throw new ConflictException(`Only drafts can be changed. Move this ${doc.kind} back to draft first.`);
}

/** Lines that name a project must name one of this workspace's projects for this client. */
async function assertLineProjects(tx: Tx, workspaceId: string, companyId: string, lines: ClientDocLineInput[]) {
  const ids = [...new Set(lines.map((l) => l.projectId).filter((x): x is string => !!x))];
  if (ids.length === 0) return;
  const found = await tx
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.workspaceId, workspaceId), eq(projects.clientId, companyId), inArray(projects.id, ids)));
  if (found.length !== ids.length) throw new BadRequestException('A line names a project that isn’t this client’s.');
}

/** Replaces a document's lines and recalculates its totals. */
export async function writeLines(tx: Tx, doc: { id: string; workspaceId: string; companyId: string }, lines: ClientDocLineInput[], taxRate: number) {
  await assertLineProjects(tx, doc.workspaceId, doc.companyId, lines);
  const totals = documentTotals(lines, taxRate);
  await tx.delete(clientDocumentLines).where(eq(clientDocumentLines.documentId, doc.id));
  await tx.insert(clientDocumentLines).values(
    lines.map((l, i) => ({
      workspaceId: doc.workspaceId,
      documentId: doc.id,
      position: i,
      description: l.description,
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      amount: totals.amounts[i]!,
      projectId: l.projectId ?? null,
    })),
  );
  await tx.update(clientDocuments).set({ subtotal: totals.subtotal, taxAmount: totals.taxAmount, total: totals.total }).where(eq(clientDocuments.id, doc.id));
}

function isOverdue(row: Pick<ClientDocRow, 'kind' | 'status' | 'dueDate'>, today: string) {
  if (!row.dueDate || row.dueDate >= today) return false;
  return row.status === 'sent';
}

export function summaryDto(row: ClientDocRow, companyName: string, today: string): ClientDocSummaryDto {
  return {
    id: row.id,
    kind: row.kind,
    number: row.number,
    status: row.status,
    company: { id: row.companyId, name: companyName },
    currency: row.currency,
    issueDate: row.issueDate,
    dueDate: row.dueDate,
    total: row.total,
    overdue: isOverdue(row, today),
  };
}

export async function documentDto(tx: Tx, workspaceId: string, row: ClientDocRow): Promise<ClientDocumentDto> {
  const [client] = await tx.select().from(companies).where(eq(companies.id, row.companyId));
  const lines = await tx.select().from(clientDocumentLines).where(eq(clientDocumentLines.documentId, row.id)).orderBy(asc(clientDocumentLines.position));
  const [w] = await tx.select({ name: workspaces.name }).from(workspaces).where(eq(workspaces.id, workspaceId));
  const [sub] = await tx.select().from(subscriptions).where(eq(subscriptions.workspaceId, workspaceId));
  const [made] =
    row.kind === 'quote'
      ? await tx.select({ id: clientDocuments.id }).from(clientDocuments).where(and(eq(clientDocuments.quoteId, row.id), eq(clientDocuments.workspaceId, workspaceId)))
      : [];
  const [{ minutes }] = (await tx
    .select({ minutes: sql<number>`coalesce(sum(${timeEntries.minutes}), 0)::int` })
    .from(timeEntries)
    .where(eq(timeEntries.invoiceId, row.id))) as [{ minutes: number }];
  return {
    ...summaryDto(row, client?.name ?? '', await workspaceToday(tx, workspaceId)),
    notes: row.notes,
    taxLabel: row.taxLabel,
    taxRate: row.taxRate,
    subtotal: row.subtotal,
    taxAmount: row.taxAmount,
    lines: lines.map((l) => ({ id: l.id, description: l.description, quantity: l.quantity, unitPrice: l.unitPrice, amount: l.amount, projectId: l.projectId })),
    quoteId: row.kind === 'invoice' ? row.quoteId : null,
    invoiceId: made?.id ?? null,
    sentAt: row.sentAt?.toISOString() ?? null,
    paidAt: row.paidAt?.toISOString() ?? null,
    billedHours: Math.round((minutes / 60) * 100) / 100,
    client: { name: client?.name ?? '', email: client?.email ?? null, address: client?.address ?? null, city: client?.city ?? null, country: client?.country ?? null },
    // The billing details the workspace gave for its WorkHub invoices, if any.
    from: { name: sub?.billingName ?? w?.name ?? '', ntn: sub?.ntn ?? null, address: sub?.address ?? null, email: sub?.billingEmail ?? null },
  };
}

/**
 * Approved, billable, not-yet-billed time for a client's projects between two dates, by project.
 * "Approved" means the person's timesheet for that week was approved.
 */
function unbilledWhere(workspaceId: string, companyId: string, from: string, to: string) {
  return and(
    eq(timeEntries.workspaceId, workspaceId),
    eq(projects.clientId, companyId),
    eq(timeEntries.billable, true),
    isNull(timeEntries.invoiceId),
    sql`${timeEntries.workDate} between ${from} and ${to}`,
    sql`exists (select 1 from timesheets t where t.workspace_id = ${timeEntries.workspaceId} and t.user_id = ${timeEntries.userId}
        and t.status = 'approved' and ${timeEntries.workDate} >= t.week_start and ${timeEntries.workDate} < t.week_start + 7)`,
  );
}

export async function unbilledHours(tx: Tx, workspaceId: string, companyId: string, from: string, to: string): Promise<UnbilledProjectDto[]> {
  const rows = await tx
    .select({
      projectId: projects.id,
      projectName: projects.name,
      rate: projects.hourlyRate,
      currency: projects.rateCurrency,
      minutes: sql<number>`sum(${timeEntries.minutes})::int`,
      entries: sql<number>`count(*)::int`,
    })
    .from(timeEntries)
    .innerJoin(projects, eq(projects.id, timeEntries.projectId))
    .where(unbilledWhere(workspaceId, companyId, from, to))
    .groupBy(projects.id, projects.name, projects.hourlyRate, projects.rateCurrency)
    .orderBy(asc(projects.name));
  return rows.map((r) => {
    const hours = Math.round((r.minutes / 60) * 100) / 100;
    return {
      projectId: r.projectId,
      projectName: r.projectName,
      hours,
      entries: r.entries,
      rate: r.rate,
      currency: (r.currency as Currency | null) ?? null,
      amount: r.rate === null ? null : Math.round(hours * r.rate * 100) / 100,
    };
  });
}

/** Marks the unbilled time behind an invoice's projects as billed on it. */
export async function claimHours(tx: Tx, workspaceId: string, invoiceId: string, companyId: string, projectIds: string[], from: string, to: string) {
  const ids = tx
    .select({ id: timeEntries.id })
    .from(timeEntries)
    .innerJoin(projects, eq(projects.id, timeEntries.projectId))
    .where(and(unbilledWhere(workspaceId, companyId, from, to), inArray(timeEntries.projectId, projectIds)));
  await tx.update(timeEntries).set({ invoiceId }).where(inArray(timeEntries.id, ids));
}

/** Frees the hours on an invoice that's voided or deleted, so they can be billed again. */
export async function releaseHours(tx: Tx, invoiceId: string) {
  await tx.update(timeEntries).set({ invoiceId: null }).where(eq(timeEntries.invoiceId, invoiceId));
}

