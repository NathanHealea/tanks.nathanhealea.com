/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { ConvexError } from 'convex/values';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from './_generated/api';
import schema from './schema';

const modules = import.meta.glob('./**/*.*s');

async function expectConvexErrorAsync(promise: Promise<unknown>, message: string): Promise<void> {
  const caught = await promise.then(
    () => undefined,
    (err: unknown) => err,
  );
  expect(caught).toBeInstanceOf(ConvexError);
  expect((caught as ConvexError<string>).data).toBe(message);
}

describe('matchmaking', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('first joiner is queued', async () => {
    const t = convexTest(schema, modules);
    const a = crypto.randomUUID();

    const result = await t.mutation(api.matchmaking.joinQueue, { playerId: a });

    expect(result).toEqual({ status: 'queued' });
    const queue = await t.run((ctx) => ctx.db.query('queue').collect());
    expect(queue).toHaveLength(1);
    expect(queue[0].playerId).toBe(a);
  });

  it('second joiner is paired', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const t = convexTest(schema, modules);
    const a = crypto.randomUUID();
    const b = crypto.randomUUID();

    await t.mutation(api.matchmaking.joinQueue, { playerId: a });
    const result = await t.mutation(api.matchmaking.joinQueue, { playerId: b });

    expect(result).toEqual({ status: 'matched' });
    const { matches, queue } = await t.run(async (ctx) => ({
      matches: await ctx.db.query('matches').collect(),
      queue: await ctx.db.query('queue').collect(),
    }));
    expect(queue).toEqual([]);
    expect(matches).toHaveLength(1);
    const match = matches[0];
    expect(match).toMatchObject({
      kind: 'quick',
      hostId: a,
      guestId: b,
      status: 'connecting',
      round: 0,
      hostScore: 0,
      guestScore: 0,
      createdAt: 1_000_000,
      hostSeen: 1_000_000,
      guestSeen: 1_000_000,
    });
    expect(Number.isInteger(match.seed)).toBe(true);
    expect(match.seed).toBeGreaterThanOrEqual(0);
    expect(match.seed).toBeLessThan(2 ** 32);
  });

  it('stale entries are skipped', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const t = convexTest(schema, modules);
    const a = crypto.randomUUID();
    const b = crypto.randomUUID();

    await t.mutation(api.matchmaking.joinQueue, { playerId: a });
    vi.advanceTimersByTime(40_000);
    const result = await t.mutation(api.matchmaking.joinQueue, { playerId: b });

    expect(result).toEqual({ status: 'queued' });
    const { matches, queue } = await t.run(async (ctx) => ({
      matches: await ctx.db.query('matches').collect(),
      queue: await ctx.db.query('queue').collect(),
    }));
    expect(matches).toEqual([]);
    expect(queue.map((row) => row.playerId)).toContain(b);
  });

  it('pairing is FIFO', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const t = convexTest(schema, modules);
    const a = crypto.randomUUID();
    const b = crypto.randomUUID();
    const c = crypto.randomUUID();

    // Joining would pair C with A at once, so two live waiters only coexist after a stale entry revives by
    // heartbeat; seed that state directly with A older than C.
    await t.run(async (ctx) => {
      await ctx.db.insert('queue', { playerId: c, joinedAt: 999_000, lastSeen: 1_000_000 });
      await ctx.db.insert('queue', { playerId: a, joinedAt: 998_000, lastSeen: 1_000_000 });
    });
    const result = await t.mutation(api.matchmaking.joinQueue, { playerId: b });

    expect(result).toEqual({ status: 'matched' });
    const { matches, queue } = await t.run(async (ctx) => ({
      matches: await ctx.db.query('matches').collect(),
      queue: await ctx.db.query('queue').collect(),
    }));
    expect(matches).toHaveLength(1);
    expect(matches[0].hostId).toBe(a);
    expect(matches[0].guestId).toBe(b);
    expect(queue.map((row) => row.playerId)).toEqual([c]);
  });

  it('rejoining is idempotent', async () => {
    const t = convexTest(schema, modules);
    const a = crypto.randomUUID();
    const b = crypto.randomUUID();

    expect(await t.mutation(api.matchmaking.joinQueue, { playerId: a })).toEqual({ status: 'queued' });
    expect(await t.mutation(api.matchmaking.joinQueue, { playerId: a })).toEqual({ status: 'queued' });
    const queueAfterRejoin = await t.run((ctx) => ctx.db.query('queue').collect());
    expect(queueAfterRejoin).toHaveLength(1);

    await t.mutation(api.matchmaking.joinQueue, { playerId: b });
    const result = await t.mutation(api.matchmaking.joinQueue, { playerId: a });

    expect(result).toEqual({ status: 'matched' });
    const { matches, queue } = await t.run(async (ctx) => ({
      matches: await ctx.db.query('matches').collect(),
      queue: await ctx.db.query('queue').collect(),
    }));
    expect(matches).toHaveLength(1);
    expect(queue).toEqual([]);
  });

  it('never paired with self', async () => {
    const t = convexTest(schema, modules);
    const a = crypto.randomUUID();

    await t.mutation(api.matchmaking.joinQueue, { playerId: a });
    const result = await t.mutation(api.matchmaking.joinQueue, { playerId: a });

    expect(result).toEqual({ status: 'queued' });
    const { matches, queue } = await t.run(async (ctx) => ({
      matches: await ctx.db.query('matches').collect(),
      queue: await ctx.db.query('queue').collect(),
    }));
    expect(matches).toEqual([]);
    expect(queue.map((row) => row.playerId)).toEqual([a]);
  });

  it('concurrent joiners pair once', async () => {
    const t = convexTest(schema, modules);
    const a = crypto.randomUUID();
    const b = crypto.randomUUID();
    const c = crypto.randomUUID();

    await t.mutation(api.matchmaking.joinQueue, { playerId: a });
    const results = await Promise.all([
      t.mutation(api.matchmaking.joinQueue, { playerId: b }),
      t.mutation(api.matchmaking.joinQueue, { playerId: c }),
    ]);

    expect(results.map((r) => r.status).sort()).toEqual(['matched', 'queued']);
    const { matches, queue } = await t.run(async (ctx) => ({
      matches: await ctx.db.query('matches').collect(),
      queue: await ctx.db.query('queue').collect(),
    }));
    expect(matches).toHaveLength(1);
    expect(matches[0].hostId).toBe(a);
    expect([b, c]).toContain(matches[0].guestId);
    expect(queue).toHaveLength(1);
    expect(queue[0].playerId).not.toBe(matches[0].guestId);
  });

  it('bad guid is rejected', async () => {
    const t = convexTest(schema, modules);

    await expectConvexErrorAsync(t.mutation(api.matchmaking.joinQueue, { playerId: 'x' }), 'Invalid player id');
    const queue = await t.run((ctx) => ctx.db.query('queue').collect());
    expect(queue).toEqual([]);
  });
});
