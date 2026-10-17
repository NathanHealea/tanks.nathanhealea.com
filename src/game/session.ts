import { DT } from './config';
import { createGame, step } from './sim';
import type { GameEvent, GameState, PlayerInput } from './types';

/**
 * Owns a running level and the fixed-step clock. A future network session would replace this:
 * the host runs step() with remote inputs and broadcasts state; clients send PlayerInput.
 */
export class LocalSession {
  state: GameState;
  ticksLastAdvance = 0;
  private accumulator = 0;

  constructor(levelIndex: number, playerIds: string[], seed: number) {
    this.state = createGame(levelIndex, playerIds, seed);
  }

  /**
   * Advance by real elapsed time. One-shot actions (fire, mine) apply on the first tick only; when
   * ticksLastAdvance is 0 the caller should keep them queued for the next frame.
   */
  advance(elapsed: number, inputs: Record<string, PlayerInput>): GameEvent[] {
    this.accumulator += Math.min(elapsed, 0.1);
    const events: GameEvent[] = [];
    let current = inputs;
    this.ticksLastAdvance = 0;
    while (this.accumulator >= DT) {
      this.accumulator -= DT;
      this.ticksLastAdvance++;
      events.push(...step(this.state, current));
      current = withoutActions(current);
    }
    return events;
  }
}

function withoutActions(inputs: Record<string, PlayerInput>): Record<string, PlayerInput> {
  const out: Record<string, PlayerInput> = {};
  for (const [id, i] of Object.entries(inputs)) out[id] = { ...i, fire: false, mine: false };
  return out;
}
