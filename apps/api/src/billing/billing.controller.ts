import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  bankTransferSchema,
  billingDetailsSchema,
  checkoutSchema,
  PLAN_INFO,
  reviewTransferSchema,
  type BillingDetailsInput,
  type CheckoutInput,
  type InvoiceDto,
  type SubscriptionDto,
  type TransferReviewDto,
} from '@workhub/shared';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { Response } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { audit } from '../audit/audit';
import { addDays, zonedParts } from '../attendance/zoned';
import { config } from '../config';
import { AuthContext, ClientIp, CurrentAuth, CurrentWorkspace, MinRole, WorkspaceContext } from '../common/request';
import { ZodPipe } from '../common/zod.pipe';
import { DbService, Tx } from '../db/db.service';
import { invoices, subscriptions, users, workspaces } from '../db/schema';
import { EmailService } from '../email/email.service';
import { escapeHtml } from '../email/templates';
import { notifyRoles } from '../notifications/notify';
import { contentDisposition, StorageService, uploadMeta } from '../storage/storage.service';
import { WorkspaceGuard } from '../workspaces/workspace.guard';
import { effectivePlan, invoiceDto, loadSubscription, markPaid, priceFor, seatsUsed, subscriptionDto, type InvoiceRow } from './plans';

const PROOF_EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'application/pdf': 'pdf' };
const PROOF_TYPES = new Set(Object.keys(PROOF_EXT));
const MAX_PROOF_BYTES = 10 * 1024 * 1024;
/** Invoices are due a week after they're issued. */
const DUE_DAYS = 7;

const pkr = (n: number) => `PKR ${n.toLocaleString('en', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

/**
 * A workspace's plan and invoices. Owners and admins manage billing; everyone can see
 * the plan (it decides what they can use).
 */
@Controller('billing')
@UseGuards(WorkspaceGuard)
@MinRole('admin')
export class BillingController {
  constructor(
    private readonly db: DbService,
    private readonly storage: StorageService,
    private readonly email: EmailService,
  ) {}

  private ctx(auth: AuthContext, ws: WorkspaceContext) {
    return { workspaceId: ws.id, userId: auth.userId };
  }

  @Get('subscription')
  @MinRole('guest')
  async subscription(@CurrentAuth() auth: AuthContext, @CurrentWorkspace() ws: WorkspaceContext): Promise<SubscriptionDto> {
    return this.db.withContext(this.ctx(auth, ws), (tx) => subscriptionDto(tx, ws.id));
  }

  @Patch('details')
  async details(
    @Body(new ZodPipe(billingDetailsSchema)) body: BillingDetailsInput,
    @CurrentAuth() auth: AuthContext,
    @CurrentWorkspace() ws: WorkspaceContext,
  ): Promise<SubscriptionDto> {
    return this.db.withContext(this.ctx(auth, ws), async (tx) => {
      await loadSubscription(tx, ws.id);
      await tx.update(subscriptions).set(body).where(eq(subscriptions.workspaceId, ws.id));
      return subscriptionDto(tx, ws.id);
    });
  }

  /** Issues an invoice for a plan (replacing any unpaid one), for everyone who takes a seat today. */
  @Post('checkout')
  async checkout(
    @Body(new ZodPipe(checkoutSchema)) body: CheckoutInput,
    @CurrentAuth() auth: AuthContext,
    @CurrentWorkspace() ws: WorkspaceContext,
    @ClientIp() ip: string | undefined,
  ): Promise<InvoiceDto> {
    return this.db.withContext(this.ctx(auth, ws), async (tx) => {
      const sub = await loadSubscription(tx, ws.id);
      if (!sub.billingName || !sub.billingEmail || !sub.province) throw new BadRequestException('Add your billing details first.');
      const [pending] = await tx
        .select({ number: invoices.number })
        .from(invoices)
        .where(and(eq(invoices.workspaceId, ws.id), eq(invoices.status, 'pending_review')));
      if (pending) throw new ConflictException(`Invoice ${pending.number} is waiting for us to confirm your bank transfer.`);
      await tx
        .update(invoices)
        .set({ status: 'void' })
        .where(and(eq(invoices.workspaceId, ws.id), eq(invoices.status, 'open')));

      const [w] = await tx.select({ name: workspaces.name, timezone: workspaces.timezone }).from(workspaces).where(eq(workspaces.id, ws.id));
      const today = zonedParts(new Date(), w!.timezone).date;
      // Renewing the plan you have continues from where it ends; anything else starts today.
      const renewing = effectivePlan(sub).status === 'active' && sub.plan === body.plan && sub.billingCycle === body.cycle && sub.paidUntil;
      const start = renewing ? addDays(sub.paidUntil!, 1) : today;
      const seats = Math.max(1, await seatsUsed(tx, ws.id));
      const price = priceFor(body.plan, body.cycle, seats, sub.province, start);
      const { rows } = await tx.execute<{ n: string }>(sql`select nextval('invoice_number_seq') as n`);
      const [row] = await tx
        .insert(invoices)
        .values({
          workspaceId: ws.id,
          number: `WH-${today.slice(0, 4)}-${String(rows[0]!.n).padStart(6, '0')}`,
          plan: body.plan,
          billingCycle: body.cycle,
          seats,
          unitPrice: price.unitPrice,
          months: price.months,
          subtotal: price.subtotal,
          taxLabel: price.taxLabel,
          taxRate: price.taxRate,
          taxAmount: price.taxAmount,
          total: price.total,
          periodStart: start,
          periodEnd: price.periodEnd,
          billTo: { name: sub.billingName, email: sub.billingEmail, ntn: sub.ntn, province: sub.province, address: sub.address, workspace: w!.name },
          dueAt: new Date(Date.now() + DUE_DAYS * 86_400_000),
          createdBy: auth.userId,
        })
        .returning();
      await audit(tx, { workspaceId: ws.id, actorUserId: auth.userId, action: 'invoice.issued', entityType: 'invoice', entityId: row!.id, metadata: { number: row!.number, plan: body.plan, cycle: body.cycle, seats, total: price.total }, ip });
      return invoiceDto(row!);
    });
  }

  @Get('invoices')
  async invoices(@CurrentAuth() auth: AuthContext, @CurrentWorkspace() ws: WorkspaceContext): Promise<InvoiceDto[]> {
    return this.db.withContext(this.ctx(auth, ws), async (tx) =>
      (await tx.select().from(invoices).where(eq(invoices.workspaceId, ws.id)).orderBy(desc(invoices.issuedAt)).limit(100)).map(invoiceDto),
    );
  }

  @Get('invoices/:id')
  async invoice(@Param('id', ParseUUIDPipe) id: string, @CurrentAuth() auth: AuthContext, @CurrentWorkspace() ws: WorkspaceContext): Promise<InvoiceDto> {
    return this.db.withContext(this.ctx(auth, ws), async (tx) => invoiceDto(await loadInvoice(tx, ws.id, id)));
  }

  /** Where to pay online: the gateway's checkout (or, with the test gateway, our pretend one). */
  @Post('invoices/:id/pay')
  async pay(@Param('id', ParseUUIDPipe) id: string, @CurrentAuth() auth: AuthContext, @CurrentWorkspace() ws: WorkspaceContext): Promise<{ url: string }> {
    const invoice = await this.db.withContext(this.ctx(auth, ws), (tx) => loadInvoice(tx, ws.id, id));
    if (invoice.status !== 'open') throw new ConflictException(invoice.status === 'paid' ? 'This invoice is already paid.' : 'This invoice can’t be paid now.');
    if (config.paymentsDriver === 'none') throw new BadRequestException('Paying online isn’t available yet. Please pay by bank transfer.');
    return { url: `/app/settings/billing/test-checkout?invoice=${id}` };
  }

  /** The test gateway's "payment succeeded". Only exists while PAYMENTS_DRIVER=test. */
  @Post('invoices/:id/test-pay')
  async testPay(@Param('id', ParseUUIDPipe) id: string, @CurrentAuth() auth: AuthContext, @CurrentWorkspace() ws: WorkspaceContext, @ClientIp() ip: string | undefined): Promise<InvoiceDto> {
    if (config.paymentsDriver !== 'test') throw new NotFoundException();
    const dto = await this.db.withContext(this.ctx(auth, ws), async (tx) => {
      const invoice = await loadInvoice(tx, ws.id, id);
      if (invoice.status !== 'open') throw new ConflictException('This invoice can’t be paid now.');
      await markPaid(tx, invoice, 'test', `test_${randomUUID().slice(0, 8)}`);
      await audit(tx, { workspaceId: ws.id, actorUserId: auth.userId, action: 'invoice.paid', entityType: 'invoice', entityId: id, metadata: { number: invoice.number, method: 'test' }, ip });
      await notifyRoles(tx, ws.id, ['owner', 'admin'], { type: 'billing.paid', title: `Payment received for ${invoice.number}`, body: `${PLAN_INFO[invoice.plan].name} until ${invoice.periodEnd}`, link: `/app/settings/billing/invoices/${id}` });
      return invoiceDto((await loadInvoice(tx, ws.id, id))!);
    });
    await this.receipt(dto);
    return dto;
  }

  /** Paying by bank transfer: the customer's reference and receipt, for WorkHub to confirm. Annual plans only. */
  @Post('invoices/:id/bank-transfer')
  @UseInterceptors(FileInterceptor('proof', { limits: { fileSize: MAX_PROOF_BYTES, files: 1, fields: 5 } }))
  async bankTransfer(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(bankTransferSchema)) body: z.infer<typeof bankTransferSchema>,
    @UploadedFile() proof: Express.Multer.File | undefined,
    @CurrentAuth() auth: AuthContext,
    @CurrentWorkspace() ws: WorkspaceContext,
    @ClientIp() ip: string | undefined,
  ): Promise<InvoiceDto> {
    if (!config.bankAccount) throw new BadRequestException('Bank transfer isn’t available.');
    if (!proof || proof.size === 0) throw new BadRequestException('Attach the transfer receipt (a screenshot or PDF).');
    const { contentType } = uploadMeta(proof);
    if (!PROOF_TYPES.has(contentType)) throw new BadRequestException('The receipt must be a PNG, JPEG, WebP or PDF.');
    // The extension records the type, for serving it back.
    const key = `${ws.id}/billing/${id}/${randomUUID()}.${PROOF_EXT[contentType]}`;
    let stored = false;
    try {
      return await this.db.withContext(this.ctx(auth, ws), async (tx) => {
        const invoice = await loadInvoice(tx, ws.id, id);
        if (invoice.status !== 'open') throw new ConflictException('This invoice can’t be paid now.');
        if (invoice.billingCycle !== 'annual') throw new BadRequestException('Bank transfer is for annual plans. Pay monthly plans online.');
        await this.storage.put(key, proof.buffer, contentType);
        stored = true;
        const [row] = await tx
          .update(invoices)
          .set({ status: 'pending_review', paymentMethod: 'bank_transfer', transferReference: body.reference, transferProofKey: key, transferSubmittedAt: new Date() })
          .where(eq(invoices.id, id))
          .returning();
        await audit(tx, { workspaceId: ws.id, actorUserId: auth.userId, action: 'invoice.transfer_submitted', entityType: 'invoice', entityId: id, metadata: { number: invoice.number, reference: body.reference }, ip });
        return invoiceDto(row!);
      });
    } catch (err) {
      if (stored) await this.storage.delete(key).catch(() => {});
      throw err;
    }
  }

  private async receipt(invoice: InvoiceDto) {
    const lines = [
      `Thank you. We've received ${pkr(invoice.total)} for invoice ${invoice.number}.`,
      `Your workspace is on the ${PLAN_INFO[invoice.plan].name} plan until ${invoice.periodEnd}.`,
      `View the invoice: ${config.appUrl}/app/settings/billing/invoices/${invoice.id}`,
    ];
    await this.email
      .send({
        to: invoice.billTo.email,
        subject: `Payment received: ${invoice.number}`,
        text: lines.join('\n\n'),
        html: lines.map((l) => `<p>${escapeHtml(l)}</p>`).join(''),
      })
      .catch(() => {});
  }
}

async function loadInvoice(tx: Tx, workspaceId: string, id: string): Promise<InvoiceRow> {
  const [row] = await tx
    .select()
    .from(invoices)
    .where(and(eq(invoices.id, id), eq(invoices.workspaceId, workspaceId)));
  if (!row) throw new NotFoundException('Invoice not found');
  return row;
}

/**
 * WorkHub's own staff (PLATFORM_ADMINS, with a verified email): the queue of bank
 * transfers to confirm against the bank statement.
 */
@Controller('platform')
export class PlatformController {
  constructor(
    private readonly db: DbService,
    private readonly storage: StorageService,
    private readonly email: EmailService,
  ) {}

  private async admin(auth: AuthContext): Promise<string> {
    const [u] = await this.db.db.select({ email: users.email, verified: users.emailVerifiedAt }).from(users).where(eq(users.id, auth.userId));
    if (!u || !u.verified || !config.platformAdmins.includes(u.email.toLowerCase())) throw new ForbiddenException();
    return u.email;
  }

  @Get('transfers')
  async transfers(@CurrentAuth() auth: AuthContext): Promise<TransferReviewDto[]> {
    await this.admin(auth);
    const { rows } = await this.db.db.execute<{ id: string; workspace_id: string }>(sql`select * from pending_bank_transfers(200)`);
    const out: TransferReviewDto[] = [];
    for (const r of rows) {
      out.push(
        await this.db.withContext({ workspaceId: r.workspace_id }, async (tx) => {
          const invoice = await loadInvoice(tx, r.workspace_id, r.id);
          const [w] = await tx.select({ name: workspaces.name }).from(workspaces).where(eq(workspaces.id, r.workspace_id));
          return { ...invoiceDto(invoice), workspaceId: r.workspace_id, workspaceName: w?.name ?? '', proofUrl: invoice.transferProofKey ? `/platform/transfers/${r.id}/proof` : null };
        }),
      );
    }
    return out;
  }

  @Get('transfers/:id/proof')
  async proof(@Param('id', ParseUUIDPipe) id: string, @CurrentAuth() auth: AuthContext, @Res() res: Response) {
    await this.admin(auth);
    const workspaceId = await this.workspaceOf(id);
    const invoice = await this.db.withContext({ workspaceId }, (tx) => loadInvoice(tx, workspaceId, id));
    if (!invoice.transferProofKey) throw new NotFoundException();
    const ext = invoice.transferProofKey.split('.').pop() ?? '';
    const contentType = Object.entries(PROOF_EXT).find(([, e]) => e === ext)?.[0] ?? 'application/octet-stream';
    const fileName = `${invoice.number}-receipt.${ext}`;
    const result = await this.storage.download(invoice.transferProofKey, { fileName, contentType, inline: false });
    if (result.kind === 'redirect') return res.redirect(302, result.url);
    // Always a download, never shown in the page, whatever the customer uploaded.
    res.setHeader('content-type', 'application/octet-stream');
    res.setHeader('content-disposition', contentDisposition(fileName, false));
    result.stream.pipe(res);
  }

  /** Confirms the money arrived (the plan starts) or sends the invoice back to the customer with a note. */
  @Post('transfers/:id/review')
  async review(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(reviewTransferSchema)) body: z.infer<typeof reviewTransferSchema>, @CurrentAuth() auth: AuthContext): Promise<InvoiceDto> {
    const reviewer = await this.admin(auth);
    const workspaceId = await this.workspaceOf(id);
    const dto = await this.db.withContext({ workspaceId }, async (tx) => {
      const invoice = await loadInvoice(tx, workspaceId, id);
      if (invoice.status !== 'pending_review') throw new ConflictException('This transfer was already reviewed.');
      if (body.approve) {
        await markPaid(tx, invoice, 'bank_transfer', invoice.transferReference, reviewer);
        await notifyRoles(tx, workspaceId, ['owner', 'admin'], { type: 'billing.paid', title: `Bank transfer confirmed for ${invoice.number}`, body: `${PLAN_INFO[invoice.plan].name} until ${invoice.periodEnd}`, link: `/app/settings/billing/invoices/${id}` });
      } else {
        await tx
          .update(invoices)
          .set({ status: 'open', reviewedBy: reviewer, reviewNote: body.note ?? 'We couldn’t match this transfer. Please check the details and try again.' })
          .where(eq(invoices.id, id));
        await notifyRoles(tx, workspaceId, ['owner', 'admin'], { type: 'billing.transfer_rejected', title: `We couldn’t confirm the transfer for ${invoice.number}`, body: body.note, link: `/app/settings/billing/invoices/${id}` });
      }
      await audit(tx, { workspaceId, actorUserId: auth.userId, action: body.approve ? 'invoice.paid' : 'invoice.transfer_rejected', entityType: 'invoice', entityId: id, metadata: { number: invoice.number, reviewer, note: body.note ?? null } });
      return invoiceDto((await loadInvoice(tx, workspaceId, id))!);
    });
    if (body.approve) {
      await this.email
        .send({
          to: dto.billTo.email,
          subject: `Payment received: ${dto.number}`,
          text: `Thank you. We've confirmed your bank transfer of ${pkr(dto.total)} for invoice ${dto.number}. You're on ${PLAN_INFO[dto.plan].name} until ${dto.periodEnd}.`,
          html: `<p>Thank you. We've confirmed your bank transfer of ${escapeHtml(pkr(dto.total))} for invoice ${escapeHtml(dto.number)}. You're on ${escapeHtml(PLAN_INFO[dto.plan].name)} until ${escapeHtml(dto.periodEnd)}.</p>`,
        })
        .catch(() => {});
    }
    return dto;
  }

  private async workspaceOf(invoiceId: string): Promise<string> {
    const { rows } = await this.db.db.execute<{ w: string | null }>(sql`select invoice_workspace(${invoiceId}::uuid) as w`);
    if (!rows[0]?.w) throw new NotFoundException('Invoice not found');
    return rows[0].w;
  }
}

