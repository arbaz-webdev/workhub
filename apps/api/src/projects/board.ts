// Shared helpers for projects, columns and tasks: access checks, card queries,
// ordering, and activity. All run inside the caller's tenant transaction.
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { hasRole, type LabelColor, type Priority, type TaskCardDto } from '@workhub/shared';
import { and, asc, eq, isNull, ne, sql } from 'drizzle-orm';
import type { WorkspaceContext } from '../common/request';
import type { Tx } from '../db/db.service';
import { boardColumns, projectMembers, projects, taskActivity, tasks } from '../db/schema';

export const GAP = 1024;

export function canManage(ws: WorkspaceContext) {
  return hasRole(ws.role, 'manager');
}

export function canEdit(ws: WorkspaceContext) {
  return hasRole(ws.role, 'member');
}

/**
 * Loads a project the caller may see. Members and above see every project in
 * the workspace (RLS already limits it to this workspace); guests only see
 * projects they were added to. Unknown and forbidden look the same: 404.
 */
export async function loadProject(tx: Tx, ws: WorkspaceContext, userId: string, projectId: string) {
  const [project] = await tx
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.workspaceId, ws.id)))
    .limit(1);
  if (!project) throw new NotFoundException('Project not found');
  if (!canEdit(ws)) {
    const [member] = await tx
      .select({ userId: projectMembers.userId })
      .from(projectMembers)
      .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)));
    if (!member) throw new NotFoundException('Project not found');
  }
  return project;
}

/** Loads a live task and its project, checking the caller can see the project. */
export async function loadTask(tx: Tx, ws: WorkspaceContext, userId: string, taskId: string) {
  const [task] = await tx
    .select()
    .from(tasks)
    .where(and(eq(tasks.id, taskId), eq(tasks.workspaceId, ws.id), isNull(tasks.deletedAt)))
    .limit(1);
  if (!task) throw new NotFoundException('Task not found');
  const project = await loadProject(tx, ws, userId, task.projectId);
  return { task, project };
}

export function requireEdit(ws: WorkspaceContext) {
  if (!canEdit(ws)) throw new ForbiddenException('Guests can view and comment, but not change tasks');
}

export function requireManage(ws: WorkspaceContext) {
  if (!canManage(ws)) throw new ForbiddenException('Only managers, admins and the owner can change the board');
}

export async function loadColumn(tx: Tx, projectId: string, columnId: string) {
  const [column] = await tx
    .select()
    .from(boardColumns)
    .where(and(eq(boardColumns.id, columnId), eq(boardColumns.projectId, projectId)))
    .limit(1);
  if (!column) throw new NotFoundException('Column not found');
  return column;
}

interface CardRow extends Record<string, unknown> {
  id: string;
  column_id: string;
  title: string;
  priority: Priority;
  due_date: string | null;
  estimate_hours: string | null;
  position: number;
  completed_at: Date | null;
  assignee_ids: string[];
  label_ids: string[];
  checklist_done: number;
  checklist_total: number;
  subtasks_done: number;
  subtasks_total: number;
  comment_count: number;
}

/** Board cards (top-level tasks) for a project, or just one when `taskId` is given. */
export async function cardsFor(tx: Tx, projectId: string, taskId?: string): Promise<TaskCardDto[]> {
  const result = await tx.execute<CardRow>(sql`
    select t.id, t.column_id, t.title, t.priority, t.due_date::text as due_date, t.estimate_hours,
           t.position, t.completed_at,
           coalesce((select array_agg(a.user_id::text order by a.user_id) from task_assignees a where a.task_id = t.id), '{}') as assignee_ids,
           coalesce((select array_agg(l.label_id::text order by l.label_id) from task_labels l where l.task_id = t.id), '{}') as label_ids,
           (select count(*) filter (where c.done) from checklist_items c where c.task_id = t.id)::int as checklist_done,
           (select count(*) from checklist_items c where c.task_id = t.id)::int as checklist_total,
           (select count(*) filter (where s.completed_at is not null) from tasks s
              where s.parent_task_id = t.id and s.deleted_at is null)::int as subtasks_done,
           (select count(*) from tasks s where s.parent_task_id = t.id and s.deleted_at is null)::int as subtasks_total,
           (select count(*) from task_comments m where m.task_id = t.id and m.deleted_at is null)::int as comment_count
    from tasks t
    where t.project_id = ${projectId} and t.parent_task_id is null and t.deleted_at is null
      ${taskId ? sql`and t.id = ${taskId}` : sql``}
    order by t.position`);
  return result.rows.map((r) => ({
    id: r.id,
    columnId: r.column_id,
    title: r.title,
    priority: r.priority,
    dueDate: r.due_date,
    estimateHours: r.estimate_hours === null ? null : Number(r.estimate_hours),
    position: Number(r.position),
    assigneeIds: r.assignee_ids,
    labelIds: r.label_ids,
    checklistDone: r.checklist_done,
    checklistTotal: r.checklist_total,
    subtasksDone: r.subtasks_done,
    subtasksTotal: r.subtasks_total,
    commentCount: r.comment_count,
    completed: r.completed_at !== null,
  }));
}

/** Picks a position that puts an item at `index` among `ordered` (already sorted, excluding the item). */
function positionBetween(ordered: { position: number }[], index: number): number | null {
  const i = Math.min(Math.max(index, 0), ordered.length);
  const before = ordered[i - 1]?.position;
  const after = ordered[i]?.position;
  if (before === undefined && after === undefined) return GAP;
  if (before === undefined) return after! - GAP;
  if (after === undefined) return before + GAP;
  // Too close to split further: caller renumbers and asks again.
  return after - before > 1e-6 ? (before + after) / 2 : null;
}

/** Position for a top-level task placed at `index` in a column (renumbers the column if needed). */
export async function taskPosition(tx: Tx, columnId: string, index: number, movingId?: string): Promise<number> {
  const load = () =>
    tx
      .select({ id: tasks.id, position: tasks.position })
      .from(tasks)
      .where(
        and(
          eq(tasks.columnId, columnId),
          isNull(tasks.parentTaskId),
          isNull(tasks.deletedAt),
          movingId ? ne(tasks.id, movingId) : undefined,
        ),
      )
      .orderBy(asc(tasks.position));
  let rows = await load();
  const pos = positionBetween(rows, index);
  if (pos !== null) return pos;
  for (const [i, r] of rows.entries()) await tx.update(tasks).set({ position: (i + 1) * GAP }).where(eq(tasks.id, r.id));
  rows = await load();
  return positionBetween(rows, index)!;
}

/** Position for a column placed at `index` in a project (renumbers if needed). */
export async function columnPosition(tx: Tx, projectId: string, index: number, movingId?: string): Promise<number> {
  const load = () =>
    tx
      .select({ id: boardColumns.id, position: boardColumns.position })
      .from(boardColumns)
      .where(and(eq(boardColumns.projectId, projectId), movingId ? ne(boardColumns.id, movingId) : undefined))
      .orderBy(asc(boardColumns.position));
  let rows = await load();
  const pos = positionBetween(rows, index);
  if (pos !== null) return pos;
  for (const [i, r] of rows.entries()) {
    await tx.update(boardColumns).set({ position: (i + 1) * GAP }).where(eq(boardColumns.id, r.id));
  }
  rows = await load();
  return positionBetween(rows, index)!;
}

export async function recordActivity(
  tx: Tx,
  workspaceId: string,
  taskId: string,
  actorId: string,
  type: string,
  data: Record<string, unknown> = {},
) {
  await tx.insert(taskActivity).values({ workspaceId, taskId, actorId, type, data });
}

export function asLabelColor(c: string): LabelColor {
  return c as LabelColor;
}
