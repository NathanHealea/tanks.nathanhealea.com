import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLinkPair, type Channel } from './link';
import { LinkWatch, parseControl, PING_MS, SILENCE_REPORT_MS, SILENCE_WARN_MS, type LinkHealth } from './silence';

function watchOnePair() {
  const [watched, peer] = createLinkPair();
  const atPeer: [Channel, unknown][] = [];
  peer.onMessage((channel, raw) => atPeer.push([channel, JSON.parse(raw)]));
  const handlers = {
    onHealth: vi.fn<(health: LinkHealth) => void>(),
    onLost: vi.fn<() => void>(),
    onBye: vi.fn<() => void>(),
  };
  const watch = new LinkWatch(watched, handlers);
  return { watch, peer, atPeer, handlers };
}

describe('LinkWatch', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('uses the timings R3 states', () => {
    expect(PING_MS).toBe(1000);
    expect(SILENCE_WARN_MS).toBe(5000);
    expect(SILENCE_REPORT_MS).toBe(15000);
  });

  it('silence timer shows countdown then reports', () => {
    const { peer, handlers } = watchOnePair();

    vi.advanceTimersByTime(4000);
    expect(handlers.onHealth).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1000);
    expect(handlers.onHealth).toHaveBeenCalledTimes(1);
    expect(handlers.onHealth).toHaveBeenLastCalledWith({ state: 'lost', secondsLeft: 10 });

    vi.advanceTimersByTime(1000);
    expect(handlers.onHealth).toHaveBeenCalledTimes(2);
    expect(handlers.onHealth).toHaveBeenLastCalledWith({ state: 'lost', secondsLeft: 9 });

    vi.advanceTimersByTime(1000);
    expect(handlers.onHealth).toHaveBeenLastCalledWith({ state: 'lost', secondsLeft: 8 });
    const beforeMessage = handlers.onHealth.mock.calls.length;

    // At 7 s a snapshot arrives: any message on either channel clears the warning.
    peer.send('state', JSON.stringify({ t: 'snap' }));
    vi.advanceTimersByTime(0);
    expect(handlers.onHealth).toHaveBeenCalledTimes(beforeMessage + 1);
    expect(handlers.onHealth).toHaveBeenLastCalledWith({ state: 'ok' });

    vi.advanceTimersByTime(4000);
    expect(handlers.onHealth).toHaveBeenCalledTimes(beforeMessage + 1);

    vi.advanceTimersByTime(1000);
    expect(handlers.onHealth).toHaveBeenLastCalledWith({ state: 'lost', secondsLeft: 10 });
    expect(handlers.onLost).not.toHaveBeenCalled();

    // 15 s after the message at 7 s.
    vi.advanceTimersByTime(9000);
    expect(handlers.onLost).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(handlers.onLost).toHaveBeenCalledTimes(1);
    const healthAtReport = handlers.onHealth.mock.calls.length;

    vi.advanceTimersByTime(5000);
    expect(handlers.onLost).toHaveBeenCalledTimes(1);
    expect(handlers.onHealth).toHaveBeenCalledTimes(healthAtReport);
    expect(handlers.onBye).not.toHaveBeenCalled();
  });

  it('a ping on ctrl also counts as a message', () => {
    const { peer, handlers } = watchOnePair();

    vi.advanceTimersByTime(6000);
    expect(handlers.onHealth).toHaveBeenLastCalledWith({ state: 'lost', secondsLeft: 9 });

    peer.send('ctrl', JSON.stringify({ t: 'ping' }));
    vi.advanceTimersByTime(0);
    expect(handlers.onHealth).toHaveBeenLastCalledWith({ state: 'ok' });
    expect(handlers.onBye).not.toHaveBeenCalled();
  });

  it('sends a ping on ctrl every second', () => {
    const { atPeer } = watchOnePair();

    // The link pair delivers on a 0 ms timeout, which timers run 1 ms later, so each check is 1 ms after a ping.
    vi.advanceTimersByTime(1000);
    expect(atPeer).toEqual([]);

    vi.advanceTimersByTime(1);
    expect(atPeer).toEqual([['ctrl', { t: 'ping' }]]);

    vi.advanceTimersByTime(2000);
    expect(atPeer).toEqual([
      ['ctrl', { t: 'ping' }],
      ['ctrl', { t: 'ping' }],
      ['ctrl', { t: 'ping' }],
    ]);
  });

  it('bye sends a bye on ctrl and the receiving side reports it once', () => {
    const { watch, atPeer, peer, handlers } = watchOnePair();

    watch.bye();
    vi.advanceTimersByTime(0);
    expect(atPeer).toEqual([['ctrl', { t: 'bye' }]]);

    peer.send('ctrl', JSON.stringify({ t: 'bye' }));
    vi.advanceTimersByTime(0);
    expect(handlers.onBye).toHaveBeenCalledTimes(1);
  });

  it('a bye does not stop the silence report, in case the leave never reaches the server', () => {
    const { peer, handlers } = watchOnePair();
    peer.send('ctrl', JSON.stringify({ t: 'bye' }));
    vi.advanceTimersByTime(0);
    expect(handlers.onBye).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(14_000);
    expect(handlers.onLost).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(handlers.onLost).toHaveBeenCalledTimes(1);
  });

  it('says nothing while messages keep arriving', () => {
    const { peer, handlers } = watchOnePair();
    for (let i = 0; i < 10; i++) {
      peer.send('state', JSON.stringify({ t: 'snap' }));
      vi.advanceTimersByTime(1000);
    }
    expect(handlers.onHealth).not.toHaveBeenCalled();
  });

  it('rounds the seconds left up, so the countdown never shows a second too few', () => {
    const { peer, handlers } = watchOnePair();
    vi.advanceTimersByTime(499);
    peer.send('ctrl', JSON.stringify({ t: 'ping' }));
    // Delivered at 500 ms; at the 6 s tick 5.5 s have passed, leaving 9.5 s.
    vi.advanceTimersByTime(5501);
    expect(handlers.onHealth).toHaveBeenLastCalledWith({ state: 'lost', secondsLeft: 10 });
  });

  it('a repeated bye is reported once, and only a bye on ctrl counts', () => {
    const { peer, handlers } = watchOnePair();
    peer.send('state', JSON.stringify({ t: 'bye' }));
    vi.advanceTimersByTime(1);
    expect(handlers.onBye).not.toHaveBeenCalled();
    peer.send('ctrl', JSON.stringify({ t: 'bye' }));
    peer.send('ctrl', JSON.stringify({ t: 'bye' }));
    vi.advanceTimersByTime(1);
    expect(handlers.onBye).toHaveBeenCalledTimes(1);
  });

  it('dispose stops pings, warnings, reports and message handling', () => {
    const { watch, peer, atPeer, handlers } = watchOnePair();

    vi.advanceTimersByTime(2001);
    expect(atPeer).toHaveLength(2);

    watch.dispose();
    vi.advanceTimersByTime(30000);
    peer.send('ctrl', JSON.stringify({ t: 'bye' }));
    vi.advanceTimersByTime(0);

    expect(atPeer).toHaveLength(2);
    expect(handlers.onHealth).not.toHaveBeenCalled();
    expect(handlers.onLost).not.toHaveBeenCalled();
    expect(handlers.onBye).not.toHaveBeenCalled();
  });
});

describe('parseControl', () => {
  it('reads ping and bye', () => {
    expect(parseControl('{"t":"ping"}')).toBe('ping');
    expect(parseControl('{"t":"bye"}')).toBe('bye');
  });

  it('returns null for other messages and malformed input', () => {
    expect(parseControl('{"t":"roundStart","round":1}')).toBeNull();
    expect(parseControl('{"t":"snap"}')).toBeNull();
    expect(parseControl('{}')).toBeNull();
    expect(parseControl('null')).toBeNull();
    expect(parseControl('"bye"')).toBeNull();
    expect(parseControl('{"t":"bye"')).toBeNull();
    expect(parseControl('')).toBeNull();
  });
});
