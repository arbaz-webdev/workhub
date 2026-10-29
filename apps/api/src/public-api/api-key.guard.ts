import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { API_KEY_PREFIX, hasRole, type ApiKeyAccess } from '@workhub/shared';
import { and, eq, isNull, lt, or, sql } from 'drizzle-orm';
import { requireFeature } from '../billing/plans';
import { RateLimiter } from '../common/rate-limiter';
import type { AppRequest } from '../common/request';
import { hashToken } from '../common/tokens';
import { config } from '../config';
import { DbService } from '../db/db.service';
import { apiKeys, memberships } from '../db/schema';

const MINUTE = 60_000;
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

interface KeyRow {
  id: string;
  workspace_id: string;
  created_by: string;
  access: ApiKeyAccess;
}

/**
 * The public API's door: `Authorization: Bearer whk_…`. A key acts as the admin who made it,
 * with their current role, inside its own workspace only. Routes using this guard must also
 * be @Public(), so the session guard lets them through to here.
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  private readonly limiter = new RateLimiter('api.key', config.apiRateLimit, MINUTE);

  constructor(private readonly db: DbService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AppRequest>();
    const header = req.headers.authorization;
    const token = typeof header === 'string' && header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    if (!token.startsWith(API_KEY_PREFIX)) {
      throw new UnauthorizedException(`Send your API key in the Authorization header: "Bearer ${API_KEY_PREFIX}…"`);
    }

    const result = await this.db.db.execute(sql`select * from api_key_by_hash(${hashToken(token)})`);
    const key = result.rows[0] as KeyRow | undefined;
    if (!key) throw new UnauthorizedException('This API key is not valid. It may have been revoked.');

    await this.limiter.consume(key.id);
    if (key.access === 'read' && !SAFE_METHODS.has(req.method)) {
      throw new ForbiddenException('This API key is read-only. Create a read and write key to change data.');
    }

    const role = await this.db.withContext({ workspaceId: key.workspace_id, userId: key.created_by }, async (tx) => {
      const [member] = await tx
        .select({ role: memberships.role })
        .from(memberships)
        .where(and(eq(memberships.workspaceId, key.workspace_id), eq(memberships.userId, key.created_by)))
        .limit(1);
      if (!member || !hasRole(member.role, 'admin')) return null;
      await requireFeature(tx, key.workspace_id, 'api');
      // At most one write a minute per key, however busy it is.
      await tx
        .update(apiKeys)
        .set({ lastUsedAt: new Date() })
        .where(and(eq(apiKeys.id, key.id), or(isNull(apiKeys.lastUsedAt), lt(apiKeys.lastUsedAt, new Date(Date.now() - MINUTE)))));
      return member.role;
    });
    if (!role) {
      throw new ForbiddenException('This API key stopped working because the person who created it is no longer an admin. Create a new key.');
    }

    req.auth = { userId: key.created_by, sessionId: `api-key:${key.id}` };
    req.workspace = { id: key.workspace_id, role };
    req.apiKey = { id: key.id, access: key.access };
    return true;
  }
}
