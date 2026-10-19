/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { ConvexError } from 'convex/values';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, internal } from './_generated/api';
import { MATCHES_PER_HOUR } from './lib/relayBudget';
import schema from './schema';

const modules = import.meta.glob('./**/*.*s');

const HOUR = 3_600_000;
const H = 500_000;
const HOUR_START = H * HOUR;

type Tester = ReturnType<typeof convexTest>;

async function expectConvexErrorAsync(promise: Promise<unknown>, message: string): Promise<void> {
  const caught = await promise.then(
    () => undefined,
    (err: unknown) => err,
  );
  expect(caught).toBeInstanceOf(ConvexError);
  expect((caught as ConvexError<string>).data).toBe(message);
}

async function seedBudget(t: Tester, hour: number, matches: number) {
  await t.run((ctx) => ctx.db.insert('relayBudget', { hour, matches }));
}

async function budget(t: Tester) {
  const rows = await t.run((ctx) => ctx.db.query('relayBudget').collect());
  return rows.map(({ hour, matches }) => ({ hour, matches })).sort((a, b) => a.hour - b.hour);
}

describe('match starts are capped per hour', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('twenty pairings in an hour succeed and the twenty-first leaves both players queued as full', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(HOUR_START + 10 * 60_000);
    const t = convexTest(schema, modules);
    expect(MATCHES_PER_HOUR).toBe(20);

    for (let i = 0; i < 20; i++) {
      expect(await t.mutation(api.matchmaking.joinQueue, { playerId: crypto.randomUUID() })).toEqual({
        status: 'queued',
        full: false,
      });
      expect(await t.mutation(api.matchmaking.joinQueue, { playerId: crypto.randomUUID() })).toEqual({
        status: 'matched',
        full: false,
      });
    }
    expect(await budget(t)).toEqual([{ hour: H, matches: 20 }]);

    const c = crypto.randomUUID();
    const d = crypto.randomUUID();
    expect(await t.mutation(api.matchmaking.joinQueue, { playerId: c })).toEqual({ status: 'queued', full: false });
    vi.advanceTimersByTime(1_000);
    expect(await t.mutation(api.matchmaking.joinQueue, { playerId: d })).toEqual({ status: 'queued', full: true });

    const { matches, queue } = await t.run(async (ctx) => ({
      matches: await ctx.db.query('matches').collect(),
      queue: await ctx.db.query('queue').collect(),
    }));
    expect(matches).toHaveLength(20);
    expect(queue.find((e) => e.playerId === c)).toMatchObject({ lastSeen: HOUR_START + 10 * 60_000 });
    expect(queue.find((e) => e.playerId === d)).toMatchObject({ lastSeen: HOUR_START + 10 * 60_000 + 1_000 });
    expect(queue).toHaveLength(2);
    expect(await budget(t)).toEqual([{ hour: H, matches: 20 }]);
  });

  it('a heartbeat in the next hour pairs players left waiting by a full hour', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(HOUR_START + HOUR - 5_000);
    const t = convexTest(schema, modules);
    await seedBudget(t, H, 20);
    const c = crypto.randomUUID();
    const d = crypto.randomUUID();

    expect(await t.mutation(api.matchmaking.joinQueue, { playerId: c })).toEqual({ status: 'queued', full: false });
    expect(await t.mutation(api.matchmaking.joinQueue, { playerId: d })).toEqual({ status: 'queued', full: true });
    expect(await t.mutation(api.matchmaking.queueHeartbeat, { playerId: d })).toEqual({ status: 'queued', full: true });
    expect(await t.run((ctx) => ctx.db.query('matches').collect())).toEqual([]);

    vi.setSystemTime(HOUR_START + HOUR + 1_000);
    expect(await t.mutation(api.matchmaking.queueHeartbeat, { playerId: d })).toEqual({ status: 'matched', full: false });

    const { matches, queue } = await t.run(async (ctx) => ({
      matches: await ctx.db.query('matches').collect(),
      queue: await ctx.db.query('queue').collect(),
    }));
    expect(queue).toEqual([]);
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({ kind: 'quick', hostId: c, guestId: d, status: 'connecting' });
    expect(await budget(t)).toEqual([
      { hour: H, matches: 20 },
      { hour: H + 1, matches: 1 },
    ]);
    expect(await t.mutation(api.matchmaking.queueHeartbeat, { playerId: c })).toEqual({ status: 'matched', full: false });
  });

  it('the earlier queuer hosts even when their own heartbeat makes the pair', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(HOUR_START + HOUR - 5_000);
    const t = convexTest(schema, modules);
    await seedBudget(t, H, 20);
    const first = crypto.randomUUID();
    const second = crypto.randomUUID();
    await t.mutation(api.matchmaking.joinQueue, { playerId: first });
    vi.setSystemTime(HOUR_START + HOUR - 4_000);
    await t.mutation(api.matchmaking.joinQueue, { playerId: second });

    vi.setSystemTime(HOUR_START + HOUR + 1_000);
    expect(await t.mutation(api.matchmaking.queueHeartbeat, { playerId: first })).toEqual({ status: 'matched', full: false });
    const [match] = await t.run((ctx) => ctx.db.query('matches').collect());
    expect(match).toMatchObject({ hostId: first, guestId: second });
  });

  it('joining a private code at the cap is refused as BUSY and uses no slot', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(HOUR_START + 60_000);
    const t = convexTest(schema, modules);
    const host = crypto.randomUUID();
    const guest = crypto.randomUUID();
    const { code } = await t.mutation(api.privateMatch.createPrivate, { playerId: host });
    await seedBudget(t, H, 20);

    await expectConvexErrorAsync(t.mutation(api.privateMatch.joinPrivate, { playerId: guest, code }), 'BUSY');

    const matches = await t.run((ctx) => ctx.db.query('matches').collect());
    expect(matches).toHaveLength(1);
    expect(matches[0].status).toBe('waiting');
    expect(matches[0].guestId).toBeUndefined();
    expect(await budget(t)).toEqual([{ hour: H, matches: 20 }]);
  });

  it('joining a private code below the cap takes a slot', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(HOUR_START + 60_000);
    const t = convexTest(schema, modules);
    const host = crypto.randomUUID();
    const guest = crypto.randomUUID();
    const { code } = await t.mutation(api.privateMatch.createPrivate, { playerId: host });
    await seedBudget(t, H, 19);

    await t.mutation(api.privateMatch.joinPrivate, { playerId: guest, code });

    const matches = await t.run((ctx) => ctx.db.query('matches').collect());
    expect(matches[0]).toMatchObject({ status: 'connecting', guestId: guest });
    expect(await budget(t)).toEqual([{ hour: H, matches: 20 }]);
  });

  it('the rematch request that would start the match is refused as BUSY at the cap and uses no slot', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(HOUR_START + 60_000);
    const t = convexTest(schema, modules);
    const hostId = crypto.randomUUID();
    const guestId = crypto.randomUUID();
    const matchId = await t.run((ctx) =>
      ctx.db.insert('matches', {
        kind: 'quick', hostId, guestId, status: 'finished', seed: 12345, round: 5, hostScore: 3, guestScore: 2,
        endReason: 'score', winner: 'host', createdAt: 1000, hostSeen: 1000, guestSeen: 1000,
      }),
    );
    await seedBudget(t, H, 20);

    expect(await t.mutation(api.matches.requestRematch, { playerId: hostId, matchId })).toEqual({ matchId: null });
    await expectConvexErrorAsync(t.mutation(api.matches.requestRematch, { playerId: guestId, matchId }), 'BUSY');

    const matches = await t.run((ctx) => ctx.db.query('matches').collect());
    expect(matches).toHaveLength(1);
    expect(matches[0].hostRematch).toBe(true);
    expect(matches[0].guestRematch).not.toBe(true);
    expect(await budget(t)).toEqual([{ hour: H, matches: 20 }]);
  });

  it('the rematch request that starts the match takes a slot', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(HOUR_START + 60_000);
    const t = convexTest(schema, modules);
    const hostId = crypto.randomUUID();
    const guestId = crypto.randomUUID();
    const matchId = await t.run((ctx) =>
      ctx.db.insert('matches', {
        kind: 'quick', hostId, guestId, status: 'finished', seed: 12345, round: 5, hostScore: 3, guestScore: 2,
        endReason: 'score', winner: 'host', createdAt: 1000, hostSeen: 1000, guestSeen: 1000,
      }),
    );

    await t.mutation(api.matches.requestRematch, { playerId: hostId, matchId });
    expect(await budget(t)).toEqual([]);
    const { matchId: rematchId } = await t.mutation(api.matches.requestRematch, { playerId: guestId, matchId });

    expect(rematchId).not.toBeNull();
    expect(await budget(t)).toEqual([{ hour: H, matches: 1 }]);
  });

  it('the sweep deletes budget rows more than two hours old', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(HOUR_START + 30 * 60_000);
    const t = convexTest(schema, modules);
    for (const hour of [H - 4, H - 3, H - 2, H - 1, H]) await seedBudget(t, hour, 5);

    await t.mutation(internal.sweep.sweep, {});

    expect((await budget(t)).map((row) => row.hour)).toEqual([H - 2, H - 1, H]);
  });
});
