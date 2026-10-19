import { Controller, Get, HttpCode, NotFoundException, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import type { NotificationsResponse } from '@workhub/shared';
import { and, count, desc, eq, isNull } from 'drizzle-orm';
import { AuthContext, CurrentAuth, CurrentWorkspace, WorkspaceContext } from '../common/request';
import { DbService } from '../db/db.service';
import { notifications } from '../db/schema';
import { WorkspaceGuard } from '../workspaces/workspace.guard';

/** The signed-in user's own notifications in the current workspace (RLS enforces "own"). */
@Controller('notifications')
@UseGuards(WorkspaceGuard)
export class NotificationsController {
  constructor(private readonly db: DbService) {}

  @Get()
  async list(@CurrentAuth() auth: AuthContext, @CurrentWorkspace() ws: WorkspaceContext): Promise<NotificationsResponse> {
    return this.db.withContext({ workspaceId: ws.id, userId: auth.userId }, async (tx) => {
      const mine = and(eq(notifications.workspaceId, ws.id), eq(notifications.userId, auth.userId));
      const rows = await tx.select().from(notifications).where(mine).orderBy(desc(notifications.createdAt)).limit(30);
      const [unread] = await tx
        .select({ n: count() })
        .from(notifications)
        .where(and(mine, isNull(notifications.readAt)));
      return {
        items: rows.map((r) => ({
          id: r.id,
          type: r.type,
          title: r.title,
          body: r.body,
          link: r.link,
          read: r.readAt !== null,
          createdAt: r.createdAt.toISOString(),
        })),
        unreadCount: unread?.n ?? 0,
      };
    });
  }

  @Post(':id/read')
  @HttpCode(204)
  async markRead(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentAuth() auth: AuthContext,
    @CurrentWorkspace() ws: WorkspaceContext,
  ) {
    const updated = await this.db.withContext({ workspaceId: ws.id, userId: auth.userId }, (tx) =>
      tx
        .update(notifications)
        .set({ readAt: new Date() })
        .where(and(eq(notifications.id, id), eq(notifications.userId, auth.userId)))
        .returning({ id: notifications.id }),
    );
    if (updated.length === 0) throw new NotFoundException();
  }

  @Post('read-all')
  @HttpCode(204)
  async markAllRead(@CurrentAuth() auth: AuthContext, @CurrentWorkspace() ws: WorkspaceContext) {
    await this.db.withContext({ workspaceId: ws.id, userId: auth.userId }, (tx) =>
      tx
        .update(notifications)
        .set({ readAt: new Date() })
        .where(
          and(
            eq(notifications.workspaceId, ws.id),
            eq(notifications.userId, auth.userId),
            isNull(notifications.readAt),
          ),
        ),
    );
  }
}
