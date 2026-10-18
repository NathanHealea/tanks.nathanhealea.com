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
});
