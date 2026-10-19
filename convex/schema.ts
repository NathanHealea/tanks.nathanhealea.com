import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

const role = v.union(v.literal('host'), v.literal('guest'));

// Player ids are per-page-load random GUIDs, never tied to a person. signals.payload is the exception:
// WebRTC offers and ICE candidates carry players' IP addresses, so signals must be deleted per match.
export default defineSchema({
  queue: defineTable({
    playerId: v.string(),
    joinedAt: v.number(),
    lastSeen: v.number(),
  })
    .index('by_player', ['playerId'])
    .index('by_joined', ['joinedAt'])
    .index('by_seen', ['lastSeen']),

  matches: defineTable({
    kind: v.union(v.literal('quick'), v.literal('private')),
    code: v.optional(v.string()),
    expiresAt: v.optional(v.number()),
    hostId: v.string(),
    guestId: v.optional(v.string()),
    status: v.union(
      v.literal('waiting'),
      v.literal('connecting'),
      v.literal('playing'),
      v.literal('finished'),
      v.literal('abandoned'),
    ),
    seed: v.number(),
    round: v.number(),
    hostScore: v.number(),
    guestScore: v.number(),
    winner: v.optional(role),
    endReason: v.optional(
      v.union(v.literal('score'), v.literal('forfeit'), v.literal('timeout'), v.literal('left'), v.literal('connection')),
    ),
    createdAt: v.number(),
    hostSeen: v.number(),
    guestSeen: v.optional(v.number()),
    rematchOf: v.optional(v.id('matches')),
    hostRematch: v.optional(v.boolean()),
    guestRematch: v.optional(v.boolean()),
  })
    .index('by_code', ['code'])
    .index('by_host', ['hostId'])
    .index('by_guest', ['guestId'])
    .index('by_status', ['status', 'createdAt']),

  // Kept apart from matches: a heartbeat written to the match row would re-run both players' myMatch every beat.
  presence: defineTable({
    matchId: v.id('matches'),
    role,
    lastSeen: v.number(),
  }).index('by_match', ['matchId', 'role']),

  signals: defineTable({
    matchId: v.id('matches'),
    to: role,
    kind: v.union(v.literal('offer'), v.literal('answer'), v.literal('ice')),
    payload: v.string(),
    createdAt: v.number(),
  }).index('by_match_to', ['matchId', 'to']),
});
