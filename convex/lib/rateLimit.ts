import { ConvexError } from 'convex/values';
import type { MutationCtx } from '../_generated/server';

/**
 * Calls that can create queue entries or matches, across the whole site, per minute (pvp-deploy-docs R6). Players have
 * no identity to limit one by one, so this caps what one script minting ids in a loop can add to the tables.
 */
export const MATCHMAKING_CALLS_PER_MINUTE = 120;

const MINUTE_MS = 60_000;

export const minuteOf = (now: number) => Math.floor(now / MINUTE_MS);

/** Counts one matchmaking call; over the limit it throws, and the caller's mutation rolls back with nothing written. */
export async function countMatchmakingCall(ctx: Pick<MutationCtx, 'db'>, now: number): Promise<void> {
  const minute = minuteOf(now);
  const row = await ctx.db
    .query('rateLimit')
    .withIndex('by_minute', (q) => q.eq('minute', minute))
    .unique();
  if ((row?.calls ?? 0) >= MATCHMAKING_CALLS_PER_MINUTE) throw new ConvexError('RATE_LIMITED');
  if (row) await ctx.db.patch(row._id, { calls: row.calls + 1 });
  else await ctx.db.insert('rateLimit', { minute, calls: 1 });
}
