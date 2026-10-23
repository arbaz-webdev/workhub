import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { SELFIE_RETENTION_DAYS } from '@workhub/shared';
import { eq, sql } from 'drizzle-orm';
import { DbService } from '../db/db.service';
import { attendanceEvents } from '../db/schema';
import { StorageService } from '../storage/storage.service';

const HOUR = 3600_000;

/**
 * Deletes check-in selfies after 30 days: the file goes, and the event keeps a note
 * of when. Runs hourly in each API instance; running twice at once is harmless.
 */
@Injectable()
export class SelfieCleanupService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('SelfieCleanup');
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly db: DbService,
    private readonly storage: StorageService,
  ) {}

  onModuleInit() {
    if (process.env.NODE_ENV === 'test') return; // tests call purgeExpired directly
    const run = () => this.purgeExpired().catch((err) => this.log.error(`Selfie cleanup failed: ${err}`));
    this.timer = setInterval(run, HOUR);
    this.timer.unref();
    setTimeout(run, 60_000).unref();
  }

  onModuleDestroy() {
    clearInterval(this.timer);
  }

  /** Removes selfies received before the retention window. Returns how many. */
  async purgeExpired(now = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - SELFIE_RETENTION_DAYS * 24 * HOUR);
    let total = 0;
    for (;;) {
      // Expired keys across all workspaces, via a function that returns only those.
      const { rows } = await this.db.db.execute<{ id: string; workspace_id: string; selfie_key: string }>(
        sql`select * from expired_selfies(${cutoff.toISOString()}::timestamptz, 200)`,
      );
      if (rows.length === 0) break;
      for (const r of rows) {
        await this.storage.delete(r.selfie_key);
        // Each row is cleared inside its own workspace, so RLS still applies to the write.
        await this.db.withContext({ workspaceId: r.workspace_id }, (tx) =>
          tx.update(attendanceEvents).set({ selfieKey: null, selfieDeletedAt: now }).where(eq(attendanceEvents.id, r.id)),
        );
        total += 1;
      }
    }
    if (total > 0) this.log.log(`Deleted ${total} selfies older than ${SELFIE_RETENTION_DAYS} days`);
    return total;
  }
}
