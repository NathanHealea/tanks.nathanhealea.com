/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { ConvexError } from 'convex/values';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
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

type Tester = ReturnType<typeof convexTest>;

async function seedMatch(t: Tester, status: Doc<'matches'>['status'] = 'connecting') {
  const hostId = crypto.randomUUID();
  const guestId = crypto.randomUUID();
  const matchId = await t.run((ctx) =>
    ctx.db.insert('matches', {
      kind: 'quick', hostId, guestId, status, seed: 1, round: 0, hostScore: 0, guestScore: 0,
      createdAt: Date.now(), hostSeen: Date.now(), guestSeen: Date.now(),
    }),
  );
  return { matchId, hostId, guestId };
}

describe('signaling', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('sendSignal addresses the opponent', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(2_000_000);
    const t = convexTest(schema, modules);
    const { matchId, hostId, guestId } = await seedMatch(t);

    const result = await t.mutation(api.signaling.sendSignal, { playerId: hostId, matchId, kind: 'offer', payload: 'v=0 host-offer' });
    vi.setSystemTime(2_000_500);
    await t.mutation(api.signaling.sendSignal, { playerId: guestId, matchId, kind: 'answer', payload: 'v=0 guest-answer' });

    expect(result).toBeNull();
    const rows = await t.run((ctx) => ctx.db.query('signals').collect());
    expect(rows).toHaveLength(2);
    const fromHost = rows.find((r) => r.kind === 'offer');
    const fromGuest = rows.find((r) => r.kind === 'answer');
    expect(fromHost).toMatchObject({ matchId, to: 'guest', kind: 'offer', payload: 'v=0 host-offer', createdAt: 2_000_000 });
    expect(fromGuest).toMatchObject({ matchId, to: 'host', kind: 'answer', payload: 'v=0 guest-answer', createdAt: 2_000_500 });
    for (const row of rows) {
      expect(Object.keys(row).sort()).toEqual(['_creationTime', '_id', 'createdAt', 'kind', 'matchId', 'payload', 'to']);
      expect(JSON.stringify(row)).not.toContain(hostId);
      expect(JSON.stringify(row)).not.toContain(guestId);
    }
  });

  it('sendSignal rejects bad calls', async () => {
    const t = convexTest(schema, modules);
    const { matchId, hostId } = await seedMatch(t);
    const waiting = await seedMatch(t, 'waiting');
    const playing = await seedMatch(t, 'playing');
    const outsider = crypto.randomUUID();
    const countSignals = () => t.run(async (ctx) => (await ctx.db.query('signals').collect()).length);

    await expectConvexErrorAsync(
      t.mutation(api.signaling.sendSignal, { playerId: outsider, matchId, kind: 'offer', payload: 'x' }),
      'Not in this match',
    );
    expect(await countSignals()).toBe(0);

    await expectConvexErrorAsync(
      t.mutation(api.signaling.sendSignal, { playerId: waiting.hostId, matchId: waiting.matchId, kind: 'offer', payload: 'x' }),
      'Match is not connecting',
    );
    await expectConvexErrorAsync(
      t.mutation(api.signaling.sendSignal, { playerId: playing.guestId, matchId: playing.matchId, kind: 'ice', payload: 'x' }),
      'Match is not connecting',
    );
    expect(await countSignals()).toBe(0);

    await expectConvexErrorAsync(
      t.mutation(api.signaling.sendSignal, { playerId: hostId, matchId, kind: 'offer', payload: 'a'.repeat(16_385) }),
      'Signal too large',
    );
    expect(await countSignals()).toBe(0);

    await expect(
      t.mutation(api.signaling.sendSignal, { playerId: hostId, matchId, kind: 'bye' as 'offer', payload: 'x' }),
    ).rejects.toThrow();
    expect(await countSignals()).toBe(0);
  });

  it('inbox returns only my messages in order', async () => {
    const t = convexTest(schema, modules);
    const { matchId, hostId, guestId } = await seedMatch(t);
    const other = await seedMatch(t);
    // Inserted out of createdAt order so insertion order cannot pass for sorting.
    await t.run(async (ctx) => {
      await ctx.db.insert('signals', { matchId, to: 'host', kind: 'ice', payload: 'guest-ice-2', createdAt: 3_000 });
      await ctx.db.insert('signals', { matchId, to: 'guest', kind: 'offer', payload: 'host-offer', createdAt: 1_000 });
      await ctx.db.insert('signals', { matchId, to: 'host', kind: 'answer', payload: 'guest-answer', createdAt: 1_500 });
      await ctx.db.insert('signals', { matchId: other.matchId, to: 'host', kind: 'ice', payload: 'other-match', createdAt: 1_200 });
      await ctx.db.insert('signals', { matchId, to: 'host', kind: 'ice', payload: 'guest-ice-1', createdAt: 2_000 });
      await ctx.db.insert('signals', { matchId, to: 'guest', kind: 'ice', payload: 'host-ice', createdAt: 2_500 });
    });

    const hostInbox = await t.query(api.signaling.inbox, { playerId: hostId, matchId });
    const guestInbox = await t.query(api.signaling.inbox, { playerId: guestId, matchId });

    expect(hostInbox).toEqual([
      { id: expect.any(String), kind: 'answer', payload: 'guest-answer', createdAt: 1_500 },
      { id: expect.any(String), kind: 'ice', payload: 'guest-ice-1', createdAt: 2_000 },
      { id: expect.any(String), kind: 'ice', payload: 'guest-ice-2', createdAt: 3_000 },
    ]);
    expect(guestInbox).toEqual([
      { id: expect.any(String), kind: 'offer', payload: 'host-offer', createdAt: 1_000 },
      { id: expect.any(String), kind: 'ice', payload: 'host-ice', createdAt: 2_500 },
    ]);
    await expectConvexErrorAsync(
      t.query(api.signaling.inbox, { playerId: crypto.randomUUID(), matchId }),
      'Not in this match',
    );
  });

  it('markConnected starts the match and clears signals', async () => {
    const t = convexTest(schema, modules);
    const { matchId, hostId, guestId } = await seedMatch(t);
    const other = await seedMatch(t);
    await t.run(async (ctx) => {
      await ctx.db.insert('signals', { matchId, to: 'guest', kind: 'offer', payload: 'host-offer', createdAt: 1_000 });
      await ctx.db.insert('signals', { matchId, to: 'host', kind: 'answer', payload: 'guest-answer', createdAt: 1_500 });
      await ctx.db.insert('signals', { matchId: other.matchId, to: 'guest', kind: 'offer', payload: 'other-offer', createdAt: 1_200 });
    });
    const getMatch = () => t.run((ctx) => ctx.db.get(matchId as Id<'matches'>));

    await expectConvexErrorAsync(
      t.mutation(api.signaling.markConnected, { playerId: guestId, matchId }),
      'Only the host can mark connected',
    );
    expect((await getMatch())?.status).toBe('connecting');

    const result = await t.mutation(api.signaling.markConnected, { playerId: hostId, matchId });

    expect(result).toBeNull();
    expect((await getMatch())?.status).toBe('playing');
    const remaining = await t.run((ctx) => ctx.db.query('signals').collect());
    expect(remaining.map((r) => r.payload)).toEqual(['other-offer']);

    expect(await t.mutation(api.signaling.markConnected, { playerId: hostId, matchId })).toBeNull();
    expect((await getMatch())?.status).toBe('playing');
  });

  it('every signal for a match is deleted two minutes after the first, connected or not', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const t = convexTest(schema, modules);
    const { matchId, hostId, guestId } = await seedMatch(t);
    await t.mutation(api.signaling.sendSignal, { playerId: hostId, matchId, kind: 'offer', payload: '{}' });
    await t.mutation(api.signaling.sendSignal, { playerId: guestId, matchId, kind: 'answer', payload: '{}' });

    vi.advanceTimersByTime(119_000);
    await t.finishInProgressScheduledFunctions();
    expect(await t.run((ctx) => ctx.db.query('signals').collect())).toHaveLength(2);

    vi.advanceTimersByTime(1_000);
    await t.finishInProgressScheduledFunctions();
    expect(await t.run((ctx) => ctx.db.query('signals').collect())).toHaveLength(0);
  });

  it('a side cannot send more than 50 signals', async () => {
    const t = convexTest(schema, modules);
    const { matchId, hostId } = await seedMatch(t);
    for (let i = 0; i < 50; i++) {
      await t.mutation(api.signaling.sendSignal, { playerId: hostId, matchId, kind: 'ice', payload: String(i) });
    }
    await expectConvexErrorAsync(
      t.mutation(api.signaling.sendSignal, { playerId: hostId, matchId, kind: 'ice', payload: 'one more' }),
      'Too many signals',
    );
    expect(await t.run((ctx) => ctx.db.query('signals').collect())).toHaveLength(50);
  });

  it('after the connect timeout, nobody can send or read signals', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const t = convexTest(schema, modules);
    const { matchId, hostId, guestId } = await seedMatch(t);
    await t.mutation(api.signaling.sendSignal, { playerId: hostId, matchId, kind: 'offer', payload: '{}' });

    vi.setSystemTime(1_000_000 + 60_001);
    expect(await t.query(api.signaling.inbox, { playerId: guestId, matchId })).toEqual([]);
    await expectConvexErrorAsync(
      t.mutation(api.signaling.sendSignal, { playerId: guestId, matchId, kind: 'answer', payload: '{}' }),
      'Match is not connecting',
    );
  });

  it('the expiry clock starts at the first signal and touches only its own match', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const t = convexTest(schema, modules);
    const { matchId, hostId, guestId } = await seedMatch(t);
    const other = await seedMatch(t);
    await t.mutation(api.signaling.sendSignal, { playerId: hostId, matchId, kind: 'offer', payload: '{}' });
    vi.advanceTimersByTime(30_000);
    await t.mutation(api.signaling.sendSignal, { playerId: guestId, matchId, kind: 'answer', payload: '{}' });
    await t.mutation(api.signaling.sendSignal, { playerId: other.hostId, matchId: other.matchId, kind: 'offer', payload: '{}' });

    vi.advanceTimersByTime(90_000);
    await t.finishInProgressScheduledFunctions();
    const left = await t.run((ctx) => ctx.db.query('signals').collect());
    expect(left.map((s) => s.matchId)).toEqual([other.matchId]);
  });

  it('markConnected never revives a match that is over or timed out', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const t = convexTest(schema, modules);
    const finished = await seedMatch(t, 'finished');
    expect(await t.mutation(api.signaling.markConnected, { playerId: finished.hostId, matchId: finished.matchId })).toBeNull();
    expect((await t.run((ctx) => ctx.db.get(finished.matchId)))?.status).toBe('finished');

    const late = await seedMatch(t);
    vi.setSystemTime(1_000_000 + 60_001);
    await t.mutation(api.signaling.markConnected, { playerId: late.hostId, matchId: late.matchId });
    expect((await t.run((ctx) => ctx.db.get(late.matchId)))?.status).toBe('connecting');
  });

  it('a payload of exactly 16 KB is accepted, and a send at exactly the timeout still counts', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const t = convexTest(schema, modules);
    const { matchId, hostId } = await seedMatch(t);
    await t.mutation(api.signaling.sendSignal, { playerId: hostId, matchId, kind: 'offer', payload: 'x'.repeat(16_384) });
    vi.setSystemTime(1_000_000 + 60_000);
    await t.mutation(api.signaling.sendSignal, { playerId: hostId, matchId, kind: 'ice', payload: '{}' });
    expect(await t.run((ctx) => ctx.db.query('signals').collect())).toHaveLength(2);
  });
});
