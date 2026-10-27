import type { INestApplication } from '@nestjs/common';
import {
  WORKSPACE_HEADER,
  type BoardDto,
  type ClientOverviewDto,
  type CrmActivityDto,
  type CrmCompanyDto,
  type DealDto,
  type LeadDto,
  type PipelineDto,
} from '@workhub/shared';
import { FollowUpRemindersService } from '../src/crm/reminders.service';
import { createApp, signUp, withAdmin } from './helpers';

let app: INestApplication;
let owner: Awaited<ReturnType<typeof signUp>>;
let manager: Awaited<ReturnType<typeof signUp>>;
let member: Awaited<ReturnType<typeof signUp>>;
let rival: Awaited<ReturnType<typeof signUp>>;
let ws: string;
let sales: PipelineDto;
let acme: CrmCompanyDto;
const H = () => ({ [WORKSPACE_HEADER]: ws });
const stage = (name: string) => sales.stages.find((s) => s.name === name)!;

async function join_(person: typeof owner, role: string) {
  await withAdmin((db) => db.query('insert into memberships (workspace_id, user_id, role) values ($1, $2, $3)', [ws, person.user.id, role]));
}

async function notificationTitles(agent: typeof owner.agent) {
  return (await agent.get('/notifications').set(H()).expect(200)).body.items.map((n: { title: string }) => n.title) as string[];
}

beforeAll(async () => {
  app = await createApp();
  owner = await signUp(app, 'owner', 'Deal Co');
  ws = owner.workspace.id;
  manager = await signUp(app, 'manager', 'M home');
  member = await signUp(app, 'member', 'Mem home');
  rival = await signUp(app, 'rival', 'Rival Co');
  await join_(manager, 'manager');
  await join_(member, 'member');
  acme = (await member.agent.post('/crm/companies').set(H()).send({ name: 'Acme Traders' }).expect(201)).body;
});

afterAll(async () => {
  await app.close();
});

describe('pipelines', () => {
  it('starts every workspace with a Sales pipeline ending in Won and Lost', async () => {
    const list = (await member.agent.get('/crm/pipelines').set(H()).expect(200)).body as PipelineDto[];
    expect(list).toHaveLength(1);
    sales = list[0]!;
    expect(sales).toMatchObject({ name: 'Sales', isDefault: true });
    expect(sales.stages.map((s) => [s.name, s.probability, s.kind])).toEqual([
      ['New', 10, 'open'],
      ['Qualified', 25, 'open'],
      ['Proposal sent', 50, 'open'],
      ['Negotiation', 75, 'open'],
      ['Won', 100, 'won'],
      ['Lost', 0, 'lost'],
    ]);
  });

  it('lets managers add pipelines and edit stages, but not drop a stage that has deals', async () => {
    await member.agent.post('/crm/pipelines').set(H()).send({ name: 'Retainers', stages: [{ name: 'Pitch', probability: 30 }] }).expect(403);
    const p = (await manager.agent.post('/crm/pipelines').set(H()).send({ name: 'Retainers', stages: [{ name: 'Pitch', probability: 30 }, { name: 'Trial', probability: 60 }] }).expect(201)).body as PipelineDto;
    expect(p.stages.map((s) => s.name)).toEqual(['Pitch', 'Trial', 'Won', 'Lost']);
    const pitch = p.stages[0]!;
    await member.agent.post('/crm/deals').set(H()).send({ title: 'Monthly SEO', pipelineId: p.id, stageId: pitch.id }).expect(201);
    await manager.agent.patch(`/crm/pipelines/${p.id}`).set(H()).send({ name: 'Retainers', stages: [{ name: 'Trial', probability: 60, id: p.stages[1]!.id }] }).expect(409);
    const renamed = (await manager.agent
      .patch(`/crm/pipelines/${p.id}`)
      .set(H())
      .send({ name: 'Monthly retainers', stages: [{ id: pitch.id, name: 'Pitched', probability: 40 }, { id: p.stages[1]!.id, name: 'Trial', probability: 60 }, { name: 'Contract', probability: 90 }] })
      .expect(200)).body as PipelineDto;
    expect(renamed.stages.map((s) => `${s.name}:${s.probability}`)).toEqual(['Pitched:40', 'Trial:60', 'Contract:90', 'Won:100', 'Lost:0']);
    await manager.agent.delete(`/crm/pipelines/${p.id}`).set(H()).expect(409);
    await manager.agent.delete(`/crm/pipelines/${sales.id}`).set(H()).expect(400);
  });
});

describe('deals', () => {
  let deal: DealDto;

  it('creates a deal in the default pipeline’s first stage, in the workspace currency', async () => {
    deal = (await member.agent.post('/crm/deals').set(H()).send({ title: 'Acme website', value: 450000, companyId: acme.id }).expect(201)).body;
    expect(deal).toMatchObject({ pipelineId: sales.id, stageName: 'New', probability: 10, currency: 'PKR', status: 'open', company: { id: acme.id }, owner: expect.objectContaining({ id: member.user.id }) });
    await member.agent.post('/crm/deals').set(H()).send({ title: 'X', stageId: stage('Won').id }).expect(400);
    await member.agent.post('/crm/deals').set(H()).send({ title: 'X', companyId: rival.workspace.id }).expect(400);
    await rival.agent.get(`/crm/deals/${deal.id}`).set(WORKSPACE_HEADER, rival.workspace.id).expect(404);
  });

  it('moves across the board, closes in Lost with a reason, and reopens', async () => {
    const other = (await member.agent.post('/crm/deals').set(H()).send({ title: 'Acme app', value: 900, currency: 'USD' }).expect(201)).body as DealDto;
    await member.agent.post(`/crm/deals/${other.id}/move`).set(H()).send({ stageId: stage('Proposal sent').id }).expect(201);
    // Put the website deal above it in the same column.
    const moved = (await member.agent.post(`/crm/deals/${deal.id}/move`).set(H()).send({ stageId: stage('Proposal sent').id, index: 0 }).expect(201)).body as DealDto;
    expect(moved).toMatchObject({ stageName: 'Proposal sent', probability: 50 });
    const board = (await member.agent.get('/crm/deals').query({ pipelineId: sales.id, status: 'open' }).set(H()).expect(200)).body as DealDto[];
    expect(board.filter((d) => d.stageId === stage('Proposal sent').id).map((d) => d.title)).toEqual(['Acme website', 'Acme app']);

    const lost = (await member.agent.post(`/crm/deals/${other.id}/move`).set(H()).send({ stageId: stage('Lost').id, lostReason: 'Went with a cheaper agency' }).expect(201)).body as DealDto;
    expect(lost).toMatchObject({ status: 'lost', lostReason: 'Went with a cheaper agency', lostAt: expect.any(String) });
    const reopened = (await member.agent.post(`/crm/deals/${other.id}/move`).set(H()).send({ stageId: stage('Negotiation').id }).expect(201)).body as DealDto;
    expect(reopened).toMatchObject({ status: 'open', lostAt: null, lostReason: null });
  });

  it('when won, starts a project for the client from a template (managers only)', async () => {
    await member.agent.post(`/crm/deals/${deal.id}/win`).set(H()).send({ project: { name: 'Acme website build' } }).expect(403);
    const won = (await manager.agent.post(`/crm/deals/${deal.id}/win`).set(H()).send({ project: { name: 'Acme website build', templateId: 'builtin:website' } }).expect(201)).body as DealDto;
    expect(won).toMatchObject({ status: 'won', stageName: 'Won', projectId: expect.any(String), wonAt: expect.any(String) });
    const board = (await manager.agent.get(`/projects/${won.projectId}`).set(H()).expect(200)).body as BoardDto;
    expect(board.project).toMatchObject({ name: 'Acme website build', client: { id: acme.id, name: 'Acme Traders' } });
    expect(board.columns.map((c) => c.name)).toEqual(['Backlog', 'Design', 'Development', 'Client review', 'Done']);
    await manager.agent.post(`/crm/deals/${deal.id}/win`).set(H()).send({ project: { name: 'Again' } }).expect(409);
    // A member can still mark a deal won without a project.
    const small = (await member.agent.post('/crm/deals').set(H()).send({ title: 'Logo' }).expect(201)).body as DealDto;
    expect((await member.agent.post(`/crm/deals/${small.id}/win`).set(H()).send({}).expect(201)).body).toMatchObject({ status: 'won', projectId: null });
  });
});

describe('activities and follow-ups', () => {
  it('logs calls and notes, schedules follow-ups and reminds their owner when due', async () => {
    const [d] = (await member.agent.get('/crm/deals').query({ companyId: acme.id, status: 'won' }).set(H()).expect(200)).body as DealDto[];
    const call = (await member.agent.post('/crm/activities').set(H()).send({ kind: 'call', subject: 'Discussed the sitemap', dealId: d!.id }).expect(201)).body as CrmActivityDto;
    // Logged after the fact, and shown on the deal's company too.
    expect(call).toMatchObject({ doneAt: expect.any(String), deal: { id: d!.id }, company: { id: acme.id } });
    await member.agent.post('/crm/activities').set(H()).send({ kind: 'note', subject: 'Orphan' }).expect(400);

    const soon = new Date(Date.now() + 3600_000).toISOString();
    const follow = (await member.agent.post('/crm/activities').set(H()).send({ kind: 'whatsapp', subject: 'Send the invoice', companyId: acme.id, dueAt: soon }).expect(201)).body as CrmActivityDto;
    expect(follow).toMatchObject({ doneAt: null, overdue: false });
    const mine = (await member.agent.get('/crm/follow-ups').set(H()).expect(200)).body as CrmActivityDto[];
    expect(mine.map((a) => a.id)).toEqual([follow.id]);
    expect((await manager.agent.get('/crm/follow-ups').set(H()).expect(200)).body).toEqual([]);
    expect(((await manager.agent.get('/crm/follow-ups').query({ scope: 'all' }).set(H()).expect(200)).body as CrmActivityDto[]).map((a) => a.id)).toEqual([follow.id]);

    const reminders = app.get(FollowUpRemindersService);
    expect(await reminders.sendDue(new Date())).toBe(0);
    expect(await reminders.sendDue(new Date(Date.now() + 2 * 3600_000))).toBeGreaterThanOrEqual(1);
    expect(await notificationTitles(member.agent)).toContain('Follow-up due: Send the invoice');
    // Sent once.
    expect(await reminders.sendDue(new Date(Date.now() + 3 * 3600_000))).toBe(0);

    // Moving the due time arms a new reminder; marking it done stops it.
    await member.agent.patch(`/crm/activities/${follow.id}`).set(H()).send({ dueAt: new Date(Date.now() + 4 * 3600_000).toISOString() }).expect(200);
    const done = (await member.agent.patch(`/crm/activities/${follow.id}`).set(H()).send({ done: true }).expect(200)).body as CrmActivityDto;
    expect(done.doneAt).not.toBeNull();
    expect(await reminders.sendDue(new Date(Date.now() + 5 * 3600_000))).toBe(0);
    expect((await member.agent.get('/crm/follow-ups').set(H()).expect(200)).body).toEqual([]);
  });
});

describe('lead to deal', () => {
  it('converts a lead into a contact, company and an open deal with its value', async () => {
    const lead = (await member.agent.post('/crm/leads').set(H()).send({ name: 'Zainab Ali', companyName: 'Ali Exports', value: 120000, source: 'linkedin' }).expect(201)).body as LeadDto;
    const done = (await member.agent.post(`/crm/leads/${lead.id}/convert`).set(H()).send({ company: 'new', createDeal: true }).expect(201)).body as { dealId: string; companyId: string; contactId: string };
    const deal = (await member.agent.get(`/crm/deals/${done.dealId}`).set(H()).expect(200)).body as DealDto;
    expect(deal).toMatchObject({ title: 'Ali Exports', value: 120000, stageName: 'New', company: { id: done.companyId }, contact: { id: done.contactId, name: 'Zainab Ali' } });
  });
});

describe('Client 360', () => {
  it('brings deals, projects with hours, money by currency, activity and files together', async () => {
    const page = (await member.agent.get(`/crm/companies/${acme.id}`).set(H()).expect(200)).body as ClientOverviewDto;
    const project = page.projects[0]!;
    expect(project).toMatchObject({ name: 'Acme website build', hours: 0 });
    const [task] = ((await manager.agent.get(`/projects/${project.id}`).set(H()).expect(200)).body as BoardDto).tasks;
    await manager.agent.post(`/tasks/${task!.id}/time`).set(H()).send({ minutes: 90 }).expect(201);
    await manager.agent
      .post(`/tasks/${task!.id}/attachments`)
      .set(H())
      .attach('file', Buffer.from('brief'), { filename: 'brief.txt', contentType: 'text/plain' })
      .expect(201);
    await member.agent.post('/crm/deals').set(H()).send({ title: 'Phase 2', value: 200000, companyId: acme.id, stageId: stage('Negotiation').id }).expect(201);

    const after = (await member.agent.get(`/crm/companies/${acme.id}`).set(H()).expect(200)).body as ClientOverviewDto;
    expect(after.projects[0]).toMatchObject({ hours: 1.5, billableHours: 1.5 });
    expect(after.totals).toMatchObject({ won: [{ currency: 'PKR', value: 450000 }], open: [{ currency: 'PKR', value: 200000 }], weighted: [{ currency: 'PKR', value: 150000 }], hoursTotal: 1.5, hoursThisMonth: 1.5 });
    expect(after.deals.map((d) => d.title).sort()).toEqual(['Acme website', 'Phase 2']);
    expect(after.activities.map((a) => a.subject)).toEqual(expect.arrayContaining(['Discussed the sitemap', 'Send the invoice']));
    expect(after.files).toEqual([expect.objectContaining({ fileName: 'brief.txt', projectName: 'Acme website build' })]);
  });
});
