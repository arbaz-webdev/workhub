import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Fixed-window, in-memory rate limiter. Good enough for a single API instance;
 * move the counters to Redis before running more than one instance.
 */
export class RateLimiter {
  private readonly hits = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  /** Counts one attempt for `key`; throws 429 once the limit is passed. */
  consume(key: string): void {
    const now = Date.now();
    const entry = this.hits.get(key);
    if (!entry || entry.resetAt <= now) {
      this.hits.set(key, { count: 1, resetAt: now + this.windowMs });
      this.prune(now);
      return;
    }
    entry.count += 1;
    if (entry.count > this.limit) {
      throw new HttpException('Too many attempts. Please wait and try again.', HttpStatus.TOO_MANY_REQUESTS);
    }
  }

  reset(key: string): void {
    this.hits.delete(key);
  }

  private prune(now: number) {
    if (this.hits.size < 10_000) return;
    for (const [key, entry] of this.hits) if (entry.resetAt <= now) this.hits.delete(key);
  }
}
