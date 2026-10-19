/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { ConvexError } from 'convex/values';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { CODE_ALPHABET, generateCode } from './lib/codes';
import schema from './schema';

const modules = import.meta.glob('./**/*.*s');
const TEN_MINUTES = 600_000;

async function expectConvexErrorAsync(promise: Promise<unknown>, message: string): Promise<void> {
  const caught = await promise.then(
    () => undefined,
    (err: unknown) => err,
  );
  expect(caught).toBeInstanceOf(ConvexError);
  expect((caught as ConvexError<string>).data).toBe(message);
}

describe('privateMatch', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('create returns a valid code', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const t = convexTest(schema, modules);
    const a = crypto.randomUUID();

    const { code } = await t.mutation(api.privateMatch.createPrivate, { playerId: a });

    expect(code).toHaveLength(6);
    for (const ch of code) expect(CODE_ALPHABET).toContain(ch);
    const matches = await t.run((ctx) => ctx.db.query('matches').collect());
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({
      kind: 'private',
      status: 'waiting',
      hostId: a,
      code,
      round: 0,
      hostScore: 0,
      guestScore: 0,
      createdAt: 1_000_000,
      hostSeen: 1_000_000,
      expiresAt: 1_000_000 + TEN_MINUTES,
    });
    expect(matches[0].guestId).toBeUndefined();
    expect(Number.isInteger(matches[0].seed)).toBe(true);
    expect(matches[0].seed).toBeGreaterThanOrEqual(0);
    expect(matches[0].seed).toBeLessThan(2 ** 32);
  });

  it('codes are unique among active matches', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const t = convexTest(schema, modules);
    const taken = generateCode(() => 0);
    await t.run((ctx) =>
      ctx.db.insert('matches', {
        kind: 'private', code: taken, expiresAt: 1_000_000 + TEN_MINUTES, hostId: crypto.randomUUID(),
        status: 'waiting', seed: 1, round: 0, hostScore: 0, guestScore: 0, createdAt: 1_000_000, hostSeen: 1_000_000,
      }),
    );
    // The first seven draws are zero so the first code collides whether the seed is drawn before or after it.
    const realRandom = Math.random;
    let calls = 0;
    vi.spyOn(Math, 'random').mockImplementation(() => (calls++ < 7 ? 0 : realRandom()));

    const { code } = await t.mutation(api.privateMatch.createPrivate, { playerId: crypto.randomUUID() });

    expect(calls).toBeGreaterThan(7);
    expect(code).not.toBe(taken);
    expect(code).toHaveLength(6);
    const holders = await t.run((ctx) =>
      ctx.db.query('matches').withIndex('by_code', (q) => q.eq('code', code)).collect(),
    );
    expect(holders).toHaveLength(1);
  });

  it('second create cancels the first', async () => {
    const t = convexTest(schema, modules);
    const a = crypto.randomUUID();

    const first = await t.mutation(api.privateMatch.createPrivate, { playerId: a });
    const second = await t.mutation(api.privateMatch.createPrivate, { playerId: a });

    const matches = await t.run((ctx) => ctx.db.query('matches').collect());
    const firstMatch = matches.find((m) => m.code === first.code);
    expect(firstMatch?.status).toBe('abandoned');
    const waiting = matches.filter((m) => m.hostId === a && m.status === 'waiting');
    expect(waiting).toHaveLength(1);
    expect(waiting[0].code).toBe(second.code);
  });

  it('join normalizes and connects', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const t = convexTest(schema, modules);
    const a = crypto.randomUUID();
    const b = crypto.randomUUID();
    const { code } = await t.mutation(api.privateMatch.createPrivate, { playerId: a });
    const typed = ` ${code.slice(0, 3).toLowerCase()}-${code.slice(3).toLowerCase()} `.replace('-', ' - ');

    vi.setSystemTime(1_005_000);
    const { matchId } = await t.mutation(api.privateMatch.joinPrivate, { playerId: b, code: typed });

    const match = await t.run((ctx) => ctx.db.get(matchId as Id<'matches'>));
    expect(match).toMatchObject({ hostId: a, guestId: b, guestSeen: 1_005_000, status: 'connecting', code });
  });

  it('join errors are distinct and side-effect free', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const t = convexTest(schema, modules);
    const a = crypto.randomUUID();
    const b = crypto.randomUUID();
    const c = crypto.randomUUID();
    const busy = crypto.randomUUID();
    const { code } = await t.mutation(api.privateMatch.createPrivate, { playerId: a });
    const snapshot = () => t.run((ctx) => ctx.db.query('matches').withIndex('by_code', (q) => q.eq('code', code)).unique());

    const fresh = await snapshot();
    const unknown = (code[0] === 'A' ? 'B' : 'A') + code.slice(1);
    await expectConvexErrorAsync(t.mutation(api.privateMatch.joinPrivate, { playerId: b, code: unknown }), 'CODE_NOT_FOUND');
    expect(await snapshot()).toEqual(fresh);

    await expectConvexErrorAsync(t.mutation(api.privateMatch.joinPrivate, { playerId: a, code }), 'OWN_CODE');
    expect(await snapshot()).toEqual(fresh);

    await t.run((ctx) =>
      ctx.db.insert('matches', {
        kind: 'quick', hostId: busy, guestId: crypto.randomUUID(), status: 'playing', seed: 1, round: 1,
        hostScore: 0, guestScore: 0, createdAt: 1_000_000, hostSeen: 1_000_000, guestSeen: 1_000_000,
      }),
    );
    await expectConvexErrorAsync(t.mutation(api.privateMatch.joinPrivate, { playerId: busy, code }), 'ALREADY_IN_MATCH');
    expect(await snapshot()).toEqual(fresh);

    await t.mutation(api.privateMatch.joinPrivate, { playerId: b, code });
    const joined = await snapshot();
    expect(joined?.guestId).toBe(b);
    await expectConvexErrorAsync(t.mutation(api.privateMatch.joinPrivate, { playerId: c, code }), 'MATCH_FULL');
    expect(await snapshot()).toEqual(joined);

    const host = crypto.randomUUID();
    const late = await t.mutation(api.privateMatch.createPrivate, { playerId: host });
    const lateSnapshot = () =>
      t.run((ctx) => ctx.db.query('matches').withIndex('by_code', (q) => q.eq('code', late.code)).unique());
    const lateFresh = await lateSnapshot();
    vi.setSystemTime(1_000_000 + TEN_MINUTES + 1);
    await expectConvexErrorAsync(t.mutation(api.privateMatch.joinPrivate, { playerId: c, code: late.code }), 'CODE_EXPIRED');
    expect(await lateSnapshot()).toEqual(lateFresh);
  });

  it('cancel removes the code', async () => {
    const t = convexTest(schema, modules);
    const a = crypto.randomUUID();
    const b = crypto.randomUUID();
    const outsider = crypto.randomUUID();
    const { code } = await t.mutation(api.privateMatch.createPrivate, { playerId: a });
    const before = await t.run((ctx) => ctx.db.query('matches').withIndex('by_code', (q) => q.eq('code', code)).unique());
    if (!before) throw new Error('created match missing');

    await expectConvexErrorAsync(
      t.mutation(api.privateMatch.cancelPrivate, { playerId: outsider, matchId: before._id }),
      'Not in this match',
    );
    expect(await t.run((ctx) => ctx.db.get(before._id))).toEqual(before);

    expect(await t.mutation(api.privateMatch.cancelPrivate, { playerId: a, matchId: before._id })).toBeNull();

    expect((await t.run((ctx) => ctx.db.get(before._id)))?.status).toBe('abandoned');
    await expectConvexErrorAsync(t.mutation(api.privateMatch.joinPrivate, { playerId: b, code }), 'CODE_NOT_FOUND');
  });

  it('guest view omits the code', async () => {
    const t = convexTest(schema, modules);
    const a = crypto.randomUUID();
    const b = crypto.randomUUID();
    const { code } = await t.mutation(api.privateMatch.createPrivate, { playerId: a });
    await t.mutation(api.privateMatch.joinPrivate, { playerId: b, code });

    const hostView = await t.query(api.matchmaking.myMatch, { playerId: a });
    const guestView = await t.query(api.matchmaking.myMatch, { playerId: b });

    expect(hostView).toMatchObject({ role: 'host', status: 'connecting', code });
    expect(hostView).toHaveProperty('expiresAt');
    expect(guestView).toMatchObject({ role: 'guest', status: 'connecting' });
    expect(guestView).not.toHaveProperty('code');
    expect(guestView).not.toHaveProperty('expiresAt');
    expect(JSON.stringify(guestView)).not.toContain(code);
  });

  it('an expired code frees its host to make a new one', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const t = convexTest(schema, modules);
    const a = crypto.randomUUID();
    const { code: first } = await t.mutation(api.privateMatch.createPrivate, { playerId: a });

    vi.setSystemTime(1_000_000 + 600_001);
    expect(await t.query(api.matchmaking.myMatch, { playerId: a })).toBeNull();
    const { code: second } = await t.mutation(api.privateMatch.createPrivate, { playerId: a });
    expect(second).not.toBe(first);
  });

  it('a player in another match cannot create a private one', async () => {
    const t = convexTest(schema, modules);
    const a = crypto.randomUUID();
    await t.mutation(api.matchmaking.joinQueue, { playerId: a });
    await t.mutation(api.matchmaking.joinQueue, { playerId: crypto.randomUUID() });
    await expectConvexErrorAsync(t.mutation(api.privateMatch.createPrivate, { playerId: a }), 'ALREADY_IN_MATCH');
  });

  it('creating or joining a private match leaves the quick-match queue', async () => {
    const t = convexTest(schema, modules);
    const host = crypto.randomUUID();
    const guest = crypto.randomUUID();
    await t.run(async (ctx) => {
      await ctx.db.insert('queue', { playerId: host, joinedAt: Date.now(), lastSeen: Date.now() });
      await ctx.db.insert('queue', { playerId: guest, joinedAt: Date.now(), lastSeen: Date.now() });
    });
    const { code } = await t.mutation(api.privateMatch.createPrivate, { playerId: host });
    let queue = await t.run((ctx) => ctx.db.query('queue').collect());
    expect(queue.map((row) => row.playerId)).toEqual([guest]);

    await t.mutation(api.privateMatch.joinPrivate, { playerId: guest, code });
    queue = await t.run((ctx) => ctx.db.query('queue').collect());
    expect(queue).toHaveLength(0);
  });

  it('only the host can cancel, and only while waiting', async () => {
    const t = convexTest(schema, modules);
    const host = crypto.randomUUID();
    const guest = crypto.randomUUID();
    const { code } = await t.mutation(api.privateMatch.createPrivate, { playerId: host });
    const { matchId } = await t.mutation(api.privateMatch.joinPrivate, { playerId: guest, code });

    await expectConvexErrorAsync(
      t.mutation(api.privateMatch.cancelPrivate, { playerId: guest, matchId }),
      'Only the host can cancel',
    );
    expect(await t.mutation(api.privateMatch.cancelPrivate, { playerId: host, matchId })).toBeNull();
    const match = await t.run((ctx) => ctx.db.get(matchId));
    expect(match?.status).toBe('connecting');
  });

  it('every private match function rejects a malformed player id', async () => {
    const t = convexTest(schema, modules);
    const host = crypto.randomUUID();
    const { code } = await t.mutation(api.privateMatch.createPrivate, { playerId: host });
    const match = await t.run((ctx) => ctx.db.query('matches').first());

    await expectConvexErrorAsync(t.mutation(api.privateMatch.createPrivate, { playerId: 'x' }), 'Invalid player id');
    await expectConvexErrorAsync(t.mutation(api.privateMatch.joinPrivate, { playerId: 'x', code }), 'Invalid player id');
    await expectConvexErrorAsync(
      t.mutation(api.privateMatch.cancelPrivate, { playerId: 'x', matchId: match!._id }),
      'Invalid player id',
    );
    const after = await t.run((ctx) => ctx.db.get(match!._id));
    expect(after).toEqual(match);
  });

  it('a code joined minutes after creation is a live connecting match', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const t = convexTest(schema, modules);
    const host = crypto.randomUUID();
    const guest = crypto.randomUUID();
    const { code } = await t.mutation(api.privateMatch.createPrivate, { playerId: host });

    vi.setSystemTime(1_000_000 + 5 * 60_000);
    await t.mutation(api.privateMatch.joinPrivate, { playerId: guest, code });
    vi.setSystemTime(1_000_000 + 5 * 60_000 + 30_000);
    expect(await t.query(api.matchmaking.myMatch, { playerId: host })).toMatchObject({ status: 'connecting' });
    expect(await t.query(api.matchmaking.myMatch, { playerId: guest })).toMatchObject({ status: 'connecting' });

    vi.setSystemTime(1_000_000 + 5 * 60_000 + 60_001);
    expect(await t.query(api.matchmaking.myMatch, { playerId: host })).toBeNull();
  });

  it('a host with a code out cannot also quick match', async () => {
    const t = convexTest(schema, modules);
    const host = crypto.randomUUID();
    await t.mutation(api.privateMatch.createPrivate, { playerId: host });
    await expectConvexErrorAsync(t.mutation(api.matchmaking.joinQueue, { playerId: host }), 'ALREADY_IN_MATCH');
    expect(await t.run((ctx) => ctx.db.query('queue').collect())).toHaveLength(0);
  });

  it('the host can keep the same code working longer', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const t = convexTest(schema, modules);
    const host = crypto.randomUUID();
    const { code } = await t.mutation(api.privateMatch.createPrivate, { playerId: host });
    const match = (await t.run((ctx) => ctx.db.query('matches').first()))!;

    vi.setSystemTime(1_000_000 + 9 * 60_000);
    const { expiresAt } = await t.mutation(api.privateMatch.extendPrivate, { playerId: host, matchId: match._id });
    expect(expiresAt).toBe(1_000_000 + 9 * 60_000 + 600_000);

    vi.setSystemTime(1_000_000 + 15 * 60_000);
    const { matchId } = await t.mutation(api.privateMatch.joinPrivate, { playerId: crypto.randomUUID(), code });
    expect(matchId).toBe(match._id);
  });

  it('only the host of a waiting match can extend its code', async () => {
    const t = convexTest(schema, modules);
    const host = crypto.randomUUID();
    const guest = crypto.randomUUID();
    const { code } = await t.mutation(api.privateMatch.createPrivate, { playerId: host });
    const match = (await t.run((ctx) => ctx.db.query('matches').first()))!;

    await expectConvexErrorAsync(
      t.mutation(api.privateMatch.extendPrivate, { playerId: crypto.randomUUID(), matchId: match._id }),
      'Not in this match',
    );
    await t.mutation(api.privateMatch.joinPrivate, { playerId: guest, code });
    await expectConvexErrorAsync(
      t.mutation(api.privateMatch.extendPrivate, { playerId: guest, matchId: match._id }),
      'Only the host can extend',
    );
    await expectConvexErrorAsync(
      t.mutation(api.privateMatch.extendPrivate, { playerId: host, matchId: match._id }),
      'CODE_NOT_FOUND',
    );
  });

  it('a match joined just before its code expires keeps connecting after it', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const t = convexTest(schema, modules);
    const host = crypto.randomUUID();
    const guest = crypto.randomUUID();
    const { code } = await t.mutation(api.privateMatch.createPrivate, { playerId: host });
    vi.setSystemTime(1_000_000 + 590_000);
    await t.mutation(api.privateMatch.joinPrivate, { playerId: guest, code });
    vi.setSystemTime(1_000_000 + 605_000);
    expect(await t.query(api.matchmaking.myMatch, { playerId: host })).toMatchObject({ status: 'connecting' });
    expect(await t.query(api.matchmaking.myMatch, { playerId: guest })).toMatchObject({ status: 'connecting' });
  });

  it('a code works up to and including its expiry instant', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const t = convexTest(schema, modules);
    const host = crypto.randomUUID();
    const { code } = await t.mutation(api.privateMatch.createPrivate, { playerId: host });
    vi.setSystemTime(1_000_000 + 600_000);
    expect(await t.query(api.matchmaking.myMatch, { playerId: host })).not.toBeNull();
    await expect(t.mutation(api.privateMatch.joinPrivate, { playerId: crypto.randomUUID(), code })).resolves.toBeDefined();
  });

  it('a code held by a match in play is full, and never handed out again', async () => {
    const t = convexTest(schema, modules);
    const taken = generateCode(() => 0);
    await t.run((ctx) =>
      ctx.db.insert('matches', {
        kind: 'private', code: taken, expiresAt: 1, hostId: crypto.randomUUID(), guestId: crypto.randomUUID(),
        status: 'playing', seed: 1, round: 2, hostScore: 1, guestScore: 0, createdAt: 1, hostSeen: 1, guestSeen: 1,
      }),
    );
    await expectConvexErrorAsync(
      t.mutation(api.privateMatch.joinPrivate, { playerId: crypto.randomUUID(), code: taken }),
      'MATCH_FULL',
    );
    const real = Math.random;
    let draws = 0;
    vi.spyOn(Math, 'random').mockImplementation(() => (draws++ < 7 ? 0 : real()));
    const { code } = await t.mutation(api.privateMatch.createPrivate, { playerId: crypto.randomUUID() });
    expect(code).not.toBe(taken);
  });

  it('a host whose friend has joined cannot replace the live match', async () => {
    const t = convexTest(schema, modules);
    const host = crypto.randomUUID();
    const guest = crypto.randomUUID();
    const { code } = await t.mutation(api.privateMatch.createPrivate, { playerId: host });
    const { matchId } = await t.mutation(api.privateMatch.joinPrivate, { playerId: guest, code });
    await expectConvexErrorAsync(t.mutation(api.privateMatch.createPrivate, { playerId: host }), 'ALREADY_IN_MATCH');
    expect(await t.run((ctx) => ctx.db.get(matchId))).toMatchObject({ status: 'connecting', guestId: guest });
  });

  it('the host entering their own full code hears OWN_CODE', async () => {
    const t = convexTest(schema, modules);
    const host = crypto.randomUUID();
    const { code } = await t.mutation(api.privateMatch.createPrivate, { playerId: host });
    await t.mutation(api.privateMatch.joinPrivate, { playerId: crypto.randomUUID(), code });
    await expectConvexErrorAsync(t.mutation(api.privateMatch.joinPrivate, { playerId: host, code }), 'OWN_CODE');
  });

  it('when every attempt collides, create fails and inserts nothing', async () => {
    const t = convexTest(schema, modules);
    await t.run((ctx) =>
      ctx.db.insert('matches', {
        kind: 'private', code: generateCode(() => 0), expiresAt: Date.now() + 600_000, hostId: crypto.randomUUID(),
        status: 'waiting', seed: 1, round: 0, hostScore: 0, guestScore: 0, createdAt: 1, hostSeen: 1,
      }),
    );
    vi.spyOn(Math, 'random').mockReturnValue(0);
    await expectConvexErrorAsync(
      t.mutation(api.privateMatch.createPrivate, { playerId: crypto.randomUUID() }),
      'Could not find a free match code; try again',
    );
    expect(await t.run((ctx) => ctx.db.query('matches').collect())).toHaveLength(1);
  });

  it('the seed is an unsigned 32-bit integer even at the top of the random range', async () => {
    const t = convexTest(schema, modules);
    vi.spyOn(Math, 'random').mockReturnValue(0.9999999999);
    await t.mutation(api.privateMatch.createPrivate, { playerId: crypto.randomUUID() });
    const match = (await t.run((ctx) => ctx.db.query('matches').first()))!;
    expect(match.seed).toBe(Math.floor(0.9999999999 * 2 ** 32));
    expect(match.seed).toBeLessThan(2 ** 32);
  });
});
