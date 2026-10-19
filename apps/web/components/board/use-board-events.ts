'use client';

import type { BoardEvent } from '@workhub/shared';
import { useEffect, useRef, useState } from 'react';

/**
 * Subscribes to a board's server-sent events. `onOpen` fires on every
 * (re)connection so the caller can reload anything missed while offline;
 * the browser reconnects automatically after network drops.
 */
export function useBoardEvents(
  projectId: string,
  workspaceId: string,
  onEvent: (event: BoardEvent) => void,
  onOpen: () => void,
) {
  const handlers = useRef({ onEvent, onOpen });
  handlers.current = { onEvent, onOpen };
  const [live, setLive] = useState(false);

  useEffect(() => {
    const source = new EventSource(`/api/projects/${projectId}/events?workspace=${encodeURIComponent(workspaceId)}`);
    let opened = false;
    source.onopen = () => {
      setLive(true);
      // The first open follows the initial load; later ones are reconnects that may have missed events.
      if (opened) handlers.current.onOpen();
      opened = true;
    };
    source.onerror = () => setLive(false);
    source.onmessage = (e) => {
      if (!e.data) return; // heartbeat
      try {
        handlers.current.onEvent(JSON.parse(e.data) as BoardEvent);
      } catch {
        // Ignore malformed events rather than breaking the board.
      }
    };
    return () => source.close();
  }, [projectId, workspaceId]);

  return live;
}
