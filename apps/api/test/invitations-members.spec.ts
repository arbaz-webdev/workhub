import type { INestApplication } from '@nestjs/common';
import { WORKSPACE_HEADER } from '@workhub/shared';
import request from 'supertest';
import {
  createApp,
  inviteTokenFrom,
  lastEmailTo,
  signUp,
  signUpWithoutWorkspace,
  uniqueEmail,
  withAdmin,
} from './helpers';

let app: INestApplication;
let owner: Awaited<ReturnType<typeof signUp>>;
let ws: string;

beforeAll(async () => {
  app = await createApp();
  owner = await signUp(app, 'owner', 'Acme Studio');
  ws = owner.workspace.id;
});

afterAll(async () => {
  await app.close();
});

/** Invites `email` as `role` from `agent` and returns the token from the email. */
async function invite(agent: typeof owner.agent, email: string, role = 'member', workspaceId = ws) {
  const res = await agent.post('/invitations').set(WORKSPACE_HEADER, workspaceId).send({ emails: [email], role }).expect(201);
  expect(res.body.invited).toHaveLength(1);
  return inviteTokenFrom(lastEmailTo(email)?.text);
}

/** Creates a user and makes them a member of `ws` with `role` through a real invitation. */
async function addMember(prefix: string, role: string) {
  const email = uniqueEmail(prefix);
  const token = await invite(owner.agent, email, role);
  const person = await signUpWithoutWorkspace(app, prefix, email);
  await person.agent.post('/invitations/accept').send({ token }).expect(201);
  return person;
}

describe('email invitations', () => {
  it('invite → preview → sign up without a workspace → accept', async () => {
    const email = uniqueEmail('newhire');
    const token = await invite(owner.agent, email, 'member');
    expect(lastEmailTo(email)?.subject).toContain('invited you to Acme Studio');

    const preview = await request(app.getHttpServer()).get('/invitations/preview').query({ token }).expect(200);
    expect(preview.body).toEqual({ workspaceName: 'Acme Studio', inviterName: 'owner', role: 'member', email });

    const person = await signUpWithoutWorkspace(app, 'newhire', email);
    expect((await person.agent.get('/auth/me')).body.workspaces).toEqual([]);

    const joined = await person.agent.post('/invitations/accept').send({ token }).expect(201);
    expect(joined.body).toMatchObject({ id: ws, name: 'Acme Studio', role: 'member' });
    expect((await person.agent.get('/auth/me')).body.workspaces).toHaveLength(1);

    // Used up: neither preview nor accept work again.
    await request(app.getHttpServer()).get('/invitations/preview').query({ token }).expect(404);
    await person.agent.post('/invitations/accept').send({ token }).expect(404);
  });

  it('only the invited address can accept', async () => {
    const token = await invite(owner.agent, uniqueEmail('intended'));
    const stranger = await signUpWithoutWorkspace(app, 'stranger');
    const res = await stranger.agent.post('/invitations/accept').send({ token }).expect(403);
    expect(res.body.message).toContain('Sign in with that email address');
  });

  it('notifies the owner when someone joins', async () => {
    const person = await addMember('joiner', 'member');
    const me = (await person.agent.get('/auth/me')).body.user;
    const res = await owner.agent.get('/notifications').set(WORKSPACE_HEADER, ws).expect(200);
    expect(res.body.items.map((n: { title: string }) => n.title)).toContain(`${me.name} joined Acme Studio`);
  });

  it('skips people who are already members', async () => {
    const res = await owner.agent
      .post('/invitations')
      .set(WORKSPACE_HEADER, ws)
      .send({ emails: [owner.email, uniqueEmail('fresh')], role: 'member' })
      .expect(201);
    expect(res.body.skipped).toEqual([{ email: owner.email, reason: 'Already a member' }]);
    expect(res.body.invited).toHaveLength(1);
  });

  it('re-inviting the same address cancels the earlier link', async () => {
    const email = uniqueEmail('twice');
    const first = await invite(owner.agent, email);
    const second = await invite(owner.agent, email);
    await request(app.getHttpServer()).get('/invitations/preview').query({ token: first }).expect(404);
    await request(app.getHttpServer()).get('/invitations/preview').query({ token: second }).expect(200);
  });

  it('rejects expired invitations', async () => {
    const email = uniqueEmail('late');
    const token = await invite(owner.agent, email);
    await withAdmin((db) => db.query(`update invitations set expires_at = now() - interval '1 second' where email = $1`, [email]));
    const person = await signUpWithoutWorkspace(app, 'late', email);
    await person.agent.post('/invitations/accept').send({ token }).expect(404);
  });

  it('lists and revokes pending invitations', async () => {
    const email = uniqueEmail('revokeme');
    const token = await invite(owner.agent, email);
    const list = await owner.agent.get('/invitations').set(WORKSPACE_HEADER, ws).expect(200);
    const inv = list.body.find((i: { email: string }) => i.email === email);
    expect(inv).toMatchObject({ kind: 'email', role: 'member', invitedByName: 'owner' });

    await owner.agent.delete(`/invitations/${inv.id}`).set(WORKSPACE_HEADER, ws).expect(204);
    await request(app.getHttpServer()).get('/invitations/preview').query({ token }).expect(404);
  });

  it('accepting requires a session', async () => {
    await request(app.getHttpServer()).post('/invitations/accept').send({ token: 'x'.repeat(43) }).expect(401);
  });
});

describe('invite links', () => {
  it('can be used by several people until revoked', async () => {
    const res = await owner.agent.post('/invitations/link').set(WORKSPACE_HEADER, ws).send({ role: 'guest' }).expect(201);
    const token = inviteTokenFrom(res.body.url);

    for (const prefix of ['guestA', 'guestB']) {
      const p = await signUpWithoutWorkspace(app, prefix);
      const joined = await p.agent.post('/invitations/accept').send({ token }).expect(201);
      expect(joined.body.role).toBe('guest');
    }

    await owner.agent.delete(`/invitations/${res.body.invitation.id}`).set(WORKSPACE_HEADER, ws).expect(204);
    const late = await signUpWithoutWorkspace(app, 'guestC');
    await late.agent.post('/invitations/accept').send({ token }).expect(404);
  });

  it('cannot hand out admin', async () => {
    await owner.agent.post('/invitations/link').set(WORKSPACE_HEADER, ws).send({ role: 'admin' }).expect(400);
  });
});

describe('who may invite', () => {
  let admin: Awaited<ReturnType<typeof addMember>>;
  let member: Awaited<ReturnType<typeof addMember>>;

  beforeAll(async () => {
    admin = await addMember('admin', 'admin');
    member = await addMember('member', 'member');
  });

  it('members cannot invite', async () => {
    await member.agent
      .post('/invitations')
      .set(WORKSPACE_HEADER, ws)
      .send({ emails: [uniqueEmail('x')], role: 'member' })
      .expect(403);
  });

  it('admins can invite, but only the owner can invite admins', async () => {
    await admin.agent
      .post('/invitations')
      .set(WORKSPACE_HEADER, ws)
      .send({ emails: [uniqueEmail('byadmin')], role: 'manager' })
      .expect(201);
    await admin.agent
      .post('/invitations')
      .set(WORKSPACE_HEADER, ws)
      .send({ emails: [uniqueEmail('newadmin')], role: 'admin' })
      .expect(403);
  });

  it("another company can't see or cancel our invitations", async () => {
    const other = await signUp(app, 'rival', 'Rival Co');
    const email = uniqueEmail('ours');
    await invite(owner.agent, email);
    const ours = (await owner.agent.get('/invitations').set(WORKSPACE_HEADER, ws)).body.find(
      (i: { email: string }) => i.email === email,
    );

    const theirs = await other.agent.get('/invitations').set(WORKSPACE_HEADER, other.workspace.id).expect(200);
    expect(theirs.body).toEqual([]);
    await other.agent.delete(`/invitations/${ours.id}`).set(WORKSPACE_HEADER, other.workspace.id).expect(404);
    await other.agent.get('/invitations').set(WORKSPACE_HEADER, ws).expect(403);
  });
});

describe('managing members', () => {
  let admin: Awaited<ReturnType<typeof addMember>>;
  let member: Awaited<ReturnType<typeof addMember>>;
  let adminId: string;
  let memberId: string;

  beforeAll(async () => {
    admin = await addMember('admin2', 'admin');
    member = await addMember('member2', 'member');
    adminId = (await admin.agent.get('/auth/me')).body.user.id;
    memberId = (await member.agent.get('/auth/me')).body.user.id;
  });

  it('lists everyone with their role', async () => {
    const res = await member.agent.get('/members').set(WORKSPACE_HEADER, ws).expect(200);
    const roles = Object.fromEntries(res.body.map((m: { userId: string; role: string }) => [m.userId, m.role]));
    expect(roles[owner.user.id]).toBe('owner');
    expect(roles[adminId]).toBe('admin');
    expect(roles[memberId]).toBe('member');
  });

  it('admins change roles; the member is notified and it is audited', async () => {
    await admin.agent.patch(`/members/${memberId}`).set(WORKSPACE_HEADER, ws).send({ role: 'manager' }).expect(200);
    const notes = await member.agent.get('/notifications').set(WORKSPACE_HEADER, ws).expect(200);
    expect(notes.body.items[0].title).toBe('Your role in Acme Studio is now manager');

    const log = await owner.agent.get('/audit-logs').set(WORKSPACE_HEADER, ws).query({ action: 'member.role_changed' });
    expect(log.body.items[0]).toMatchObject({ entityId: memberId, metadata: { from: 'member', to: 'manager' } });
  });

  it('protects the owner, the actor themself, and admin promotions', async () => {
    await admin.agent.patch(`/members/${owner.user.id}`).set(WORKSPACE_HEADER, ws).send({ role: 'member' }).expect(403);
    await admin.agent.patch(`/members/${adminId}`).set(WORKSPACE_HEADER, ws).send({ role: 'member' }).expect(403);
    await admin.agent.patch(`/members/${memberId}`).set(WORKSPACE_HEADER, ws).send({ role: 'admin' }).expect(403);
    await admin.agent.patch(`/members/${memberId}`).set(WORKSPACE_HEADER, ws).send({ role: 'owner' }).expect(400);
    await member.agent.patch(`/members/${adminId}`).set(WORKSPACE_HEADER, ws).send({ role: 'guest' }).expect(403);
  });

  it('only the owner can remove an admin; removed people lose access', async () => {
    await admin.agent.delete(`/members/${adminId}`).set(WORKSPACE_HEADER, ws).expect(403);
    await owner.agent.delete(`/members/${adminId}`).set(WORKSPACE_HEADER, ws).expect(204);
    await admin.agent.get('/teams').set(WORKSPACE_HEADER, ws).expect(403);
    expect((await admin.agent.get('/auth/me')).body.workspaces).toEqual([]);
  });
});
