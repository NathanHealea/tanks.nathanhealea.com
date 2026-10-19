import { afterEach, describe, expect, it, vi } from 'vitest';
import { HostMatch } from './netMatch';
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
});
