import type { Doc } from './_generated/dataModel';
import { internalMutation, type MutationCtx } from './_generated/server';

/** Rows each rule handles per run; anything left waits a minute for the next run (R7). */
export const SWEEP_BATCH = 500;
/** A queue entry or player not heard from for this long has gone. */
export const IDLE_MS = 60_000;
/**
 * A waiting host is given longer: sharing the code means switching to another app, where the browser throttles or
 * suspends the page's heartbeat. A closed tab is caught sooner by its pagehide leave.
 */
export const WAITING_IDLE_MS = 5 * 60_000;
/** Finished matches hold only random ids, roles and scores, and still go after a day, with everything kept per match. */
export const RETENTION_MS = 24 * 60 * 60 * 1000;

/**
 * Runs every minute (crons.ts). Each rule reads its own bounded slice, oldest first, so one run stays far inside
 * Convex's mutation limits however much has piled up. Live rows are never touched: every rule checks recency
 * before writing.
 */
export const sweep = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    await dropIdleQueue(ctx, now);
    await abandonDeadWaiting(ctx, now);
    await abandonStalledConnecting(ctx, now);
    await abandonSilentPlaying(ctx, now);
    await deleteLeftoverSignals(ctx);
    await deleteOldMatches(ctx, now, 'finished');
    await deleteOldMatches(ctx, now, 'abandoned');
    return null;
  },
});

async function dropIdleQueue(ctx: MutationCtx, now: number) {
  const idle = await ctx.db
    .query('queue')
    .withIndex('by_seen', (q) => q.lt('lastSeen', now - IDLE_MS))
    .take(SWEEP_BATCH);
  for (const entry of idle) await ctx.db.delete(entry._id);
}

function oldestWith(ctx: MutationCtx, status: Doc<'matches'>['status']) {
  return ctx.db
    .query('matches')
    .withIndex('by_status', (q) => q.eq('status', status))
    .take(SWEEP_BATCH);
}

async function presenceRows(ctx: MutationCtx, match: Doc<'matches'>) {
  return await ctx.db
    .query('presence')
    .withIndex('by_match', (q) => q.eq('matchId', match._id))
    .collect();
}

/** No beat at all counts from creation, so a match made a moment ago is not mistaken for a silent one. */
function silentSince(match: Doc<'matches'>, rows: Doc<'presence'>[]): number {
  return rows.length === 0 ? match.createdAt : Math.max(...rows.map((r) => r.lastSeen));
}

async function abandonDeadWaiting(ctx: MutationCtx, now: number) {
  for (const match of await oldestWith(ctx, 'waiting')) {
    const expired = match.expiresAt !== undefined && match.expiresAt < now;
    const hostGone = now - silentSince(match, await presenceRows(ctx, match)) > WAITING_IDLE_MS;
    if (expired || hostGone) await ctx.db.patch(match._id, { status: 'abandoned' });
  }
}

async function abandonStalledConnecting(ctx: MutationCtx, now: number) {
  for (const match of await oldestWith(ctx, 'connecting')) {
    // Timed from the guest's arrival, as matchmaking does: a private code may wait minutes before anyone joins.
    if (now - (match.guestSeen ?? match.createdAt) > IDLE_MS) {
      await ctx.db.patch(match._id, { status: 'abandoned', endReason: 'connection' });
    }
  }
}

async function abandonSilentPlaying(ctx: MutationCtx, now: number) {
  for (const match of await oldestWith(ctx, 'playing')) {
    if (now - silentSince(match, await presenceRows(ctx, match)) > IDLE_MS) {
      await ctx.db.patch(match._id, { status: 'abandoned', endReason: 'timeout' });
    }
  }
}

/** Signals carry IP addresses; once a match is past connecting nobody needs them. */
async function deleteLeftoverSignals(ctx: MutationCtx) {
  for (const signal of await ctx.db.query('signals').take(SWEEP_BATCH)) {
    const match = await ctx.db.get(signal.matchId);
    if (match?.status !== 'connecting') await ctx.db.delete(signal._id);
  }
}

async function deleteOldMatches(ctx: MutationCtx, now: number, status: 'finished' | 'abandoned') {
  const old = await ctx.db
    .query('matches')
    .withIndex('by_status', (q) => q.eq('status', status).lt('createdAt', now - RETENTION_MS))
    .take(SWEEP_BATCH);
  for (const match of old) {
    for (const row of await presenceRows(ctx, match)) await ctx.db.delete(row._id);
    const grants = await ctx.db
      .query('turnGrants')
      .withIndex('by_match', (q) => q.eq('matchId', match._id))
      .collect();
    for (const grant of grants) await ctx.db.delete(grant._id);
    await ctx.db.delete(match._id);
  }
}
