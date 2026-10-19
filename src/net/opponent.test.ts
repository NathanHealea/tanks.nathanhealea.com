import { afterEach, describe, expect, it, vi } from 'vitest';
import { getFunctionName, type FunctionReference } from 'convex/server';
import type { Id } from '../../convex/_generated/dataModel';
import { createFakeRtcPair, createSignalBus, type FakeSignalTransport } from './fakeRtc';
import { connectToOpponent, RelayUnavailableError } from './opponent';
import { PeerError } from './peer';

const MATCH = 'match1' as Id<'matches'>;
const ICE: RTCIceServer[] = [{ urls: 'stun:stun.example.test:3478' }];
const TURN: RTCIceServer[] = [{ urls: 'turn:turn.example.test:3478', username: 'user', credential: 'secret' }];

// A stand-in for ConvexReactClient: signaling calls go through the in-memory bus, markConnected and turn are recorded.
function fakeConvex(
  side: FakeSignalTransport,
  markConnected = vi.fn().mockResolvedValue(null),
  turn = vi.fn().mockResolvedValue({ iceServers: TURN }),
) {
  return {
    markConnected,
    turn,
    action: vi.fn((ref: FunctionReference<'action'>, args: { playerId: string; matchId: Id<'matches'> }) => {
      if (getFunctionName(ref) === 'turn:turnCredentials') return turn(args);
      throw new Error('unexpected action');
    }),
    mutation: vi.fn((ref: FunctionReference<'mutation'>, args: { kind?: 'offer' | 'answer' | 'ice'; payload?: string }) => {
      const name = getFunctionName(ref);
      if (name === 'signaling:sendSignal') return side.send(args.kind!, args.payload!);
      if (name === 'signaling:markConnected') return markConnected(args);
      throw new Error('unexpected mutation');
    }),
    watchQuery: vi.fn(() => {
      let latest: { id: string; kind: 'offer' | 'answer' | 'ice'; payload: string; createdAt: number }[] | undefined;
      const listeners = new Set<() => void>();
      side.subscribe((inbox) => {
        latest = inbox.map((s) => ({ ...s, createdAt: 0 }));
        for (const l of listeners) l();
      });
      return {
        onUpdate: (cb: () => void) => {
          listeners.add(cb);
          return () => listeners.delete(cb);
        },
        localQueryResult: () => latest,
      };
    }),
  };
}

describe('connectToOpponent', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('connects through Convex signaling and only the host marks the match playing', async () => {
    const rtc = createFakeRtcPair();
    const bus = createSignalBus();
    const host = fakeConvex(bus.host);
    const guest = fakeConvex(bus.guest);
    const common = { matchId: MATCH, iceServers: ICE };
    const links = await Promise.all([
      connectToOpponent({ ...common, convex: host as never, playerId: 'h', role: 'host', createPeerConnection: rtc.createHost }),
      connectToOpponent({ ...common, convex: guest as never, playerId: 'g', role: 'guest', createPeerConnection: rtc.createGuest }),
    ]);
    expect(host.markConnected).toHaveBeenCalledTimes(1);
    expect(host.markConnected).toHaveBeenCalledWith({ playerId: 'h', matchId: MATCH });
    expect(guest.markConnected).not.toHaveBeenCalled();
    for (const link of links) link.close();
  });

  it('closes the link when the match cannot be marked playing', async () => {
    const rtc = createFakeRtcPair();
    const bus = createSignalBus();
    const host = fakeConvex(bus.host, vi.fn().mockRejectedValue(new Error('Match is not connecting')));
    const guest = fakeConvex(bus.guest);
    const common = { matchId: MATCH, iceServers: ICE };
    const [hostResult, guestLink] = await Promise.allSettled([
      connectToOpponent({ ...common, convex: host as never, playerId: 'h', role: 'host', createPeerConnection: rtc.createHost }),
      connectToOpponent({ ...common, convex: guest as never, playerId: 'g', role: 'guest', createPeerConnection: rtc.createGuest }),
    ]);
    expect(hostResult.status).toBe('rejected');
    expect(rtc.host.closed).toBe(true);
    if (guestLink.status === 'fulfilled') guestLink.value.close();
  });

  it('every match is relay-only', async () => {
    const rtc = createFakeRtcPair();
    const bus = createSignalBus();
    const host = fakeConvex(bus.host);
    const guest = fakeConvex(bus.guest);
    const common = { matchId: MATCH, iceServers: ICE };
    const links = await Promise.all([
      connectToOpponent({ ...common, convex: host as never, playerId: 'h', role: 'host', createPeerConnection: rtc.createHost }),
      connectToOpponent({ ...common, convex: guest as never, playerId: 'g', role: 'guest', createPeerConnection: rtc.createGuest }),
    ]);
    expect(host.turn).toHaveBeenCalledWith({ playerId: 'h', matchId: MATCH });
    expect(guest.turn).toHaveBeenCalledWith({ playerId: 'g', matchId: MATCH });
    expect(rtc.host.config).toEqual({ iceServers: [...ICE, ...TURN], iceTransportPolicy: 'relay' });
    expect(rtc.guest.config).toEqual({ iceServers: [...ICE, ...TURN], iceTransportPolicy: 'relay' });
    for (const link of links) link.close();
  });

  it('a match waits 10 s for TURN before giving up', async () => {
    vi.useFakeTimers();
    const bus = createSignalBus();
    const host = fakeConvex(bus.host, undefined, vi.fn(() => new Promise<never>(() => {})));
    let failure: unknown;
    void connectToOpponent({ matchId: MATCH, iceServers: ICE, convex: host as never, playerId: 'h', role: 'host' }).catch(
      (err: unknown) => (failure = err),
    );

    await vi.advanceTimersByTimeAsync(9999);
    expect(failure).toBeUndefined();

    await vi.advanceTimersByTimeAsync(1);
    expect(failure).toBeInstanceOf(RelayUnavailableError);
  });

  it('a match without TURN fails before creating a connection or sending a signal', async () => {
    const rtc = createFakeRtcPair();
    const bus = createSignalBus();
    const unavailable = () => vi.fn().mockRejectedValue(new Error('TURN_UNAVAILABLE'));
    const host = fakeConvex(bus.host, undefined, unavailable());
    const guest = fakeConvex(bus.guest, undefined, unavailable());
    const createHost = vi.fn(rtc.createHost);
    const createGuest = vi.fn(rtc.createGuest);
    const quick = { matchId: MATCH, iceServers: ICE };
    const results = await Promise.allSettled([
      connectToOpponent({ ...quick, convex: host as never, playerId: 'h', role: 'host', createPeerConnection: createHost }),
      connectToOpponent({ ...quick, convex: guest as never, playerId: 'g', role: 'guest', createPeerConnection: createGuest }),
    ]);
    for (const result of results) {
      expect(result.status).toBe('rejected');
      if (result.status === 'rejected') {
        // Its own error, not a PeerError: nothing was attempted with the peer, and the player is told why.
        expect(result.reason).toBeInstanceOf(RelayUnavailableError);
        expect(result.reason).not.toBeInstanceOf(PeerError);
      }
    }
    expect(host.turn).toHaveBeenCalledTimes(1);
    expect(guest.turn).toHaveBeenCalledTimes(1);
    expect(createHost).not.toHaveBeenCalled();
    expect(createGuest).not.toHaveBeenCalled();
    expect(bus.sentBy('host')).toEqual([]);
    expect(bus.sentBy('guest')).toEqual([]);
    expect(host.mutation).not.toHaveBeenCalled();
    expect(guest.mutation).not.toHaveBeenCalled();
  });
});
