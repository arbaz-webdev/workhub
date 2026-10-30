import { NotFoundException } from '@nestjs/common';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { Tx } from '../db/db.service';
import { activities, boardColumns, clientDocuments, contacts, deals, leads, leaveRequests, leaveTypes, pipelines, pipelineStages, taskAssignees, tasks, users } from '../db/schema';
import { iso } from './paging';

// What the public API (and webhook payloads) say about each kind of record. These are a
// promise to customers: change them only by adding fields.
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

export type InvoiceDto = ReturnType<typeof invoiceDto>;

export function invoiceDto(d: typeof clientDocuments.$inferSelect) {
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

export async function assigneesOf(tx: Tx, taskIds: string[]): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  if (taskIds.length === 0) return map;
  const rows = await tx.select().from(taskAssignees).where(inArray(taskAssignees.taskId, taskIds));
  for (const r of rows) map.set(r.taskId, [...(map.get(r.taskId) ?? []), r.userId]);
  return map;
}

type LeaveRow = { request: typeof leaveRequests.$inferSelect; userName: string; typeName: string; paid: boolean };

export function leaveOut({ request: l, userName, typeName, paid }: LeaveRow) {
  return {
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
  };
}

/** Leave requests with the names leaveOut needs. */
export function leaveSelect(tx: Tx) {
  return tx
    .select({ request: leaveRequests, userName: users.name, typeName: leaveTypes.name, paid: leaveTypes.paid })
    .from(leaveRequests)
    .innerJoin(users, eq(users.id, leaveRequests.userId))
    .innerJoin(leaveTypes, eq(leaveTypes.id, leaveRequests.leaveTypeId));
}

export async function loadLeaveOut(tx: Tx, workspaceId: string, id: string) {
  const [row] = await leaveSelect(tx).where(and(eq(leaveRequests.id, id), eq(leaveRequests.workspaceId, workspaceId)));
  if (!row) throw new NotFoundException('Leave request not found');
  return leaveOut(row);
}

type DealRow = { deal: typeof deals.$inferSelect; pipeline: string; stage: string };

export function dealOut({ deal: d, pipeline, stage }: DealRow) {
  return {
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
  };
}

/** Deals with the names dealOut needs. */
export function dealSelect(tx: Tx) {
  return tx
    .select({ deal: deals, pipeline: pipelines.name, stage: pipelineStages.name })
    .from(deals)
    .innerJoin(pipelines, eq(pipelines.id, deals.pipelineId))
    .innerJoin(pipelineStages, eq(pipelineStages.id, deals.stageId));
}

export async function loadDealOut(tx: Tx, workspaceId: string, id: string) {
  const [row] = await dealSelect(tx).where(and(eq(deals.id, id), eq(deals.workspaceId, workspaceId)));
  if (!row) throw new NotFoundException('Deal not found');
  return dealOut(row);
}

export async function loadLeadOut(tx: Tx, workspaceId: string, id: string) {
  const [row] = await tx.select().from(leads).where(and(eq(leads.id, id), eq(leads.workspaceId, workspaceId)));
  if (!row) throw new NotFoundException('Lead not found');
  return leadOut(row);
}

export async function loadInvoiceOut(tx: Tx, workspaceId: string, id: string) {
  const [row] = await tx.select().from(clientDocuments).where(and(eq(clientDocuments.id, id), eq(clientDocuments.workspaceId, workspaceId)));
  if (!row) throw new NotFoundException('Invoice not found');
  return invoiceDto(row);
}
