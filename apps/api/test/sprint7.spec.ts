import type { INestApplication } from '@nestjs/common';
import {
  WORKSPACE_HEADER,
  type AnnouncementDto,
  type AnnouncementReceiptsDto,
  type ChannelDto,
  type ChatMessageDto,
  type InboxSummaryDto,
  type MessagePageDto,
  type PresenceDto,
  type TaskRefDto,
  type ThreadDto,
} from '@workhub/shared';
import { get } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Client } from 'pg';
import request from 'supertest';
import { devOutbox } from '../src/email/email.service';
import { TEST_APP_URL } from './db-urls';
import { createApp, PASSWORD, signUp, withAdmin } from './helpers';

// The smallest thing that passes as a JPEG (selfies are checked by their bytes).
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 7)]);

let app: INestApplication;
let owner: Awaited<ReturnType<typeof signUp>>;
let manager: Awaited<ReturnType<typeof signUp>>;
let member: Awaited<ReturnType<typeof signUp>>;
let other: Awaited<ReturnType<typeof signUp>>;
let guest: Awaited<ReturnType<typeof signUp>>;
let rival: Awaited<ReturnType<typeof signUp>>;
let ws: string;
const H = () => ({ [WORKSPACE_HEADER]: ws });

async function join_(person: typeof owner, role: string) {
  await withAdmin((db) => db.query('insert into memberships (workspace_id, user_id, role) values ($1, $2, $3)', [ws, person.user.id, role]));
}

function send(agent: typeof owner.agent, channelId: string, body: string, extra: { parentId?: string; mentions?: string[]; taskIds?: string[] } = {}) {
  let req = agent.post(`/chat/channels/${channelId}/messages`).set(H()).field('body', body);
  if (extra.parentId) req = req.field('parentId', extra.parentId);
  if (extra.mentions) req = req.field('mentions', JSON.stringify(extra.mentions));
  if (extra.taskIds) req = req.field('taskIds', JSON.stringify(extra.taskIds));
  return req;
}

async function channelsOf(agent: typeof owner.agent) {
  return (await agent.get('/chat/channels').set(H()).expect(200)).body as ChannelDto[];
}

async function summaryOf(agent: typeof owner.agent) {
  return (await agent.get('/chat/summary').set(H()).expect(200)).body as InboxSummaryDto;
}

async function notificationTitles(agent: typeof owner.agent) {
  return (await agent.get('/notifications').set(H()).expect(200)).body.items.map((n: { title: string }) => n.title) as string[];
}

beforeAll(async () => {
  app = await createApp();
  owner = await signUp(app, 'owner', 'Chatty Co');
  ws = owner.workspace.id;
  manager = await signUp(app, 'manager', 'M home');
  member = await signUp(app, 'member', 'Mem home');
  other = await signUp(app, 'other', 'O home');
  guest = await signUp(app, 'guest', 'G home');
  rival = await signUp(app, 'rival', 'Rival Co');
  await join_(manager, 'manager');
  await join_(member, 'member');
  await join_(other, 'member');
  await join_(guest, 'guest');
});

afterAll(async () => {
  await app.close();
});

describe('channels', () => {
  it('puts everyone but guests in #general', async () => {
    const mine = await channelsOf(member.agent);
    expect(mine).toEqual([expect.objectContaining({ name: 'general', kind: 'public', isDefault: true, joined: true })]);
    await channelsOf(owner.agent);
    await channelsOf(other.agent);
    expect(await channelsOf(guest.agent)).toEqual([]);
    await member.agent.post(`/chat/channels/${mine[0]!.id}/leave`).set(H()).expect(400);
    await rival.agent.get('/chat/channels').set(H()).expect(403);
  });

  it('creates public channels others can find and join, with tidy unique names', async () => {
    const created = await member.agent.post('/chat/channels').set(H()).send({ name: '  Sales Team ', topic: 'Leads and deals' }).expect(201);
    expect(created.body).toMatchObject({ name: 'sales-team', kind: 'public', joined: true, memberCount: 1, topic: 'Leads and deals' });
    await other.agent.post('/chat/channels').set(H()).send({ name: 'SALES-team' }).expect(409);
    await other.agent.post('/chat/channels').set(H()).send({ name: 'bad name!' }).expect(400);
    await guest.agent.post('/chat/channels').set(H()).send({ name: 'guests' }).expect(403);

    const browse = (await other.agent.get('/chat/channels/browse').set(H()).expect(200)).body as ChannelDto[];
    expect(browse.find((c) => c.name === 'sales-team')).toMatchObject({ joined: false });
    // Non-members can read a public channel before joining, but not post in it.
    await send(other.agent, created.body.id, 'hi').expect(403);
    await other.agent.get(`/chat/channels/${created.body.id}/messages`).set(H()).expect(200);
    const joined = await other.agent.post(`/chat/channels/${created.body.id}/join`).set(H()).expect(201);
    expect(joined.body).toMatchObject({ joined: true, memberCount: 2 });
    await other.agent.post(`/chat/channels/${created.body.id}/leave`).set(H()).expect(204);
  });

  it('keeps private channels invisible to everyone outside them, admins included', async () => {
    const secret = (await manager.agent.post('/chat/channels').set(H()).send({ name: 'hiring', private: true, memberIds: [member.user.id, rival.user.id] }).expect(201)).body as ChannelDto;
    // People outside the workspace are quietly left out.
    expect(secret).toMatchObject({ kind: 'private', memberCount: 2 });
    await send(manager.agent, secret.id, 'Shortlist attached').expect(201);

    for (const outsider of [owner, other]) {
      expect((await channelsOf(outsider.agent)).some((c) => c.id === secret.id)).toBe(false);
      await outsider.agent.get(`/chat/channels/${secret.id}/messages`).set(H()).expect(404);
      await outsider.agent.post(`/chat/channels/${secret.id}/join`).set(H()).expect(404);
    }
    expect((await member.agent.get(`/chat/channels/${secret.id}/messages`).set(H()).expect(200)).body.messages).toHaveLength(1);
    // A name taken by a private channel is still taken.
    await owner.agent.post('/chat/channels').set(H()).send({ name: 'Hiring' }).expect(409);
  });

  it('enforces private messages in the database itself, not just the API', async () => {
    const secret = (await channelsOf(member.agent)).find((c) => c.name === 'hiring')!;
    const db = new Client({ connectionString: TEST_APP_URL });
    await db.connect();
    const count = async (userId: string) => {
      await db.query('begin');
      try {
        await db.query(`select set_config('app.workspace_id', $1, true), set_config('app.user_id', $2, true)`, [ws, userId]);
        const messages = await db.query('select id from chat_messages where channel_id = $1', [secret.id]);
        const channels = await db.query('select id from chat_channels where id = $1', [secret.id]);
        return messages.rowCount! + channels.rowCount!;
      } finally {
        await db.query('rollback');
      }
    };
    try {
      expect(await count(member.user.id)).toBe(2);
      expect(await count(owner.user.id)).toBe(0);
      // Nor can an outsider write into it.
      await db.query('begin');
      await db.query(`select set_config('app.workspace_id', $1, true), set_config('app.user_id', $2, true)`, [ws, owner.user.id]);
      await expect(db.query(`insert into chat_messages (workspace_id, channel_id, author_id, body) values ($1, $2, $3, 'sneaky')`, [ws, secret.id, owner.user.id])).rejects.toThrow(/row-level security/);
      await db.query('rollback');
    } finally {
      await db.end();
    }
  });

  it('lets the creator or an admin archive a channel, which makes it read-only', async () => {
    const c = (await member.agent.post('/chat/channels').set(H()).send({ name: 'old-project' }).expect(201)).body as ChannelDto;
    await other.agent.post(`/chat/channels/${c.id}/archive`).set(H()).expect(403);
    await member.agent.post(`/chat/channels/${c.id}/archive`).set(H()).expect(204);
    await send(member.agent, c.id, 'still here?').expect(409);
    expect((await channelsOf(member.agent)).some((x) => x.id === c.id)).toBe(false);
    const general = (await channelsOf(member.agent)).find((x) => x.isDefault)!;
    await owner.agent.post(`/chat/channels/${general.id}/archive`).set(H()).expect(400);
  });
});

describe('direct messages', () => {
  it('opens one conversation per set of people, from either side', async () => {
    const a = (await member.agent.post('/chat/dm').set(H()).send({ userIds: [other.user.id] }).expect(201)).body as ChannelDto;
    const b = (await other.agent.post('/chat/dm').set(H()).send({ userIds: [member.user.id] }).expect(201)).body as ChannelDto;
    expect(b.id).toBe(a.id);
    expect(a).toMatchObject({ kind: 'dm', name: null, people: [expect.objectContaining({ id: other.user.id })] });
    const group = (await member.agent.post('/chat/dm').set(H()).send({ userIds: [other.user.id, manager.user.id] }).expect(201)).body as ChannelDto;
    expect(group.id).not.toBe(a.id);
    expect(group.people).toHaveLength(2);
    await member.agent.post('/chat/dm').set(H()).send({ userIds: [rival.user.id] }).expect(400);
    await guest.agent.post('/chat/dm').set(H()).send({ userIds: [member.user.id] }).expect(403);
  });

  it('hides DMs from the owner and doesn’t let admins delete in them', async () => {
    const dm = (await member.agent.post('/chat/dm').set(H()).send({ userIds: [other.user.id] }).expect(201)).body as ChannelDto;
    const msg = (await send(member.agent, dm.id, 'Just between us').expect(201)).body as ChatMessageDto;
    await owner.agent.get(`/chat/channels/${dm.id}/messages`).set(H()).expect(404);
    await owner.agent.get(`/chat/messages/${msg.id}/thread`).set(H()).expect(404);
    await owner.agent.delete(`/chat/messages/${msg.id}`).set(H()).expect(404);
    await owner.agent.post(`/chat/channels/${dm.id}/leave`).set(H()).expect(404);
  });
});

describe('messages', () => {
  let general: ChannelDto;
  beforeAll(async () => {
    general = (await channelsOf(member.agent)).find((c) => c.isDefault)!;
  });

  it('counts unread messages until you read them, but not your own', async () => {
    await other.agent.post(`/chat/channels/${general.id}/read`).set(H()).expect(204);
    const before = (await summaryOf(other.agent)).unread;
    await send(member.agent, general.id, 'Morning all').expect(201);
    await send(member.agent, general.id, 'Standup in 5').expect(201);
    expect((await summaryOf(other.agent)).unread).toBe(before + 2);
    expect((await channelsOf(member.agent)).find((c) => c.id === general.id)!.unread).toBe(0);
    await other.agent.post(`/chat/channels/${general.id}/read`).set(H()).expect(204);
    expect((await summaryOf(other.agent)).unread).toBe(before);

    // Muted channels don't add to the badge.
    await other.agent.post(`/chat/channels/${general.id}/mute`).set(H()).send({ muted: true }).expect(201);
    await send(member.agent, general.id, 'One more').expect(201);
    expect((await summaryOf(other.agent)).unread).toBe(before);
    await other.agent.post(`/chat/channels/${general.id}/mute`).set(H()).send({ muted: false }).expect(201);
  });

  it('pages through history, newest page last-in-order', async () => {
    const c = (await member.agent.post('/chat/channels').set(H()).send({ name: 'history' }).expect(201)).body as ChannelDto;
    for (let i = 1; i <= 55; i++) await send(member.agent, c.id, `m${i}`).expect(201);
    const first = (await member.agent.get(`/chat/channels/${c.id}/messages`).set(H()).expect(200)).body as MessagePageDto;
    expect(first.hasMore).toBe(true);
    expect(first.messages).toHaveLength(50);
    expect(first.messages.at(-1)!.body).toBe('m55');
    const older = (await member.agent.get(`/chat/channels/${c.id}/messages`).query({ before: first.messages[0]!.createdAt }).set(H()).expect(200)).body as MessagePageDto;
    expect(older.messages.map((m) => m.body)).toEqual(['m1', 'm2', 'm3', 'm4', 'm5']);
    expect(older.hasMore).toBe(false);
    await member.agent.get(`/chat/channels/${c.id}/messages`).query({ before: 'yesterday' }).set(H()).expect(400);
  });

  it('notifies people @mentioned, if they can read the channel', async () => {
    const msg = (await send(member.agent, general.id, '@Other can you check?', { mentions: [other.user.id, guest.user.id, rival.user.id] }).expect(201)).body as ChatMessageDto;
    expect(msg.mentions).toEqual([other.user.id]);
    expect(await notificationTitles(other.agent)).toContain(`member mentioned you in #general`);
    expect((await summaryOf(other.agent)).mentions).toBeGreaterThan(0);
    expect(await notificationTitles(guest.agent)).toEqual([]);
  });

  it('threads replies under a message and tells its author', async () => {
    const root = (await send(member.agent, general.id, 'Who has the client deck?').expect(201)).body as ChatMessageDto;
    const reply = (await send(other.agent, general.id, 'I do', { parentId: root.id }).expect(201)).body as ChatMessageDto;
    expect(reply.parentId).toBe(root.id);
    const thread = (await member.agent.get(`/chat/messages/${reply.id}/thread`).set(H()).expect(200)).body as ThreadDto;
    expect(thread.root).toMatchObject({ id: root.id, replyCount: 1 });
    expect(thread.replies.map((r) => r.body)).toEqual(['I do']);
    expect(await notificationTitles(member.agent)).toContain(`other replied to your message in #general`);
    // Replies stay in the thread, not the channel; and threads don't nest.
    const page = (await member.agent.get(`/chat/channels/${general.id}/messages`).set(H()).expect(200)).body as MessagePageDto;
    expect(page.messages.some((m) => m.id === reply.id)).toBe(false);
    await send(member.agent, general.id, 'nested', { parentId: reply.id }).expect(400);
  });

  it('lets authors edit, and authors or admins delete, leaving a placeholder', async () => {
    const msg = (await send(member.agent, general.id, 'Typo hree').expect(201)).body as ChatMessageDto;
    await other.agent.patch(`/chat/messages/${msg.id}`).set(H()).send({ body: 'hacked' }).expect(403);
    const edited = await member.agent.patch(`/chat/messages/${msg.id}`).set(H()).send({ body: 'Typo here' }).expect(200);
    expect(edited.body).toMatchObject({ body: 'Typo here', editedAt: expect.any(String) });
    await other.agent.delete(`/chat/messages/${msg.id}`).set(H()).expect(403);
    await owner.agent.delete(`/chat/messages/${msg.id}`).set(H()).expect(204);
    const thread = (await member.agent.get(`/chat/messages/${msg.id}/thread`).set(H()).expect(200)).body as ThreadDto;
    expect(thread.root).toMatchObject({ deleted: true, body: '' });
    await member.agent.patch(`/chat/messages/${msg.id}`).set(H()).send({ body: 'back' }).expect(409);
  });

  it('shares files that only the conversation’s readers can download', async () => {
    await member.agent.post(`/chat/channels/${general.id}/messages`).set(H()).field('body', '').expect(400);
    const dm = (await member.agent.post('/chat/dm').set(H()).send({ userIds: [other.user.id] }).expect(201)).body as ChannelDto;
    const res = await member.agent
      .post(`/chat/channels/${dm.id}/messages`)
      .set(H())
      .field('body', '')
      .attach('files', Buffer.from('quarterly numbers'), { filename: 'رپورٹ.csv', contentType: 'text/csv' })
      .attach('files', JPEG, { filename: 'photo.jpg', contentType: 'image/jpeg' })
      .expect(201);
    const msg = res.body as ChatMessageDto;
    expect(msg.files.map((f) => [f.fileName, f.isImage])).toEqual([
      ['رپورٹ.csv', false],
      ['photo.jpg', true],
    ]);
    const csv = await other.agent
      .get(msg.files[0]!.url)
      .buffer(true)
      .parse((res, done) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => done(null, Buffer.concat(chunks)));
      })
      .expect(200);
    expect(csv.headers['content-disposition']).toMatch(/^attachment/);
    expect(csv.headers['content-type']).toBe('application/octet-stream'); // never rendered by the browser
    expect((csv.body as Buffer).toString()).toBe('quarterly numbers');
    await owner.agent.get(msg.files[0]!.url).expect(404);
    await rival.agent.get(msg.files[0]!.url).expect(403);

    await member.agent.delete(`/chat/messages/${msg.id}`).set(H()).expect(204);
    await other.agent.get(msg.files[0]!.url).expect(404);
  });

  it('shows tasks as cards, only to people who can see them', async () => {
    const project = (await owner.agent.post('/projects').set(H()).send({ name: 'Website' }).expect(201)).body as { id: string };
    const task = (await owner.agent.post(`/projects/${project.id}/tasks`).set(H()).send({ title: 'Fix the header' }).expect(201)).body as { id: string };
    const msg = (await send(member.agent, general.id, `Look at http://localhost:3000/app/projects/${project.id}?task=${task.id}`).expect(201)).body as ChatMessageDto;
    expect(msg.taskIds).toEqual([task.id]);
    const cards = (await other.agent.get('/chat/task-refs').query({ ids: task.id }).set(H()).expect(200)).body as TaskRefDto[];
    expect(cards).toEqual([expect.objectContaining({ title: 'Fix the header', projectName: 'Website', completed: false })]);
    // A guest who isn't on the project gets nothing back.
    expect((await guest.agent.get('/chat/task-refs').query({ ids: task.id }).set(H()).expect(200)).body).toEqual([]);
    const found = (await member.agent.get('/chat/tasks').query({ q: 'header' }).set(H()).expect(200)).body as TaskRefDto[];
    expect(found.map((t) => t.id)).toContain(task.id);
  });

  it('delivers a message to the other person within half a second', async () => {
    const dm = (await member.agent.post('/chat/dm').set(H()).send({ userIds: [other.user.id] }).expect(201)).body as ChannelDto;
    const server = app.getHttpServer();
    if (!server.listening) await new Promise<void>((r) => server.listen(0, r));
    const { port } = server.address() as AddressInfo;
    const signIn = await request(server).post('/auth/sign-in').send({ email: other.email, password: PASSWORD }).expect(200);
    const cookie = (signIn.headers['set-cookie'] as unknown as string[]).map((c) => c.split(';')[0]).join('; ');

    let sentAt = 0;
    const received = new Promise<ChatMessageDto>((resolve, reject) => {
      const req = get({ port, path: `/chat/events?workspace=${ws}`, headers: { cookie, accept: 'text/event-stream' } }, (res) => {
        expect(res.statusCode).toBe(200);
        let buffer = '';
        let opened = false;
        res.on('data', (chunk) => {
          if (!opened) {
            opened = true;
            sentAt = Date.now();
            void send(member.agent, dm.id, 'ping').then(() => undefined);
          }
          buffer += chunk.toString();
          const blocks = buffer.split('\n\n');
          buffer = blocks.pop() ?? '';
          for (const block of blocks) {
            const line = block.split('\n').find((l) => l.startsWith('data: '));
            if (!line || line === 'data: ') continue;
            const event = JSON.parse(line.slice(6));
            if (event.type === 'message.created' && event.message.channelId === dm.id) {
              req.destroy();
              resolve(event.message);
            }
          }
        });
      });
      req.on('error', (e) => (e.message.includes('socket hang up') ? undefined : reject(e)));
    });
    const message = await received;
    expect(Date.now() - sentAt).toBeLessThan(500);
    expect(message).toMatchObject({ body: 'ping', author: expect.objectContaining({ id: member.user.id }) });
  });
});

describe('presence', () => {
  it('follows attendance: in, on a break, out', async () => {
    const presence = async () => ((await member.agent.get('/chat/presence').set(H()).expect(200)).body as PresenceDto[]).find((p) => p.userId === other.user.id)!.presence;
    expect(await presence()).toBe('away');
    const punch = (type: string, fields: Record<string, string> = {}) => {
      let req = other.agent.post('/attendance/events').set(H()).field('type', type);
      for (const [k, v] of Object.entries(fields)) req = req.field(k, v);
      return req.attach('selfie', JPEG, { filename: 'me.jpg', contentType: 'image/jpeg' }).expect(200);
    };
    await punch('check_in');
    expect(await presence()).toBe('in');
    await other.agent.post('/attendance/events').set(H()).field('type', 'break_start').field('breakName', 'Break').expect(200);
    expect(await presence()).toBe('break');
    await other.agent.post('/attendance/events').set(H()).field('type', 'break_end').expect(200);
    await punch('check_out');
    expect(await presence()).toBe('out');
    await guest.agent.get('/chat/presence').set(H()).expect(403);
  });
});

describe('announcements', () => {
  it('goes to everyone, with read receipts for its author and managers', async () => {
    await member.agent.post('/announcements').set(H()).send({ title: 'Hi', body: 'x' }).expect(403);
    const a = (await manager.agent.post('/announcements').set(H()).send({ title: 'Office closed Friday', body: 'For the Kashmir Day holiday.', pinned: true }).expect(201)).body as AnnouncementDto;
    // Everyone but its author and guests: owner, member, other.
    expect(a.receipts).toEqual({ read: 0, total: 3 });
    expect(await notificationTitles(member.agent)).toContain(`manager: Office closed Friday`);
    expect((await summaryOf(member.agent)).announcements).toBe(1);

    const seen = (await member.agent.get('/announcements').set(H()).expect(200)).body as AnnouncementDto[];
    expect(seen[0]).toMatchObject({ id: a.id, read: false, receipts: null, pinned: true });
    await member.agent.get(`/announcements/${a.id}/receipts`).set(H()).expect(403);
    await member.agent.post(`/announcements/${a.id}/read`).set(H()).expect(204);
    await member.agent.post(`/announcements/${a.id}/read`).set(H()).expect(204);
    expect((await summaryOf(member.agent)).announcements).toBe(0);

    const receipts = (await manager.agent.get(`/announcements/${a.id}/receipts`).set(H()).expect(200)).body as AnnouncementReceiptsDto;
    expect(receipts.read.map((r) => r.person.id)).toEqual([member.user.id]);
    expect(receipts.unread.map((p) => p.id).sort()).toEqual([owner.user.id, other.user.id].sort());
    await guest.agent.get('/announcements').set(H()).expect(403);
  });

  it('can go to one team only', async () => {
    const team = (await owner.agent.post('/teams').set(H()).send({ name: 'Sales' }).expect(201)).body as { id: string };
    await withAdmin((db) => db.query('update memberships set team_id = $1 where workspace_id = $2 and user_id = $3', [team.id, ws, member.user.id]));
    const a = (await manager.agent.post('/announcements').set(H()).send({ title: 'Sales targets', body: 'Q3 numbers', teamId: team.id }).expect(201)).body as AnnouncementDto;
    expect(a.receipts).toEqual({ read: 0, total: 1 });
    expect(((await member.agent.get('/announcements').set(H()).expect(200)).body as AnnouncementDto[]).some((x) => x.id === a.id)).toBe(true);
    expect(((await other.agent.get('/announcements').set(H()).expect(200)).body as AnnouncementDto[]).some((x) => x.id === a.id)).toBe(false);
    await other.agent.post(`/announcements/${a.id}/read`).set(H()).expect(404);
    // The owner sees it (managers see everything) but it isn't addressed to them.
    expect(((await owner.agent.get('/announcements').set(H()).expect(200)).body as AnnouncementDto[]).find((x) => x.id === a.id)).toMatchObject({ read: true });
    await member.agent.delete(`/announcements/${a.id}`).set(H()).expect(404);
    await manager.agent.delete(`/announcements/${a.id}`).set(H()).expect(204);
  });
});

describe('feedback', () => {
  it('is saved for the team and emailed when FEEDBACK_TO is set', async () => {
    process.env.FEEDBACK_TO = 'founders@example.com';
    try {
      await guest.agent.post('/feedback').set(H()).send({ kind: 'idea', message: 'Dark mode please', page: '/app/inbox' }).expect(204);
      await guest.agent.post('/feedback').set(H()).send({ kind: 'rant', message: 'x' }).expect(400);
    } finally {
      delete process.env.FEEDBACK_TO;
    }
    const mail = devOutbox.filter((m) => m.to === 'founders@example.com').at(-1)!;
    expect(mail.subject).toBe(`[WorkHub feedback] Idea from guest`);
    expect(mail.text).toContain('Dark mode please');
    const { rows } = await withAdmin((db) => db.query('select kind, message, page from feedback where user_id = $1', [guest.user.id]));
    expect(rows).toEqual([{ kind: 'idea', message: 'Dark mode please', page: '/app/inbox' }]);
  });
});
