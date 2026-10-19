import { ConvexError, v } from 'convex/values';
import type { Doc } from './_generated/dataModel';
import { mutation, query, type MutationCtx, type QueryCtx } from './_generated/server';
import { takeMatchSlot } from './lib/relayBudget';
import { requirePlayerId, toMatchView, type MatchView } from './lib/access';

/** A queue entry with no heartbeat for this long is treated as a closed tab and never paired. */
export const QUEUE_STALE_MS = 30_000;
/** A match still connecting this long after its guest arrived is dead; its players may search again. */
export const CONNECT_TIMEOUT_MS = 60_000;
// The pairing scan reads the queue head in pages and deletes stale entries it meets, so abandoned tabs cannot pile up
// at the head and block pairing for everyone. Bounded per call: at most PAIRING_PAGES * PAIRING_SCAN rows.
const PAIRING_SCAN = 20;
const PAIRING_PAGES = 5;

const ACTIVE: Doc<'matches'>['status'][] = ['waiting', 'connecting', 'playing'];

type QueueResult = { status: 'queued' | 'matched'; full: boolean };

/**
 * Pairs the caller with the oldest live waiting player, or queues them. Convex runs mutations as serializable
 * transactions that retry on conflict, so two simultaneous joiners cannot both take the same waiting player.
 */
export const joinQueue = mutation({
  args: { playerId: v.string() },
  handler: async (ctx, { playerId }): Promise<QueueResult> => {
    requirePlayerId(playerId);
    const now = Date.now();
    const active = await activeMatchFor(ctx, playerId);
    // A host holding a private code is waiting for a friend, not an opponent; quick match must not wait on that.
    if (active?.kind === 'private' && active.status === 'waiting') throw new ConvexError('ALREADY_IN_MATCH');
    if (active) return { status: 'matched', full: false };

    const mine = await queueEntry(ctx, playerId);
    if (mine) await ctx.db.patch(mine._id, { lastSeen: now });
    return await pairFromQueue(ctx, playerId, mine, now);
  },
});

/**
 * Pairs with the oldest live other player, or leaves the caller queued: with no one to pair, or when the hour's
 * match starts are used up (full), in which case the next heartbeat tries again.
 */
async function pairFromQueue(ctx: MutationCtx, playerId: string, mine: Doc<'queue'> | null, now: number): Promise<QueueResult> {
  let partner: Doc<'queue'> | undefined;
  for (let page = 0; page < PAIRING_PAGES && !partner; page++) {
    const head = await ctx.db.query('queue').withIndex('by_joined').take(PAIRING_SCAN);
    const isLive = (e: Doc<'queue'>) => now - e.lastSeen <= QUEUE_STALE_MS;
    const stale = head.filter((e) => !isLive(e) && e.playerId !== playerId);
    partner = head.find((e) => e.playerId !== playerId && isLive(e));
    for (const e of stale) await ctx.db.delete(e._id);
    if (stale.length === 0) break;
  }
  const full = partner !== undefined && !(await takeMatchSlot(ctx, now));
  if (!partner || full) {
    if (!mine) await ctx.db.insert('queue', { playerId, joinedAt: now, lastSeen: now });
    return { status: 'queued', full };
  }

  await ctx.db.delete(partner._id);
  if (mine) await ctx.db.delete(mine._id);
  const partnerFirst = partner.joinedAt <= (mine?.joinedAt ?? now);
  await ctx.db.insert('matches', {
    kind: 'quick',
    hostId: partnerFirst ? partner.playerId : playerId,
    guestId: partnerFirst ? playerId : partner.playerId,
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
  return { status: 'matched', full: false };
}

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
    ACTIVE.includes(m.status) &&
    // Timed from the guest's arrival, not creation: a private code can wait minutes before anyone joins.
    !(m.status === 'connecting' && now - (m.guestSeen ?? m.createdAt) > CONNECT_TIMEOUT_MS) &&
    !(m.status === 'waiting' && m.expiresAt !== undefined && now > m.expiresAt);
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

/** Keeps the caller's queue entry live, and pairs it if it can, so a player waiting on a full hour is matched once a slot opens. */
export const queueHeartbeat = mutation({
  args: { playerId: v.string() },
  handler: async (ctx, { playerId }): Promise<QueueResult> => {
    requirePlayerId(playerId);
    const now = Date.now();
    if (await activeMatchFor(ctx, playerId)) return { status: 'matched', full: false };
    const mine = await queueEntry(ctx, playerId);
    if (!mine) return { status: 'queued', full: false };
    await ctx.db.patch(mine._id, { lastSeen: now });
    return await pairFromQueue(ctx, playerId, mine, now);
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

export function queueEntry(ctx: Pick<QueryCtx, 'db'>, playerId: string) {
  return ctx.db
    .query('queue')
    .withIndex('by_player', (q) => q.eq('playerId', playerId))
    .unique();
}
