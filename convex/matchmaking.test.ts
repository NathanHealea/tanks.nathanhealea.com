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
    await expectConvexErrorAsync(t.mutation(api.matchmaking.leaveQueue, { playerId: 'x' }), 'Invalid player id');
    await expectConvexErrorAsync(t.mutation(api.matchmaking.queueHeartbeat, { playerId: 'x' }), 'Invalid player id');
    await expectConvexErrorAsync(t.query(api.matchmaking.myMatch, { playerId: 'x' }), 'Invalid player id');
    const queue = await t.run((ctx) => ctx.db.query('queue').collect());
    expect(queue).toEqual([]);
  });

  it('myMatch hides guids', async () => {
    const t = convexTest(schema, modules);
    const a = crypto.randomUUID();
    const b = crypto.randomUUID();
    const outsider = crypto.randomUUID();

    await t.mutation(api.matchmaking.joinQueue, { playerId: a });
    await t.mutation(api.matchmaking.joinQueue, { playerId: b });
    const hostView = await t.query(api.matchmaking.myMatch, { playerId: a });
    const guestView = await t.query(api.matchmaking.myMatch, { playerId: b });

    expect(hostView).toMatchObject({ role: 'host', kind: 'quick', status: 'connecting' });
    expect(guestView).toMatchObject({ role: 'guest', kind: 'quick', status: 'connecting' });
    for (const view of [hostView, guestView]) {
      const json = JSON.stringify(view);
      expect(json).not.toContain(a);
      expect(json).not.toContain(b);
    }
    expect(await t.query(api.matchmaking.myMatch, { playerId: outsider })).toBeNull();
  });

  it('myMatch ignores finished matches', async () => {
    const t = convexTest(schema, modules);
    const a = crypto.randomUUID();
    const b = crypto.randomUUID();
    await t.run(async (ctx) => {
      await ctx.db.insert('matches', {
        kind: 'quick',
        hostId: a,
        guestId: b,
        status: 'finished',
        seed: 1,
        round: 3,
        hostScore: 3,
        guestScore: 1,
        winner: 'host',
        endReason: 'score',
        createdAt: 1_000_000,
        hostSeen: 1_000_000,
        guestSeen: 1_000_000,
      });
    });

    expect(await t.query(api.matchmaking.myMatch, { playerId: a })).toBeNull();
    expect(await t.query(api.matchmaking.myMatch, { playerId: b })).toBeNull();
  });

  it('leaveQueue removes and tolerates absence', async () => {
    const t = convexTest(schema, modules);
    const a = crypto.randomUUID();
    const b = crypto.randomUUID();
    // Seeded directly: a live b would pair with a through joinQueue, and a stale b would be swept by it.
    await t.run(async (ctx) => {
      await ctx.db.insert('queue', { playerId: b, joinedAt: Date.now(), lastSeen: Date.now() });
      await ctx.db.insert('queue', { playerId: a, joinedAt: Date.now(), lastSeen: Date.now() });
    });

    expect(await t.mutation(api.matchmaking.leaveQueue, { playerId: a })).toBeNull();
    const afterFirst = await t.run((ctx) => ctx.db.query('queue').collect());
    expect(afterFirst.map((row) => row.playerId)).toEqual([b]);

    expect(await t.mutation(api.matchmaking.leaveQueue, { playerId: a })).toBeNull();
    const afterSecond = await t.run((ctx) => ctx.db.query('queue').collect());
    expect(afterSecond.map((row) => row.playerId)).toEqual([b]);
  });

  it('queueHeartbeat refreshes lastSeen', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const t = convexTest(schema, modules);
    const a = crypto.randomUUID();
    const b = crypto.randomUUID();

    await t.mutation(api.matchmaking.joinQueue, { playerId: a });
    vi.advanceTimersByTime(20_000);
    expect(await t.mutation(api.matchmaking.queueHeartbeat, { playerId: a })).toBeNull();

    const queue = await t.run((ctx) => ctx.db.query('queue').collect());
    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({ playerId: a, joinedAt: 1_000_000, lastSeen: 1_020_000 });

    expect(await t.mutation(api.matchmaking.queueHeartbeat, { playerId: b })).toBeNull();
    const afterStranger = await t.run((ctx) => ctx.db.query('queue').collect());
    expect(afterStranger.map((row) => row.playerId)).toEqual([a]);
  });

  it('stale entries at the head of the queue do not block pairing', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const t = convexTest(schema, modules);
    const live = crypto.randomUUID();
    await t.run(async (ctx) => {
      for (let i = 0; i < 45; i++) {
        await ctx.db.insert('queue', { playerId: crypto.randomUUID(), joinedAt: 1_000 + i, lastSeen: 2_000 });
      }
      await ctx.db.insert('queue', { playerId: live, joinedAt: 900_000, lastSeen: 1_000_000 });
    });

    const result = await t.mutation(api.matchmaking.joinQueue, { playerId: crypto.randomUUID() });

    expect(result).toEqual({ status: 'matched' });
    const { matches, queue } = await t.run(async (ctx) => ({
      matches: await ctx.db.query('matches').collect(),
      queue: await ctx.db.query('queue').collect(),
    }));
    expect(matches[0].hostId).toBe(live);
    expect(queue).toHaveLength(0);
  });

  it('a quick match nobody connected within a minute stops counting as active', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const t = convexTest(schema, modules);
    const a = crypto.randomUUID();
    const b = crypto.randomUUID();
    await t.mutation(api.matchmaking.joinQueue, { playerId: a });
    await t.mutation(api.matchmaking.joinQueue, { playerId: b });

    vi.setSystemTime(1_000_000 + 60_000);
    expect(await t.query(api.matchmaking.myMatch, { playerId: b })).not.toBeNull();

    vi.setSystemTime(1_000_000 + 60_001);
    expect(await t.query(api.matchmaking.myMatch, { playerId: b })).toBeNull();
    expect(await t.mutation(api.matchmaking.joinQueue, { playerId: b })).toEqual({ status: 'queued' });
  });

  it.each(['playing', 'waiting'] as const)('a %s match older than a minute still counts as active', async (status) => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const t = convexTest(schema, modules);
    const a = crypto.randomUUID();
    await t.run(async (ctx) => {
      await ctx.db.insert('matches', {
        kind: 'quick', hostId: a, guestId: crypto.randomUUID(), status, seed: 1, round: 0,
        hostScore: 0, guestScore: 0, createdAt: 1_000_000 - 120_000, hostSeen: 1_000_000, guestSeen: 1_000_000,
      });
    });

    expect(await t.query(api.matchmaking.myMatch, { playerId: a })).not.toBeNull();
    expect(await t.mutation(api.matchmaking.joinQueue, { playerId: a })).toEqual({ status: 'matched' });
    const { matches, queue } = await t.run(async (ctx) => ({
      matches: await ctx.db.query('matches').collect(),
      queue: await ctx.db.query('queue').collect(),
    }));
    expect(matches).toHaveLength(1);
    expect(queue).toHaveLength(0);
  });

  it('an entry seen exactly 30 s ago is paired; one more millisecond and it is swept', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const t = convexTest(schema, modules);
    const edge = crypto.randomUUID();
    const past = crypto.randomUUID();
    await t.run((ctx) => ctx.db.insert('queue', { playerId: edge, joinedAt: 1, lastSeen: 1_000_000 - 30_000 }));
    expect(await t.mutation(api.matchmaking.joinQueue, { playerId: crypto.randomUUID() })).toEqual({ status: 'matched' });

    await t.run((ctx) => ctx.db.insert('queue', { playerId: past, joinedAt: 1, lastSeen: 1_000_000 - 30_001 }));
    const caller = crypto.randomUUID();
    expect(await t.mutation(api.matchmaking.joinQueue, { playerId: caller })).toEqual({ status: 'queued' });
    const queue = await t.run((ctx) => ctx.db.query('queue').collect());
    expect(queue.map((row) => row.playerId)).toEqual([caller]);
  });

  it('rejoining while queued refreshes lastSeen and keeps joinedAt', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const t = convexTest(schema, modules);
    const a = crypto.randomUUID();
    await t.mutation(api.matchmaking.joinQueue, { playerId: a });
    vi.setSystemTime(1_020_000);
    await t.mutation(api.matchmaking.joinQueue, { playerId: a });
    const [row] = await t.run((ctx) => ctx.db.query('queue').collect());
    expect(row).toMatchObject({ playerId: a, joinedAt: 1_000_000, lastSeen: 1_020_000 });
  });
});
