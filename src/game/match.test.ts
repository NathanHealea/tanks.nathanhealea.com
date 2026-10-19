import { describe, expect, it } from 'vitest';
import { ROUNDS_TO_WIN } from './config';
import { applyRound, createMatchScore } from './match';

describe('match', () => {
  it('scoring counts wins and skips draws', () => {
    const start = createMatchScore();
    expect(start).toEqual({ round: 0, wins: { p1: 0, p2: 0 }, winner: null });

    const afterWin = applyRound(start, 'p1');
    const afterDraw = applyRound(afterWin, null);
    const afterSecondWin = applyRound(afterDraw, 'p1');

    expect(afterSecondWin).toEqual({ round: 3, wins: { p1: 2, p2: 0 }, winner: null });
    expect(start).toEqual({ round: 0, wins: { p1: 0, p2: 0 }, winner: null });
    expect(afterWin).toEqual({ round: 1, wins: { p1: 1, p2: 0 }, winner: null });
    expect(afterDraw).toEqual({ round: 2, wins: { p1: 1, p2: 0 }, winner: null });
  });

  it('first to three ends the match', () => {
    expect(ROUNDS_TO_WIN).toBe(3);
    let score = createMatchScore();
    for (const result of ['p1', 'p2', 'p1', 'p2', null] as const) score = applyRound(score, result);
    expect(score).toEqual({ round: 5, wins: { p1: 2, p2: 2 }, winner: null });

    score = applyRound(score, 'p2');
    expect(score).toEqual({ round: 6, wins: { p1: 2, p2: 3 }, winner: 'p2' });

    expect(() => applyRound(score, 'p1')).toThrow(Error);
    expect(() => applyRound(score, null)).toThrow(Error);
  });

  it('rejects a round result that is not p1, p2 or a draw', () => {
    const score = createMatchScore();
    for (const junk of ['constructor', '__proto__', 'p3', '', 1, undefined]) {
      expect(() => applyRound(score, junk as unknown as 'p1')).toThrow('Not a round result');
    }
    expect(score).toEqual(createMatchScore());
  });
});
