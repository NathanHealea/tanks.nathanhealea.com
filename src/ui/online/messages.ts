import { ConvexError } from 'convex/values';
import type { JoinError } from '../../net/joinErrors';
import type { ConnectFailReason, EndReason } from './flow';

const JOIN_ERRORS: Record<JoinError, string> = {
  CODE_NOT_FOUND: 'No match with that code.',
  CODE_EXPIRED: 'That code has expired. Ask for a new one.',
  MATCH_FULL: 'That match is already full.',
  OWN_CODE: 'This is your own match code. Send the link to a friend.',
  ALREADY_IN_MATCH: "You're already in a match.",
  UNKNOWN: 'Something went wrong joining that match. Try again.',
};

export function joinErrorMessage(error: JoinError): string {
  return JOIN_ERRORS[error];
}

/** Read letter by letter: a screen reader would otherwise try to pronounce "HK7Q2M" as a word. */
export function spokenCode(code: string): string {
  return code.split('').join(' ');
}

export function scoreText(you: number, them: number): string {
  return `You ${you} – ${them} Them`;
}

export function matchResultText(won: boolean, you: number, them: number): string {
  return `You ${won ? 'win' : 'lose'} ${you}–${them}`;
}

export function roundResultText(outcome: 'won' | 'lost' | 'draw'): string {
  return outcome === 'won' ? 'You won the round' : outcome === 'lost' ? 'They won the round' : 'Draw';
}

const UNREACHABLE = "Couldn't reach your opponent. Check your connection and try again.";

export function connectFailedMessage(reason: ConnectFailReason): string {
  if (reason === 'VERSION_MISMATCH') return 'Your opponent is on a different version. Reload to update.';
  if (reason === 'RELAY_UNAVAILABLE') {
    return "Online matches can't start right now. Try again in a few minutes.";
  }
  return UNREACHABLE;
}

export function colorName(playerId: 'p1' | 'p2'): string {
  return playerId === 'p1' ? 'Blue' : 'Green';
}

export function rematchErrorMessage(err: unknown): string {
  const reason = err instanceof ConvexError ? err.data : null;
  if (reason === 'OPPONENT_LEFT') return 'Your opponent has left, so a rematch is not possible.';
  if (reason === 'ALREADY_IN_MATCH') return "You're already in a match.";
  return "Couldn't ask for a rematch. Try again.";
}

const ENDED: Record<EndReason, string> = {
  opponentLeft: 'Opponent left. You win.',
  opponentWon: 'Connection lost. Your opponent wins.',
  noResult: 'Connection lost. No result.',
  away: 'You were away too long, so the match went to your opponent.',
};

export function endedText(reason: EndReason): string {
  return ENDED[reason];
}

export function linkLostText(secondsLeft: number): string {
  return `Connection lost. Waiting for your opponent… ${secondsLeft}`;
}
