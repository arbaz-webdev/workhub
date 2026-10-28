import { Injectable, MessageEvent, OnModuleDestroy } from '@nestjs/common';
import { hasRole, type BoardEvent, type InboxEvent, type Role } from '@workhub/shared';
import type Redis from 'ioredis';
import { filter, interval, map, merge, Observable, Subject } from 'rxjs';
import { closeRedis, connectRedis, disconnect, redis } from '../common/redis';

interface Envelope {
  workspaceId: string;
  projectId: string;
  event: BoardEvent;
}

interface InboxEnvelope {
  workspaceId: string;
  /** Specific people, or everyone in the workspace except guests. */
  to: string[] | 'staff';
  event: InboxEvent;
}

const HEARTBEAT_MS = 25_000;
const BOARD_CHANNEL = 'workhub:board';
const INBOX_CHANNEL = 'workhub:inbox';

/**
 * Event bus for live board and inbox updates, delivered to browsers with Server-Sent
 * Events. With REDIS_URL every event goes through Redis pub/sub, so an update made on
 * one API copy reaches viewers connected to the others; without it, it stays in process.
 */
@Injectable()
export class RealtimeService implements OnModuleDestroy {
  private readonly bus = new Subject<Envelope>();
  private readonly inboxBus = new Subject<InboxEnvelope>();
  /** A subscribed connection can't send other commands, so it gets its own. */
  private readonly subscriber: Redis | null = connectRedis('subscriber');

  constructor() {
    if (!this.subscriber) return;
    void this.subscriber.subscribe(BOARD_CHANNEL, INBOX_CHANNEL).catch(() => undefined);
    this.subscriber.on('message', (channel: string, message: string) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(message);
      } catch {
        return;
      }
      if (channel === BOARD_CHANNEL) this.bus.next(parsed as Envelope);
      else if (channel === INBOX_CHANNEL) this.inboxBus.next(parsed as InboxEnvelope);
    });
  }

  async onModuleDestroy() {
    await disconnect(this.subscriber);
    await closeRedis();
  }

  publish(workspaceId: string, projectId: string, event: BoardEvent) {
    this.send(BOARD_CHANNEL, this.bus, { workspaceId, projectId, event });
  }

  /** Sends an inbox event to people. Call it after the transaction commits. */
  toPeople(workspaceId: string, userIds: string[], event: InboxEvent) {
    if (userIds.length > 0) this.send(INBOX_CHANNEL, this.inboxBus, { workspaceId, to: userIds, event });
  }

  toStaff(workspaceId: string, event: InboxEvent) {
    this.send(INBOX_CHANNEL, this.inboxBus, { workspaceId, to: 'staff', event });
  }

  /** Through Redis when there is one (it comes back to this copy too), else straight to local viewers. */
  private send<T>(channel: string, local: Subject<T>, envelope: T) {
    const client = this.subscriber && redis();
    if (!client) return local.next(envelope);
    // While Redis is down, viewers on this copy still get it.
    client.publish(channel, JSON.stringify(envelope)).catch(() => local.next(envelope));
  }

  /** Events for one project board, plus a heartbeat so proxies keep the connection open. */
  board(workspaceId: string, projectId: string): Observable<MessageEvent> {
    const events = this.bus.pipe(
      filter((e) => e.workspaceId === workspaceId && e.projectId === projectId),
      map((e) => ({ data: e.event }) as MessageEvent),
    );
    return merge(events, heartbeat());
  }

  /** One person's inbox events in one workspace. */
  inbox(workspaceId: string, userId: string, role: Role): Observable<MessageEvent> {
    const staff = hasRole(role, 'member');
    const events = this.inboxBus.pipe(
      filter((e) => e.workspaceId === workspaceId && (e.to === 'staff' ? staff : e.to.includes(userId))),
      map((e) => ({ data: e.event }) as MessageEvent),
    );
    return merge(events, heartbeat());
  }
}

function heartbeat() {
  return interval(HEARTBEAT_MS).pipe(map(() => ({ type: 'ping', data: '' }) as MessageEvent));
}
