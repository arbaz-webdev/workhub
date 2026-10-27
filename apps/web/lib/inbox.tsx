'use client';

import { hasRole, type InboxEvent, type InboxSummaryDto, type PresenceDto } from '@workhub/shared';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { keepAlive } from './event-stream';
import { useWorkspace, useWorkspaceApi } from './workspace';

/** What listeners get: a server event, or word that the stream reconnected (reload what you show). */
export type InboxSignal = InboxEvent | { type: 'reconnected' };

interface InboxContextValue {
  summary: InboxSummaryDto;
  presence: Map<string, PresenceDto>;
  /** Whether the live connection is up. */
  live: boolean;
  refreshSummary: () => void;
  /** Listen to live inbox events; returns the unsubscribe. */
  subscribe: (fn: (signal: InboxSignal) => void) => () => void;
}

const InboxContext = createContext<InboxContextValue | null>(null);

const EMPTY: InboxSummaryDto = { unread: 0, mentions: 0, announcements: 0 };

/**
 * One live connection per workspace for the whole app: it keeps the inbox and
 * announcement badges and everyone's presence current, and hands events to pages.
 */
export function InboxProvider({ children }: { children: React.ReactNode }) {
  const { workspace, me } = useWorkspace();
  const api = useWorkspaceApi();
  const staff = hasRole(workspace.role, 'member');
  const [summary, setSummary] = useState(EMPTY);
  const [presence, setPresence] = useState(new Map<string, PresenceDto>());
  const [live, setLive] = useState(false);
  const listeners = useRef(new Set<(s: InboxSignal) => void>());
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const refreshSummary = useCallback(() => {
    // Bursts of events become one request.
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      api<InboxSummaryDto>('/chat/summary').then(setSummary).catch(() => {});
    }, 150);
  }, [api]);

  const loadPresence = useCallback(() => {
    if (!staff) return;
    api<PresenceDto[]>('/chat/presence')
      .then((rows) => setPresence(new Map(rows.map((p) => [p.userId, p]))))
      .catch(() => {});
  }, [api, staff]);

  useEffect(() => {
    refreshSummary();
    loadPresence();
    const emit = (s: InboxSignal) => listeners.current.forEach((fn) => fn(s));
    const stream = keepAlive(`/api/chat/events?workspace=${encodeURIComponent(workspace.id)}`, {
      onOpen: (reconnect) => {
        setLive(true);
        // A reconnect may have missed events.
        if (reconnect) {
          refreshSummary();
          loadPresence();
          emit({ type: 'reconnected' });
        }
      },
      onDown: () => setLive(false),
      onMessage: (data) => {
        let event: InboxEvent;
        try {
          event = JSON.parse(data) as InboxEvent;
        } catch {
          return;
        }
        if (event.type === 'presence.changed') {
          setPresence((prev) => new Map(prev).set(event.userId, { userId: event.userId, presence: event.presence, since: event.since }));
        } else if (event.type !== 'message.created' || event.message.author?.id !== me.user.id) {
          refreshSummary();
        }
        emit(event);
      },
    });
    return () => {
      stream.close();
      clearTimeout(timer.current);
    };
  }, [workspace.id, me.user.id, refreshSummary, loadPresence]);

  const subscribe = useCallback((fn: (s: InboxSignal) => void) => {
    listeners.current.add(fn);
    return () => {
      listeners.current.delete(fn);
    };
  }, []);

  const value = useMemo(() => ({ summary, presence, live, refreshSummary, subscribe }), [summary, presence, live, refreshSummary, subscribe]);
  return <InboxContext.Provider value={value}>{children}</InboxContext.Provider>;
}

export function useInbox(): InboxContextValue {
  const value = useContext(InboxContext);
  if (!value) throw new Error('useInbox must be used inside InboxProvider');
  return value;
}

/** Calls `fn` for every live inbox signal while mounted. */
export function useInboxEvents(fn: (signal: InboxSignal) => void) {
  const { subscribe } = useInbox();
  const handler = useRef(fn);
  handler.current = fn;
  useEffect(() => subscribe((s) => handler.current(s)), [subscribe]);
}
