import { Body, Controller, Delete, Get, HttpCode, NotFoundException, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { API_KEY_PREFIX, createApiKeySchema, hasRole, type ApiKeyCreatedDto, type ApiKeyDto, type CreateApiKeyInput } from '@workhub/shared';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { audit } from '../audit/audit';
import { requireFeature } from '../billing/plans';
import { AuthContext, ClientIp, CurrentAuth, CurrentWorkspace, MinRole, WorkspaceContext } from '../common/request';
import { hashToken, newToken } from '../common/tokens';
import { ZodPipe } from '../common/zod.pipe';
import { DbService, Tx } from '../db/db.service';
import { apiKeys, memberships, users } from '../db/schema';
import { WorkspaceGuard } from '../workspaces/workspace.guard';

/** Characters of a key kept in the clear, to tell keys apart: "whk_" plus eight. */
const PREFIX_LENGTH = API_KEY_PREFIX.length + 8;

/** Settings → API: admins create, list and revoke the workspace's API keys. */
@Controller('api-keys')
@UseGuards(WorkspaceGuard)
@MinRole('admin')
export class ApiKeysController {
  constructor(private readonly db: DbService) {}

  @Get()
  list(@CurrentAuth() auth: AuthContext, @CurrentWorkspace() ws: WorkspaceContext): Promise<ApiKeyDto[]> {
    return this.db.withContext({ workspaceId: ws.id, userId: auth.userId }, (tx) => keyDtos(tx, ws.id));
  }

  @Post()
  create(
    @Body(new ZodPipe(createApiKeySchema)) body: CreateApiKeyInput,
    @CurrentAuth() auth: AuthContext,
    @CurrentWorkspace() ws: WorkspaceContext,
    @ClientIp() ip: string | undefined,
  ): Promise<ApiKeyCreatedDto> {
    return this.db.withContext({ workspaceId: ws.id, userId: auth.userId }, async (tx) => {
      await requireFeature(tx, ws.id, 'api');
      const key = `${API_KEY_PREFIX}${newToken()}`;
      const [row] = await tx
        .insert(apiKeys)
        .values({ workspaceId: ws.id, createdBy: auth.userId, name: body.name, prefix: key.slice(0, PREFIX_LENGTH), tokenHash: hashToken(key), access: body.access })
        .returning({ id: apiKeys.id });
      await audit(tx, {
        workspaceId: ws.id,
        actorUserId: auth.userId,
        action: 'api_key.created',
        entityType: 'api_key',
        entityId: row!.id,
        metadata: { name: body.name, access: body.access },
        ip,
      });
      const dto = (await keyDtos(tx, ws.id)).find((k) => k.id === row!.id)!;
      return { ...dto, key };
    });
  }

  @Delete(':id')
  @HttpCode(204)
  async revoke(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentAuth() auth: AuthContext,
    @CurrentWorkspace() ws: WorkspaceContext,
    @ClientIp() ip: string | undefined,
  ): Promise<void> {
    await this.db.withContext({ workspaceId: ws.id, userId: auth.userId }, async (tx) => {
      const [row] = await tx
        .update(apiKeys)
        .set({ revokedAt: new Date() })
        .where(and(eq(apiKeys.id, id), eq(apiKeys.workspaceId, ws.id), isNull(apiKeys.revokedAt)))
        .returning({ name: apiKeys.name });
      if (!row) throw new NotFoundException('API key not found');
      await audit(tx, { workspaceId: ws.id, actorUserId: auth.userId, action: 'api_key.revoked', entityType: 'api_key', entityId: id, metadata: { name: row.name }, ip });
    });
  }
}

async function keyDtos(tx: Tx, workspaceId: string): Promise<ApiKeyDto[]> {
  const rows = await tx
    .select({
      id: apiKeys.id,
      name: apiKeys.name,
      prefix: apiKeys.prefix,
      access: apiKeys.access,
      createdAt: apiKeys.createdAt,
      lastUsedAt: apiKeys.lastUsedAt,
      creatorId: users.id,
      creatorName: users.name,
      creatorRole: memberships.role,
    })
    .from(apiKeys)
    .leftJoin(users, eq(users.id, apiKeys.createdBy))
    .leftJoin(memberships, and(eq(memberships.workspaceId, apiKeys.workspaceId), eq(memberships.userId, apiKeys.createdBy)))
    .where(and(eq(apiKeys.workspaceId, workspaceId), isNull(apiKeys.revokedAt)))
    .orderBy(desc(apiKeys.createdAt));
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    prefix: r.prefix,
    access: r.access,
    createdBy: r.creatorId && r.creatorName ? { id: r.creatorId, name: r.creatorName } : null,
    createdAt: r.createdAt.toISOString(),
    lastUsedAt: r.lastUsedAt?.toISOString() ?? null,
    active: !!r.creatorRole && hasRole(r.creatorRole, 'admin'),
  }));
}
