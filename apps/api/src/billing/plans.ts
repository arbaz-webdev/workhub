// Which plan a workspace is on, what it allows, and what an invoice for it comes to.
// All run inside the caller's tenant transaction.
import { ForbiddenException } from '@nestjs/common';
import {
  ANNUAL_MONTHS_CHARGED,
  PLAN_INFO,
  PROVINCE_LABELS,
  TRIAL_DAYS,
  type BillingCycle,
  type InvoiceDto,
  type PaidPlan,
  type PlanFeature,
  type PlanKey,
  type Province,
  type SubscriptionDto,
} from '@workhub/shared';
import { and, eq, ne, sql } from 'drizzle-orm';
import { addDays } from '../attendance/zoned';
import { config } from '../config';
import type { Tx } from '../db/db.service';
import { invoices, memberships, subscriptions } from '../db/schema';

/** Days after a paid period ends before the workspace drops to Free. */
export const GRACE_DAYS = 7;

export type SubscriptionRow = typeof subscriptions.$inferSelect;
export type InvoiceRow = typeof invoices.$inferSelect;

export async function loadSubscription(tx: Tx, workspaceId: string): Promise<SubscriptionRow> {
  const [row] = await tx.select().from(subscriptions).where(eq(subscriptions.workspaceId, workspaceId));
  if (row) return row;
  // Workspaces made before billing existed, or by a path that didn't add one.
  const [created] = await tx
    .insert(subscriptions)
    .values({ workspaceId, trialEndsAt: new Date(Date.now() + TRIAL_DAYS * 86_400_000) })
    .onConflictDoNothing()
    .returning();
  return created ?? (await tx.select().from(subscriptions).where(eq(subscriptions.workspaceId, workspaceId)))[0]!;
}

/** The plan in force today, and why. */
export function effectivePlan(sub: SubscriptionRow, now = new Date()): { plan: PlanKey; status: SubscriptionDto['status'] } {
  const today = now.toISOString().slice(0, 10);
  if (sub.plan !== 'free' && sub.paidUntil) {
    if (sub.paidUntil >= today) return { plan: sub.plan, status: 'active' };
    if (addDays(sub.paidUntil, GRACE_DAYS) >= today) return { plan: sub.plan, status: 'grace' };
  }
  if (sub.trialEndsAt && sub.trialEndsAt > now) return { plan: 'business', status: 'trial' };
  return { plan: 'free', status: 'free' };
}

/** People who take a seat: everyone but guests. */
export async function seatsUsed(tx: Tx, workspaceId: string): Promise<number> {
  const [{ n }] = (await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(memberships)
    .where(and(eq(memberships.workspaceId, workspaceId), ne(memberships.role, 'guest')))) as [{ n: number }];
  return n;
}

/** Refuses a new seat when the plan's limit is reached. */
export async function assertSeat(tx: Tx, workspaceId: string) {
  if (!config.billingEnforced) return;
  const { plan } = effectivePlan(await loadSubscription(tx, workspaceId));
  const limit = PLAN_INFO[plan].maxUsers;
  if (limit !== null && (await seatsUsed(tx, workspaceId)) >= limit) {
    throw new ForbiddenException(`The ${PLAN_INFO[plan].name} plan is for up to ${limit} people (guests don’t count). Upgrade in Settings → Billing to add more.`);
  }
}

/** Refuses a Business feature on a plan without it. */
export async function requireFeature(tx: Tx, workspaceId: string, feature: PlanFeature) {
  if (!config.billingEnforced) return;
  const { plan } = effectivePlan(await loadSubscription(tx, workspaceId));
  if (!PLAN_INFO[plan].features.includes(feature)) {
    const what = { profitability: 'Client profitability', custom_fields: 'Custom fields', pipelines: 'More than one sales pipeline' }[feature];
    throw new ForbiddenException(`${what} is part of the Business plan. Upgrade in Settings → Billing.`);
  }
}

export async function subscriptionDto(tx: Tx, workspaceId: string): Promise<SubscriptionDto> {
  const sub = await loadSubscription(tx, workspaceId);
  const now = effectivePlan(sub);
  const enforced = config.billingEnforced;
  const plan = enforced ? now.plan : 'business';
  return {
    plan,
    status: now.status,
    paidPlan: sub.plan === 'free' ? null : sub.plan,
    billingCycle: sub.billingCycle,
    paidUntil: sub.paidUntil,
    trialEndsAt: sub.trialEndsAt?.toISOString() ?? null,
    seatsUsed: await seatsUsed(tx, workspaceId),
    seatLimit: enforced ? PLAN_INFO[plan].maxUsers : null,
    features: [...PLAN_INFO[plan].features],
    enforced,
    details: { billingName: sub.billingName, billingEmail: sub.billingEmail, ntn: sub.ntn, province: sub.province, address: sub.address },
    payments: {
      online: config.paymentsDriver !== 'none',
      onlineLabel: config.paymentsDriver === 'test' ? 'Test payment (no money moves)' : null,
      bankTransfer: config.bankAccount,
    },
  };
}

/** Sales tax for a province: rate and the line's label. */
export function salesTax(province: Province): { rate: number; label: string | null } {
  const rate = config.salesTaxRates[province] ?? 0;
  return { rate, label: rate > 0 ? `Sales tax on services, ${PROVINCE_LABELS[province]} (${rate}%)` : null };
}

const money = (n: number) => Math.round(n * 100) / 100;

/** What a plan costs for `seats` people over one billing period starting `start`. */
export function priceFor(plan: PaidPlan, cycle: BillingCycle, seats: number, province: Province, start: string) {
  const unitPrice = PLAN_INFO[plan].pricePerUser;
  const months = cycle === 'annual' ? 12 : 1;
  const charged = cycle === 'annual' ? ANNUAL_MONTHS_CHARGED : 1;
  const subtotal = money(unitPrice * seats * charged);
  const tax = salesTax(province);
  const taxAmount = money((subtotal * tax.rate) / 100);
  const [y, m, d] = start.split('-').map(Number) as [number, number, number];
  // The same day next month (or year), less a day; clamped for months without that day.
  const endMonth = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(Date.UTC(endMonth.getUTCFullYear(), endMonth.getUTCMonth() + 1, 0)).getUTCDate();
  const periodEnd = addDays(`${endMonth.toISOString().slice(0, 7)}-${String(Math.min(d, lastDay)).padStart(2, '0')}`, -1);
  return { unitPrice, months, subtotal, taxRate: tax.rate, taxLabel: tax.label, taxAmount, total: money(subtotal + taxAmount), periodEnd };
}

export function invoiceDto(r: InvoiceRow): InvoiceDto {
  return {
    id: r.id,
    number: r.number,
    status: r.status,
    plan: r.plan,
    billingCycle: r.billingCycle,
    seats: r.seats,
    unitPrice: r.unitPrice,
    months: r.months,
    subtotal: r.subtotal,
    taxLabel: r.taxLabel,
    taxRate: r.taxRate,
    taxAmount: r.taxAmount,
    total: r.total,
    currency: r.currency,
    periodStart: r.periodStart,
    periodEnd: r.periodEnd,
    billTo: r.billTo,
    seller: config.seller,
    issuedAt: r.issuedAt.toISOString(),
    dueAt: r.dueAt.toISOString(),
    paidAt: r.paidAt?.toISOString() ?? null,
    paymentMethod: r.paymentMethod,
    transferReference: r.transferReference,
    transferSubmittedAt: r.transferSubmittedAt?.toISOString() ?? null,
    reviewNote: r.reviewNote,
  };
}

/** Records the payment and puts the workspace on the plan until the period ends. */
export async function markPaid(tx: Tx, invoice: InvoiceRow, method: NonNullable<InvoiceRow['paymentMethod']>, ref: string | null, reviewer?: string) {
  const now = new Date();
  await tx
    .update(invoices)
    .set({ status: 'paid', paidAt: now, paymentMethod: method, providerRef: ref, ...(reviewer ? { reviewedBy: reviewer } : {}) })
    .where(eq(invoices.id, invoice.id));
  const sub = await loadSubscription(tx, invoice.workspaceId);
  await tx
    .update(subscriptions)
    .set({
      plan: invoice.plan,
      billingCycle: invoice.billingCycle,
      paidUntil: sub.paidUntil && sub.paidUntil > invoice.periodEnd ? sub.paidUntil : invoice.periodEnd,
    })
    .where(eq(subscriptions.workspaceId, invoice.workspaceId));
}
