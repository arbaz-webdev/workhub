import { BadRequestException, CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { hasRole, WORKSPACE_HEADER, type Role } from '@workhub/shared';
import { and, eq, isNotNull } from 'drizzle-orm';
import { AppRequest, MIN_ROLE } from '../common/request';
import { DbService } from '../db/db.service';
import { memberships, userTotp, workspaces } from '../db/schema';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Resolves the workspace named in the x-workspace-id header, checks the
 * signed-in user belongs to it with at least the route's @MinRole, and
 * attaches { id, role } to the request.
 */
@Injectable()
export class WorkspaceGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly db: DbService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AppRequest>();
    if (!req.auth) return false;

    // Browsers' EventSource can't set headers, so read-only GETs may pass ?workspace= instead.
    const fromQuery = req.method === 'GET' && typeof req.query.workspace === 'string' ? req.query.workspace : undefined;
    const workspaceId = req.headers[WORKSPACE_HEADER] ?? fromQuery;
    if (typeof workspaceId !== 'string' || !UUID.test(workspaceId)) {
      throw new BadRequestException(`Missing or invalid ${WORKSPACE_HEADER} header`);
    }

    const userId = req.auth.userId;
    const [membership] = await this.db.withContext({ workspaceId, userId }, (tx) =>
      tx
        .select({ role: memberships.role, requireTwoFactor: workspaces.requireTwoFactor, twoFactor: userTotp.userId })
        .from(memberships)
        .innerJoin(workspaces, eq(workspaces.id, memberships.workspaceId))
        .leftJoin(userTotp, and(eq(userTotp.userId, memberships.userId), isNotNull(userTotp.enabledAt)))
        .where(and(eq(memberships.workspaceId, workspaceId), eq(memberships.userId, userId)))
        .limit(1),
    );
    // The workspace filter is required: RLS also lets a user read their own memberships in
    // other workspaces, so filtering by user alone would accept the wrong membership.
    if (!membership) throw new ForbiddenException('You do not have access to this workspace');

    const required =
      this.reflector.getAllAndOverride<Role>(MIN_ROLE, [ctx.getHandler(), ctx.getClass()]) ?? 'member';
    if (!hasRole(membership.role, required)) {
      throw new ForbiddenException('Your role does not allow this action');
    }

    if (membership.requireTwoFactor && !membership.twoFactor) {
      throw new ForbiddenException('This workspace requires two-factor sign-in. Turn it on under Account → Security.');
    }

    req.workspace = { id: workspaceId, role: membership.role };
    return true;
  }
}
