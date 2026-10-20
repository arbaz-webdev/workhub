import { Controller, Get, UseGuards } from '@nestjs/common';
import type { MyWorkDto, Priority } from '@workhub/shared';
import { sql } from 'drizzle-orm';
import { AuthContext, CurrentAuth, CurrentWorkspace, MinRole, WorkspaceContext } from '../common/request';
import { DbService } from '../db/db.service';
import { WorkspaceGuard } from '../workspaces/workspace.guard';

/** The caller's open tasks across every project in this workspace. */
@Controller('me')
@UseGuards(WorkspaceGuard)
@MinRole('guest')
export class MyWorkController {
  constructor(private readonly db: DbService) {}

  @Get('tasks')
  myTasks(@CurrentAuth() auth: AuthContext, @CurrentWorkspace() ws: WorkspaceContext): Promise<MyWorkDto> {
    return this.db.withContext({ workspaceId: ws.id, userId: auth.userId }, async (tx) => {
      // "Today" follows the workspace's time zone, so Karachi's evening isn't "tomorrow" in UTC.
      const today = await tx.execute<{ today: string }>(
        sql`select (now() at time zone timezone)::date::text as today from workspaces where id = ${ws.id}`,
      );
      const guestFilter =
        ws.role === 'guest'
          ? sql`and exists (select 1 from project_members pm where pm.project_id = p.id and pm.user_id = ${auth.userId})`
          : sql``;
      const rows = await tx.execute<{
        id: string;
        title: string;
        project_id: string;
        project_name: string;
        parent_task_id: string | null;
        column_name: string;
        priority: Priority;
        due_date: string | null;
        estimate_hours: string | null;
      }>(sql`
        select t.id, t.title, p.id as project_id, p.name as project_name, t.parent_task_id,
               c.name as column_name, t.priority, t.due_date::text as due_date, t.estimate_hours
        from task_assignees a
        join tasks t on t.id = a.task_id and t.deleted_at is null and t.completed_at is null
        join projects p on p.id = t.project_id and p.status <> 'archived'
        join board_columns c on c.id = t.column_id
        where a.user_id = ${auth.userId} and t.workspace_id = ${ws.id} ${guestFilter}
          and (t.parent_task_id is null or exists (
                 select 1 from tasks parent where parent.id = t.parent_task_id and parent.deleted_at is null))
        order by t.due_date nulls last,
                 array_position(array['urgent','high','medium','low','none']::task_priority[], t.priority),
                 t.created_at
        limit 500`);
      return {
        today: today.rows[0]!.today,
        tasks: rows.rows.map((r) => ({
          id: r.id,
          title: r.title,
          projectId: r.project_id,
          projectName: r.project_name,
          parentTaskId: r.parent_task_id,
          columnName: r.column_name,
          priority: r.priority,
          dueDate: r.due_date,
          estimateHours: r.estimate_hours === null ? null : Number(r.estimate_hours),
        })),
      };
    });
  }
}
