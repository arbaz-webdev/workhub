import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { hash, verify } from '@node-rs/argon2';
import type { MeResponse, SignInInput, SignUpInput, UserDto, WorkspaceDto } from '@workhub/shared';
import { and, eq, gt, sql } from 'drizzle-orm';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { audit } from '../audit/audit';
import { config } from '../config';
import { DbService } from '../db/db.service';
import { memberships, sessions, users, workspaces } from '../db/schema';

// OWASP-recommended Argon2id parameters (19 MiB memory, 2 iterations).
const ARGON2 = { memoryCost: 19456, timeCost: 2, parallelism: 1 };

export interface SessionMeta {
  ip?: string;
  userAgent?: string;
}

export interface ValidSession {
  sessionId: string;
  userId: string;
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return `${base || 'workspace'}-${randomBytes(3).toString('hex')}`;
}

function isUniqueViolation(err: unknown): boolean {
  const cause = (err as { cause?: { code?: string } })?.cause;
  return (err as { code?: string })?.code === '23505' || cause?.code === '23505';
}

@Injectable()
export class AuthService {
  private dummyHash?: Promise<string>;

  constructor(private readonly db: DbService) {}

  async signUp(input: SignUpInput, meta: SessionMeta) {
    const existing = await this.findUserByEmail(input.email);
    if (existing) throw new ConflictException('An account with this email already exists');

    const passwordHash = await hash(input.password, ARGON2);
    const userId = randomUUID();
    const workspaceId = randomUUID();
    const slug = slugify(input.workspaceName);

    try {
      await this.db.withContext({ workspaceId, userId }, async (tx) => {
        await tx.insert(users).values({ id: userId, email: input.email, name: input.name, passwordHash });
        await tx.insert(workspaces).values({ id: workspaceId, name: input.workspaceName, slug });
        await tx.insert(memberships).values({ workspaceId, userId, role: 'owner' });
        await audit(tx, {
          workspaceId,
          actorUserId: userId,
          action: 'workspace.created',
          entityType: 'workspace',
          entityId: workspaceId,
          ip: meta.ip,
        });
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw new ConflictException('An account with this email already exists');
      throw err;
    }

    const token = await this.createSession(userId, meta);
    const user: UserDto = { id: userId, name: input.name, email: input.email };
    const workspace: WorkspaceDto = { id: workspaceId, name: input.workspaceName, slug, role: 'owner' };
    return { token, user, workspace };
  }

  async signIn(input: SignInInput, meta: SessionMeta) {
    const user = await this.findUserByEmail(input.email);
    if (!user) {
      // Spend the same time as a real check so response timing doesn't reveal which emails exist.
      await verify(await this.getDummyHash(), input.password).catch(() => false);
      throw new UnauthorizedException('Incorrect email or password');
    }
    const ok = await verify(user.passwordHash, input.password).catch(() => false);
    if (!ok) throw new UnauthorizedException('Incorrect email or password');

    const token = await this.createSession(user.id, meta);
    return { token, user: { id: user.id, name: user.name, email: user.email } satisfies UserDto };
  }

  async validateSession(token: string): Promise<ValidSession | null> {
    const [row] = await this.db.db
      .select({ sessionId: sessions.id, userId: sessions.userId, lastSeenAt: sessions.lastSeenAt })
      .from(sessions)
      .where(and(eq(sessions.tokenHash, hashToken(token)), gt(sessions.expiresAt, sql`now()`)))
      .limit(1);
    if (!row) return null;

    // Refresh last_seen_at at most once an hour to keep writes cheap.
    if (Date.now() - row.lastSeenAt.getTime() > 60 * 60 * 1000) {
      await this.db.db.update(sessions).set({ lastSeenAt: new Date() }).where(eq(sessions.id, row.sessionId));
    }
    return { sessionId: row.sessionId, userId: row.userId };
  }

  async signOut(token: string): Promise<void> {
    await this.db.db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token)));
  }

  async me(userId: string): Promise<MeResponse> {
    const [user] = await this.db.db
      .select({ id: users.id, name: users.name, email: users.email })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!user) throw new UnauthorizedException();

    const rows = await this.db.withContext({ userId }, (tx) =>
      tx
        .select({ id: workspaces.id, name: workspaces.name, slug: workspaces.slug, role: memberships.role })
        .from(memberships)
        .innerJoin(workspaces, eq(workspaces.id, memberships.workspaceId))
        .where(eq(memberships.userId, userId))
        .orderBy(workspaces.createdAt),
    );
    return { user, workspaces: rows };
  }

  private async createSession(userId: string, meta: SessionMeta): Promise<string> {
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + config.sessionTtlDays * 24 * 60 * 60 * 1000);
    await this.db.db.insert(sessions).values({
      userId,
      tokenHash: hashToken(token),
      expiresAt,
      ip: meta.ip,
      userAgent: meta.userAgent?.slice(0, 500),
    });
    return token;
  }

  private async findUserByEmail(email: string) {
    const [user] = await this.db.db
      .select()
      .from(users)
      .where(sql`lower(${users.email}) = ${email.toLowerCase()}`)
      .limit(1);
    return user;
  }

  private getDummyHash(): Promise<string> {
    this.dummyHash ??= hash(randomBytes(16).toString('hex'), ARGON2);
    return this.dummyHash;
  }
}
