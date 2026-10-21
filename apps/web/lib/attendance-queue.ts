// Check-ins made without a connection wait here (IndexedDB, with their selfie) and
// are sent in order when the connection returns. Each carries the moment it was
// made and a client id, so the server records it once with the right time.
import type { AttendanceEventType, AttendanceTodayDto } from '@workhub/shared';
import { api, ApiError } from './api';

export interface QueuedEvent {
  clientEventId: string;
  workspaceId: string;
  type: AttendanceEventType;
  occurredAt: string;
  breakName?: string;
  latitude?: number;
  longitude?: number;
  accuracyMeters?: number;
  deviceId?: string;
  selfie?: Blob;
}

const DB_NAME = 'workhub';
const STORE = 'attendance-queue';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'clientEventId' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export async function queued(workspaceId: string): Promise<QueuedEvent[]> {
  const all = await run<QueuedEvent[]>('readonly', (s) => s.getAll() as IDBRequest<QueuedEvent[]>);
  return all.filter((e) => e.workspaceId === workspaceId).sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
}

export const enqueue = (e: QueuedEvent) => run('readwrite', (s) => s.put(e));
const dequeue = (id: string) => run('readwrite', (s) => s.delete(id));

/** A stable id for this browser, so managers can spot one phone checking in for two people. */
export function deviceId(): string {
  try {
    let id = localStorage.getItem('wh-device-id');
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem('wh-device-id', id);
    }
    return id;
  } catch {
    return 'unknown';
  }
}

export function send(e: QueuedEvent): Promise<AttendanceTodayDto> {
  const form = new FormData();
  form.append('type', e.type);
  form.append('occurredAt', e.occurredAt);
  form.append('clientEventId', e.clientEventId);
  if (e.breakName) form.append('breakName', e.breakName);
  if (e.latitude !== undefined && e.longitude !== undefined) {
    form.append('latitude', String(e.latitude));
    form.append('longitude', String(e.longitude));
    if (e.accuracyMeters !== undefined) form.append('accuracyMeters', String(Math.round(e.accuracyMeters)));
  }
  if (e.deviceId) form.append('deviceId', e.deviceId);
  if (e.selfie) form.append('selfie', e.selfie, 'selfie.jpg');
  return api<AttendanceTodayDto>('/attendance/events', { method: 'POST', body: form, workspaceId: e.workspaceId });
}

/** True for "try again later": no connection or a server error, as opposed to the server saying no. */
export const isNetworkError = (err: unknown) => !(err instanceof ApiError) || err.status >= 500;

export interface FlushResult {
  sent: number;
  /** Events the server refused (e.g. already checked in); they're dropped. */
  rejected: { event: QueuedEvent; message: string }[];
  latest?: AttendanceTodayDto;
}

let flushing: Promise<FlushResult> | null = null;

/** Sends queued events oldest first; stops at the first network failure. One flush at a time. */
export function flush(workspaceId: string): Promise<FlushResult> {
  flushing ??= (async () => {
    const result: FlushResult = { sent: 0, rejected: [] };
    try {
      for (const e of await queued(workspaceId)) {
        try {
          result.latest = await send(e);
          result.sent += 1;
          await dequeue(e.clientEventId);
        } catch (err) {
          if (isNetworkError(err)) break;
          result.rejected.push({ event: e, message: (err as ApiError).message });
          await dequeue(e.clientEventId);
        }
      }
    } finally {
      flushing = null;
    }
    return result;
  })();
  return flushing;
}
