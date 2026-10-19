import { afterEach, describe, expect, it, vi } from 'vitest';
import { COUNTDOWN_SECONDS, GuestMatch, HostMatch } from './netMatch';
import { createLinkPair } from './link';

describe('HostMatch', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('a failed round report is logged, and the match goes on', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const [hostLink] = createLinkPair();
    const sessions: number[] = [];
    let current: import('./hostSession').HostSession | null = null;
    const match = new HostMatch(hostLink, 12345, {
      onRound: (session, round) => {
        sessions.push(round);
        current = session;
      },
      onRoundEnd: () => {},
      onMatchEnd: () => {},
      reportRound: () => Promise.reject(new Error('offline')),
    });
    match.start();
    const round1 = current!;
    round1.state.tanks.find((t) => t.id === 'p2')!.alive = false;
    for (let i = 0; i < 400 && sessions.length < 2; i++) round1.advance(1 / 60, { move: { x: 0, z: 0 }, aim: null, fire: false, mine: false });
    await Promise.resolve();
    expect(sessions).toEqual([1, 2]);
    expect(errors).toHaveBeenCalled();
    match.dispose();
  });

  it('round 2 plays: the guest renders it, its input moves p2, and it counts down', () => {
    vi.useFakeTimers();
    const [hostLink, guestLink] = createLinkPair();
    const hosts: import('./hostSession').HostSession[] = [];
    const guests: import('./guestSession').GuestSession[] = [];
    const reportRound = vi.fn().mockResolvedValue(null);
    const match = new HostMatch(hostLink, 12345, {
      onRound: (session) => hosts.push(session),
      onRoundEnd: () => {},
      onMatchEnd: () => {},
      reportRound,
    });
    const guestMatch = new GuestMatch(guestLink, { onRound: (session) => guests.push(session), onRoundEnd: () => {}, onMatchEnd: () => {} });
    const idle = { move: { x: 0, z: 0 }, aim: null, fire: false, mine: false };
    match.start();
    vi.advanceTimersByTime(0);
    expect(guests[0].countdownLeft).toBeCloseTo(COUNTDOWN_SECONDS, 5);

    // Both tanks die: a draw, reported as null.
    for (const t of hosts[0].state.tanks) t.alive = false;
    for (let i = 0; i < 600 && hosts.length < 2; i++) hosts[0].advance(1 / 60, idle);
    vi.advanceTimersByTime(0);
    expect(reportRound).toHaveBeenCalledWith(1, null);
    expect(guests).toHaveLength(2);

    const host2 = hosts[1];
    const guest2 = guests[1];
    const startX = host2.state.tanks.find((t) => t.id === 'p2')!.pos.x;
    const startZ = host2.state.tanks.find((t) => t.id === 'p2')!.pos.z;
    for (let frame = 0; frame < 300; frame++) {
      host2.advance(1 / 60, idle);
      guest2.advance(1 / 60, { ...idle, move: { x: -1, z: 0 } });
      vi.advanceTimersByTime(1000 / 60);
    }
    const p2 = host2.state.tanks.find((t) => t.id === 'p2')!;
    expect(Math.hypot(p2.pos.x - startX, p2.pos.z - startZ)).toBeGreaterThan(0.5);
    const seen = guest2.state.tanks.find((t) => t.id === 'p2')!;
    expect(Math.hypot(seen.pos.x - p2.pos.x, seen.pos.z - p2.pos.z)).toBeLessThan(0.5);
    match.dispose();
    guestMatch.dispose();
    vi.useRealTimers();
  });
});
