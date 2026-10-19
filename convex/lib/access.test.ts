/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { ConvexError } from 'convex/values';
import { describe, expect, it } from 'vitest';
import type { Doc } from '../_generated/dataModel';
import schema from '../schema';
import { loadMatchAs, roleIn, toMatchView } from './access';

const modules = import.meta.glob('../**/*.*s');

async function seedMatch(fields: Partial<Doc<'matches'>> = {}): Promise<Doc<'matches'>> {
  const t = convexTest(schema, modules);
  const match = await t.run(async (ctx) => {
    const id = await ctx.db.insert('matches', {
      kind: 'quick',
      hostId: crypto.randomUUID(),
      status: 'playing',
      seed: 42,
      round: 1,
      hostScore: 0,
      guestScore: 0,
      createdAt: 1000,
      hostSeen: 1000,
      ...fields,
    });
    return ctx.db.get(id);
  });
  if (!match) throw new Error('seeded match missing');
  return match;
}

// Message text alone is not enough: a plain Error carries the same message in tests but reaches clients as "Server Error".
function expectConvexError(fn: () => unknown, message: string): void {
  let caught: unknown;
  try {
    fn();
  } catch (err) {
    caught = err;
  }
  expect(caught).toBeInstanceOf(ConvexError);
  expect((caught as ConvexError<string>).data).toBe(message);
}

async function expectConvexErrorAsync(promise: Promise<unknown>, message: string): Promise<void> {
  const caught = await promise.then(
    () => undefined,
    (err: unknown) => err,
  );
  expect(caught).toBeInstanceOf(ConvexError);
  expect((caught as ConvexError<string>).data).toBe(message);
}

describe('access', () => {
  it('roleIn returns host or guest', async () => {
    const hostId = crypto.randomUUID();
    const guestId = crypto.randomUUID();
    const match = await seedMatch({ hostId, guestId });

    expect(roleIn(match, hostId)).toBe('host');
    expect(roleIn(match, guestId)).toBe('guest');
  });

  it('roleIn rejects outsiders and bad ids', async () => {
    const hostId = crypto.randomUUID();
    const match = await seedMatch({ hostId, guestId: crypto.randomUUID() });
    const waiting = await seedMatch({ status: 'waiting' });

    expectConvexError(() => roleIn(match, crypto.randomUUID()), 'Not in this match');
    expectConvexError(() => roleIn(waiting, crypto.randomUUID()), 'Not in this match');
    expectConvexError(() => roleIn(match, 'abc'), 'Invalid player id');
    expectConvexError(() => roleIn(match, hostId.toUpperCase()), 'Invalid player id');
  });

  it('toMatchView hides player ids', async () => {
    const hostId = crypto.randomUUID();
    const guestId = crypto.randomUUID();
    const match = await seedMatch({
      kind: 'private',
      code: 'ABCD',
      expiresAt: 9000,
      hostId,
      guestId,
      status: 'finished',
      round: 3,
      hostScore: 3,
      guestScore: 1,
      winner: 'host',
      endReason: 'score',
      guestSeen: 1200,
      hostRematch: true,
    });

    const baseKeys = ['endReason', 'guestScore', 'hostScore', 'id', 'kind', 'role', 'round', 'seed', 'status', 'winner'];
    const base = {
      id: match._id,
      kind: 'private',
      status: 'finished',
      seed: 42,
      round: 3,
      hostScore: 3,
      guestScore: 1,
      winner: 'host',
      endReason: 'score',
    };

    const hostView = toMatchView(match, hostId);
    expect(Object.keys(hostView).sort()).toEqual([...baseKeys, 'code', 'expiresAt'].sort());
    expect(hostView).toEqual({ ...base, role: 'host', code: 'ABCD', expiresAt: 9000 });

    const guestView = toMatchView(match, guestId);
    expect(Object.keys(guestView).sort()).toEqual([...baseKeys].sort());
    expect(guestView).toEqual({ ...base, role: 'guest' });

    for (const view of [hostView, guestView]) {
      const json = JSON.stringify(view);
      expect(json).not.toContain(hostId);
      expect(json).not.toContain(guestId);
    }
  });

  it('toMatchView refuses outsiders', async () => {
    const match = await seedMatch({ guestId: crypto.randomUUID() });
    expectConvexError(() => toMatchView(match, crypto.randomUUID()), 'Not in this match');
    expectConvexError(() => toMatchView(match, 'abc'), 'Invalid player id');
  });

  it('loadMatchAs resolves a member and rejects everyone else', async () => {
    const t = convexTest(schema, modules);
    const hostId = crypto.randomUUID();
    const guestId = crypto.randomUUID();
    await t.run(async (ctx) => {
      const base = { kind: 'quick' as const, status: 'playing' as const, seed: 1, round: 1, hostScore: 0, guestScore: 0, createdAt: 1, hostSeen: 1 };
      const matchId = await ctx.db.insert('matches', { ...base, hostId, guestId });
      const goneId = await ctx.db.insert('matches', { ...base, hostId, guestId });
      await ctx.db.delete(goneId);

      expect((await loadMatchAs(ctx, matchId, hostId)).role).toBe('host');
      expect((await loadMatchAs(ctx, matchId, guestId)).match._id).toBe(matchId);
      await expectConvexErrorAsync(loadMatchAs(ctx, matchId, crypto.randomUUID()), 'Not in this match');
      await expectConvexErrorAsync(loadMatchAs(ctx, goneId, hostId), 'Match not found');
      // The id is validated before any read.
      await expectConvexErrorAsync(loadMatchAs(ctx, goneId, 'abc'), 'Invalid player id');
    });
  });
});
