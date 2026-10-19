import { describe, expect, it } from 'vitest';
import { DT } from './config';
import { LocalSession, type GameSession } from './session';
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
});
