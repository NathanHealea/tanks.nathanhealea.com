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

  function lateStateGuest(rtc: ReturnType<typeof createFakeRtcPair>) {
    return (config: RTCConfiguration) => {
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
  }

  it('a version mismatch reaches both sides even when one opens late', async () => {
    const rtc = createFakeRtcPair();
    const bus = createSignalBus();
    const both = Promise.allSettled([
      connectPeer({ role: 'host', signals: bus.host, iceServers: ICE_SERVERS, createPeerConnection: rtc.createHost }),
      connectPeer({
        role: 'guest', signals: bus.guest, iceServers: ICE_SERVERS, createPeerConnection: lateStateGuest(rtc),
        protocolVersion: PROTOCOL_VERSION + 1,
      }),
    ]);
    const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('a side waited for the timeout')), 1_000));
    const outcomes = (await Promise.race([both, timeout])) as PromiseSettledResult<unknown>[];
    for (const outcome of outcomes) {
      expect((outcome as PromiseRejectedResult).reason).toMatchObject({ code: 'VERSION_MISMATCH' });
    }
  });

  it('stops sending ICE candidates once connected', async () => {
    const rtc = createFakeRtcPair();
    const bus = createSignalBus();
    const links = await Promise.all([
      connectPeer({ role: 'host', signals: bus.host, iceServers: ICE_SERVERS, createPeerConnection: rtc.createHost }),
      connectPeer({ role: 'guest', signals: bus.guest, iceServers: ICE_SERVERS, createPeerConnection: rtc.createGuest }),
    ]);
    expect(rtc.host.onicecandidate).toBeNull();
    expect(rtc.guest.onicecandidate).toBeNull();
    for (const link of links) link.close();
  });

  it('an unusable ICE config fails as CONNECT_FAILED', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const bus = createSignalBus();
    const attempt = connectPeer({
      role: 'host', signals: bus.host, iceServers: ICE_SERVERS,
      createPeerConnection: () => {
        throw new DOMException('bad url', 'SyntaxError');
      },
    });
    await expect(attempt).rejects.toMatchObject({ code: 'CONNECT_FAILED' });
    errors.mockRestore();
  });

  it('a null hello fails cleanly', async () => {
    const rtc = createFakeRtcPair();
    const bus = createSignalBus();
    const host = connectPeer({ role: 'host', signals: bus.host, iceServers: ICE_SERVERS, createPeerConnection: rtc.createHost });
    // The guest side is driven by hand: answer the offer, then send null instead of a hello.
    const guestPc = rtc.createGuest({ iceServers: ICE_SERVERS });
    guestPc.ondatachannel = (event) => {
      const channel = event.channel;
      if (channel.label === 'ctrl') channel.onopen = () => channel.send('null');
    };
    const unsubscribe = bus.guest.subscribe(async (inbox) => {
      const offer = inbox.find((signal) => signal.kind === 'offer');
      if (!offer || guestPc.remoteDescription) return;
      await guestPc.setRemoteDescription(JSON.parse(offer.payload));
      const answer = await guestPc.createAnswer();
      await guestPc.setLocalDescription(answer);
      await bus.guest.send('answer', JSON.stringify(answer));
    });
    await expect(host).rejects.toMatchObject({ code: 'CONNECT_FAILED' });
    unsubscribe();
  });

  it('the link closes when ICE fails after connecting', async () => {
    const rtc = createFakeRtcPair();
    const bus = createSignalBus();
    const [hostLink, guestLink] = await Promise.all([
      connectPeer({ role: 'host', signals: bus.host, iceServers: ICE_SERVERS, createPeerConnection: rtc.createHost }),
      connectPeer({ role: 'guest', signals: bus.guest, iceServers: ICE_SERVERS, createPeerConnection: rtc.createGuest }),
    ]);
    const closed = vi.fn();
    hostLink.onClose(closed);
    rtc.host.setIceState('failed');
    expect(closed).toHaveBeenCalledTimes(1);
    guestLink.close();
  });

  it('the guest answers only the first offer', async () => {
    const rtc = createFakeRtcPair();
    const bus = createSignalBus();
    const links = await Promise.all([
      connectPeer({ role: 'host', signals: bus.host, iceServers: ICE_SERVERS, createPeerConnection: rtc.createHost }),
      connectPeer({ role: 'guest', signals: bus.guest, iceServers: ICE_SERVERS, createPeerConnection: rtc.createGuest }),
    ]);
    for (const link of links) link.close();
    const stray = createSignalBus();
    const guest = connectPeer({
      role: 'guest', signals: stray.guest, iceServers: ICE_SERVERS, createPeerConnection: createFakeRtcPair().createGuest,
      timeoutMs: 200,
    });
    await stray.host.send('offer', JSON.stringify({ type: 'offer', sdp: 'fake' }));
    await stray.host.send('offer', JSON.stringify({ type: 'offer', sdp: 'fake' }));
    await guest.catch(() => {});
    expect(stray.sentBy('guest').filter((signal) => signal.kind === 'answer')).toHaveLength(1);
  });

  it('a transport that delivers the inbox synchronously is handled', async () => {
    const rtc = createFakeRtcPair();
    const bus = createSignalBus();
    await bus.host.send('ice', JSON.stringify({ candidate: 'early', sdpMid: '0', sdpMLineIndex: 0 }));
    const syncGuest = {
      send: bus.guest.send.bind(bus.guest),
      subscribe: (onInbox: (signals: Signal[]) => void) => {
        onInbox(bus.sentBy('host').map((signal) => ({ ...signal })));
        return bus.guest.subscribe(onInbox);
      },
    };
    const links = await Promise.all([
      connectPeer({ role: 'host', signals: bus.host, iceServers: ICE_SERVERS, createPeerConnection: rtc.createHost }),
      connectPeer({ role: 'guest', signals: syncGuest, iceServers: ICE_SERVERS, createPeerConnection: rtc.createGuest }),
    ]);
    for (const link of links) link.close();
  });

  it('a rejected candidate send does not fail the connection', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const rtc = createFakeRtcPair();
    const bus = createSignalBus();
    // As when the host has already marked the match playing and the server refuses late candidates.
    const refusesIce = {
      send: (kind: Signal['kind'], payload: string) =>
        kind === 'ice' ? Promise.reject(new Error('Match is not connecting')) : bus.host.send(kind, payload),
      subscribe: bus.host.subscribe.bind(bus.host),
    };
    const links = await Promise.all([
      connectPeer({ role: 'host', signals: refusesIce, iceServers: ICE_SERVERS, createPeerConnection: rtc.createHost }),
      connectPeer({ role: 'guest', signals: bus.guest, iceServers: ICE_SERVERS, createPeerConnection: rtc.createGuest }),
    ]);
    for (const link of links) link.close();
    errors.mockRestore();
  });

  it('closing one link closes the connection and fires the other side onClose once', async () => {
    vi.useFakeTimers();
    const rtc = createFakeRtcPair();
    const bus = createSignalBus();
    const both = Promise.all([
      connectPeer({ role: 'host', signals: bus.host, iceServers: ICE_SERVERS, createPeerConnection: rtc.createHost }),
      connectPeer({ role: 'guest', signals: bus.guest, iceServers: ICE_SERVERS, createPeerConnection: rtc.createGuest }),
    ]);
    await vi.advanceTimersByTimeAsync(100);
    const [hostLink, guestLink] = await both;
    const hostClosed = vi.fn();
    const guestClosed = vi.fn();
    hostLink.onClose(hostClosed);
    guestLink.onClose(guestClosed);

    hostLink.close();
    await vi.advanceTimersByTimeAsync(100);
    expect(rtc.host.closed).toBe(true);
    expect(hostClosed).toHaveBeenCalledTimes(1);
    expect(guestClosed).toHaveBeenCalledTimes(1);
  });

  it('every failure stops listening for signals', async () => {
    vi.useFakeTimers();
    const bus = createSignalBus();
    const unsubscribe = vi.fn();
    const recording = {
      send: bus.host.send.bind(bus.host),
      subscribe: (onInbox: (signals: Signal[]) => void) => {
        const stop = bus.host.subscribe(onInbox);
        return () => {
          unsubscribe();
          stop();
        };
      },
    };
    const attempt = settle(
      connectPeer({ role: 'host', signals: recording, iceServers: ICE_SERVERS, createPeerConnection: createFakeRtcPair().createHost }),
    );
    await vi.advanceTimersByTimeAsync(15_000);
    expect(attempt.error).toMatchObject({ code: 'CONNECT_TIMEOUT' });
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('a refused offer fails at once, not after the timeout', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const bus = createSignalBus();
    const refusing = { send: () => Promise.reject(new Error('Match is not connecting')), subscribe: bus.host.subscribe.bind(bus.host) };
    const started = Date.now();
    await expect(
      connectPeer({ role: 'host', signals: refusing, iceServers: ICE_SERVERS, createPeerConnection: createFakeRtcPair().createHost }),
    ).rejects.toMatchObject({ code: 'CONNECT_FAILED' });
    expect(Date.now() - started).toBeLessThan(1_000);
    errors.mockRestore();
  });

  it.each([
    ['unparseable text', 'garbage', 'CONNECT_FAILED'],
    ['a message without a type', JSON.stringify({ version: PROTOCOL_VERSION }), 'CONNECT_TIMEOUT'],
  ])('a hello that is %s does not connect', async (_label, hello, code) => {
    vi.useFakeTimers();
    const rtc = createFakeRtcPair();
    const bus = createSignalBus();
    const host = settle(connectPeer({ role: 'host', signals: bus.host, iceServers: ICE_SERVERS, createPeerConnection: rtc.createHost }));
    const guestPc = rtc.createGuest({ iceServers: ICE_SERVERS });
    guestPc.ondatachannel = (event) => {
      const channel = event.channel;
      if (channel.label === 'ctrl') channel.onopen = () => channel.send(hello);
    };
    bus.guest.subscribe(async (inbox) => {
      const offer = inbox.find((signal) => signal.kind === 'offer');
      if (!offer || guestPc.remoteDescription) return;
      await guestPc.setRemoteDescription(JSON.parse(offer.payload));
      const answer = await guestPc.createAnswer();
      await guestPc.setLocalDescription(answer);
      await bus.guest.send('answer', JSON.stringify(answer));
    });
    await vi.advanceTimersByTimeAsync(15_000);
    expect(host.error).toMatchObject({ code });
  });
});
