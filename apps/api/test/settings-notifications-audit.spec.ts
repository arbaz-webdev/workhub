import type { INestApplication } from '@nestjs/common';
import { WORKSPACE_HEADER } from '@workhub/shared';
import request from 'supertest';
import { createApp, PASSWORD, signUp, uniqueEmail, withAdmin } from './helpers';

let app: INestApplication;
let owner: Awaited<ReturnType<typeof signUp>>;
let ws: string;

beforeAll(async () => {
  app = await createApp();
  owner = await signUp(app, 'owner', 'Lahore Labs');
  ws = owner.workspace.id;
});

afterAll(async () => {
  await app.close();
});

async function addMemberDirect(role: string) {
  const person = await signUp(app, `p-${role}`, `Own ${role}`);
  await withAdmin((db) =>
    db.query('insert into memberships (workspace_id, user_id, role) values ($1, $2, $3)', [ws, person.user.id, role]),
  );
  return person;
}

describe('workspace settings', () => {
  it('starts with Pakistani defaults', async () => {
    const res = await owner.agent.get('/workspaces/current').set(WORKSPACE_HEADER, ws).expect(200);
    expect(res.body).toMatchObject({
      name: 'Lahore Labs',
      timezone: 'Asia/Karachi',
      currency: 'PKR',
      workingDays: [1, 2, 3, 4, 5],
      role: 'owner',
    });
  });

  it('admins update settings; days are stored in order; changes are audited', async () => {
    const res = await owner.agent
      .patch('/workspaces/current')
      .set(WORKSPACE_HEADER, ws)
      .send({ name: 'Lahore Labs Ltd', timezone: 'Asia/Dubai', currency: 'AED', workingDays: [6, 1, 2, 3, 4, 5] })
      .expect(200);
    expect(res.body).toMatchObject({ name: 'Lahore Labs Ltd', timezone: 'Asia/Dubai', currency: 'AED', workingDays: [1, 2, 3, 4, 5, 6] });

    const log = await owner.agent.get('/audit-logs').set(WORKSPACE_HEADER, ws).query({ action: 'workspace.updated' });
    expect(log.body.items[0].metadata).toMatchObject({ timezone: 'Asia/Dubai', currency: 'AED' });
  });

  it.each([
    [{ timezone: 'Mars/Olympus' }, 'timezone'],
    [{ workingDays: [] }, 'workingDays'],
    [{ workingDays: [1, 1] }, 'workingDays'],
    [{ currency: 'BTC' }, 'currency'],
    [{ name: 'x' }, 'name'],
  ])('rejects %j', async (body, path) => {
    const res = await owner.agent.patch('/workspaces/current').set(WORKSPACE_HEADER, ws).send(body).expect(400);
    expect(res.body.errors.map((e: { path: string }) => e.path)).toContain(path);
  });

  it('members can read but not change settings', async () => {
    const member = await addMemberDirect('member');
    await member.agent.get('/workspaces/current').set(WORKSPACE_HEADER, ws).expect(200);
    await member.agent.patch('/workspaces/current').set(WORKSPACE_HEADER, ws).send({ currency: 'USD' }).expect(403);
  });
});

describe('notifications', () => {
  let alice: Awaited<ReturnType<typeof addMemberDirect>>;
  let bob: Awaited<ReturnType<typeof addMemberDirect>>;

  beforeAll(async () => {
    alice = await addMemberDirect('member');
    bob = await addMemberDirect('member');
    await withAdmin(async (db) => {
      for (const [user, title] of [
        [alice.user.id, 'For Alice 1'],
        [alice.user.id, 'For Alice 2'],
        [bob.user.id, 'For Bob'],
      ]) {
        await db.query('insert into notifications (workspace_id, user_id, type, title) values ($1, $2, $3, $4)', [
          ws,
          user,
          'test',
          title,
        ]);
      }
      // A notification for Alice in her own (other) workspace must not leak in here.
      await db.query('insert into notifications (workspace_id, user_id, type, title) values ($1, $2, $3, $4)', [
        alice.workspace.id,
        alice.user.id,
        'test',
        'Elsewhere',
      ]);
    });
  });

  it('each person sees only their own, in this workspace', async () => {
    const res = await alice.agent.get('/notifications').set(WORKSPACE_HEADER, ws).expect(200);
    expect(res.body.items.map((n: { title: string }) => n.title).sort()).toEqual(['For Alice 1', 'For Alice 2']);
    expect(res.body.unreadCount).toBe(2);
  });

  it('marks one or all as read', async () => {
    const list = await alice.agent.get('/notifications').set(WORKSPACE_HEADER, ws);
    await alice.agent.post(`/notifications/${list.body.items[0].id}/read`).set(WORKSPACE_HEADER, ws).expect(204);
    expect((await alice.agent.get('/notifications').set(WORKSPACE_HEADER, ws)).body.unreadCount).toBe(1);
    await alice.agent.post('/notifications/read-all').set(WORKSPACE_HEADER, ws).expect(204);
    expect((await alice.agent.get('/notifications').set(WORKSPACE_HEADER, ws)).body.unreadCount).toBe(0);
    // Read-all in this workspace leaves the other workspace alone.
    expect((await alice.agent.get('/notifications').set(WORKSPACE_HEADER, alice.workspace.id)).body.unreadCount).toBe(1);
  });

  it("can't mark someone else's notification", async () => {
    const bobs = await bob.agent.get('/notifications').set(WORKSPACE_HEADER, ws);
    await alice.agent.post(`/notifications/${bobs.body.items[0].id}/read`).set(WORKSPACE_HEADER, ws).expect(404);
    expect((await bob.agent.get('/notifications').set(WORKSPACE_HEADER, ws)).body.unreadCount).toBe(1);
  });
});

describe('audit log', () => {
  it('is for admins and the owner only', async () => {
    const member = await addMemberDirect('member');
    await member.agent.get('/audit-logs').set(WORKSPACE_HEADER, ws).expect(403);
    const res = await owner.agent.get('/audit-logs').set(WORKSPACE_HEADER, ws).expect(200);
    expect(res.body.items.at(-1)).toMatchObject({ action: 'workspace.created', actorName: 'owner' });
  });

  it('pages through long histories without gaps or repeats', async () => {
    const pager = await signUp(app, 'pager', 'Pager Co');
    for (let i = 0; i < 59; i += 1) {
      await pager.agent.post('/teams').set(WORKSPACE_HEADER, pager.workspace.id).send({ name: `Team ${i}` }).expect(201);
    }
    const first = await pager.agent.get('/audit-logs').set(WORKSPACE_HEADER, pager.workspace.id).expect(200);
    expect(first.body.items).toHaveLength(50);
    expect(first.body.nextCursor).toBeTruthy();

    const second = await pager.agent
      .get('/audit-logs')
      .set(WORKSPACE_HEADER, pager.workspace.id)
      .query({ before: first.body.nextCursor })
      .expect(200);
    expect(second.body.items).toHaveLength(10); // 59 teams + workspace.created = 60
    expect(second.body.nextCursor).toBeNull();

    const ids = [...first.body.items, ...second.body.items].map((i: { id: string }) => i.id);
    expect(new Set(ids).size).toBe(60);
  });

  it('never shows another workspace’s entries', async () => {
    const res = await owner.agent.get('/audit-logs').set(WORKSPACE_HEADER, ws).query({ action: 'team.created' });
    expect(res.body.items.some((i: { metadata: { name?: string } }) => i.metadata.name?.startsWith('Team '))).toBe(false);
  });

  it('rejects a bad cursor', async () => {
    await owner.agent.get('/audit-logs').set(WORKSPACE_HEADER, ws).query({ before: 'nope' }).expect(400);
  });

  it('exports CSV that is safe to open in Excel', async () => {
    // A name that a spreadsheet would run as a formula.
    const sneaky = request.agent(app.getHttpServer());
    await sneaky
      .post('/auth/sign-up')
      .send({ name: '=HYPERLINK("http://evil.example")', email: uniqueEmail('formula'), password: PASSWORD, workspaceName: 'Formula Co' })
      .expect(201);
    const me = (await sneaky.get('/auth/me')).body;
    const res = await sneaky.get('/audit-logs/export').set(WORKSPACE_HEADER, me.workspaces[0].id).expect(200);

    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toContain('audit-log.csv');
    expect(res.text.charCodeAt(0)).toBe(0xfeff); // BOM so Excel reads UTF-8
    const lines = res.text.slice(1).split('\r\n');
    expect(lines[0]).toBe('"Time (UTC)","Who","Email","Action","Details","IP"');
    expect(lines[1]).toContain(`"'=HYPERLINK(""http://evil.example"")"`);
    expect(lines[1]).toContain('"Created the workspace"');
  });
});
