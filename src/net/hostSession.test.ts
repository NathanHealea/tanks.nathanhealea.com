import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DT, MINE } from '../game/config';
import { cellCenter } from '../game/grid';
import { IDLE_INPUT } from '../game/sim';
import { CORK, type GameEvent, type TankState } from '../game/types';
import { HostSession } from './hostSession';
import { createLinkPair, type Link } from './link';
import { encode, parseHostMessage, type InputMessage, type SnapshotMessage } from './protocol';

// 20x14 open floor; P spawns at col 2 and 2 at col 17, both on row 6.
const OPEN = Array.from({ length: 14 }, (_, r) =>
  r === 6 ? '..P..............2..' : '....................',
);

function p2(host: HostSession): TankState {
  return host.state.tanks.find((t) => t.id === 'p2')!;
}

function sendInput(guest: Link, fields: Partial<InputMessage> & { seq: number }): void {
  const message: InputMessage = { t: 'input', move: { x: 0, z: 0 }, aim: Math.PI / 4, fire: 0, mine: 0, ...fields };
  guest.send('state', encode(message));
  vi.advanceTimersByTime(0);
}

// Refills p2 and clears its cooldown before every tick, so each tick with a pending fire produces one shot.
function p2ShotsOver(host: HostSession, ticks: number): number {
  let shots = 0;
  for (let i = 0; i < ticks; i++) {
    p2(host).shots = 99;
    p2(host).fireCooldown = 0;
    const events = host.advance(DT, IDLE_INPUT);
    shots += events.filter((e) => e.type === 'fire' && e.owner === 'p2').length;
  }
  return shots;
}

describe('HostSession', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('fire counters apply once per increase', () => {
    const [hostLink, guestLink] = createLinkPair();
    const host = new HostSession(hostLink, OPEN, 1);
    let shots = 0;

    sendInput(guestLink, { seq: 1, fire: 0 });
    shots += p2ShotsOver(host, 5);
    expect(shots).toBe(0);

    sendInput(guestLink, { seq: 2, fire: 1 });
    shots += p2ShotsOver(host, 5);
    expect(shots).toBe(1);

    sendInput(guestLink, { seq: 3, fire: 1 });
    shots += p2ShotsOver(host, 5);
    expect(shots).toBe(1);

    sendInput(guestLink, { seq: 4, fire: 3 });
    shots += p2ShotsOver(host, 5);
    expect(shots).toBe(3);

    const [cappedHostLink, cappedGuestLink] = createLinkPair();
    const capped = new HostSession(cappedHostLink, OPEN, 1);
    sendInput(cappedGuestLink, { seq: 1, fire: 10 });
    expect(p2ShotsOver(capped, 20)).toBe(3);

    const [staleHostLink, staleGuestLink] = createLinkPair();
    const stale = new HostSession(staleHostLink, OPEN, 1);
    sendInput(staleGuestLink, { seq: 5, fire: 1 });
    expect(p2ShotsOver(stale, 5)).toBe(1);
    sendInput(staleGuestLink, { seq: 3, fire: 2 });
    sendInput(staleGuestLink, { seq: 5, fire: 3 });
    expect(p2ShotsOver(stale, 10)).toBe(0);
  });

  it('host steps both players', () => {
    const [idleHostLink] = createLinkPair();
    const idle = new HostSession(idleHostLink, OPEN, 1);
    const idleStart = { ...p2(idle).pos };
    for (let i = 0; i < 30; i++) idle.advance(DT, IDLE_INPUT);
    expect(p2(idle).pos).toEqual(idleStart);

    const [hostLink, guestLink] = createLinkPair();
    const host = new HostSession(hostLink, OPEN, 1);
    const startX = p2(host).pos.x;
    sendInput(guestLink, { seq: 1, move: { x: 1, z: 0 } });
    for (let i = 0; i < 30; i++) host.advance(DT, IDLE_INPUT);
    expect(p2(host).pos.x).toBeGreaterThan(startX + 0.5);
  });

  it('snapshots carry events and grid edits', () => {
    const [hostLink, guestLink] = createLinkPair();
    const snapshots: SnapshotMessage[] = [];
    guestLink.onMessage((channel, raw) => {
      const message = channel === 'state' ? parseHostMessage(raw) : null;
      if (message?.t === 'snap') snapshots.push(message);
    });
    const host = new HostSession(hostLink, OPEN, 1);
    const g = host.state.grid;
    const corkIndex = 1 * g.cols + 11;
    g.cells[corkIndex] = CORK;
    host.state.mines.push({ id: 999, owner: 'p1', team: 0, pos: cellCenter(g, 10, 1), age: MINE.fuse - DT / 2 });

    const tickEvents: GameEvent[] = [];
    for (let i = 0; i < 2; i++) tickEvents.push(...host.advance(DT, IDLE_INPUT));
    vi.advanceTimersByTime(0);

    expect(tickEvents.some((e) => e.type === 'explode')).toBe(true);
    expect(snapshots.length).toBeGreaterThan(0);
    const first = snapshots[0];
    expect(first.broken).toContain(corkIndex);
    expect(first.events.some((e) => e.type === 'explode')).toBe(true);
    expect(first.events).toContainEqual(expect.objectContaining({ type: 'wallBreak', col: 11, row: 1 }));
  });

  it('sends one snapshot every two ticks, each event in exactly one of them', () => {
    const [hostLink, guestLink] = createLinkPair();
    const host = new HostSession(hostLink, OPEN, 1);
    const snaps: SnapshotMessage[] = [];
    guestLink.onMessage((channel, raw) => {
      const message = channel === 'state' ? parseHostMessage(raw) : null;
      if (message?.t === 'snap') snaps.push(message);
    });
    host.advance(DT, { ...IDLE_INPUT, aim: 0, fire: true });
    for (let i = 0; i < 9; i++) host.advance(DT, IDLE_INPUT);
    vi.advanceTimersByTime(0);

    expect(snaps.map((snap) => snap.tick)).toEqual([2, 4, 6, 8, 10]);
    const fires = snaps.flatMap((snap) => snap.events).filter((e) => e.type === 'fire');
    expect(fires).toHaveLength(1);
  });
});
