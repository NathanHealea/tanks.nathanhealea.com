import { ConvexError, v } from 'convex/values';
import type { Doc } from './_generated/dataModel';
import { mutation, type MutationCtx } from './_generated/server';
import { loadMatchAs, requirePlayerId } from './lib/access';
import { generateCode, normalizeCode } from './lib/codes';
import { activeMatchFor, queueEntry } from './matchmaking';

/** How long an unused private code works. The host can make a new one at any time (WCAG 2.2.1). */
export const CODE_TTL_MS = 10 * 60_000;
const CODE_ATTEMPTS = 5;

export const createPrivate = mutation({
  args: { playerId: v.string() },
  handler: async (ctx, { playerId }): Promise<{ code: string }> => {
    requirePlayerId(playerId);
    const now = Date.now();
    const current = await activeMatchFor(ctx, playerId);
    if (current && !(current.kind === 'private' && current.status === 'waiting' && current.hostId === playerId)) {
      throw new ConvexError('ALREADY_IN_MATCH');
    }
    if (current) await ctx.db.patch(current._id, { status: 'abandoned' });
    await leaveQueue(ctx, playerId);

    const code = await uniqueCode(ctx);
    await ctx.db.insert('matches', {
      kind: 'private',
      code,
      expiresAt: now + CODE_TTL_MS,
      hostId: playerId,
      status: 'waiting',
      seed: Math.floor(Math.random() * 2 ** 32),
      round: 0,
      hostScore: 0,
      guestScore: 0,
      createdAt: now,
      hostSeen: now,
    });
    return { code };
  },
});

/** Keeps the same code working for another CODE_TTL_MS, so a friend still typing it is not cut off (WCAG 2.2.1). */
export const extendPrivate = mutation({
  args: { playerId: v.string(), matchId: v.id('matches') },
  handler: async (ctx, { playerId, matchId }) => {
    const { match, role } = await loadMatchAs(ctx, matchId, playerId);
    if (role !== 'host') throw new ConvexError('Only the host can extend');
    if (match.status !== 'waiting') throw new ConvexError('CODE_NOT_FOUND');
    const expiresAt = Date.now() + CODE_TTL_MS;
    await ctx.db.patch(match._id, { expiresAt });
    return { expiresAt };
  },
});

export const cancelPrivate = mutation({
  args: { playerId: v.string(), matchId: v.id('matches') },
  handler: async (ctx, { playerId, matchId }) => {
    const { match, role } = await loadMatchAs(ctx, matchId, playerId);
    if (role !== 'host') throw new ConvexError('Only the host can cancel');
    if (match.status === 'waiting') await ctx.db.patch(match._id, { status: 'abandoned' });
    return null;
  },
});

/** Joins the match behind a share code. Every refusal is a distinct ConvexError code the UI can explain. */
export const joinPrivate = mutation({
  args: { playerId: v.string(), code: v.string() },
  handler: async (ctx, { playerId, code: typed }) => {
    requirePlayerId(playerId);
    const now = Date.now();
    const code = normalizeCode(typed);
    const match = code ? await matchWithCode(ctx, code) : null;
    if (!match) throw new ConvexError('CODE_NOT_FOUND');
    if (match.hostId === playerId) throw new ConvexError('OWN_CODE');
    if (match.guestId !== undefined) throw new ConvexError('MATCH_FULL');
    if (match.expiresAt === undefined || now > match.expiresAt) throw new ConvexError('CODE_EXPIRED');
    if (await activeMatchFor(ctx, playerId)) throw new ConvexError('ALREADY_IN_MATCH');

    await leaveQueue(ctx, playerId);
    await ctx.db.patch(match._id, { guestId: playerId, guestSeen: now, status: 'connecting' });
    return { matchId: match._id };
  },
});

// Abandoned and finished matches keep their code until the sweep deletes them, so only a code on a waiting,
// connecting or playing match counts. Expired codes still count, so the joiner hears CODE_EXPIRED and the code is not
// handed to a new match until the sweep removes the old one.
async function matchWithCode(ctx: MutationCtx, code: string): Promise<Doc<'matches'> | null> {
  const rows = await ctx.db
    .query('matches')
    .withIndex('by_code', (q) => q.eq('code', code))
    .collect();
  return rows.find((m) => m.status === 'waiting' || m.status === 'connecting' || m.status === 'playing') ?? null;
}

async function uniqueCode(ctx: MutationCtx): Promise<string> {
  for (let attempt = 0; attempt < CODE_ATTEMPTS; attempt++) {
    const code = generateCode(Math.random);
    if (!(await matchWithCode(ctx, code))) return code;
  }
  throw new ConvexError('Could not find a free match code; try again');
}

async function leaveQueue(ctx: MutationCtx, playerId: string): Promise<void> {
  const entry = await queueEntry(ctx, playerId);
  if (entry) await ctx.db.delete(entry._id);
}
