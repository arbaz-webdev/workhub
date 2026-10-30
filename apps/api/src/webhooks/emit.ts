import type { WebhookEvent } from '@workhub/shared';
import { and, eq, sql } from 'drizzle-orm';
import type { Tx } from '../db/db.service';
import { webhookDeliveries, webhooks } from '../db/schema';

/**
 * Queues `event` for every webhook in the workspace that asked for it, inside the caller's
 * transaction: if the change rolls back, nothing is sent. `load` builds the payload (the
 * public API's shape of the record) and runs only when someone is listening. Paused
 * webhooks get it too; it waits until they resume.
 */
export async function emitWebhookEvent(tx: Tx, workspaceId: string, event: Exclude<WebhookEvent, 'ping'>, load: () => Promise<unknown>): Promise<void> {
  const listening = await tx
    .select({ id: webhooks.id })
    .from(webhooks)
    .where(and(eq(webhooks.workspaceId, workspaceId), sql`${event} = any(${webhooks.events})`));
  if (listening.length === 0) return;
  const now = new Date();
  const payload = { createdAt: now.toISOString(), data: await load() };
  // Due times come from the API's clock, which the worker also uses, not the database's:
  // the two can differ by a millisecond, and "due now" must be true straight away.
  await tx.insert(webhookDeliveries).values(listening.map((w) => ({ workspaceId, webhookId: w.id, event, payload, nextAttemptAt: now })));
}
