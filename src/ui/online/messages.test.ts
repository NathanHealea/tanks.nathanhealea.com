import { ConvexError } from 'convex/values';
import { describe, expect, it } from 'vitest';
import { formatCode } from '../../net/share';
import {
  colorName,
  connectFailedMessage,
  joinErrorMessage,
  matchResultText,
  rematchErrorMessage,
  roundResultText,
  scoreText,
  spokenCode,
} from './messages';

describe('online messages', () => {
  it('every join error has a message', () => {
    expect(joinErrorMessage('CODE_NOT_FOUND')).toBe('No match with that code.');
    expect(joinErrorMessage('CODE_EXPIRED')).toBe('That code has expired. Ask for a new one.');
    expect(joinErrorMessage('MATCH_FULL')).toBe('That match is already full.');
    expect(joinErrorMessage('OWN_CODE')).toBe('This is your own match code. Send the link to a friend.');
    expect(joinErrorMessage('ALREADY_IN_MATCH')).toBe("You're already in a match.");
    expect(joinErrorMessage('UNKNOWN')).toBe('Something went wrong joining that match. Try again.');
  });

  it('code is spoken by character', () => {
    expect(spokenCode('HK7Q2M')).toBe('H K 7 Q 2 M');
    expect(formatCode('HK7Q2M')).toBe('HK7-Q2M');
  });

  it('match text', () => {
    expect(scoreText(1, 0)).toBe('You 1 – 0 Them');
    expect(matchResultText(true, 3, 1)).toBe('You win 3–1');
    expect(matchResultText(false, 1, 3)).toBe('You lose 1–3');
    expect(roundResultText('won')).toBe('You won the round');
    expect(roundResultText('lost')).toBe('They won the round');
    expect(roundResultText('draw')).toBe('Draw');
    expect(colorName('p1')).toBe('Blue');
    expect(colorName('p2')).toBe('Green');
  });

  it('connection failures explain themselves', () => {
    const unreachable = "Couldn't reach your opponent. Their network may block direct connections.";
    expect(connectFailedMessage('VERSION_MISMATCH')).toBe('Your opponent is on a different version. Reload to update.');
    expect(connectFailedMessage('CONNECT_TIMEOUT')).toBe(unreachable);
    expect(connectFailedMessage('CONNECT_FAILED')).toBe(unreachable);
  });

  it('rematch failures say why', () => {
    expect(rematchErrorMessage(new ConvexError('OPPONENT_LEFT'))).toBe('Your opponent has left, so a rematch is not possible.');
    expect(rematchErrorMessage(new ConvexError('ALREADY_IN_MATCH'))).toBe("You're already in a match.");
    expect(rematchErrorMessage(new ConvexError('Match is not finished'))).toBe("Couldn't ask for a rematch. Try again.");
    expect(rematchErrorMessage(new Error('network'))).toBe("Couldn't ask for a rematch. Try again.");
  });
});
