import { describe, expect, it, vi } from 'vitest';
import { getFunctionName, type FunctionReference } from 'convex/server';
import type { Id } from '../../convex/_generated/dataModel';
import { createFakeRtcPair, createSignalBus, type FakeSignalTransport } from './fakeRtc';
import { connectToOpponent } from './opponent';

const MATCH = 'match1' as Id<'matches'>;
const ICE: RTCIceServer[] = [{ urls: 'stun:stun.example.test:3478' }];

// A stand-in for ConvexReactClient: signaling calls go through the in-memory bus, markConnected is recorded.
function fakeConvex(side: FakeSignalTransport, markConnected = vi.fn().mockResolvedValue(null)) {
  return {
    markConnected,
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
});
