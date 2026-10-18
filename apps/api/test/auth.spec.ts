import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createApp, PASSWORD, signUp, uniqueEmail, withAdmin } from './helpers';

let app: INestApplication;

beforeAll(async () => {
  app = await createApp();
});

afterAll(async () => {
  await app.close();
});

function sessionCookie(res: request.Response): string | undefined {
  const cookies = res.headers['set-cookie'] as unknown as string[] | undefined;
  return cookies?.find((c) => c.startsWith('wh_session='));
}

describe('sign-up', () => {
  it('creates the user, their workspace as owner, and a session cookie', async () => {
    const agent = request.agent(app.getHttpServer());
    const email = uniqueEmail('owner');
    const res = await agent
      .post('/auth/sign-up')
      .send({ name: 'Ayesha', email, password: PASSWORD, workspaceName: 'Pixel Studio' })
      .expect(201);

    const cookie = sessionCookie(res);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(res.body.workspace).toMatchObject({ name: 'Pixel Studio', role: 'owner' });
    expect(res.body.workspace.slug).toMatch(/^pixel-studio-[0-9a-f]{6}$/);

    const me = await agent.get('/auth/me').expect(200);
    expect(me.body.user).toMatchObject({ name: 'Ayesha', email, emailVerified: false });
    expect(me.body.workspaces).toEqual([expect.objectContaining({ name: 'Pixel Studio', role: 'owner' })]);
  });

  it('stores an Argon2id hash, never the password', async () => {
    const { email } = await signUp(app, 'hash');
    const hash = await withAdmin(async (db) => {
      const { rows } = await db.query('select password_hash from users where email = $1', [email]);
      return rows[0].password_hash as string;
    });
    expect(hash.startsWith('$argon2id$')).toBe(true);
    expect(hash).not.toContain(PASSWORD);
  });

  it('rejects a duplicate email regardless of case', async () => {
    const { email } = await signUp(app, 'dupe');
    await request(app.getHttpServer())
      .post('/auth/sign-up')
      .send({ name: 'Copy', email: email.toUpperCase(), password: PASSWORD, workspaceName: 'Other' })
      .expect(409);
  });

  it('validates input', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/sign-up')
      .send({ name: 'X', email: 'not-an-email', password: 'short', workspaceName: 'Y' })
      .expect(400);
    const paths = res.body.errors.map((e: { path: string }) => e.path).sort();
    expect(paths).toEqual(['email', 'password', 'workspaceName']);
  });
});

describe('sign-in and sign-out', () => {
  it('signs in with the right password and rejects the wrong one', async () => {
    const { email } = await signUp(app, 'signin');
    await request(app.getHttpServer()).post('/auth/sign-in').send({ email, password: 'wrong-password' }).expect(401);

    const agent = request.agent(app.getHttpServer());
    const res = await agent.post('/auth/sign-in').send({ email, password: PASSWORD }).expect(200);
    expect(sessionCookie(res)).toBeDefined();
    await agent.get('/auth/me').expect(200);
  });

  it('gives the same answer for an unknown email as for a wrong password', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/sign-in')
      .send({ email: uniqueEmail('nobody'), password: PASSWORD })
      .expect(401);
    expect(res.body.message).toBe('Incorrect email or password');
  });

  it('ends the session on sign-out', async () => {
    const { agent } = await signUp(app, 'signout');
    await agent.get('/auth/me').expect(200);
    await agent.post('/auth/sign-out').expect(204);
    await agent.get('/auth/me').expect(401);
  });

  it('requires a session for protected routes', async () => {
    await request(app.getHttpServer()).get('/auth/me').expect(401);
    await request(app.getHttpServer()).get('/auth/me').set('Cookie', 'wh_session=forged-token').expect(401);
  });

  it('rate-limits repeated failed sign-ins', async () => {
    const { email } = await signUp(app, 'brute');
    const server = request(app.getHttpServer());
    for (let i = 0; i < 10; i += 1) {
      await server.post('/auth/sign-in').send({ email, password: `wrong-${i}` }).expect(401);
    }
    await server.post('/auth/sign-in').send({ email, password: PASSWORD }).expect(429);
  });
});

describe('cross-site protection', () => {
  it('blocks state-changing requests from other origins', async () => {
    await request(app.getHttpServer())
      .post('/auth/sign-in')
      .set('Origin', 'https://evil.example')
      .send({ email: uniqueEmail(), password: PASSWORD })
      .expect(403);
  });

  it('allows requests from the web app origin', async () => {
    await request(app.getHttpServer())
      .post('/auth/sign-in')
      .set('Origin', 'http://localhost:3000')
      .send({ email: uniqueEmail(), password: PASSWORD })
      .expect(401);
  });
});
