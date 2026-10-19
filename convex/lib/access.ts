import { ConvexError } from 'convex/values';
import type { Doc, Id } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';
import { isPlayerId } from './ids';

export type Role = 'host' | 'guest';

export interface MatchView {
  id: Id<'matches'>;
  role: Role;
  kind: Doc<'matches'>['kind'];
  status: Doc<'matches'>['status'];
  seed: number;
  round: number;
  hostScore: number;
  guestScore: number;
  winner: Doc<'matches'>['winner'];
  endReason: Doc<'matches'>['endReason'];
  /** Host of a private match only: the guest never sees the code that let them in. */
  code?: string;
  expiresAt?: number;
}

// ConvexError, not Error: Convex replaces plain error messages with "Server Error" for clients in production.
export function requirePlayerId(value: unknown): string {
  if (!isPlayerId(value)) throw new ConvexError('Invalid player id');
  return value;
}

export function roleIn(match: Doc<'matches'>, playerId: string): Role {
  requirePlayerId(playerId);
  if (playerId === match.hostId) return 'host';
  if (playerId === match.guestId) return 'guest';
  throw new ConvexError('Not in this match');
}

/** Validates the id before any read, so every match function rejects a malformed id the same way. */
export async function loadMatchAs(
  ctx: Pick<QueryCtx, 'db'>,
  matchId: Id<'matches'>,
  playerId: string,
): Promise<{ match: Doc<'matches'>; role: Role }> {
  requirePlayerId(playerId);
  const match = await ctx.db.get(matchId);
  if (!match) throw new ConvexError('Match not found');
  return { match, role: roleIn(match, playerId) };
}

/**
 * What a client may see of a match: never a player id, so a GUID cannot leak to the opponent and be replayed.
 * Takes the caller's id rather than a role so a view can only exist for a member.
 */
export function toMatchView(match: Doc<'matches'>, playerId: string): MatchView {
  const role = roleIn(match, playerId);
  const view: MatchView = {
    id: match._id,
    role,
    kind: match.kind,
    status: match.status,
    seed: match.seed,
    round: match.round,
    hostScore: match.hostScore,
    guestScore: match.guestScore,
    winner: match.winner,
    endReason: match.endReason,
  };
  if (role === 'host' && match.code !== undefined) {
    view.code = match.code;
    view.expiresAt = match.expiresAt;
  }
  return view;
}
