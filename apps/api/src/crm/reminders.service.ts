import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ACTIVITY_LABELS } from '@workhub/shared';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { DbService } from '../db/db.service';
import { activities, companies, deals, leads } from '../db/schema';
import { notify } from '../notifications/notify';

const MINUTE = 60_000;

/**
 * Reminds each follow-up's owner when it falls due (a notification in the bell). Runs
 * every minute in each API instance; marking it reminded in the same transaction keeps
 * a second instance from sending it again.
 */
@Injectable()
export class FollowUpRemindersService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('FollowUpReminders');
  private timer?: NodeJS.Timeout;

  constructor(private readonly db: DbService) {}

  onModuleInit() {
    if (process.env.NODE_ENV === 'test') return; // tests call sendDue directly
    const run = () => this.sendDue().catch((err) => this.log.error(`Follow-up reminders failed: ${err}`));
    this.timer = setInterval(run, MINUTE);
    this.timer.unref();
  }

  onModuleDestroy() {
    clearInterval(this.timer);
  }

  /** Sends reminders for follow-ups due by `now`. Returns how many. */
  async sendDue(now = new Date()): Promise<number> {
    let total = 0;
    for (;;) {
      const { rows } = await this.db.db.execute<{ id: string; workspace_id: string; owner_id: string }>(sql`select * from due_follow_ups(${now.toISOString()}::timestamptz, 200)`);
      if (rows.length === 0) break;
      for (const r of rows) {
        const sent = await this.db.withContext({ workspaceId: r.workspace_id }, async (tx) => {
          // Claim it; if another instance already did, skip.
          const [a] = await tx
            .update(activities)
            .set({ remindedAt: now })
            .where(and(eq(activities.id, r.id), isNull(activities.remindedAt)))
            .returning();
          if (!a) return false;
          let link = '/app/crm/follow-ups';
          let about = '';
          if (a.dealId) {
            const [d] = await tx.select({ title: deals.title }).from(deals).where(eq(deals.id, a.dealId));
            link = `/app/crm/deals?open=${a.dealId}`;
            about = d ? ` · ${d.title}` : '';
          } else if (a.companyId) {
            const [c] = await tx.select({ name: companies.name }).from(companies).where(eq(companies.id, a.companyId));
            link = `/app/crm/companies/${a.companyId}`;
            about = c ? ` · ${c.name}` : '';
          } else if (a.leadId) {
            const [l] = await tx.select({ name: leads.name }).from(leads).where(eq(leads.id, a.leadId));
            link = `/app/crm/leads?open=${a.leadId}`;
            about = l ? ` · ${l.name}` : '';
          }
          await notify(tx, r.workspace_id, [r.owner_id], { type: 'crm.follow_up', title: `Follow-up due: ${a.subject}`, body: `${ACTIVITY_LABELS[a.kind]}${about}`, link });
          return true;
        });
        if (sent) total += 1;
      }
    }
    if (total > 0) this.log.log(`Sent ${total} follow-up reminders`);
    return total;
  }
}
