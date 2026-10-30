// Webhooks: managing them, events queued with the change that caused them, signed delivery,
// retries and pausing, test pings, isolation between workspaces, and address safety.
import type { INestApplication } from '@nestjs/common';
import { WORKSPACE_HEADER, type WebhookCreatedDto, type WebhookDeliveryDto, type WebhookDto } from '@workhub/shared';
import { createHmac } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { checkResolves, checkUrl, isPublicAddress, UnsafeUrlError } from '../src/webhooks/url-safety';
import { MAX_ATTEMPTS, RETRY_MINUTES, WebhookService } from '../src/webhooks/webhook.service';
import { createApp, lastEmailTo, signUp, signUpWithoutWorkspace, withAdmin } from './helpers';

type Received = { headers: http.IncomingHttpHeaders; body: string };

let app: INestApplication;
let service: WebhookService;
let receiver: http.Server;
let receiverUrl: string;
let answer = 200;
const received: Received[] = [];

beforeAll(async () => {
  app = await createApp();
  service = app.get(WebhookService);
  receiver = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      received.push({ headers: req.headers, body });
      res.writeHead(answer).end('ok');
    });
  });
  await new Promise<void>((resolve) => receiver.listen(0, '127.0.0.1', resolve));
  receiverUrl = `http://127.0.0.1:${(receiver.address() as AddressInfo).port}/hooks`;
});

afterAll(async () => {
  await new Promise((resolve) => receiver.close(resolve));
  await app.close();
});

beforeEach(() => {
  received.length = 0;
  answer = 200;
});

type Owner = Awaited<ReturnType<typeof signUp>>;

async function addWebhook(owner: Owner, events: string[]): Promise<WebhookCreatedDto> {
  return (await owner.agent.post('/webhooks').set(WORKSPACE_HEADER, owner.workspace.id).send({ url: receiverUrl, events }).expect(201)).body;
}

const addLead = (owner: Owner, name: string) => owner.agent.post('/crm/leads').set(WORKSPACE_HEADER, owner.workspace.id).send({ name }).expect(201);

const deliveries = async (owner: Owner, webhookId: string): Promise<WebhookDeliveryDto[]> =>
  (await owner.agent.get(`/webhooks/${webhookId}/deliveries`).set(WORKSPACE_HEADER, owner.workspace.id).expect(200)).body;

describe('managing webhooks', () => {
  it('shows the signing secret once and keeps it encrypted', async () => {
    const owner = await signUp(app, 'hooker', 'Hook Co');
    const created = await addWebhook(owner, ['lead.created']);
    expect(created.secret).toMatch(/^whsec_[A-Za-z0-9_-]{32}$/);
    expect(created).toMatchObject({ url: receiverUrl, events: ['lead.created'], pausedAt: null, pending: 0, lastDelivery: null });

    const list: WebhookDto[] = (await owner.agent.get('/webhooks').set(WORKSPACE_HEADER, owner.workspace.id).expect(200)).body;
    expect(JSON.stringify(list)).not.toContain(created.secret);
    const stored = await withAdmin(async (db) => (await db.query('select secret_encrypted from webhooks where id = $1', [created.id])).rows[0].secret_encrypted as string);
    expect(stored).not.toContain(created.secret);

    const audit = await withAdmin(async (db) => (await db.query('select action from audit_logs where entity_id = $1', [created.id])).rows.map((r) => r.action));
    expect(audit).toEqual(['webhook.created']);
  });

  it('checks the address and events', async () => {
    const owner = await signUp(app, 'checker', 'Check Co');
    const post = (body: object) => owner.agent.post('/webhooks').set(WORKSPACE_HEADER, owner.workspace.id).send(body);
    await post({ url: 'ftp://example.com/x', events: ['lead.created'] }).expect(400);
    await post({ url: receiverUrl, events: [] }).expect(400);
    await post({ url: receiverUrl, events: ['made.up'] }).expect(400);
  });

  it('can only be managed by admins', async () => {
    const owner = await signUp(app, 'boss', 'Boss Co');
    const member = await signUpWithoutWorkspace(app, 'staff');
    await withAdmin((db) => db.query('insert into memberships (workspace_id, user_id, role) values ($1, $2, $3)', [owner.workspace.id, member.user.id, 'member']));
    await member.agent.get('/webhooks').set(WORKSPACE_HEADER, owner.workspace.id).expect(403);
    await member.agent.post('/webhooks').set(WORKSPACE_HEADER, owner.workspace.id).send({ url: receiverUrl, events: ['lead.created'] }).expect(403);
  });
});

describe('delivering events', () => {
  it('sends a signed event for the change, and only the events asked for', async () => {
    const owner = await signUp(app, 'sender', 'Sender Co');
    const hook = await addWebhook(owner, ['lead.created']);
    await addLead(owner, 'Ayesha Malik');
    // A project isn't a lead: nothing is queued for it.
    await owner.agent.post('/projects').set(WORKSPACE_HEADER, owner.workspace.id).send({ name: 'Not an event' }).expect(201);

    expect(await service.deliverDue()).toBe(1);
    expect(received).toHaveLength(1);
    const { headers, body } = received[0]!;
    const parsed = JSON.parse(body);
    expect(parsed).toMatchObject({ event: 'lead.created', workspaceId: owner.workspace.id, data: { name: 'Ayesha Malik', status: 'new' } });
    expect(headers['workhub-event']).toBe('lead.created');
    expect(headers['workhub-delivery']).toBe(parsed.id);

    // The receiver can check it came from WorkHub.
    const [, t, v1] = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(String(headers['workhub-signature']))!;
    expect(createHmac('sha256', hook.secret).update(`${t}.${body}`).digest('hex')).toBe(v1);

    const [d] = await deliveries(owner, hook.id);
    expect(d).toMatchObject({ event: 'lead.created', status: 'delivered', attempts: 1, lastStatus: 200 });
    expect(await service.deliverDue()).toBe(0);
  });

  it('sends events from the app and from the API alike', async () => {
    const owner = await signUp(app, 'tasker', 'Task Co');
    const ws = owner.workspace.id;
    await addWebhook(owner, ['task.created', 'task.completed']);
    const project = (await owner.agent.post('/projects').set(WORKSPACE_HEADER, ws).send({ name: 'Site' }).expect(201)).body;
    const board = (await owner.agent.get(`/projects/${project.id}`).set(WORKSPACE_HEADER, ws).expect(200)).body;
    const task = (await owner.agent.post(`/projects/${project.id}/tasks`).set(WORKSPACE_HEADER, ws).send({ title: 'From the app', columnId: board.columns[0].id }).expect(201)).body;
    await owner.agent.patch(`/tasks/${task.id}`).set(WORKSPACE_HEADER, ws).send({ completed: true }).expect(200);

    const { key } = (await owner.agent.post('/api-keys').set(WORKSPACE_HEADER, ws).send({ name: 'Writer', access: 'write' }).expect(201)).body;
    await request(app.getHttpServer()).post('/v1/tasks').set('Authorization', `Bearer ${key}`).send({ projectId: project.id, title: 'From the API' }).expect(201);

    await service.deliverDue();
    const events = received.map((r) => JSON.parse(r.body)).map((b) => `${b.event}:${b.data.title}`);
    expect(events.sort()).toEqual(['task.completed:From the app', 'task.created:From the API', 'task.created:From the app']);
  });

  it('sends check-in, leave, deal and invoice events', async () => {
    const owner = await signUp(app, 'allevents', 'Events Co');
    const ws = owner.workspace.id;
    const H = { [WORKSPACE_HEADER]: ws };
    await addWebhook(owner, ['attendance.checked_in', 'leave.requested', 'leave.approved', 'deal.won', 'invoice.paid']);

    // Selfies are on by default: a few bytes that look like a JPEG will do.
    const selfie = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 7)]);
    await owner.agent.post('/attendance/events').set(H).field('type', 'check_in').attach('selfie', selfie, { filename: 'me.jpg', contentType: 'image/jpeg' }).expect(200);

    const types = (await owner.agent.get('/leave/types').set(H).expect(200)).body as { id: string; daysPerYear: number | null }[];
    const unlimited = types.find((t) => t.daysPerYear === null)!;
    // A Wednesday about two months ahead: a working day with no balance to worry about.
    const day = new Date(Date.now() + 60 * 86_400_000);
    day.setUTCDate(day.getUTCDate() + ((3 - day.getUTCDay() + 7) % 7));
    const date = day.toISOString().slice(0, 10);
    const leave = (await owner.agent.post('/leave/requests').set(H).send({ leaveTypeId: unlimited.id, startDate: date, endDate: date }).expect(201)).body;
    await owner.agent.post(`/leave/requests/${leave.id}/approve`).set(H).send({}).expect(200);

    const deal = (await owner.agent.post('/crm/deals').set(H).send({ title: 'Big contract' }).expect(201)).body;
    await owner.agent.post(`/crm/deals/${deal.id}/win`).set(H).send({}).expect(201);

    const client = (await owner.agent.post('/crm/companies').set(H).send({ name: 'Paying Client' }).expect(201)).body;
    const invoice = (
      await owner.agent
        .post('/client-docs')
        .set(H)
        .send({ kind: 'invoice', companyId: client.id, currency: 'PKR', issueDate: '2027-06-01', dueDate: '2027-06-30', taxRate: 0, lines: [{ description: 'Work', quantity: 1, unitPrice: 50000 }] })
        .expect(201)
    ).body;
    await owner.agent.post(`/client-docs/${invoice.id}/status`).set(H).send({ status: 'sent' }).expect(200);
    await owner.agent.post(`/client-docs/${invoice.id}/status`).set(H).send({ status: 'paid' }).expect(200);

    await service.deliverDue();
    const byEvent = Object.fromEntries(received.map((r) => JSON.parse(r.body)).map((b) => [b.event, b.data]));
    expect(Object.keys(byEvent).sort()).toEqual(['attendance.checked_in', 'deal.won', 'invoice.paid', 'leave.approved', 'leave.requested']);
    expect(byEvent['attendance.checked_in']).toMatchObject({ userId: owner.user.id, name: 'allevents', offline: false });
    expect(byEvent['leave.requested']).toMatchObject({ id: leave.id, status: 'pending', startDate: date });
    expect(byEvent['leave.approved']).toMatchObject({ id: leave.id, status: 'approved' });
    expect(byEvent['deal.won']).toMatchObject({ id: deal.id, status: 'won', title: 'Big contract' });
    expect(byEvent['invoice.paid']).toMatchObject({ id: invoice.id, status: 'paid', total: 50000 });
  });

  it("never sends one workspace's events to another's webhook", async () => {
    const alice = await signUp(app, 'alice', 'Alice Agency');
    const bob = await signUp(app, 'bob', 'Bob BPO');
    const aliceHook = await addWebhook(alice, ['lead.created']);
    await addLead(bob, 'Bob lead');
    await service.deliverDue();
    expect(received).toHaveLength(0);
    expect(await deliveries(alice, aliceHook.id)).toEqual([]);
    await bob.agent.get(`/webhooks/${aliceHook.id}/deliveries`).set(WORKSPACE_HEADER, bob.workspace.id).expect(404);
    await bob.agent.delete(`/webhooks/${aliceHook.id}`).set(WORKSPACE_HEADER, bob.workspace.id).expect(404);
  });

  it('queues nothing when the change fails', async () => {
    const owner = await signUp(app, 'rollback', 'Rollback Co');
    const hook = await addWebhook(owner, ['lead.created']);
    await owner.agent.post('/crm/leads').set(WORKSPACE_HEADER, owner.workspace.id).send({ name: 'No owner', ownerId: '00000000-0000-4000-8000-000000000000' }).expect(400);
    expect(await deliveries(owner, hook.id)).toEqual([]);
  });
});

describe('failures', () => {
  it('retries for about a day, then pauses the webhook and emails the owner', async () => {
    const owner = await signUp(app, 'flaky', 'Flaky Co');
    const hook = await addWebhook(owner, ['lead.created']);
    answer = 500;
    await addLead(owner, 'Retried');

    let now = Date.now();
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      expect(await service.deliverDue(new Date(now))).toBe(1);
      const [d] = await deliveries(owner, hook.id);
      expect(d).toMatchObject({ attempts: attempt, lastStatus: 500, status: attempt < MAX_ATTEMPTS ? 'pending' : 'failed' });
      // Not due again before its wait is over.
      expect(await service.deliverDue(new Date(now + 1000))).toBe(0);
      now += (RETRY_MINUTES[attempt - 1] ?? 0) * 60_000 + 1000;
    }
    expect(received).toHaveLength(MAX_ATTEMPTS);

    const [paused] = (await owner.agent.get('/webhooks').set(WORKSPACE_HEADER, owner.workspace.id).expect(200)).body as WebhookDto[];
    expect(paused!.pausedAt).not.toBeNull();
    expect(paused!.pausedReason).toMatch(/failed for a day/);
    expect(lastEmailTo(owner.email)?.subject).toBe('A WorkHub webhook was paused');

    // While paused, events wait; on resume they're sent.
    answer = 200;
    await addLead(owner, 'Waited');
    expect(await service.deliverDue(new Date(now))).toBe(0);
    await owner.agent.patch(`/webhooks/${hook.id}`).set(WORKSPACE_HEADER, owner.workspace.id).send({ paused: false }).expect(200);
    expect(await service.deliverDue(new Date(now))).toBe(1);
    expect(JSON.parse(received.at(-1)!.body).data.name).toBe('Waited');
  });

  it('sends a test ping once, without retrying or pausing', async () => {
    const owner = await signUp(app, 'pinger', 'Ping Co');
    const hook = await addWebhook(owner, ['lead.created']);
    const ok: WebhookDeliveryDto = (await owner.agent.post(`/webhooks/${hook.id}/test`).set(WORKSPACE_HEADER, owner.workspace.id).expect(200)).body;
    expect(ok).toMatchObject({ event: 'ping', status: 'delivered', lastStatus: 200 });
    expect(JSON.parse(received[0]!.body)).toMatchObject({ event: 'ping', data: { message: expect.any(String) } });

    answer = 503;
    const bad: WebhookDeliveryDto = (await owner.agent.post(`/webhooks/${hook.id}/test`).set(WORKSPACE_HEADER, owner.workspace.id).expect(200)).body;
    expect(bad).toMatchObject({ status: 'failed', attempts: 1, lastStatus: 503, lastError: 'The receiver answered 503' });
    const [still] = (await owner.agent.get('/webhooks').set(WORKSPACE_HEADER, owner.workspace.id).expect(200)).body as WebhookDto[];
    expect(still!.pausedAt).toBeNull();
  });

  it('records an unreachable receiver', async () => {
    const owner = await signUp(app, 'gone', 'Gone Co');
    const hook = await addWebhook(owner, ['lead.created']);
    await owner.agent.patch(`/webhooks/${hook.id}`).set(WORKSPACE_HEADER, owner.workspace.id).send({ url: 'http://127.0.0.1:9/nothing-here' }).expect(200);
    const res: WebhookDeliveryDto = (await owner.agent.post(`/webhooks/${hook.id}/test`).set(WORKSPACE_HEADER, owner.workspace.id).expect(200)).body;
    expect(res).toMatchObject({ status: 'failed', lastStatus: null });
    expect(res.lastError).toBeTruthy();
  });
});

describe('address safety', () => {
  it('knows public from private addresses', () => {
    for (const ip of ['10.0.0.1', '127.0.0.1', '169.254.169.254', '172.20.1.1', '192.168.1.1', '100.64.0.1', '0.0.0.0', '::1', '::ffff:10.0.0.1', 'fd00::1', 'fe80::1']) {
      expect([ip, isPublicAddress(ip)]).toEqual([ip, false]);
    }
    for (const ip of ['8.8.8.8', '93.184.216.34', '2606:4700:4700::1111', '::ffff:8.8.8.8']) {
      expect([ip, isPublicAddress(ip)]).toEqual([ip, true]);
    }
  });

  it('refuses unsafe addresses unless private ones are allowed', () => {
    for (const url of ['http://example.com/hook', 'https://user:pw@example.com/hook', 'https://localhost/hook', 'https://10.0.0.1/hook', 'https://[::1]/hook', 'https://intranet/hook', 'not a url']) {
      expect(() => checkUrl(url, false)).toThrow(UnsafeUrlError);
    }
    expect(checkUrl('https://hooks.example.com/workhub', false).hostname).toBe('hooks.example.com');
    expect(checkUrl('http://127.0.0.1:3000/hook', true).port).toBe('3000');
  });

  it('refuses a name that points to a private address', async () => {
    const pointsTo = (address: string) => async () => [{ address, family: 4 }];
    await expect(checkResolves(new URL('https://sneaky.example.com'), false, pointsTo('10.1.2.3') as never)).rejects.toThrow(UnsafeUrlError);
    await expect(checkResolves(new URL('https://fine.example.com'), false, pointsTo('93.184.216.34') as never)).resolves.toBeUndefined();
    const missing = async () => {
      throw new Error('ENOTFOUND');
    };
    await expect(checkResolves(new URL('https://nope.example.com'), false, missing as never)).rejects.toThrow(/couldn't find/);
  });
});
