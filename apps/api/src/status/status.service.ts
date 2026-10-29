import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { STATUS_COMPONENT_LABELS, STATUS_COMPONENTS, type StatusComponent, type StatusPageDto } from '@workhub/shared';
import { desc, gte, inArray, isNull, or, sql } from 'drizzle-orm';
import { redis } from '../common/redis';
import { DbService } from '../db/db.service';
import { statusDays, statusIncidents, statusUpdates } from '../db/schema';
import { StorageService } from '../storage/storage.service';

const MINUTE = 60_000;
/** Days of history on the page. */
export const STATUS_DAYS = 90;
/** Slower than this counts as degraded. */
const SLOW_MS = 2000;

type Check = { component: StatusComponent; ok: boolean; ms: number };

/**
 * The public status page. Every minute each API copy checks the parts the app depends on
 * and adds the result to that day's count. A copy that's down records nothing, so an outage
 * shows as fewer checks, not as failures: an outside monitor is still needed to catch those.
 */
@Injectable()
export class StatusService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('Status');
  private timer?: NodeJS.Timeout;
  private latest: { at: Date; checks: Check[] } | null = null;
  private cached: { at: number; page: StatusPageDto } | null = null;

  constructor(
    private readonly db: DbService,
    private readonly storage: StorageService,
  ) {}

  onModuleInit() {
    if (process.env.NODE_ENV === 'test') return; // tests call checkAndRecord directly
    const run = () => this.checkAndRecord().catch((err) => this.log.error(`Status check failed: ${err}`));
    this.timer = setInterval(run, MINUTE);
    this.timer.unref();
    setTimeout(run, 5000).unref();
  }

  onModuleDestroy() {
    clearInterval(this.timer);
  }

  /** Checks each component now. */
  async check(): Promise<Check[]> {
    const timed = async (component: StatusComponent, fn: () => Promise<unknown>): Promise<Check> => {
      const started = performance.now();
      try {
        await fn();
        return { component, ok: true, ms: Math.round(performance.now() - started) };
      } catch {
        return { component, ok: false, ms: Math.round(performance.now() - started) };
      }
    };
    return Promise.all([
      // Answering at all means the API is up; the website proxies to it.
      timed('app', async () => undefined),
      timed('database', () => this.db.db.execute(sql`select 1`)),
      timed('files', () => this.storage.check()),
      // With Redis, live updates between copies depend on it; without, they're in process.
      timed('live', async () => {
        const client = redis();
        if (client) await client.ping();
      }),
    ]);
  }

  /** Checks, and adds the results to today's counts. */
  async checkAndRecord(now = new Date()): Promise<Check[]> {
    const checks = await this.check();
    this.latest = { at: now, checks };
    const day = now.toISOString().slice(0, 10);
    for (const c of checks) {
      const failed = c.ok ? 0 : 1;
      await this.db.db
        .insert(statusDays)
        .values({ component: c.component, day, checks: 1, failures: failed })
        .onConflictDoUpdate({
          target: [statusDays.component, statusDays.day],
          set: { checks: sql`${statusDays.checks} + 1`, failures: sql`${statusDays.failures} + ${failed}` },
        });
    }
    return checks;
  }

  /** What the public page shows; cached for 30 seconds. */
  async page(now = new Date()): Promise<StatusPageDto> {
    if (this.cached && now.getTime() - this.cached.at < 30_000) return this.cached.page;
    if (!this.latest || now.getTime() - this.latest.at.getTime() > 2 * MINUTE) {
      this.latest = { at: now, checks: await this.check() };
    }
    const latest = this.latest;

    const first = new Date(now.getTime() - (STATUS_DAYS - 1) * 24 * 60 * MINUTE).toISOString().slice(0, 10);
    const rows = await this.db.db.select().from(statusDays).where(gte(statusDays.day, first));
    const byKey = new Map(rows.map((r) => [`${r.component}:${r.day}`, r]));
    const days = Array.from({ length: STATUS_DAYS }, (_, i) => new Date(now.getTime() - (STATUS_DAYS - 1 - i) * 24 * 60 * MINUTE).toISOString().slice(0, 10));

    const components = STATUS_COMPONENTS.map((key) => {
      const check = latest.checks.find((c) => c.component === key);
      let checks = 0;
      let failures = 0;
      const history = days.map((day) => {
        const r = byKey.get(`${key}:${day}`);
        if (!r || r.checks === 0) return { day, uptime: null };
        checks += r.checks;
        failures += r.failures;
        return { day, uptime: share(r.checks - r.failures, r.checks) };
      });
      const state: StatusPageDto['components'][number]['state'] = !check?.ok ? 'down' : check.ms > SLOW_MS ? 'degraded' : 'operational';
      return { key, label: STATUS_COMPONENT_LABELS[key], state, uptime: checks ? share(checks - failures, checks) : null, days: history };
    });

    // Open incidents, and those resolved in the last two weeks.
    const recent = new Date(now.getTime() - 14 * 24 * 60 * MINUTE);
    const incidents = await this.db.db
      .select()
      .from(statusIncidents)
      .where(or(isNull(statusIncidents.resolvedAt), gte(statusIncidents.resolvedAt, recent)))
      .orderBy(desc(statusIncidents.startedAt))
      .limit(20);
    const updates = incidents.length
      ? await this.db.db
          .select()
          .from(statusUpdates)
          .where(inArray(statusUpdates.incidentId, incidents.map((i) => i.id)))
          .orderBy(desc(statusUpdates.createdAt))
      : [];

    const page: StatusPageDto = {
      checkedAt: latest.at.toISOString(),
      components,
      incidents: incidents.map((i) => ({
        id: i.id,
        title: i.title,
        impact: i.impact,
        components: i.components as StatusComponent[],
        startedAt: i.startedAt.toISOString(),
        resolvedAt: i.resolvedAt?.toISOString() ?? null,
        updates: updates.filter((u) => u.incidentId === i.id).map((u) => ({ status: u.status, body: u.body, createdAt: u.createdAt.toISOString() })),
      })),
    };
    this.cached = { at: now.getTime(), page };
    return page;
  }

  /** After staff post an incident, the page shows it straight away. */
  forget() {
    this.cached = null;
  }
}

/** A percentage to two decimals, never rounded up to 100 while anything failed. */
function share(good: number, total: number) {
  return Math.floor((good / total) * 10_000) / 100;
}
