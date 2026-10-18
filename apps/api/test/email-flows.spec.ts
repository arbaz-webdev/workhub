import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createApp, lastEmailTo, PASSWORD, signUp, tokenFrom, uniqueEmail, withAdmin } from './helpers';

let app: INestApplication;

beforeAll(async () => {
  app = await createApp();
});

afterAll(async () => {
  await app.close();
});

describe('email verification', () => {
  it('sends a verification link on sign-up that verifies the email once', async () => {
    const { agent, email } = await signUp(app, 'verify');
    const message = lastEmailTo(email);
    expect(message?.subject).toBe('Confirm your email for WorkHub');
    expect(message?.text).toContain('http://localhost:3000/verify-email?token=');

    expect((await agent.get('/auth/me')).body.user.emailVerified).toBe(false);

    const token = tokenFrom(message);
    await request(app.getHttpServer()).post('/auth/verify-email').send({ token }).expect(204);
    expect((await agent.get('/auth/me')).body.user.emailVerified).toBe(true);

    // The same link can't be used twice.
    await request(app.getHttpServer()).post('/auth/verify-email').send({ token }).expect(400);
  });

  it('rejects expired and made-up links', async () => {
    const { email } = await signUp(app, 'expired');
    const token = tokenFrom(lastEmailTo(email));
    await withAdmin((db) =>
      db.query(`update auth_tokens set expires_at = now() - interval '1 minute' where purpose = 'email_verification'
                and user_id = (select id from users where email = $1)`, [email]),
    );
    await request(app.getHttpServer()).post('/auth/verify-email').send({ token }).expect(400);
    await request(app.getHttpServer())
      .post('/auth/verify-email')
      .send({ token: 'x'.repeat(43) })
      .expect(400);
  });

  it('resending replaces the old link', async () => {
    const { agent, email } = await signUp(app, 'resend');
    const first = tokenFrom(lastEmailTo(email));
    await agent.post('/auth/resend-verification').expect(204);
    const second = tokenFrom(lastEmailTo(email));
    expect(second).not.toBe(first);

    await request(app.getHttpServer()).post('/auth/verify-email').send({ token: first }).expect(400);
    await request(app.getHttpServer()).post('/auth/verify-email').send({ token: second }).expect(204);
  });

  it('requires a session to resend', async () => {
    await request(app.getHttpServer()).post('/auth/resend-verification').expect(401);
  });
});

describe('password reset', () => {
  it('answers the same for unknown emails and sends nothing', async () => {
    const email = uniqueEmail('ghost');
    await request(app.getHttpServer()).post('/auth/forgot-password').send({ email }).expect(204);
    expect(lastEmailTo(email)).toBeUndefined();
  });

  it('resets the password, signs out every session, and works only once', async () => {
    const { agent, email } = await signUp(app, 'reset');
    await agent.get('/auth/me').expect(200);

    await request(app.getHttpServer()).post('/auth/forgot-password').send({ email }).expect(204);
    const message = lastEmailTo(email);
    expect(message?.subject).toBe('Reset your WorkHub password');
    const token = tokenFrom(message);

    const newPassword = 'a-brand-new-password';
    await request(app.getHttpServer()).post('/auth/reset-password').send({ token, password: newPassword }).expect(204);

    // Existing sessions are revoked.
    await agent.get('/auth/me').expect(401);
    // Old password stops working, new one works.
    await request(app.getHttpServer()).post('/auth/sign-in').send({ email, password: PASSWORD }).expect(401);
    const fresh = request.agent(app.getHttpServer());
    await fresh.post('/auth/sign-in').send({ email, password: newPassword }).expect(200);
    // Clicking the reset link proved inbox ownership.
    expect((await fresh.get('/auth/me')).body.user.emailVerified).toBe(true);

    // Single use.
    await request(app.getHttpServer())
      .post('/auth/reset-password')
      .send({ token, password: 'yet-another-password' })
      .expect(400);
  });

  it('only the newest reset link works', async () => {
    const { email } = await signUp(app, 'twice');
    await request(app.getHttpServer()).post('/auth/forgot-password').send({ email }).expect(204);
    const first = tokenFrom(lastEmailTo(email));
    await request(app.getHttpServer()).post('/auth/forgot-password').send({ email }).expect(204);
    const second = tokenFrom(lastEmailTo(email));

    await request(app.getHttpServer())
      .post('/auth/reset-password')
      .send({ token: first, password: 'first-new-password' })
      .expect(400);
    await request(app.getHttpServer())
      .post('/auth/reset-password')
      .send({ token: second, password: 'second-new-password' })
      .expect(204);
  });

  it('a verification link cannot be used as a reset link', async () => {
    const { email } = await signUp(app, 'mixup');
    const verifyToken = tokenFrom(lastEmailTo(email));
    await request(app.getHttpServer())
      .post('/auth/reset-password')
      .send({ token: verifyToken, password: 'sneaky-new-password' })
      .expect(400);
  });

  it('validates the new password', async () => {
    await request(app.getHttpServer())
      .post('/auth/reset-password')
      .send({ token: 'x'.repeat(43), password: 'short' })
      .expect(400);
  });
});

describe('creating another workspace', () => {
  it('makes the caller its owner', async () => {
    const { agent } = await signUp(app, 'multi', 'First Co');
    const res = await agent.post('/workspaces').send({ name: 'Second Co' }).expect(201);
    expect(res.body).toMatchObject({ name: 'Second Co', role: 'owner' });
    const me = await agent.get('/auth/me').expect(200);
    expect(me.body.workspaces.map((w: { name: string }) => w.name)).toEqual(['First Co', 'Second Co']);
  });

  it('requires a session', async () => {
    await request(app.getHttpServer()).post('/workspaces').send({ name: 'Nope Co' }).expect(401);
  });
});
