// Google sign-in, with Google's token endpoint replaced by a fake.
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createApp, PASSWORD, signUp, uniqueEmail, withAdmin } from './helpers';

const CLIENT_ID = 'test-client.apps.googleusercontent.com';

function fakeIdToken(claims: Record<string, unknown>): string {
  const part = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${part({ alg: 'RS256' })}.${part(claims)}.signature`;
}

function googleClaims(overrides: Record<string, unknown> = {}) {
  return {
    iss: 'https://accounts.google.com',
    aud: CLIENT_ID,
    exp: Math.floor(Date.now() / 1000) + 3600,
    sub: `google-${Math.random().toString(36).slice(2)}`,
    email: uniqueEmail('google'),
    email_verified: true,
    name: 'Sara Khan',
    ...overrides,
  };
}

let app: INestApplication;
let fetchSpy: jest.SpyInstance;
let nextClaims: Record<string, unknown>;

beforeAll(async () => {
  process.env.GOOGLE_CLIENT_ID = CLIENT_ID;
  process.env.GOOGLE_CLIENT_SECRET = 'test-secret';
  fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(async (url) => {
    if (String(url) !== 'https://oauth2.googleapis.com/token') throw new Error(`unexpected fetch ${url}`);
    return new Response(JSON.stringify({ id_token: fakeIdToken(nextClaims) }), { status: 200 });
  });
  app = await createApp();
});

afterAll(async () => {
  await app.close();
  fetchSpy.mockRestore();
  delete process.env.GOOGLE_CLIENT_ID;
  delete process.env.GOOGLE_CLIENT_SECRET;
});

/** Runs start → callback like a browser would, returning the agent and final redirect. */
async function googleSignIn(claims: Record<string, unknown>, opts: { tamperState?: boolean } = {}) {
  nextClaims = claims;
  const agent = request.agent(app.getHttpServer());
  const start = await agent.get('/auth/google/start').expect(302);
  const state = new URL(start.headers.location as string).searchParams.get('state')!;
  const res = await agent
    .get('/auth/google/callback')
    .query({ code: 'auth-code', state: opts.tamperState ? `${state}x` : state })
    .expect(302);
  return { agent, location: res.headers.location as string, res };
}

describe('Google sign-in', () => {
  it('reports itself as enabled', async () => {
    const res = await request(app.getHttpServer()).get('/auth/providers').expect(200);
    expect(res.body).toEqual({ google: true });
  });

  it('redirects to Google with PKCE and a state cookie', async () => {
    const res = await request(app.getHttpServer()).get('/auth/google/start').expect(302);
    const url = new URL(res.headers.location as string);
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(url.searchParams.get('client_id')).toBe(CLIENT_ID);
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('redirect_uri')).toBe('http://localhost:3000/api/auth/google/callback');
    const cookie = (res.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith('wh_oauth='));
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toContain(url.searchParams.get('state')!);
  });

  it('creates a verified account with no workspace yet', async () => {
    const claims = googleClaims();
    const { agent, location } = await googleSignIn(claims);
    expect(location).toBe('http://localhost:3000/app');

    const me = await agent.get('/auth/me').expect(200);
    expect(me.body.user).toMatchObject({ email: claims.email, name: 'Sara Khan', emailVerified: true });
    expect(me.body.workspaces).toEqual([]);

    await agent.post('/workspaces').send({ name: 'Sara Studio' }).expect(201);
    expect((await agent.get('/auth/me')).body.workspaces).toHaveLength(1);

    // Signing in again with the same Google account reaches the same user.
    const again = await googleSignIn({ ...claims });
    expect((await again.agent.get('/auth/me')).body.user.id).toBe(me.body.user.id);
  });

  it('links to an existing verified account and keeps its password', async () => {
    const { email, agent: owner } = await signUp(app, 'linked');
    await withAdmin((db) => db.query('update users set email_verified_at = now() where email = $1', [email]));
    const ownerId = (await owner.get('/auth/me')).body.user.id;

    const { agent } = await googleSignIn(googleClaims({ email }));
    expect((await agent.get('/auth/me')).body.user.id).toBe(ownerId);
    await request(app.getHttpServer()).post('/auth/sign-in').send({ email, password: PASSWORD }).expect(200);
    await owner.get('/auth/me').expect(200);
  });

  it('takes over an unverified look-alike account safely (removes its password and sessions)', async () => {
    // An attacker registers the victim's email first, without ever verifying it.
    const { email, agent: attacker } = await signUp(app, 'squatter');
    const { agent: victim } = await googleSignIn(googleClaims({ email }));

    await victim.get('/auth/me').expect(200);
    await attacker.get('/auth/me').expect(401);
    await request(app.getHttpServer()).post('/auth/sign-in').send({ email, password: PASSWORD }).expect(401);
  });

  it('rejects a tampered state', async () => {
    const { location, res } = await googleSignIn(googleClaims(), { tamperState: true });
    expect(location).toBe('http://localhost:3000/sign-in?error=google');
    const cookies = (res.headers['set-cookie'] as unknown as string[] | undefined) ?? [];
    expect(cookies.some((c) => c.startsWith('wh_session='))).toBe(false);
  });

  it.each([
    ['a token for another app', { aud: 'someone-else.apps.googleusercontent.com' }],
    ['an expired token', { exp: Math.floor(Date.now() / 1000) - 10 }],
    ['an unverified Google email', { email_verified: false }],
    ['a foreign issuer', { iss: 'https://evil.example' }],
  ])('rejects %s', async (_label, overrides) => {
    const { location } = await googleSignIn(googleClaims(overrides));
    expect(location).toBe('http://localhost:3000/sign-in?error=google');
  });

  it('rejects a callback with no state cookie', async () => {
    const res = await request(app.getHttpServer())
      .get('/auth/google/callback')
      .query({ code: 'x', state: 'y' })
      .expect(302);
    expect(res.headers.location).toBe('http://localhost:3000/sign-in?error=google');
  });

  it('switches off when not configured', async () => {
    const id = process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_ID;
    try {
      expect((await request(app.getHttpServer()).get('/auth/providers')).body).toEqual({ google: false });
      await request(app.getHttpServer()).get('/auth/google/start').expect(404);
    } finally {
      process.env.GOOGLE_CLIENT_ID = id;
    }
  });
});
