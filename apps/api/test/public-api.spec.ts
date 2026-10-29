// The public API (/v1) with API keys: keys, isolation between workspaces, who a key acts as,
// paging, the rate limit, and the data each endpoint returns.
import type { INestApplication } from '@nestjs/common';
import { WORKSPACE_HEADER, type ApiKeyCreatedDto, type ApiKeyDto } from '@workhub/shared';
import request from 'supertest';
import { createApp, signUp, signUpWithoutWorkspace, withAdmin } from './helpers';

let app: INestApplication;
let alice: Awaited<ReturnType<typeof signUp>>;
let bob: Awaited<ReturnType<typeof signUp>>;

beforeAll(async () => {
  app = await createApp();
  alice = await signUp(app, 'alice', 'Alice Agency');
  bob = await signUp(app, 'bob', 'Bob BPO');
});

afterAll(async () => {
  await app.close();
});

async function createKey(owner: typeof alice, access: 'read' | 'write' = 'read', name = 'Payroll sync'): Promise<ApiKeyCreatedDto> {
  const res = await owner.agent.post('/api-keys').set(WORKSPACE_HEADER, owner.workspace.id).send({ name, access }).expect(201);
  return res.body;
}

const v1 = (path: string, key?: string) => {
  const req = request(app.getHttpServer()).get(`/v1${path}`);
  return key ? req.set('Authorization', `Bearer ${key}`) : req;
};

async function addPerson(owner: typeof alice, role: 'admin' | 'member', prefix: string) {
  const person = await signUpWithoutWorkspace(app, prefix);
  await withAdmin((db) => db.query('insert into memberships (workspace_id, user_id, role) values ($1, $2, $3)', [owner.workspace.id, person.user.id, role]));
  return person;
}

describe('API keys', () => {
  it('are shown once, then listed by prefix only', async () => {
    const created = await createKey(alice);
    expect(created.key).toMatch(/^whk_[A-Za-z0-9_-]{43}$/);
    expect(created.key.startsWith(created.prefix)).toBe(true);
    expect(created).toMatchObject({ name: 'Payroll sync', access: 'read', active: true, createdBy: { id: alice.user.id } });

    const list: ApiKeyDto[] = (await alice.agent.get('/api-keys').set(WORKSPACE_HEADER, alice.workspace.id).expect(200)).body;
    const listed = list.find((k) => k.id === created.id)!;
    expect(listed).toBeDefined();
    expect(JSON.stringify(list)).not.toContain(created.key);

    const stored = await withAdmin(async (db) => (await db.query('select token_hash from api_keys where id = $1', [created.id])).rows[0].token_hash as string);
    expect(stored).not.toContain(created.key);
  });

  it('can only be managed by admins', async () => {
    const member = await addPerson(alice, 'member', 'member');
    await member.agent.get('/api-keys').set(WORKSPACE_HEADER, alice.workspace.id).expect(403);
    await member.agent.post('/api-keys').set(WORKSPACE_HEADER, alice.workspace.id).send({ name: 'Mine', access: 'read' }).expect(403);
  });

  it('are refused without a key, with a wrong one, or once revoked', async () => {
    await v1('/me').expect(401);
    await v1('/me', 'whk_not-a-real-key').expect(401);
    await request(app.getHttpServer()).get('/v1/me').set('Authorization', 'Basic abc').expect(401);

    const created = await createKey(alice, 'read', 'Short-lived');
    await v1('/me', created.key).expect(200);
    await alice.agent.delete(`/api-keys/${created.id}`).set(WORKSPACE_HEADER, alice.workspace.id).expect(204);
    await v1('/me', created.key).expect(401);
    const list: ApiKeyDto[] = (await alice.agent.get('/api-keys').set(WORKSPACE_HEADER, alice.workspace.id).expect(200)).body;
    expect(list.some((k) => k.id === created.id)).toBe(false);

    const audit = await withAdmin(async (db) => (await db.query("select action from audit_logs where entity_id = $1 order by created_at", [created.id])).rows.map((r) => r.action));
    expect(audit).toEqual(['api_key.created', 'api_key.revoked']);
  });

  it('ignores a browser session: /v1 needs a key', async () => {
    await alice.agent.get('/v1/me').expect(401);
  });

  it('records when a key was last used', async () => {
    const created = await createKey(alice, 'read', 'Used');
    expect(created.lastUsedAt).toBeNull();
    await v1('/me', created.key).expect(200);
    const list: ApiKeyDto[] = (await alice.agent.get('/api-keys').set(WORKSPACE_HEADER, alice.workspace.id).expect(200)).body;
    expect(list.find((k) => k.id === created.id)!.lastUsedAt).not.toBeNull();
  });
});

describe('who a key acts as', () => {
  it('acts as its creator, in their own workspace', async () => {
    const created = await createKey(alice);
    const me = (await v1('/me', created.key).expect(200)).body;
    expect(me).toMatchObject({ workspace: { id: alice.workspace.id, name: 'Alice Agency' }, actingAs: { id: alice.user.id, role: 'owner' } });
  });

  it('stops working when its creator is no longer an admin', async () => {
    const admin = await addPerson(alice, 'admin', 'admin');
    const created = (await admin.agent.post('/api-keys').set(WORKSPACE_HEADER, alice.workspace.id).send({ name: 'Admin key', access: 'read' }).expect(201)).body as ApiKeyCreatedDto;
    await v1('/me', created.key).expect(200);

    await alice.agent.patch(`/members/${admin.user.id}`).set(WORKSPACE_HEADER, alice.workspace.id).send({ role: 'member' }).expect(200);
    const res = await v1('/me', created.key).expect(403);
    expect(res.body.message).toMatch(/no longer an admin/);
    const list: ApiKeyDto[] = (await alice.agent.get('/api-keys').set(WORKSPACE_HEADER, alice.workspace.id).expect(200)).body;
    expect(list.find((k) => k.id === created.id)!.active).toBe(false);
  });
});

describe('workspace isolation', () => {
  it("one company's key never sees another company's data", async () => {
    await alice.agent.post('/crm/leads').set(WORKSPACE_HEADER, alice.workspace.id).send({ name: 'Alice lead' }).expect(201);
    await bob.agent.post('/crm/leads').set(WORKSPACE_HEADER, bob.workspace.id).send({ name: 'Bob lead' }).expect(201);
    await alice.agent.post('/projects').set(WORKSPACE_HEADER, alice.workspace.id).send({ name: 'Alice project' }).expect(201);

    const bobKey = await createKey(bob);
    const leads = (await v1('/leads', bobKey.key).expect(200)).body.data.map((l: { name: string }) => l.name);
    expect(leads).toContain('Bob lead');
    expect(leads).not.toContain('Alice lead');
    const people = (await v1('/people', bobKey.key).expect(200)).body.data.map((p: { id: string }) => p.id);
    expect(people).toEqual([bob.user.id]);
    const projects = (await v1('/projects', bobKey.key).expect(200)).body.data.map((p: { name: string }) => p.name);
    expect(projects).not.toContain('Alice project');
  });

  it("can't revoke another workspace's key", async () => {
    const aliceKey = await createKey(alice);
    await bob.agent.delete(`/api-keys/${aliceKey.id}`).set(WORKSPACE_HEADER, bob.workspace.id).expect(404);
    await v1('/me', aliceKey.key).expect(200);
  });
});

describe('reading data', () => {
  it('pages through a list with a cursor', async () => {
    const owner = await signUp(app, 'pager', 'Pager Ltd');
    for (const name of ['One', 'Two', 'Three']) {
      await owner.agent.post('/crm/leads').set(WORKSPACE_HEADER, owner.workspace.id).send({ name }).expect(201);
    }
    const { key } = await createKey(owner);
    const first = (await v1('/leads?limit=2', key).expect(200)).body;
    expect(first.data.map((l: { name: string }) => l.name)).toEqual(['One', 'Two']);
    expect(first.nextCursor).toEqual(expect.any(String));
    const second = (await v1(`/leads?limit=2&cursor=${first.nextCursor}`, key).expect(200)).body;
    expect(second.data.map((l: { name: string }) => l.name)).toEqual(['Three']);
    expect(second.nextCursor).toBeNull();

    await v1('/leads?cursor=nonsense', key).expect(400);
    await v1('/leads?limit=500', key).expect(400);
  });

  it('returns tasks and logged time, with whether the week was approved', async () => {
    const owner = await signUp(app, 'builder', 'Builder Co');
    const ws = owner.workspace.id;
    const project = (await owner.agent.post('/projects').set(WORKSPACE_HEADER, ws).send({ name: 'Website' }).expect(201)).body;
    const board = (await owner.agent.get(`/projects/${project.id}`).set(WORKSPACE_HEADER, ws).expect(200)).body;
    const task = (await owner.agent.post(`/projects/${project.id}/tasks`).set(WORKSPACE_HEADER, ws).send({ title: 'Homepage', columnId: board.columns[0].id }).expect(201)).body;
    // Logged on the workspace's today, which may not be today in UTC: search either side of it.
    await owner.agent.post(`/tasks/${task.id}/time`).set(WORKSPACE_HEADER, ws).send({ minutes: 90 }).expect(201);
    const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
    const range = `from=${day(-2)}&to=${day(2)}`;

    const { key } = await createKey(owner);
    const tasks = (await v1(`/tasks?projectId=${project.id}`, key).expect(200)).body.data;
    expect(tasks).toEqual([expect.objectContaining({ id: task.id, title: 'Homepage', column: board.columns[0].name, completed: false, assigneeIds: [] })]);

    const time = (await v1(`/time-entries?${range}`, key).expect(200)).body.data;
    expect(time).toEqual([expect.objectContaining({ taskId: task.id, projectId: project.id, minutes: 90, approved: false })]);
    expect((await v1(`/time-entries?${range}&approved=true`, key).expect(200)).body.data).toEqual([]);

    await v1('/time-entries', key).expect(400);
    await v1('/time-entries?from=2026-01-01&to=2027-06-01', key).expect(400);
  });

  it('returns a month of attendance and the OpenAPI description', async () => {
    const { key } = await createKey(alice);
    const month = new Date().toISOString().slice(0, 7);
    const res = (await v1(`/attendance?month=${month}`, key).expect(200)).body;
    expect(res).toMatchObject({ month, data: expect.any(Array) });
    await v1('/attendance', key).expect(400);

    const doc = (await request(app.getHttpServer()).get('/v1/openapi.json').expect(200)).body;
    expect(doc.openapi).toBe('3.1.0');
    expect(Object.keys(doc.paths)).toEqual(expect.arrayContaining(['/v1/me', '/v1/people', '/v1/attendance', '/v1/invoices/{id}']));
  });
});

describe('limits', () => {
  it('each key is rate limited', async () => {
    // test/env.ts sets the limit to 20 a minute.
    const { key } = await createKey(alice, 'read', 'Busy');
    for (let i = 0; i < 20; i++) await v1('/me', key).expect(200);
    await v1('/me', key).expect(429);
    // Other keys are counted separately.
    const other = await createKey(alice, 'read', 'Quiet');
    await v1('/me', other.key).expect(200);
  });
});
