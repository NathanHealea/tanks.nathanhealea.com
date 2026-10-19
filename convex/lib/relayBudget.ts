import type { MutationCtx } from '../_generated/server';

/**
 * Match starts allowed per hour, so relay traffic stays inside Cloudflare's free 1,000 GB a month (turn-relay R7).
 * Estimate, not measured: ~60 KB/s per player over a ~6-minute match is ~22 MB a player, ~640 GB a month at this cap.
 */
export const MATCHES_PER_HOUR = 20;

const HOUR_MS = 3_600_000;

export const hourOf = (now: number) => Math.floor(now / HOUR_MS);

/** Takes one match start from the current hour; false, with nothing written, when the hour is used up. */
export async function takeMatchSlot(ctx: Pick<MutationCtx, 'db'>, now: number): Promise<boolean> {
  const hour = hourOf(now);
  const row = await ctx.db
    .query('relayBudget')
    .withIndex('by_hour', (q) => q.eq('hour', hour))
    .unique();
  if ((row?.matches ?? 0) >= MATCHES_PER_HOUR) return false;
  if (row) await ctx.db.patch(row._id, { matches: row.matches + 1 });
  else await ctx.db.insert('relayBudget', { hour, matches: 1 });
  return true;
}
