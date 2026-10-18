import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { createTeamSchema, type CreateTeamInput, type TeamDto } from '@workhub/shared';
import { and, eq, isNull } from 'drizzle-orm';
import { audit } from '../audit/audit';
import { AuthContext, ClientIp, CurrentAuth, CurrentWorkspace, MinRole, WorkspaceContext } from '../common/request';
import { ZodPipe } from '../common/zod.pipe';
import { DbService } from '../db/db.service';
import { teams } from '../db/schema';
import { WorkspaceGuard } from '../workspaces/workspace.guard';

function toDto(row: { id: string; name: string; createdAt: Date }): TeamDto {
  return { id: row.id, name: row.name, createdAt: row.createdAt.toISOString() };
}

@Controller('teams')
@UseGuards(WorkspaceGuard)
export class TeamsController {
  constructor(private readonly db: DbService) {}

  @Get()
  async list(@CurrentAuth() auth: AuthContext, @CurrentWorkspace() workspace: WorkspaceContext): Promise<TeamDto[]> {
    const rows = await this.db.withContext({ workspaceId: workspace.id, userId: auth.userId }, (tx) =>
      tx
        .select({ id: teams.id, name: teams.name, createdAt: teams.createdAt })
        .from(teams)
        // RLS already enforces the workspace; the explicit filter is defence in depth.
        .where(and(eq(teams.workspaceId, workspace.id), isNull(teams.deletedAt)))
        .orderBy(teams.createdAt),
    );
    return rows.map(toDto);
  }

  @Post()
  @MinRole('manager')
  async create(
    @Body(new ZodPipe(createTeamSchema)) body: CreateTeamInput,
    @CurrentAuth() auth: AuthContext,
    @CurrentWorkspace() workspace: WorkspaceContext,
    @ClientIp() ip: string | undefined,
  ): Promise<TeamDto> {
    const row = await this.db.withContext({ workspaceId: workspace.id, userId: auth.userId }, async (tx) => {
      const [team] = await tx
        .insert(teams)
        .values({ workspaceId: workspace.id, name: body.name, createdBy: auth.userId })
        .returning({ id: teams.id, name: teams.name, createdAt: teams.createdAt });
      await audit(tx, {
        workspaceId: workspace.id,
        actorUserId: auth.userId,
        action: 'team.created',
        entityType: 'team',
        entityId: team!.id,
        metadata: { name: body.name },
        ip,
      });
      return team!;
    });
    return toDto(row);
  }
}
