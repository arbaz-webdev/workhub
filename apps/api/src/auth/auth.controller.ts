import { Body, Controller, Get, HttpCode, Patch, Post, Req, Res } from '@nestjs/common';
import {
  forgotPasswordSchema,
  LOCALE_COOKIE,
  localeSchema,
  resetPasswordSchema,
  signInSchema,
  signUpSchema,
  verifyEmailSchema,
  type AuthProvidersResponse,
  type ForgotPasswordInput,
  type ResetPasswordInput,
  type SignInInput,
  type SignUpInput,
  type VerifyEmailInput,
  twoFactorCodeSchema,
  verifyTwoFactorSchema,
  type SignInResponse,
  type TwoFactorSetupDto,
  type TwoFactorStatusDto,
} from '@workhub/shared';
import { z } from 'zod';
import type { Response } from 'express';
import { config } from '../config';
import { RateLimiter } from '../common/rate-limiter';
import { AppRequest, AuthContext, CurrentAuth, Public } from '../common/request';
import { ZodPipe } from '../common/zod.pipe';
import { AuthService } from './auth.service';
import { clearSessionCookie, SESSION_COOKIE, setLocaleCookie, setSessionCookie } from './session';
import { Track } from '../analytics/track';

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

@Controller('auth')
export class AuthController {
  private readonly signInLimiter = new RateLimiter('auth.sign-in', 10, 15 * MINUTE);
  private readonly signUpLimiter = new RateLimiter('auth.sign-up', 20, HOUR);
  private readonly forgotLimiter = new RateLimiter('auth.forgot', 5, HOUR);
  private readonly forgotIpLimiter = new RateLimiter('auth.forgot-ip', 20, HOUR);
  private readonly resendLimiter = new RateLimiter('auth.resend', 3, HOUR);
  private readonly tokenLimiter = new RateLimiter('auth.token', 30, 15 * MINUTE);
  /** Codes are six digits: few guesses per ticket and per address. */
  private readonly codeLimiter = new RateLimiter('auth.2fa-challenge', 5, 10 * MINUTE);
  private readonly codeIpLimiter = new RateLimiter('auth.2fa-ip', 30, 15 * MINUTE);
  private readonly codeUserLimiter = new RateLimiter('auth.2fa-user', 10, 15 * MINUTE);

  constructor(private readonly auth: AuthService) {}

  @Public()
  @Get('providers')
  providers(): AuthProvidersResponse {
    return { google: config.google !== null };
  }

  @Public()
  @Post('sign-up')
  @Track('workspace created', (r: { user: { id: string }; workspace: { id: string } | null }) => (r.workspace ? { userId: r.user.id, workspaceId: r.workspace.id } : null))
  async signUp(
    @Body(new ZodPipe(signUpSchema)) body: SignUpInput,
    @Req() req: AppRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.signUpLimiter.consume(req.ip ?? 'unknown');
    const { token, user, workspace } = await this.auth.signUp(body, this.meta(req));
    setSessionCookie(res, token);
    // Signing up from the site in Urdu keeps WorkHub in Urdu.
    const browsing = req.cookies?.[LOCALE_COOKIE];
    if (browsing === 'ur') {
      await this.auth.setLocale(user.id, 'ur');
      return { user: { ...user, locale: 'ur' as const }, workspace };
    }
    return { user, workspace };
  }

  @Public()
  @Post('sign-in')
  @HttpCode(200)
  async signIn(
    @Body(new ZodPipe(signInSchema)) body: SignInInput,
    @Req() req: AppRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SignInResponse> {
    const key = `${req.ip ?? 'unknown'}:${body.email}`;
    await this.signInLimiter.consume(key);
    const result = await this.auth.signIn(body, this.meta(req));
    await this.signInLimiter.reset(key);
    if (result.token === undefined) return { twoFactorRequired: true, challenge: result.challenge };
    setSessionCookie(res, result.token);
    setLocaleCookie(res, result.user.locale);
    return { user: result.user };
  }

  /** The language the person uses WorkHub in, on every device. */
  @Patch('me/locale')
  @HttpCode(204)
  async setLocale(@Body(new ZodPipe(localeSchema)) body: z.infer<typeof localeSchema>, @CurrentAuth() auth: AuthContext, @Res({ passthrough: true }) res: Response): Promise<void> {
    await this.auth.setLocale(auth.userId, body.locale);
    setLocaleCookie(res, body.locale);
  }

  /** The second step of signing in: the code from the authenticator app, or a recovery code. */
  @Public()
  @Post('2fa/verify')
  @HttpCode(200)
  async verifyTwoFactor(
    @Body(new ZodPipe(verifyTwoFactorSchema)) body: z.infer<typeof verifyTwoFactorSchema>,
    @Req() req: AppRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SignInResponse> {
    await this.codeIpLimiter.consume(req.ip ?? 'unknown');
    await this.codeLimiter.consume(body.challenge);
    const { token, user } = await this.auth.verifyTwoFactor(body.challenge, body.code, this.meta(req));
    setSessionCookie(res, token);
    setLocaleCookie(res, user.locale);
    return { user };
  }

  @Get('2fa')
  twoFactorStatus(@CurrentAuth() auth: AuthContext): Promise<TwoFactorStatusDto> {
    return this.auth.twoFactorStatus(auth.userId);
  }

  @Post('2fa/setup')
  @HttpCode(200)
  startTwoFactor(@CurrentAuth() auth: AuthContext): Promise<TwoFactorSetupDto> {
    return this.auth.startTwoFactorSetup(auth.userId);
  }

  /** Turns it on; the answer holds the recovery codes, shown only this once. */
  @Post('2fa/enable')
  @HttpCode(200)
  async enableTwoFactor(@Body(new ZodPipe(twoFactorCodeSchema)) body: { code: string }, @CurrentAuth() auth: AuthContext): Promise<{ recoveryCodes: string[] }> {
    await this.codeUserLimiter.consume(auth.userId);
    return { recoveryCodes: await this.auth.enableTwoFactor(auth.userId, body.code, auth.sessionId) };
  }

  @Post('2fa/disable')
  @HttpCode(204)
  async disableTwoFactor(@Body(new ZodPipe(twoFactorCodeSchema)) body: { code: string }, @CurrentAuth() auth: AuthContext) {
    await this.codeUserLimiter.consume(auth.userId);
    await this.auth.disableTwoFactor(auth.userId, body.code);
  }

  @Post('2fa/recovery-codes')
  @HttpCode(200)
  async newRecoveryCodes(@Body(new ZodPipe(twoFactorCodeSchema)) body: { code: string }, @CurrentAuth() auth: AuthContext): Promise<{ recoveryCodes: string[] }> {
    await this.codeUserLimiter.consume(auth.userId);
    return { recoveryCodes: await this.auth.regenerateRecoveryCodes(auth.userId, body.code) };
  }

  @Public()
  @Post('sign-out')
  @HttpCode(204)
  async signOut(@Req() req: AppRequest, @Res({ passthrough: true }) res: Response) {
    const token: unknown = req.cookies?.[SESSION_COOKIE];
    if (typeof token === 'string' && token) await this.auth.signOut(token);
    clearSessionCookie(res);
  }

  @Get('me')
  me(@CurrentAuth() auth: AuthContext) {
    return this.auth.me(auth.userId);
  }

  @Public()
  @Post('verify-email')
  @HttpCode(204)
  async verifyEmail(@Body(new ZodPipe(verifyEmailSchema)) body: VerifyEmailInput, @Req() req: AppRequest) {
    await this.tokenLimiter.consume(req.ip ?? 'unknown');
    await this.auth.verifyEmail(body.token);
  }

  @Post('resend-verification')
  @HttpCode(204)
  async resendVerification(@CurrentAuth() auth: AuthContext) {
    await this.resendLimiter.consume(auth.userId);
    await this.auth.resendVerification(auth.userId);
  }

  @Public()
  @Post('forgot-password')
  @HttpCode(204)
  async forgotPassword(@Body(new ZodPipe(forgotPasswordSchema)) body: ForgotPasswordInput, @Req() req: AppRequest) {
    const ip = req.ip ?? 'unknown';
    await this.forgotIpLimiter.consume(ip);
    await this.forgotLimiter.consume(`${ip}:${body.email}`);
    await this.auth.forgotPassword(body.email);
  }

  @Public()
  @Post('reset-password')
  @HttpCode(204)
  async resetPassword(
    @Body(new ZodPipe(resetPasswordSchema)) body: ResetPasswordInput,
    @Req() req: AppRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.tokenLimiter.consume(req.ip ?? 'unknown');
    await this.auth.resetPassword(body.token, body.password);
    clearSessionCookie(res);
  }

  private meta(req: AppRequest) {
    return { ip: req.ip, userAgent: req.headers['user-agent'] };
  }
}
