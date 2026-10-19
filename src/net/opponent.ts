import type { ConvexReactClient } from 'convex/react';
import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { iceServersFromEnv, withTurn } from './iceServers';
import type { Link } from './link';
import { connectPeer, PeerError, type SignalTransport } from './peer';

type ConvexLike = Pick<ConvexReactClient, 'mutation' | 'watchQuery' | 'action'>;

/** WebRTC setup messages for one match, carried by the Convex signaling functions. */
export function convexSignals(convex: ConvexLike, matchId: Id<'matches'>, playerId: string): SignalTransport {
  return {
    send: (kind, payload) => convex.mutation(api.signaling.sendSignal, { playerId, matchId, kind, payload }),
    subscribe(onInbox) {
      const watch = convex.watchQuery(api.signaling.inbox, { playerId, matchId });
      const deliver = () => {
        const inbox = watch.localQueryResult();
        if (inbox) onInbox(inbox.map(({ id, kind, payload }) => ({ id, kind, payload })));
      };
      const stop = watch.onUpdate(deliver);
      deliver();
      return stop;
    },
  };
}

/**
 * Connects to the opponent in a matched game. The host then marks the match playing, which also deletes its signals
 * and the IP addresses in them; if that fails the link is closed so neither side plays an unrecorded match.
 */
export async function connectToOpponent(options: {
  convex: ConvexLike;
  matchId: Id<'matches'>;
  playerId: string;
  role: 'host' | 'guest';
  kind: 'quick' | 'private';
  iceServers?: RTCIceServer[];
  createPeerConnection?: (config: RTCConfiguration) => RTCPeerConnection;
}): Promise<Link> {
  const { convex, matchId, playerId, role, kind } = options;
  const base = options.iceServers ?? iceServersFromEnv(import.meta.env.VITE_ICE_SERVERS);
  const turn = await withTurn(base, () => convex.action(api.turn.turnCredentials, { playerId, matchId }));
  // A quick match is against a stranger: without a relay it does not connect at all, rather than reveal an address
  // (R6). Failing before the peer connection exists means no candidate is ever gathered or sent.
  if (kind === 'quick' && !turn.relay) {
    console.error('Quick match needs a TURN relay and none is available');
    throw new PeerError('CONNECT_FAILED');
  }
  const link = await connectPeer({
    role,
    signals: convexSignals(convex, matchId, playerId),
    iceServers: turn.iceServers,
    iceTransportPolicy: kind === 'quick' ? 'relay' : 'all',
    createPeerConnection: options.createPeerConnection,
  });
  if (role === 'host') {
    try {
      await convex.mutation(api.signaling.markConnected, { playerId, matchId });
    } catch (err) {
      link.close();
      throw err;
    }
  }
  return link;
}
