import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFakeRtcPair, createSignalBus } from './fakeRtc';
import type { Channel } from './link';
import { connectPeer, PeerError, PROTOCOL_VERSION, type Signal } from './peer';

const ICE_SERVERS: RTCIceServer[] = [{ urls: 'stun:stun.example.test:3478' }];

function settle<T>(promise: Promise<T>) {
  const result: { done: boolean; value?: T; error?: unknown } = { done: false };
  promise.then(
    (value) => Object.assign(result, { done: true, value }),
    (error: unknown) => Object.assign(result, { done: true, error }),
  );
  return result;
}

describe('connectPeer', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('host and guest negotiate', async () => {
    const rtc = createFakeRtcPair();
    const bus = createSignalBus();

    const [hostLink, guestLink] = await Promise.all([
      connectPeer({ role: 'host', signals: bus.host, iceServers: ICE_SERVERS, createPeerConnection: rtc.createHost }),
      connectPeer({ role: 'guest', signals: bus.guest, iceServers: ICE_SERVERS, createPeerConnection: rtc.createGuest }),
    ]);

    expect(rtc.host.config.iceServers).toEqual(ICE_SERVERS);
    expect(rtc.guest.config.iceServers).toEqual(ICE_SERVERS);

    const created = rtc.host.createdChannels.map((channel) => [channel.label, channel.init]);
    expect(created).toEqual([
      ['ctrl', { ordered: true }],
      ['state', { ordered: false, maxRetransmits: 0 }],
    ]);
    expect(rtc.guest.createdChannels).toEqual([]);

    const hostSent = bus.sentBy('host').map((signal) => signal.kind);
    const guestSent = bus.sentBy('guest').map((signal) => signal.kind);
    expect(hostSent).toContain('offer');
    expect(hostSent).toContain('ice');
    expect(hostSent).not.toContain('answer');
    expect(guestSent).toContain('answer');
    expect(guestSent).toContain('ice');
    expect(guestSent).not.toContain('offer');
    expect(rtc.guest.addedCandidates.map((c) => c.candidate)).toEqual([expect.stringContaining('192.0.2.1')]);
    expect(rtc.host.addedCandidates.map((c) => c.candidate)).toEqual([expect.stringContaining('192.0.2.2')]);

    const atGuest: [Channel, string][] = [];
    guestLink.onMessage((channel, message) => atGuest.push([channel, message]));
    hostLink.send('ctrl', 'ping');
    hostLink.send('state', 'tick');
    await vi.waitFor(() => expect(atGuest).toHaveLength(2));
    expect(atGuest).toEqual(
      expect.arrayContaining([
        ['ctrl', 'ping'],
        ['state', 'tick'],
      ]),
    );

    hostLink.close();
    guestLink.close();
  });

  it('version mismatch fails both sides', async () => {
    const rtc = createFakeRtcPair();
    const bus = createSignalBus();

    const [host, guest] = await Promise.allSettled([
      connectPeer({ role: 'host', signals: bus.host, iceServers: ICE_SERVERS, createPeerConnection: rtc.createHost }),
      connectPeer({
        role: 'guest',
        signals: bus.guest,
        iceServers: ICE_SERVERS,
        createPeerConnection: rtc.createGuest,
        protocolVersion: PROTOCOL_VERSION + 1,
      }),
    ]);

    for (const outcome of [host, guest]) {
      expect(outcome.status).toBe('rejected');
      const reason = (outcome as PromiseRejectedResult).reason;
      expect(reason).toBeInstanceOf(PeerError);
      expect(reason).toMatchObject({ code: 'VERSION_MISMATCH' });
    }
    expect(rtc.host.closed).toBe(true);
    expect(rtc.guest.closed).toBe(true);
  });

  it('connect times out', async () => {
    vi.useFakeTimers();
    const rtc = createFakeRtcPair();
    const bus = createSignalBus();

    const result = settle(
      connectPeer({ role: 'host', signals: bus.host, iceServers: ICE_SERVERS, createPeerConnection: rtc.createHost }),
    );

    await vi.advanceTimersByTimeAsync(14_999);
    expect(result.done).toBe(false);
    expect(rtc.host.closed).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    expect(result.done).toBe(true);
    expect(result.error).toBeInstanceOf(PeerError);
    expect(result.error).toMatchObject({ code: 'CONNECT_TIMEOUT' });
    expect(rtc.host.closed).toBe(true);
  });

  it('ice failure fails fast', async () => {
    vi.useFakeTimers();
    const rtc = createFakeRtcPair();
    const bus = createSignalBus();

    const result = settle(
      connectPeer({ role: 'host', signals: bus.host, iceServers: ICE_SERVERS, createPeerConnection: rtc.createHost }),
    );
    await vi.advanceTimersByTimeAsync(10);
    expect(result.done).toBe(false);

    rtc.host.setIceState('failed');
    await vi.advanceTimersByTimeAsync(0);

    expect(result.done).toBe(true);
    expect(result.error).toBeInstanceOf(PeerError);
    expect(result.error).toMatchObject({ code: 'CONNECT_FAILED' });
    expect(rtc.host.closed).toBe(true);
  });

  it('ICE candidates that arrive before the offer are held until it is applied', async () => {
    const rtc = createFakeRtcPair();
    const bus = createSignalBus();
    // A browser can fire candidates before the offer's send completes, so they may reach the inbox first.
    const iceFirst = {
      send: bus.guest.send.bind(bus.guest),
      subscribe: (onInbox: (signals: Signal[]) => void) =>
        bus.guest.subscribe((inbox) => {
          if (!inbox.some((signal) => signal.kind === 'ice')) return;
          onInbox([...inbox].sort((a, b) => Number(b.kind === 'ice') - Number(a.kind === 'ice')));
        }),
    };
    const links = await Promise.all([
      connectPeer({ role: 'host', signals: bus.host, iceServers: ICE_SERVERS, createPeerConnection: rtc.createHost }),
      connectPeer({ role: 'guest', signals: iceFirst, iceServers: ICE_SERVERS, createPeerConnection: rtc.createGuest }),
    ]);
    expect(rtc.guest.addedCandidates.length).toBeGreaterThan(0);
    for (const link of links) link.close();
  });

  it('a side whose channels open late still sends its hello before either resolves', async () => {
    const rtc = createFakeRtcPair();
    const bus = createSignalBus();
    const lateGuest = (config: RTCConfiguration) => {
      const pc = rtc.createGuest(config);
      let handler: ((event: RTCDataChannelEvent) => void) | null = null;
      Object.defineProperty(pc, 'ondatachannel', {
        get: () => handler,
        set: (h: (event: RTCDataChannelEvent) => void) => {
          handler = (event) => (event.channel.label === 'state' ? setTimeout(() => h(event), 30) : h(event));
        },
      });
      return pc;
    };
    const both = Promise.all([
      connectPeer({ role: 'host', signals: bus.host, iceServers: ICE_SERVERS, createPeerConnection: rtc.createHost }),
      connectPeer({ role: 'guest', signals: bus.guest, iceServers: ICE_SERVERS, createPeerConnection: lateGuest }),
    ]);
    const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('a side never resolved')), 1_000));
    const links = (await Promise.race([both, timeout])) as Awaited<typeof both>;
    for (const link of links) link.close();
  });
});
