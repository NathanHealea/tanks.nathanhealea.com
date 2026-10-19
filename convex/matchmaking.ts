import { v } from 'convex/values';
import type { Doc } from './_generated/dataModel';
import { mutation, query, type QueryCtx } from './_generated/server';
import { requirePlayerId, toMatchView, type MatchView } from './lib/access';

/** A queue entry with no heartbeat for this long is treated as a closed tab and never paired. */
export const QUEUE_STALE_MS = 30_000;
// Bounds the pairing scan; stale rows beyond this wait for the sweep (disconnect-and-cleanup) instead of slowing joins.
const PAIRING_SCAN = 20;

const ACTIVE: Doc<'matches'>['status'][] = ['waiting', 'connecting', 'playing'];

/**
 * Pairs the caller with the oldest live waiting player, or queues them. Convex runs mutations as serializable
 * transactions that retry on conflict, so two simultaneous joiners cannot both take the same waiting player.
 */
export const joinQueue = mutation({
  args: { playerId: v.string() },
  handler: async (ctx, { playerId }): Promise<{ status: 'queued' | 'matched' }> => {
    requirePlayerId(playerId);
    const now = Date.now();
    if (await activeMatchFor(ctx, playerId)) return { status: 'matched' };

    const mine = await ctx.db
      .query('queue')
      .withIndex('by_player', (q) => q.eq('playerId', playerId))
      .unique();
    if (mine) {
      await ctx.db.patch(mine._id, { lastSeen: now });
      return { status: 'queued' };
    }

    const oldest = await ctx.db.query('queue').withIndex('by_joined').take(PAIRING_SCAN);
    const partner = oldest.find((e) => e.playerId !== playerId && now - e.lastSeen <= QUEUE_STALE_MS);
    if (!partner) {
      await ctx.db.insert('queue', { playerId, joinedAt: now, lastSeen: now });
      return { status: 'queued' };
    }

    await ctx.db.delete(partner._id);
    await ctx.db.insert('matches', {
      kind: 'quick',
      hostId: partner.playerId,
      guestId: playerId,
      status: 'connecting',
      // Convex seeds Math.random per call, so a retried transaction draws the same seed.
      seed: Math.floor(Math.random() * 2 ** 32),
      round: 0,
      hostScore: 0,
      guestScore: 0,
      createdAt: now,
      hostSeen: now,
      guestSeen: now,
    });
    return { status: 'matched' };
  },
});

export async function activeMatchFor(ctx: Pick<QueryCtx, 'db'>, playerId: string): Promise<Doc<'matches'> | null> {
  const asHost = await ctx.db
    .query('matches')
    .withIndex('by_host', (q) => q.eq('hostId', playerId))
    .collect();
  const asGuest = await ctx.db
    .query('matches')
    .withIndex('by_guest', (q) => q.eq('guestId', playerId))
    .collect();
  return [...asHost, ...asGuest].find((m) => ACTIVE.includes(m.status)) ?? null;
}

export const leaveQueue = mutation({
  args: { playerId: v.string() },
  handler: async (ctx, { playerId }) => {
    requirePlayerId(playerId);
    const mine = await queueEntry(ctx, playerId);
    if (mine) await ctx.db.delete(mine._id);
    return null;
  },
});

export const queueHeartbeat = mutation({
  args: { playerId: v.string() },
  handler: async (ctx, { playerId }) => {
    requirePlayerId(playerId);
    const mine = await queueEntry(ctx, playerId);
    if (mine) await ctx.db.patch(mine._id, { lastSeen: Date.now() });
    return null;
  },
});

/** The caller's active match as a client may see it, or null. Re-runs for the client whenever the match changes. */
export const myMatch = query({
  args: { playerId: v.string() },
  handler: async (ctx, { playerId }): Promise<MatchView | null> => {
    requirePlayerId(playerId);
    const match = await activeMatchFor(ctx, playerId);
    return match ? toMatchView(match, playerId) : null;
  },
});

function queueEntry(ctx: Pick<QueryCtx, 'db'>, playerId: string) {
  return ctx.db
    .query('queue')
    .withIndex('by_player', (q) => q.eq('playerId', playerId))
    .unique();
}
