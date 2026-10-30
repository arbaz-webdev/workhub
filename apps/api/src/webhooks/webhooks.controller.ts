import { BadRequestException, Body, Controller, Delete, Get, HttpCode, NotFoundException, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import {
  createWebhookSchema,
  updateWebhookSchema,
  WEBHOOK_SECRET_PREFIX,
  type CreateWebhookInput,
  type UpdateWebhookInput,
  type WebhookCreatedDto,
  type WebhookDeliveryDto,
  type WebhookDto,
} from '@workhub/shared';
import { randomBytes } from 'node:crypto';
import { and, count, desc, eq, inArray } from 'drizzle-orm';
import { audit } from '../audit/audit';
import { encryptSecret } from '../auth/totp';
import { requireFeature } from '../billing/plans';
import { AuthContext, ClientIp, CurrentAuth, CurrentWorkspace, MinRole, WorkspaceContext } from '../common/request';
import { ZodPipe } from '../common/zod.pipe';
import { config } from '../config';
import { DbService, Tx } from '../db/db.service';
import { users, webhookDeliveries, webhooks } from '../db/schema';
import { WorkspaceGuard } from '../workspaces/workspace.guard';
import { checkResolves, checkUrl, UnsafeUrlError } from './url-safety';
import { WebhookService } from './webhook.service';

/** A workspace may have this many webhooks. */
const MAX_WEBHOOKS = 10;

/** Settings → API: admins add, change, test and remove the workspace's webhooks. */
@Controller('webhooks')
@UseGuards(WorkspaceGuard)
@MinRole('admin')
export class WebhooksController {
  constructor(
    private readonly db: DbService,
    private readonly service: WebhookService,
  ) {}

  private ctx(auth: AuthContext, ws: WorkspaceContext) {
    return { workspaceId: ws.id, userId: auth.userId };
  }

  @Get()
  list(@CurrentAuth() auth: AuthContext, @CurrentWorkspace() ws: WorkspaceContext): Promise<WebhookDto[]> {
    return this.db.withContext(this.ctx(auth, ws), (tx) => webhookDtos(tx, ws.id));
  }

  @Post()
  async create(
    @Body(new ZodPipe(createWebhookSchema)) body: CreateWebhookInput,
    @CurrentAuth() auth: AuthContext,
    @CurrentWorkspace() ws: WorkspaceContext,
    @ClientIp() ip: string | undefined,
  ): Promise<WebhookCreatedDto> {
    const url = await safeUrl(body.url);
    return this.db.withContext(this.ctx(auth, ws), async (tx) => {
      await requireFeature(tx, ws.id, 'api');
      const [{ n }] = (await tx.select({ n: count() }).from(webhooks).where(eq(webhooks.workspaceId, ws.id))) as [{ n: number }];
      if (n >= MAX_WEBHOOKS) throw new BadRequestException(`A workspace can have up to ${MAX_WEBHOOKS} webhooks.`);
      const secret = `${WEBHOOK_SECRET_PREFIX}${randomBytes(24).toString('base64url')}`;
      const [row] = await tx
        .insert(webhooks)
        .values({ workspaceId: ws.id, createdBy: auth.userId, url, events: [...new Set(body.events)], secretEncrypted: encryptSecret(secret) })
        .returning({ id: webhooks.id });
      await audit(tx, { workspaceId: ws.id, actorUserId: auth.userId, action: 'webhook.created', entityType: 'webhook', entityId: row!.id, metadata: { url, events: body.events }, ip });
      const dto = (await webhookDtos(tx, ws.id)).find((w) => w.id === row!.id)!;
      return { ...dto, secret };
    });
  }

  @Patch(':id')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(updateWebhookSchema)) body: UpdateWebhookInput,
    @CurrentAuth() auth: AuthContext,
    @CurrentWorkspace() ws: WorkspaceContext,
    @ClientIp() ip: string | undefined,
  ): Promise<WebhookDto> {
    const url = body.url === undefined ? undefined : await safeUrl(body.url);
    return this.db.withContext(this.ctx(auth, ws), async (tx) => {
      await loadWebhook(tx, ws.id, id);
      const [me] = await tx.select({ name: users.name }).from(users).where(eq(users.id, auth.userId));
      const now = new Date();
      await tx
        .update(webhooks)
        .set({
          ...(url !== undefined ? { url } : {}),
          ...(body.events ? { events: [...new Set(body.events)] } : {}),
          ...(body.paused === true ? { pausedAt: now, pausedReason: `Paused by ${me!.name}.` } : body.paused === false ? { pausedAt: null, pausedReason: null } : {}),
          updatedAt: now,
        })
        .where(eq(webhooks.id, id));
      await audit(tx, { workspaceId: ws.id, actorUserId: auth.userId, action: 'webhook.updated', entityType: 'webhook', entityId: id, metadata: { ...body }, ip });
      return (await webhookDtos(tx, ws.id)).find((w) => w.id === id)!;
    });
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id', ParseUUIDPipe) id: string, @CurrentAuth() auth: AuthContext, @CurrentWorkspace() ws: WorkspaceContext, @ClientIp() ip: string | undefined): Promise<void> {
    await this.db.withContext(this.ctx(auth, ws), async (tx) => {
      const webhook = await loadWebhook(tx, ws.id, id);
      await tx.delete(webhooks).where(eq(webhooks.id, id));
      await audit(tx, { workspaceId: ws.id, actorUserId: auth.userId, action: 'webhook.deleted', entityType: 'webhook', entityId: id, metadata: { url: webhook.url }, ip });
    });
  }

  /** Sends a "ping" now and answers with how it went. One attempt, no retries. */
  @Post(':id/test')
  @HttpCode(200)
  async test(@Param('id', ParseUUIDPipe) id: string, @CurrentAuth() auth: AuthContext, @CurrentWorkspace() ws: WorkspaceContext): Promise<WebhookDeliveryDto> {
    const deliveryId = await this.db.withContext(this.ctx(auth, ws), async (tx) => {
      const webhook = await loadWebhook(tx, ws.id, id);
      if (webhook.pausedAt) throw new BadRequestException('Resume the webhook to send a test.');
      const [row] = await tx
        .insert(webhookDeliveries)
        .values({
          workspaceId: ws.id,
          webhookId: id,
          event: 'ping',
          payload: { createdAt: new Date().toISOString(), data: { message: 'A test from WorkHub. Your webhook works.' } },
          // The API's clock, as in emitWebhookEvent: due straight away.
          nextAttemptAt: new Date(),
        })
        .returning({ id: webhookDeliveries.id });
      return row!.id;
    });
    await this.service.attempt(ws.id, deliveryId);
    return this.db.withContext(this.ctx(auth, ws), async (tx) => {
      const [row] = await tx.select().from(webhookDeliveries).where(eq(webhookDeliveries.id, deliveryId));
      return deliveryDto(row!);
    });
  }

  /** The last 25 deliveries, newest first. */
  @Get(':id/deliveries')
  deliveries(@Param('id', ParseUUIDPipe) id: string, @CurrentAuth() auth: AuthContext, @CurrentWorkspace() ws: WorkspaceContext): Promise<WebhookDeliveryDto[]> {
    return this.db.withContext(this.ctx(auth, ws), async (tx) => {
      await loadWebhook(tx, ws.id, id);
      const rows = await tx.select().from(webhookDeliveries).where(eq(webhookDeliveries.webhookId, id)).orderBy(desc(webhookDeliveries.createdAt)).limit(25);
      return rows.map(deliveryDto);
    });
  }
}

async function safeUrl(raw: string): Promise<string> {
  try {
    const url = checkUrl(raw, config.webhookAllowPrivateUrls);
    await checkResolves(url, config.webhookAllowPrivateUrls);
    return url.toString();
  } catch (err) {
    if (err instanceof UnsafeUrlError) throw new BadRequestException(err.message);
    throw err;
  }
}

async function loadWebhook(tx: Tx, workspaceId: string, id: string) {
  const [row] = await tx.select().from(webhooks).where(and(eq(webhooks.id, id), eq(webhooks.workspaceId, workspaceId)));
  if (!row) throw new NotFoundException('Webhook not found');
  return row;
}

function deliveryDto(d: typeof webhookDeliveries.$inferSelect): WebhookDeliveryDto {
  return {
    id: d.id,
    event: d.event,
    status: d.status,
    attempts: d.attempts,
    lastStatus: d.lastStatus,
    lastError: d.lastError,
    nextAttemptAt: d.status === 'pending' ? d.nextAttemptAt.toISOString() : null,
    deliveredAt: d.deliveredAt?.toISOString() ?? null,
    createdAt: d.createdAt.toISOString(),
  };
}

async function webhookDtos(tx: Tx, workspaceId: string): Promise<WebhookDto[]> {
  const rows = await tx
    .select({ webhook: webhooks, creatorName: users.name })
    .from(webhooks)
    .leftJoin(users, eq(users.id, webhooks.createdBy))
    .where(eq(webhooks.workspaceId, workspaceId))
    .orderBy(webhooks.createdAt);
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.webhook.id);
  const pending = await tx
    .select({ webhookId: webhookDeliveries.webhookId, n: count() })
    .from(webhookDeliveries)
    .where(and(inArray(webhookDeliveries.webhookId, ids), eq(webhookDeliveries.status, 'pending')))
    .groupBy(webhookDeliveries.webhookId);
  const latest = await tx
    .selectDistinctOn([webhookDeliveries.webhookId])
    .from(webhookDeliveries)
    .where(inArray(webhookDeliveries.webhookId, ids))
    .orderBy(webhookDeliveries.webhookId, desc(webhookDeliveries.createdAt));
  return rows.map(({ webhook: w, creatorName }) => {
    const last = latest.find((d) => d.webhookId === w.id);
    return {
      id: w.id,
      url: w.url,
      events: w.events,
      pausedAt: w.pausedAt?.toISOString() ?? null,
      pausedReason: w.pausedReason,
      createdBy: w.createdBy && creatorName ? { id: w.createdBy, name: creatorName } : null,
      createdAt: w.createdAt.toISOString(),
      lastDelivery: last ? deliveryDto(last) : null,
      pending: Number(pending.find((p) => p.webhookId === w.id)?.n ?? 0),
    };
  });
}
