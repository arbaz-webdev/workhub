import type { INestApplication } from '@nestjs/common';
import type { MeResponse } from '@workhub/shared';
import request from 'supertest';
import { createApp, PASSWORD, signUp, uniqueEmail } from './helpers';

let app: INestApplication;

beforeAll(async () => {
  app = await createApp();
});

afterAll(async () => {
  await app.close();
});

const langCookie = (res: request.Response) => ([res.headers['set-cookie']].flat() as string[]).find((c) => c?.startsWith('wh_lang='));

describe('Interface language', () => {
  it('is saved per person, sent as a cookie, and restored on sign-in', async () => {
    const { agent, email } = await signUp(app, 'urdu');
    expect(((await agent.get('/auth/me').expect(200)).body as MeResponse).user.locale).toBe('en');

    await agent.patch('/auth/me/locale').send({ locale: 'fr' }).expect(400);
    const set = await agent.patch('/auth/me/locale').send({ locale: 'ur' }).expect(204);
    expect(langCookie(set)).toMatch(/^wh_lang=ur;/);
    // Readable by the page (it's not a secret), unlike the session cookie.
    expect(langCookie(set)).not.toMatch(/HttpOnly/i);
    expect(((await agent.get('/auth/me').expect(200)).body as MeResponse).user.locale).toBe('ur');

    // A new device: signing in brings the language back.
    const signIn = await request(app.getHttpServer()).post('/auth/sign-in').send({ email, password: PASSWORD }).expect(200);
    expect(signIn.body.user.locale).toBe('ur');
    expect(langCookie(signIn)).toMatch(/^wh_lang=ur;/);

    await request(app.getHttpServer()).patch('/auth/me/locale').send({ locale: 'en' }).expect(401);
  });

  it('starts in Urdu for someone who signs up while browsing in Urdu', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/sign-up')
      .set('Cookie', 'wh_lang=ur')
      .send({ name: 'Ayesha', email: uniqueEmail('ayesha'), password: PASSWORD, workspaceName: 'Urdu Co' })
      .expect(201);
    expect(res.body.user.locale).toBe('ur');
  });
});
