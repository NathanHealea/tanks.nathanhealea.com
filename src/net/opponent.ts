import type { ConvexReactClient } from 'convex/react';
import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { iceServersFromEnv, withTurn } from './iceServers';
import type { Link } from './link';
import { connectPeer, type SignalTransport } from './peer';

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

/** The match could not get the relay it requires; distinct from PeerError, since the peer was never tried. */
export class RelayUnavailableError extends Error {
  constructor() {
    super('RELAY_UNAVAILABLE');
    this.name = 'RelayUnavailableError';
  }
}

// Giving up on TURN fails the match outright, since there is no direct fallback, so it is given time to answer.
const RELAY_WAIT_MS = 10_000;

/**
 * Connects to the opponent in a matched game. The host then marks the match playing, which also deletes its signals
 * and the IP addresses in them; if that fails the link is closed so neither side plays an unrecorded match.
 */
export async function connectToOpponent(options: {
  convex: ConvexLike;
  matchId: Id<'matches'>;
  playerId: string;
  role: 'host' | 'guest';
  iceServers?: RTCIceServer[];
  createPeerConnection?: (config: RTCConfiguration) => RTCPeerConnection;
}): Promise<Link> {
  const { convex, matchId, playerId, role } = options;
  const base = options.iceServers ?? iceServersFromEnv(import.meta.env.VITE_ICE_SERVERS);
  const turn = await withTurn(
    base,
    () => convex.action(api.turn.turnCredentials, { playerId, matchId }),
    RELAY_WAIT_MS,
  );
  // No player's address may reach another (R6, user decision 2026-10-19), so without a relay a match does not connect
  // at all. Failing before the peer connection exists means no candidate is ever gathered or sent.
  if (!turn.relay) {
    console.error('A match needs a TURN relay and none is available');
    throw new RelayUnavailableError();
  }
  const link = await connectPeer({
    role,
    signals: convexSignals(convex, matchId, playerId),
    iceServers: turn.iceServers,
    iceTransportPolicy: 'relay',
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
