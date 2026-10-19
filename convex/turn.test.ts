/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { ConvexError } from 'convex/values';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from './_generated/api';
import schema from './schema';

const modules = import.meta.glob('./**/*.*s');

const KEY_ID = 'SENTINEL-KEY-ID-7f3a';
const TOKEN = 'SENTINEL-TOKEN-91c2';
const ENDPOINT = `https://rtc.live.cloudflare.com/v1/turn/keys/${KEY_ID}/credentials/generate-ice-servers`;

type Tester = ReturnType<typeof convexTest>;
type MatchStatus = 'connecting' | 'playing' | 'finished';

async function catchError(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => {
      throw new Error('expected the call to reject');
    },
    (err: unknown) => err,
  );
}

async function expectConvexErrorAsync(promise: Promise<unknown>, message: string): Promise<void> {
  const caught = await catchError(promise);
  expect(caught).toBeInstanceOf(ConvexError);
  expect((caught as ConvexError<string>).data).toBe(message);
}

async function seedMatch(t: Tester, status: MatchStatus) {
  const hostId = crypto.randomUUID();
  const guestId = crypto.randomUUID();
  const matchId = await t.run((ctx) =>
    ctx.db.insert('matches', {
      kind: 'quick', hostId, guestId, status, seed: 1, round: 0, hostScore: 0, guestScore: 0,
      ...(status === 'finished' ? { winner: 'host' as const, endReason: 'score' as const } : {}),
      createdAt: 1000, hostSeen: 1000, guestSeen: 1000,
    }),
  );
  return { matchId, hostId, guestId };
}

function cloudflareBody() {
  return {
    iceServers: [
      { urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.cloudflare.com:53'] },
      {
        urls: [
          'turn:turn.cloudflare.com:3478?transport=udp',
          'turn:turn.cloudflare.com:53?transport=udp',
          'turn:turn.cloudflare.com:443?transport=tcp',
          'turns:turn.cloudflare.com:5349?transport=tcp',
        ],
        username: 'synthetic-user-0001',
        credential: 'synthetic-cred-0001',
        credentialType: 'password',
      },
      { urls: 'turn:turn.cloudflare.com:53' },
    ],
  };
}

function okResponse() {
  return new Response(JSON.stringify(cloudflareBody()), {
    status: 201,
    headers: { 'Content-Type': 'application/json' },
  });
}

const expectedIceServers = [
  { urls: ['stun:stun.cloudflare.com:3478'] },
  {
    urls: [
      'turn:turn.cloudflare.com:3478?transport=udp',
      'turn:turn.cloudflare.com:443?transport=tcp',
      'turns:turn.cloudflare.com:5349?transport=tcp',
    ],
    username: 'synthetic-user-0001',
    credential: 'synthetic-cred-0001',
  },
];

function expectNoSecrets(text: string) {
  expect(text).not.toContain(KEY_ID);
  expect(text).not.toContain(TOKEN);
}

function expectErrorHasNoSecrets(err: unknown) {
  expect(err).toBeInstanceOf(ConvexError);
  const convexErr = err as ConvexError<string>;
  expect(convexErr.data).toBe('TURN_UNAVAILABLE');
  expectNoSecrets(convexErr.message);
  expectNoSecrets(JSON.stringify(convexErr.data));
}

describe('turn', () => {
  beforeEach(() => {
    vi.stubEnv('CLOUDFLARE_TURN_KEY_ID', KEY_ID);
    vi.stubEnv('CLOUDFLARE_TURN_KEY_API_TOKEN', TOKEN);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('credentials only for match members', async () => {
    const fetchMock = vi.fn(async () => okResponse());
    vi.stubGlobal('fetch', fetchMock);
    const t = convexTest(schema, modules);

    const live = await seedMatch(t, 'connecting');
    await expectConvexErrorAsync(
      t.action(api.turn.turnCredentials, { playerId: crypto.randomUUID(), matchId: live.matchId }),
      'Not in this match',
    );
    const finished = await seedMatch(t, 'finished');
    await expectConvexErrorAsync(
      t.action(api.turn.turnCredentials, { playerId: finished.hostId, matchId: finished.matchId }),
      'MATCH_NOT_LIVE',
    );
    expect(fetchMock).not.toHaveBeenCalled();

    const result = await t.action(api.turn.turnCredentials, { playerId: live.hostId, matchId: live.matchId });
    expect(result).toEqual({ iceServers: expectedIceServers });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('secrets never leak', async () => {
    const t = convexTest(schema, modules);

    const success = await seedMatch(t, 'connecting');
    const okFetch = vi.fn(async () => okResponse());
    vi.stubGlobal('fetch', okFetch);
    const result = await t.action(api.turn.turnCredentials, { playerId: success.hostId, matchId: success.matchId });
    expectNoSecrets(JSON.stringify(result));
    expect(okFetch).toHaveBeenCalledTimes(1);
    expect(okFetch).toHaveBeenCalledWith(ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ttl: 3600 }),
    });

    const unauthorized = await seedMatch(t, 'playing');
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: `invalid token Bearer ${TOKEN} for key ${KEY_ID}` }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' },
          }),
      ),
    );
    expectErrorHasNoSecrets(
      await catchError(
        t.action(api.turn.turnCredentials, { playerId: unauthorized.hostId, matchId: unauthorized.matchId }),
      ),
    );

    const thrown = await seedMatch(t, 'playing');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error(`network failure sending Bearer ${TOKEN} to ${ENDPOINT}`);
      }),
    );
    expectErrorHasNoSecrets(
      await catchError(t.action(api.turn.turnCredentials, { playerId: thrown.hostId, matchId: thrown.matchId })),
    );

    const missingEnv = await seedMatch(t, 'playing');
    const unusedFetch = vi.fn(async () => okResponse());
    vi.stubGlobal('fetch', unusedFetch);
    vi.stubEnv('CLOUDFLARE_TURN_KEY_API_TOKEN', undefined);
    expectErrorHasNoSecrets(
      await catchError(
        t.action(api.turn.turnCredentials, { playerId: missingEnv.hostId, matchId: missingEnv.matchId }),
      ),
    );
  });

  it('credentials are capped per player', async () => {
    const t = convexTest(schema, modules);
    const { matchId, hostId, guestId } = await seedMatch(t, 'connecting');

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('synthetic outage');
      }),
    );
    await expectConvexErrorAsync(t.action(api.turn.turnCredentials, { playerId: hostId, matchId }), 'TURN_UNAVAILABLE');

    const fetchMock = vi.fn(async () => okResponse());
    vi.stubGlobal('fetch', fetchMock);
    expect(await t.action(api.turn.turnCredentials, { playerId: hostId, matchId })).toEqual({
      iceServers: expectedIceServers,
    });
    await expectConvexErrorAsync(t.action(api.turn.turnCredentials, { playerId: hostId, matchId }), 'TURN_LIMIT');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    expect(await t.action(api.turn.turnCredentials, { playerId: guestId, matchId })).toEqual({
      iceServers: expectedIceServers,
    });
    expect(await t.action(api.turn.turnCredentials, { playerId: guestId, matchId })).toEqual({
      iceServers: expectedIceServers,
    });
    await expectConvexErrorAsync(t.action(api.turn.turnCredentials, { playerId: guestId, matchId }), 'TURN_LIMIT');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('anything but a usable success is TURN_UNAVAILABLE', async () => {
    const t = convexTest(schema, modules);
    const json = (body: unknown, status: number) =>
      new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
    const cases: [string, Response][] = [
      ['an error status, even with a well-formed body', json(cloudflareBody(), 500)],
      ['only port 53 servers', json({ iceServers: [{ urls: ['turn:turn.cloudflare.com:53?transport=udp'] }] }, 201)],
      ['a url that is not a string', json({ iceServers: [{ urls: ['turn:turn.cloudflare.com:3478', 42] }] }, 201)],
      ['only servers off Cloudflare', json({ iceServers: [{ urls: ['turn:relay.example.test:3478'], username: 'u', credential: 'c' }] }, 201)],
      ['STUN only, no relay login', json({ iceServers: [{ urls: ['stun:stun.cloudflare.com:3478'] }] }, 201)],
      ['TURN without a credential', json({ iceServers: [{ urls: ['turn:turn.cloudflare.com:3478?transport=udp'] }] }, 201)],
      ['TURN with a username but no credential', json({ iceServers: [{ urls: ['turn:turn.cloudflare.com:3478'], username: 'u' }] }, 201)],
      ['TURN with a credential but no username', json({ iceServers: [{ urls: ['turn:turn.cloudflare.com:3478'], credential: 'c' }] }, 201)],
      ['a username that is not a string', json({ iceServers: [{ urls: ['turn:turn.cloudflare.com:3478'], username: 7, credential: 'c' }] }, 201)],
      ['a credential that is not a string', json({ iceServers: [{ urls: ['turn:turn.cloudflare.com:3478'], username: 'u', credential: 7 }] }, 201)],
      ['a login on STUN only', json({ iceServers: [{ urls: ['stun:stun.cloudflare.com:3478'], username: 'u', credential: 'c' }] }, 201)],
    ];
    for (const [, response] of cases) {
      vi.stubGlobal('fetch', vi.fn(async () => response));
      const { matchId, hostId } = await seedMatch(t, 'connecting');
      await expectConvexErrorAsync(t.action(api.turn.turnCredentials, { playerId: hostId, matchId }), 'TURN_UNAVAILABLE');
    }
  });

  it('the key id is escaped in the Cloudflare URL', async () => {
    vi.stubEnv('CLOUDFLARE_TURN_KEY_ID', 'key/../other?x=1');
    const fetchMock = vi.fn(async () => okResponse());
    vi.stubGlobal('fetch', fetchMock);
    const t = convexTest(schema, modules);
    const { matchId, hostId } = await seedMatch(t, 'connecting');
    await t.action(api.turn.turnCredentials, { playerId: hostId, matchId });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://rtc.live.cloudflare.com/v1/turn/keys/key%2F..%2Fother%3Fx%3D1/credentials/generate-ice-servers',
      expect.anything(),
    );
  });

  it('keeps only Cloudflare STUN and TURN servers', async () => {
    const body = {
      iceServers: [
        { urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.example.test:3478'] },
        {
          urls: [
            'turns:turn.cloudflare.com:5349?transport=tcp',
            'turn:evil.turn.cloudflare.com.example.test:3478',
            'turn:turn.cloudflare.com.example.test:3478',
            'turn:relay.example.test:3478?via=turn:turn.cloudflare.com',
            'https://turn.cloudflare.com/',
          ],
          username: 'synthetic-user-0001',
          credential: 'synthetic-cred-0001',
        },
      ],
    };
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status: 201 })));
    const t = convexTest(schema, modules);
    const { matchId, hostId } = await seedMatch(t, 'connecting');
    expect(await t.action(api.turn.turnCredentials, { playerId: hostId, matchId })).toEqual({
      iceServers: [
        { urls: ['stun:stun.cloudflare.com:3478'] },
        { urls: ['turns:turn.cloudflare.com:5349?transport=tcp'], username: 'synthetic-user-0001', credential: 'synthetic-cred-0001' },
      ],
    });
  });
});
