// API-level proof that one company can never reach another company's data.
import type { INestApplication } from '@nestjs/common';
import { WORKSPACE_HEADER } from '@workhub/shared';
import { createApp, signUp, withAdmin } from './helpers';

let app: INestApplication;
let alice: Awaited<ReturnType<typeof signUp>>;
let bob: Awaited<ReturnType<typeof signUp>>;

beforeAll(async () => {
  app = await createApp();
  alice = await signUp(app, 'alice', 'Alice Agency');
  bob = await signUp(app, 'bob', 'Bob BPO');

  await alice.agent.post('/teams').set(WORKSPACE_HEADER, alice.workspace.id).send({ name: 'Design' }).expect(201);
  await bob.agent.post('/teams').set(WORKSPACE_HEADER, bob.workspace.id).send({ name: 'Sales' }).expect(201);
});

afterAll(async () => {
  await app.close();
});

async function teamNames(agent: typeof alice.agent, workspaceId: string) {
  const res = await agent.get('/teams').set(WORKSPACE_HEADER, workspaceId).expect(200);
  return res.body.map((t: { name: string }) => t.name);
}

describe('workspace isolation', () => {
  it('each company sees only its own teams', async () => {
    expect(await teamNames(alice.agent, alice.workspace.id)).toEqual(['Design']);
    expect(await teamNames(bob.agent, bob.workspace.id)).toEqual(['Sales']);
  });

  it("refuses access to a workspace the user doesn't belong to", async () => {
    await alice.agent.get('/teams').set(WORKSPACE_HEADER, bob.workspace.id).expect(403);
    await alice.agent.get('/workspaces/current').set(WORKSPACE_HEADER, bob.workspace.id).expect(403);
    await alice.agent.post('/teams').set(WORKSPACE_HEADER, bob.workspace.id).send({ name: 'Hijack' }).expect(403);
  });

  it('requires a valid workspace header', async () => {
    await alice.agent.get('/teams').expect(400);
    await alice.agent.get('/teams').set(WORKSPACE_HEADER, 'not-a-uuid').expect(400);
  });

  it('returns the current workspace with the caller’s role', async () => {
    const res = await alice.agent.get('/workspaces/current').set(WORKSPACE_HEADER, alice.workspace.id).expect(200);
    expect(res.body).toMatchObject({ id: alice.workspace.id, name: 'Alice Agency', role: 'owner' });
  });
});

describe('a user in two workspaces', () => {
  beforeAll(async () => {
    // Alice joins Bob's workspace as an ordinary member.
    await withAdmin((db) =>
      db.query(`insert into memberships (workspace_id, user_id, role) values ($1, $2, 'member')`, [
        bob.workspace.id,
        alice.user.id,
      ]),
    );
  });

  it('sees each workspace separately, never mixed', async () => {
    expect(await teamNames(alice.agent, bob.workspace.id)).toEqual(['Sales']);
    expect(await teamNames(alice.agent, alice.workspace.id)).toEqual(['Design']);
  });

  it('gets the role of the workspace in the header, not her highest role elsewhere', async () => {
    const res = await alice.agent.get('/workspaces/current').set(WORKSPACE_HEADER, bob.workspace.id).expect(200);
    expect(res.body.role).toBe('member');
    // Owner in her own workspace, but only a member here: creating teams needs manager.
    await alice.agent.post('/teams').set(WORKSPACE_HEADER, bob.workspace.id).send({ name: 'Nope' }).expect(403);
  });

  it('lists both workspaces in /auth/me', async () => {
    const res = await alice.agent.get('/auth/me').expect(200);
    const names = res.body.workspaces.map((w: { name: string }) => w.name).sort();
    expect(names).toEqual(['Alice Agency', 'Bob BPO']);
  });

  it('writes an audit entry for each team created, in the right workspace', async () => {
    const rows = await withAdmin(async (db) => {
      const { rows } = await db.query(
        `select workspace_id, action, metadata->>'name' as name from audit_logs where action = 'team.created' and workspace_id = any($1) order by created_at`,
        [[alice.workspace.id, bob.workspace.id]],
      );
      return rows;
    });
    expect(rows).toEqual([
      { workspace_id: alice.workspace.id, action: 'team.created', name: 'Design' },
      { workspace_id: bob.workspace.id, action: 'team.created', name: 'Sales' },
    ]);
  });
});
