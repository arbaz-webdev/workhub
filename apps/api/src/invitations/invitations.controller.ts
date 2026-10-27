import {
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  acceptInviteSchema,
  inviteByEmailSchema,
  inviteLinkSchema,
  type AcceptInviteInput,
  type InvitationDto,
  type InviteByEmailInput,
  type InviteLinkInput,
  type InviteLinkResponse,
  type InvitePreviewDto,
  type Role,
  type WorkspaceDto,
} from '@workhub/shared';
import { and, desc, eq, gt, inArray, isNull, sql } from 'drizzle-orm';
import { audit } from '../audit/audit';
import { config } from '../config';
import { RateLimiter } from '../common/rate-limiter';
import { AuthContext, ClientIp, CurrentAuth, CurrentWorkspace, MinRole, Public, WorkspaceContext } from '../common/request';
import { hashToken, newToken } from '../common/tokens';
import { ZodPipe } from '../common/zod.pipe';
import { DbService, Tx } from '../db/db.service';
import { invitations, memberships, users, workspaces } from '../db/schema';
import { EmailService } from '../email/email.service';
import { inviteMessage } from '../email/templates';
import { notifyRoles } from '../notifications/notify';
import { WorkspaceGuard } from '../workspaces/workspace.guard';
import { Track } from '../analytics/track';

const INVITE_TTL = 7 * 24 * 60 * 60 * 1000;

interface TokenRow {
  id: string;
  workspace_id: string;
  workspace_name: string;
  kind: 'email' | 'link';
  email: string | null;
  role: Role;
  inviter_name: string | null;
}

function inviteUrl(token: string) {
  return `${config.appUrl}/invite/${token}`;
}

@Controller('invitations')
export class InvitationsController {
  private readonly acceptLimiter = new RateLimiter(20, 15 * 60 * 1000);
  private readonly sendLimiter = new RateLimiter(300, 24 * 60 * 60 * 1000);

  constructor(
    private readonly db: DbService,
    private readonly email: EmailService,
  ) {}

  /** Pending invitations (not accepted, revoked or expired). */
  @Get()
  @UseGuards(WorkspaceGuard)
  @MinRole('admin')
  async list(@CurrentAuth() auth: AuthContext, @CurrentWorkspace() ws: WorkspaceContext): Promise<InvitationDto[]> {
    return this.db.withContext({ workspaceId: ws.id, userId: auth.userId }, (tx) =>
      this.pending(tx, ws.id),
    );
  }

  /** Invites one or more people by email. Existing members are skipped. */
  @Post()
  @UseGuards(WorkspaceGuard)
  @MinRole('admin')
  async inviteByEmail(
    @Body(new ZodPipe(inviteByEmailSchema)) body: InviteByEmailInput,
    @CurrentAuth() auth: AuthContext,
    @CurrentWorkspace() ws: WorkspaceContext,
    @ClientIp() ip: string | undefined,
  ) {
    if (body.role === 'admin' && ws.role !== 'owner') {
      throw new ForbiddenException('Only the owner can invite admins');
    }
    const emails = [...new Set(body.emails)];
    for (let i = 0; i < emails.length; i += 1) this.sendLimiter.consume(ws.id);

    const { toSend, skipped, workspaceName, inviterName } = await this.db.withContext(
      { workspaceId: ws.id, userId: auth.userId },
      async (tx) => {
        const members = await tx
          .select({ email: users.email })
          .from(memberships)
          .innerJoin(users, eq(users.id, memberships.userId))
          .where(eq(memberships.workspaceId, ws.id));
        const memberEmails = new Set(members.map((m) => m.email.toLowerCase()));
        const skipped = emails.filter((e) => memberEmails.has(e)).map((email) => ({ email, reason: 'Already a member' }));
        const fresh = emails.filter((e) => !memberEmails.has(e));

        if (fresh.length > 0) {
          // A new invite replaces any pending one for the same address.
          await tx
            .update(invitations)
            .set({ revokedAt: new Date() })
            .where(
              and(
                eq(invitations.workspaceId, ws.id),
                eq(invitations.kind, 'email'),
                inArray(invitations.email, fresh),
                isNull(invitations.acceptedAt),
                isNull(invitations.revokedAt),
              ),
            );
        }

        const toSend: { email: string; token: string }[] = [];
        for (const email of fresh) {
          const token = newToken();
          const [inv] = await tx
            .insert(invitations)
            .values({
              workspaceId: ws.id,
              kind: 'email',
              email,
              role: body.role,
              tokenHash: hashToken(token),
              invitedBy: auth.userId,
              expiresAt: new Date(Date.now() + INVITE_TTL),
            })
            .returning({ id: invitations.id });
          await audit(tx, {
            workspaceId: ws.id,
            actorUserId: auth.userId,
            action: 'invitation.created',
            entityType: 'invitation',
            entityId: inv!.id,
            metadata: { email, role: body.role },
            ip,
          });
          toSend.push({ email, token });
        }

        const [w] = await tx.select({ name: workspaces.name }).from(workspaces).where(eq(workspaces.id, ws.id));
        const [me] = await tx.select({ name: users.name }).from(users).where(eq(users.id, auth.userId));
        return { toSend, skipped, workspaceName: w!.name, inviterName: me!.name };
      },
    );

    for (const { email, token } of toSend) {
      await this.email.send(inviteMessage(email, inviterName, workspaceName, inviteUrl(token))).catch(() => {});
    }
    const invited = await this.db.withContext({ workspaceId: ws.id, userId: auth.userId }, (tx) =>
      this.pending(tx, ws.id),
    );
    return { invited: invited.filter((i) => i.email && toSend.some((s) => s.email === i.email)), skipped };
  }

  /** Creates a shareable link anyone can use to join, until it expires or is revoked. */
  @Post('link')
  @UseGuards(WorkspaceGuard)
  @MinRole('admin')
  async createLink(
    @Body(new ZodPipe(inviteLinkSchema)) body: InviteLinkInput,
    @CurrentAuth() auth: AuthContext,
    @CurrentWorkspace() ws: WorkspaceContext,
    @ClientIp() ip: string | undefined,
  ): Promise<InviteLinkResponse> {
    const token = newToken();
    const invitation = await this.db.withContext({ workspaceId: ws.id, userId: auth.userId }, async (tx) => {
      const [inv] = await tx
        .insert(invitations)
        .values({
          workspaceId: ws.id,
          kind: 'link',
          role: body.role,
          tokenHash: hashToken(token),
          invitedBy: auth.userId,
          expiresAt: new Date(Date.now() + INVITE_TTL),
        })
        .returning({ id: invitations.id });
      await audit(tx, {
        workspaceId: ws.id,
        actorUserId: auth.userId,
        action: 'invitation.created',
        entityType: 'invitation',
        entityId: inv!.id,
        metadata: { link: true, role: body.role },
        ip,
      });
      return (await this.pending(tx, ws.id)).find((i) => i.id === inv!.id)!;
    });
    return { invitation, url: inviteUrl(token) };
  }

  @Delete(':id')
  @UseGuards(WorkspaceGuard)
  @MinRole('admin')
  @HttpCode(204)
  async revoke(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentAuth() auth: AuthContext,
    @CurrentWorkspace() ws: WorkspaceContext,
    @ClientIp() ip: string | undefined,
  ) {
    await this.db.withContext({ workspaceId: ws.id, userId: auth.userId }, async (tx) => {
      const updated = await tx
        .update(invitations)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(invitations.id, id),
            eq(invitations.workspaceId, ws.id),
            isNull(invitations.revokedAt),
            isNull(invitations.acceptedAt),
          ),
        )
        .returning({ id: invitations.id, email: invitations.email });
      if (updated.length === 0) throw new NotFoundException('Invitation not found');
      await audit(tx, {
        workspaceId: ws.id,
        actorUserId: auth.userId,
        action: 'invitation.revoked',
        entityType: 'invitation',
        entityId: id,
        metadata: { email: updated[0]!.email },
        ip,
      });
    });
  }

  /** Public: what the invite page shows before someone signs in. */
  @Public()
  @Get('preview')
  async preview(@Query('token') token: string | undefined, @ClientIp() ip: string | undefined): Promise<InvitePreviewDto> {
    this.acceptLimiter.consume(`preview:${ip ?? 'unknown'}`);
    const inv = token ? await this.byToken(token) : undefined;
    if (!inv) throw new NotFoundException('This invitation is invalid, already used, or has expired.');
    return { workspaceName: inv.workspace_name, inviterName: inv.inviter_name, role: inv.role, email: inv.email };
  }

  /** Joins the workspace an invitation is for. Email invitations only work for that address. */
  @Post('accept')
  @Track('member joined', (w: { id: string }) => ({ workspaceId: w.id }))
  async accept(
    @Body(new ZodPipe(acceptInviteSchema)) body: AcceptInviteInput,
    @CurrentAuth() auth: AuthContext,
    @ClientIp() ip: string | undefined,
  ): Promise<WorkspaceDto> {
    this.acceptLimiter.consume(`accept:${auth.userId}`);
    const inv = await this.byToken(body.token);
    if (!inv) throw new NotFoundException('This invitation is invalid, already used, or has expired.');

    const [user] = await this.db.db
      .select({ name: users.name, email: users.email })
      .from(users)
      .where(eq(users.id, auth.userId));
    if (!user) throw new NotFoundException();
    if (inv.kind === 'email' && inv.email?.toLowerCase() !== user.email.toLowerCase()) {
      throw new ForbiddenException(
        `This invitation was sent to ${inv.email}. Sign in with that email address to accept it.`,
      );
    }

    return this.db.withContext({ workspaceId: inv.workspace_id, userId: auth.userId }, async (tx) => {
      const [existing] = await tx
        .select({ role: memberships.role })
        .from(memberships)
        .where(and(eq(memberships.workspaceId, inv.workspace_id), eq(memberships.userId, auth.userId)));

      if (inv.kind === 'email') {
        const marked = await tx
          .update(invitations)
          .set({ acceptedAt: new Date(), acceptedBy: auth.userId })
          .where(and(eq(invitations.id, inv.id), isNull(invitations.acceptedAt)))
          .returning({ id: invitations.id });
        if (marked.length === 0) throw new ConflictException('This invitation has already been used.');
      }

      const [w] = await tx
        .select({ id: workspaces.id, name: workspaces.name, slug: workspaces.slug })
        .from(workspaces)
        .where(eq(workspaces.id, inv.workspace_id));

      if (existing) return { ...w!, role: existing.role };

      await tx.insert(memberships).values({ workspaceId: inv.workspace_id, userId: auth.userId, role: inv.role });
      await audit(tx, {
        workspaceId: inv.workspace_id,
        actorUserId: auth.userId,
        action: 'member.joined',
        entityType: 'user',
        entityId: auth.userId,
        metadata: { role: inv.role, via: inv.kind },
        ip,
      });
      await notifyRoles(
        tx,
        inv.workspace_id,
        ['owner', 'admin'],
        { type: 'member.joined', title: `${user.name} joined ${w!.name}`, body: `Role: ${inv.role}`, link: '/app/people' },
        auth.userId,
      );
      return { ...w!, role: inv.role };
    });
  }

  private async byToken(token: string): Promise<TokenRow | undefined> {
    if (token.length < 20 || token.length > 200) return undefined;
    const result = await this.db.db.execute(sql`select * from invitation_by_token(${hashToken(token)})`);
    return result.rows[0] as TokenRow | undefined;
  }

  private async pending(tx: Tx, workspaceId: string): Promise<InvitationDto[]> {
    const rows = await tx
      .select({
        id: invitations.id,
        kind: invitations.kind,
        email: invitations.email,
        role: invitations.role,
        invitedByName: users.name,
        expiresAt: invitations.expiresAt,
        createdAt: invitations.createdAt,
      })
      .from(invitations)
      .leftJoin(users, eq(users.id, invitations.invitedBy))
      .where(
        and(
          eq(invitations.workspaceId, workspaceId),
          isNull(invitations.acceptedAt),
          isNull(invitations.revokedAt),
          gt(invitations.expiresAt, sql`now()`),
        ),
      )
      .orderBy(desc(invitations.createdAt));
    return rows.map((r) => ({
      ...r,
      invitedByName: r.invitedByName ?? null,
      expiresAt: r.expiresAt.toISOString(),
      createdAt: r.createdAt.toISOString(),
    }));
  }
}
