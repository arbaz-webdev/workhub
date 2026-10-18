import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Request } from 'express';
import type { Role } from '@workhub/shared';

export interface AuthContext {
  userId: string;
  sessionId: string;
}

export interface WorkspaceContext {
  id: string;
  role: Role;
}

export interface AppRequest extends Request {
  auth?: AuthContext;
  workspace?: WorkspaceContext;
}

export const IS_PUBLIC = 'isPublic';
/** Marks a route as reachable without a session. Everything else requires one. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

export const MIN_ROLE = 'minRole';
/** Minimum workspace role for a route guarded by WorkspaceGuard (default: member). */
export const MinRole = (role: Role) => SetMetadata(MIN_ROLE, role);

export const CurrentAuth = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthContext => {
  const auth = ctx.switchToHttp().getRequest<AppRequest>().auth;
  if (!auth) throw new Error('CurrentAuth used on a public route');
  return auth;
});

export const CurrentWorkspace = createParamDecorator((_: unknown, ctx: ExecutionContext): WorkspaceContext => {
  const workspace = ctx.switchToHttp().getRequest<AppRequest>().workspace;
  if (!workspace) throw new Error('CurrentWorkspace used without WorkspaceGuard');
  return workspace;
});

export const ClientIp = createParamDecorator((_: unknown, ctx: ExecutionContext): string | undefined => {
  return ctx.switchToHttp().getRequest<AppRequest>().ip;
});
