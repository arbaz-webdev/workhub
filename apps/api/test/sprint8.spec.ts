import type { INestApplication } from '@nestjs/common';
import {
  WORKSPACE_HEADER,
  type CompanyPageDto,
  type ContactDto,
  type CrmCompanyDto,
  type CustomFieldDto,
  type DuplicateDto,
  type ImportPreviewDto,
  type ImportReportDto,
  type LeadDto,
  type Page,
} from '@workhub/shared';
import { phoneKey } from '../src/crm/crm';
import { parseCsv } from '../src/crm/csv';
import { createApp, signUp, withAdmin } from './helpers';

let app: INestApplication;
let owner: Awaited<ReturnType<typeof signUp>>;
let manager: Awaited<ReturnType<typeof signUp>>;
let member: Awaited<ReturnType<typeof signUp>>;
let guest: Awaited<ReturnType<typeof signUp>>;
let rival: Awaited<ReturnType<typeof signUp>>;
let ws: string;
const H = () => ({ [WORKSPACE_HEADER]: ws });

async function join_(person: typeof owner, role: string) {
  await withAdmin((db) => db.query('insert into memberships (workspace_id, user_id, role) values ($1, $2, $3)', [ws, person.user.id, role]));
}

function importCsv(agent: typeof owner.agent, entity: string, csv: string, mapping: Record<string, string>, mode = 'skip') {
  return agent
    .post('/crm/import')
    .set(H())
    .field('entity', entity)
    .field('mode', mode)
    .field('mapping', JSON.stringify(mapping))
    .attach('file', Buffer.from(csv), { filename: 'people.csv', contentType: 'text/csv' });
}

beforeAll(async () => {
  app = await createApp();
  owner = await signUp(app, 'owner', 'Sales Co');
  ws = owner.workspace.id;
  manager = await signUp(app, 'manager', 'M home');
  member = await signUp(app, 'member', 'Mem home');
  guest = await signUp(app, 'guest', 'G home');
  rival = await signUp(app, 'rival', 'Rival Co');
  await join_(manager, 'manager');
  await join_(member, 'member');
  await join_(guest, 'guest');
});

afterAll(async () => {
  await app.close();
});

describe('helpers', () => {
  it('normalises Pakistani and international phone numbers to one key', () => {
    expect(phoneKey('0300 1234567')).toBe('923001234567');
    expect(phoneKey('+92 300 123-4567')).toBe('923001234567');
    expect(phoneKey('0092 300 1234567')).toBe('923001234567');
    expect(phoneKey('3001234567')).toBe('923001234567');
    expect(phoneKey('+971 50 123 4567')).toBe('971501234567');
    expect(phoneKey('123')).toBeNull();
  });

  it('parses quoted CSV, semicolons and a byte-order mark', () => {
    expect(parseCsv('﻿Name,Note\r\n"Khan, Ali","said ""hi""\nthen left"\r\n\r\n')).toEqual([
      ['Name', 'Note'],
      ['Khan, Ali', 'said "hi"\nthen left'],
    ]);
    expect(parseCsv('a;b\n1;2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });
});

describe('companies and contacts', () => {
  let acme: CrmCompanyDto;

  it('creates a company with a tidy website, and finds it again by website or name', async () => {
    acme = (await member.agent.post('/crm/companies').set(H()).send({ name: 'Acme Traders', website: 'www.acme.pk/about', phone: '042 111 222 333', city: 'Lahore' }).expect(201)).body;
    expect(acme).toMatchObject({ name: 'Acme Traders', website: 'https://www.acme.pk/about', city: 'Lahore', owner: expect.objectContaining({ id: member.user.id }) });
    const byWebsite = (await member.agent.get('/crm/duplicates').query({ entity: 'company', website: 'https://acme.pk' }).set(H()).expect(200)).body as DuplicateDto[];
    expect(byWebsite).toEqual([expect.objectContaining({ id: acme.id, reason: 'website' })]);
    const byName = (await member.agent.get('/crm/duplicates').query({ entity: 'company', name: 'ACME traders' }).set(H()).expect(200)).body as DuplicateDto[];
    expect(byName).toEqual([expect.objectContaining({ id: acme.id, reason: 'name' })]);
    // Free mailboxes don't make companies look alike.
    expect((await member.agent.get('/crm/duplicates').query({ entity: 'company', email: 'x@gmail.com' }).set(H()).expect(200)).body).toEqual([]);
    await member.agent.post('/crm/companies').set(H()).send({ name: 'Bad', website: 'not a site' }).expect(400);
  });

  it('adds contacts to a company and flags a duplicate by email or phone', async () => {
    const sara = (await member.agent.post('/crm/contacts').set(H()).send({ firstName: 'Sara', lastName: 'Ahmed', email: 'Sara@Acme.pk', phone: '0300 1234567', companyId: acme.id, title: 'CEO' }).expect(201)).body as ContactDto;
    expect(sara).toMatchObject({ name: 'Sara Ahmed', email: 'sara@acme.pk', company: { id: acme.id, name: 'Acme Traders' } });
    const dupPhone = (await member.agent.get('/crm/duplicates').query({ entity: 'contact', phone: '+92 300 123 4567' }).set(H()).expect(200)).body as DuplicateDto[];
    expect(dupPhone).toEqual([expect.objectContaining({ id: sara.id, reason: 'phone', label: 'Sara Ahmed' })]);
    expect((await member.agent.get('/crm/duplicates').query({ entity: 'contact', email: 'sara@acme.pk', except: sara.id }).set(H()).expect(200)).body).toEqual([]);

    const page = (await member.agent.get(`/crm/companies/${acme.id}`).set(H()).expect(200)).body as CompanyPageDto;
    expect(page.company.contactCount).toBe(1);
    expect(page.contacts.map((c) => c.id)).toEqual([sara.id]);
    const found = (await member.agent.get('/crm/contacts').query({ q: '1234567' }).set(H()).expect(200)).body as Page<ContactDto>;
    expect(found.items.map((c) => c.id)).toEqual([sara.id]);

    await member.agent.post('/crm/contacts').set(H()).send({ firstName: 'X', phone: 'call me' }).expect(400);
    await member.agent.post('/crm/contacts').set(H()).send({ firstName: 'X', companyId: rival.workspace.id }).expect(400);
  });

  it('keeps guests and other workspaces out, and only lets the creator or a manager delete', async () => {
    await guest.agent.get('/crm/companies').set(H()).expect(403);
    await rival.agent.get('/crm/companies').set(H()).expect(403);
    expect((await rival.agent.get('/crm/companies').set(WORKSPACE_HEADER, rival.workspace.id).expect(200)).body.items).toEqual([]);
    const c = (await manager.agent.post('/crm/companies').set(H()).send({ name: 'Temp Co' }).expect(201)).body as CrmCompanyDto;
    await member.agent.delete(`/crm/companies/${c.id}`).set(H()).expect(403);
    await owner.agent.delete(`/crm/companies/${c.id}`).set(H()).expect(204);
    await member.agent.get(`/crm/companies/${c.id}`).set(H()).expect(404);
  });
});

describe('leads', () => {
  it('records the source and converts into a contact and company', async () => {
    const lead = (await member.agent
      .post('/crm/leads')
      .set(H())
      .send({ name: 'Bilal Raza', companyName: 'Raza Textiles', email: 'bilal@razatex.pk', phone: '0321 7654321', source: 'upwork', sourceDetail: 'https://upwork.com/jobs/123', value: 250000 })
      .expect(201)).body as LeadDto;
    expect(lead).toMatchObject({ source: 'upwork', status: 'new', currency: 'PKR', value: 250000 });
    await member.agent.patch(`/crm/leads/${lead.id}`).set(H()).send({ status: 'qualified' }).expect(200);
    const list = (await member.agent.get('/crm/leads').query({ source: 'upwork', status: 'qualified' }).set(H()).expect(200)).body as Page<LeadDto>;
    expect(list.items.map((l) => l.id)).toEqual([lead.id]);
    await member.agent.get('/crm/leads').query({ source: 'tiktok' }).set(H()).expect(400);

    const done = (await member.agent.post(`/crm/leads/${lead.id}/convert`).set(H()).send({ company: 'new' }).expect(201)).body as { lead: LeadDto; contactId: string; companyId: string };
    expect(done.lead).toMatchObject({ status: 'converted', convertedContactId: done.contactId, convertedCompanyId: done.companyId });
    const contact = (await member.agent.get(`/crm/contacts/${done.contactId}`).set(H()).expect(200)).body as ContactDto;
    expect(contact).toMatchObject({ firstName: 'Bilal', lastName: 'Raza', email: 'bilal@razatex.pk', company: { name: 'Raza Textiles' }, leadId: lead.id });
    await member.agent.post(`/crm/leads/${lead.id}/convert`).set(H()).send({ company: 'none' }).expect(409);
    await member.agent.patch(`/crm/leads/${lead.id}`).set(H()).send({ status: 'new' }).expect(409);
  });

  it('can’t convert into a company that has no name, or into another workspace’s company', async () => {
    const lead = (await member.agent.post('/crm/leads').set(H()).send({ name: 'Solo Person', source: 'whatsapp' }).expect(201)).body as LeadDto;
    await member.agent.post(`/crm/leads/${lead.id}/convert`).set(H()).send({ company: 'new' }).expect(400);
    await member.agent.post(`/crm/leads/${lead.id}/convert`).set(H()).send({ company: 'existing', companyId: rival.workspace.id }).expect(400);
    await member.agent.post(`/crm/leads/${lead.id}/convert`).set(H()).send({ company: 'none' }).expect(201);
  });
});

describe('custom fields', () => {
  it('lets managers add typed fields, and checks values against them', async () => {
    await member.agent.post('/crm/fields').set(H()).send({ entity: 'lead', label: 'Budget band', type: 'select', options: ['Small'] }).expect(403);
    const band = (await manager.agent.post('/crm/fields').set(H()).send({ entity: 'lead', label: 'Budget band', type: 'select', options: ['Small', 'Medium', 'Large'] }).expect(201)).body as CustomFieldDto;
    expect(band).toMatchObject({ key: 'budget_band', type: 'select' });
    const second = (await manager.agent.post('/crm/fields').set(H()).send({ entity: 'lead', label: 'Budget band', type: 'text' }).expect(201)).body as CustomFieldDto;
    expect(second.key).toBe('budget_band_2');
    await manager.agent.post('/crm/fields').set(H()).send({ entity: 'lead', label: 'Empty', type: 'select', options: [] }).expect(400);
    const follow = (await manager.agent.post('/crm/fields').set(H()).send({ entity: 'lead', label: 'Follow up on', type: 'date' }).expect(201)).body as CustomFieldDto;

    const lead = (await member.agent.post('/crm/leads').set(H()).send({ name: 'Custom', custom: { budget_band: 'large', follow_up_on: '2027-03-01', unknown: 'dropped' } }).expect(201)).body as LeadDto;
    expect(lead.custom).toEqual({ budget_band: 'Large', follow_up_on: '2027-03-01' });
    await member.agent.post('/crm/leads').set(H()).send({ name: 'Bad', custom: { budget_band: 'Huge' } }).expect(400);
    await member.agent.post('/crm/leads').set(H()).send({ name: 'Bad', custom: { follow_up_on: 'tomorrow' } }).expect(400);
    // Clearing one value keeps the others.
    const cleared = (await member.agent.patch(`/crm/leads/${lead.id}`).set(H()).send({ custom: { follow_up_on: null } }).expect(200)).body as LeadDto;
    expect(cleared.custom).toEqual({ budget_band: 'Large' });

    await manager.agent.delete(`/crm/fields/${follow.id}`).set(H()).expect(204);
    const fields = (await member.agent.get('/crm/fields').query({ entity: 'lead' }).set(H()).expect(200)).body as CustomFieldDto[];
    expect(fields.map((f) => f.key)).toEqual(['budget_band', 'budget_band_2']);
  });
});

describe('CSV import', () => {
  const csv = [
    'Full Name,E-mail,Mobile,Company,Designation,City of birth',
    'Ayesha Khan,ayesha@nova.pk,0333 1112223,Nova Labs,CTO,Karachi',
    '"Imran, Jr",imran@nova.pk,,Nova Labs,,',
    'No Email,,+92 333 1112223,,,',
    'Broken,not-an-email,,,,',
    'Sara Again,sara@acme.pk,,,Head of Ops,',
  ].join('\n');

  it('previews the file with a guessed mapping', async () => {
    const preview = (await manager.agent
      .post('/crm/import/preview')
      .set(H())
      .field('entity', 'contact')
      .attach('file', Buffer.from(csv), { filename: 'people.csv', contentType: 'text/csv' })
      .expect(201)).body as ImportPreviewDto;
    expect(preview.total).toBe(5);
    expect(preview.suggested).toEqual({ 'Full Name': 'name', 'E-mail': 'email', Mobile: 'phone', Company: 'company', Designation: 'title', 'City of birth': '' });
    await member.agent.post('/crm/import/preview').set(H()).field('entity', 'contact').attach('file', Buffer.from(csv), { filename: 'p.csv' }).expect(403);
  });

  it('imports, skipping duplicates (in the file too) and reporting bad rows', async () => {
    const mapping = { 'Full Name': 'name', 'E-mail': 'email', Mobile: 'phone', Company: 'company', Designation: 'title' };
    const report = (await importCsv(manager.agent, 'contact', csv, mapping).expect(201)).body as ImportReportDto;
    expect(report).toMatchObject({ created: 2, updated: 0, skipped: 2, failed: 1 });
    expect(report.problems).toEqual([
      { row: 4, message: 'Already in the CRM; skipped.' },
      { row: 5, message: expect.stringContaining('email') },
      { row: 6, message: 'Already in the CRM; skipped.' },
    ]);
    const nova = (await manager.agent.get('/crm/companies').query({ q: 'Nova' }).set(H()).expect(200)).body as Page<CrmCompanyDto>;
    expect(nova.items).toEqual([expect.objectContaining({ name: 'Nova Labs', contactCount: 2 })]);
    const imran = (await manager.agent.get('/crm/contacts').query({ q: 'imran' }).set(H()).expect(200)).body as Page<ContactDto>;
    expect(imran.items[0]).toMatchObject({ firstName: 'Imran,', lastName: 'Jr' });

    // Update mode fills in what's new on the matching record.
    const again = (await importCsv(manager.agent, 'contact', csv, mapping, 'update').expect(201)).body as ImportReportDto;
    expect(again).toMatchObject({ created: 0, updated: 4, failed: 1 });
    const sara = (await manager.agent.get('/crm/contacts').query({ q: 'sara@acme.pk' }).set(H()).expect(200)).body as Page<ContactDto>;
    expect(sara.items[0]).toMatchObject({ title: 'Head of Ops', firstName: 'Sara', lastName: 'Again' });

    const history = (await manager.agent.get('/crm/import/history').set(H()).expect(200)).body as ImportReportDto[];
    expect(history.map((h) => h.id)).toEqual([again.id, report.id]);
  });

  it('maps lead sources by name and keeps unknown ones as detail', async () => {
    const leadsCsv = 'Name,Source,Budget\nZara,LinkedIn,"PKR 150,000"\nOmar,TikTok,\nTom,LinkedIn,USD 3000\n';
    const report = (await importCsv(manager.agent, 'lead', leadsCsv, { Name: 'name', Source: 'source', Budget: 'value' }).expect(201)).body as ImportReportDto;
    expect(report).toMatchObject({ created: 3, failed: 0 });
    const list = (await manager.agent.get('/crm/leads').query({ q: 'Zara' }).set(H()).expect(200)).body as Page<LeadDto>;
    expect(list.items[0]).toMatchObject({ source: 'linkedin', value: 150000, currency: 'PKR' });
    const tom = (await manager.agent.get('/crm/leads').query({ q: 'Tom' }).set(H()).expect(200)).body as Page<LeadDto>;
    expect(tom.items[0]).toMatchObject({ value: 3000, currency: 'USD' });
    const omar = (await manager.agent.get('/crm/leads').query({ q: 'Omar' }).set(H()).expect(200)).body as Page<LeadDto>;
    expect(omar.items[0]).toMatchObject({ source: 'other', sourceDetail: 'TikTok' });
  });

  it('refuses files without a name column or that aren’t CSV', async () => {
    await importCsv(manager.agent, 'lead', 'Email\na@b.pk\n', { Email: 'email' }).expect(400);
    await manager.agent
      .post('/crm/import')
      .set(H())
      .field('entity', 'lead')
      .field('mapping', '{}')
      .attach('file', Buffer.from('PK'), { filename: 'leads.xlsx', contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
      .expect(400);
  });
});
