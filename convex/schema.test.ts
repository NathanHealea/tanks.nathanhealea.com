/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { describe, expect, it } from 'vitest';
import schema from './schema';

const modules = import.meta.glob('./**/*.*s');

describe('schema', () => {
  it('schema accepts each table', async () => {
    const t = convexTest(schema, modules);

    const { queued, match, signal } = await t.run(async (ctx) => {
      await ctx.db.insert('queue', { playerId: 'player-a', joinedAt: 1000, lastSeen: 1500 });
      const matchId = await ctx.db.insert('matches', {
        kind: 'private',
        code: 'ABCD',
        expiresAt: 9000,
        hostId: 'player-a',
        guestId: 'player-b',
        status: 'waiting',
        seed: 42,
        round: 1,
        hostScore: 0,
        guestScore: 0,
        createdAt: 1000,
        hostSeen: 1000,
      });
      await ctx.db.insert('signals', {
        matchId,
        to: 'guest',
        kind: 'offer',
        payload: '{"sdp":"v=0"}',
        createdAt: 1100,
      });
      const byIndex = {
        by_joined: await ctx.db.query('queue').withIndex('by_joined', (q) => q.eq('joinedAt', 1000)).unique(),
        by_host: await ctx.db.query('matches').withIndex('by_host', (q) => q.eq('hostId', 'player-a')).unique(),
        by_guest: await ctx.db.query('matches').withIndex('by_guest', (q) => q.eq('guestId', 'player-b')).unique(),
        by_status: await ctx.db
          .query('matches')
          .withIndex('by_status', (q) => q.eq('status', 'waiting').eq('createdAt', 1000))
          .unique(),
      };
      for (const [index, row] of Object.entries(byIndex)) expect(row, index).not.toBeNull();
      return {
        queued: await ctx.db
          .query('queue')
          .withIndex('by_player', (q) => q.eq('playerId', 'player-a'))
          .unique(),
        match: await ctx.db
          .query('matches')
          .withIndex('by_code', (q) => q.eq('code', 'ABCD'))
          .unique(),
        signal: await ctx.db
          .query('signals')
          .withIndex('by_match_to', (q) => q.eq('matchId', matchId).eq('to', 'guest'))
          .unique(),
      };
    });

    expect(queued).toMatchObject({ playerId: 'player-a', joinedAt: 1000, lastSeen: 1500 });
    expect(match).toMatchObject({ kind: 'private', code: 'ABCD', hostId: 'player-a', status: 'waiting', seed: 42 });
    expect(signal).toMatchObject({ matchId: match?._id, to: 'guest', kind: 'offer', payload: '{"sdp":"v=0"}' });
  });

  it('schema rejects bad rows', async () => {
    const t = convexTest(schema, modules);

    await expect(
      t.run(async (ctx) => {
        await ctx.db.insert('matches', {
          kind: 'quick',
          hostId: 'player-a',
          status: 'paused' as 'waiting',
          seed: 7,
          round: 1,
          hostScore: 0,
          guestScore: 0,
          createdAt: 1000,
          hostSeen: 1000,
        });
      }),
    ).rejects.toThrow();
  });

  const validMatch = {
    kind: 'quick' as const,
    hostId: 'player-a',
    status: 'waiting' as const,
    seed: 7,
    round: 1,
    hostScore: 0,
    guestScore: 0,
    createdAt: 1000,
    hostSeen: 1000,
  };

  it.each([
    ['an unknown kind', { kind: 'ranked' }],
    ['an unknown winner', { winner: 'spectator' }],
    ['an unknown end reason', { endReason: 'rage-quit' }],
    ['no host', { hostId: undefined }],
    ['no seed', { seed: undefined }],
  ])('schema rejects a match with %s', async (_label, change) => {
    const t = convexTest(schema, modules);
    const row = { ...validMatch, ...change } as unknown as typeof validMatch;
    await expect(t.run((ctx) => ctx.db.insert('matches', row))).rejects.toThrow();
  });

  it.each(['waiting', 'connecting', 'playing', 'finished', 'abandoned'] as const)('schema accepts a %s match', async (status) => {
    const t = convexTest(schema, modules);
    await expect(t.run((ctx) => ctx.db.insert('matches', { ...validMatch, status }))).resolves.toBeDefined();
  });

  it('schema accepts the valid match those cases start from', async () => {
    const t = convexTest(schema, modules);
    await expect(t.run((ctx) => ctx.db.insert('matches', validMatch))).resolves.toBeDefined();
  });

  it('schema rejects a queue row with no lastSeen', async () => {
    const t = convexTest(schema, modules);
    const row = { playerId: 'player-a', joinedAt: 1000 } as unknown as { playerId: string; joinedAt: number; lastSeen: number };
    await expect(t.run((ctx) => ctx.db.insert('queue', row))).rejects.toThrow();
  });

  it.each([
    ['an unknown recipient', { to: 'spectator' }],
    ['an unknown kind', { kind: 'chat' }],
    ['a match id that is not an id', { matchId: 'not-an-id' }],
  ])('schema rejects a signal with %s', async (_label, change) => {
    const t = convexTest(schema, modules);
    await expect(
      t.run(async (ctx) => {
        const matchId = await ctx.db.insert('matches', validMatch);
        const row = { matchId, to: 'guest', kind: 'offer', payload: '{}', createdAt: 1000, ...change };
        await ctx.db.insert('signals', row as unknown as { matchId: typeof matchId; to: 'guest'; kind: 'offer'; payload: string; createdAt: number });
      }),
    ).rejects.toThrow();
  });
});
