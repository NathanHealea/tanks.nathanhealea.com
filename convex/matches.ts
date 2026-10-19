import { ConvexError, v } from 'convex/values';
import type { Doc, Id } from './_generated/dataModel';
import { mutation, query, type QueryCtx } from './_generated/server';
import { loadMatchAs, type Role } from './lib/access';
import { hasMatchSlot } from './lib/relayBudget';
import { activeMatchFor } from './matchmaking';

// Mirrors ROUNDS_TO_WIN in src/game/config.ts, which the browser uses; convex/ does not import from src/.
const ROUNDS_TO_WIN = 3;

/**
 * Records one finished round. Only the host reports, only the next round number counts, and the third win ends the
 * match. The host is trusted for the result itself: there is no independent check (an accepted epic risk).
 */
export const reportRound = mutation({
  args: {
    playerId: v.string(),
    matchId: v.id('matches'),
    round: v.number(),
    result: v.union(v.literal('host'), v.literal('guest'), v.null()),
  },
  handler: async (ctx, { playerId, matchId, round, result }) => {
    const { match, role } = await loadMatchAs(ctx, matchId, playerId);
    if (role !== 'host') throw new ConvexError('Only the host reports rounds');
    if (match.status !== 'playing') throw new ConvexError('Match is not playing');
    if (round !== match.round + 1) throw new ConvexError('Unexpected round');
    const hostScore = match.hostScore + (result === 'host' ? 1 : 0);
    const guestScore = match.guestScore + (result === 'guest' ? 1 : 0);
    const winner = hostScore >= ROUNDS_TO_WIN ? 'host' : guestScore >= ROUNDS_TO_WIN ? 'guest' : undefined;
    await ctx.db.patch(matchId, {
      round,
      hostScore,
      guestScore,
      ...(winner ? { status: 'finished' as const, winner, endReason: 'score' as const } : {}),
    });
    return null;
  },
});

/**
 * Both players must ask. The second request opens a new match between the same two with the host role swapped, so
 * the host's latency advantage alternates; any later call returns that same match.
 */
export const requestRematch = mutation({
  args: { playerId: v.string(), matchId: v.id('matches') },
  handler: async (ctx, { playerId, matchId }): Promise<{ matchId: Id<'matches'> | null }> => {
    const { match, role } = await loadMatchAs(ctx, matchId, playerId);
    if (match.status === 'abandoned' || (match.endReason !== undefined && match.endReason !== 'score')) {
      throw new ConvexError('OPPONENT_LEFT');
    }
    if (match.status !== 'finished') throw new ConvexError('Match is not finished');
    // An existing rematch is the caller's active match, so it is found without scanning the table by rematchOf.
    const active = await activeMatchFor(ctx, playerId);
    if (active?.rematchOf === matchId) return { matchId: active._id };
    if (active) throw new ConvexError('ALREADY_IN_MATCH');
    if (match.hostRematch && match.guestRematch) return { matchId: null };

    const flags = { hostRematch: match.hostRematch ?? false, guestRematch: match.guestRematch ?? false };
    if (role === 'host') flags.hostRematch = true;
    else flags.guestRematch = true;
    await ctx.db.patch(matchId, flags);
    if (!flags.hostRematch || !flags.guestRematch || match.guestId === undefined) return { matchId: null };
    // The first request may be stale: that player can have moved on to another match without withdrawing it.
    if (await activeMatchFor(ctx, role === 'host' ? match.guestId : match.hostId)) throw new ConvexError('OPPONENT_LEFT');
    if (!(await hasMatchSlot(ctx, Date.now()))) throw new ConvexError('BUSY');

    const now = Date.now();
    const rematchId = await ctx.db.insert('matches', {
      kind: match.kind,
      hostId: match.guestId,
      guestId: match.hostId,
      status: 'connecting',
      seed: Math.floor(Math.random() * 2 ** 32),
      round: 0,
      hostScore: 0,
      guestScore: 0,
      createdAt: now,
      hostSeen: now,
      guestSeen: now,
      rematchOf: matchId,
    });
    return { matchId: rematchId };
  },
});

/** Withdraws the caller's rematch request. Once both have asked, the rematch already exists and this changes nothing. */
export const cancelRematch = mutation({
  args: { playerId: v.string(), matchId: v.id('matches') },
  handler: async (ctx, { playerId, matchId }): Promise<null> => {
    const { match, role } = await loadMatchAs(ctx, matchId, playerId);
    if (match.hostRematch && match.guestRematch) return null;
    await ctx.db.patch(matchId, role === 'host' ? { hostRematch: false } : { guestRematch: false });
    return null;
  },
});

/** A player whose last heartbeat is older than this has gone (R4); the client reports silence after the same 15 s. */
export const PRESENCE_STALE_MS = 15_000;

type Outcome = { status: Doc<'matches'>['status']; winner: Role | null; endReason: Doc<'matches'>['endReason'] };

const other = (role: Role): Role => (role === 'host' ? 'guest' : 'host');
const outcomeOf = (match: Doc<'matches'>): Outcome => ({
  status: match.status,
  winner: match.winner ?? null,
  endReason: match.endReason,
});

async function presenceOf(ctx: Pick<QueryCtx, 'db'>, matchId: Id<'matches'>, role: Role) {
  return await ctx.db
    .query('presence')
    .withIndex('by_match', (q) => q.eq('matchId', matchId).eq('role', role))
    .unique();
}

/** Writes only the caller's presence row, so a beat does not re-run either player's myMatch. */
export const heartbeat = mutation({
  args: { playerId: v.string(), matchId: v.id('matches') },
  handler: async (ctx, { playerId, matchId }) => {
    const { match, role } = await loadMatchAs(ctx, matchId, playerId);
    // A waiting private code has only its host, whose beat shows the code is still being offered (R9).
    if (match.status !== 'waiting' && match.status !== 'connecting' && match.status !== 'playing') return null;
    const now = Date.now();
    const mine = await presenceOf(ctx, matchId, role);
    if (mine) await ctx.db.patch(mine._id, { lastSeen: now });
    else await ctx.db.insert('presence', { matchId, role, lastSeen: now });
    return null;
  },
});

/** Leaving a match in play hands the other player the win. Before play starts there is nothing to win. */
export const leave = mutation({
  args: { playerId: v.string(), matchId: v.id('matches') },
  handler: async (ctx, { playerId, matchId }) => {
    const { match, role } = await loadMatchAs(ctx, matchId, playerId);
    if (match.status === 'playing') {
      await ctx.db.patch(matchId, { status: 'finished', winner: other(role), endReason: 'left' });
    } else if (match.status === 'connecting' || match.status === 'waiting') {
      await ctx.db.patch(matchId, { status: 'abandoned', endReason: 'left' });
    }
    return null;
  },
});

/**
 * The caller's link went silent. Presence decides who is at fault: a stale opponent loses; if both are still
 * heartbeating, the link failed between two live players and nobody wins. Later reports return the first result.
 */
export const reportLost = mutation({
  args: { playerId: v.string(), matchId: v.id('matches') },
  handler: async (ctx, { playerId, matchId }): Promise<Outcome> => {
    const { match, role } = await loadMatchAs(ctx, matchId, playerId);
    if (match.status !== 'playing') return outcomeOf(match);
    const opponentRole = other(role);
    const opponent = await presenceOf(ctx, matchId, opponentRole);
    // Before their first beat lands, an opponent is as fresh as their arrival: a missing row is not a stale one.
    const arrived = (opponentRole === 'guest' ? match.guestSeen : match.hostSeen) ?? match.createdAt;
    const end: Partial<Doc<'matches'>> =
      Date.now() - (opponent?.lastSeen ?? arrived) > PRESENCE_STALE_MS
        ? { status: 'finished', winner: role, endReason: 'timeout' }
        : { status: 'abandoned', endReason: 'connection' };
    await ctx.db.patch(matchId, end);
    return outcomeOf({ ...match, ...end });
  },
});

/**
 * How a match ended, read once the server has taken it out of play. The client shows this rather than what the peer
 * said: a peer's bye is not proof that it forfeited.
 */
export const matchOutcome = query({
  args: { playerId: v.string(), matchId: v.id('matches') },
  handler: async (ctx, { playerId, matchId }) => {
    const { match } = await loadMatchAs(ctx, matchId, playerId);
    return { ...outcomeOf(match), hostScore: match.hostScore, guestScore: match.guestScore };
  },
});
