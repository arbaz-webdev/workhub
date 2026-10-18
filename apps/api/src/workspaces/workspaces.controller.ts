import { Controller, Get, NotFoundException, UseGuards } from '@nestjs/common';
import type { WorkspaceDto } from '@workhub/shared';
import { eq } from 'drizzle-orm';
import { AuthContext, CurrentAuth, CurrentWorkspace, WorkspaceContext } from '../common/request';
import { DbService } from '../db/db.service';
import { workspaces } from '../db/schema';
import { WorkspaceGuard } from './workspace.guard';

@Controller('workspaces')
@UseGuards(WorkspaceGuard)
export class WorkspacesController {
  constructor(private readonly db: DbService) {}

  @Get('current')
  async current(
    @CurrentAuth() auth: AuthContext,
    @CurrentWorkspace() workspace: WorkspaceContext,
  ): Promise<WorkspaceDto> {
    const [row] = await this.db.withContext({ workspaceId: workspace.id, userId: auth.userId }, (tx) =>
      tx
        .select({ id: workspaces.id, name: workspaces.name, slug: workspaces.slug })
        .from(workspaces)
        .where(eq(workspaces.id, workspace.id))
        .limit(1),
    );
    if (!row) throw new NotFoundException();
    return { ...row, role: workspace.role };
  }
}
