/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { describe, expect, it } from 'vitest';
import type { Doc } from '../_generated/dataModel';
import schema from '../schema';
import { roleIn, toMatchView } from './access';

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

    expect(() => roleIn(match, crypto.randomUUID())).toThrow('Not in this match');
    expect(() => roleIn(waiting, crypto.randomUUID())).toThrow('Not in this match');
    expect(() => roleIn(match, 'abc')).toThrow('Invalid player id');
    expect(() => roleIn(match, hostId.toUpperCase())).toThrow('Invalid player id');
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

    for (const role of ['host', 'guest'] as const) {
      const view = toMatchView(match, role);
      const json = JSON.stringify(view);

      expect(Object.keys(view).sort()).toEqual(
        ['endReason', 'guestScore', 'hostScore', 'id', 'kind', 'role', 'round', 'seed', 'status', 'winner'].sort(),
      );
      expect(json).not.toContain(hostId);
      expect(json).not.toContain(guestId);
      expect(view.role).toBe(role);
      expect(view.id).toBe(match._id);
    }
  });
});
