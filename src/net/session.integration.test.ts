import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DT, OUTCOME_DELAY } from '../game/config';
import type { MatchScore } from '../game/match';
import { generatePvpMap, roundSeed } from '../game/pvpMaps';
import { IDLE_INPUT } from '../game/sim';
import type { GameEvent, PlayerInput, TankState } from '../game/types';
import { reduce } from '../ui/online/flow';
import { GuestSession } from './guestSession';
import { HostSession } from './hostSession';
import { createLinkPair } from './link';
import { COUNTDOWN_SECONDS, GuestMatch, HostMatch } from './netMatch';
import { parseHostMessage, type RoundEndMessage, type RoundStartMessage } from './protocol';
import { LinkWatch } from './silence';

// 20x14 open floor; P spawns at col 2 and 2 at col 17, both on row 6.
const OPEN = Array.from({ length: 14 }, (_, r) =>
  r === 6 ? '..P..............2..' : '....................',
);

const MATCH_SEED = 12345;
const FRAME_MS = 1000 / 60;

// mulberry32: a fixed sequence so which packets drop is the same on every run.
function seededRandom(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function tank(session: { state: { tanks: TankState[] } }, id: 'p1' | 'p2'): TankState {
  return session.state.tanks.find((t) => t.id === id)!;
}

function fires(events: GameEvent[], owner: 'p1' | 'p2'): number {
  return events.filter((e) => e.type === 'fire' && e.owner === owner).length;
}

describe('networked session', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('no shots lost under loss', () => {
    const [hostLink, guestLink] = createLinkPair({ delayMs: 60, stateDropRate: 0.2, random: seededRandom(7) });
    const host = new HostSession(hostLink, OPEN, 1);
    const guest = new GuestSession(guestLink, OPEN, 1);
    // Aimed up and to the right, away from p1, so no shell ends the round.
    const aim: PlayerInput = { ...IDLE_INPUT, aim: Math.PI / 4 };
    // 2.6 s apart: past the 2 s magazine reload, so every press can fire.
    const pressEvery = Math.round(2.6 / DT);
    const presses = 10;
    let p2Fires = 0;

    for (let frame = 0; frame < presses * pressEvery + 60; frame++) {
      const pressed = frame % pressEvery === 0 && frame < presses * pressEvery;
      p2Fires += fires(host.advance(DT, IDLE_INPUT), 'p2');
      guest.advance(DT, { ...aim, fire: pressed });
      vi.advanceTimersByTime(FRAME_MS);
    }

    expect(tank(host, 'p2').alive).toBe(true);
    expect(p2Fires).toBe(presses);
  });

  describe('round cycle', () => {
    function setUp() {
      const [hostLink, guestLink] = createLinkPair();
      const hostSessions: HostSession[] = [];
      const guestSessions: GuestSession[] = [];
      const hostRounds: number[] = [];
      const guestRounds: number[] = [];
      const ctrlAtGuest: (RoundStartMessage | RoundEndMessage)[] = [];
      guestLink.onMessage((channel, raw) => {
        const message = channel === 'ctrl' ? parseHostMessage(raw) : null;
        if (message && message.t !== 'snap') ctrlAtGuest.push(message);
      });
      const host = {
        onRound: vi.fn((session: HostSession, round: number) => {
          hostSessions.push(session);
          hostRounds.push(round);
        }),
        onRoundEnd: vi.fn<(round: number, result: 'p1' | 'p2' | null, score: MatchScore) => void>(),
        onMatchEnd: vi.fn<(score: MatchScore) => void>(),
        reportRound: vi.fn(async () => null),
      };
      const guest = {
        onRound: vi.fn((session: GuestSession, round: number) => {
          guestSessions.push(session);
          guestRounds.push(round);
        }),
        onRoundEnd: vi.fn<(message: RoundEndMessage) => void>(),
        onMatchEnd: vi.fn<(message: RoundEndMessage) => void>(),
      };
      const hostMatch = new HostMatch(hostLink, MATCH_SEED, host);
      const guestMatch = new GuestMatch(guestLink, guest);
      return { hostMatch, guestMatch, host, guest, hostSessions, guestSessions, hostRounds, guestRounds, ctrlAtGuest };
    }

    it('round cycle runs end to end', () => {
      const { hostMatch, host, guest, hostSessions, guestSessions, hostRounds, guestRounds, ctrlAtGuest } = setUp();
      hostMatch.start();
      vi.advanceTimersByTime(0);

      expect(hostRounds).toEqual([1]);
      expect(guestRounds).toEqual([1]);
      const round1Rows = generatePvpMap(roundSeed(MATCH_SEED, 1));
      expect(ctrlAtGuest[0]).toEqual({ t: 'roundStart', round: 1, rows: round1Rows, seed: roundSeed(MATCH_SEED, 1) });

      const round1 = hostSessions[0];
      const guestRound1 = guestSessions[0];
      expect(round1.countdownLeft).toBeCloseTo(COUNTDOWN_SECONDS, 5);
      const p1Start = { ...tank(round1, 'p1').pos };
      const p2Start = { ...tank(round1, 'p2').pos };
      const driving: PlayerInput = { move: { x: 1, z: 0 }, aim: 0, fire: false, mine: false };
      let countdownFires = 0;
      for (let frame = 0; frame < COUNTDOWN_SECONDS * 60; frame++) {
        const events = round1.advance(DT, { ...driving, fire: frame === 40 });
        countdownFires += fires(events, 'p1') + fires(events, 'p2');
        guestRound1.advance(DT, { ...driving, fire: frame === 30 });
        vi.advanceTimersByTime(FRAME_MS);
      }
      expect(round1.countdownLeft).toBe(0);
      expect(tank(round1, 'p1').pos).toEqual(p1Start);
      expect(tank(round1, 'p2').pos).toEqual(p2Start);
      expect(round1.state.bullets).toEqual([]);
      expect(countdownFires).toBe(0);

      // The press made during the countdown must not fire once play starts.
      let p2FiresAfter = 0;
      for (let frame = 0; frame < 20; frame++) {
        p2FiresAfter += fires(round1.advance(DT, IDLE_INPUT), 'p2');
        guestRound1.advance(DT, IDLE_INPUT);
        vi.advanceTimersByTime(FRAME_MS);
      }
      expect(p2FiresAfter).toBe(0);

      tank(round1, 'p2').alive = false;
      round1.advance(DT, IDLE_INPUT);
      expect(round1.state.outcome).toBe('won');
      const poppedAt = round1.state.outcomeTime;
      let guestSawEndAfter: number | null = null;
      for (let frame = 0; frame < 2 * OUTCOME_DELAY * 60 && guestSawEndAfter === null; frame++) {
        if (host.onRoundEnd.mock.calls.length === 0) round1.advance(DT, IDLE_INPUT);
        vi.advanceTimersByTime(FRAME_MS);
        if (guest.onRoundEnd.mock.calls.length > 0) guestSawEndAfter = round1.state.time - poppedAt;
      }
      expect(guestSawEndAfter).not.toBeNull();
      expect(guestSawEndAfter!).toBeGreaterThanOrEqual(OUTCOME_DELAY - 1e-9);
      expect(guestSawEndAfter!).toBeLessThan(OUTCOME_DELAY + DT + 1e-9);

      const roundEnd: RoundEndMessage = { t: 'roundEnd', round: 1, result: 'p1', wins: { p1: 1, p2: 0 }, winner: null };
      expect(guest.onRoundEnd).toHaveBeenCalledTimes(1);
      expect(guest.onRoundEnd).toHaveBeenCalledWith(roundEnd);
      expect(guest.onMatchEnd).not.toHaveBeenCalled();
      expect(host.onRoundEnd).toHaveBeenCalledTimes(1);
      expect(host.onRoundEnd).toHaveBeenCalledWith(1, 'p1', { round: 1, wins: { p1: 1, p2: 0 }, winner: null });
      expect(hostMatch.score).toEqual({ round: 1, wins: { p1: 1, p2: 0 }, winner: null });
      expect(host.reportRound).toHaveBeenCalledTimes(1);
      expect(host.reportRound).toHaveBeenCalledWith(1, 'p1');
      expect(host.onMatchEnd).not.toHaveBeenCalled();

      expect(ctrlAtGuest.map((m) => [m.t, m.round])).toEqual([
        ['roundStart', 1],
        ['roundEnd', 1],
        ['roundStart', 2],
      ]);
      const round2Start = ctrlAtGuest[2] as RoundStartMessage;
      expect(round2Start.seed).toBe(roundSeed(MATCH_SEED, 2));
      expect(round2Start.rows).toEqual(generatePvpMap(roundSeed(MATCH_SEED, 2)));
      expect(round2Start.rows).not.toEqual(round1Rows);
      expect(hostRounds).toEqual([1, 2]);
      expect(guestRounds).toEqual([1, 2]);
      expect(hostSessions[1]).not.toBe(round1);
      expect(guestSessions[1]).not.toBe(guestRound1);
      expect(hostSessions[1].countdownLeft).toBeCloseTo(COUNTDOWN_SECONDS, 5);
    });

    it('a match ends after three wins', () => {
      const { hostMatch, host, guest, hostSessions, hostRounds } = setUp();
      hostMatch.start();
      vi.advanceTimersByTime(0);

      for (let frame = 0; frame < 3 * 60 * (COUNTDOWN_SECONDS + OUTCOME_DELAY + 1); frame++) {
        if (host.onMatchEnd.mock.calls.length > 0) break;
        const session = hostSessions[hostSessions.length - 1];
        if (session.countdownLeft === 0) tank(session, 'p2').alive = false;
        session.advance(DT, IDLE_INPUT);
        vi.advanceTimersByTime(FRAME_MS);
      }
      vi.advanceTimersByTime(FRAME_MS);

      const final = { round: 3, wins: { p1: 3, p2: 0 }, winner: 'p1' };
      expect(host.onMatchEnd).toHaveBeenCalledTimes(1);
      expect(host.onMatchEnd).toHaveBeenCalledWith(final);
      expect(hostMatch.score).toEqual(final);
      expect(hostRounds).toEqual([1, 2, 3]);
      expect(host.reportRound.mock.calls).toEqual([
        [1, 'p1'],
        [2, 'p1'],
        [3, 'p1'],
      ]);
      expect(guest.onMatchEnd).toHaveBeenCalledTimes(1);
      expect(guest.onMatchEnd).toHaveBeenCalledWith({
        t: 'roundEnd',
        round: 3,
        result: 'p1',
        wins: { p1: 3, p2: 0 },
        winner: 'p1',
      });
      expect(guest.onRoundEnd).toHaveBeenCalledTimes(3);
    });
  });

  describe('bye ends the match immediately', () => {
    function watchBothEnds() {
      const [hostLink, guestLink] = createLinkPair();
      const host = { onHealth: vi.fn(), onLost: vi.fn(), onBye: vi.fn() };
      const guest = { onHealth: vi.fn(), onLost: vi.fn(), onBye: vi.fn() };
      return { hostWatch: new LinkWatch(hostLink, host), guestWatch: new LinkWatch(guestLink, guest), host, guest };
    }

    it('the host hears the guest bye on the next tick', () => {
      const { guestWatch, host, guest } = watchBothEnds();
      vi.advanceTimersByTime(3000);
      expect(host.onBye).not.toHaveBeenCalled();

      guestWatch.bye();
      vi.advanceTimersByTime(0);
      expect(host.onBye).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(3000);
      expect(host.onBye).toHaveBeenCalledTimes(1);
      expect(guest.onBye).not.toHaveBeenCalled();
      expect(host.onLost).not.toHaveBeenCalled();
    });

    it('the host flow ends the match as opponent left and closes the link without telling the server', () => {
      expect(reduce({ name: 'playing', round: 2 }, { type: 'opponentLeft' })).toEqual({
        screen: { name: 'ended', reason: 'opponentLeft' },
        effects: [{ type: 'endLink' }],
      });
    });
  });
});
