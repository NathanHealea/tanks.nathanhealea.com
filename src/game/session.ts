import { DT } from './config';
import { createGame, step } from './sim';
import type { GameEvent, GameState, PlayerInput } from './types';

/**
 * What the renderer drives each frame. A local campaign runs the simulation here; a networked match runs it on the
 * host's machine and shows the guest a copy.
 */
export interface GameSession {
  readonly state: GameState;
  /** Ticks the last advance() ran; when 0 the caller should keep one-shot actions queued for the next frame. */
  readonly ticksLastAdvance: number;
  readonly localPlayerId: string;
  advance(elapsed: number, localInput: PlayerInput): GameEvent[];
}

/** Turns real elapsed time into whole fixed ticks, capping a long frame so a stall does not fast-forward the game. */
export class FixedClock {
  private accumulator = 0;

  ticks(elapsed: number): number {
    this.accumulator += Math.min(elapsed, 0.1);
    let n = 0;
    while (this.accumulator >= DT) {
      this.accumulator -= DT;
      n++;
    }
    return n;
  }
}

/** A campaign level played on this machine. */
export class LocalSession implements GameSession {
  state: GameState;
  ticksLastAdvance = 0;
  readonly localPlayerId: string;
  private clock = new FixedClock();

  constructor(levelIndex: number, playerIds: string[], seed: number) {
    this.state = createGame(levelIndex, playerIds, seed);
    this.localPlayerId = playerIds[0];
  }

  /** One-shot actions (fire, mine) apply on the first tick only. */
  advance(elapsed: number, localInput: PlayerInput): GameEvent[] {
    const events: GameEvent[] = [];
    let input = localInput;
    this.ticksLastAdvance = this.clock.ticks(elapsed);
    for (let i = 0; i < this.ticksLastAdvance; i++) {
      events.push(...step(this.state, { [this.localPlayerId]: input }));
      input = { ...input, fire: false, mine: false };
    }
    return events;
  }
}
