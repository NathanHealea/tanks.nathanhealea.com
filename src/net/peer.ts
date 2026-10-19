import type { Channel, Link } from './link';

/** Bumped whenever messages between the two browsers change shape, so mismatched builds refuse to play. */
export const PROTOCOL_VERSION = 1;
const CONNECT_TIMEOUT_MS = 15_000;

export type PeerErrorCode = 'VERSION_MISMATCH' | 'CONNECT_TIMEOUT' | 'CONNECT_FAILED';

export class PeerError extends Error {
  constructor(readonly code: PeerErrorCode) {
    super(code);
    this.name = 'PeerError';
  }
}

export interface Signal {
  id: string;
  kind: 'offer' | 'answer' | 'ice';
  payload: string;
}

export interface SignalTransport {
  send(kind: Signal['kind'], payload: string): Promise<unknown>;
  /** Receives the full inbox each time it changes, as a Convex query subscription does. */
  subscribe(onInbox: (signals: Signal[]) => void): () => void;
}

export interface PeerOptions {
  role: 'host' | 'guest';
  signals: SignalTransport;
  iceServers: RTCIceServer[];
  createPeerConnection?: (config: RTCConfiguration) => RTCPeerConnection;
  timeoutMs?: number;
  protocolVersion?: number;
}

/**
 * Opens a direct connection to the opponent. The host makes the offer and both data channels; setup messages travel
 * through Convex. Resolves once both channels are open and both sides run the same protocol version.
 */
export function connectPeer(options: PeerOptions): Promise<Link> {
  const {
    role,
    signals,
    iceServers,
    createPeerConnection = (config) => new RTCPeerConnection(config),
    timeoutMs = CONNECT_TIMEOUT_MS,
    protocolVersion = PROTOCOL_VERSION,
  } = options;

  return new Promise<Link>((resolve, reject) => {
    const pc = createPeerConnection({ iceServers });
    const channels: Partial<Record<Channel, RTCDataChannel>> = {};
    const seen = new Set<string>();
    const pendingIce: RTCIceCandidateInit[] = [];
    let settled = false;
    let helloSent = false;
    let peerHelloOk = false;

    const fail = (code: PeerErrorCode) => {
      if (settled) return;
      settled = true;
      cleanup();
      pc.close();
      reject(new PeerError(code));
    };
    const timer = setTimeout(() => fail('CONNECT_TIMEOUT'), timeoutMs);
    const unsubscribe = signals.subscribe((inbox) => {
      for (const signal of inbox) {
        if (seen.has(signal.id)) continue;
        seen.add(signal.id);
        handleSignal(signal).catch((err) => {
          console.error('WebRTC setup failed', err);
          fail('CONNECT_FAILED');
        });
      }
    });
    const cleanup = () => {
      clearTimeout(timer);
      unsubscribe();
    };
    const send = (kind: Signal['kind'], payload: unknown) => {
      signals.send(kind, JSON.stringify(payload)).catch((err) => {
        console.error('Sending a WebRTC setup message failed', err);
        fail('CONNECT_FAILED');
      });
    };

    pc.onicecandidate = (event) => {
      if (event.candidate) send('ice', event.candidate.toJSON ? event.candidate.toJSON() : event.candidate);
    };
    pc.oniceconnectionstatechange = () => {
      if (pc.iceConnectionState === 'failed') fail('CONNECT_FAILED');
    };

    const adopt = (channel: RTCDataChannel) => {
      if (channel.label !== 'ctrl' && channel.label !== 'state') return;
      channels[channel.label] = channel;
      channel.onopen = sayHello;
      if (channel.label === 'ctrl') channel.onmessage = (event) => onHello(String(event.data));
      sayHello();
    };

    const sayHello = () => {
      if (helloSent || channels.ctrl?.readyState !== 'open' || channels.state?.readyState !== 'open') return;
      helloSent = true;
      channels.ctrl.send(JSON.stringify({ type: 'hello', version: protocolVersion }));
      ready();
    };

    // Both sides must have sent and received a hello: resolving on receipt alone would strand a peer whose own
    // channels opened later and who is still waiting for ours.
    const ready = () => {
      if (settled || !helloSent || !peerHelloOk) return;
      settled = true;
      cleanup();
      resolve(wrap(pc, channels.ctrl!, channels.state!));
    };

    const onHello = (data: string) => {
      if (settled) return;
      let hello: { type?: unknown; version?: unknown };
      try {
        hello = JSON.parse(data);
      } catch {
        return fail('CONNECT_FAILED');
      }
      if (hello.type !== 'hello') return;
      if (hello.version !== protocolVersion) return fail('VERSION_MISMATCH');
      peerHelloOk = true;
      ready();
    };

    const handleSignal = async (signal: Signal) => {
      const payload = JSON.parse(signal.payload);
      if (signal.kind === 'ice') {
        if (pc.remoteDescription) await pc.addIceCandidate(payload);
        else pendingIce.push(payload);
        return;
      }
      if (signal.kind === 'offer' && role === 'guest') {
        await pc.setRemoteDescription(payload);
        await flushIce();
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        send('answer', pc.localDescription ?? answer);
      } else if (signal.kind === 'answer' && role === 'host') {
        await pc.setRemoteDescription(payload);
        await flushIce();
      }
    };
    const flushIce = async () => {
      for (const candidate of pendingIce.splice(0)) await pc.addIceCandidate(candidate);
    };

    if (role === 'host') {
      adopt(pc.createDataChannel('ctrl', { ordered: true }));
      adopt(pc.createDataChannel('state', { ordered: false, maxRetransmits: 0 }));
      (async () => {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        send('offer', pc.localDescription ?? offer);
      })().catch((err) => {
        console.error('Creating the WebRTC offer failed', err);
        fail('CONNECT_FAILED');
      });
    } else {
      pc.ondatachannel = (event) => adopt(event.channel);
    }
  });
}

function wrap(pc: RTCPeerConnection, ctrl: RTCDataChannel, state: RTCDataChannel): Link {
  const messageHandlers = new Set<(channel: Channel, message: string) => void>();
  const closeHandlers = new Set<() => void>();
  let closed = false;
  const onClosed = () => {
    if (closed) return;
    closed = true;
    for (const handler of closeHandlers) handler();
  };
  for (const [name, channel] of [['ctrl', ctrl], ['state', state]] as const) {
    channel.onmessage = (event) => {
      for (const handler of messageHandlers) handler(name, String(event.data));
    };
    channel.onclose = onClosed;
  }
  return {
    send(channel, message) {
      const target = channel === 'ctrl' ? ctrl : state;
      if (target.readyState === 'open') target.send(message);
    },
    onMessage(handler) {
      messageHandlers.add(handler);
      return () => messageHandlers.delete(handler);
    },
    onClose(handler) {
      closeHandlers.add(handler);
      return () => closeHandlers.delete(handler);
    },
    close() {
      ctrl.close();
      state.close();
      pc.close();
      onClosed();
    },
  };
}
