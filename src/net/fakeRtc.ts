/**
 * In-memory stand-ins for RTCPeerConnection and the Convex signal inbox, for tests.
 * Every asynchronous event goes through setTimeout(0), so delivery order is FIFO and fake timers control it.
 */

type Role = 'host' | 'guest';

const later = (fn: () => void) => {
  setTimeout(fn, 0);
};

export interface FakeIceCandidateJson {
  candidate: string;
  sdpMid: string;
  sdpMLineIndex: number;
}

export class FakeDataChannel {
  readyState: RTCDataChannelState = 'connecting';
  binaryType: BinaryType = 'arraybuffer';
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: ((event: Event) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  remote: FakeDataChannel | null = null;
  readonly sent: string[] = [];

  constructor(
    readonly label: string,
    readonly init: RTCDataChannelInit,
  ) {}

  get ordered(): boolean {
    return this.init.ordered ?? true;
  }

  get maxRetransmits(): number | null {
    return this.init.maxRetransmits ?? null;
  }

  send(data: string): void {
    if (this.readyState !== 'open') throw new DOMException('channel not open', 'InvalidStateError');
    this.sent.push(data);
    const target = this.remote;
    later(() => {
      if (target && target.readyState === 'open') target.onmessage?.({ data });
    });
  }

  close(): void {
    if (this.readyState === 'closed') return;
    this.readyState = 'closed';
    later(() => this.onclose?.(new Event('close')));
    this.remote?.closeFromRemote();
  }

  open(): void {
    if (this.readyState !== 'connecting') return;
    this.readyState = 'open';
    this.onopen?.(new Event('open'));
  }

  closeSilently(): void {
    if (this.readyState === 'closed') return;
    this.readyState = 'closed';
    this.remote?.closeFromRemote();
  }

  private closeFromRemote(): void {
    later(() => {
      if (this.readyState === 'closed') return;
      this.readyState = 'closed';
      this.onclose?.(new Event('close'));
    });
  }
}

export class FakePeerConnection {
  localDescription: RTCSessionDescriptionInit | null = null;
  remoteDescription: RTCSessionDescriptionInit | null = null;
  iceConnectionState: RTCIceConnectionState = 'new';
  connectionState: RTCPeerConnectionState = 'new';
  signalingState: RTCSignalingState = 'stable';
  onicecandidate: ((event: { candidate: { toJSON(): FakeIceCandidateJson } | null }) => void) | null = null;
  ondatachannel: ((event: { channel: FakeDataChannel }) => void) | null = null;
  oniceconnectionstatechange: ((event: Event) => void) | null = null;
  onconnectionstatechange: ((event: Event) => void) | null = null;

  readonly createdChannels: FakeDataChannel[] = [];
  readonly receivedChannels: FakeDataChannel[] = [];
  readonly addedCandidates: RTCIceCandidateInit[] = [];
  closed = false;
  private pending: RTCSessionDescriptionInit | null = null;

  constructor(
    readonly role: Role,
    readonly config: RTCConfiguration,
    private readonly onDescriptionChange: () => void,
  ) {}

  createDataChannel(label: string, init: RTCDataChannelInit = {}): FakeDataChannel {
    const channel = new FakeDataChannel(label, init);
    this.createdChannels.push(channel);
    return channel;
  }

  async createOffer(): Promise<RTCSessionDescriptionInit> {
    this.pending = { type: 'offer', sdp: fakeSdp(this.role) };
    return { ...this.pending };
  }

  async createAnswer(): Promise<RTCSessionDescriptionInit> {
    if (!this.remoteDescription) throw new DOMException('no remote offer', 'InvalidStateError');
    this.pending = { type: 'answer', sdp: fakeSdp(this.role) };
    return { ...this.pending };
  }

  async setLocalDescription(description?: RTCSessionDescriptionInit): Promise<void> {
    const next = description ?? this.pending;
    if (!next) throw new DOMException('nothing to set', 'InvalidStateError');
    this.localDescription = { type: next.type, sdp: next.sdp };
    later(() => {
      if (this.closed) return;
      this.onicecandidate?.({ candidate: fakeCandidate(this.role) });
      later(() => {
        if (!this.closed) this.onicecandidate?.({ candidate: null });
      });
    });
    this.onDescriptionChange();
  }

  async setRemoteDescription(description: RTCSessionDescriptionInit): Promise<void> {
    this.remoteDescription = { type: description.type, sdp: description.sdp };
    this.onDescriptionChange();
  }

  async addIceCandidate(candidate?: RTCIceCandidateInit | null): Promise<void> {
    if (!this.remoteDescription) throw new DOMException('remote description not set', 'InvalidStateError');
    if (candidate) this.addedCandidates.push(candidate);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.signalingState = 'closed';
    this.iceConnectionState = 'closed';
    this.connectionState = 'closed';
    for (const channel of [...this.createdChannels, ...this.receivedChannels]) channel.closeSilently();
  }

  /** Test helper: drive ICE to `state` and fire the state-change handlers. */
  setIceState(state: RTCIceConnectionState): void {
    this.iceConnectionState = state;
    this.oniceconnectionstatechange?.(new Event('iceconnectionstatechange'));
    const connection: RTCPeerConnectionState | null =
      state === 'failed' ? 'failed' : state === 'connected' ? 'connected' : null;
    if (connection) {
      this.connectionState = connection;
      this.onconnectionstatechange?.(new Event('connectionstatechange'));
    }
  }

  get negotiated(): boolean {
    return this.localDescription !== null && this.remoteDescription !== null;
  }
}

/** Each player's own address (RFC 5737 documentation range); it must never reach the other player. */
export function playerAddress(role: Role): string {
  return `203.0.113.${role === 'host' ? 1 : 2}`;
}

function relayAddress(role: Role): string {
  return `198.51.100.${role === 'host' ? 1 : 2}`;
}

function fakeSdp(role: Role): string {
  return ['v=0', `a=candidate:1 1 udp 41885439 ${relayAddress(role)} 50000 typ relay raddr ${playerAddress(role)} rport 54321`, ''].join('\r\n');
}

function fakeCandidate(role: Role) {
  const json: FakeIceCandidateJson = {
    // A relay candidate whose related address is the player's own public address, as relay-only play produces.
    candidate: `candidate:1 1 udp 41885439 ${relayAddress(role)} 50000 typ relay raddr ${playerAddress(role)} rport 54321`,
    sdpMid: '0',
    sdpMLineIndex: 0,
  };
  return { ...json, toJSON: () => ({ ...json }) };
}

export interface FakeRtcPair {
  createHost: (config: RTCConfiguration) => RTCPeerConnection;
  createGuest: (config: RTCConfiguration) => RTCPeerConnection;
  /** The connection the host factory made; throws if it has not been called. */
  readonly host: FakePeerConnection;
  readonly guest: FakePeerConnection;
}

/** Two fake peer connections that open their data channels to each other once both have local and remote descriptions. */
export function createFakeRtcPair(): FakeRtcPair {
  const made: Partial<Record<Role, FakePeerConnection>> = {};
  let linked = false;

  const maybeLink = () => {
    const { host, guest } = made;
    if (linked || !host || !guest || !host.negotiated || !guest.negotiated) return;
    linked = true;
    later(() => {
      if (host.closed || guest.closed) return;
      host.setIceState('connected');
      guest.setIceState('connected');
      const pairs: [FakeDataChannel, FakeDataChannel][] = [];
      for (const [from, to] of [
        [host, guest],
        [guest, host],
      ] as const) {
        for (const local of from.createdChannels) {
          const mirror = new FakeDataChannel(local.label, local.init);
          local.remote = mirror;
          mirror.remote = local;
          to.receivedChannels.push(mirror);
          to.ondatachannel?.({ channel: mirror });
          pairs.push([local, mirror]);
        }
      }
      later(() => {
        for (const [local, mirror] of pairs) {
          if (local.readyState === 'connecting' && mirror.readyState === 'connecting') {
            local.open();
            mirror.open();
          }
        }
      });
    });
  };

  const factory = (role: Role) => (config: RTCConfiguration) => {
    if (made[role]) throw new Error(`fake ${role} peer connection already created`);
    const connection = new FakePeerConnection(role, config, maybeLink);
    made[role] = connection;
    return connection as unknown as RTCPeerConnection;
  };

  const get = (role: Role) => {
    const connection = made[role];
    if (!connection) throw new Error(`fake ${role} peer connection was never created`);
    return connection;
  };

  return {
    createHost: factory('host'),
    createGuest: factory('guest'),
    get host() {
      return get('host');
    },
    get guest() {
      return get('guest');
    },
  };
}

export interface FakeSignal {
  id: string;
  kind: 'offer' | 'answer' | 'ice';
  payload: string;
}

export interface FakeSignalTransport {
  send(kind: FakeSignal['kind'], payload: string): Promise<unknown>;
  subscribe(onInbox: (signals: FakeSignal[]) => void): () => void;
}

export interface FakeSignalBus {
  host: FakeSignalTransport;
  guest: FakeSignalTransport;
  /** Signals the given role has sent, oldest first. */
  sentBy(role: Role): FakeSignal[];
}

/**
 * Two signal transports with Convex query semantics: each subscriber gets the full inbox
 * on subscribe and again after every change, so the same signal is seen many times.
 */
export function createSignalBus(): FakeSignalBus {
  const inbox: Record<Role, FakeSignal[]> = { host: [], guest: [] };
  const subscribers: Record<Role, Set<(signals: FakeSignal[]) => void>> = { host: new Set(), guest: new Set() };
  let nextId = 1;

  const notify = (role: Role) => {
    const snapshot = [...inbox[role]];
    later(() => {
      for (const subscriber of subscribers[role]) subscriber([...snapshot]);
    });
  };

  const transport = (self: Role): FakeSignalTransport => {
    const other: Role = self === 'host' ? 'guest' : 'host';
    return {
      async send(kind, payload) {
        const signal = { id: `sig-${nextId++}`, kind, payload };
        inbox[other].push(signal);
        notify(other);
        return signal.id;
      },
      subscribe(onInbox) {
        subscribers[self].add(onInbox);
        const snapshot = [...inbox[self]];
        later(() => {
          if (subscribers[self].has(onInbox)) onInbox(snapshot);
        });
        return () => {
          subscribers[self].delete(onInbox);
        };
      },
    };
  };

  return {
    host: transport('host'),
    guest: transport('guest'),
    sentBy: (role) => [...inbox[role === 'host' ? 'guest' : 'host']],
  };
}
