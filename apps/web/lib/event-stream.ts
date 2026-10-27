const MAX_DELAY_MS = 30_000;

/**
 * A Server-Sent Events connection that stays up. The browser retries dropped connections
 * by itself, but gives up for good after an error response (a 502 while the server
 * restarts for a deploy), so then this reopens it, backing off up to 30 seconds and
 * trying again at once when the device comes back online.
 */
export function keepAlive(
  url: string,
  handlers: {
    /** `reconnect` is true for every open after the first: events may have been missed. */
    onOpen: (reconnect: boolean) => void;
    onDown: () => void;
    /** Each event's data; heartbeats are skipped. */
    onMessage: (data: string) => void;
  },
): { close: () => void } {
  let source: EventSource | null = null;
  let opened = false;
  let closed = false;
  let delay = 1000;
  let retry: ReturnType<typeof setTimeout> | undefined;

  const connect = () => {
    if (closed) return;
    source = new EventSource(url);
    source.onopen = () => {
      delay = 1000;
      handlers.onOpen(opened);
      opened = true;
    };
    source.onerror = () => {
      handlers.onDown();
      if (source?.readyState !== EventSource.CLOSED) return; // the browser is retrying
      source.close();
      clearTimeout(retry);
      retry = setTimeout(connect, delay);
      delay = Math.min(delay * 2, MAX_DELAY_MS);
    };
    source.onmessage = (e) => {
      if (e.data) handlers.onMessage(e.data);
    };
  };

  const online = () => {
    if (source?.readyState !== EventSource.CLOSED) return;
    clearTimeout(retry);
    delay = 1000;
    connect();
  };

  connect();
  window.addEventListener('online', online);
  return {
    close: () => {
      closed = true;
      clearTimeout(retry);
      window.removeEventListener('online', online);
      source?.close();
    },
  };
}
