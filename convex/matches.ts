import { ConvexError, v } from 'convex/values';
import { mutation } from './_generated/server';
import { loadMatchAs } from './lib/access';

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
