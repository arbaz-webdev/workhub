import { LOCALE_COOKIE, type Locale } from '@workhub/shared';
import type { CookieOptions, Response } from 'express';
import { config } from '../config';

export const SESSION_COOKIE = 'wh_session';

function cookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.isProduction,
    path: '/',
  };
}

export function setSessionCookie(res: Response, token: string) {
  res.cookie(SESSION_COOKIE, token, { ...cookieOptions(), maxAge: config.sessionTtlDays * 24 * 60 * 60 * 1000 });
}

/** The interface language, read when pages are rendered (not secret, so readable by the page). */
export function setLocaleCookie(res: Response, locale: Locale) {
  res.cookie(LOCALE_COOKIE, locale, { ...cookieOptions(), httpOnly: false, maxAge: 365 * 24 * 60 * 60 * 1000 });
}

export function clearSessionCookie(res: Response) {
  res.clearCookie(SESSION_COOKIE, cookieOptions());
}
