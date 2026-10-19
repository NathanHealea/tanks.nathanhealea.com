import { ROUNDS_TO_WIN } from './config';
import { isPvpPlayer, type PvpPlayer } from './types';

export interface MatchScore {
  round: number;
  wins: Record<PvpPlayer, number>;
  winner: PvpPlayer | null;
}

export function createMatchScore(): MatchScore {
  return { round: 0, wins: { p1: 0, p2: 0 }, winner: null };
}

/** Scores one finished round; `null` is a draw and counts as a round played with no win. */
export function applyRound(score: MatchScore, result: PvpPlayer | null): MatchScore {
  if (score.winner) throw new Error(`The match is over; ${score.winner} already won`);
  if (result !== null && !isPvpPlayer(result)) throw new Error(`Not a round result: ${String(result)}`);
  const wins = { ...score.wins };
  if (result) wins[result]++;
  const winner = result && wins[result] >= ROUNDS_TO_WIN ? result : null;
  return { round: score.round + 1, wins, winner };
}
