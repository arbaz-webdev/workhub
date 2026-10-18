import { Body, Controller, Get, HttpCode, Post, Req, Res } from '@nestjs/common';
import { signInSchema, signUpSchema, type SignInInput, type SignUpInput } from '@workhub/shared';
import type { Response } from 'express';
import { RateLimiter } from '../common/rate-limiter';
import { AppRequest, AuthContext, CurrentAuth, Public } from '../common/request';
import { ZodPipe } from '../common/zod.pipe';
import { AuthService } from './auth.service';
import { clearSessionCookie, SESSION_COOKIE, setSessionCookie } from './session';

const FIFTEEN_MINUTES = 15 * 60 * 1000;

@Controller('auth')
export class AuthController {
  private readonly signInLimiter = new RateLimiter(10, FIFTEEN_MINUTES);
  private readonly signUpLimiter = new RateLimiter(20, 60 * 60 * 1000);

  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('sign-up')
  async signUp(
    @Body(new ZodPipe(signUpSchema)) body: SignUpInput,
    @Req() req: AppRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    this.signUpLimiter.consume(req.ip ?? 'unknown');
    const { token, user, workspace } = await this.auth.signUp(body, this.meta(req));
    setSessionCookie(res, token);
    return { user, workspace };
  }

  @Public()
  @Post('sign-in')
  @HttpCode(200)
  async signIn(
    @Body(new ZodPipe(signInSchema)) body: SignInInput,
    @Req() req: AppRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const key = `${req.ip ?? 'unknown'}:${body.email}`;
    this.signInLimiter.consume(key);
    const { token, user } = await this.auth.signIn(body, this.meta(req));
    this.signInLimiter.reset(key);
    setSessionCookie(res, token);
    return { user };
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

  private meta(req: AppRequest) {
    return { ip: req.ip, userAgent: req.headers['user-agent'] };
  }
}
