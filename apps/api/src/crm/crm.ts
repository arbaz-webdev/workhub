// Shared CRM helpers: normalising phones and websites, finding duplicates, checking
// custom field values and building DTOs. All run inside the caller's tenant transaction.
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import {
  hasRole,
  type CompanyInput,
  type ContactDto,
  type ContactInput,
  type CrmCompanyDto,
  type CrmEntity,
  type CustomValues,
  type DuplicateDto,
  type LeadDto,
  type PersonDto,
} from '@workhub/shared';
import { and, eq, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import type { WorkspaceContext } from '../common/request';
import type { Tx } from '../db/db.service';
import { companies, contacts, customFields, leads, memberships, projects, users } from '../db/schema';

export type CompanyRow = typeof companies.$inferSelect;
export type ContactRow = typeof contacts.$inferSelect;
export type LeadRow = typeof leads.$inferSelect;

/**
 * A phone number as digits with the country code, so "0300 1234567", "+92 300 1234567"
 * and "923001234567" all match. Numbers without one are taken as Pakistani.
 */
export function phoneKey(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let digits = raw.replace(/\D/g, '');
  if (raw.trim().startsWith('+')) {
    // Already international.
  } else if (digits.startsWith('00')) {
    digits = digits.slice(2);
  } else if (digits.startsWith('0') && digits.length === 11) {
    digits = `92${digits.slice(1)}`;
  } else if (digits.startsWith('3') && digits.length === 10) {
    digits = `92${digits}`;
  }
  return digits.length >= 7 ? digits : null;
}

/** Free mailboxes say nothing about which company someone works for. */
const FREE_MAIL = new Set(['gmail.com', 'googlemail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'live.com', 'msn.com', 'icloud.com', 'aol.com', 'ymail.com', 'proton.me', 'protonmail.com']);

/** "https://www.Acme.pk/about" → "https://www.Acme.pk/about"; "acme.pk" → "https://acme.pk". */
export function normaliseWebsite(raw: string | null): string | null {
  if (!raw) return null;
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const url = new URL(withScheme);
    if (!url.hostname.includes('.')) throw new Error('no domain');
    return url.toString().replace(/\/$/, '');
  } catch {
    throw new BadRequestException('Enter a website like acme.pk or https://acme.pk');
  }
}

/** The company's domain, from its website or else a work email address. */
export function domainOf(website: string | null, email: string | null): string | null {
  if (website) {
    try {
      return new URL(website).hostname.toLowerCase().replace(/^www\./, '');
    } catch {
      return null;
    }
  }
  const host = email?.split('@')[1]?.toLowerCase();
  return host && !FREE_MAIL.has(host) ? host : null;
}

export const fullName = (first: string, last: string | null) => (last ? `${first} ${last}` : first);

/** "Ali Raza Khan" → first "Ali", last "Raza Khan". */
export function splitName(name: string): { firstName: string; lastName: string | null } {
  const parts = name.trim().split(/\s+/);
  return { firstName: parts[0] ?? name.trim(), lastName: parts.length > 1 ? parts.slice(1).join(' ') : null };
}

/** Whoever added a record, its owner, or a manager may delete it. */
export const canDelete = (ws: WorkspaceContext, row: { createdBy: string | null; ownerId: string | null }, userId: string) =>
  row.createdBy === userId || row.ownerId === userId || hasRole(ws.role, 'manager');

/** An owner must be someone in the workspace who isn't a guest. */
export async function assertOwner(tx: Tx, workspaceId: string, ownerId: string | null | undefined) {
  if (!ownerId) return;
  const [m] = await tx
    .select({ userId: memberships.userId })
    .from(memberships)
    .where(and(eq(memberships.workspaceId, workspaceId), eq(memberships.userId, ownerId), ne(memberships.role, 'guest')));
  if (!m) throw new BadRequestException('Choose an owner from your team.');
}

export async function assertCompany(tx: Tx, workspaceId: string, companyId: string | null | undefined) {
  if (!companyId) return;
  const [c] = await tx
    .select({ id: companies.id })
    .from(companies)
    .where(and(eq(companies.id, companyId), eq(companies.workspaceId, workspaceId), isNull(companies.deletedAt)));
  if (!c) throw new BadRequestException('Choose a company in this workspace.');
}

// ---- Custom fields ----------------------------------------------------------------------

/**
 * Checks values against the workspace's fields for `entity` and returns them cleaned up,
 * merged over `existing`. Unknown keys are dropped; null clears a value.
 */
export async function cleanCustom(tx: Tx, workspaceId: string, entity: CrmEntity, values: CustomValues, existing: CustomValues = {}): Promise<CustomValues> {
  const keys = Object.keys(values);
  if (keys.length === 0) return existing;
  const fields = await tx
    .select()
    .from(customFields)
    .where(and(eq(customFields.workspaceId, workspaceId), eq(customFields.entity, entity), isNull(customFields.archivedAt)));
  const out: CustomValues = { ...existing };
  for (const f of fields) {
    if (!(f.key in values)) continue;
    const v = values[f.key];
    if (v === null || v === '') {
      delete out[f.key];
      continue;
    }
    const bad = () => new BadRequestException(`${f.label}: ${f.type === 'select' ? `choose one of ${f.options.join(', ')}` : `enter a valid ${f.type}`}`);
    switch (f.type) {
      case 'number': {
        const n = typeof v === 'number' ? v : Number(String(v).replace(/,/g, ''));
        if (!Number.isFinite(n)) throw bad();
        out[f.key] = n;
        break;
      }
      case 'checkbox':
        out[f.key] = v === true || ['true', 'yes', 'y', '1'].includes(String(v).trim().toLowerCase());
        break;
      case 'date':
        if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v)) || Number.isNaN(Date.parse(String(v)))) throw bad();
        out[f.key] = String(v);
        break;
      case 'select': {
        const option = f.options.find((o) => o.toLowerCase() === String(v).trim().toLowerCase());
        if (!option) throw bad();
        out[f.key] = option;
        break;
      }
      case 'url':
        try {
          out[f.key] = normaliseWebsite(String(v).trim());
        } catch {
          throw bad();
        }
        break;
      default:
        out[f.key] = String(v).trim().slice(0, 1000);
    }
  }
  return out;
}

// ---- Duplicates ---------------------------------------------------------------------

/** Existing people (contacts and open leads) with the same email or phone. */
export async function personDuplicates(tx: Tx, workspaceId: string, q: { email: string | null; phone: string | null; except?: string }): Promise<DuplicateDto[]> {
  const key = phoneKey(q.phone);
  if (!q.email && !key) return [];
  const out: DuplicateDto[] = [];
  const contactRows = await tx
    .select({ id: contacts.id, firstName: contacts.firstName, lastName: contacts.lastName, email: contacts.email, phoneKey: contacts.phoneKey })
    .from(contacts)
    .where(
      and(
        eq(contacts.workspaceId, workspaceId),
        isNull(contacts.deletedAt),
        or(q.email ? sql`lower(${contacts.email}) = ${q.email.toLowerCase()}` : undefined, key ? eq(contacts.phoneKey, key) : undefined),
      ),
    )
    .limit(5);
  for (const c of contactRows) {
    if (c.id === q.except) continue;
    out.push({ entity: 'contact', id: c.id, label: fullName(c.firstName, c.lastName), reason: q.email && c.email?.toLowerCase() === q.email.toLowerCase() ? 'email' : 'phone' });
  }
  const leadRows = await tx
    .select({ id: leads.id, name: leads.name, email: leads.email })
    .from(leads)
    .where(
      and(
        eq(leads.workspaceId, workspaceId),
        isNull(leads.deletedAt),
        ne(leads.status, 'converted'),
        or(q.email ? sql`lower(${leads.email}) = ${q.email.toLowerCase()}` : undefined, key ? eq(leads.phoneKey, key) : undefined),
      ),
    )
    .limit(5);
  for (const l of leadRows) {
    if (l.id === q.except) continue;
    out.push({ entity: 'lead', id: l.id, label: l.name, reason: q.email && l.email?.toLowerCase() === q.email.toLowerCase() ? 'email' : 'phone' });
  }
  return out;
}

/** Existing companies with the same website domain or name. */
export async function companyDuplicates(tx: Tx, workspaceId: string, q: { name: string | null; domain: string | null; except?: string }): Promise<DuplicateDto[]> {
  if (!q.name && !q.domain) return [];
  const rows = await tx
    .select({ id: companies.id, name: companies.name, domain: companies.domain })
    .from(companies)
    .where(
      and(
        eq(companies.workspaceId, workspaceId),
        isNull(companies.deletedAt),
        or(q.domain ? eq(companies.domain, q.domain) : undefined, q.name ? sql`lower(${companies.name}) = ${q.name.trim().toLowerCase()}` : undefined),
      ),
    )
    .limit(5);
  return rows
    .filter((c) => c.id !== q.except)
    .map((c) => ({ entity: 'company' as const, id: c.id, label: c.name, reason: q.domain && c.domain === q.domain ? ('website' as const) : ('name' as const) }));
}

// ---- Writing records -------------------------------------------------------------------

/** Company columns from validated input (website normalised, domain and phone key derived). */
export function companyValues(body: CompanyInput) {
  const website = normaliseWebsite(body.website);
  return {
    name: body.name,
    website,
    domain: domainOf(website, body.email),
    email: body.email,
    phone: body.phone,
    phoneKey: phoneKey(body.phone),
    industry: body.industry,
    city: body.city,
    country: body.country,
    address: body.address,
    notes: body.notes,
  };
}

export function contactValues(body: ContactInput) {
  return {
    firstName: body.firstName,
    lastName: body.lastName,
    email: body.email,
    phone: body.phone,
    phoneKey: phoneKey(body.phone),
    title: body.title,
    companyId: body.companyId ?? null,
    notes: body.notes,
  };
}

// ---- DTOs -------------------------------------------------------------------------------

async function peopleById(tx: Tx, ids: (string | null)[]): Promise<Map<string, PersonDto>> {
  const unique = [...new Set(ids.filter((i): i is string => !!i))];
  if (unique.length === 0) return new Map();
  const rows = await tx.select({ id: users.id, name: users.name, email: users.email }).from(users).where(inArray(users.id, unique));
  return new Map(rows.map((u) => [u.id, u]));
}

export async function companyDtos(tx: Tx, rows: CompanyRow[]): Promise<CrmCompanyDto[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const owners = await peopleById(
    tx,
    rows.map((r) => r.ownerId),
  );
  const contactCounts = await tx
    .select({ companyId: contacts.companyId, n: sql<number>`count(*)::int` })
    .from(contacts)
    .where(and(inArray(contacts.companyId, ids), isNull(contacts.deletedAt)))
    .groupBy(contacts.companyId);
  const projectCounts = await tx
    .select({ clientId: projects.clientId, n: sql<number>`count(*)::int` })
    .from(projects)
    .where(inArray(projects.clientId, ids))
    .groupBy(projects.clientId);
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    website: r.website,
    email: r.email,
    phone: r.phone,
    industry: r.industry,
    city: r.city,
    country: r.country,
    address: r.address,
    notes: r.notes,
    owner: r.ownerId ? (owners.get(r.ownerId) ?? null) : null,
    custom: r.custom,
    contactCount: contactCounts.find((c) => c.companyId === r.id)?.n ?? 0,
    projectCount: projectCounts.find((p) => p.clientId === r.id)?.n ?? 0,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  }));
}

export async function contactDtos(tx: Tx, rows: ContactRow[]): Promise<ContactDto[]> {
  if (rows.length === 0) return [];
  const owners = await peopleById(
    tx,
    rows.map((r) => r.ownerId),
  );
  const companyIds = [...new Set(rows.map((r) => r.companyId).filter((i): i is string => !!i))];
  const companyRows = companyIds.length
    ? await tx.select({ id: companies.id, name: companies.name }).from(companies).where(and(inArray(companies.id, companyIds), isNull(companies.deletedAt)))
    : [];
  return rows.map((r) => ({
    id: r.id,
    firstName: r.firstName,
    lastName: r.lastName,
    name: fullName(r.firstName, r.lastName),
    email: r.email,
    phone: r.phone,
    title: r.title,
    company: companyRows.find((c) => c.id === r.companyId) ?? null,
    notes: r.notes,
    owner: r.ownerId ? (owners.get(r.ownerId) ?? null) : null,
    leadId: r.leadId,
    custom: r.custom,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  }));
}

export async function leadDtos(tx: Tx, rows: LeadRow[]): Promise<LeadDto[]> {
  const owners = await peopleById(
    tx,
    rows.map((r) => r.ownerId),
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    companyName: r.companyName,
    email: r.email,
    phone: r.phone,
    source: r.source,
    sourceDetail: r.sourceDetail,
    status: r.status,
    value: r.value,
    currency: r.currency,
    notes: r.notes,
    owner: r.ownerId ? (owners.get(r.ownerId) ?? null) : null,
    custom: r.custom,
    convertedContactId: r.convertedContactId,
    convertedCompanyId: r.convertedCompanyId,
    convertedAt: r.convertedAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  }));
}

export async function loadCompany(tx: Tx, workspaceId: string, id: string): Promise<CompanyRow> {
  const [row] = await tx
    .select()
    .from(companies)
    .where(and(eq(companies.id, id), eq(companies.workspaceId, workspaceId), isNull(companies.deletedAt)));
  if (!row) throw new NotFoundException('Company not found');
  return row;
}

export async function loadContact(tx: Tx, workspaceId: string, id: string): Promise<ContactRow> {
  const [row] = await tx
    .select()
    .from(contacts)
    .where(and(eq(contacts.id, id), eq(contacts.workspaceId, workspaceId), isNull(contacts.deletedAt)));
  if (!row) throw new NotFoundException('Contact not found');
  return row;
}

export async function loadLead(tx: Tx, workspaceId: string, id: string): Promise<LeadRow> {
  const [row] = await tx
    .select()
    .from(leads)
    .where(and(eq(leads.id, id), eq(leads.workspaceId, workspaceId), isNull(leads.deletedAt)));
  if (!row) throw new NotFoundException('Lead not found');
  return row;
}

export function forbidDelete(): never {
  throw new ForbiddenException('Only whoever added it, its owner or a manager can delete it.');
}

/** Escapes % and _ for an ILIKE search term. */
export const likeTerm = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
