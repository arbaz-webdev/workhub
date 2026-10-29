import type { INestApplication } from '@nestjs/common';
import { WORKSPACE_HEADER, type InvoiceDto, type OnboardingDto, type OnboardingResultDto, type PipelineDto, type SubscriptionDto, type TransferReviewDto } from '@workhub/shared';
import { randomUUID } from 'node:crypto';
import { priceFor } from '../src/billing/plans';
import { devOutbox } from '../src/email/email.service';
import { createApp, signUp, withAdmin } from './helpers';

let app: INestApplication;
let owner: Awaited<ReturnType<typeof signUp>>;
let member: Awaited<ReturnType<typeof signUp>>;
let staff: Awaited<ReturnType<typeof signUp>>;
let rival: Awaited<ReturnType<typeof signUp>>;
let ws: string;
const H = () => ({ [WORKSPACE_HEADER]: ws });
const env = { ...process.env };

async function join_(person: typeof owner, role: string) {
  await withAdmin((db) => db.query('insert into memberships (workspace_id, user_id, role) values ($1, $2, $3)', [ws, person.user.id, role]));
}

async function subscription(agent = owner.agent) {
  return (await agent.get('/billing/subscription').set(H()).expect(200)).body as SubscriptionDto;
}

const details = { billingName: 'Numbers (Pvt) Ltd', billingEmail: 'accounts@numbers.pk', ntn: '1234567-8', province: 'punjab', address: 'Gulberg III, Lahore' };

beforeAll(async () => {
  app = await createApp();
  owner = await signUp(app, 'owner', 'Billing Co');
  ws = owner.workspace.id;
  member = await signUp(app, 'member', 'Mem home');
  staff = await signUp(app, 'staff', 'WorkHub HQ');
  rival = await signUp(app, 'rival', 'Rival Co');
  await join_(member, 'member');
});

afterAll(async () => {
  process.env = env;
  await app.close();
});

describe('plans', () => {
  it('starts a new workspace on a two-week trial of everything', async () => {
    const s = await subscription();
    expect(s).toMatchObject({ plan: 'business', status: 'trial', seatLimit: null, seatsUsed: 2, enforced: true, features: ['profitability', 'custom_fields', 'pipelines', 'api'] });
    const days = (new Date(s.trialEndsAt!).getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(13.9);
    // Everyone can see the plan; only owners and admins manage billing.
    expect((await subscription(member.agent)).plan).toBe('business');
    await member.agent.get('/billing/invoices').set(H()).expect(403);
  });

  it('after the trial, Free allows 10 people (guests don’t count) and no Business features', async () => {
    await withAdmin((db) => db.query("update subscriptions set trial_ends_at = now() - interval '1 day' where workspace_id = $1", [ws]));
    // Eight more people: ten seats taken.
    await withAdmin(async (db) => {
      for (let i = 0; i < 8; i++) {
        const id = randomUUID();
        await db.query(`insert into users (id, email, name) values ($1, $2, 'Filler')`, [id, `filler-${id}@example.com`]);
        await db.query(`insert into memberships (workspace_id, user_id, role) values ($1, $2, 'member')`, [ws, id]);
      }
    });
    const s = await subscription();
    expect(s).toMatchObject({ plan: 'free', status: 'free', seatsUsed: 10, seatLimit: 10, features: [] });

    const refused = await owner.agent.post('/invitations').set(H()).send({ emails: ['eleventh@example.com'], role: 'member' }).expect(403);
    expect(refused.body.message).toMatch(/up to 10 people/);
    await owner.agent.post('/invitations/link').set(H()).send({ role: 'member' }).expect(403);
    await owner.agent.post('/invitations').set(H()).send({ emails: ['client@example.com'], role: 'guest' }).expect(201);
    await owner.agent.post('/crm/fields').set(H()).send({ entity: 'lead', label: 'Budget', type: 'number' }).expect(403);
    await owner.agent.post('/crm/pipelines').set(H()).send({ name: 'Second', stages: [{ name: 'A', probability: 10 }] }).expect(403);
    await owner.agent.get('/reports/profitability').set(H()).expect(403);
    // Core modules stay open.
    await owner.agent.get('/reports/utilisation').set(H()).expect(200);
  });

  it('opens everything while billing is switched off (the free beta)', async () => {
    process.env.BILLING_ENFORCED = 'false';
    try {
      expect(await subscription()).toMatchObject({ plan: 'business', enforced: false, seatLimit: null });
      await owner.agent.get('/reports/profitability').set(H()).expect(200);
    } finally {
      delete process.env.BILLING_ENFORCED;
    }
  });
});

describe('invoices', () => {
  it('prices per person, with two months free on annual plans, and ends a day before the same date', () => {
    expect(priceFor('starter', 'monthly', 10, 'punjab', '2027-01-15')).toMatchObject({ subtotal: 6990, taxRate: 16, taxAmount: 1118.4, total: 8108.4, periodEnd: '2027-02-14' });
    expect(priceFor('business', 'annual', 3, 'sindh', '2027-03-01')).toMatchObject({ subtotal: 38970, taxRate: 15, total: 44815.5, periodEnd: '2028-02-29' });
    expect(priceFor('starter', 'monthly', 1, 'outside', '2027-01-31')).toMatchObject({ taxLabel: null, total: 699, periodEnd: '2027-02-27' });
  });

  it('needs billing details, then issues a numbered PKR invoice with the provincial tax line', async () => {
    await owner.agent.post('/billing/checkout').set(H()).send({ plan: 'starter', cycle: 'monthly' }).expect(400);
    await owner.agent.patch('/billing/details').set(H()).send({ ...details, ntn: 'abc' }).expect(400);
    await owner.agent.patch('/billing/details').set(H()).send(details).expect(200);
    const inv = (await owner.agent.post('/billing/checkout').set(H()).send({ plan: 'starter', cycle: 'monthly' }).expect(201)).body as InvoiceDto;
    expect(inv.number).toMatch(/^WH-\d{4}-\d{6}$/);
    expect(inv).toMatchObject({ status: 'open', seats: 10, unitPrice: 699, months: 1, subtotal: 6990, taxRate: 16, taxAmount: 1118.4, total: 8108.4, currency: 'PKR', billTo: { name: 'Numbers (Pvt) Ltd', ntn: '1234567-8', province: 'punjab', workspace: 'Billing Co' } });
    expect(inv.taxLabel).toBe('Sales tax on services, Punjab (16%)');
    // A new checkout replaces an unpaid invoice.
    const again = (await owner.agent.post('/billing/checkout').set(H()).send({ plan: 'starter', cycle: 'monthly' }).expect(201)).body as InvoiceDto;
    const list = (await owner.agent.get('/billing/invoices').set(H()).expect(200)).body as InvoiceDto[];
    expect(list.map((i) => [i.id, i.status])).toEqual([
      [again.id, 'open'],
      [inv.id, 'void'],
    ]);
    await rival.agent.get(`/billing/invoices/${again.id}`).set(WORKSPACE_HEADER, rival.workspace.id).expect(404);
  });

  it('pays online (test gateway) and moves the workspace onto the plan', async () => {
    const [inv] = (await owner.agent.get('/billing/invoices').set(H()).expect(200)).body as InvoiceDto[];
    const pay = await owner.agent.post(`/billing/invoices/${inv!.id}/pay`).set(H()).expect(201);
    expect(pay.body.url).toBe(`/app/settings/billing/test-checkout?invoice=${inv!.id}`);
    const paid = (await owner.agent.post(`/billing/invoices/${inv!.id}/test-pay`).set(H()).expect(201)).body as InvoiceDto;
    expect(paid).toMatchObject({ status: 'paid', paymentMethod: 'test', paidAt: expect.any(String) });
    await owner.agent.post(`/billing/invoices/${inv!.id}/test-pay`).set(H()).expect(409);
    expect(await subscription()).toMatchObject({ plan: 'starter', status: 'active', paidPlan: 'starter', paidUntil: inv!.periodEnd, seatLimit: null });
    expect(devOutbox.at(-1)).toMatchObject({ to: 'accounts@numbers.pk', subject: `Payment received: ${inv!.number}` });
    // Starter has no people limit.
    await owner.agent.post('/invitations').set(H()).send({ emails: ['eleventh@example.com'], role: 'member' }).expect(201);
  });

  it('takes bank transfers for annual plans, which WorkHub staff confirm', async () => {
    process.env.BANK_IBAN = 'PK36SCBL0000001123456702';
    process.env.PLATFORM_ADMINS = staff.email;
    await withAdmin((db) => db.query('update users set email_verified_at = now() where id = $1', [staff.user.id]));

    const monthly = (await owner.agent.post('/billing/checkout').set(H()).send({ plan: 'business', cycle: 'monthly' }).expect(201)).body as InvoiceDto;
    await owner.agent.post(`/billing/invoices/${monthly.id}/bank-transfer`).set(H()).field('reference', 'FT123').attach('proof', Buffer.from('%PDF-1.4'), { filename: 'r.pdf', contentType: 'application/pdf' }).expect(400);

    const annual = (await owner.agent.post('/billing/checkout').set(H()).send({ plan: 'business', cycle: 'annual' }).expect(201)).body as InvoiceDto;
    // Ten seats (the invited eleventh person hasn't joined yet), ten months' price.
    expect(annual).toMatchObject({ months: 12, unitPrice: 1299, subtotal: 1299 * 10 * 10 });
    await owner.agent.post(`/billing/invoices/${annual.id}/bank-transfer`).set(H()).field('reference', 'FT123').attach('proof', Buffer.from('<html>'), { filename: 'x.html', contentType: 'text/html' }).expect(400);
    const sent = (await owner.agent
      .post(`/billing/invoices/${annual.id}/bank-transfer`)
      .set(H())
      .field('reference', 'IBFT 99812')
      .attach('proof', Buffer.from('%PDF-1.4 receipt'), { filename: 'receipt.pdf', contentType: 'application/pdf' })
      .expect(201)).body as InvoiceDto;
    expect(sent).toMatchObject({ status: 'pending_review', transferReference: 'IBFT 99812' });
    await owner.agent.post('/billing/checkout').set(H()).send({ plan: 'business', cycle: 'annual' }).expect(409);

    await owner.agent.get('/platform/transfers').expect(403);
    const queue = (await staff.agent.get('/platform/transfers').expect(200)).body as TransferReviewDto[];
    const mine = queue.find((t) => t.id === annual.id)!;
    expect(mine).toMatchObject({ workspaceName: 'Billing Co', proofUrl: `/platform/transfers/${annual.id}/proof` });
    const proof = await staff.agent.get(mine.proofUrl!).expect(200);
    expect(proof.headers['content-disposition']).toMatch(/^attachment/);

    await staff.agent.post(`/platform/transfers/${annual.id}/review`).set(H()).send({ approve: false, note: 'Amount doesn’t match' }).expect(201);
    const back = (await owner.agent.get(`/billing/invoices/${annual.id}`).set(H()).expect(200)).body as InvoiceDto;
    expect(back).toMatchObject({ status: 'open', reviewNote: 'Amount doesn’t match' });

    await owner.agent.post(`/billing/invoices/${annual.id}/bank-transfer`).set(H()).field('reference', 'IBFT 99813').attach('proof', Buffer.from('%PDF'), { filename: 'r.pdf', contentType: 'application/pdf' }).expect(201);
    const ok = (await staff.agent.post(`/platform/transfers/${annual.id}/review`).send({ approve: true }).expect(201)).body as InvoiceDto;
    expect(ok).toMatchObject({ status: 'paid', paymentMethod: 'bank_transfer' });
    expect(await subscription()).toMatchObject({ plan: 'business', billingCycle: 'annual', paidUntil: annual.periodEnd });
    await staff.agent.post(`/platform/transfers/${annual.id}/review`).send({ approve: true }).expect(409);
  });
});

describe('onboarding', () => {
  it('sets up a BPO with a night shift, teams, holidays and its pipeline, once', async () => {
    const fresh = await signUp(app, 'founder', 'Night Calls');
    const FH = { [WORKSPACE_HEADER]: fresh.workspace.id };
    const status = (await fresh.agent.get('/onboarding').set(FH).expect(200)).body as OnboardingDto;
    expect(status.done).toBe(false);
    const preset = status.presets.bpo;
    expect(preset.shift).toMatchObject({ name: 'Night shift', startTime: '20:00' });

    const body = { industry: 'bpo', timezone: 'Asia/Karachi', currency: 'PKR', workingDays: [1, 2, 3, 4, 5], shift: preset.shift, teams: preset.teams, loadHolidays: true, sampleProject: true };
    const result = (await fresh.agent.post('/onboarding').set(FH).send(body).expect(201)).body as OnboardingResultDto;
    expect(result.teams).toBe(4);
    expect(result.holidays).toBeGreaterThan(5);
    expect(result.projectId).toBeNull();

    expect(((await fresh.agent.get('/onboarding').set(FH).expect(200)).body as OnboardingDto).done).toBe(true);
    const { shifts } = (await fresh.agent.get('/attendance/settings').set(FH).expect(200)).body as { shifts: { name: string; isDefault: boolean }[] };
    expect(shifts).toEqual([expect.objectContaining({ name: 'Night shift', isDefault: true })]);
    const [pipeline] = (await fresh.agent.get('/crm/pipelines').set(FH).expect(200)).body as PipelineDto[];
    expect(pipeline!.stages.map((s) => s.name)).toEqual(['New', 'Requirements', 'Pilot', 'Contract', 'Won', 'Lost']);

    const twice = (await fresh.agent.post('/onboarding').set(FH).send(body).expect(201)).body as OnboardingResultDto;
    expect(twice).toMatchObject({ teams: 0, holidays: 0 });
  });

  it('gives a software house a sample project from its template', async () => {
    const fresh = await signUp(app, 'cto', 'Code Shop');
    const FH = { [WORKSPACE_HEADER]: fresh.workspace.id };
    const result = (await fresh.agent
      .post('/onboarding')
      .set(FH)
      .send({ industry: 'software_house', timezone: 'Asia/Karachi', currency: 'USD', workingDays: [1, 2, 3, 4, 5, 6], shift: null, teams: [], loadHolidays: false, sampleProject: true })
      .expect(201)).body as OnboardingResultDto;
    expect(result.projectId).toEqual(expect.any(String));
    const board = (await fresh.agent.get(`/projects/${result.projectId}`).set(FH).expect(200)).body as { project: { name: string }; tasks: unknown[] };
    expect(board.project.name).toBe('Sample: Mobile app');
    expect(board.tasks.length).toBeGreaterThan(0);
    await member.agent.post('/onboarding').set(H()).send({}).expect(403);
  });
});
