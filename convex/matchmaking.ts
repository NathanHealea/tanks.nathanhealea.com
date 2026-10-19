import { v } from 'convex/values';
import type { Doc } from './_generated/dataModel';
import { mutation, query, type QueryCtx } from './_generated/server';
import { requirePlayerId, toMatchView, type MatchView } from './lib/access';

/** A queue entry with no heartbeat for this long is treated as a closed tab and never paired. */
export const QUEUE_STALE_MS = 30_000;
/** A quick match nobody has connected within this long is dead; its players may search again. */
export const CONNECT_TIMEOUT_MS = 60_000;
// The pairing scan reads the queue head in pages and deletes stale entries it meets, so abandoned tabs cannot pile up
// at the head and block pairing for everyone. Bounded per call: at most PAIRING_PAGES * PAIRING_SCAN rows.
const PAIRING_SCAN = 20;
const PAIRING_PAGES = 5;

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

    const mine = await queueEntry(ctx, playerId);
    if (mine) {
      await ctx.db.patch(mine._id, { lastSeen: now });
      return { status: 'queued' };
    }

    let partner: Doc<'queue'> | undefined;
    for (let page = 0; page < PAIRING_PAGES && !partner; page++) {
      const head = await ctx.db.query('queue').withIndex('by_joined').take(PAIRING_SCAN);
      const isLive = (e: Doc<'queue'>) => now - e.lastSeen <= QUEUE_STALE_MS;
      const stale = head.filter((e) => !isLive(e));
      partner = head.find((e) => e.playerId !== playerId && isLive(e));
      for (const e of stale) await ctx.db.delete(e._id);
      if (stale.length === 0) break;
    }
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
  const now = Date.now();
  const live = (m: Doc<'matches'>) =>
    ACTIVE.includes(m.status) && !(m.status === 'connecting' && now - m.createdAt > CONNECT_TIMEOUT_MS);
  return [...asHost, ...asGuest].find(live) ?? null;
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
