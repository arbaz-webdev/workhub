'use client';

import type { BoardEvent } from '@workhub/shared';
import { useEffect, useRef, useState } from 'react';
import { keepAlive } from '@/lib/event-stream';

/**
 * Subscribes to a board's server-sent events. `onOpen` fires on every
 * reconnection so the caller can reload anything missed while offline;
 * the connection comes back by itself after network drops and deploys.
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
    const stream = keepAlive(`/api/projects/${projectId}/events?workspace=${encodeURIComponent(workspaceId)}`, {
      onOpen: (reconnect) => {
        setLive(true);
        // The first open follows the initial load; later ones may have missed events.
        if (reconnect) handlers.current.onOpen();
      },
      onDown: () => setLive(false),
      onMessage: (data) => {
        try {
          handlers.current.onEvent(JSON.parse(data) as BoardEvent);
        } catch {
          // Ignore malformed events rather than breaking the board.
        }
      },
    });
    return () => stream.close();
  }, [projectId, workspaceId]);

  return live;
}
