import type { JoinError } from '../../net/joinErrors';
import type { PeerErrorCode } from '../../net/peer';

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

const UNREACHABLE = "Couldn't reach your opponent. Their network may block direct connections.";

export function connectFailedMessage(reason: PeerErrorCode): string {
  return reason === 'VERSION_MISMATCH' ? 'Your opponent is on a different version. Reload to update.' : UNREACHABLE;
}

export function colorName(playerId: 'p1' | 'p2'): string {
  return playerId === 'p1' ? 'Blue' : 'Green';
}
