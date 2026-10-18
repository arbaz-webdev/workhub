import type { NextFunction, Request, Response } from 'express';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF defence on top of SameSite=Lax cookies: a state-changing request that
 * comes from a browser must come from one of our own web origins.
 */
export function originCheck(allowedOrigins: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (SAFE_METHODS.has(req.method)) return next();
    const origin = req.headers.origin;
    if (origin && !allowedOrigins.includes(origin)) {
      res.status(403).json({ statusCode: 403, message: 'Origin not allowed' });
      return;
    }
    next();
  };
}
