import { BadRequestException, Body, Controller, Get, NotFoundException, Patch, Post, UseGuards } from '@nestjs/common';
import {
  createWorkspaceSchema,
  updateWorkspaceSchema,
  type CreateWorkspaceInput,
  type UpdateWorkspaceInput,
  type WorkspaceDto,
  type WorkspaceSettingsDto,
} from '@workhub/shared';
import { eq } from 'drizzle-orm';
import { audit } from '../audit/audit';
import { AuthService } from '../auth/auth.service';
import { RateLimiter } from '../common/rate-limiter';
import { AuthContext, ClientIp, CurrentAuth, CurrentWorkspace, MinRole, WorkspaceContext } from '../common/request';
import { ZodPipe } from '../common/zod.pipe';
import { DbService, Tx } from '../db/db.service';
import { workspaces } from '../db/schema';
import { WorkspaceGuard } from './workspace.guard';
import { Track } from '../analytics/track';

const TIME_ZONES = new Set([...Intl.supportedValuesOf('timeZone'), 'UTC']);

@Controller('workspaces')
export class WorkspacesController {
  private readonly createLimiter = new RateLimiter(10, 24 * 60 * 60 * 1000);

  constructor(
    private readonly db: DbService,
    private readonly auth: AuthService,
  ) {}

  /** Creates a new workspace owned by the caller (e.g. after signing up with Google). */
  @Post()
  @Track('workspace created', (w: { id: string }) => ({ workspaceId: w.id }))
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
  current(@CurrentAuth() auth: AuthContext, @CurrentWorkspace() ws: WorkspaceContext): Promise<WorkspaceSettingsDto> {
    return this.db.withContext({ workspaceId: ws.id, userId: auth.userId }, (tx) => this.settings(tx, ws));
  }

  @Patch('current')
  @UseGuards(WorkspaceGuard)
  @MinRole('admin')
  async update(
    @Body(new ZodPipe(updateWorkspaceSchema)) body: UpdateWorkspaceInput,
    @CurrentAuth() auth: AuthContext,
    @CurrentWorkspace() ws: WorkspaceContext,
    @ClientIp() ip: string | undefined,
  ): Promise<WorkspaceSettingsDto> {
    if (body.timezone && !TIME_ZONES.has(body.timezone)) {
      throw new BadRequestException({ message: 'Validation failed', errors: [{ path: 'timezone', message: 'Unknown time zone' }] });
    }
    const changes = Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined));
    if (body.workingDays) changes.workingDays = [...body.workingDays].sort((a, b) => a - b);

    return this.db.withContext({ workspaceId: ws.id, userId: auth.userId }, async (tx) => {
      if (Object.keys(changes).length > 0) {
        await tx.update(workspaces).set(changes).where(eq(workspaces.id, ws.id));
        await audit(tx, {
          workspaceId: ws.id,
          actorUserId: auth.userId,
          action: 'workspace.updated',
          entityType: 'workspace',
          entityId: ws.id,
          metadata: changes,
          ip,
        });
      }
      return this.settings(tx, ws);
    });
  }

  private async settings(tx: Tx, ws: WorkspaceContext): Promise<WorkspaceSettingsDto> {
    const [row] = await tx
      .select({
        id: workspaces.id,
        name: workspaces.name,
        slug: workspaces.slug,
        timezone: workspaces.timezone,
        currency: workspaces.currency,
        workingDays: workspaces.workingDays,
      })
      .from(workspaces)
      .where(eq(workspaces.id, ws.id))
      .limit(1);
    if (!row) throw new NotFoundException();
    return { ...row, currency: row.currency as WorkspaceSettingsDto['currency'], role: ws.role };
  }
}
