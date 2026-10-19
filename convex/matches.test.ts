/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { ConvexError } from 'convex/values';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from './_generated/api';
import type { Id } from './_generated/dataModel';
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

async function seedPlayingMatch(t: Tester) {
  const hostId = crypto.randomUUID();
  const guestId = crypto.randomUUID();
  const matchId = await t.run((ctx) =>
    ctx.db.insert('matches', {
      kind: 'quick', hostId, guestId, status: 'playing', seed: 1, round: 0, hostScore: 0, guestScore: 0,
      createdAt: 1000, hostSeen: 1000, guestSeen: 1000,
    }),
  );
  return { matchId, hostId, guestId };
}

async function seedFinishedMatch(
  t: Tester,
  over: { kind?: 'quick' | 'private'; status?: 'finished' | 'abandoned' | 'playing'; endReason?: 'score' | 'forfeit' | 'timeout' } = {},
) {
  const hostId = crypto.randomUUID();
  const guestId = crypto.randomUUID();
  const status = over.status ?? 'finished';
  const endReason = over.endReason ?? (status === 'finished' ? 'score' : undefined);
  const matchId = await t.run((ctx) =>
    ctx.db.insert('matches', {
      kind: over.kind ?? 'quick', hostId, guestId, status, seed: 12345, round: 5, hostScore: 3, guestScore: 2,
      ...(endReason ? { endReason } : {}), ...(status === 'finished' ? { winner: 'host' as const } : {}),
      createdAt: 1000, hostSeen: 1000, guestSeen: 1000,
    }),
  );
  return { matchId, hostId, guestId };
}

async function seedPresence(t: Tester, matchId: Id<'matches'>, role: 'host' | 'guest', lastSeen: number) {
  await t.run((ctx) => ctx.db.insert('presence', { matchId, role, lastSeen }));
}

describe('matches', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("reportRound accepts only the host's next round", async () => {
    const t = convexTest(schema, modules);
    const { matchId, hostId, guestId } = await seedPlayingMatch(t);
    const load = () => t.run((ctx) => ctx.db.get(matchId));

    const ok = await t.mutation(api.matches.reportRound, { playerId: hostId, matchId, round: 1, result: 'host' });
    expect(ok).toBeNull();
    expect(await load()).toMatchObject({ round: 1, hostScore: 1, guestScore: 0, status: 'playing' });

    await expectConvexErrorAsync(
      t.mutation(api.matches.reportRound, { playerId: hostId, matchId, round: 1, result: 'host' }),
      'Unexpected round',
    );
    await expectConvexErrorAsync(
      t.mutation(api.matches.reportRound, { playerId: hostId, matchId, round: 3, result: 'host' }),
      'Unexpected round',
    );
    await expectConvexErrorAsync(
      t.mutation(api.matches.reportRound, { playerId: guestId, matchId, round: 2, result: 'guest' }),
      'Only the host reports rounds',
    );
    expect(await load()).toMatchObject({ round: 1, hostScore: 1, guestScore: 0, status: 'playing' });

    await t.mutation(api.matches.reportRound, { playerId: hostId, matchId, round: 2, result: 'guest' });
    await t.mutation(api.matches.reportRound, { playerId: hostId, matchId, round: 3, result: null });
    expect(await load()).toMatchObject({ round: 3, hostScore: 1, guestScore: 1, status: 'playing' });
    await t.mutation(api.matches.reportRound, { playerId: hostId, matchId, round: 4, result: 'host' });
    const beforeThirdWin = await load();
    expect(beforeThirdWin).toMatchObject({ round: 4, hostScore: 2, guestScore: 1, status: 'playing' });
    expect(beforeThirdWin?.winner).toBeUndefined();
    expect(beforeThirdWin?.endReason).toBeUndefined();

    await t.mutation(api.matches.reportRound, { playerId: hostId, matchId, round: 5, result: 'host' });
    expect(await load()).toMatchObject({
      round: 5,
      hostScore: 3,
      guestScore: 1,
      status: 'finished',
      winner: 'host',
      endReason: 'score',
    });

    await expectConvexErrorAsync(
      t.mutation(api.matches.reportRound, { playerId: hostId, matchId, round: 6, result: 'host' }),
      'Match is not playing',
    );
  });

  it('a guest reaching three wins finishes the match with the guest as winner', async () => {
    const t = convexTest(schema, modules);
    const { matchId, hostId } = await seedPlayingMatch(t);
    for (let round = 1; round <= 3; round++) {
      await t.mutation(api.matches.reportRound, { playerId: hostId, matchId, round, result: 'guest' });
    }
    expect(await t.run((ctx) => ctx.db.get(matchId))).toMatchObject({
      status: 'finished', winner: 'guest', endReason: 'score', guestScore: 3, hostScore: 0,
    });
  });

  it('rematch needs both players', async () => {
    const t = convexTest(schema, modules);
    const { matchId, hostId, guestId } = await seedFinishedMatch(t, { kind: 'private' });
    const load = () => t.run((ctx) => ctx.db.get(matchId));
    const allMatches = () => t.run((ctx) => ctx.db.query('matches').collect());

    await expectConvexErrorAsync(
      t.mutation(api.matches.requestRematch, { playerId: crypto.randomUUID(), matchId }),
      'Not in this match',
    );

    expect(await t.mutation(api.matches.requestRematch, { playerId: hostId, matchId })).toEqual({ matchId: null });
    const flagged = await load();
    expect(flagged?.hostRematch).toBe(true);
    expect(flagged?.guestRematch).toBeFalsy();
    expect(await allMatches()).toHaveLength(1);

    const second = await t.mutation(api.matches.requestRematch, { playerId: guestId, matchId });
    expect(second.matchId).not.toBeNull();
    const rematch = await t.run((ctx) => ctx.db.get(second.matchId!));
    expect(rematch).toMatchObject({
      kind: 'private',
      hostId: guestId,
      guestId: hostId,
      status: 'connecting',
      round: 0,
      hostScore: 0,
      guestScore: 0,
      rematchOf: matchId,
    });
    expect(rematch!.seed).not.toBe(12345);
    expect(Number.isInteger(rematch!.seed)).toBe(true);
    expect(rematch!.seed).toBeGreaterThanOrEqual(0);
    expect(rematch!.seed).toBeLessThan(2 ** 32);
    expect(rematch!.hostSeen).toBe(rematch!.createdAt);
    expect(rematch!.guestSeen).toBe(rematch!.createdAt);

    const third = await t.mutation(api.matches.requestRematch, { playerId: hostId, matchId });
    expect(third).toEqual({ matchId: second.matchId });
    expect(await allMatches()).toHaveLength(2);
  });

  it('rematch on a match still playing is refused', async () => {
    const t = convexTest(schema, modules);
    const { matchId, hostId } = await seedFinishedMatch(t, { status: 'playing' });
    await expectConvexErrorAsync(
      t.mutation(api.matches.requestRematch, { playerId: hostId, matchId }),
      'Match is not finished',
    );
  });

  it('rematch after opponent left fails', async () => {
    const t = convexTest(schema, modules);
    const left = [
      await seedFinishedMatch(t, { endReason: 'forfeit' }),
      await seedFinishedMatch(t, { endReason: 'timeout' }),
      await seedFinishedMatch(t, { status: 'abandoned' }),
    ];
    for (const { matchId, hostId, guestId } of left) {
      await expectConvexErrorAsync(t.mutation(api.matches.requestRematch, { playerId: hostId, matchId }), 'OPPONENT_LEFT');
      await expectConvexErrorAsync(t.mutation(api.matches.requestRematch, { playerId: guestId, matchId }), 'OPPONENT_LEFT');
    }
    expect(await t.run((ctx) => ctx.db.query('matches').collect())).toHaveLength(3);
  });

  it('a withdrawn rematch request is not counted', async () => {
    const t = convexTest(schema, modules);
    const { matchId, hostId, guestId } = await seedFinishedMatch(t);
    await t.mutation(api.matches.requestRematch, { playerId: hostId, matchId });
    await t.mutation(api.matches.cancelRematch, { playerId: hostId, matchId });
    expect((await t.run((ctx) => ctx.db.get(matchId)))?.hostRematch).toBe(false);

    expect(await t.mutation(api.matches.requestRematch, { playerId: guestId, matchId })).toEqual({ matchId: null });
    expect(await t.run((ctx) => ctx.db.query('matches').collect())).toHaveLength(1);
    await expectConvexErrorAsync(
      t.mutation(api.matches.cancelRematch, { playerId: crypto.randomUUID(), matchId }),
      'Not in this match',
    );
  });

  it('withdrawing after the rematch exists changes nothing', async () => {
    const t = convexTest(schema, modules);
    const { matchId, hostId, guestId } = await seedFinishedMatch(t);
    await t.mutation(api.matches.requestRematch, { playerId: hostId, matchId });
    await t.mutation(api.matches.requestRematch, { playerId: guestId, matchId });
    await t.mutation(api.matches.cancelRematch, { playerId: hostId, matchId });
    expect(await t.run((ctx) => ctx.db.get(matchId))).toMatchObject({ hostRematch: true, guestRematch: true });
  });

  it('a rematch is not opened while the other player is in another match', async () => {
    const t = convexTest(schema, modules);
    const { matchId, hostId, guestId } = await seedFinishedMatch(t);
    await t.mutation(api.matches.requestRematch, { playerId: hostId, matchId });
    await t.mutation(api.privateMatch.createPrivate, { playerId: hostId });
    await expectConvexErrorAsync(t.mutation(api.matches.requestRematch, { playerId: guestId, matchId }), 'OPPONENT_LEFT');
    expect(await t.run((ctx) => ctx.db.query('matches').collect())).toHaveLength(2);
  });

  it('a rematch asked for by the guest first checks the host is still free', async () => {
    const t = convexTest(schema, modules);
    const { matchId, hostId, guestId } = await seedFinishedMatch(t);
    expect(await t.mutation(api.matches.requestRematch, { playerId: guestId, matchId })).toEqual({ matchId: null });
    expect(await t.run((ctx) => ctx.db.get(matchId))).toMatchObject({ hostRematch: false, guestRematch: true });
    await t.mutation(api.privateMatch.createPrivate, { playerId: guestId });
    await expectConvexErrorAsync(t.mutation(api.matches.requestRematch, { playerId: hostId, matchId }), 'OPPONENT_LEFT');
    expect(await t.run((ctx) => ctx.db.query('matches').collect())).toHaveLength(2);
  });

  it('the guest withdraws only their own rematch request', async () => {
    const t = convexTest(schema, modules);
    const { matchId, hostId, guestId } = await seedFinishedMatch(t);
    await t.mutation(api.matches.requestRematch, { playerId: guestId, matchId });
    await t.mutation(api.matches.cancelRematch, { playerId: guestId, matchId });
    expect(await t.run((ctx) => ctx.db.get(matchId))).toMatchObject({ hostRematch: false, guestRematch: false });

    expect(await t.mutation(api.matches.requestRematch, { playerId: hostId, matchId })).toEqual({ matchId: null });
    expect(await t.run((ctx) => ctx.db.query('matches').collect())).toHaveLength(1);
  });

  it('asking again after the rematch has ended opens no second rematch', async () => {
    const t = convexTest(schema, modules);
    const { matchId, hostId, guestId } = await seedFinishedMatch(t);
    await t.mutation(api.matches.requestRematch, { playerId: hostId, matchId });
    const { matchId: rematchId } = await t.mutation(api.matches.requestRematch, { playerId: guestId, matchId });
    await t.run((ctx) => ctx.db.patch(rematchId!, { status: 'abandoned' }));

    expect(await t.mutation(api.matches.requestRematch, { playerId: hostId, matchId })).toEqual({ matchId: null });
    expect(await t.run((ctx) => ctx.db.query('matches').collect())).toHaveLength(2);
  });

  it('a player already in another match cannot rematch', async () => {
    const t = convexTest(schema, modules);
    const { matchId, hostId } = await seedFinishedMatch(t);
    await t.mutation(api.privateMatch.createPrivate, { playerId: hostId });
    await expectConvexErrorAsync(
      t.mutation(api.matches.requestRematch, { playerId: hostId, matchId }),
      'ALREADY_IN_MATCH',
    );
  });

  it('heartbeat writes presence only', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const t = convexTest(schema, modules);
    const { matchId, hostId, guestId } = await seedPlayingMatch(t);
    const load = () => t.run((ctx) => ctx.db.get(matchId));
    const presenceOf = (id: Id<'matches'>) =>
      t.run(async (ctx) => (await ctx.db.query('presence').collect()).filter((p) => p.matchId === id));
    const before = await load();

    expect(await t.mutation(api.matches.heartbeat, { playerId: hostId, matchId })).toBeNull();
    expect(await presenceOf(matchId)).toMatchObject([{ matchId, role: 'host', lastSeen: 1_000_000 }]);

    vi.setSystemTime(1_005_000);
    await t.mutation(api.matches.heartbeat, { playerId: hostId, matchId });
    await t.mutation(api.matches.heartbeat, { playerId: guestId, matchId });
    const rows = await presenceOf(matchId);
    expect(rows).toHaveLength(2);
    expect(rows.find((p) => p.role === 'host')?.lastSeen).toBe(1_005_000);
    expect(rows.find((p) => p.role === 'guest')?.lastSeen).toBe(1_005_000);
    expect(await load()).toEqual(before);

    await expectConvexErrorAsync(
      t.mutation(api.matches.heartbeat, { playerId: crypto.randomUUID(), matchId }),
      'Not in this match',
    );
    await expectConvexErrorAsync(
      t.mutation(api.matches.heartbeat, { playerId: 'not-a-guid', matchId }),
      'Invalid player id',
    );
    expect(await presenceOf(matchId)).toHaveLength(2);

    const finished = await seedFinishedMatch(t);
    const finishedBefore = await t.run((ctx) => ctx.db.get(finished.matchId));
    await t.mutation(api.matches.heartbeat, { playerId: finished.hostId, matchId: finished.matchId });
    await t.mutation(api.matches.heartbeat, { playerId: finished.guestId, matchId: finished.matchId });
    expect(await presenceOf(finished.matchId)).toEqual([]);
    expect(await t.run((ctx) => ctx.db.get(finished.matchId))).toEqual(finishedBefore);
  });

  it('leave forfeits to the other role', async () => {
    const t = convexTest(schema, modules);
    const { matchId, hostId, guestId } = await seedPlayingMatch(t);
    const load = () => t.run((ctx) => ctx.db.get(matchId));

    await expectConvexErrorAsync(
      t.mutation(api.matches.leave, { playerId: crypto.randomUUID(), matchId }),
      'Not in this match',
    );
    await expectConvexErrorAsync(t.mutation(api.matches.leave, { playerId: 'not-a-guid', matchId }), 'Invalid player id');
    expect(await load()).toMatchObject({ status: 'playing' });

    expect(await t.mutation(api.matches.leave, { playerId: guestId, matchId })).toBeNull();
    const left = await load();
    expect(left).toMatchObject({ status: 'finished', winner: 'host', endReason: 'left' });

    expect(await t.mutation(api.matches.leave, { playerId: hostId, matchId })).toBeNull();
    expect(await load()).toEqual(left);

    const second = await seedPlayingMatch(t);
    await t.mutation(api.matches.leave, { playerId: second.hostId, matchId: second.matchId });
    expect(await t.run((ctx) => ctx.db.get(second.matchId))).toMatchObject({
      status: 'finished', winner: 'guest', endReason: 'left',
    });

    const byScore = await seedFinishedMatch(t);
    const byScoreBefore = await t.run((ctx) => ctx.db.get(byScore.matchId));
    await t.mutation(api.matches.leave, { playerId: byScore.guestId, matchId: byScore.matchId });
    expect(await t.run((ctx) => ctx.db.get(byScore.matchId))).toEqual(byScoreBefore);
  });

  it('reportLost with stale opponent wins', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const t = convexTest(schema, modules);
    const { matchId, hostId, guestId } = await seedPlayingMatch(t);
    await seedPresence(t, matchId, 'host', 1_000_000 - 20_000);
    await seedPresence(t, matchId, 'guest', 1_000_000);

    await expectConvexErrorAsync(
      t.mutation(api.matches.reportLost, { playerId: crypto.randomUUID(), matchId }),
      'Not in this match',
    );
    await expectConvexErrorAsync(
      t.mutation(api.matches.reportLost, { playerId: 'not-a-guid', matchId }),
      'Invalid player id',
    );
    expect(await t.run((ctx) => ctx.db.get(matchId))).toMatchObject({ status: 'playing' });

    expect(await t.mutation(api.matches.reportLost, { playerId: guestId, matchId })).toEqual({
      status: 'finished', winner: 'guest', endReason: 'timeout',
    });
    expect(await t.run((ctx) => ctx.db.get(matchId))).toMatchObject({
      status: 'finished', winner: 'guest', endReason: 'timeout',
    });
    expect(await t.mutation(api.matches.reportLost, { playerId: hostId, matchId })).toEqual({
      status: 'finished', winner: 'guest', endReason: 'timeout',
    });

    const silentGuest = await seedPlayingMatch(t);
    await seedPresence(t, silentGuest.matchId, 'host', 1_000_000 - 1_000);
    expect(
      await t.mutation(api.matches.reportLost, { playerId: silentGuest.hostId, matchId: silentGuest.matchId }),
    ).toEqual({ status: 'finished', winner: 'host', endReason: 'timeout' });
  });

  it('reportLost with both fresh abandons', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const t = convexTest(schema, modules);
    const { matchId, hostId, guestId } = await seedPlayingMatch(t);
    await seedPresence(t, matchId, 'host', 1_000_000 - 1_000);
    await seedPresence(t, matchId, 'guest', 1_000_000 - 1_000);
    const load = () => t.run((ctx) => ctx.db.get(matchId));

    const first = await t.mutation(api.matches.reportLost, { playerId: hostId, matchId });
    expect(first).toEqual({ status: 'abandoned', winner: null, endReason: 'connection' });
    const after = await load();
    expect(after).toMatchObject({ status: 'abandoned', endReason: 'connection' });
    expect(after?.winner).toBeUndefined();

    expect(await t.mutation(api.matches.reportLost, { playerId: guestId, matchId })).toEqual(first);
    expect(await load()).toEqual(after);

    const byScore = await seedFinishedMatch(t);
    const byScoreBefore = await t.run((ctx) => ctx.db.get(byScore.matchId));
    expect(
      await t.mutation(api.matches.reportLost, { playerId: byScore.guestId, matchId: byScore.matchId }),
    ).toEqual({ status: 'finished', winner: 'host', endReason: 'score' });
    expect(await t.run((ctx) => ctx.db.get(byScore.matchId))).toEqual(byScoreBefore);
  });

  it('leaving before play starts ends the match with no winner', async () => {
    const t = convexTest(schema, modules);
    const { matchId, hostId } = await seedPlayingMatch(t);
    await t.run((ctx) => ctx.db.patch(matchId, { status: 'connecting' }));
    await t.mutation(api.matches.leave, { playerId: hostId, matchId });
    const left = await t.run((ctx) => ctx.db.get(matchId));
    expect(left).toMatchObject({ status: 'abandoned', endReason: 'left' });
    expect(left?.winner).toBeUndefined();

    const owner = crypto.randomUUID();
    const { code } = await t.mutation(api.privateMatch.createPrivate, { playerId: owner });
    const waiting = await t.run((ctx) => ctx.db.query('matches').withIndex('by_code', (q) => q.eq('code', code)).unique());
    await t.mutation(api.matches.leave, { playerId: owner, matchId: waiting!._id });
    expect(await t.run((ctx) => ctx.db.get(waiting!._id))).toMatchObject({ status: 'abandoned', endReason: 'left' });
  });

  it('a waiting private code is kept alive by its host only', async () => {
    const t = convexTest(schema, modules);
    const owner = crypto.randomUUID();
    const { code } = await t.mutation(api.privateMatch.createPrivate, { playerId: owner });
    const match = await t.run((ctx) => ctx.db.query('matches').withIndex('by_code', (q) => q.eq('code', code)).unique());
    await t.mutation(api.matches.heartbeat, { playerId: owner, matchId: match!._id });
    const rows = await t.run((ctx) => ctx.db.query('presence').collect());
    expect(rows.map((r) => r.role)).toEqual(['host']);
  });

  it('an opponent exactly at the staleness limit still counts as present', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const t = convexTest(schema, modules);
    const { matchId, hostId } = await seedPlayingMatch(t);
    await seedPresence(t, matchId, 'guest', 1_000_000 - 15_000);
    expect(await t.mutation(api.matches.reportLost, { playerId: hostId, matchId })).toEqual({
      status: 'abandoned',
      winner: null,
      endReason: 'connection',
    });
  });
});
