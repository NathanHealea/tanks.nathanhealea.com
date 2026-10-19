import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_ICE_SERVERS, iceServersFromEnv, TURN_WAIT_MS, withTurn } from './iceServers';

describe('iceServersFromEnv', () => {
  it('ice servers come from env or default', () => {
    expect(DEFAULT_ICE_SERVERS).toEqual([{ urls: 'stun:stun.cloudflare.com:3478' }]);

    const configured = [
      { urls: 'stun:stun.example.test:3478' },
      { urls: ['turn:turn.example.test:3478', 'turns:turn.example.test:5349'], username: 'user', credential: 'secret' },
    ];
    expect(iceServersFromEnv(JSON.stringify(configured))).toEqual(configured);

    for (const raw of [
      undefined,
      '',
      'not json',
      '{"urls":"stun:stun.example.test:3478"}',
      '[{"username":"user"}]',
      '[{"urls":42}]',
      '[{"urls":"stun:stun.example.test:3478"},{"credential":"secret"}]',
    ]) {
      expect(iceServersFromEnv(raw), String(raw)).toEqual(DEFAULT_ICE_SERVERS);
    }
  });

  it.each(['[]', '[null]', '[{"urls":[1]}]'])('falls back to the default for %s', (raw) => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(iceServersFromEnv(raw)).toEqual(DEFAULT_ICE_SERVERS);
    errors.mockRestore();
  });
});

describe('withTurn', () => {
  const TURN: RTCIceServer[] = [
    { urls: ['turn:turn.example.test:3478', 'turns:turn.example.test:5349'], username: 'user', credential: 'secret' },
  ];

  afterEach(() => {
    vi.useRealTimers();
  });

  it('adds TURN servers when the action answers in time', async () => {
    const result = await withTurn(DEFAULT_ICE_SERVERS, () => Promise.resolve({ iceServers: TURN }));
    expect(result).toEqual({ iceServers: [...DEFAULT_ICE_SERVERS, ...TURN], relay: true });
  });

  it('client falls back to stun', async () => {
    expect(TURN_WAIT_MS).toBe(3000);

    const rejected = await withTurn(DEFAULT_ICE_SERVERS, () => Promise.reject(new Error('TURN_UNAVAILABLE')));
    expect(rejected).toEqual({ iceServers: DEFAULT_ICE_SERVERS, relay: false });

    const empty = await withTurn(DEFAULT_ICE_SERVERS, () => Promise.resolve({ iceServers: [] }));
    expect(empty).toEqual({ iceServers: DEFAULT_ICE_SERVERS, relay: false });
  });

  it('client falls back to stun when the action takes 3 s', async () => {
    vi.useFakeTimers();
    let answer: (value: { iceServers: RTCIceServer[] }) => void = () => {};
    const getTurn = () => new Promise<{ iceServers: RTCIceServer[] }>((resolve) => (answer = resolve));
    let result: { iceServers: RTCIceServer[]; relay: boolean } | undefined;
    void withTurn(DEFAULT_ICE_SERVERS, getTurn).then((value) => (result = value));

    await vi.advanceTimersByTimeAsync(2999);
    expect(result).toBeUndefined();

    await vi.advanceTimersByTimeAsync(1);
    expect(result).toEqual({ iceServers: DEFAULT_ICE_SERVERS, relay: false });

    answer({ iceServers: TURN });
    await vi.advanceTimersByTimeAsync(0);
    expect(result).toEqual({ iceServers: DEFAULT_ICE_SERVERS, relay: false });
  });
});
