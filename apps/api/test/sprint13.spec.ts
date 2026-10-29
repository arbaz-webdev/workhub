import type { INestApplication } from '@nestjs/common';
import { WORKSPACE_HEADER, planCost, type InvoiceDto, type StatusPageDto, type SubscriptionDto } from '@workhub/shared';
import request from 'supertest';
import { foundingTerms } from '../src/billing/plans';
import { StatusService } from '../src/status/status.service';
import { createApp, signUp, withAdmin } from './helpers';

let app: INestApplication;

beforeAll(async () => {
  app = await createApp();
});

afterAll(async () => {
  process.env.FOUNDING_OFFER_ENDS = '2000-01-01';
  delete process.env.PLATFORM_ADMINS;
  await app.close();
});

const details = { billingName: 'Founders (Pvt) Ltd', billingEmail: 'accounts@founders.pk', ntn: null, province: 'punjab', address: null };

describe('Founding-customer offer', () => {
  it('is for workspaces created before the offer ends', () => {
    process.env.FOUNDING_OFFER_ENDS = '2027-05-03';
    expect(foundingTerms(new Date('2027-05-02T23:00:00Z'))).toEqual({ discountPercent: 40, discountLabel: 'Founding customer: 40% off for life' });
    expect(foundingTerms(new Date('2027-05-03T00:00:00Z'))).toEqual({ discountPercent: 0, discountLabel: null });
  });

  it('works out the discount before tax', () => {
    expect(planCost(1299, 'annual', 3, 40)).toEqual({ gross: 38970, discount: 15588, net: 23382 });
    expect(planCost(699, 'monthly', 1)).toEqual({ gross: 699, discount: 0, net: 699 });
  });

  it('takes 40% off every invoice of a workspace made during the offer', async () => {
    process.env.FOUNDING_OFFER_ENDS = '2999-01-01';
    const owner = await signUp(app, 'founder', 'Founders Co');
    const H = () => [WORKSPACE_HEADER, owner.workspace.id] as const;

    const sub = (await owner.agent.get('/billing/subscription').set(...H()).expect(200)).body as SubscriptionDto;
    expect(sub.discount).toEqual({ percent: 40, label: 'Founding customer: 40% off for life' });

    await owner.agent.patch('/billing/details').set(...H()).send(details).expect(200);
    const inv = (await owner.agent.post('/billing/checkout').set(...H()).send({ plan: 'business', cycle: 'annual' }).expect(201)).body as InvoiceDto;
    // 1 person × PKR 1,299 × 10 months = 12,990; 40% off = 7,794; Punjab 16% on that = 1,247.04.
    expect(inv).toMatchObject({
      subtotal: 12990,
      discountPercent: 40,
      discountAmount: 5196,
      discountLabel: 'Founding customer: 40% off for life',
      taxRate: 16,
      taxAmount: 1247.04,
      total: 9041.04,
    });

    // The offer ending later doesn't take it away from them.
    process.env.FOUNDING_OFFER_ENDS = '2000-01-01';
    const again = (await owner.agent.post('/billing/checkout').set(...H()).send({ plan: 'starter', cycle: 'monthly' }).expect(201)).body as InvoiceDto;
    expect(again).toMatchObject({ subtotal: 699, discountAmount: 279.6, taxAmount: 67.1, total: 486.5 });
  });

  it('doesn’t apply to workspaces made after it ends', async () => {
    process.env.FOUNDING_OFFER_ENDS = '2000-01-01';
    const owner = await signUp(app, 'latecomer', 'Late Co');
    const H = () => [WORKSPACE_HEADER, owner.workspace.id] as const;
    expect(((await owner.agent.get('/billing/subscription').set(...H()).expect(200)).body as SubscriptionDto).discount).toBeNull();
    await owner.agent.patch('/billing/details').set(...H()).send(details).expect(200);
    const inv = (await owner.agent.post('/billing/checkout').set(...H()).send({ plan: 'starter', cycle: 'monthly' }).expect(201)).body as InvoiceDto;
    expect(inv).toMatchObject({ subtotal: 699, discountAmount: 0, discountLabel: null, total: 810.84 });
  });

  it('decides by when the workspace was created when its subscription row is made later', async () => {
    process.env.FOUNDING_OFFER_ENDS = '2999-01-01';
    const owner = await signUp(app, 'oldtimer', 'Old Co');
    await withAdmin((db) => db.query('delete from subscriptions where workspace_id = $1', [owner.workspace.id]));
    process.env.FOUNDING_OFFER_ENDS = '2000-01-01';
    // An offer that ended before the workspace was made: no discount.
    let sub = (await owner.agent.get('/billing/subscription').set(WORKSPACE_HEADER, owner.workspace.id).expect(200)).body as SubscriptionDto;
    expect(sub.discount).toBeNull();
    await withAdmin((db) => db.query('delete from subscriptions where workspace_id = $1', [owner.workspace.id]));
    // One that ends after it was made (a beta workspace): the discount.
    process.env.FOUNDING_OFFER_ENDS = '2999-01-01';
    sub = (await owner.agent.get('/billing/subscription').set(WORKSPACE_HEADER, owner.workspace.id).expect(200)).body as SubscriptionDto;
    expect(sub.discount?.percent).toBe(40);
  });
});

describe('Status page', () => {
  it('is public and shows each component with its history', async () => {
    const status = app.get(StatusService);
    const checks = await status.checkAndRecord();
    expect(checks.map((c) => c.component)).toEqual(['app', 'database', 'files', 'live']);
    expect(checks.every((c) => c.ok)).toBe(true);
    status.forget();

    const page = (await request(app.getHttpServer()).get('/status').expect(200)).body as StatusPageDto;
    expect(page.components).toHaveLength(4);
    const db = page.components.find((c) => c.key === 'database')!;
    expect(db.state).toBe('operational');
    expect(db.days).toHaveLength(90);
    expect(db.days.at(-1)!.uptime).toBe(100);
    expect(db.uptime).toBeGreaterThan(0);
  });

  it('lets WorkHub staff post and resolve incidents, and no one else', async () => {
    const staff = await signUp(app, 'statusstaff', 'Staff Co');
    const customer = await signUp(app, 'statuscustomer', 'Customer Co');
    process.env.PLATFORM_ADMINS = staff.email;
    await withAdmin((db) => db.query('update users set email_verified_at = now() where id = $1', [staff.user.id]));

    const incident = { title: 'Slow check-ins', impact: 'minor', components: ['app'], body: 'Check-ins are taking a few seconds. We’re looking into it.' };
    await customer.agent.post('/platform/incidents').send(incident).expect(403);
    await request(app.getHttpServer()).post('/platform/incidents').send(incident).expect(401);
    await staff.agent.post('/platform/incidents').send({ ...incident, impact: 'catastrophic' }).expect(400);
    const { id } = (await staff.agent.post('/platform/incidents').send(incident).expect(201)).body as { id: string };

    let page = (await request(app.getHttpServer()).get('/status').expect(200)).body as StatusPageDto;
    let shown = page.incidents.find((i) => i.id === id)!;
    expect(shown).toMatchObject({ title: 'Slow check-ins', impact: 'minor', components: ['app'], resolvedAt: null });
    expect(shown.updates).toEqual([expect.objectContaining({ status: 'investigating' })]);

    await customer.agent.post(`/platform/incidents/${id}/updates`).send({ status: 'resolved', body: 'Fixed.' }).expect(403);
    await staff.agent.post(`/platform/incidents/${id}/updates`).send({ status: 'resolved', body: 'Fixed: a slow query, now indexed.' }).expect(201);
    page = (await request(app.getHttpServer()).get('/status').expect(200)).body as StatusPageDto;
    shown = page.incidents.find((i) => i.id === id)!;
    expect(shown.resolvedAt).not.toBeNull();
    expect(shown.updates.map((u) => u.status)).toEqual(['resolved', 'investigating']);
  });
});
