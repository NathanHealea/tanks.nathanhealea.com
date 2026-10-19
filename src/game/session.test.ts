import { describe, expect, it } from 'vitest';
import { DT } from './config';
import { FixedClock, LocalSession, type GameSession } from './session';
import { IDLE_INPUT } from './sim';

describe('LocalSession', () => {
  it('is a GameSession driven by its local player input alone', () => {
    const session: GameSession = new LocalSession(0, ['p1'], 7);
    expect(session.localPlayerId).toBe('p1');
    const me = session.state.tanks.find((t) => t.id === 'p1')!;
    const before = { ...me.pos };
    session.advance(DT * 5 + DT / 2, { ...IDLE_INPUT, move: { x: 1, z: 0 } });
    expect(session.ticksLastAdvance).toBe(5);
    expect(me.pos.x).toBeGreaterThan(before.x);
  });

  it('caps one frame at 0.1 s, so a stall does not fast-forward the game', () => {
    expect(new FixedClock().ticks(1.0)).toBe(6);
  });

  it('a campaign session never counts down', () => {
    expect(new LocalSession(0, ['p1'], 7).countdownLeft).toBe(0);
  });
});
