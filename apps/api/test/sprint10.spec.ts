import type { INestApplication } from '@nestjs/common';
import { WORKSPACE_HEADER, type CostSettingsDto, type DashboardDto, type DealDto, type ProfitabilityDto, type SalesReportDto, type UtilisationDto } from '@workhub/shared';
import { zonedParts } from '../src/attendance/zoned';
import { createApp, signUp, withAdmin } from './helpers';

let app: INestApplication;
let owner: Awaited<ReturnType<typeof signUp>>;
let manager: Awaited<ReturnType<typeof signUp>>;
let dev: Awaited<ReturnType<typeof signUp>>;
let intern: Awaited<ReturnType<typeof signUp>>;
let ws: string;
const H = () => ({ [WORKSPACE_HEADER]: ws });
const today = () => zonedParts(new Date(), 'Asia/Karachi').date;
const ids = { acme: '', beta: '', acmeProject: '', betaProject: '' };

async function join_(person: typeof owner, role: string) {
  await withAdmin((db) => db.query('insert into memberships (workspace_id, user_id, role) values ($1, $2, $3)', [ws, person.user.id, role]));
}

/** Logs time directly, for exact numbers on exact days. */
async function logTime(person: typeof owner, projectId: string, minutes: number, billable: boolean, day = today()) {
  await withAdmin((db) =>
    db.query('insert into time_entries (workspace_id, project_id, user_id, work_date, minutes, billable) values ($1, $2, $3, $4, $5, $6)', [ws, projectId, person.user.id, day, minutes, billable]),
  );
}

beforeAll(async () => {
  app = await createApp();
  owner = await signUp(app, 'owner', 'Numbers Co');
  ws = owner.workspace.id;
  manager = await signUp(app, 'manager', 'M home');
  dev = await signUp(app, 'dev', 'D home');
  intern = await signUp(app, 'intern', 'I home');
  await join_(manager, 'manager');
  await join_(dev, 'member');
  await join_(intern, 'member');

  const acme = (await owner.agent.post('/crm/companies').set(H()).send({ name: 'Acme' }).expect(201)).body;
  const beta = (await owner.agent.post('/crm/companies').set(H()).send({ name: 'Beta' }).expect(201)).body;
  ids.acme = acme.id;
  ids.beta = beta.id;
  ids.acmeProject = (await owner.agent.post('/projects').set(H()).send({ name: 'Acme app', clientId: acme.id }).expect(201)).body.id;
  ids.betaProject = (await owner.agent.post('/projects').set(H()).send({ name: 'Beta site', clientId: beta.id }).expect(201)).body.id;
});

afterAll(async () => {
  await app.close();
});

describe('cost settings', () => {
  it('are for owners and admins only, and salaries never show elsewhere', async () => {
    await manager.agent.get('/reports/costs').set(H()).expect(403);
    await manager.agent.get('/reports/profitability').set(H()).expect(403);
    const set = (await owner.agent.patch('/reports/costs').set(H()).send({ monthlyHours: 160, fxRates: { USD: 280 } }).expect(200)).body as CostSettingsDto;
    expect(set).toMatchObject({ currency: 'PKR', monthlyHours: 160, fxRates: { USD: 280 } });
    await owner.agent.put(`/reports/costs/people/${dev.user.id}`).set(H()).send({ monthlyCost: 160000 }).expect(200);
    await owner.agent.put(`/reports/costs/projects/${ids.acmeProject}`).set(H()).send({ hourlyRate: 25, currency: 'USD' }).expect(200);
    const costs = (await owner.agent.get('/reports/costs').set(H()).expect(200)).body as CostSettingsDto;
    expect(costs.people.find((p) => p.person.id === dev.user.id)).toMatchObject({ monthlyCost: 160000, hourlyCost: 1000 });
    expect(costs.projects.find((p) => p.id === ids.acmeProject)).toMatchObject({ hourlyRate: 25, rateCurrency: 'USD', client: { name: 'Acme' } });
    const members = JSON.stringify((await dev.agent.get('/members').set(H()).expect(200)).body);
    expect(members).not.toContain('160000');
    expect(members).not.toMatch(/cost/i);
    await owner.agent.patch('/reports/costs').set(H()).send({ monthlyHours: 160, fxRates: { XYZ: 2 } }).expect(400);
  });
});

describe('client profitability', () => {
  it('weighs revenue from won deals and hourly projects against the cost of hours', async () => {
    await logTime(dev, ids.acmeProject, 120, true);
    await logTime(intern, ids.acmeProject, 60, false);
    await logTime(dev, ids.betaProject, 300, true);
    const deal = (await owner.agent.post('/crm/deals').set(H()).send({ title: 'Beta site', value: 300000, companyId: ids.beta }).expect(201)).body as DealDto;
    await owner.agent.post(`/crm/deals/${deal.id}/win`).set(H()).send({}).expect(201);
    const euro = (await owner.agent.post('/crm/deals').set(H()).send({ title: 'Euro job', value: 1000, currency: 'EUR', companyId: ids.acme }).expect(201)).body as DealDto;
    await owner.agent.post(`/crm/deals/${euro.id}/win`).set(H()).send({}).expect(201);

    const r = (await owner.agent.get('/reports/profitability').set(H()).expect(200)).body as ProfitabilityDto;
    expect(r.currency).toBe('PKR');
    expect(r.months).toHaveLength(6);
    expect(r.months.at(-1)).toBe(today().slice(0, 7));
    const acme = r.clients.find((c) => c.client?.name === 'Acme')!;
    // 2 billable hours × USD 25 × 280; cost 2 h × 1,000 (the intern has no cost set).
    expect(acme).toMatchObject({ revenue: 14000, cost: 2000, profit: 12000, margin: 85.7, hours: 3, billableHours: 2 });
    const beta = r.clients.find((c) => c.client?.name === 'Beta')!;
    expect(beta).toMatchObject({ revenue: 300000, cost: 5000, profit: 295000, hours: 5 });
    expect(beta.byMonth.at(-1)).toMatchObject({ month: today().slice(0, 7), revenue: 300000 });
    expect(r.total).toMatchObject({ revenue: 314000, cost: 7000, profit: 307000 });
    expect(r.missingRates).toEqual(['EUR']);
    expect(r.peopleWithoutCost.map((p) => p.id)).toEqual([intern.user.id]);
    await owner.agent.get('/reports/profitability').query({ from: '2026-13', to: '2026-01' }).set(H()).expect(400);
  });

  it('doesn’t count a deal twice when its project is billed by the hour', async () => {
    const deal = (await owner.agent.post('/crm/deals').set(H()).send({ title: 'Acme phase 2', value: 999999, companyId: ids.acme }).expect(201)).body as DealDto;
    const won = (await owner.agent.post(`/crm/deals/${deal.id}/win`).set(H()).send({ project: { name: 'Acme phase 2' } }).expect(201)).body as DealDto;
    await owner.agent.put(`/reports/costs/projects/${won.projectId}`).set(H()).send({ hourlyRate: 5000, currency: 'PKR' }).expect(200);
    const r = (await owner.agent.get('/reports/profitability').set(H()).expect(200)).body as ProfitabilityDto;
    expect(r.clients.find((c) => c.client?.name === 'Acme')!.revenue).toBe(14000);
  });
});

describe('utilisation', () => {
  it('compares billable hours with working capacity, per person and team', async () => {
    await dev.agent.get('/reports/utilisation').set(H()).expect(403);
    const team = (await owner.agent.post('/teams').set(H()).send({ name: 'Dev' }).expect(201)).body as { id: string };
    await withAdmin((db) => db.query('update memberships set team_id = $1 where workspace_id = $2 and user_id = $3', [team.id, ws, dev.user.id]));
    // A Monday-to-Sunday week: five working days, 40 hours.
    await logTime(dev, ids.betaProject, 1200, true, '2026-10-06');
    await logTime(dev, ids.betaProject, 240, false, '2026-10-07');
    const r = (await manager.agent.get('/reports/utilisation').query({ from: '2026-10-05', to: '2026-10-11' }).set(H()).expect(200)).body as UtilisationDto;
    const d = r.people.find((p) => p.person.id === dev.user.id)!;
    expect(d).toMatchObject({ hours: 24, billableHours: 20, capacityHours: 40, utilisation: 50, team: { name: 'Dev' } });
    expect(r.teams.find((t) => t.team?.name === 'Dev')).toMatchObject({ people: 1, billableHours: 20, utilisation: 50 });
    expect(r.people).toHaveLength(4);
    await manager.agent.get('/reports/utilisation').query({ from: '2026-10-11', to: '2026-10-05' }).set(H()).expect(400);
  });
});

describe('sales report', () => {
  it('shows win rate, sources, stages, lost reasons and each salesperson’s activity', async () => {
    const lead = (await manager.agent.post('/crm/leads').set(H()).send({ name: 'Upwork client', companyName: 'Gamma', value: 50000, source: 'upwork' }).expect(201)).body as { id: string };
    const conv = (await manager.agent.post(`/crm/leads/${lead.id}/convert`).set(H()).send({ company: 'new', createDeal: true }).expect(201)).body as { dealId: string };
    await manager.agent.post(`/crm/deals/${conv.dealId}/win`).set(H()).send({}).expect(201);
    const lost = (await manager.agent.post('/crm/deals').set(H()).send({ title: 'Too pricey', value: 1000 }).expect(201)).body as DealDto;
    const pipelines = (await manager.agent.get('/crm/pipelines').set(H()).expect(200)).body as { stages: { id: string; kind: string; name: string }[] }[];
    await manager.agent.post(`/crm/deals/${lost.id}/move`).set(H()).send({ stageId: pipelines[0]!.stages.find((s) => s.kind === 'lost')!.id, lostReason: 'Budget' }).expect(201);
    await manager.agent.post('/crm/deals').set(H()).send({ title: 'Open one', value: 10000, stageId: pipelines[0]!.stages.find((s) => s.name === 'Proposal sent')!.id }).expect(201);
    await manager.agent.post('/crm/activities').set(H()).send({ kind: 'call', subject: 'Intro call', dealId: conv.dealId }).expect(201);

    const r = (await manager.agent.get('/reports/sales').set(H()).expect(200)).body as SalesReportDto;
    // Won: Beta site, Euro job, Acme phase 2 (owner) and the Upwork one; lost: one.
    expect(r.won.count).toBe(4);
    expect(r.lost.count).toBe(1);
    expect(r.winRate).toBe(80);
    expect(r.sources.find((s) => s.source === 'upwork')).toMatchObject({ leads: 1, converted: 1, won: 1, wonValue: [{ currency: 'PKR', value: 50000 }] });
    expect(r.sources.find((s) => s.source === 'direct')).toMatchObject({ won: 3 });
    expect(r.stages.find((s) => s.stage === 'Proposal sent')).toMatchObject({ count: 1, value: [{ currency: 'PKR', value: 10000 }] });
    expect(r.weighted).toEqual([{ currency: 'PKR', value: 5000 }]);
    expect(r.lostReasons).toEqual([{ reason: 'Budget', count: 1 }]);
    expect(r.people.find((p) => p.person.id === manager.user.id)).toMatchObject({ calls: 1, won: 1, open: 1 });
  });
});

describe('dashboard', () => {
  it('shows managers the team’s day and everyone their own', async () => {
    const board = (await owner.agent.get(`/projects/${ids.betaProject}`).set(H()).expect(200)).body as { columns: { id: string }[] };
    const task = (await owner.agent.post(`/projects/${ids.betaProject}/tasks`).set(H()).send({ title: 'Late thing', columnId: board.columns[0]!.id }).expect(201)).body as { id: string };
    await owner.agent.patch(`/tasks/${task.id}`).set(H()).send({ dueDate: '2026-01-05', assigneeIds: [dev.user.id] }).expect(200);

    const mine = (await dev.agent.get('/dashboard').set(H()).expect(200)).body as DashboardDto;
    expect(mine.team).toBeNull();
    expect(mine.me).toMatchObject({ tasksOverdue: 1, myOverdue: [expect.objectContaining({ title: 'Late thing', projectName: 'Beta site' })] });

    const team = (await owner.agent.get('/dashboard').set(H()).expect(200)).body as DashboardDto;
    expect(team.team).toMatchObject({ activeProjects: 3, overdueTasks: 1, attendance: { away: 4 } });
    expect(team.team!.openPipeline).toEqual([{ currency: 'PKR', value: 10000 }]);
  });
});
