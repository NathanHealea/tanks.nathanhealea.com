import { describe, expect, it } from 'vitest';
import { createGame, step } from './sim';
import type { PlayerInput } from './types';

// Drives a square, sweeps the turret, fires every 90 ticks and drops one mine, so physics, bullets and mines all run.
function scriptedInput(tick: number): PlayerInput {
  const leg = Math.floor(tick / 75) % 4;
  const move = [
    { x: 1, z: 0 },
    { x: 0, z: 1 },
    { x: -1, z: 0 },
    { x: 0, z: -1 },
  ][leg];
  return {
    move,
    aim: (tick / 60) % (2 * Math.PI),
    fire: tick % 90 === 45,
    mine: tick === 120,
  };
}

describe('sim', () => {
  it('level 1 replays identically', () => {
    const state = createGame(0, ['p1'], 12345);
    for (let tick = 0; tick < 600; tick++) {
      step(state, { p1: scriptedInput(tick) });
    }
    expect({
      tanks: state.tanks,
      bullets: state.bullets,
      mines: state.mines,
      outcome: state.outcome,
    }).toMatchSnapshot();
  });
});
