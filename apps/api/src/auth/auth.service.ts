import { BadRequestException, ConflictException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import QRCode from 'qrcode';
import { hash, verify } from '@node-rs/argon2';
import { TRIAL_DAYS, type MeResponse, type SignInInput, type SignUpInput, type UserDto, type WorkspaceDto } from '@workhub/shared';
import { and, count, eq, gt, isNotNull, isNull, sql } from 'drizzle-orm';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { audit } from '../audit/audit';
import { foundingTerms } from '../billing/plans';
import { config } from '../config';
import { DbService, Tx } from '../db/db.service';
import { authTokens, memberships, oauthAccounts, recoveryCodes, sessions, subscriptions, users, userTotp, workspaces } from '../db/schema';
import { EmailService } from '../email/email.service';
import { resetPasswordMessage, twoFactorChangedMessage, verifyEmailMessage } from '../email/templates';
import { decryptSecret, encryptSecret, hashRecoveryCode, newRecoveryCodes, newSecret, otpauthUrl, verifyCode } from './totp';

// OWASP-recommended Argon2id parameters (19 MiB memory, 2 iterations).
const ARGON2 = { memoryCost: 19456, timeCost: 2, parallelism: 1 };
const HOUR = 60 * 60 * 1000;
const VERIFY_TTL = 24 * HOUR;
const RESET_TTL = 30 * 60 * 1000;
/** Time to type the code after the password. */
const TWO_FACTOR_TTL = 10 * 60 * 1000;

type TokenPurpose = 'email_verification' | 'password_reset' | 'two_factor';

export interface SessionMeta {
  ip?: string;
  userAgent?: string;
}

export interface ValidSession {
  sessionId: string;
  userId: string;
}

/** Signing in ends in a session, or a two-factor ticket when the person uses a second factor. */
export type SignInStep = { token: string; challenge?: undefined } | { challenge: string; token?: undefined };

export interface GoogleProfile {
  sub: string;
  email: string;
  name: string;
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
  private readonly logger = new Logger('Auth');
  private dummyHash?: Promise<string>;

  constructor(
    private readonly db: DbService,
    private readonly email: EmailService,
  ) {}

  async signUp(input: SignUpInput, meta: SessionMeta) {
    const existing = await this.findUserByEmail(input.email);
    if (existing) throw new ConflictException('An account with this email already exists');

    const passwordHash = await hash(input.password, ARGON2);
    const userId = randomUUID();
    const workspaceId = randomUUID();
    const workspaceName = input.workspaceName;
    let workspace: WorkspaceDto | null;

    try {
      workspace = await this.db.withContext({ workspaceId, userId }, async (tx) => {
        await tx.insert(users).values({ id: userId, email: input.email, name: input.name, passwordHash });
        // People joining by invitation sign up without creating a workspace of their own.
        if (!workspaceName) return null;
        return this.insertWorkspace(tx, { workspaceId, userId, name: workspaceName, ip: meta.ip });
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw new ConflictException('An account with this email already exists');
      throw err;
    }

    await this.sendVerificationEmail(userId, input.email, input.name);
    const token = await this.createSession(userId, meta);
    const user: UserDto = { id: userId, name: input.name, email: input.email, emailVerified: false };
    return { token, user, workspace };
  }

  async signIn(input: SignInInput, meta: SessionMeta) {
    const user = await this.findUserByEmail(input.email);
    if (!user?.passwordHash) {
      // Spend the same time as a real check so response timing doesn't reveal which emails exist.
      await verify(await this.getDummyHash(), input.password).catch(() => false);
      throw new UnauthorizedException('Incorrect email or password');
    }
    const ok = await verify(user.passwordHash, input.password).catch(() => false);
    if (!ok) throw new UnauthorizedException('Incorrect email or password');

    return { ...(await this.completeSignIn(user.id, meta)), user: this.toDto(user) };
  }

  /** A session, unless the person uses two-factor sign-in: then a ticket to exchange with a code. */
  async completeSignIn(userId: string, meta: SessionMeta): Promise<SignInStep> {
    if (await this.hasTwoFactor(userId)) return { challenge: await this.issueToken(userId, 'two_factor', TWO_FACTOR_TTL) };
    return { token: await this.createSession(userId, meta) };
  }

  /** Creates a workspace with `userId` as its owner. */
  async createWorkspace(userId: string, name: string, ip?: string): Promise<WorkspaceDto> {
    const workspaceId = randomUUID();
    return this.db.withContext({ workspaceId, userId }, (tx) =>
      this.insertWorkspace(tx, { workspaceId, userId, name, ip }),
    );
  }

  /** Must run inside a transaction whose context is set to this workspace and user. */
  private async insertWorkspace(
    tx: Tx,
    w: { workspaceId: string; userId: string; name: string; ip?: string },
  ): Promise<WorkspaceDto> {
    const slug = slugify(w.name);
    await tx.insert(workspaces).values({ id: w.workspaceId, name: w.name, slug });
    await tx.insert(memberships).values({ workspaceId: w.workspaceId, userId: w.userId, role: 'owner' });
    // Every new workspace starts with a trial of everything.
    await tx.insert(subscriptions).values({ workspaceId: w.workspaceId, trialEndsAt: new Date(Date.now() + TRIAL_DAYS * 86_400_000), ...foundingTerms(new Date()) });
    await audit(tx, {
      workspaceId: w.workspaceId,
      actorUserId: w.userId,
      action: 'workspace.created',
      entityType: 'workspace',
      entityId: w.workspaceId,
      ip: w.ip,
    });
    return { id: w.workspaceId, name: w.name, slug, role: 'owner' };
  }

  // ---- Email verification -------------------------------------------------

  async verifyEmail(rawToken: string): Promise<void> {
    const userId = await this.consumeToken(rawToken, 'email_verification');
    if (!userId) throw new BadRequestException('This link is invalid or has expired. Request a new one.');
    await this.db.db
      .update(users)
      .set({ emailVerifiedAt: sql`coalesce(${users.emailVerifiedAt}, now())` })
      .where(eq(users.id, userId));
  }

  async resendVerification(userId: string): Promise<void> {
    const [user] = await this.db.db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user || user.emailVerifiedAt) return;
    await this.sendVerificationEmail(user.id, user.email, user.name);
  }

  // ---- Password reset -----------------------------------------------------

  /** Always succeeds from the caller's point of view, so it can't be used to discover accounts. */
  async forgotPassword(email: string): Promise<void> {
    const user = await this.findUserByEmail(email);
    if (!user) return;
    const token = await this.issueToken(user.id, 'password_reset', RESET_TTL);
    const url = `${config.appUrl}/reset-password?token=${token}`;
    await this.safeSend(resetPasswordMessage(user.email, user.name, url));
  }

  async resetPassword(rawToken: string, newPassword: string): Promise<void> {
    const userId = await this.consumeToken(rawToken, 'password_reset');
    if (!userId) throw new BadRequestException('This link is invalid or has expired. Request a new one.');
    const passwordHash = await hash(newPassword, ARGON2);
    await this.db.db.transaction(async (tx) => {
      // The reset link proved they own the inbox, so the email counts as verified.
      await tx
        .update(users)
        .set({ passwordHash, emailVerifiedAt: sql`coalesce(${users.emailVerifiedAt}, now())` })
        .where(eq(users.id, userId));
      await tx.delete(sessions).where(eq(sessions.userId, userId));
    });
  }

  // ---- Google sign-in -----------------------------------------------------

  /**
   * Signs in (or up) with a Google account whose email Google has verified.
   * An existing account with the same email is linked. If that account never
   * verified its email, someone else may have registered it first, so its
   * password and sessions are removed before linking (pre-hijacking defence).
   */
  async signInWithGoogle(profile: GoogleProfile, meta: SessionMeta): Promise<SignInStep & { isNew: boolean }> {
    const [linked] = await this.db.db
      .select({ userId: oauthAccounts.userId })
      .from(oauthAccounts)
      .where(and(eq(oauthAccounts.provider, 'google'), eq(oauthAccounts.providerUserId, profile.sub)))
      .limit(1);
    if (linked) return { ...(await this.completeSignIn(linked.userId, meta)), isNew: false };

    const existing = await this.findUserByEmail(profile.email);
    if (existing) {
      await this.db.db.transaction(async (tx) => {
        if (!existing.emailVerifiedAt) {
          await tx.update(users).set({ passwordHash: null, emailVerifiedAt: new Date() }).where(eq(users.id, existing.id));
          await tx.delete(sessions).where(eq(sessions.userId, existing.id));
        }
        await this.linkGoogle(tx, existing.id, profile.sub);
      });
      return { ...(await this.completeSignIn(existing.id, meta)), isNew: false };
    }

    const userId = randomUUID();
    await this.db.db.transaction(async (tx) => {
      await tx.insert(users).values({
        id: userId,
        email: profile.email,
        name: profile.name,
        passwordHash: null,
        emailVerifiedAt: new Date(),
      });
      await this.linkGoogle(tx, userId, profile.sub);
    });
    return { token: await this.createSession(userId, meta), isNew: true };
  }

  // ---- Sessions -----------------------------------------------------------

  async validateSession(token: string): Promise<ValidSession | null> {
    const [row] = await this.db.db
      .select({ sessionId: sessions.id, userId: sessions.userId, lastSeenAt: sessions.lastSeenAt })
      .from(sessions)
      .where(and(eq(sessions.tokenHash, hashToken(token)), gt(sessions.expiresAt, sql`now()`)))
      .limit(1);
    if (!row) return null;

    // Refresh last_seen_at at most once an hour to keep writes cheap.
    if (Date.now() - row.lastSeenAt.getTime() > HOUR) {
      await this.db.db.update(sessions).set({ lastSeenAt: new Date() }).where(eq(sessions.id, row.sessionId));
    }
    return { sessionId: row.sessionId, userId: row.userId };
  }

  async signOut(token: string): Promise<void> {
    await this.db.db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token)));
  }

  async me(userId: string): Promise<MeResponse> {
    const [user] = await this.db.db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user) throw new UnauthorizedException();

    const rows = await this.db.withContext({ userId }, (tx) =>
      tx
        .select({ id: workspaces.id, name: workspaces.name, slug: workspaces.slug, role: memberships.role, requireTwoFactor: workspaces.requireTwoFactor, clientCompanyId: memberships.clientCompanyId })
        .from(memberships)
        .innerJoin(workspaces, eq(workspaces.id, memberships.workspaceId))
        .where(eq(memberships.userId, userId))
        .orderBy(workspaces.createdAt),
    );
    return { user: { ...this.toDto(user), twoFactorEnabled: await this.hasTwoFactor(userId) }, workspaces: rows };
  }

  // ---- Two-factor sign-in ---------------------------------------------------

  async hasTwoFactor(userId: string): Promise<boolean> {
    const [row] = await this.db.db
      .select({ userId: userTotp.userId })
      .from(userTotp)
      .where(and(eq(userTotp.userId, userId), isNotNull(userTotp.enabledAt)));
    return !!row;
  }

  /** Swaps a sign-in ticket and a code (or a recovery code) for a session. */
  async verifyTwoFactor(challenge: string, code: string, meta: SessionMeta): Promise<{ token: string; user: UserDto }> {
    const userId = await this.peekToken(challenge, 'two_factor');
    if (!userId) throw new UnauthorizedException('This sign-in has expired. Enter your email and password again.');
    if (!(await this.checkSecondFactor(userId, code))) throw new UnauthorizedException('That code isn’t right. Check the time on your phone, or use a recovery code.');
    // Used once: a second attempt with the same ticket fails.
    if (!(await this.consumeToken(challenge, 'two_factor'))) throw new UnauthorizedException('This sign-in has expired. Enter your email and password again.');
    const [user] = await this.db.db.select().from(users).where(eq(users.id, userId));
    return { token: await this.createSession(userId, meta), user: this.toDto(user!) };
  }

  async twoFactorStatus(userId: string): Promise<{ enabled: boolean; recoveryCodesLeft: number }> {
    const [{ n }] = (await this.db.db
      .select({ n: count() })
      .from(recoveryCodes)
      .where(and(eq(recoveryCodes.userId, userId), isNull(recoveryCodes.usedAt)))) as [{ n: number }];
    return { enabled: await this.hasTwoFactor(userId), recoveryCodesLeft: n };
  }

  /** A new secret to scan; it takes effect once confirmed with a code. */
  async startTwoFactorSetup(userId: string): Promise<{ secret: string; otpauthUrl: string; qr: string }> {
    if (await this.hasTwoFactor(userId)) throw new ConflictException('Two-factor sign-in is already on.');
    const [user] = await this.db.db.select({ email: users.email }).from(users).where(eq(users.id, userId));
    const secret = newSecret();
    await this.db.db
      .insert(userTotp)
      .values({ userId, secretEnc: encryptSecret(secret) })
      .onConflictDoUpdate({ target: userTotp.userId, set: { secretEnc: encryptSecret(secret), lastStep: null, createdAt: new Date() } });
    const url = otpauthUrl(secret, user!.email);
    return { secret, otpauthUrl: url, qr: await QRCode.toDataURL(url, { margin: 1, width: 220 }) };
  }

  /** Confirms the setup with a code; returns recovery codes (shown once) and signs out other devices. */
  async enableTwoFactor(userId: string, code: string, keepSessionId: string): Promise<string[]> {
    const [row] = await this.db.db.select().from(userTotp).where(eq(userTotp.userId, userId));
    if (!row) throw new BadRequestException('Start the setup first.');
    if (row.enabledAt) throw new ConflictException('Two-factor sign-in is already on.');
    const step = verifyCode(decryptSecret(row.secretEnc), code, row.lastStep);
    if (step === null) throw new BadRequestException('That code isn’t right. Check the time on your phone and try the newest code.');
    const codes = newRecoveryCodes();
    await this.db.db.transaction(async (tx) => {
      await tx.update(userTotp).set({ enabledAt: new Date(), lastStep: step }).where(eq(userTotp.userId, userId));
      await tx.delete(recoveryCodes).where(eq(recoveryCodes.userId, userId));
      await tx.insert(recoveryCodes).values(codes.map((c) => ({ userId, codeHash: hashRecoveryCode(c) })));
      await tx.delete(sessions).where(and(eq(sessions.userId, userId), sql`${sessions.id} <> ${keepSessionId}`));
    });
    await this.notifySecurityChange(userId, true);
    return codes;
  }

  async disableTwoFactor(userId: string, code: string): Promise<void> {
    if (!(await this.hasTwoFactor(userId))) return;
    if (!(await this.checkSecondFactor(userId, code))) throw new BadRequestException('That code isn’t right.');
    await this.db.db.transaction(async (tx) => {
      await tx.delete(userTotp).where(eq(userTotp.userId, userId));
      await tx.delete(recoveryCodes).where(eq(recoveryCodes.userId, userId));
    });
    await this.notifySecurityChange(userId, false);
  }

  private async notifySecurityChange(userId: string, on: boolean) {
    const [user] = await this.db.db.select({ email: users.email, name: users.name }).from(users).where(eq(users.id, userId));
    if (user) await this.safeSend(twoFactorChangedMessage(user.email, user.name, on, `${config.appUrl}/app/account`));
  }

  async regenerateRecoveryCodes(userId: string, code: string): Promise<string[]> {
    if (!(await this.hasTwoFactor(userId))) throw new BadRequestException('Two-factor sign-in is off.');
    if (!(await this.checkSecondFactor(userId, code))) throw new BadRequestException('That code isn’t right.');
    const codes = newRecoveryCodes();
    await this.db.db.transaction(async (tx) => {
      await tx.delete(recoveryCodes).where(eq(recoveryCodes.userId, userId));
      await tx.insert(recoveryCodes).values(codes.map((c) => ({ userId, codeHash: hashRecoveryCode(c) })));
    });
    return codes;
  }

  /** An authenticator code (each works once) or an unused recovery code (used up). */
  private async checkSecondFactor(userId: string, code: string): Promise<boolean> {
    const [row] = await this.db.db
      .select()
      .from(userTotp)
      .where(and(eq(userTotp.userId, userId), isNotNull(userTotp.enabledAt)));
    if (!row) return false;
    const step = verifyCode(decryptSecret(row.secretEnc), code, row.lastStep);
    if (step !== null) {
      // Atomic, so the same code can't win twice in a race.
      const claimed = await this.db.db
        .update(userTotp)
        .set({ lastStep: step })
        .where(and(eq(userTotp.userId, userId), sql`(${userTotp.lastStep} is null or ${userTotp.lastStep} < ${step})`))
        .returning({ userId: userTotp.userId });
      return claimed.length > 0;
    }
    if (code.replace(/[^a-z0-9]/gi, '').length !== 10) return false;
    const used = await this.db.db
      .update(recoveryCodes)
      .set({ usedAt: new Date() })
      .where(and(eq(recoveryCodes.userId, userId), eq(recoveryCodes.codeHash, hashRecoveryCode(code)), isNull(recoveryCodes.usedAt)))
      .returning({ id: recoveryCodes.id });
    return used.length > 0;
  }

  // ---- Internals ----------------------------------------------------------

  private toDto(user: typeof users.$inferSelect): UserDto {
    return { id: user.id, name: user.name, email: user.email, emailVerified: !!user.emailVerifiedAt };
  }

  private async linkGoogle(tx: Tx, userId: string, sub: string) {
    await tx.insert(oauthAccounts).values({ userId, provider: 'google', providerUserId: sub });
  }

  private async sendVerificationEmail(userId: string, email: string, name: string) {
    const token = await this.issueToken(userId, 'email_verification', VERIFY_TTL);
    await this.safeSend(verifyEmailMessage(email, name, `${config.appUrl}/verify-email?token=${token}`));
  }

  /** Email problems must not break sign-up or leak whether an account exists. */
  private async safeSend(message: Parameters<EmailService['send']>[0]) {
    try {
      await this.email.send(message);
    } catch (err) {
      this.logger.error(`Could not send "${message.subject}": ${(err as Error).message}`);
    }
  }

  /** Issues a single-use token; any older unused token for the same purpose stops working. */
  private async issueToken(userId: string, purpose: TokenPurpose, ttlMs: number): Promise<string> {
    const token = randomBytes(32).toString('base64url');
    await this.db.db.transaction(async (tx) => {
      await tx
        .update(authTokens)
        .set({ usedAt: new Date() })
        .where(and(eq(authTokens.userId, userId), eq(authTokens.purpose, purpose), isNull(authTokens.usedAt)));
      await tx.insert(authTokens).values({
        userId,
        purpose,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + ttlMs),
      });
    });
    return token;
  }

  /** The user a valid, unused token belongs to, without using it up. */
  private async peekToken(rawToken: string, purpose: TokenPurpose): Promise<string | null> {
    const [row] = await this.db.db
      .select({ userId: authTokens.userId })
      .from(authTokens)
      .where(and(eq(authTokens.tokenHash, hashToken(rawToken)), eq(authTokens.purpose, purpose), isNull(authTokens.usedAt), gt(authTokens.expiresAt, sql`now()`)));
    return row?.userId ?? null;
  }

  /** Marks a valid token as used and returns its user, atomically, so it can only be used once. */
  private async consumeToken(rawToken: string, purpose: TokenPurpose): Promise<string | null> {
    const [row] = await this.db.db
      .update(authTokens)
      .set({ usedAt: new Date() })
      .where(
        and(
          eq(authTokens.tokenHash, hashToken(rawToken)),
          eq(authTokens.purpose, purpose),
          isNull(authTokens.usedAt),
          gt(authTokens.expiresAt, sql`now()`),
        ),
      )
      .returning({ userId: authTokens.userId });
    return row?.userId ?? null;
  }

  private async createSession(userId: string, meta: SessionMeta): Promise<string> {
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + config.sessionTtlDays * 24 * HOUR);
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
