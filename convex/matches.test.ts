/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { ConvexError } from 'convex/values';
import { describe, expect, it } from 'vitest';
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

describe('matches', () => {
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
});
