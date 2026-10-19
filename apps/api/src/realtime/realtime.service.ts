import { Injectable, MessageEvent } from '@nestjs/common';
import type { BoardEvent } from '@workhub/shared';
import { filter, interval, map, merge, Observable, Subject } from 'rxjs';

interface Envelope {
  workspaceId: string;
  projectId: string;
  event: BoardEvent;
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

  publish(workspaceId: string, projectId: string, event: BoardEvent) {
    this.bus.next({ workspaceId, projectId, event });
  }

  /** Events for one project board, plus a heartbeat so proxies keep the connection open. */
  board(workspaceId: string, projectId: string): Observable<MessageEvent> {
    const events = this.bus.pipe(
      filter((e) => e.workspaceId === workspaceId && e.projectId === projectId),
      map((e) => ({ data: e.event }) as MessageEvent),
    );
    const heartbeat = interval(HEARTBEAT_MS).pipe(map(() => ({ type: 'ping', data: '' }) as MessageEvent));
    return merge(events, heartbeat);
  }
}
