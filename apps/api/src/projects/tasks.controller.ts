import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  checklistItemSchema,
  commentSchema,
  createTaskSchema,
  moveTaskSchema,
  updateChecklistItemSchema,
  updateTaskSchema,
  type CommentInput,
  type CreateTaskInput,
  type MoveTaskInput,
  type TaskCardDto,
  type TaskDetailDto,
  type UpdateTaskInput,
} from '@workhub/shared';
import { and, asc, desc, eq, inArray, isNull, max } from 'drizzle-orm';
import { AuthContext, CurrentAuth, CurrentWorkspace, MinRole, WorkspaceContext } from '../common/request';
import { ZodPipe } from '../common/zod.pipe';
import { DbService, Tx } from '../db/db.service';
import {
  boardColumns,
  checklistItems,
  labels,
  memberships,
  projectMembers,
  taskActivity,
  taskAssignees,
  taskComments,
  taskLabels,
  tasks,
  users,
} from '../db/schema';
import { notify } from '../notifications/notify';
import { RealtimeService } from '../realtime/realtime.service';
import { WorkspaceGuard } from '../workspaces/workspace.guard';
import { cardsFor, GAP, loadColumn, loadProject, loadTask, recordActivity, requireEdit, taskPosition } from './board';

type TaskRow = typeof tasks.$inferSelect;

@Controller()
@UseGuards(WorkspaceGuard)
@MinRole('guest') // guests can view and comment on tasks in their projects; edits need member+
export class TasksController {
  constructor(
    private readonly db: DbService,
    private readonly realtime: RealtimeService,
  ) {}

  @Post('projects/:id/tasks')
  async create(
    @Param('id', ParseUUIDPipe) projectId: string,
    @Body(new ZodPipe(createTaskSchema)) body: CreateTaskInput,
    @CurrentAuth() auth: AuthContext,
    @CurrentWorkspace() ws: WorkspaceContext,
  ): Promise<TaskCardDto | { id: string }> {
    requireEdit(ws);
    const { taskId, cardId } = await this.db.withContext({ workspaceId: ws.id, userId: auth.userId }, async (tx) => {
      await loadProject(tx, ws, auth.userId, projectId);
      let columnId: string;
      let position: number;
      if (body.parentTaskId) {
        // Subtasks live with their parent and never show on the board.
        const { task: parent } = await loadTask(tx, ws, auth.userId, body.parentTaskId);
        if (parent.projectId !== projectId || parent.parentTaskId) throw new BadRequestException('Invalid parent task');
        columnId = parent.columnId;
        const [{ m }] = (await tx.select({ m: max(tasks.position) }).from(tasks).where(eq(tasks.parentTaskId, parent.id))) as [
          { m: number | null },
        ];
        position = (m ?? 0) + GAP;
      } else {
        columnId = body.columnId ?? (await this.firstColumn(tx, projectId));
        await loadColumn(tx, projectId, columnId);
        position = await taskPosition(tx, columnId, Number.MAX_SAFE_INTEGER);
      }
      const [task] = await tx
        .insert(tasks)
        .values({
          workspaceId: ws.id,
          projectId,
          columnId,
          parentTaskId: body.parentTaskId ?? null,
          title: body.title,
          position,
          createdBy: auth.userId,
        })
        .returning();
      await recordActivity(tx, ws.id, body.parentTaskId ?? task!.id, auth.userId, body.parentTaskId ? 'subtask.created' : 'task.created', {
        title: body.title,
      });
      return { taskId: task!.id, cardId: body.parentTaskId ?? task!.id };
    });
    const card = await this.publishCard(ws, auth, projectId, cardId);
    return body.parentTaskId ? { id: taskId } : card!;
  }

  @Get('tasks/:id')
  detail(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentAuth() auth: AuthContext,
    @CurrentWorkspace() ws: WorkspaceContext,
  ): Promise<TaskDetailDto> {
    return this.db.withContext({ workspaceId: ws.id, userId: auth.userId }, async (tx) => {
      const { task } = await loadTask(tx, ws, auth.userId, id);
      return this.buildDetail(tx, task);
    });
  }

  @Patch('tasks/:id')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(updateTaskSchema)) body: UpdateTaskInput,
    @CurrentAuth() auth: AuthContext,
    @CurrentWorkspace() ws: WorkspaceContext,
  ): Promise<TaskDetailDto> {
    requireEdit(ws);
    const { detail, task } = await this.db.withContext({ workspaceId: ws.id, userId: auth.userId }, async (tx) => {
      const { task, project } = await loadTask(tx, ws, auth.userId, id);
      const fields: Partial<TaskRow> = {};
      const changes: Record<string, unknown> = {};
      for (const key of ['title', 'description', 'priority', 'dueDate', 'estimateHours'] as const) {
        if (body[key] !== undefined && body[key] !== task[key]) {
          (fields as Record<string, unknown>)[key] = body[key];
          if (key !== 'description') changes[key] = body[key];
        }
      }
      if (body.description !== undefined && body.description !== task.description) changes.description = true;
      if (body.completed !== undefined && body.completed !== (task.completedAt !== null)) {
        fields.completedAt = body.completed ? new Date() : null;
        changes.completed = body.completed;
      }
      if (Object.keys(fields).length > 0) await tx.update(tasks).set(fields).where(eq(tasks.id, id));

      if (body.assigneeIds) {
        const added = await this.setAssignees(tx, ws, task, body.assigneeIds);
        if (added.length > 0) {
          changes.assigned = added;
          const [me] = await tx.select({ name: users.name }).from(users).where(eq(users.id, auth.userId));
          await notify(
            tx,
            ws.id,
            added.filter((u) => u !== auth.userId),
            {
              type: 'task.assigned',
              title: `${me!.name} assigned you to "${body.title ?? task.title}"`,
              body: project.name,
              link: `/app/projects/${task.projectId}?task=${task.parentTaskId ?? task.id}`,
            },
          );
        }
      }
      if (body.labelIds) await this.setLabels(tx, ws.id, task, body.labelIds);

      if (Object.keys(changes).length > 0) {
        await recordActivity(tx, ws.id, task.parentTaskId ?? task.id, auth.userId, 'task.updated', {
          ...changes,
          ...(task.parentTaskId ? { subtask: body.title ?? task.title } : {}),
        });
      }
      const [fresh] = await tx.select().from(tasks).where(eq(tasks.id, id));
      return { detail: await this.buildDetail(tx, fresh!), task: fresh! };
    });
    await this.publishCard(ws, auth, task.projectId, task.parentTaskId ?? task.id);
    return detail;
  }

  /** Moves a card to `index` within `columnId` (same or another column of the project). */
  @Post('tasks/:id/move')
  async move(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(moveTaskSchema)) body: MoveTaskInput,
    @CurrentAuth() auth: AuthContext,
    @CurrentWorkspace() ws: WorkspaceContext,
  ): Promise<TaskCardDto> {
    requireEdit(ws);
    const task = await this.db.withContext({ workspaceId: ws.id, userId: auth.userId }, async (tx) => {
      const { task } = await loadTask(tx, ws, auth.userId, id);
      if (task.parentTaskId) throw new BadRequestException('Subtasks move with their parent');
      const target = await loadColumn(tx, task.projectId, body.columnId);
      const position = await taskPosition(tx, target.id, body.index, task.id);
      await tx.update(tasks).set({ columnId: target.id, position }).where(eq(tasks.id, id));
      // Subtasks follow their parent's column so column deletes stay consistent.
      await tx.update(tasks).set({ columnId: target.id }).where(eq(tasks.parentTaskId, id));
      if (target.id !== task.columnId) {
        const [from] = await tx.select({ name: boardColumns.name }).from(boardColumns).where(eq(boardColumns.id, task.columnId));
        await recordActivity(tx, ws.id, id, auth.userId, 'task.moved', { from: from?.name, to: target.name });
      }
      return task;
    });
    return (await this.publishCard(ws, auth, task.projectId, id))!;
  }

  @Delete('tasks/:id')
  @HttpCode(204)
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentAuth() auth: AuthContext,
    @CurrentWorkspace() ws: WorkspaceContext,
  ) {
    requireEdit(ws);
    const task = await this.db.withContext({ workspaceId: ws.id, userId: auth.userId }, async (tx) => {
      const { task } = await loadTask(tx, ws, auth.userId, id);
      await tx.update(tasks).set({ deletedAt: new Date() }).where(eq(tasks.id, id));
      if (task.parentTaskId) {
        await recordActivity(tx, ws.id, task.parentTaskId, auth.userId, 'subtask.deleted', { title: task.title });
      }
      return task;
    });
    if (task.parentTaskId) {
      await this.publishCard(ws, auth, task.projectId, task.parentTaskId);
    } else {
      this.realtime.publish(ws.id, task.projectId, { type: 'task.deleted', taskId: id });
    }
  }

  // ---- Checklist -----------------------------------------------------------------

  @Post('tasks/:id/checklist')
  async addChecklistItem(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(checklistItemSchema)) body: { text: string },
    @CurrentAuth() auth: AuthContext,
    @CurrentWorkspace() ws: WorkspaceContext,
  ): Promise<TaskDetailDto> {
    requireEdit(ws);
    return this.changeTask(ws, auth, id, async (tx) => {
      const [{ m }] = (await tx
        .select({ m: max(checklistItems.position) })
        .from(checklistItems)
        .where(eq(checklistItems.taskId, id))) as [{ m: number | null }];
      await tx.insert(checklistItems).values({ workspaceId: ws.id, taskId: id, text: body.text, position: (m ?? 0) + GAP });
    });
  }

  @Patch('tasks/:id/checklist/:itemId')
  async updateChecklistItem(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Body(new ZodPipe(updateChecklistItemSchema)) body: { text?: string; done?: boolean },
    @CurrentAuth() auth: AuthContext,
    @CurrentWorkspace() ws: WorkspaceContext,
  ): Promise<TaskDetailDto> {
    requireEdit(ws);
    return this.changeTask(ws, auth, id, async (tx) => {
      const updated = await tx
        .update(checklistItems)
        .set(body)
        .where(and(eq(checklistItems.id, itemId), eq(checklistItems.taskId, id)))
        .returning({ id: checklistItems.id });
      if (updated.length === 0) throw new NotFoundException('Checklist item not found');
    });
  }

  @Delete('tasks/:id/checklist/:itemId')
  async deleteChecklistItem(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @CurrentAuth() auth: AuthContext,
    @CurrentWorkspace() ws: WorkspaceContext,
  ): Promise<TaskDetailDto> {
    requireEdit(ws);
    return this.changeTask(ws, auth, id, async (tx) => {
      await tx.delete(checklistItems).where(and(eq(checklistItems.id, itemId), eq(checklistItems.taskId, id)));
    });
  }

  // ---- Comments --------------------------------------------------------------------

  /** Anyone who can see the task can comment, guests included. */
  @Post('tasks/:id/comments')
  async comment(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(commentSchema)) body: CommentInput,
    @CurrentAuth() auth: AuthContext,
    @CurrentWorkspace() ws: WorkspaceContext,
  ): Promise<TaskDetailDto> {
    return this.changeTask(ws, auth, id, async (tx, task) => {
      // Only people in this workspace can be mentioned (and notified).
      const mentions = body.mentions.length
        ? (
            await tx
              .select({ userId: memberships.userId })
              .from(memberships)
              .where(and(eq(memberships.workspaceId, ws.id), inArray(memberships.userId, body.mentions)))
          ).map((r) => r.userId)
        : [];
      await tx.insert(taskComments).values({ workspaceId: ws.id, taskId: id, authorId: auth.userId, body: body.body, mentions });

      const [me] = await tx.select({ name: users.name }).from(users).where(eq(users.id, auth.userId));
      const link = `/app/projects/${task.projectId}?task=${id}`;
      const snippet = body.body.length > 120 ? `${body.body.slice(0, 117)}…` : body.body;
      const mentioned = mentions.filter((u) => u !== auth.userId);
      await notify(tx, ws.id, mentioned, { type: 'comment.mention', title: `${me!.name} mentioned you on "${task.title}"`, body: snippet, link });
      // Assignees hear about new comments too (unless already notified as mentioned).
      const assignees = (await tx.select({ userId: taskAssignees.userId }).from(taskAssignees).where(eq(taskAssignees.taskId, id)))
        .map((r) => r.userId)
        .filter((u) => u !== auth.userId && !mentioned.includes(u));
      await notify(tx, ws.id, assignees, { type: 'comment.created', title: `${me!.name} commented on "${task.title}"`, body: snippet, link });
    });
  }

  @Delete('tasks/:id/comments/:commentId')
  async deleteComment(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('commentId', ParseUUIDPipe) commentId: string,
    @CurrentAuth() auth: AuthContext,
    @CurrentWorkspace() ws: WorkspaceContext,
  ): Promise<TaskDetailDto> {
    return this.changeTask(ws, auth, id, async (tx) => {
      const [c] = await tx
        .select({ authorId: taskComments.authorId })
        .from(taskComments)
        .where(and(eq(taskComments.id, commentId), eq(taskComments.taskId, id), isNull(taskComments.deletedAt)));
      if (!c) throw new NotFoundException('Comment not found');
      if (c.authorId !== auth.userId) throw new ForbiddenException('You can only delete your own comments');
      await tx.update(taskComments).set({ deletedAt: new Date() }).where(eq(taskComments.id, commentId));
    });
  }

  // ---- Internals ---------------------------------------------------------------------

  /** Runs a change to a task's details, then returns its detail and updates live viewers. */
  private async changeTask(
    ws: WorkspaceContext,
    auth: AuthContext,
    taskId: string,
    change: (tx: Tx, task: TaskRow) => Promise<void>,
  ): Promise<TaskDetailDto> {
    const { detail, task } = await this.db.withContext({ workspaceId: ws.id, userId: auth.userId }, async (tx) => {
      const { task } = await loadTask(tx, ws, auth.userId, taskId);
      await change(tx, task);
      return { detail: await this.buildDetail(tx, task), task };
    });
    await this.publishCard(ws, auth, task.projectId, task.parentTaskId ?? task.id);
    return detail;
  }

  /** Sends the fresh card (counts, fields) and a "details changed" hint to everyone on the board. */
  private async publishCard(ws: WorkspaceContext, auth: AuthContext, projectId: string, cardId: string) {
    const [card] = await this.db.withContext({ workspaceId: ws.id, userId: auth.userId }, (tx) => cardsFor(tx, projectId, cardId));
    if (card) this.realtime.publish(ws.id, projectId, { type: 'task.upserted', task: card });
    this.realtime.publish(ws.id, projectId, { type: 'task.changed', taskId: cardId });
    return card;
  }

  private async firstColumn(tx: Tx, projectId: string) {
    const [c] = await tx
      .select({ id: boardColumns.id })
      .from(boardColumns)
      .where(eq(boardColumns.projectId, projectId))
      .orderBy(asc(boardColumns.position))
      .limit(1);
    if (!c) throw new BadRequestException('This project has no columns');
    return c.id;
  }

  /** Replaces assignees; returns the newly added user ids. Guests must be on the project. */
  private async setAssignees(tx: Tx, ws: WorkspaceContext, task: TaskRow, userIds: string[]): Promise<string[]> {
    const wanted = [...new Set(userIds)];
    if (wanted.length) {
      const valid = await tx
        .select({ userId: memberships.userId, role: memberships.role })
        .from(memberships)
        .where(and(eq(memberships.workspaceId, ws.id), inArray(memberships.userId, wanted)));
      const guests = valid.filter((v) => v.role === 'guest').map((v) => v.userId);
      const guestsOnProject = guests.length
        ? (
            await tx
              .select({ userId: projectMembers.userId })
              .from(projectMembers)
              .where(and(eq(projectMembers.projectId, task.projectId), inArray(projectMembers.userId, guests)))
          ).map((r) => r.userId)
        : [];
      const ok = new Set(valid.filter((v) => v.role !== 'guest' || guestsOnProject.includes(v.userId)).map((v) => v.userId));
      if (wanted.some((u) => !ok.has(u))) throw new BadRequestException('Some assignees are not on this project');
    }
    const current = (await tx.select({ userId: taskAssignees.userId }).from(taskAssignees).where(eq(taskAssignees.taskId, task.id))).map(
      (r) => r.userId,
    );
    await tx.delete(taskAssignees).where(eq(taskAssignees.taskId, task.id));
    if (wanted.length) {
      await tx.insert(taskAssignees).values(wanted.map((userId) => ({ workspaceId: ws.id, taskId: task.id, userId })));
    }
    return wanted.filter((u) => !current.includes(u));
  }

  private async setLabels(tx: Tx, workspaceId: string, task: TaskRow, labelIds: string[]) {
    const wanted = [...new Set(labelIds)];
    if (wanted.length) {
      const valid = await tx
        .select({ id: labels.id })
        .from(labels)
        .where(and(eq(labels.projectId, task.projectId), inArray(labels.id, wanted)));
      if (valid.length !== wanted.length) throw new BadRequestException('Unknown label');
    }
    await tx.delete(taskLabels).where(eq(taskLabels.taskId, task.id));
    if (wanted.length) {
      await tx.insert(taskLabels).values(wanted.map((labelId) => ({ workspaceId, taskId: task.id, labelId })));
    }
  }

  private async buildDetail(tx: Tx, task: TaskRow): Promise<TaskDetailDto> {
    const [card] = await cardsFor(tx, task.projectId, task.parentTaskId ? task.parentTaskId : task.id);
    // A subtask isn't a board card; describe it from its own row.
    const base: TaskCardDto =
      task.parentTaskId || !card
        ? {
            id: task.id,
            columnId: task.columnId,
            title: task.title,
            priority: task.priority,
            dueDate: task.dueDate,
            estimateHours: task.estimateHours,
            position: task.position,
            assigneeIds: (await tx.select({ u: taskAssignees.userId }).from(taskAssignees).where(eq(taskAssignees.taskId, task.id))).map((r) => r.u),
            labelIds: [],
            checklistDone: 0,
            checklistTotal: 0,
            subtasksDone: 0,
            subtasksTotal: 0,
            commentCount: 0,
            completed: task.completedAt !== null,
          }
        : card;

    const [creator] = task.createdBy
      ? await tx.select({ name: users.name }).from(users).where(eq(users.id, task.createdBy))
      : [];
    const checklist = await tx
      .select({ id: checklistItems.id, text: checklistItems.text, done: checklistItems.done })
      .from(checklistItems)
      .where(eq(checklistItems.taskId, task.id))
      .orderBy(asc(checklistItems.position));
    const subtasks = (
      await tx
        .select({ id: tasks.id, title: tasks.title, completedAt: tasks.completedAt })
        .from(tasks)
        .where(and(eq(tasks.parentTaskId, task.id), isNull(tasks.deletedAt)))
        .orderBy(asc(tasks.position))
    ).map((s) => ({ id: s.id, title: s.title, completed: s.completedAt !== null }));
    const comments = (
      await tx
        .select({
          id: taskComments.id,
          body: taskComments.body,
          mentions: taskComments.mentions,
          createdAt: taskComments.createdAt,
          editedAt: taskComments.editedAt,
          authorId: users.id,
          authorName: users.name,
          authorEmail: users.email,
        })
        .from(taskComments)
        .leftJoin(users, eq(users.id, taskComments.authorId))
        .where(and(eq(taskComments.taskId, task.id), isNull(taskComments.deletedAt)))
        .orderBy(asc(taskComments.createdAt))
    ).map((c) => ({
      id: c.id,
      author: c.authorId ? { id: c.authorId, name: c.authorName!, email: c.authorEmail! } : null,
      body: c.body,
      mentions: c.mentions,
      createdAt: c.createdAt.toISOString(),
      editedAt: c.editedAt?.toISOString() ?? null,
    }));
    const activity = (
      await tx
        .select({ id: taskActivity.id, type: taskActivity.type, data: taskActivity.data, createdAt: taskActivity.createdAt, actorName: users.name })
        .from(taskActivity)
        .leftJoin(users, eq(users.id, taskActivity.actorId))
        .where(eq(taskActivity.taskId, task.id))
        .orderBy(desc(taskActivity.createdAt))
        .limit(50)
    ).map((a) => ({ ...a, actorName: a.actorName ?? null, createdAt: a.createdAt.toISOString() }));

    return {
      ...base,
      projectId: task.projectId,
      description: task.description,
      createdAt: task.createdAt.toISOString(),
      createdByName: creator?.name ?? null,
      checklist,
      subtasks,
      comments,
      activity,
    };
  }
}
