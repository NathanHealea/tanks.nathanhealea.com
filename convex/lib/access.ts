import { ConvexError } from 'convex/values';
import type { Doc } from '../_generated/dataModel';
import { isPlayerId } from './ids';

export type Role = 'host' | 'guest';

// ConvexError, not Error: Convex replaces plain error messages with "Server Error" for clients in production.
export function requirePlayerId(value: string): string {
  if (!isPlayerId(value)) throw new ConvexError('Invalid player id');
  return value;
}

export function roleIn(match: Doc<'matches'>, playerId: string): Role {
  requirePlayerId(playerId);
  if (playerId === match.hostId) return 'host';
  if (playerId === match.guestId) return 'guest';
  throw new ConvexError('Not in this match');
}

/** What a client may see of a match: never a player id, so a GUID cannot leak to the opponent and be replayed. */
export function toMatchView(match: Doc<'matches'>, role: Role) {
  return {
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
}
