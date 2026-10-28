import { Controller, Get, Logger, NotFoundException, Query, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { config } from '../config';
import { AppRequest, Public } from '../common/request';
import { AuthService, GoogleProfile } from './auth.service';
import { setSessionCookie } from './session';

const OAUTH_COOKIE = 'wh_oauth';
const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_ISSUERS = new Set(['https://accounts.google.com', 'accounts.google.com']);

function redirectUri() {
  // Goes through the web app's /api proxy, so the session cookie lands on the web origin.
  return `${config.appUrl}/api/auth/google/callback`;
}

function sameString(a: string, b: string) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

function decodeJwtPayload(jwt: string): Record<string, unknown> {
  const part = jwt.split('.')[1];
  if (!part) throw new Error('Malformed ID token');
  return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
}

/**
 * Google sign-in with the OAuth 2.0 authorization-code flow, PKCE and a state
 * check. The ID token comes straight from Google's token endpoint over TLS, in
 * exchange for our client secret, so its claims are trusted after checking
 * audience, issuer, expiry and that Google verified the email (OIDC Core 3.1.3.7).
 */
@Controller('auth/google')
export class GoogleAuthController {
  private readonly logger = new Logger('GoogleAuth');

  constructor(private readonly auth: AuthService) {}

  @Public()
  @Get('start')
  start(@Res() res: Response) {
    const google = config.google;
    if (!google) throw new NotFoundException('Google sign-in is not enabled');

    const state = randomBytes(16).toString('base64url');
    const verifier = randomBytes(32).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');

    res.cookie(OAUTH_COOKIE, `${state}.${verifier}`, {
      httpOnly: true,
      sameSite: 'lax',
      secure: config.isProduction,
      path: '/',
      maxAge: 10 * 60 * 1000,
    });

    const url = new URL(GOOGLE_AUTH_URL);
    url.search = new URLSearchParams({
      client_id: google.clientId,
      redirect_uri: redirectUri(),
      response_type: 'code',
      scope: 'openid email profile',
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      prompt: 'select_account',
    }).toString();
    res.redirect(302, url.toString());
  }

  @Public()
  @Get('callback')
  async callback(
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Req() req: AppRequest,
    @Res() res: Response,
  ) {
    const fail = (reason: string) => {
      this.logger.warn(`Google sign-in failed: ${reason}`);
      res.clearCookie(OAUTH_COOKIE, { path: '/' });
      res.redirect(302, `${config.appUrl}/sign-in?error=google`);
    };

    const google = config.google;
    if (!google) return fail('not configured');

    const cookie: unknown = req.cookies?.[OAUTH_COOKIE];
    const [expectedState, verifier] = typeof cookie === 'string' ? cookie.split('.') : [];
    if (!code || !state || !expectedState || !verifier || !sameString(state, expectedState)) {
      return fail('state mismatch or missing code');
    }

    let profile: GoogleProfile;
    try {
      const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: google.clientId,
          client_secret: google.clientSecret,
          redirect_uri: redirectUri(),
          grant_type: 'authorization_code',
          code_verifier: verifier,
        }),
      });
      if (!tokenRes.ok) return fail(`token endpoint returned ${tokenRes.status}`);
      const { id_token: idToken } = (await tokenRes.json()) as { id_token?: string };
      if (!idToken) return fail('no id_token');

      const claims = decodeJwtPayload(idToken);
      const audOk = claims.aud === google.clientId;
      const issOk = typeof claims.iss === 'string' && GOOGLE_ISSUERS.has(claims.iss);
      const expOk = typeof claims.exp === 'number' && claims.exp * 1000 > Date.now();
      if (!audOk || !issOk || !expOk) return fail('ID token claims rejected');
      if (claims.email_verified !== true || typeof claims.email !== 'string' || typeof claims.sub !== 'string') {
        return fail('email not verified by Google');
      }
      const email = claims.email.toLowerCase();
      const name = typeof claims.name === 'string' && claims.name.trim() ? claims.name.trim() : email.split('@')[0]!;
      profile = { sub: claims.sub, email, name };
    } catch (err) {
      return fail((err as Error).message);
    }

    const result = await this.auth.signInWithGoogle(profile, { ip: req.ip, userAgent: req.headers['user-agent'] });
    res.clearCookie(OAUTH_COOKIE, { path: '/' });
    if (result.token === undefined) {
      // Google proved the email; the authenticator app proves the person.
      res.redirect(302, `${config.appUrl}/sign-in?twofactor=${encodeURIComponent(result.challenge)}`);
      return;
    }
    setSessionCookie(res, result.token);
    res.redirect(302, `${config.appUrl}/app`);
  }
}
