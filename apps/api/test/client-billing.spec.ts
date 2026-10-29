import type { INestApplication } from '@nestjs/common';
import { WORKSPACE_HEADER, type ClientDocSummaryDto, type ClientDocumentDto, type UnbilledProjectDto } from '@workhub/shared';
import { createApp, signUp, withAdmin } from './helpers';

let app: INestApplication;

beforeAll(async () => {
  app = await createApp();
});

afterAll(async () => {
  await app.close();
});

type Agent = Awaited<ReturnType<typeof signUp>>;

async function addMember(owner: Agent, prefix: string, role: string) {
  const person = await signUp(app, prefix, `${prefix} own`);
  await withAdmin((db) => db.query('insert into memberships (workspace_id, user_id, role) values ($1, $2, $3)', [owner.workspace.id, person.user.id, role]));
  return person;
}

async function company(owner: Agent, name: string): Promise<string> {
  return withAdmin(async (db) => (await db.query('insert into companies (workspace_id, name, email) values ($1, $2, $3) returning id', [owner.workspace.id, name, 'ap@client.example'])).rows[0].id as string);
}

async function project(owner: Agent, clientId: string, name: string, rate: number | null, currency: string | null): Promise<string> {
  return withAdmin(
    async (db) =>
      (await db.query('insert into projects (workspace_id, name, client_id, hourly_rate, rate_currency) values ($1, $2, $3, $4, $5) returning id', [owner.workspace.id, name, clientId, rate, currency])).rows[0]
        .id as string,
  );
}

/** Time on a project; with `approved`, the person's timesheet for that week is approved. */
async function logTime(owner: Agent, projectId: string, userId: string, workDate: string, minutes: number, opts: { approved?: boolean; billable?: boolean } = {}) {
  await withAdmin(async (db) => {
    await db.query('insert into time_entries (workspace_id, project_id, user_id, work_date, minutes, billable) values ($1, $2, $3, $4, $5, $6)', [owner.workspace.id, projectId, userId, workDate, minutes, opts.billable ?? true]);
    if (opts.approved) {
      // Monday of that week.
      await db.query(
        `insert into timesheets (workspace_id, user_id, week_start, status, decided_at) values ($1, $2, $3::date - (extract(isodow from $3::date)::int - 1), 'approved', now())
         on conflict (workspace_id, user_id, week_start) do update set status = 'approved'`,
        [owner.workspace.id, userId, workDate],
      );
    }
  });
}

const quote = (companyId: string) => ({
  kind: 'quote',
  companyId,
  currency: 'USD',
  issueDate: '2027-06-01',
  dueDate: '2027-06-30',
  notes: 'Valid for 30 days.',
  taxRate: 0,
  lines: [
    { description: 'Website redesign', quantity: 1, unitPrice: 2500 },
    { description: 'Hosting setup', quantity: 3, unitPrice: 33.335 },
  ],
});

describe('Quotes and invoices to clients', () => {
  it('numbers quotes, works out totals, and turns an accepted quote into an invoice', async () => {
    const owner = await signUp(app, 'qowner', 'Quote Co');
    const H = [WORKSPACE_HEADER, owner.workspace.id] as const;
    const client = await company(owner, 'Northwind');

    const q = (await owner.agent.post('/client-docs').set(...H).send(quote(client)).expect(201)).body as ClientDocumentDto;
    expect(q).toMatchObject({ kind: 'quote', number: 'Q-0001', status: 'draft', currency: 'USD', subtotal: 2600.02, taxAmount: 0, total: 2600.02, company: { name: 'Northwind' }, client: { email: 'ap@client.example' } });
    expect(q.lines.map((l) => l.amount)).toEqual([2500, 100.02]); // 33.335 is stored as 33.34
    const q2 = (await owner.agent.post('/client-docs').set(...H).send({ ...quote(client), taxRate: 16, taxLabel: 'Sales tax (Punjab)' }).expect(201)).body as ClientDocumentDto;
    expect(q2).toMatchObject({ number: 'Q-0002', taxAmount: 416, total: 3016.02 });

    // Only drafts change; status moves follow the rules.
    await owner.agent.post(`/client-docs/${q.id}/invoice`).set(...H).expect(409);
    await owner.agent.post(`/client-docs/${q.id}/status`).set(...H).send({ status: 'paid' }).expect(409);
    await owner.agent.post(`/client-docs/${q.id}/status`).set(...H).send({ status: 'sent' }).expect(200);
    await owner.agent.patch(`/client-docs/${q.id}`).set(...H).send(quote(client)).expect(409);
    await owner.agent.delete(`/client-docs/${q.id}`).set(...H).expect(409);
    const accepted = (await owner.agent.post(`/client-docs/${q.id}/status`).set(...H).send({ status: 'accepted' }).expect(200)).body as ClientDocumentDto;
    expect(accepted.sentAt).not.toBeNull();

    const inv = (await owner.agent.post(`/client-docs/${q.id}/invoice`).set(...H).expect(201)).body as ClientDocumentDto;
    expect(inv).toMatchObject({ kind: 'invoice', number: 'INV-0001', status: 'draft', quoteId: q.id, total: 2600.02 });
    await owner.agent.post(`/client-docs/${q.id}/invoice`).set(...H).expect(409);
    expect(((await owner.agent.get(`/client-docs/${q.id}`).set(...H).expect(200)).body as ClientDocumentDto).invoiceId).toBe(inv.id);

    await owner.agent.post(`/client-docs/${inv.id}/status`).set(...H).send({ status: 'sent' }).expect(200);
    const paid = (await owner.agent.post(`/client-docs/${inv.id}/status`).set(...H).send({ status: 'paid' }).expect(200)).body as ClientDocumentDto;
    expect(paid.paidAt).not.toBeNull();

    const quotes = (await owner.agent.get('/client-docs').query({ kind: 'quote' }).set(...H).expect(200)).body as ClientDocSummaryDto[];
    expect(quotes.map((d) => d.number).sort()).toEqual(['Q-0001', 'Q-0002']);
  });

  it('lets drafts be edited and deleted, and shows sent invoices past due as overdue', async () => {
    const owner = await signUp(app, 'downer', 'Draft Co');
    const H = [WORKSPACE_HEADER, owner.workspace.id] as const;
    const client = await company(owner, 'Bluefin');
    const inv = (await owner.agent.post('/client-docs').set(...H).send({ ...quote(client), kind: 'invoice', dueDate: '2020-01-31', issueDate: '2020-01-01' }).expect(201)).body as ClientDocumentDto;
    const edited = (await owner.agent.patch(`/client-docs/${inv.id}`).set(...H).send({ ...quote(client), dueDate: '2020-01-31', issueDate: '2020-01-01', lines: [{ description: 'Retainer', quantity: 1, unitPrice: 900 }] }).expect(200)).body as ClientDocumentDto;
    expect(edited).toMatchObject({ total: 900, overdue: false });
    await owner.agent.patch(`/client-docs/${inv.id}`).set(...H).send({ ...quote(client), lines: [] }).expect(400);
    const sent = (await owner.agent.post(`/client-docs/${inv.id}/status`).set(...H).send({ status: 'sent' }).expect(200)).body as ClientDocumentDto;
    expect(sent.overdue).toBe(true);

    const draft = (await owner.agent.post('/client-docs').set(...H).send(quote(client)).expect(201)).body as ClientDocumentDto;
    await owner.agent.delete(`/client-docs/${draft.id}`).set(...H).expect(204);
    await owner.agent.get(`/client-docs/${draft.id}`).set(...H).expect(404);
  });

  it('is for managers and up, and stays inside its workspace', async () => {
    const owner = await signUp(app, 'iowner', 'Isolated Co');
    const H = [WORKSPACE_HEADER, owner.workspace.id] as const;
    const client = await company(owner, 'Atlas');
    const member = await addMember(owner, 'imember', 'member');
    const manager = await addMember(owner, 'imanager', 'manager');
    const rival = await signUp(app, 'irival', 'Rival Co');
    const RH = [WORKSPACE_HEADER, rival.workspace.id] as const;

    const doc = (await manager.agent.post('/client-docs').set(...H).send(quote(client)).expect(201)).body as ClientDocumentDto;
    await member.agent.get('/client-docs').set(...H).expect(403);
    await member.agent.get(`/client-docs/${doc.id}`).set(...H).expect(403);

    await rival.agent.get(`/client-docs/${doc.id}`).set(...RH).expect(404);
    await rival.agent.post(`/client-docs/${doc.id}/status`).set(...RH).send({ status: 'sent' }).expect(404);
    await rival.agent.delete(`/client-docs/${doc.id}`).set(...RH).expect(404);
    expect((await rival.agent.get('/client-docs').set(...RH).expect(200)).body).toEqual([]);
    // Another workspace's client can't be billed.
    await rival.agent.post('/client-docs').set(...RH).send(quote(client)).expect(400);
    // Numbers are counted per workspace.
    const theirs = (await rival.agent.post('/client-docs').set(...RH).send(quote(await company(rival, 'Theirs'))).expect(201)).body as ClientDocumentDto;
    expect(theirs.number).toBe('Q-0001');
  });
});

describe('Invoices from timesheet hours', () => {
  it('bills approved, billable hours once, at the project rate', async () => {
    const owner = await signUp(app, 'howner', 'Hours Co');
    const H = [WORKSPACE_HEADER, owner.workspace.id] as const;
    const member = await addMember(owner, 'hmember', 'member');
    const client = await company(owner, 'Crescent');
    const site = await project(owner, client, 'Website', 25, 'USD');
    const app2 = await project(owner, client, 'Mobile app', 30, 'USD');
    const norate = await project(owner, client, 'Support', null, null);
    const pkr = await project(owner, client, 'Local campaign', 5000, 'PKR');

    await logTime(owner, site, member.user.id, '2027-06-07', 90, { approved: true });
    await logTime(owner, site, member.user.id, '2027-06-08', 30, { approved: true });
    await logTime(owner, site, member.user.id, '2027-06-09', 60, { approved: true, billable: false }); // not billable
    await logTime(owner, site, owner.user.id, '2027-06-08', 600); // timesheet not approved
    await logTime(owner, site, member.user.id, '2027-07-01', 60, { approved: true }); // outside the dates
    await logTime(owner, app2, member.user.id, '2027-06-10', 45, { approved: true });
    await logTime(owner, norate, member.user.id, '2027-06-10', 60, { approved: true });
    await logTime(owner, pkr, member.user.id, '2027-06-10', 60, { approved: true });

    const range = { companyId: client, from: '2027-06-01', to: '2027-06-30' };
    const unbilled = (await owner.agent.get('/client-docs/unbilled').query(range).set(...H).expect(200)).body as UnbilledProjectDto[];
    expect(unbilled.find((p) => p.projectId === site)).toMatchObject({ hours: 2, entries: 2, rate: 25, currency: 'USD', amount: 50 });
    expect(unbilled.find((p) => p.projectId === app2)).toMatchObject({ hours: 0.75, amount: 22.5 });
    expect(unbilled.find((p) => p.projectId === norate)).toMatchObject({ rate: null, amount: null });

    const body = { ...range, currency: 'USD', issueDate: '2027-07-01', dueDate: '2027-07-15', taxRate: 0 };
    const noRate = await owner.agent.post('/client-docs/from-hours').set(...H).send({ ...body, projectIds: [site, norate] }).expect(400);
    expect(noRate.body.message).toContain('Support');
    await owner.agent.post('/client-docs/from-hours').set(...H).send({ ...body, projectIds: [site, pkr] }).expect(400);

    const inv = (await owner.agent.post('/client-docs/from-hours').set(...H).send({ ...body, projectIds: [site, app2] }).expect(201)).body as ClientDocumentDto;
    expect(inv).toMatchObject({ kind: 'invoice', status: 'draft', billedHours: 2.75, subtotal: 72.5, total: 72.5 });
    expect(inv.lines).toEqual([
      expect.objectContaining({ description: 'Mobile app: hours worked, 2027-06-01 to 2027-06-30', quantity: 0.75, unitPrice: 30, projectId: app2 }),
      expect.objectContaining({ description: 'Website: hours worked, 2027-06-01 to 2027-06-30', quantity: 2, unitPrice: 25, projectId: site }),
    ]);

    // Billed once: those hours are gone from the unbilled list, and can't go on a second invoice.
    const after = (await owner.agent.get('/client-docs/unbilled').query(range).set(...H).expect(200)).body as UnbilledProjectDto[];
    expect(after.map((p) => p.projectId).sort()).toEqual([norate, pkr].sort());
    await owner.agent.post('/client-docs/from-hours').set(...H).send({ ...body, projectIds: [site] }).expect(400);

    // Its client can't change while it bills hours.
    const other = await company(owner, 'Other client');
    await owner.agent.patch(`/client-docs/${inv.id}`).set(...H).send({ ...body, companyId: other, lines: [{ description: 'x', quantity: 1, unitPrice: 1 }] }).expect(409);

    // Voiding gives the hours back.
    await owner.agent.post(`/client-docs/${inv.id}/status`).set(...H).send({ status: 'sent' }).expect(200);
    await owner.agent.post(`/client-docs/${inv.id}/status`).set(...H).send({ status: 'void' }).expect(200);
    const back = (await owner.agent.get('/client-docs/unbilled').query(range).set(...H).expect(200)).body as UnbilledProjectDto[];
    expect(back.find((p) => p.projectId === site)?.hours).toBe(2);
  });
});
