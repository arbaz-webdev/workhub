import type { INestApplication } from '@nestjs/common';
import { WORKSPACE_HEADER, type ClientDocumentDto, type CompanyPortalDto, type MeResponse, type PortalDto } from '@workhub/shared';
import { createApp, inviteTokenFrom, lastEmailTo, signUp, signUpWithoutWorkspace, uniqueEmail, withAdmin } from './helpers';

let app: INestApplication;

beforeAll(async () => {
  app = await createApp();
});

afterAll(async () => {
  await app.close();
});

type Agent = Awaited<ReturnType<typeof signUp>>;

const q = (sql: string, params: unknown[]) => withAdmin(async (db) => (await db.query(sql, params)).rows);

async function addMember(owner: Agent, prefix: string, role: string, clientCompanyId: string | null = null) {
  const person = await signUp(app, prefix, `${prefix} own`);
  await q('insert into memberships (workspace_id, user_id, role, client_company_id) values ($1, $2, $3, $4)', [owner.workspace.id, person.user.id, role, clientCompanyId]);
  return person;
}

async function setup() {
  const owner = await signUp(app, 'powner', 'Portal Co');
  const ws = owner.workspace.id;
  const [a] = await q("insert into companies (workspace_id, name) values ($1, 'Alpha') returning id", [ws]);
  const [b] = await q("insert into companies (workspace_id, name) values ($1, 'Beta') returning id", [ws]);
  const project = async (name: string, client: string, visible: boolean) => (await q('insert into projects (workspace_id, name, client_id, portal_visible, budget_hours) values ($1, $2, $3, $4, 40) returning id', [ws, name, client, visible]))[0].id as string;
  const a1 = await project('Alpha website', a.id, true);
  const a2 = await project('Alpha internal', a.id, false);
  const b1 = await project('Beta app', b.id, true);

  // Board: three columns, four tasks on a1, one of them done and one due soon.
  const cols: string[] = [];
  for (const [i, name] of ['To do', 'Doing', 'Done'].entries()) cols.push((await q('insert into board_columns (workspace_id, project_id, name, position) values ($1, $2, $3, $4) returning id', [ws, a1, name, i]))[0].id);
  const task = (title: string, col: string, done: boolean, due: string | null = null) =>
    q('insert into tasks (workspace_id, project_id, column_id, title, position, completed_at, due_date) values ($1, $2, $3, $4, 0, $5, $6)', [ws, a1, col, title, done ? new Date() : null, due]);
  await task('Design', cols[2]!, true);
  await task('Build pages', cols[1]!, false, new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10));
  await task('Copy', cols[0]!, false);
  await task('Launch', cols[0]!, false);

  // Approved and unapproved time on a1, approved time on the hidden a2.
  const thisMonday = (await q("select (current_date - (extract(isodow from current_date)::int - 1))::text as d", []))[0].d as string;
  await q('insert into time_entries (workspace_id, project_id, user_id, work_date, minutes) values ($1, $2, $3, $4, 150), ($1, $5, $3, $4, 600)', [ws, a1, owner.user.id, thisMonday, a2]);
  await q("insert into timesheets (workspace_id, user_id, week_start, status) values ($1, $2, $3, 'approved')", [ws, owner.user.id, thisMonday]);

  // Documents: one sent invoice and one draft for Alpha, one sent for Beta.
  const doc = async (company: string, number: string, status: string) =>
    (await q("insert into client_documents (workspace_id, kind, number, company_id, status, currency, issue_date, total) values ($1, 'invoice', $2, $3, $4, 'USD', current_date, 100) returning id", [ws, number, company, status]))[0].id as string;
  const sent = await doc(a.id, 'INV-0001', 'sent');
  const draft = await doc(a.id, 'INV-0002', 'draft');
  const betaDoc = await doc(b.id, 'INV-0003', 'sent');
  return { owner, ws, a: a.id as string, b: b.id as string, a1, a2, b1, sent, draft, betaDoc, thisMonday };
}

describe('Client portal', () => {
  it('invites a client contact who then sees only that client’s shared work', async () => {
    const s = await setup();
    const H = [WORKSPACE_HEADER, s.ws] as const;
    const email = uniqueEmail('contact');

    const after = (await s.owner.agent.post(`/portal/companies/${s.a}/invite`).set(...H).send({ email }).expect(201)).body as CompanyPortalDto;
    expect(after.invites.map((i) => i.email)).toEqual([email]);
    const message = lastEmailTo(email);
    expect(message?.subject).toContain('Alpha');

    const contact = await signUpWithoutWorkspace(app, 'contact', email);
    const joined = await contact.agent.post('/invitations/accept').send({ token: inviteTokenFrom(message?.text) }).expect(201);
    expect(joined.body).toMatchObject({ role: 'guest', clientCompanyId: s.a });
    const me = (await contact.agent.get('/auth/me').expect(200)).body as MeResponse;
    expect(me.workspaces[0]).toMatchObject({ role: 'guest', clientCompanyId: s.a });

    // Only Alpha's shared project, its progress and approved hours.
    const portal = (await contact.agent.get('/portal').set(...H).expect(200)).body as PortalDto;
    expect(portal.company.name).toBe('Alpha');
    expect(portal.projects.map((p) => p.name)).toEqual(['Alpha website']);
    expect(portal.projects[0]).toMatchObject({
      tasks: { total: 4, done: 1, percent: 25 },
      columns: [
        { name: 'To do', open: 2 },
        { name: 'Doing', open: 1 },
        { name: 'Done', open: 0 },
      ],
      budgetHours: 40,
      approvedHours: 2.5,
      upcoming: [expect.objectContaining({ title: 'Build pages' })],
    });
    expect(portal.hoursByMonth).toHaveLength(6);
    // This week's Monday can fall in last month, early in a month.
    expect(portal.hoursByMonth.find((m) => m.month === s.thisMonday.slice(0, 7))!.hours).toBe(2.5); // not the hidden project's 10 hours

    // Sent documents only, and only Alpha's; asking for Beta changes nothing.
    expect(portal.documents.map((d) => d.number)).toEqual(['INV-0001']);
    expect(((await contact.agent.get('/portal').query({ companyId: s.b }).set(...H).expect(200)).body as PortalDto).company.name).toBe('Alpha');
    expect(((await contact.agent.get(`/portal/docs/${s.sent}`).set(...H).expect(200)).body as ClientDocumentDto).number).toBe('INV-0001');
    await contact.agent.get(`/portal/docs/${s.draft}`).set(...H).expect(404);
    await contact.agent.get(`/portal/docs/${s.betaDoc}`).set(...H).expect(404);

    // A contact isn't staff.
    await contact.agent.get('/client-docs').set(...H).expect(403);
    await contact.agent.get(`/portal/companies/${s.a}`).set(...H).expect(403);
    await contact.agent.post(`/portal/projects/${s.a2}/visibility`).set(...H).send({ visible: true }).expect(403);

    // Removing them ends their access.
    await s.owner.agent.delete(`/portal/companies/${s.a}/people/${contact.user.id}`).set(...H).expect(200);
    await contact.agent.get('/portal').set(...H).expect(403);
  });

  it('is for client contacts, with a preview for managers', async () => {
    const s = await setup();
    const H = [WORKSPACE_HEADER, s.ws] as const;
    const member = await addMember(s.owner, 'pmember', 'member');
    const manager = await addMember(s.owner, 'pmanager', 'manager');
    const guest = await addMember(s.owner, 'pguest', 'guest');

    await member.agent.get('/portal').query({ companyId: s.a }).set(...H).expect(403);
    await guest.agent.get('/portal').set(...H).expect(403);
    await manager.agent.get('/portal').set(...H).expect(400);
    const preview = (await manager.agent.get('/portal').query({ companyId: s.b }).set(...H).expect(200)).body as PortalDto;
    expect(preview.projects.map((p) => p.name)).toEqual(['Beta app']);
    expect(preview.documents.map((d) => d.number)).toEqual(['INV-0003']);

    // Sharing a project; members can't.
    await member.agent.post(`/portal/projects/${s.a2}/visibility`).set(...H).send({ visible: true }).expect(403);
    const shared = (await manager.agent.post(`/portal/projects/${s.a2}/visibility`).set(...H).send({ visible: true }).expect(200)).body as CompanyPortalDto;
    expect(shared.projects.filter((p) => p.portalVisible).map((p) => p.name)).toEqual(['Alpha internal', 'Alpha website']);
    const [noClient] = await q("insert into projects (workspace_id, name) values ($1, 'No client') returning id", [s.ws]);
    await manager.agent.post(`/portal/projects/${noClient.id}/visibility`).set(...H).send({ visible: true }).expect(400);

    // Inviting: staff can't be contacts; an existing guest is linked at once. Managers can't invite.
    await manager.agent.post(`/portal/companies/${s.a}/invite`).set(...H).send({ email: uniqueEmail('x') }).expect(403);
    await s.owner.agent.post(`/portal/companies/${s.a}/invite`).set(...H).send({ email: member.email }).expect(409);
    const linked = (await s.owner.agent.post(`/portal/companies/${s.a}/invite`).set(...H).send({ email: guest.email }).expect(201)).body as CompanyPortalDto;
    expect(linked.people.map((p) => p.email)).toEqual([guest.email]);
    expect(((await guest.agent.get('/portal').set(...H).expect(200)).body as PortalDto).company.name).toBe('Alpha');

    // Making a contact a member ends the link.
    await s.owner.agent.patch(`/members/${guest.user.id}`).set(...H).send({ role: 'member' }).expect(200);
    const [m] = await q('select client_company_id from memberships where workspace_id = $1 and user_id = $2', [s.ws, guest.user.id]);
    expect(m.client_company_id).toBeNull();
  });

  it('keeps each workspace’s clients apart', async () => {
    const s = await setup();
    const rival = await signUp(app, 'prival', 'Rival');
    const RH = [WORKSPACE_HEADER, rival.workspace.id] as const;
    await rival.agent.get('/portal').query({ companyId: s.a }).set(...RH).expect(400);
    await rival.agent.get(`/portal/companies/${s.a}`).set(...RH).expect(404);
    await rival.agent.post(`/portal/projects/${s.a1}/visibility`).set(...RH).send({ visible: false }).expect(404);
    await rival.agent.post(`/portal/companies/${s.a}/invite`).set(...RH).send({ email: uniqueEmail('y') }).expect(404);
    await rival.agent.get(`/portal/docs/${s.sent}`).set(...RH).query({ companyId: s.a }).expect(400);
  });
});
