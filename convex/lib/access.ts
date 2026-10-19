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

/** Checks the id before reading, so a malformed id cannot be used to probe which match ids exist. */
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
  return {
    id: match._id,
    role: roleIn(match, playerId),
    kind: match.kind,
    status: match.status,
    seed: match.seed,
    round: match.round,
    hostScore: match.hostScore,
    guestScore: match.guestScore,
    winner: match.winner,
    endReason: match.endReason,
  };
}
