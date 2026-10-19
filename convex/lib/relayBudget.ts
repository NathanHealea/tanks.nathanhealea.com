import type { MutationCtx } from '../_generated/server';

/**
 * Match starts allowed per hour, so relay traffic stays inside Cloudflare's free 1,000 GB a month (turn-relay R7).
 * Estimate, not measured: ~60 KB/s per player over a ~6-minute match is ~22 MB a player, ~640 GB a month at this cap.
 */
export const MATCHES_PER_HOUR = 20;

const HOUR_MS = 3_600_000;

export const hourOf = (now: number) => Math.floor(now / HOUR_MS);

async function startsThisHour(ctx: Pick<MutationCtx, 'db'>, now: number) {
  return await ctx.db
    .query('relayBudget')
    .withIndex('by_hour', (q) => q.eq('hour', hourOf(now)))
    .unique();
}

/** Whether the current hour has a match start left; reads one row, so it is cheap to check before any other work. */
export async function hasMatchSlot(ctx: Pick<MutationCtx, 'db'>, now: number): Promise<boolean> {
  return ((await startsThisHour(ctx, now))?.matches ?? 0) < MATCHES_PER_HOUR;
}

/**
 * Counts a match that has connected. Starts are counted here, not when players are paired, so throwaway ids pairing
 * without connecting cannot use up the hour; a burst of pairs made just under the cap may take it slightly over.
 */
export async function recordMatchStart(ctx: Pick<MutationCtx, 'db'>, now: number): Promise<void> {
  const row = await startsThisHour(ctx, now);
  if (row) await ctx.db.patch(row._id, { matches: row.matches + 1 });
  else await ctx.db.insert('relayBudget', { hour: hourOf(now), matches: 1 });
}
