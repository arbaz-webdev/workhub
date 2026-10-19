import {
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
  UseGuards,
} from '@nestjs/common';
import { updateMemberRoleSchema, type MemberDto, type Role, type UpdateMemberRoleInput } from '@workhub/shared';
import { and, asc, eq } from 'drizzle-orm';
import { audit } from '../audit/audit';
import { AuthContext, ClientIp, CurrentAuth, CurrentWorkspace, MinRole, WorkspaceContext } from '../common/request';
import { ZodPipe } from '../common/zod.pipe';
import { DbService, Tx } from '../db/db.service';
import { memberships, users, workspaces } from '../db/schema';
import { notify } from '../notifications/notify';
import { WorkspaceGuard } from '../workspaces/workspace.guard';

/**
 * Rules for changing someone else's access:
 * - nobody changes or removes the owner, and nobody changes their own role here;
 * - only the owner can make someone an admin, or change/remove an existing admin.
 */
function assertCanManage(actor: WorkspaceContext, actorId: string, targetId: string, targetRole: Role, newRole?: Role) {
  if (targetId === actorId) throw new ForbiddenException("You can't change your own access");
  if (targetRole === 'owner') throw new ForbiddenException("The owner's access can't be changed");
  if ((targetRole === 'admin' || newRole === 'admin') && actor.role !== 'owner') {
    throw new ForbiddenException('Only the owner can manage admins');
  }
}

@Controller('members')
@UseGuards(WorkspaceGuard)
export class MembersController {
  constructor(private readonly db: DbService) {}

  @Get()
  async list(@CurrentAuth() auth: AuthContext, @CurrentWorkspace() ws: WorkspaceContext): Promise<MemberDto[]> {
    const rows = await this.db.withContext({ workspaceId: ws.id, userId: auth.userId }, (tx) =>
      tx
        .select({
          userId: memberships.userId,
          name: users.name,
          email: users.email,
          role: memberships.role,
          joinedAt: memberships.createdAt,
        })
        .from(memberships)
        .innerJoin(users, eq(users.id, memberships.userId))
        .where(eq(memberships.workspaceId, ws.id))
        .orderBy(asc(memberships.createdAt)),
    );
    return rows.map((r) => ({ ...r, joinedAt: r.joinedAt.toISOString() }));
  }

  @Patch(':userId')
  @MinRole('admin')
  async changeRole(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body(new ZodPipe(updateMemberRoleSchema)) body: UpdateMemberRoleInput,
    @CurrentAuth() auth: AuthContext,
    @CurrentWorkspace() ws: WorkspaceContext,
    @ClientIp() ip: string | undefined,
  ): Promise<{ role: Role }> {
    return this.db.withContext({ workspaceId: ws.id, userId: auth.userId }, async (tx) => {
      const target = await this.findMember(tx, ws.id, userId);
      assertCanManage(ws, auth.userId, userId, target.role, body.role);
      if (target.role === body.role) return { role: body.role };

      await tx
        .update(memberships)
        .set({ role: body.role })
        .where(and(eq(memberships.workspaceId, ws.id), eq(memberships.userId, userId)));
      await audit(tx, {
        workspaceId: ws.id,
        actorUserId: auth.userId,
        action: 'member.role_changed',
        entityType: 'user',
        entityId: userId,
        metadata: { from: target.role, to: body.role },
        ip,
      });
      const [w] = await tx.select({ name: workspaces.name }).from(workspaces).where(eq(workspaces.id, ws.id));
      await notify(tx, ws.id, [userId], {
        type: 'member.role_changed',
        title: `Your role in ${w!.name} is now ${body.role}`,
      });
      return { role: body.role };
    });
  }

  @Delete(':userId')
  @MinRole('admin')
  @HttpCode(204)
  async remove(
    @Param('userId', ParseUUIDPipe) userId: string,
    @CurrentAuth() auth: AuthContext,
    @CurrentWorkspace() ws: WorkspaceContext,
    @ClientIp() ip: string | undefined,
  ) {
    await this.db.withContext({ workspaceId: ws.id, userId: auth.userId }, async (tx) => {
      const target = await this.findMember(tx, ws.id, userId);
      assertCanManage(ws, auth.userId, userId, target.role);
      await tx.delete(memberships).where(and(eq(memberships.workspaceId, ws.id), eq(memberships.userId, userId)));
      await audit(tx, {
        workspaceId: ws.id,
        actorUserId: auth.userId,
        action: 'member.removed',
        entityType: 'user',
        entityId: userId,
        metadata: { name: target.name, email: target.email, role: target.role },
        ip,
      });
    });
  }

  private async findMember(tx: Tx, workspaceId: string, userId: string) {
    const [row] = await tx
      .select({ role: memberships.role, name: users.name, email: users.email })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(and(eq(memberships.workspaceId, workspaceId), eq(memberships.userId, userId)));
    if (!row) throw new NotFoundException('Member not found');
    return row;
  }
}
