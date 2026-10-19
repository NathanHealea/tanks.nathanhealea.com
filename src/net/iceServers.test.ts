import { describe, expect, it } from 'vitest';
import { DEFAULT_ICE_SERVERS, iceServersFromEnv } from './iceServers';

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
});
