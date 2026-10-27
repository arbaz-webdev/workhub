import { Injectable, MessageEvent } from '@nestjs/common';
import { hasRole, type BoardEvent, type InboxEvent, type Role } from '@workhub/shared';
import { filter, interval, map, merge, Observable, Subject } from 'rxjs';

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

/**
 * In-process event bus for live board updates, delivered to browsers with
 * Server-Sent Events. Fine for one API instance; with several instances this
 * needs Redis pub/sub so an update on one reaches viewers on the others.
 */
@Injectable()
export class RealtimeService {
  private readonly bus = new Subject<Envelope>();
  private readonly inboxBus = new Subject<InboxEnvelope>();

  publish(workspaceId: string, projectId: string, event: BoardEvent) {
    this.bus.next({ workspaceId, projectId, event });
  }

  /** Sends an inbox event to people. Call it after the transaction commits. */
  toPeople(workspaceId: string, userIds: string[], event: InboxEvent) {
    if (userIds.length > 0) this.inboxBus.next({ workspaceId, to: userIds, event });
  }

  toStaff(workspaceId: string, event: InboxEvent) {
    this.inboxBus.next({ workspaceId, to: 'staff', event });
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
