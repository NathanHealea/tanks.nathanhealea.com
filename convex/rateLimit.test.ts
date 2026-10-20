/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { ConvexError } from 'convex/values';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, internal } from './_generated/api';
import { MATCHMAKING_CALLS_PER_MINUTE } from './lib/rateLimit';
import { hourOf, MATCHES_PER_HOUR } from './lib/relayBudget';
import schema from './schema';

const modules = import.meta.glob('./**/*.*s');

const MINUTE = 60_000;
const M = 30_000_000;
const MINUTE_START = M * MINUTE;

type Tester = ReturnType<typeof convexTest>;

async function expectConvexErrorAsync(promise: Promise<unknown>, message: string): Promise<void> {
  const caught = await promise.then(
    () => undefined,
    (err: unknown) => err,
  );
  expect(caught).toBeInstanceOf(ConvexError);
  expect((caught as ConvexError<string>).data).toBe(message);
}

async function seedCalls(t: Tester, minute: number, calls: number) {
  await t.run((ctx) => ctx.db.insert('rateLimit', { minute, calls }));
}

async function counters(t: Tester) {
  const rows = await t.run((ctx) => ctx.db.query('rateLimit').collect());
  return rows.map(({ minute, calls }) => ({ minute, calls })).sort((a, b) => a.minute - b.minute);
}

async function tables(t: Tester) {
  return t.run(async (ctx) => ({
    queue: await ctx.db.query('queue').collect(),
    matches: await ctx.db.query('matches').collect(),
  }));
}

describe('matchmaking calls are rate limited', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('the 121st joinQueue in a minute is refused and leaves no trace', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(MINUTE_START + 1_000);
    const t = convexTest(schema, modules);
    expect(MATCHMAKING_CALLS_PER_MINUTE).toBe(120);

    for (let i = 0; i < 120; i++) await t.mutation(api.matchmaking.joinQueue, { playerId: crypto.randomUUID() });
    expect(await counters(t)).toEqual([{ minute: M, calls: 120 }]);
    const before = await tables(t);

    vi.setSystemTime(MINUTE_START + 59_999);
    const late = crypto.randomUUID();
    await expectConvexErrorAsync(t.mutation(api.matchmaking.joinQueue, { playerId: late }), 'RATE_LIMITED');

    expect(await tables(t)).toEqual(before);
    expect(before.queue.map((e) => e.playerId)).not.toContain(late);
    expect(await counters(t)).toEqual([{ minute: M, calls: 120 }]);
  });

  it('joinQueue, createPrivate and joinPrivate share one count', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(MINUTE_START + 1_000);
    const t = convexTest(schema, modules);

    await t.mutation(api.matchmaking.joinQueue, { playerId: crypto.randomUUID() });
    const { code } = await t.action(api.privateMatch.createPrivate, { playerId: crypto.randomUUID() });
    await t.mutation(api.privateMatch.joinPrivate, { playerId: crypto.randomUUID(), code });

    expect(await counters(t)).toEqual([{ minute: M, calls: 3 }]);
  });

  it('createPrivate at the limit is refused and changes nothing', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(MINUTE_START + 1_000);
    const t = convexTest(schema, modules);
    const host = crypto.randomUUID();
    const { code } = await t.action(api.privateMatch.createPrivate, { playerId: host });
    await t.run(async (ctx) => {
      await ctx.db.insert('queue', { playerId: host, joinedAt: Date.now(), lastSeen: Date.now() });
      const row = await ctx.db.query('rateLimit').unique();
      await ctx.db.patch(row!._id, { calls: 120 });
    });
    const before = await tables(t);

    await expectConvexErrorAsync(t.action(api.privateMatch.createPrivate, { playerId: host }), 'RATE_LIMITED');

    const after = await tables(t);
    expect(after).toEqual(before);
    expect(after.matches).toHaveLength(1);
    expect(after.matches[0]).toMatchObject({ code, hostId: host, status: 'waiting' });
    expect(after.queue.map((e) => e.playerId)).toEqual([host]);
    expect(await counters(t)).toEqual([{ minute: M, calls: 120 }]);
  });

  it('joinPrivate at the limit is refused and changes nothing', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(MINUTE_START + 1_000);
    const t = convexTest(schema, modules);
    const host = crypto.randomUUID();
    const guest = crypto.randomUUID();
    const { code } = await t.action(api.privateMatch.createPrivate, { playerId: host });
    await t.run(async (ctx) => {
      await ctx.db.insert('queue', { playerId: guest, joinedAt: Date.now(), lastSeen: Date.now() });
      const row = await ctx.db.query('rateLimit').unique();
      await ctx.db.patch(row!._id, { calls: 120 });
    });
    const before = await tables(t);

    await expectConvexErrorAsync(t.mutation(api.privateMatch.joinPrivate, { playerId: guest, code }), 'RATE_LIMITED');

    const after = await tables(t);
    expect(after).toEqual(before);
    expect(after.matches[0].status).toBe('waiting');
    expect(after.matches[0].guestId).toBeUndefined();
    expect(await counters(t)).toEqual([{ minute: M, calls: 120 }]);
  });

  it('heartbeats and other upkeep calls still work at the limit and are not counted', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(MINUTE_START + 1_000);
    const t = convexTest(schema, modules);
    const waiting = crypto.randomUUID();
    const leaving = crypto.randomUUID();
    const host = crypto.randomUUID();
    await t.mutation(api.matchmaking.joinQueue, { playerId: waiting });
    vi.setSystemTime(MINUTE_START + 2_000);
    const { code } = await t.action(api.privateMatch.createPrivate, { playerId: host });
    await t.run(async (ctx) => {
      await ctx.db.insert('queue', { playerId: leaving, joinedAt: Date.now(), lastSeen: Date.now() });
      const row = await ctx.db.query('rateLimit').unique();
      await ctx.db.patch(row!._id, { calls: 120 });
    });
    const match = await t.run((ctx) => ctx.db.query('matches').withIndex('by_code', (q) => q.eq('code', code)).unique());

    vi.setSystemTime(MINUTE_START + 3_000);
    expect(await t.mutation(api.matchmaking.leaveQueue, { playerId: leaving })).toBeNull();
    expect(await t.mutation(api.matchmaking.queueHeartbeat, { playerId: waiting })).toEqual({ status: 'queued', full: false });
    await t.mutation(api.privateMatch.extendPrivate, { playerId: host, matchId: match!._id });
    expect(await t.mutation(api.privateMatch.cancelPrivate, { playerId: host, matchId: match!._id })).toBeNull();

    const { queue } = await tables(t);
    expect(queue.map((e) => ({ playerId: e.playerId, lastSeen: e.lastSeen }))).toEqual([
      { playerId: waiting, lastSeen: MINUTE_START + 3_000 },
    ]);
    expect((await t.run((ctx) => ctx.db.get(match!._id)))?.status).toBe('abandoned');
    expect(await counters(t)).toEqual([{ minute: M, calls: 120 }]);
  });

  it('a malformed player id is refused without being counted', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(MINUTE_START + 1_000);
    const t = convexTest(schema, modules);

    await expectConvexErrorAsync(t.mutation(api.matchmaking.joinQueue, { playerId: 'x' }), 'Invalid player id');
    await expectConvexErrorAsync(t.action(api.privateMatch.createPrivate, { playerId: 'x' }), 'Invalid player id');
    await expectConvexErrorAsync(t.mutation(api.privateMatch.joinPrivate, { playerId: 'x', code: 'ABCDEF' }), 'Invalid player id');

    expect(await counters(t)).toEqual([]);
  });

  it('at the limit, a refused call still hears its own reason', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(MINUTE_START + 1_000);
    const t = convexTest(schema, modules);
    await seedCalls(t, M, 120);

    await expectConvexErrorAsync(t.mutation(api.matchmaking.joinQueue, { playerId: 'x' }), 'Invalid player id');
    await expectConvexErrorAsync(t.action(api.privateMatch.createPrivate, { playerId: 'x' }), 'Invalid player id');
    await expectConvexErrorAsync(
      t.mutation(api.privateMatch.joinPrivate, { playerId: crypto.randomUUID(), code: 'ABCDEF' }),
      'CODE_NOT_FOUND',
    );

    expect(await counters(t)).toEqual([{ minute: M, calls: 120 }]);
  });

  it('a joiner waiting for a relay slot stays in line at the limit', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(MINUTE_START + 1_000);
    const t = convexTest(schema, modules);
    const { code } = await t.action(api.privateMatch.createPrivate, { playerId: crypto.randomUUID() });
    await t.run(async (ctx) => {
      await ctx.db.insert('relayBudget', { hour: hourOf(Date.now()), matches: MATCHES_PER_HOUR });
      const row = await ctx.db.query('rateLimit').unique();
      await ctx.db.patch(row!._id, { calls: 120 });
    });

    await expectConvexErrorAsync(t.mutation(api.privateMatch.joinPrivate, { playerId: crypto.randomUUID(), code }), 'BUSY');

    expect(await counters(t)).toEqual([{ minute: M, calls: 120 }]);
  });

  it('the next minute accepts calls again', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(MINUTE_START + 59_000);
    const t = convexTest(schema, modules);
    await seedCalls(t, M, 120);
    const player = crypto.randomUUID();
    await expectConvexErrorAsync(t.mutation(api.matchmaking.joinQueue, { playerId: player }), 'RATE_LIMITED');

    vi.setSystemTime(MINUTE_START + MINUTE);
    expect(await t.mutation(api.matchmaking.joinQueue, { playerId: player })).toEqual({ status: 'queued', full: false });

    expect((await tables(t)).queue.map((e) => e.playerId)).toEqual([player]);
    expect(await counters(t)).toEqual([
      { minute: M, calls: 120 },
      { minute: M + 1, calls: 1 },
    ]);
  });

  it('the sweep deletes counter rows more than two minutes old', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(MINUTE_START + 30_000);
    const t = convexTest(schema, modules);
    for (const minute of [M - 4, M - 3, M - 2, M - 1, M]) await seedCalls(t, minute, 7);

    await t.mutation(internal.sweep.sweep, {});

    expect((await counters(t)).map((row) => row.minute)).toEqual([M - 2, M - 1, M]);
  });
});
