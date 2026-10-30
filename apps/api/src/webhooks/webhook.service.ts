import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import http from 'node:http';
import https from 'node:https';
import { and, eq, lte, sql } from 'drizzle-orm';
import { decryptSecret } from '../auth/totp';
import { config } from '../config';
import { DbService } from '../db/db.service';
import { memberships, users, webhookDeliveries, webhooks } from '../db/schema';
import { EmailService } from '../email/email.service';
import { checkUrl, publicOnlyLookup } from './url-safety';

const SECOND = 1000;
const MINUTE = 60 * SECOND;
/** How long a receiver has to answer. */
const TIMEOUT_MS = 10 * SECOND;
/** Waits before each retry: about a day in all, then the webhook is paused. */
export const RETRY_MINUTES = [1, 5, 30, 120, 360, 900];
export const MAX_ATTEMPTS = RETRY_MINUTES.length + 1;
/** A claimed delivery isn't due again for this long, so a second API copy won't send it too. */
const LEASE_MS = 2 * MINUTE;
const KEEP_DAYS = 30;

type Delivery = typeof webhookDeliveries.$inferSelect;
type Webhook = typeof webhooks.$inferSelect;
type Result = { ok: true; status: number } | { ok: false; status: number | null; error: string };

/** `t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<body>">`, as the /developers page explains. */
export function signature(secret: string, body: string, at: Date): string {
  const t = Math.floor(at.getTime() / 1000);
  return `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')}`;
}

/**
 * Sends queued webhook deliveries every few seconds in each API copy, retrying failures
 * (RETRY_MINUTES). A delivery that still fails after MAX_ATTEMPTS pauses its webhook and
 * emails the workspace's owners. Test pings get one attempt.
 */
@Injectable()
export class WebhookService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('Webhooks');
  private timer?: NodeJS.Timeout;
  private lastPrune = 0;

  constructor(
    private readonly db: DbService,
    private readonly email: EmailService,
  ) {}

  onModuleInit() {
    if (process.env.NODE_ENV === 'test') return; // tests call deliverDue directly
    const run = async () => {
      await this.deliverDue();
      if (Date.now() - this.lastPrune > 60 * MINUTE) {
        this.lastPrune = Date.now();
        await this.db.db.execute(sql`select prune_webhook_deliveries(${new Date(Date.now() - KEEP_DAYS * 24 * 60 * MINUTE).toISOString()}::timestamptz)`);
      }
    };
    this.timer = setInterval(() => run().catch((err) => this.log.error(`Webhook deliveries failed: ${err}`)), 10 * SECOND);
    this.timer.unref();
  }

  onModuleDestroy() {
    clearInterval(this.timer);
  }

  /** Sends everything due by `now`. Returns how many deliveries were attempted. */
  async deliverDue(now = new Date()): Promise<number> {
    let total = 0;
    // Each claim pushes its delivery forward, so a batch is never seen twice; the cap
    // keeps one run from going on for ever.
    for (let batch = 0; batch < 20; batch++) {
      const { rows } = await this.db.db.execute<{ id: string; workspace_id: string }>(sql`select * from due_webhook_deliveries(${now.toISOString()}::timestamptz, 50)`);
      if (rows.length === 0) break;
      for (const r of rows) {
        try {
          if (await this.attempt(r.workspace_id, r.id, now)) total++;
        } catch (err) {
          this.log.error(`Delivery ${r.id} failed: ${err}`);
        }
      }
    }
    return total;
  }

  /** Claims and sends one delivery if it's still due. Returns false if there was nothing to do. */
  async attempt(workspaceId: string, deliveryId: string, now = new Date()): Promise<boolean> {
    const claimed = await this.db.withContext({ workspaceId }, async (tx) => {
      const [delivery] = await tx
        .update(webhookDeliveries)
        .set({ nextAttemptAt: new Date(now.getTime() + LEASE_MS) })
        .where(and(eq(webhookDeliveries.id, deliveryId), eq(webhookDeliveries.status, 'pending'), lte(webhookDeliveries.nextAttemptAt, now)))
        .returning();
      if (!delivery) return null;
      const [webhook] = await tx.select().from(webhooks).where(eq(webhooks.id, delivery.webhookId));
      return webhook && !webhook.pausedAt ? { delivery, webhook } : null;
    });
    if (!claimed) return false;
    const result = await this.send(claimed.webhook, claimed.delivery);
    await this.record(claimed.webhook, claimed.delivery, result, now);
    return true;
  }

  private async send(webhook: Webhook, delivery: Delivery): Promise<Result> {
    const body = JSON.stringify({
      id: delivery.id,
      event: delivery.event,
      createdAt: delivery.payload.createdAt,
      workspaceId: delivery.workspaceId,
      data: delivery.payload.data,
    });
    try {
      const url = checkUrl(webhook.url, config.webhookAllowPrivateUrls);
      const status = await post(url, body, {
        'Content-Type': 'application/json',
        'User-Agent': 'WorkHub-Webhooks/1',
        'WorkHub-Event': delivery.event,
        'WorkHub-Delivery': delivery.id,
        'WorkHub-Signature': signature(decryptSecret(webhook.secretEncrypted), body, new Date()),
      });
      return status >= 200 && status < 300 ? { ok: true, status } : { ok: false, status, error: `The receiver answered ${status}` };
    } catch (err) {
      return { ok: false, status: null, error: err instanceof Error ? err.message : String(err) };
    }
  }

  private async record(webhook: Webhook, delivery: Delivery, result: Result, now: Date) {
    const attempts = delivery.attempts + 1;
    const giveUp = !result.ok && (delivery.event === 'ping' || attempts >= MAX_ATTEMPTS);
    const pause = giveUp && delivery.event !== 'ping';
    await this.db.withContext({ workspaceId: webhook.workspaceId }, async (tx) => {
      await tx
        .update(webhookDeliveries)
        .set(
          result.ok
            ? { status: 'delivered', attempts, lastStatus: result.status, lastError: null, deliveredAt: new Date() }
            : {
                status: giveUp ? 'failed' : 'pending',
                attempts,
                lastStatus: result.status,
                lastError: result.error.slice(0, 500),
                nextAttemptAt: new Date(now.getTime() + (RETRY_MINUTES[attempts - 1] ?? 0) * MINUTE),
              },
        )
        .where(eq(webhookDeliveries.id, delivery.id));
      if (pause) {
        await tx
          .update(webhooks)
          .set({ pausedAt: now, pausedReason: 'Paused because deliveries failed for a day.', updatedAt: now })
          .where(eq(webhooks.id, webhook.id));
      }
    });
    if (pause) await this.tellOwners(webhook, result.ok ? '' : result.error);
  }

  private async tellOwners(webhook: Webhook, error: string) {
    const owners = await this.db.withContext({ workspaceId: webhook.workspaceId }, (tx) =>
      tx
        .select({ email: users.email, name: users.name })
        .from(memberships)
        .innerJoin(users, eq(users.id, memberships.userId))
        .where(and(eq(memberships.workspaceId, webhook.workspaceId), eq(memberships.role, 'owner'))),
    );
    const link = `${config.appUrl}/app/settings/api`;
    for (const o of owners) {
      const text = [
        `Hi ${o.name},`,
        '',
        `WorkHub paused your webhook to ${webhook.url}, because it couldn't deliver to it for about a day.`,
        `The last error was: ${error}`,
        '',
        `Fix the receiving end, then choose Resume in Settings → API (${link}). Events that happen while it's paused wait, and are sent when it resumes.`,
      ].join('\n');
      await this.email
        .send({ to: o.email, subject: 'A WorkHub webhook was paused', text, html: text.split('\n').map((l) => `<p>${escapeHtml(l)}</p>`).join('') })
        .catch((err) => this.log.error(`Could not email ${o.email}: ${err}`));
    }
  }
}

function post(url: URL, body: string, headers: Record<string, string>): Promise<number> {
  return new Promise((resolve, reject) => {
    const client = url.protocol === 'https:' ? https : http;
    const req = client.request(
      url,
      {
        method: 'POST',
        headers: { ...headers, 'Content-Length': Buffer.byteLength(body).toString() },
        timeout: TIMEOUT_MS,
        lookup: config.webhookAllowPrivateUrls ? undefined : publicOnlyLookup,
      },
      (res) => {
        // The answer's body isn't used; read and drop it so the connection closes.
        res.resume();
        res.on('end', () => resolve(res.statusCode ?? 0));
        res.on('error', reject);
      },
    );
    req.on('timeout', () => req.destroy(new Error(`No answer within ${TIMEOUT_MS / SECOND} seconds`)));
    req.on('error', reject);
    req.end(body);
  });
}

const escapeHtml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
