import { applyRound, createMatchScore, type MatchScore } from '../game/match';
import { generatePvpMap, roundSeed } from '../game/pvpMaps';
import type { PvpPlayer } from '../game/types';
import { GuestSession } from './guestSession';
import { HostSession } from './hostSession';
import type { Link } from './link';
import { encode, parseHostMessage, type RoundEndMessage } from './protocol';

export const COUNTDOWN_SECONDS = 3;

/** Runs a whole match on the host: one HostSession per round, a fresh arena each time, scored first to three. */
export class HostMatch {
  score: MatchScore = createMatchScore();
  private session: HostSession | null = null;

  constructor(
    private readonly link: Link,
    private readonly matchSeed: number,
    private readonly handlers: {
      onRound(session: HostSession, round: number): void;
      onRoundEnd(round: number, result: PvpPlayer | null, score: MatchScore): void;
      onMatchEnd(score: MatchScore): void;
      reportRound(round: number, result: PvpPlayer | null): Promise<unknown>;
    },
  ) {}

  start(): void {
    this.startRound(1);
  }

  dispose(): void {
    this.session?.dispose();
    this.session = null;
  }

  private startRound(round: number): void {
    const seed = roundSeed(this.matchSeed, round);
    const rows = generatePvpMap(seed);
    this.link.send('ctrl', encode({ t: 'roundStart', round, rows, seed }));
    this.session?.dispose();
    this.session = new HostSession(this.link, rows, seed, {
      round,
      countdownTicks: COUNTDOWN_SECONDS * 60,
      onRoundOver: (result) => this.endRound(round, result),
    });
    this.handlers.onRound(this.session, round);
  }

  private endRound(round: number, result: PvpPlayer | null): void {
    this.score = applyRound(this.score, result);
    const { wins, winner } = this.score;
    this.link.send('ctrl', encode({ t: 'roundEnd', round, result, wins, winner }));
    this.handlers.onRoundEnd(round, result, this.score);
    this.handlers
      .reportRound(round, result)
      .catch((err) => console.error(`Recording round ${round} in Convex failed`, err));
    if (winner) {
      this.dispose();
      this.handlers.onMatchEnd(this.score);
    } else {
      this.startRound(round + 1);
    }
  }
}

/** Follows the host's rounds on the guest: a new GuestSession for each roundStart, results from roundEnd. */
export class GuestMatch {
  private session: GuestSession | null = null;
  private stopListening: () => void;

  constructor(
    link: Link,
    handlers: {
      onRound(session: GuestSession, round: number): void;
      onRoundEnd(message: RoundEndMessage): void;
      onMatchEnd(message: RoundEndMessage): void;
    },
  ) {
    this.stopListening = link.onMessage((channel, raw) => {
      if (channel !== 'ctrl') return;
      const message = parseHostMessage(raw);
      if (message?.t === 'roundStart') {
        this.session?.dispose();
        this.session = new GuestSession(link, message.rows, message.seed, message.round, COUNTDOWN_SECONDS);
        handlers.onRound(this.session, message.round);
      } else if (message?.t === 'roundEnd') {
        handlers.onRoundEnd(message);
        if (message.winner) handlers.onMatchEnd(message);
      }
    });
  }

  dispose(): void {
    this.stopListening();
    this.session?.dispose();
    this.session = null;
  }
}
