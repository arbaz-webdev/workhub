import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AppRequest, IS_PUBLIC } from '../common/request';
import { AuthService } from './auth.service';
import { SESSION_COOKIE } from './session';

/** Global guard: every route needs a valid session unless marked @Public(). */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: AuthService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [ctx.getHandler(), ctx.getClass()]);
    if (isPublic) return true;

    const req = ctx.switchToHttp().getRequest<AppRequest>();
    const token: unknown = req.cookies?.[SESSION_COOKIE];
    if (typeof token !== 'string' || !token) throw new UnauthorizedException();

    const session = await this.auth.validateSession(token);
    if (!session) throw new UnauthorizedException();

    req.auth = { userId: session.userId, sessionId: session.sessionId };
    return true;
  }
}
