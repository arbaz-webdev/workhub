import { Body, Controller, Get, NotFoundException, Post, UseGuards } from '@nestjs/common';
import { createWorkspaceSchema, type CreateWorkspaceInput, type WorkspaceDto } from '@workhub/shared';
import { eq } from 'drizzle-orm';
import { AuthService } from '../auth/auth.service';
import { RateLimiter } from '../common/rate-limiter';
import { AuthContext, ClientIp, CurrentAuth, CurrentWorkspace, WorkspaceContext } from '../common/request';
import { ZodPipe } from '../common/zod.pipe';
import { DbService } from '../db/db.service';
import { workspaces } from '../db/schema';
import { WorkspaceGuard } from './workspace.guard';

@Controller('workspaces')
export class WorkspacesController {
  private readonly createLimiter = new RateLimiter(10, 24 * 60 * 60 * 1000);

  constructor(
    private readonly db: DbService,
    private readonly auth: AuthService,
  ) {}

  /** Creates a new workspace owned by the caller (e.g. after signing up with Google). */
  @Post()
  create(
    @Body(new ZodPipe(createWorkspaceSchema)) body: CreateWorkspaceInput,
    @CurrentAuth() auth: AuthContext,
    @ClientIp() ip: string | undefined,
  ): Promise<WorkspaceDto> {
    this.createLimiter.consume(auth.userId);
    return this.auth.createWorkspace(auth.userId, body.name, ip);
  }

  @Get('current')
  @UseGuards(WorkspaceGuard)
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
