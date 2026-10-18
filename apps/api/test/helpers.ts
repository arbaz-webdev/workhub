import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import type { WorkspaceDto } from '@workhub/shared';
import { Client } from 'pg';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { TEST_ADMIN_URL } from './db-urls';

export async function createApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>();
  configureApp(app);
  await app.init();
  return app;
}

let counter = 0;
export function uniqueEmail(prefix = 'user'): string {
  counter += 1;
  return `${prefix}-${Date.now()}-${counter}@example.com`;
}

export const PASSWORD = 'correct-horse-battery';

/** Signs up a new user + workspace and returns a cookie-carrying agent. */
export async function signUp(app: INestApplication, prefix = 'user', workspaceName = 'Acme Agency') {
  const agent = request.agent(app.getHttpServer());
  const email = uniqueEmail(prefix);
  const res = await agent
    .post('/auth/sign-up')
    .send({ name: prefix, email, password: PASSWORD, workspaceName })
    .expect(201);
  return { agent, email, user: res.body.user as { id: string }, workspace: res.body.workspace as WorkspaceDto };
}

/** Superuser connection for test setup; it bypasses Row-Level Security. */
export async function withAdmin<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: TEST_ADMIN_URL });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}
