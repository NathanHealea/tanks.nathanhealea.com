import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DT } from '../game/config';
import { createPvpGame, IDLE_INPUT } from '../game/sim';
import { CORK, EMPTY, type GameEvent, type PlayerInput, type TankState } from '../game/types';
import { GuestSession, INTERPOLATION_DELAY } from './guestSession';
import { createLinkPair, type Link } from './link';
import { encode, parseGuestMessage, type InputMessage, type SnapshotMessage } from './protocol';

// 20x14 open floor; P spawns at col 2 and 2 at col 17, both on row 6.
const OPEN = Array.from({ length: 14 }, (_, r) =>
  r === 6 ? '..P..............2..' : '....................',
);

function tank(id: 'p1' | 'p2', fields: Partial<TankState>): TankState {
  const base = createPvpGame(OPEN, 1).tanks.find((t) => t.id === id)!;
  return { ...base, ...fields };
}

function sendSnap(host: Link, fields: Partial<SnapshotMessage> & { tick: number; time: number }): void {
  const message: SnapshotMessage = {
    t: 'snap',
    round: 1,
    tanks: [tank('p1', {}), tank('p2', {})],
    bullets: [],
    mines: [],
    events: [],
    broken: [],
    outcome: null,
    winner: null,
    ...fields,
  };
  host.send('state', encode(message));
  vi.advanceTimersByTime(0);
}

function p2(guest: GuestSession): TankState {
  return guest.state.tanks.find((t) => t.id === 'p2')!;
}

function receivedInputs(host: Link): InputMessage[] {
  const inputs: InputMessage[] = [];
  host.onMessage((channel, message) => {
    if (channel !== 'state') return;
    const parsed = parseGuestMessage(message);
    if (parsed) inputs.push(parsed);
  });
  return inputs;
}

describe('GuestSession', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('guest interpolates positions and angles', () => {
    const [hostLink, guestLink] = createLinkPair();
    const guest = new GuestSession(guestLink, OPEN, 1);
    const p1Before = guest.state.tanks.find((t) => t.id === 'p1')!;

    sendSnap(hostLink, {
      tick: 60,
      time: 1.0,
      tanks: [tank('p1', { pos: { x: 0, z: 5 }, body: 3.1, turret: 3.1 }), tank('p2', {})],
    });
    guest.advance(0, IDLE_INPUT);

    sendSnap(hostLink, {
      tick: 72,
      time: 1.2,
      tanks: [tank('p1', { pos: { x: 1, z: 5 }, body: -3.1, turret: -3.1 }), tank('p2', {})],
    });
    guest.advance(0.1 + INTERPOLATION_DELAY, IDLE_INPUT);

    const p1 = guest.state.tanks.find((t) => t.id === 'p1')!;
    expect(p1).toBe(p1Before);
    expect(p1.pos.x).toBeCloseTo(0.5, 5);
    expect(p1.pos.z).toBeCloseTo(5, 5);
    expect(Math.abs(Math.abs(p1.body) - Math.PI)).toBeLessThan(0.01);
    expect(Math.abs(Math.abs(p1.turret) - Math.PI)).toBeLessThan(0.01);
  });

  it('events play once', () => {
    const [hostLink, guestLink] = createLinkPair();
    const guest = new GuestSession(guestLink, OPEN, 1);
    const bounceAt = (x: number): GameEvent => ({ type: 'bounce', pos: { x, z: 0 } });
    const xs = (events: GameEvent[]) => events.map((e) => (e.type === 'bounce' ? e.pos.x : NaN)).sort();

    sendSnap(hostLink, { tick: 4, time: 4 * DT, events: [bounceAt(4)] });
    sendSnap(hostLink, { tick: 2, time: 2 * DT, events: [bounceAt(2)] });
    expect(xs(guest.advance(DT, IDLE_INPUT))).toEqual([2, 4]);

    sendSnap(hostLink, { tick: 4, time: 4 * DT, events: [bounceAt(4)] });
    sendSnap(hostLink, { tick: 2, time: 2 * DT, events: [bounceAt(2)] });
    sendSnap(hostLink, { tick: 6, time: 6 * DT, events: [bounceAt(6)] });
    expect(xs(guest.advance(DT, IDLE_INPUT))).toEqual([6]);

    expect(guest.advance(DT, IDLE_INPUT)).toEqual([]);
  });

  it('guest turret uses local aim', () => {
    const [hostLink, guestLink] = createLinkPair();
    const guest = new GuestSession(guestLink, OPEN, 1);
    expect(guest.localPlayerId).toBe('p2');

    sendSnap(hostLink, { tick: 2, time: 2 * DT, tanks: [tank('p1', {}), tank('p2', { turret: 0.5 })] });
    guest.advance(DT, IDLE_INPUT);
    expect(p2(guest).turret).toBeCloseTo(0.5, 5);

    guest.advance(DT, { ...IDLE_INPUT, aim: 1.2 });
    expect(p2(guest).turret).toBe(1.2);
  });

  it('sends input every 2 ticks with incrementing seq and cumulative fire counts', () => {
    const [hostLink, guestLink] = createLinkPair();
    const inputs = receivedInputs(hostLink);
    const guest = new GuestSession(guestLink, OPEN, 1);
    const held: PlayerInput = { move: { x: 1, z: 0 }, aim: 0.3, fire: false, mine: false };

    guest.advance(DT, { ...held, fire: true });
    vi.advanceTimersByTime(0);
    expect(inputs).toHaveLength(0);

    guest.advance(DT, held);
    guest.advance(DT, { ...held, fire: true, mine: true });
    guest.advance(DT, held);
    vi.advanceTimersByTime(0);

    expect(inputs.map((m) => m.seq)).toEqual([1, 2]);
    expect(inputs.map((m) => m.fire)).toEqual([1, 2]);
    expect(inputs.map((m) => m.mine)).toEqual([0, 1]);
    expect(inputs[1].move).toEqual({ x: 1, z: 0 });
    expect(inputs[1].aim).toBe(0.3);
  });

  it('counts a fire pressed on a zero-tick advance once, on the next advance with ticks', () => {
    const [hostLink, guestLink] = createLinkPair();
    const inputs = receivedInputs(hostLink);
    const guest = new GuestSession(guestLink, OPEN, 1);
    const firing: PlayerInput = { ...IDLE_INPUT, fire: true };

    guest.advance(0, firing);
    expect(guest.ticksLastAdvance).toBe(0);
    guest.advance(DT, firing);
    expect(guest.ticksLastAdvance).toBe(1);
    guest.advance(DT, IDLE_INPUT);
    vi.advanceTimersByTime(0);

    expect(inputs).toHaveLength(1);
    expect(inputs[0].fire).toBe(1);
  });

  it('clears broken cells from a snapshot in the grid', () => {
    const rows = OPEN.map((row, r) => (r === 3 ? '.....o..............' : row));
    const [hostLink, guestLink] = createLinkPair();
    const guest = new GuestSession(guestLink, rows, 1);
    const index = 3 * guest.state.grid.cols + 5;
    expect(guest.state.grid.cells[index]).toBe(CORK);

    sendSnap(hostLink, { tick: 2, time: 2 * DT, broken: [index] });
    guest.advance(DT, IDLE_INPUT);

    expect(guest.state.grid.cells[index]).toBe(EMPTY);
  });

  it('ignores snapshots from another round', () => {
    const [hostLink, guestLink] = createLinkPair();
    const guest = new GuestSession(guestLink, OPEN, 1, 2);
    const start = { ...p2(guest).pos };

    sendSnap(hostLink, {
      round: 1,
      tick: 2,
      time: 2 * DT,
      tanks: [tank('p1', {}), tank('p2', { pos: { x: 9.5, z: 2.5 } })],
      events: [{ type: 'bounce', pos: { x: 1, z: 1 } }],
    });
    expect(guest.advance(DT, IDLE_INPUT)).toEqual([]);
    expect(p2(guest).pos).toEqual(start);

    sendSnap(hostLink, {
      round: 2,
      tick: 2,
      time: 2 * DT,
      tanks: [tank('p1', {}), tank('p2', { pos: { x: 9.5, z: 2.5 } })],
    });
    guest.advance(DT, IDLE_INPUT);
    expect(p2(guest).pos.x).toBeCloseTo(9.5, 5);
  });

  it('a guest built without a round accepts round 1 snapshots only', () => {
    const [hostLink, guestLink] = createLinkPair();
    const guest = new GuestSession(guestLink, OPEN, 1);
    const start = { ...p2(guest).pos };

    sendSnap(hostLink, { round: 2, tick: 2, time: 2 * DT, tanks: [tank('p1', {}), tank('p2', { pos: { x: 9.5, z: 2.5 } })] });
    guest.advance(DT, IDLE_INPUT);
    expect(p2(guest).pos).toEqual(start);

    sendSnap(hostLink, { round: 1, tick: 4, time: 4 * DT, tanks: [tank('p1', {}), tank('p2', { pos: { x: 9.5, z: 2.5 } })] });
    guest.advance(DT, IDLE_INPUT);
    expect(p2(guest).pos.x).toBeCloseTo(9.5, 5);
  });

  it('updates tank objects in place', () => {
    const [hostLink, guestLink] = createLinkPair();
    const guest = new GuestSession(guestLink, OPEN, 1);
    const before = p2(guest);

    sendSnap(hostLink, { tick: 2, time: 2 * DT, tanks: [tank('p1', {}), tank('p2', { pos: { x: 9.5, z: 2.5 } })] });
    guest.advance(DT, IDLE_INPUT);

    expect(p2(guest)).toBe(before);
    expect(before.pos.x).toBeCloseTo(9.5, 5);
    expect(before.pos.z).toBeCloseTo(2.5, 5);
  });

  it('a wall break whose snapshot was lost still redraws the wall, exactly once', () => {
    const [host, link] = createLinkPair();
    const guest = new GuestSession(link, OPEN, 1);
    const cell = 3 * 20 + 5;
    // The snapshot that carried the wallBreak event was dropped; a later one only lists the cell as broken.
    sendSnap(host, { tick: 4, time: 1.0, broken: [cell] });
    const first = guest.advance(DT, IDLE_INPUT).filter((e) => e.type === 'wallBreak');
    expect(first).toEqual([expect.objectContaining({ type: 'wallBreak', col: 5, row: 3 })]);
    sendSnap(host, { tick: 6, time: 1.1, broken: [cell] });
    expect(guest.advance(DT, IDLE_INPUT).filter((e) => e.type === 'wallBreak')).toEqual([]);
  });

  it('a wall break that did arrive is not doubled by a stand-in', () => {
    const [host, link] = createLinkPair();
    const guest = new GuestSession(link, OPEN, 1);
    const cell = 3 * 20 + 5;
    const wallBreak = { type: 'wallBreak' as const, pos: { x: 0, z: 0 }, col: 5, row: 3 };
    sendSnap(host, { tick: 4, time: 1.0, broken: [cell], events: [wallBreak] });
    expect(guest.advance(DT, IDLE_INPUT).filter((e) => e.type === 'wallBreak')).toHaveLength(1);
  });

  it('counts its own countdown down from the round start', () => {
    const [, link] = createLinkPair();
    const guest = new GuestSession(link, OPEN, 1, 1, 3);
    expect(guest.countdownLeft).toBe(3);
    for (let i = 0; i < 60; i++) guest.advance(DT, IDLE_INPUT);
    expect(guest.countdownLeft).toBeCloseTo(2, 5);
    for (let i = 0; i < 200; i++) guest.advance(DT, IDLE_INPUT);
    expect(guest.countdownLeft).toBe(0);
  });
});
