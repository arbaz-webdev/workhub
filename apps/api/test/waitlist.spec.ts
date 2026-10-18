import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createApp, lastEmailTo, uniqueEmail, withAdmin } from './helpers';

let app: INestApplication;

beforeAll(async () => {
  app = await createApp();
});

afterAll(async () => {
  await app.close();
});

function entry(email: string) {
  return {
    name: 'Bilal',
    email,
    company: 'Bilal Digital',
    teamSize: '10-49',
    currentTools: 'Trello, Slack, Excel',
    biggestProblem: 'Compiling attendance takes two days every month',
    monthlySpend: 'PKR 50,000',
  };
}

async function countRows(email: string) {
  return withAdmin(async (db) => {
    const { rows } = await db.query('select count(*)::int as n from waitlist where lower(email) = lower($1)', [email]);
    return rows[0].n as number;
  });
}

describe('waitlist', () => {
  it('saves the answers and sends a welcome email', async () => {
    const email = uniqueEmail('wait');
    await request(app.getHttpServer()).post('/waitlist').send(entry(email)).expect(202);
    expect(await countRows(email)).toBe(1);
    expect(lastEmailTo(email)?.subject).toBe("You're on the WorkHub beta list");
  });

  it('answers the same for a repeat email and keeps one row', async () => {
    const email = uniqueEmail('again');
    await request(app.getHttpServer()).post('/waitlist').send(entry(email)).expect(202);
    await request(app.getHttpServer()).post('/waitlist').send(entry(email.toUpperCase())).expect(202);
    expect(await countRows(email)).toBe(1);
  });

  it('only requires name, email, company and team size', async () => {
    const email = uniqueEmail('min');
    await request(app.getHttpServer())
      .post('/waitlist')
      .send({ name: 'A', email, company: 'B', teamSize: '1-9' })
      .expect(202);
  });

  it('validates input', async () => {
    const res = await request(app.getHttpServer())
      .post('/waitlist')
      .send({ name: '', email: 'nope', company: '', teamSize: '5000' })
      .expect(400);
    const paths = res.body.errors.map((e: { path: string }) => e.path).sort();
    expect(paths).toEqual(['company', 'email', 'name', 'teamSize']);
  });

  it('blocks submissions from other websites', async () => {
    await request(app.getHttpServer())
      .post('/waitlist')
      .set('Origin', 'https://spam.example')
      .send(entry(uniqueEmail('spam')))
      .expect(403);
  });
});
