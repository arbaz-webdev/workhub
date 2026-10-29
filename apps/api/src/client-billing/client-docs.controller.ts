import { BadRequestException, Body, ConflictException, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import {
  CLIENT_DOC_KINDS,
  clientDocSchema,
  clientDocStatusSchema,
  invoiceFromHoursSchema,
  updateClientDocSchema,
  type ClientDocInput,
  type ClientDocSummaryDto,
  type ClientDocumentDto,
  type InvoiceFromHoursInput,
  type UnbilledProjectDto,
  type UpdateClientDocInput,
} from '@workhub/shared';
import { and, asc, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { audit } from '../audit/audit';
import { AuthContext, ClientIp, CurrentAuth, CurrentWorkspace, MinRole, WorkspaceContext } from '../common/request';
import { ZodPipe } from '../common/zod.pipe';
import { assertCompany } from '../crm/crm';
import { DbService } from '../db/db.service';
import { clientDocumentLines, clientDocuments, companies } from '../db/schema';
import { WorkspaceGuard } from '../workspaces/workspace.guard';
import { assertDraft, canMove, claimHours, documentDto, loadDoc, nextNumber, releaseHours, summaryDto, unbilledHours, workspaceToday, writeLines } from './client-docs';

const listQuery = z.object({ kind: z.enum(CLIENT_DOC_KINDS).optional(), companyId: z.uuid().optional() });
const unbilledQuery = z.object({ companyId: z.uuid(), from: z.iso.date(), to: z.iso.date() });

/** Quotes and invoices to the workspace's clients. Money, so managers and up. */
@Controller('client-docs')
@UseGuards(WorkspaceGuard)
@MinRole('manager')
export class ClientDocsController {
  constructor(private readonly db: DbService) {}

  private ctx(auth: AuthContext, ws: WorkspaceContext) {
    return { workspaceId: ws.id, userId: auth.userId };
  }

  @Get()
  list(@Query(new ZodPipe(listQuery)) q: z.infer<typeof listQuery>, @CurrentAuth() auth: AuthContext, @CurrentWorkspace() ws: WorkspaceContext): Promise<ClientDocSummaryDto[]> {
    return this.db.withContext(this.ctx(auth, ws), async (tx) => {
      const rows = await tx
        .select({ doc: clientDocuments, companyName: companies.name })
        .from(clientDocuments)
        .innerJoin(companies, eq(companies.id, clientDocuments.companyId))
        .where(
          and(
            eq(clientDocuments.workspaceId, ws.id),
            q.kind ? eq(clientDocuments.kind, q.kind) : undefined,
            q.companyId ? eq(clientDocuments.companyId, q.companyId) : undefined,
          ),
        )
        .orderBy(desc(clientDocuments.issueDate), desc(clientDocuments.number))
        .limit(500);
      const today = await workspaceToday(tx, ws.id);
      return rows.map((r) => summaryDto(r.doc, r.companyName, today));
    });
  }

  /** Approved hours not yet billed, by project, for one client. */
  @Get('unbilled')
  unbilled(@Query(new ZodPipe(unbilledQuery)) q: z.infer<typeof unbilledQuery>, @CurrentAuth() auth: AuthContext, @CurrentWorkspace() ws: WorkspaceContext): Promise<UnbilledProjectDto[]> {
    return this.db.withContext(this.ctx(auth, ws), async (tx) => {
      await assertCompany(tx, ws.id, q.companyId);
      return unbilledHours(tx, ws.id, q.companyId, q.from, q.to);
    });
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string, @CurrentAuth() auth: AuthContext, @CurrentWorkspace() ws: WorkspaceContext): Promise<ClientDocumentDto> {
    return this.db.withContext(this.ctx(auth, ws), async (tx) => documentDto(tx, ws.id, await loadDoc(tx, ws.id, id)));
  }

  @Post()
  create(@Body(new ZodPipe(clientDocSchema)) body: ClientDocInput, @CurrentAuth() auth: AuthContext, @CurrentWorkspace() ws: WorkspaceContext, @ClientIp() ip: string | undefined): Promise<ClientDocumentDto> {
    return this.db.withContext(this.ctx(auth, ws), async (tx) => {
      await assertCompany(tx, ws.id, body.companyId);
      const [row] = await tx
        .insert(clientDocuments)
        .values({
          workspaceId: ws.id,
          kind: body.kind,
          number: await nextNumber(tx, ws.id, body.kind),
          companyId: body.companyId,
          currency: body.currency,
          issueDate: body.issueDate,
          dueDate: body.dueDate,
          notes: body.notes,
          taxLabel: body.taxLabel,
          taxRate: body.taxRate,
          createdBy: auth.userId,
        })
        .returning();
      await writeLines(tx, row!, body.lines, body.taxRate);
      await audit(tx, { workspaceId: ws.id, actorUserId: auth.userId, action: `${body.kind}.created`, entityType: body.kind, entityId: row!.id, metadata: { number: row!.number }, ip });
      return documentDto(tx, ws.id, await loadDoc(tx, ws.id, row!.id));
    });
  }

  /** A draft invoice for a client's approved, unbilled hours: one line per project, at its hourly rate. */
  @Post('from-hours')
  fromHours(@Body(new ZodPipe(invoiceFromHoursSchema)) body: InvoiceFromHoursInput, @CurrentAuth() auth: AuthContext, @CurrentWorkspace() ws: WorkspaceContext, @ClientIp() ip: string | undefined): Promise<ClientDocumentDto> {
    return this.db.withContext(this.ctx(auth, ws), async (tx) => {
      await assertCompany(tx, ws.id, body.companyId);
      const chosen = (await unbilledHours(tx, ws.id, body.companyId, body.from, body.to)).filter((p) => body.projectIds.includes(p.projectId));
      if (chosen.length === 0) throw new BadRequestException('There are no approved, unbilled hours for those projects in those dates.');
      const noRate = chosen.filter((p) => p.rate === null);
      if (noRate.length) throw new BadRequestException(`Set an hourly rate for ${noRate.map((p) => p.projectName).join(', ')} in Reports → Costs first.`);
      const otherCurrency = chosen.filter((p) => p.currency !== body.currency);
      if (otherCurrency.length) throw new BadRequestException(`${otherCurrency.map((p) => p.projectName).join(', ')} ${otherCurrency.length === 1 ? 'is' : 'are'} billed in another currency. Make a separate invoice for ${otherCurrency.length === 1 ? 'it' : 'them'}.`);

      const [row] = await tx
        .insert(clientDocuments)
        .values({
          workspaceId: ws.id,
          kind: 'invoice',
          number: await nextNumber(tx, ws.id, 'invoice'),
          companyId: body.companyId,
          currency: body.currency,
          issueDate: body.issueDate,
          dueDate: body.dueDate,
          notes: body.notes,
          taxLabel: body.taxLabel,
          taxRate: body.taxRate,
          createdBy: auth.userId,
        })
        .returning();
      const period = body.from === body.to ? body.from : `${body.from} to ${body.to}`;
      await writeLines(
        tx,
        row!,
        chosen.map((p) => ({ description: `${p.projectName}: hours worked, ${period}`, quantity: p.hours, unitPrice: p.rate!, projectId: p.projectId })),
        body.taxRate,
      );
      await claimHours(tx, ws.id, row!.id, body.companyId, chosen.map((p) => p.projectId), body.from, body.to);
      await audit(tx, { workspaceId: ws.id, actorUserId: auth.userId, action: 'invoice.created', entityType: 'invoice', entityId: row!.id, metadata: { number: row!.number, fromHours: true, hours: chosen.reduce((t, p) => t + p.hours, 0) }, ip });
      return documentDto(tx, ws.id, await loadDoc(tx, ws.id, row!.id));
    });
  }

  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(updateClientDocSchema)) body: UpdateClientDocInput, @CurrentAuth() auth: AuthContext, @CurrentWorkspace() ws: WorkspaceContext): Promise<ClientDocumentDto> {
    return this.db.withContext(this.ctx(auth, ws), async (tx) => {
      const doc = await loadDoc(tx, ws.id, id);
      assertDraft(doc);
      await assertCompany(tx, ws.id, body.companyId);
      // Hours billed on an invoice belong to its client and currency.
      if (doc.kind === 'invoice' && (body.companyId !== doc.companyId || body.currency !== doc.currency)) {
        const current = await documentDto(tx, ws.id, doc);
        if (current.billedHours > 0) throw new ConflictException('This invoice bills timesheet hours, so its client and currency can’t change. Delete it and make a new one instead.');
      }
      await tx
        .update(clientDocuments)
        .set({ companyId: body.companyId, currency: body.currency, issueDate: body.issueDate, dueDate: body.dueDate, notes: body.notes, taxLabel: body.taxLabel, taxRate: body.taxRate })
        .where(eq(clientDocuments.id, id));
      await writeLines(tx, { ...doc, companyId: body.companyId }, body.lines, body.taxRate);
      return documentDto(tx, ws.id, await loadDoc(tx, ws.id, id));
    });
  }

  @Post(':id/status')
  @HttpCode(200)
  status(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(clientDocStatusSchema)) body: z.infer<typeof clientDocStatusSchema>,
    @CurrentAuth() auth: AuthContext,
    @CurrentWorkspace() ws: WorkspaceContext,
    @ClientIp() ip: string | undefined,
  ): Promise<ClientDocumentDto> {
    return this.db.withContext(this.ctx(auth, ws), async (tx) => {
      const doc = await loadDoc(tx, ws.id, id);
      if (!canMove(doc.kind, doc.status, body.status)) throw new ConflictException(`A ${doc.status} ${doc.kind} can’t be marked ${body.status}.`);
      const now = new Date();
      await tx
        .update(clientDocuments)
        .set({
          status: body.status,
          ...(body.status === 'sent' && !doc.sentAt ? { sentAt: now } : {}),
          paidAt: body.status === 'paid' ? now : null,
        })
        .where(eq(clientDocuments.id, id));
      if (body.status === 'void') await releaseHours(tx, id);
      await audit(tx, { workspaceId: ws.id, actorUserId: auth.userId, action: `${doc.kind}.${body.status}`, entityType: doc.kind, entityId: id, metadata: { number: doc.number, from: doc.status }, ip });
      return documentDto(tx, ws.id, await loadDoc(tx, ws.id, id));
    });
  }

  /** An accepted quote becomes a draft invoice with the same lines. */
  @Post(':id/invoice')
  toInvoice(@Param('id', ParseUUIDPipe) id: string, @CurrentAuth() auth: AuthContext, @CurrentWorkspace() ws: WorkspaceContext, @ClientIp() ip: string | undefined): Promise<ClientDocumentDto> {
    return this.db.withContext(this.ctx(auth, ws), async (tx) => {
      const quote = await loadDoc(tx, ws.id, id);
      if (quote.kind !== 'quote' || quote.status !== 'accepted') throw new ConflictException('Only an accepted quote can become an invoice.');
      const [existing] = await tx.select({ id: clientDocuments.id }).from(clientDocuments).where(and(eq(clientDocuments.quoteId, id), eq(clientDocuments.workspaceId, ws.id)));
      if (existing) throw new ConflictException('This quote already has an invoice.');
      const lines = await tx.select().from(clientDocumentLines).where(eq(clientDocumentLines.documentId, id)).orderBy(asc(clientDocumentLines.position));
      const today = await workspaceToday(tx, ws.id);
      const [row] = await tx
        .insert(clientDocuments)
        .values({
          workspaceId: ws.id,
          kind: 'invoice',
          number: await nextNumber(tx, ws.id, 'invoice'),
          companyId: quote.companyId,
          currency: quote.currency,
          issueDate: today,
          notes: quote.notes,
          taxLabel: quote.taxLabel,
          taxRate: quote.taxRate,
          quoteId: quote.id,
          createdBy: auth.userId,
        })
        .returning();
      await writeLines(tx, row!, lines.map((l) => ({ description: l.description, quantity: l.quantity, unitPrice: l.unitPrice, projectId: l.projectId })), quote.taxRate);
      await audit(tx, { workspaceId: ws.id, actorUserId: auth.userId, action: 'invoice.created', entityType: 'invoice', entityId: row!.id, metadata: { number: row!.number, fromQuote: quote.number }, ip });
      return documentDto(tx, ws.id, await loadDoc(tx, ws.id, row!.id));
    });
  }

  /** Drafts only; anything sent is kept (void an invoice instead). */
  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id', ParseUUIDPipe) id: string, @CurrentAuth() auth: AuthContext, @CurrentWorkspace() ws: WorkspaceContext, @ClientIp() ip: string | undefined): Promise<void> {
    await this.db.withContext(this.ctx(auth, ws), async (tx) => {
      const doc = await loadDoc(tx, ws.id, id);
      assertDraft(doc);
      await releaseHours(tx, id);
      await tx.update(clientDocuments).set({ quoteId: null }).where(eq(clientDocuments.quoteId, id));
      await tx.delete(clientDocuments).where(eq(clientDocuments.id, id));
      await audit(tx, { workspaceId: ws.id, actorUserId: auth.userId, action: `${doc.kind}.deleted`, entityType: doc.kind, entityId: id, metadata: { number: doc.number }, ip });
    });
  }
}
