import { describe, expect, it, vi } from 'vitest';
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
  turn = vi.fn().mockRejectedValue(new Error('TURN_UNAVAILABLE')),
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
  it('connects through Convex signaling and only the host marks the match playing', async () => {
    const rtc = createFakeRtcPair();
    const bus = createSignalBus();
    const host = fakeConvex(bus.host);
    const guest = fakeConvex(bus.guest);
    const common = { matchId: MATCH, iceServers: ICE, kind: 'private' as const };
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
    const common = { matchId: MATCH, iceServers: ICE, kind: 'private' as const };
    const [hostResult, guestLink] = await Promise.allSettled([
      connectToOpponent({ ...common, convex: host as never, playerId: 'h', role: 'host', createPeerConnection: rtc.createHost }),
      connectToOpponent({ ...common, convex: guest as never, playerId: 'g', role: 'guest', createPeerConnection: rtc.createGuest }),
    ]);
    expect(hostResult.status).toBe('rejected');
    expect(rtc.host.closed).toBe(true);
    if (guestLink.status === 'fulfilled') guestLink.value.close();
  });

  it('relay policy follows match kind', async () => {
    const quickRtc = createFakeRtcPair();
    const quickBus = createSignalBus();
    const quickHost = fakeConvex(quickBus.host, undefined, vi.fn().mockResolvedValue({ iceServers: TURN }));
    const quickGuest = fakeConvex(quickBus.guest, undefined, vi.fn().mockResolvedValue({ iceServers: TURN }));
    const quick = { matchId: MATCH, iceServers: ICE, kind: 'quick' as const };
    const quickLinks = await Promise.all([
      connectToOpponent({ ...quick, convex: quickHost as never, playerId: 'h', role: 'host', createPeerConnection: quickRtc.createHost }),
      connectToOpponent({ ...quick, convex: quickGuest as never, playerId: 'g', role: 'guest', createPeerConnection: quickRtc.createGuest }),
    ]);
    expect(quickHost.turn).toHaveBeenCalledWith({ playerId: 'h', matchId: MATCH });
    expect(quickGuest.turn).toHaveBeenCalledWith({ playerId: 'g', matchId: MATCH });
    expect(quickRtc.host.config).toEqual({ iceServers: [...ICE, ...TURN], iceTransportPolicy: 'relay' });
    expect(quickRtc.guest.config).toEqual({ iceServers: [...ICE, ...TURN], iceTransportPolicy: 'relay' });
    for (const link of quickLinks) link.close();

    const privateRtc = createFakeRtcPair();
    const privateBus = createSignalBus();
    const privateHost = fakeConvex(privateBus.host, undefined, vi.fn().mockResolvedValue({ iceServers: TURN }));
    const privateGuest = fakeConvex(privateBus.guest);
    const priv = { matchId: MATCH, iceServers: ICE, kind: 'private' as const };
    const privateLinks = await Promise.all([
      connectToOpponent({ ...priv, convex: privateHost as never, playerId: 'h', role: 'host', createPeerConnection: privateRtc.createHost }),
      connectToOpponent({ ...priv, convex: privateGuest as never, playerId: 'g', role: 'guest', createPeerConnection: privateRtc.createGuest }),
    ]);
    expect(privateHost.turn).toHaveBeenCalledWith({ playerId: 'h', matchId: MATCH });
    expect(privateGuest.turn).toHaveBeenCalledWith({ playerId: 'g', matchId: MATCH });
    expect(privateRtc.host.config).toEqual({ iceServers: [...ICE, ...TURN], iceTransportPolicy: 'all' });
    expect(privateRtc.guest.config).toEqual({ iceServers: ICE, iceTransportPolicy: 'all' });
    for (const link of privateLinks) link.close();
  });

  it('a quick match without TURN fails before creating a connection or sending a signal', async () => {
    const rtc = createFakeRtcPair();
    const bus = createSignalBus();
    const host = fakeConvex(bus.host);
    const guest = fakeConvex(bus.guest);
    const createHost = vi.fn(rtc.createHost);
    const createGuest = vi.fn(rtc.createGuest);
    const quick = { matchId: MATCH, iceServers: ICE, kind: 'quick' as const };
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
