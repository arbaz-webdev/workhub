import { Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { config } from '../config';

const logger = new Logger('Redis');

/** A new connection to REDIS_URL, or null when it isn't set (one API copy, state in memory). */
export function connectRedis(name: string): Redis | null {
  const url = config.redisUrl;
  if (!url) return null;
  const client = new Redis(url, {
    connectionName: `workhub-${name}`,
    // A slow or missing Redis must not hold up requests: callers fall back to memory.
    maxRetriesPerRequest: 1,
    commandTimeout: 1000,
    disconnectTimeout: 200,
  });
  let lastWarning = 0;
  client.on('error', (err: Error) => {
    if (Date.now() - lastWarning < 60_000) return;
    lastWarning = Date.now();
    logger.warn(`${name}: ${err.message}`);
  });
  return client;
}

let shared: Redis | null | undefined;

/** The shared connection for commands (rate limits, publishing). */
export function redis(): Redis | null {
  if (shared === undefined) shared = connectRedis('commands');
  return shared;
}

/** Closes the shared connection; the next redis() call opens a new one. */
export async function closeRedis() {
  const client = shared;
  shared = undefined;
  await disconnect(client);
}

/** Quits cleanly when connected; otherwise stops reconnecting at once. */
export async function disconnect(client: Redis | null | undefined) {
  if (!client) return;
  if (client.status === 'ready') await client.quit().catch(() => client.disconnect());
  else client.disconnect();
}
