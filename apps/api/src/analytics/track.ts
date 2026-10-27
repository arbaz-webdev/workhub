import { CallHandler, ExecutionContext, Injectable, NestInterceptor, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { tap } from 'rxjs';
import type { AppRequest } from '../common/request';
import { AnalyticsService, type AnalyticsEvent } from './analytics.service';

const TRACK = 'analytics:event';

interface Tracked {
  event: AnalyticsEvent;
  /** Who and where, when the request alone can't say (sign-up, joining by invitation); null skips it. */
  from?: (result: unknown) => { userId?: string; workspaceId?: string } | null;
}

/** Records an analytics event when the route succeeds. */
export const Track = <R>(event: AnalyticsEvent, from?: (result: R) => ReturnType<NonNullable<Tracked['from']>>) =>
  SetMetadata(TRACK, { event, from: from as Tracked['from'] } satisfies Tracked);

@Injectable()
export class TrackInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly analytics: AnalyticsService,
  ) {}

  intercept(ctx: ExecutionContext, next: CallHandler) {
    const tracked = this.reflector.get<Tracked | undefined>(TRACK, ctx.getHandler());
    if (!tracked) return next.handle();
    const req = ctx.switchToHttp().getRequest<AppRequest>();
    return next.handle().pipe(
      tap((result: unknown) => {
        const extra = tracked.from ? tracked.from(result) : {};
        if (!extra) return;
        const userId = extra.userId ?? req.auth?.userId;
        if (userId) this.analytics.capture(tracked.event, { userId, workspaceId: extra.workspaceId ?? req.workspace?.id });
      }),
    );
  }
}
