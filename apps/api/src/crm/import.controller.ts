import { BadRequestException, Body, Controller, Get, Post, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  companySchema,
  contactSchema,
  CRM_ENTITIES,
  CURRENCIES,
  IMPORT_MODES,
  LEAD_SOURCE_LABELS,
  LEAD_SOURCES,
  LEAD_STATUSES,
  leadSchema,
  MAX_IMPORT_ROWS,
  type CrmEntity,
  type CustomFieldDto,
  type CustomValues,
  type ImportPreviewDto,
  type ImportProblem,
  type ImportReportDto,
  type LeadSource,
  type LeadStatus,
} from '@workhub/shared';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { z, type ZodType } from 'zod';
import { audit } from '../audit/audit';
import { AuthContext, ClientIp, CurrentAuth, CurrentWorkspace, MinRole, WorkspaceContext } from '../common/request';
import { DbService, Tx } from '../db/db.service';
import { companies, contacts, crmImports, leads, workspaces } from '../db/schema';
import { WorkspaceGuard } from '../workspaces/workspace.guard';
import { Track } from '../analytics/track';
import { listFields } from './crm.controller';
import { cleanCustom, companyValues, contactValues, domainOf, normaliseWebsite, phoneKey, splitName } from './crm';
import { headerKey, parseCsv } from './csv';

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_PROBLEMS = 500;

const TARGETS: Record<CrmEntity, { key: string; label: string; aliases: string[] }[]> = {
  company: [
    { key: 'name', label: 'Name', aliases: ['name', 'company', 'companyname', 'organisation', 'organization', 'business', 'account', 'accountname'] },
    { key: 'website', label: 'Website', aliases: ['website', 'web', 'url', 'site', 'domain'] },
    { key: 'email', label: 'Email', aliases: ['email', 'emailaddress', 'mail'] },
    { key: 'phone', label: 'Phone', aliases: ['phone', 'phonenumber', 'telephone', 'tel', 'mobile', 'whatsapp'] },
    { key: 'industry', label: 'Industry', aliases: ['industry', 'sector', 'category'] },
    { key: 'city', label: 'City', aliases: ['city', 'town'] },
    { key: 'country', label: 'Country', aliases: ['country'] },
    { key: 'address', label: 'Address', aliases: ['address', 'streetaddress', 'location'] },
    { key: 'notes', label: 'Notes', aliases: ['notes', 'note', 'comments', 'description'] },
  ],
  contact: [
    { key: 'name', label: 'Full name', aliases: ['name', 'fullname', 'contactname', 'contact'] },
    { key: 'firstName', label: 'First name', aliases: ['firstname', 'first', 'givenname'] },
    { key: 'lastName', label: 'Last name', aliases: ['lastname', 'last', 'surname', 'familyname'] },
    { key: 'email', label: 'Email', aliases: ['email', 'emailaddress', 'mail'] },
    { key: 'phone', label: 'Phone', aliases: ['phone', 'phonenumber', 'mobile', 'mobilenumber', 'cell', 'whatsapp', 'whatsappnumber', 'telephone'] },
    { key: 'title', label: 'Job title', aliases: ['title', 'jobtitle', 'position', 'designation', 'role'] },
    { key: 'company', label: 'Company', aliases: ['company', 'companyname', 'organisation', 'organization', 'business', 'account'] },
    { key: 'notes', label: 'Notes', aliases: ['notes', 'note', 'comments'] },
  ],
  lead: [
    { key: 'name', label: 'Name', aliases: ['name', 'fullname', 'leadname', 'contactname', 'contact', 'client', 'clientname'] },
    { key: 'companyName', label: 'Company', aliases: ['company', 'companyname', 'organisation', 'organization', 'business'] },
    { key: 'email', label: 'Email', aliases: ['email', 'emailaddress', 'mail'] },
    { key: 'phone', label: 'Phone', aliases: ['phone', 'phonenumber', 'mobile', 'cell', 'whatsapp', 'whatsappnumber'] },
    { key: 'source', label: 'Source', aliases: ['source', 'leadsource', 'channel', 'platform'] },
    { key: 'sourceDetail', label: 'Source detail', aliases: ['sourcedetail', 'referredby', 'referrer', 'joblink', 'profile', 'profileurl'] },
    { key: 'status', label: 'Status', aliases: ['status', 'stage', 'leadstatus'] },
    { key: 'value', label: 'Value', aliases: ['value', 'amount', 'budget', 'dealvalue', 'estimatedvalue'] },
    { key: 'currency', label: 'Currency', aliases: ['currency'] },
    { key: 'notes', label: 'Notes', aliases: ['notes', 'note', 'comments', 'requirements'] },
  ],
};

const bodySchema = z.object({
  entity: z.enum(CRM_ENTITIES),
  mode: z.enum(IMPORT_MODES).default('skip'),
  mapping: z.preprocess(
    (v) => {
      try {
        return typeof v === 'string' ? JSON.parse(v) : v;
      } catch {
        return v;
      }
    },
    z.record(z.string(), z.string()),
  ),
});

function decode(buffer: Buffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    // Excel on Windows often saves CSV as Windows-1252.
    return new TextDecoder('windows-1252').decode(buffer);
  }
}

function readFile(file: Express.Multer.File | undefined): string[][] {
  if (!file || file.size === 0) throw new BadRequestException('Choose a CSV file.');
  if (!/\.(csv|txt|tsv)$/i.test(file.originalname) && !/csv|text\/plain|tab-separated/.test(file.mimetype)) throw new BadRequestException('Save the spreadsheet as CSV first, then upload that file.');
  const rows = parseCsv(decode(file.buffer));
  if (rows.length < 2) throw new BadRequestException('The file needs a header row and at least one row of data.');
  if (rows.length - 1 > MAX_IMPORT_ROWS) throw new BadRequestException(`Import up to ${MAX_IMPORT_ROWS.toLocaleString('en')} rows at a time. Split the file and import each part.`);
  return rows;
}

function targetsFor(entity: CrmEntity, fields: CustomFieldDto[]) {
  return [...TARGETS[entity].map(({ key, label }) => ({ key, label })), ...fields.map((f) => ({ key: `custom.${f.key}`, label: f.label }))];
}

/** Guesses which field each column is, from its header. */
function suggest(entity: CrmEntity, headers: string[], fields: CustomFieldDto[]): Record<string, string> {
  const out: Record<string, string> = {};
  const used = new Set<string>();
  for (const h of headers) {
    const k = headerKey(h);
    const std = TARGETS[entity].find((t) => !used.has(t.key) && t.aliases.includes(k));
    const custom = fields.find((f) => !used.has(`custom.${f.key}`) && (headerKey(f.label) === k || headerKey(f.key) === k));
    const target = std?.key ?? (custom ? `custom.${custom.key}` : '');
    if (target) used.add(target);
    out[h] = target;
  }
  return out;
}

const SOURCE_BY_NAME = new Map<string, LeadSource>(LEAD_SOURCES.flatMap((s) => [[headerKey(s), s] as const, [headerKey(LEAD_SOURCE_LABELS[s]), s] as const]));

function money(v: string | undefined): number | null | undefined {
  if (!v) return undefined;
  const n = Number(v.replace(/[^\d.]/g, ''));
  return Number.isFinite(n) ? n : undefined;
}

/** First validation message, as "Field: message". */
function issue(err: z.ZodError): string {
  const first = err.issues[0];
  return first ? `${first.path.join('.') || 'Row'}: ${first.message}` : 'Invalid row';
}

type Index = Map<string, string>;

@Controller('crm/import')
@UseGuards(WorkspaceGuard)
@MinRole('manager')
export class CrmImportController {
  constructor(private readonly db: DbService) {}

  private ctx(auth: AuthContext, ws: WorkspaceContext) {
    return { workspaceId: ws.id, userId: auth.userId };
  }

  /** Reads the file's header and first rows and guesses the mapping. Nothing is saved. */
  @Post('preview')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_FILE_BYTES, files: 1, fields: 5 } }))
  async preview(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body('entity') entityParam: string | undefined,
    @CurrentAuth() auth: AuthContext,
    @CurrentWorkspace() ws: WorkspaceContext,
  ): Promise<ImportPreviewDto> {
    const entity = z.enum(CRM_ENTITIES).safeParse(entityParam);
    if (!entity.success) throw new BadRequestException('entity must be company, contact or lead');
    const rows = readFile(file);
    const headers = rows[0]!.map((h, i) => h.trim() || `Column ${i + 1}`);
    const fields = await this.db.withContext(this.ctx(auth, ws), (tx) => listFields(tx, ws.id, entity.data));
    return { headers, sample: rows.slice(1, 6), total: rows.length - 1, suggested: suggest(entity.data, headers, fields), targets: targetsFor(entity.data, fields) };
  }

  /**
   * Imports the rows. A row matching an existing record (same email or phone; for companies,
   * the same website or name) is skipped, updated or created anyway, as `mode` says. Rows
   * that don't pass validation are listed in the report and nothing else changes for them.
   */
  @Post()
  @Track('crm imported')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_FILE_BYTES, files: 1, fields: 5 } }))
  async run(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() raw: unknown,
    @CurrentAuth() auth: AuthContext,
    @CurrentWorkspace() ws: WorkspaceContext,
    @ClientIp() ip: string | undefined,
  ): Promise<ImportReportDto> {
    const parsed = bodySchema.safeParse(raw);
    if (!parsed.success) throw new BadRequestException('Send entity, mode and mapping');
    const { entity, mode, mapping } = parsed.data;
    const rows = readFile(file);
    const headers = rows[0]!.map((h, i) => h.trim() || `Column ${i + 1}`);

    return this.db.withContext(this.ctx(auth, ws), async (tx) => {
      const fields = await listFields(tx, ws.id, entity);
      const allowed = new Set(targetsFor(entity, fields).map((t) => t.key));
      const columns = headers.map((h) => (allowed.has(mapping[h] ?? '') ? mapping[h]! : ''));
      if (!columns.includes('name') && !(entity === 'contact' && columns.includes('firstName'))) {
        throw new BadRequestException(entity === 'contact' ? 'Map a column to Full name or First name.' : 'Map a column to Name.');
      }
      const [w] = await tx.select({ currency: workspaces.currency }).from(workspaces).where(eq(workspaces.id, ws.id));
      const importer = new Importer(tx, ws.id, auth.userId, entity, mode, w!.currency);
      await importer.loadIndex();

      for (let i = 1; i < rows.length; i++) {
        const record: Record<string, string> = {};
        const custom: CustomValues = {};
        columns.forEach((target, c) => {
          const value = rows[i]![c]?.trim();
          if (!target || !value) return;
          if (target.startsWith('custom.')) custom[target.slice(7)] = value;
          else record[target] = value;
        });
        await importer.row(i + 1, record, custom);
      }

      const r = importer.report;
      const [saved] = await tx
        .insert(crmImports)
        .values({
          workspaceId: ws.id,
          entity,
          fileName: file!.originalname.slice(0, 200),
          mode,
          createdCount: r.created,
          updatedCount: r.updated,
          skippedCount: r.skipped,
          failedCount: r.failed,
          problems: r.problems.slice(0, MAX_PROBLEMS),
          createdBy: auth.userId,
        })
        .returning();
      await audit(tx, { workspaceId: ws.id, actorUserId: auth.userId, action: 'crm.imported', entityType: entity, entityId: saved!.id, metadata: { file: saved!.fileName, created: r.created, updated: r.updated, skipped: r.skipped, failed: r.failed }, ip });
      return reportDto(saved!);
    });
  }

  @Get('history')
  async history(@CurrentAuth() auth: AuthContext, @CurrentWorkspace() ws: WorkspaceContext): Promise<ImportReportDto[]> {
    return this.db.withContext(this.ctx(auth, ws), async (tx) =>
      (await tx.select().from(crmImports).where(eq(crmImports.workspaceId, ws.id)).orderBy(desc(crmImports.createdAt)).limit(20)).map(reportDto),
    );
  }
}

function reportDto(r: typeof crmImports.$inferSelect): ImportReportDto {
  return {
    id: r.id,
    entity: r.entity,
    fileName: r.fileName,
    mode: r.mode,
    created: r.createdCount,
    updated: r.updatedCount,
    skipped: r.skippedCount,
    failed: r.failedCount,
    problems: r.problems,
    createdAt: r.createdAt.toISOString(),
  };
}

/** Imports rows of one kind, keeping an index of existing records so duplicates are found, including ones earlier in the file. */
class Importer {
  readonly report = { created: 0, updated: 0, skipped: 0, failed: 0, problems: [] as ImportProblem[] };
  private readonly index: Index = new Map();
  private readonly companyByName = new Map<string, string>();

  constructor(
    private readonly tx: Tx,
    private readonly workspaceId: string,
    private readonly userId: string,
    private readonly entity: CrmEntity,
    private readonly mode: (typeof IMPORT_MODES)[number],
    private readonly currency: string,
  ) {}

  private problem(row: number, message: string) {
    if (this.report.problems.length < MAX_PROBLEMS) this.report.problems.push({ row, message });
  }

  /** Keys a record is matched on: email and phone, or website domain and name. */
  private keys(r: { email?: string | null; phoneKey?: string | null; domain?: string | null; name?: string | null }): string[] {
    if (this.entity === 'company') return [r.domain ? `d:${r.domain}` : '', r.name ? `n:${r.name.toLowerCase()}` : ''].filter(Boolean);
    return [r.email ? `e:${r.email.toLowerCase()}` : '', r.phoneKey ? `p:${r.phoneKey}` : ''].filter(Boolean);
  }

  private remember(id: string, r: Parameters<Importer['keys']>[0]) {
    for (const k of this.keys(r)) this.index.set(k, id);
  }

  async loadIndex() {
    const { tx, workspaceId: ws } = this;
    if (this.entity === 'company' || this.entity === 'contact') {
      const rows = await tx
        .select({ id: companies.id, name: companies.name, domain: companies.domain })
        .from(companies)
        .where(and(eq(companies.workspaceId, ws), isNull(companies.deletedAt)));
      for (const c of rows) {
        this.companyByName.set(c.name.toLowerCase(), c.id);
        if (this.entity === 'company') this.remember(c.id, c);
      }
    }
    if (this.entity === 'contact') {
      const rows = await tx
        .select({ id: contacts.id, email: contacts.email, phoneKey: contacts.phoneKey })
        .from(contacts)
        .where(and(eq(contacts.workspaceId, ws), isNull(contacts.deletedAt)));
      for (const c of rows) this.remember(c.id, c);
    }
    if (this.entity === 'lead') {
      const rows = await tx
        .select({ id: leads.id, email: leads.email, phoneKey: leads.phoneKey })
        .from(leads)
        .where(and(eq(leads.workspaceId, ws), isNull(leads.deletedAt)));
      for (const l of rows) this.remember(l.id, l);
    }
  }

  async row(n: number, record: Record<string, string>, custom: CustomValues) {
    try {
      if (this.entity === 'company') await this.company(n, record, custom);
      else if (this.entity === 'contact') await this.contact(n, record, custom);
      else await this.lead(n, record, custom);
    } catch (err) {
      // Validation of custom values or websites; anything else is a real failure.
      if (!(err instanceof BadRequestException)) throw err;
      this.report.failed++;
      this.problem(n, err.message);
    }
  }

  /** Validates `input`; on failure records the problem and returns null. */
  private valid<T>(n: number, schema: ZodType<T>, input: unknown): T | null {
    const r = schema.safeParse(input);
    if (r.success) return r.data;
    this.report.failed++;
    this.problem(n, issue(r.error));
    return null;
  }

  /** What to do with a row that matches `existing`: false means it's been dealt with (skipped). */
  private onMatch(n: number, existing: string | undefined): 'create' | 'update' | false {
    if (!existing || this.mode === 'create') return 'create';
    if (this.mode === 'update') return 'update';
    this.report.skipped++;
    this.problem(n, 'Already in the CRM; skipped.');
    return false;
  }

  private existing(keys: string[]) {
    return keys.map((k) => this.index.get(k)).find(Boolean);
  }

  private async company(n: number, rec: Record<string, string>, custom: CustomValues) {
    const { tx, workspaceId: ws } = this;
    const domain = rec.website ? domainOf(normaliseWebsite(rec.website), rec.email ?? null) : domainOf(null, rec.email?.toLowerCase() ?? null);
    const match = this.existing(this.keys({ domain, name: rec.name }));
    const action = this.onMatch(n, match);
    if (!action) return;
    if (action === 'update') {
      const [row] = await tx.select().from(companies).where(eq(companies.id, match!));
      const input = this.valid(n, companySchema, { ...row, ...rec, custom: {} });
      if (!input) return;
      await tx
        .update(companies)
        .set({ ...companyValues(input), custom: await cleanCustom(tx, ws, 'company', custom, row!.custom) })
        .where(eq(companies.id, match!));
      this.report.updated++;
      return;
    }
    const input = this.valid(n, companySchema, { ...rec, custom: {} });
    if (!input) return;
    const values = companyValues(input);
    const [created] = await tx
      .insert(companies)
      .values({ workspaceId: ws, ...values, ownerId: this.userId, custom: await cleanCustom(tx, ws, 'company', custom), createdBy: this.userId })
      .returning({ id: companies.id });
    this.remember(created!.id, values);
    this.companyByName.set(values.name.toLowerCase(), created!.id);
    this.report.created++;
  }

  /** The company named in a contact row: an existing one with that name, or a new one. */
  private async companyNamed(name: string | undefined): Promise<string | null> {
    if (!name) return null;
    const known = this.companyByName.get(name.toLowerCase());
    if (known) return known;
    const [c] = await this.tx
      .insert(companies)
      .values({ workspaceId: this.workspaceId, name: name.slice(0, 150), ownerId: this.userId, createdBy: this.userId })
      .returning({ id: companies.id });
    this.companyByName.set(name.toLowerCase(), c!.id);
    return c!.id;
  }

  private async contact(n: number, rec: Record<string, string>, custom: CustomValues) {
    const { tx, workspaceId: ws } = this;
    const names = rec.firstName ? { firstName: rec.firstName, lastName: rec.lastName ?? null } : rec.name ? splitName(rec.name) : { firstName: '', lastName: null };
    const email = rec.email?.toLowerCase();
    const match = this.existing(this.keys({ email, phoneKey: phoneKey(rec.phone) }));
    const action = this.onMatch(n, match);
    if (!action) return;
    if (action === 'update') {
      const [row] = await tx.select().from(contacts).where(eq(contacts.id, match!));
      const input = this.valid(n, contactSchema, { ...row, ...rec, ...(rec.firstName || rec.name ? names : {}), custom: {} });
      if (!input) return;
      const companyId = rec.company ? await this.companyNamed(rec.company) : row!.companyId;
      await tx
        .update(contacts)
        .set({ ...contactValues({ ...input, companyId }), custom: await cleanCustom(tx, ws, 'contact', custom, row!.custom) })
        .where(eq(contacts.id, match!));
      this.report.updated++;
      return;
    }
    const input = this.valid(n, contactSchema, { ...rec, ...names, custom: {} });
    if (!input) return;
    const customValues = await cleanCustom(tx, ws, 'contact', custom);
    const companyId = await this.companyNamed(rec.company);
    const values = contactValues({ ...input, companyId });
    const [created] = await tx
      .insert(contacts)
      .values({ workspaceId: ws, ...values, ownerId: this.userId, custom: customValues, createdBy: this.userId })
      .returning({ id: contacts.id });
    this.remember(created!.id, values);
    this.report.created++;
  }

  private async lead(n: number, rec: Record<string, string>, custom: CustomValues) {
    const { tx, workspaceId: ws } = this;
    const source = rec.source ? SOURCE_BY_NAME.get(headerKey(rec.source)) : undefined;
    const status = rec.status ? LEAD_STATUSES.find((s) => s === headerKey(rec.status!)) : undefined;
    // A currency column, or one written with the amount ("USD 3,000").
    const currency = (rec.currency ?? /\b[A-Za-z]{3}\b/.exec(rec.value ?? '')?.[0])?.toUpperCase();
    const shaped = {
      ...rec,
      source: source ?? 'other',
      // An unknown source isn't lost: it goes into the detail.
      sourceDetail: rec.sourceDetail ?? (rec.source && !source ? rec.source : undefined),
      status: status && status !== 'converted' ? (status as Exclude<LeadStatus, 'converted'>) : 'new',
      value: money(rec.value),
      currency: currency && (CURRENCIES as readonly string[]).includes(currency) ? currency : undefined,
      custom: {},
    };
    const email = rec.email?.toLowerCase();
    const match = this.existing(this.keys({ email, phoneKey: phoneKey(rec.phone) }));
    const action = this.onMatch(n, match);
    if (!action) return;
    if (action === 'update') {
      const [row] = await tx.select().from(leads).where(eq(leads.id, match!));
      const input = this.valid(n, leadSchema, {
        ...row,
        status: row!.status === 'converted' ? 'new' : row!.status,
        ...Object.fromEntries(Object.entries(shaped).filter(([k, v]) => v !== undefined && (k in rec || k === 'custom'))),
      });
      if (!input) return;
      await tx
        .update(leads)
        .set({
          name: input.name,
          companyName: input.companyName,
          email: input.email,
          phone: input.phone,
          phoneKey: phoneKey(input.phone),
          ...(rec.source ? { source: input.source, sourceDetail: input.sourceDetail } : {}),
          // A converted lead stays converted.
          ...(rec.status && row!.status !== 'converted' ? { status: input.status } : {}),
          value: input.value ?? null,
          currency: input.currency ?? row!.currency,
          notes: input.notes,
          custom: await cleanCustom(tx, ws, 'lead', custom, row!.custom),
        })
        .where(eq(leads.id, match!));
      this.report.updated++;
      return;
    }
    const input = this.valid(n, leadSchema, shaped);
    if (!input) return;
    const values = {
      workspaceId: ws,
      name: input.name,
      companyName: input.companyName,
      email: input.email,
      phone: input.phone,
      phoneKey: phoneKey(input.phone),
      source: input.source,
      sourceDetail: input.sourceDetail,
      status: input.status,
      value: input.value ?? null,
      currency: input.currency ?? this.currency,
      notes: input.notes,
      ownerId: this.userId,
      custom: await cleanCustom(tx, ws, 'lead', custom),
      createdBy: this.userId,
    };
    const [created] = await tx.insert(leads).values(values).returning({ id: leads.id });
    this.remember(created!.id, values);
    this.report.created++;
  }
}

