import { ConvexError, v } from 'convex/values';
import { internal } from './_generated/api';
import { action, internalMutation } from './_generated/server';
import { loadMatchAs } from './lib/access';

// Convex provides process.env to functions; the convex/ project has no Node typings, and adding them for one global
// would pull in a dependency.
declare const process: { env: Record<string, string | undefined> };

/** Grants per player per match: one to connect and one retry (R3). Each grant is a billable relay allocation. */
export const TURN_GRANTS_PER_PLAYER = 2;
/** Long enough to set up and hold the relay for a match; the shortest that does (R1). */
const TTL_SECONDS = 3600;

export interface IceServer {
  urls: string[];
  username?: string;
  credential?: string;
}

export const claimTurnGrant = internalMutation({
  args: { playerId: v.string(), matchId: v.id('matches') },
  handler: async (ctx, { playerId, matchId }) => {
    const { match, role } = await loadMatchAs(ctx, matchId, playerId);
    if (match.status !== 'connecting' && match.status !== 'playing') throw new ConvexError('MATCH_NOT_LIVE');
    const grant = await ctx.db
      .query('turnGrants')
      .withIndex('by_match', (q) => q.eq('matchId', matchId).eq('role', role))
      .unique();
    if ((grant?.count ?? 0) >= TURN_GRANTS_PER_PLAYER) throw new ConvexError('TURN_LIMIT');
    if (grant) await ctx.db.patch(grant._id, { count: grant.count + 1 });
    else await ctx.db.insert('turnGrants', { matchId, role, count: 1 });
    return null;
  },
});

/**
 * Short-lived TURN credentials from Cloudflare for a player in a live match. The key and token that mint them stay in
 * Convex: they are long-term secrets that can mint unlimited credentials, so no failure path repeats anything
 * Cloudflare said or what was sent to it.
 */
export const turnCredentials = action({
  args: { playerId: v.string(), matchId: v.id('matches') },
  handler: async (ctx, args): Promise<{ iceServers: IceServer[] }> => {
    await ctx.runMutation(internal.turn.claimTurnGrant, args);
    const keyId = process.env.CLOUDFLARE_TURN_KEY_ID;
    const token = process.env.CLOUDFLARE_TURN_KEY_API_TOKEN;
    if (!keyId || !token) {
      console.error('TURN is not configured: set CLOUDFLARE_TURN_KEY_ID and CLOUDFLARE_TURN_KEY_API_TOKEN');
      throw new ConvexError('TURN_UNAVAILABLE');
    }
    let body: unknown;
    try {
      const response = await fetch(
        `https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(keyId)}/credentials/generate-ice-servers`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ ttl: TTL_SECONDS }),
        },
      );
      if (!response.ok) {
        console.error(`Cloudflare TURN refused credentials: HTTP ${response.status}`);
        throw new ConvexError('TURN_UNAVAILABLE');
      }
      body = await response.json();
    } catch (err) {
      if (err instanceof ConvexError) throw err;
      // The error itself is not logged: a network error's message can carry the request it failed on.
      console.error('Calling Cloudflare TURN failed');
      throw new ConvexError('TURN_UNAVAILABLE');
    }
    const iceServers = parseIceServers(body);
    if (!iceServers) {
      console.error('Cloudflare TURN returned an unexpected response');
      throw new ConvexError('TURN_UNAVAILABLE');
    }
    return { iceServers };
  },
});

/**
 * Only Cloudflare's own servers, so even a tampered response cannot steer the relay elsewhere; and never port 53,
 * which browsers block, so ICE would only wait for a timeout (Cloudflare's docs).
 */
const usable = (url: string) =>
  /^(stun:stun|turns?:turn)\.cloudflare\.com(:\d+)?(\?|$)/.test(url) && !/:53(\?|$)/.test(url);

function parseIceServers(body: unknown): IceServer[] | null {
  if (typeof body !== 'object' || body === null || !Array.isArray((body as { iceServers?: unknown }).iceServers)) {
    return null;
  }
  const servers: IceServer[] = [];
  for (const entry of (body as { iceServers: unknown[] }).iceServers) {
    if (typeof entry !== 'object' || entry === null) return null;
    const { urls, username, credential } = entry as Record<string, unknown>;
    const list = typeof urls === 'string' ? [urls] : urls;
    if (!Array.isArray(list) || !list.every((u) => typeof u === 'string')) return null;
    if (username !== undefined && typeof username !== 'string') return null;
    if (credential !== undefined && typeof credential !== 'string') return null;
    const kept = (list as string[]).filter(usable);
    if (kept.length === 0) continue;
    servers.push({
      urls: kept,
      ...(username !== undefined ? { username } : {}),
      ...(credential !== undefined ? { credential } : {}),
    });
  }
  return servers.length > 0 ? servers : null;
}
