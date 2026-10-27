// Creating a project from a template: shared by the projects page and won CRM deals.
import { BadRequestException } from '@nestjs/common';
import type { CreateProjectInput } from '@workhub/shared';
import { and, eq } from 'drizzle-orm';
import { audit } from '../audit/audit';
import type { Tx } from '../db/db.service';
import { boardColumns, checklistItems, labels, projectMembers, projects, projectTemplates, tasks, type TemplateStructure } from '../db/schema';
import { GAP } from './board';
import { BLANK, findBuiltin } from './templates';

export async function resolveTemplate(tx: Tx, workspaceId: string, templateId?: string): Promise<TemplateStructure> {
  if (!templateId) return BLANK;
  if (templateId.startsWith('builtin:')) {
    const builtin = findBuiltin(templateId);
    if (!builtin) throw new BadRequestException('Unknown template');
    return builtin;
  }
  const [row] = /^[0-9a-f-]{36}$/i.test(templateId)
    ? await tx
        .select({ structure: projectTemplates.structure })
        .from(projectTemplates)
        .where(and(eq(projectTemplates.id, templateId), eq(projectTemplates.workspaceId, workspaceId)))
    : [];
  if (!row) throw new BadRequestException('Unknown template');
  return row.structure;
}

/** Creates a template's columns, labels and starter tasks (with checklists) in a new project. */
async function applyTemplate(tx: Tx, workspaceId: string, projectId: string, userId: string, t: TemplateStructure) {
  const columnNames = t.columns.length > 0 ? t.columns : BLANK.columns;
  const cols = await tx
    .insert(boardColumns)
    .values(columnNames.map((name, i) => ({ workspaceId, projectId, name, position: (i + 1) * GAP })))
    .returning({ id: boardColumns.id });
  if (t.labels.length > 0) {
    await tx.insert(labels).values(t.labels.map((l) => ({ workspaceId, projectId, name: l.name, color: l.color })));
  }
  for (const [i, task] of t.tasks.entries()) {
    const column = cols[Math.min(Math.max(task.column, 0), cols.length - 1)]!;
    const [row] = await tx
      .insert(tasks)
      .values({
        workspaceId,
        projectId,
        columnId: column.id,
        title: task.title,
        estimateHours: task.estimateHours ?? null,
        position: (i + 1) * GAP,
        createdBy: userId,
      })
      .returning({ id: tasks.id });
    if (task.checklist?.length) {
      await tx
        .insert(checklistItems)
        .values(task.checklist.map((text, j) => ({ workspaceId, taskId: row!.id, text, position: (j + 1) * GAP })));
    }
  }
}

/**
 * Creates a project (its board from the template, its creator as a member) and audits it.
 * The caller has already checked the client belongs to the workspace. Returns its id.
 */
export async function createProject(tx: Tx, workspaceId: string, userId: string, body: CreateProjectInput, ip: string | undefined, via?: string): Promise<string> {
  const structure = await resolveTemplate(tx, workspaceId, body.templateId);
  const [project] = await tx
    .insert(projects)
    .values({
      workspaceId,
      name: body.name,
      description: body.description || null,
      clientId: body.clientId ?? null,
      budgetHours: body.budgetHours ?? null,
      createdBy: userId,
    })
    .returning({ id: projects.id });
  await applyTemplate(tx, workspaceId, project!.id, userId, structure);
  await tx.insert(projectMembers).values({ workspaceId, projectId: project!.id, userId });
  await audit(tx, {
    workspaceId,
    actorUserId: userId,
    action: 'project.created',
    entityType: 'project',
    entityId: project!.id,
    metadata: { name: body.name, template: body.templateId ?? null, ...(via ? { via } : {}) },
    ip,
  });
  return project!.id;
}
