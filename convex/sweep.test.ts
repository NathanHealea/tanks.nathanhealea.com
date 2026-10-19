/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { internal } from './_generated/api';
import type { Doc, Id, TableNames } from './_generated/dataModel';
import schema from './schema';

const modules = import.meta.glob('./**/*.*s');

const NOW = 1_800_000_000_000;
const SEC = 1000;
const MIN = 60 * SEC;
const HOUR = 60 * MIN;

type Tester = ReturnType<typeof convexTest>;
type MatchFields = Omit<Doc<'matches'>, '_id' | '_creationTime'>;

async function seedMatch(t: Tester, over: Partial<MatchFields> & Pick<MatchFields, 'status' | 'createdAt'>) {
  return t.run((ctx) =>
    ctx.db.insert('matches', {
      kind: 'quick', hostId: crypto.randomUUID(), seed: 7, round: 0, hostScore: 0, guestScore: 0,
      hostSeen: over.createdAt, ...over,
    }),
  );
}

async function seedPresence(t: Tester, matchId: Id<'matches'>, role: 'host' | 'guest', lastSeen: number) {
  return t.run((ctx) => ctx.db.insert('presence', { matchId, role, lastSeen }));
}

async function seedSignal(t: Tester, matchId: Id<'matches'>) {
  return t.run((ctx) =>
    ctx.db.insert('signals', { matchId, to: 'guest', kind: 'offer', payload: 'synthetic-sdp', createdAt: NOW - 5 * SEC }),
  );
}

async function seedQueue(t: Tester, joinedAt: number, lastSeen: number) {
  return t.run((ctx) => ctx.db.insert('queue', { playerId: crypto.randomUUID(), joinedAt, lastSeen }));
}

async function snapshot(t: Tester) {
  return t.run(async (ctx) => ({
    queue: await ctx.db.query('queue').collect(),
    matches: await ctx.db.query('matches').collect(),
    presence: await ctx.db.query('presence').collect(),
    signals: await ctx.db.query('signals').collect(),
  }));
}

describe('sweep', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('sweep clears each kind of stale data', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const t = convexTest(schema, modules);
    const get = (id: Id<TableNames>) => t.run((ctx) => ctx.db.get(id));
    const getMatch = (id: Id<'matches'>) => t.run((ctx) => ctx.db.get(id));

    const staleQueue = await seedQueue(t, NOW - 61 * SEC, NOW - 61 * SEC);
    const freshQueue = await seedQueue(t, NOW - 10 * MIN, NOW - 10 * SEC);

    const waitExpired = await seedMatch(t, {
      kind: 'private', code: 'AAAAAA', status: 'waiting', createdAt: NOW - 11 * MIN, expiresAt: NOW - SEC,
    });
    await seedPresence(t, waitExpired, 'host', NOW - 5 * SEC);
    const waitLive = await seedMatch(t, {
      kind: 'private', code: 'BBBBBB', status: 'waiting', createdAt: NOW - 5 * MIN, expiresAt: NOW + 5 * MIN,
    });
    const waitLivePresence = await seedPresence(t, waitLive, 'host', NOW - 5 * SEC);

    const waitHostGone = await seedMatch(t, {
      kind: 'private', code: 'CCCCCC', status: 'waiting', createdAt: NOW - 8 * MIN, expiresAt: NOW + 2 * MIN,
    });
    // A waiting host gets five minutes, not one: sharing the code means switching to another app.
    await seedPresence(t, waitHostGone, 'host', NOW - 5 * MIN - SEC);
    const waitNoPresenceOld = await seedMatch(t, {
      kind: 'private', code: 'DDDDDD', status: 'waiting', createdAt: NOW - 5 * MIN - SEC, expiresAt: NOW + 4 * MIN,
    });
    const waitNoPresenceNew = await seedMatch(t, {
      kind: 'private', code: 'EEEEEE', status: 'waiting', createdAt: NOW - 4 * MIN, expiresAt: NOW + 6 * MIN,
    });

    const connNoGuestOld = await seedMatch(t, {
      guestId: crypto.randomUUID(), status: 'connecting', createdAt: NOW - 61 * SEC,
    });
    const connGuestStale = await seedMatch(t, {
      kind: 'private', code: 'FFFFFF', guestId: crypto.randomUUID(), status: 'connecting',
      createdAt: NOW - 10 * MIN, guestSeen: NOW - 61 * SEC,
    });
    const connLive = await seedMatch(t, {
      kind: 'private', code: 'GGGGGG', guestId: crypto.randomUUID(), status: 'connecting',
      createdAt: NOW - 10 * MIN, guestSeen: NOW - 20 * SEC,
    });
    const connLiveSignal = await seedSignal(t, connLive);

    const playAllStale = await seedMatch(t, { guestId: crypto.randomUUID(), status: 'playing', createdAt: NOW - 5 * MIN });
    await seedPresence(t, playAllStale, 'host', NOW - 61 * SEC);
    await seedPresence(t, playAllStale, 'guest', NOW - 90 * SEC);
    const playNoPresenceOld = await seedMatch(t, {
      guestId: crypto.randomUUID(), status: 'playing', createdAt: NOW - 61 * SEC,
    });
    const playHalfFresh = await seedMatch(t, { guestId: crypto.randomUUID(), status: 'playing', createdAt: NOW - 5 * MIN });
    const playHalfHost = await seedPresence(t, playHalfFresh, 'host', NOW - 5 * SEC);
    const playHalfGuest = await seedPresence(t, playHalfFresh, 'guest', NOW - 61 * SEC);
    const playBothFresh = await seedMatch(t, { guestId: crypto.randomUUID(), status: 'playing', createdAt: NOW - 5 * MIN });
    const playBothHost = await seedPresence(t, playBothFresh, 'host', NOW - 5 * SEC);
    const playBothGuest = await seedPresence(t, playBothFresh, 'guest', NOW - 5 * SEC);

    const finishedRecent = await seedMatch(t, {
      guestId: crypto.randomUUID(), status: 'finished', winner: 'host', endReason: 'score', createdAt: NOW - 10 * MIN,
    });
    const finishedRecentSignal = await seedSignal(t, finishedRecent);
    const playingSignal = await seedSignal(t, playBothFresh);
    const goneMatch = await seedMatch(t, { status: 'finished', createdAt: NOW - 10 * MIN });
    const orphanSignal = await seedSignal(t, goneMatch);
    await t.run((ctx) => ctx.db.delete(goneMatch));

    const finishedOld = await seedMatch(t, {
      guestId: crypto.randomUUID(), status: 'finished', winner: 'guest', endReason: 'score', createdAt: NOW - 25 * HOUR,
    });
    const finishedOldHost = await seedPresence(t, finishedOld, 'host', NOW - 25 * HOUR);
    const finishedOldGuest = await seedPresence(t, finishedOld, 'guest', NOW - 25 * HOUR);
    const abandonedOld = await seedMatch(t, {
      guestId: crypto.randomUUID(), status: 'abandoned', endReason: 'connection', createdAt: NOW - 25 * HOUR,
    });
    const abandonedOldHost = await seedPresence(t, abandonedOld, 'host', NOW - 25 * HOUR);
    const finished23h = await seedMatch(t, {
      guestId: crypto.randomUUID(), status: 'finished', winner: 'host', endReason: 'score', createdAt: NOW - 23 * HOUR,
    });
    const finished23hPresence = await seedPresence(t, finished23h, 'host', NOW - 23 * HOUR);
    const abandoned1h = await seedMatch(t, {
      guestId: crypto.randomUUID(), status: 'abandoned', endReason: 'timeout', createdAt: NOW - HOUR,
    });
    const abandoned1hPresence = await seedPresence(t, abandoned1h, 'guest', NOW - HOUR);

    const controls = [
      freshQueue, waitLive, waitLivePresence, waitNoPresenceNew, connLive, connLiveSignal,
      playHalfFresh, playHalfHost, playHalfGuest, playBothFresh, playBothHost, playBothGuest, finishedRecent,
      finished23h, finished23hPresence, abandoned1h, abandoned1hPresence,
    ] as const;
    const controlsBefore = await Promise.all(controls.map((id) => get(id)));

    await t.mutation(internal.sweep.sweep, {});

    expect(await get(staleQueue)).toBeNull();

    for (const id of [waitExpired, waitHostGone, waitNoPresenceOld]) {
      expect(await get(id)).toMatchObject({ status: 'abandoned' });
      expect((await getMatch(id))?.winner).toBeUndefined();
    }
    for (const id of [connNoGuestOld, connGuestStale]) {
      expect(await get(id)).toMatchObject({ status: 'abandoned', endReason: 'connection' });
      expect((await getMatch(id))?.winner).toBeUndefined();
    }
    for (const id of [playAllStale, playNoPresenceOld]) {
      expect(await get(id)).toMatchObject({ status: 'abandoned', endReason: 'timeout' });
      expect((await getMatch(id))?.winner).toBeUndefined();
    }

    expect(await get(finishedRecentSignal)).toBeNull();
    expect(await get(playingSignal)).toBeNull();
    expect(await get(orphanSignal)).toBeNull();

    expect(await get(finishedOld)).toBeNull();
    expect(await get(abandonedOld)).toBeNull();
    expect(await get(finishedOldHost)).toBeNull();
    expect(await get(finishedOldGuest)).toBeNull();
    expect(await get(abandonedOldHost)).toBeNull();

    expect(await Promise.all(controls.map((id) => get(id)))).toEqual(controlsBefore);
    expect(await get(finishedRecent)).not.toBeNull();

    const afterFirst = await snapshot(t);
    await t.mutation(internal.sweep.sweep, {});
    expect(await snapshot(t)).toEqual(afterFirst);
  });

  it('sweep caps work per run', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      for (let i = 0; i < 600; i++) {
        await ctx.db.insert('queue', { playerId: crypto.randomUUID(), joinedAt: NOW - 2 * MIN, lastSeen: NOW - 61 * SEC });
      }
    });
    const fresh = await seedQueue(t, NOW - 2 * MIN, NOW - 10 * SEC);
    const freshBefore = await t.run((ctx) => ctx.db.get(fresh));
    const staleCount = () =>
      t.run(async (ctx) => (await ctx.db.query('queue').collect()).filter((q) => q._id !== fresh).length);

    await t.mutation(internal.sweep.sweep, {});
    expect(await staleCount()).toBe(100);
    expect(await t.run((ctx) => ctx.db.get(fresh))).toEqual(freshBefore);

    await t.mutation(internal.sweep.sweep, {});
    expect(await staleCount()).toBe(0);
    expect(await t.run((ctx) => ctx.db.get(fresh))).toEqual(freshBefore);
  });

  it('nothing quiet for under a minute is touched', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const t = convexTest(schema, modules);
    const quiet = NOW - 45 * SEC;
    await seedQueue(t, NOW - 10 * MIN, quiet);
    const waiting = await seedMatch(t, { status: 'waiting', createdAt: NOW - 5 * MIN, expiresAt: NOW + 5 * MIN });
    await seedPresence(t, waiting, 'host', quiet);
    await seedMatch(t, { status: 'connecting', createdAt: NOW - 10 * MIN, guestSeen: quiet });
    const playing = await seedMatch(t, { status: 'playing', createdAt: NOW - 10 * MIN });
    await seedPresence(t, playing, 'host', quiet);
    await seedPresence(t, playing, 'guest', quiet);
    const before = await snapshot(t);

    await t.mutation(internal.sweep.sweep, {});
    expect(await snapshot(t)).toEqual(before);
  });

  it('a waiting host who keeps beating holds the code past five minutes', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const t = convexTest(schema, modules);
    const waiting = await seedMatch(t, {
      kind: 'private', code: 'HHHHHH', status: 'waiting', createdAt: NOW - 8 * MIN, expiresAt: NOW + 2 * MIN,
    });
    await seedPresence(t, waiting, 'host', NOW - 5 * MIN + 10 * SEC);
    const before = await snapshot(t);

    await t.mutation(internal.sweep.sweep, {});
    expect(await snapshot(t)).toEqual(before);
  });

  it('TURN grants go with their match', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const t = convexTest(schema, modules);
    const old = await seedMatch(t, { status: 'finished', createdAt: NOW - 25 * HOUR, winner: 'host', endReason: 'score' });
    const recent = await seedMatch(t, { status: 'finished', createdAt: NOW - HOUR, winner: 'host', endReason: 'score' });
    for (const matchId of [old, recent]) {
      await t.run((ctx) => ctx.db.insert('turnGrants', { matchId, role: 'host', count: 1 }));
    }
    await t.mutation(internal.sweep.sweep, {});
    const grants = await t.run((ctx) => ctx.db.query('turnGrants').collect());
    expect(grants.map((g) => g.matchId)).toEqual([recent]);
  });
});
