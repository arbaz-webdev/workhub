import { HttpException, HttpStatus } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { redis } from './redis';

/** Counts a hit and starts the window on the first one, in one step. */
const HIT_SCRIPT = `local n = redis.call('INCRBY', KEYS[1], ARGV[2])
if n == tonumber(ARGV[2]) then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
return n`;

/**
 * Fixed-window rate limiter. With REDIS_URL the counts are shared by every API copy;
 * without it (or while Redis is unreachable) each copy counts in memory.
 */
export class RateLimiter {
  private readonly hits = new Map<string, { count: number; resetAt: number }>();

  /** `name` keeps limiters apart in Redis, so it must be unique and the same on every copy. */
  constructor(
    private readonly name: string,
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  /** Counts `cost` attempts for `key`; throws 429 once the limit is passed. */
  async consume(key: string, cost = 1): Promise<void> {
    if ((await this.hit(key, cost)) > this.limit) {
      throw new HttpException('Too many attempts. Please wait and try again.', HttpStatus.TOO_MANY_REQUESTS);
    }
  }

  async reset(key: string): Promise<void> {
    this.hits.delete(key);
    await redis()
      ?.del(this.redisKey(key))
      .catch(() => undefined);
  }

  private async hit(key: string, cost: number): Promise<number> {
    const client = redis();
    if (client) {
      try {
        return Number(await client.eval(HIT_SCRIPT, 1, this.redisKey(key), this.windowMs, cost));
      } catch {
        // Unreachable: count here instead (the connection logs the error).
      }
    }
    return this.hitInMemory(key, cost);
  }

  /** Keys can hold emails and addresses, so Redis only sees a hash of them. */
  private redisKey(key: string) {
    return `rl:${this.name}:${createHash('sha256').update(key).digest('base64url')}`;
  }

  private hitInMemory(key: string, cost: number): number {
    const now = Date.now();
    const entry = this.hits.get(key);
    if (!entry || entry.resetAt <= now) {
      this.hits.set(key, { count: cost, resetAt: now + this.windowMs });
      this.prune(now);
      return cost;
    }
    entry.count += cost;
    return entry.count;
  }

  private prune(now: number) {
    if (this.hits.size < 10_000) return;
    for (const [key, entry] of this.hits) if (entry.resetAt <= now) this.hits.delete(key);
  }
}
