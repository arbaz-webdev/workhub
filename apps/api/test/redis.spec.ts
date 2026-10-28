import type { BoardEvent, InboxEvent } from '@workhub/shared';
import { filter, firstValueFrom, take, timeout } from 'rxjs';
import { RateLimiter } from '../src/common/rate-limiter';
import { closeRedis, redis } from '../src/common/redis';
import { RealtimeService } from '../src/realtime/realtime.service';

// The shared-state tests need a real Redis: CI runs one and sets TEST_REDIS_URL.
const REDIS = process.env.TEST_REDIS_URL;
const withRedis = REDIS ? describe : describe.skip;

const nextEvent = (source: ReturnType<RealtimeService['board']>) =>
  firstValueFrom(
    source.pipe(
      filter((m) => m.type !== 'ping'),
      take(1),
      timeout(5000),
    ),
  );

afterEach(async () => {
  await closeRedis();
  delete process.env.REDIS_URL;
});

describe('Without Redis', () => {
  it('counts in memory and refuses past the limit', async () => {
    const limiter = new RateLimiter('test.memory', 2, 60_000);
    await limiter.consume('a');
    await limiter.consume('a');
    await expect(limiter.consume('a')).rejects.toMatchObject({ status: 429 });
    await limiter.consume('b');
    await limiter.reset('a');
    await limiter.consume('a');
  });

  it('counts a batch at once', async () => {
    const limiter = new RateLimiter('test.batch', 5, 60_000);
    await limiter.consume('ws', 4);
    await expect(limiter.consume('ws', 2)).rejects.toMatchObject({ status: 429 });
  });

  it('keeps limiting in memory while Redis is unreachable', async () => {
    process.env.REDIS_URL = 'redis://127.0.0.1:1';
    const limiter = new RateLimiter('test.down', 1, 60_000);
    await limiter.consume('a');
    await expect(limiter.consume('a')).rejects.toMatchObject({ status: 429 });
    // ioredis leaves each failed command's 1 s timeout running; let them finish.
    await new Promise((resolve) => setTimeout(resolve, 1100));
  });

  it('delivers live events in process', async () => {
    const realtime = new RealtimeService();
    const event = nextEvent(realtime.board('ws1', 'p1'));
    realtime.publish('ws1', 'p1', { type: 'changed' } as unknown as BoardEvent);
    await expect(event).resolves.toMatchObject({ data: { type: 'changed' } });
    await realtime.onModuleDestroy();
  });
});

withRedis('With Redis', () => {
  beforeEach(async () => {
    process.env.REDIS_URL = REDIS;
    const keys = await redis()!.keys('rl:test.*');
    if (keys.length) await redis()!.del(...keys);
  });

  it('shares counts between API copies', async () => {
    // Two limiters with one name stand for the same limiter on two copies.
    const one = new RateLimiter('test.shared', 3, 60_000);
    const two = new RateLimiter('test.shared', 3, 60_000);
    await one.consume('203.0.113.9:someone@example.com');
    await two.consume('203.0.113.9:someone@example.com');
    await one.consume('203.0.113.9:someone@example.com');
    await expect(two.consume('203.0.113.9:someone@example.com')).rejects.toMatchObject({ status: 429 });

    const keys = await redis()!.keys('rl:test.shared:*');
    expect(keys).toHaveLength(1);
    expect(keys[0]).not.toContain('someone'); // hashed
    expect(await redis()!.pttl(keys[0]!)).toBeGreaterThan(50_000);

    await two.reset('203.0.113.9:someone@example.com');
    await one.consume('203.0.113.9:someone@example.com');
  });

  it('carries board and inbox events from one copy to another', async () => {
    const sender = new RealtimeService();
    const receiver = new RealtimeService();
    // Wait until both are subscribed.
    await new Promise((resolve) => setTimeout(resolve, 300));

    const board = nextEvent(receiver.board('ws1', 'p1'));
    sender.publish('ws1', 'p1', { type: 'changed' } as unknown as BoardEvent);
    await expect(board).resolves.toMatchObject({ data: { type: 'changed' } });

    const mine = nextEvent(receiver.inbox('ws1', 'user-a', 'member'));
    sender.toPeople('ws1', ['user-b'], { type: 'not-for-a' } as unknown as InboxEvent);
    sender.toPeople('ws1', ['user-a'], { type: 'for-a' } as unknown as InboxEvent);
    await expect(mine).resolves.toMatchObject({ data: { type: 'for-a' } });

    await sender.onModuleDestroy();
    await receiver.onModuleDestroy();
  });
});
