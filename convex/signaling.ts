import { ConvexError, v } from 'convex/values';
import { internal } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import { internalMutation, mutation, query, type MutationCtx, type QueryCtx } from './_generated/server';
import { loadMatchAs } from './lib/access';
import { CONNECT_TIMEOUT_MS } from './matchmaking';

/** Far above a real SDP offer or ICE candidate (a few KB), low enough that the table cannot be used as storage. */
export const MAX_SIGNAL_CHARS = 16_384;
/** A real setup is one offer or answer and a handful of candidates per side; this only stops flooding. */
export const MAX_SIGNALS_PER_SIDE = 50;
/**
 * Signals carry IP addresses, so every match's signals are deleted this long after the first one, whether or not the
 * players connected: past the connect timeout plus margin, nothing can still need them.
 */
export const SIGNAL_TTL_MS = 2 * 60_000;

const signalKind = v.union(v.literal('offer'), v.literal('answer'), v.literal('ice'));

/**
 * Relays one WebRTC setup message to the opponent. Payloads carry ICE candidates, which hold the sender's IP
 * addresses, so they go only to the other member of a connecting match and are deleted once connected.
 */
export const sendSignal = mutation({
  args: { playerId: v.string(), matchId: v.id('matches'), kind: signalKind, payload: v.string() },
  handler: async (ctx, { playerId, matchId, kind, payload }) => {
    const { match, role } = await loadMatchAs(ctx, matchId, playerId);
    const now = Date.now();
    if (!isConnecting(match, now)) throw new ConvexError('Match is not connecting');
    if (payload.length > MAX_SIGNAL_CHARS) throw new ConvexError('Signal too large');
    const to = role === 'host' ? 'guest' : 'host';
    const sent = await signalsTo(ctx, matchId, to);
    if (sent.length >= MAX_SIGNALS_PER_SIDE) throw new ConvexError('Too many signals');
    const existing = sent.length + (await signalsTo(ctx, matchId, role)).length;
    if (existing === 0) await ctx.scheduler.runAfter(SIGNAL_TTL_MS, internal.signaling.expireSignals, { matchId });
    await ctx.db.insert('signals', { matchId, to, kind, payload, createdAt: now });
    return null;
  },
});

export const inbox = query({
  args: { playerId: v.string(), matchId: v.id('matches') },
  handler: async (ctx, { playerId, matchId }) => {
    const { match, role } = await loadMatchAs(ctx, matchId, playerId);
    if (!isConnecting(match, Date.now())) return [];
    const rows = await signalsTo(ctx, matchId, role);
    return rows
      .map((s) => ({ id: s._id, kind: s.kind, payload: s.payload, createdAt: s.createdAt }))
      .sort((a, b) => a.createdAt - b.createdAt);
  },
});

/** The host reports the data channels open: the match starts and its signals, with their IP addresses, are deleted. */
export const markConnected = mutation({
  args: { playerId: v.string(), matchId: v.id('matches') },
  handler: async (ctx, { playerId, matchId }) => {
    const { match, role } = await loadMatchAs(ctx, matchId, playerId);
    if (role !== 'host') throw new ConvexError('Only the host can mark connected');
    if (match.status !== 'connecting') return null;
    await ctx.db.patch(matchId, { status: 'playing' });
    await deleteSignals(ctx, matchId);
    return null;
  },
});

export const expireSignals = internalMutation({
  args: { matchId: v.id('matches') },
  handler: async (ctx, { matchId }) => {
    await deleteSignals(ctx, matchId);
    return null;
  },
});

function isConnecting(match: Doc<'matches'>, now: number): boolean {
  return match.status === 'connecting' && now - (match.guestSeen ?? match.createdAt) <= CONNECT_TIMEOUT_MS;
}

function signalsTo(ctx: Pick<QueryCtx, 'db'>, matchId: Id<'matches'>, to: 'host' | 'guest') {
  return ctx.db
    .query('signals')
    .withIndex('by_match_to', (q) => q.eq('matchId', matchId).eq('to', to))
    .collect();
}

async function deleteSignals(ctx: MutationCtx, matchId: Id<'matches'>): Promise<void> {
  for (const to of ['host', 'guest'] as const) {
    for (const s of await signalsTo(ctx, matchId, to)) await ctx.db.delete(s._id);
  }
}
