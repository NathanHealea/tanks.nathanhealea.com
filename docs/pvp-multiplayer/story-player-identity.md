---
type: story
epic: pvp-multiplayer    # removed by `wi new` when there is no parent epic
slug: player-identity
status: in-progress
branch: story/player-identity
worktree_path: /Users/nhealea/Personal/Development/tanks.nathanhealea.com/pvp-tanks-worktrees/story-player-identity
created: 2026-10-18
approved: 2026-10-18
commit_type:         # optional override for the release subject type (default: story=feat, bug=fix, task=chore)
version:             # set by `wi stage`
review_approved:     # set by `wi accept`
pr:                  # set by `wi pr`
tag:                 # set by `wi release`; the tag sits on the branch's last commit
---

# Anonymous per-load player identity

## Summary

Give each page load a random GUID that identifies the player to Convex for that visit, and make every Convex function check that the caller belongs to what it is touching. There are no accounts and no stored identity: reload the page and you are a new player. This is the identity every matchmaking and match function relies on.

## Context

The user requirement: no login, no account, a GUID generated each time the game loads. `crypto.randomUUID()` is available in every browser the game targets (secure contexts only; the site is HTTPS and `localhost` counts as secure). Today the only player ID is the hard-coded `LOCAL_PLAYER = 'p1'` in `src/render/Scene.tsx`, which names a tank inside the simulation; it is a different concept and stays. Convex has no notion of this GUID: it arrives as a function argument, so the server must validate format and membership on every call. Depends on `convex-backend-setup` (uses `convex/lib/ids.ts`).

## Scope

**In scope**

- `src/net/identity.ts`: one GUID per load, held in memory.
- `convex/lib/access.ts`: helpers that load a match and resolve the caller's role (`'host' | 'guest'`) or throw.
- A client-facing match view that never contains `hostId` or `guestId`.

**Out of scope**

- Display names, avatars, persistence across reloads.
- Rate limiting (epic open question).

## Requirements

- **R1** — Each page load produces a new v4 GUID; the same GUID is used for every Convex call during that load.
- **R2** — The GUID is never written to `localStorage`, `sessionStorage`, IndexedDB, cookies or the URL.
- **R3** — Every Convex function that takes a player GUID rejects a malformed one with a clear error.
- **R4** — Every Convex function that acts on a match rejects a GUID that is neither that match's host nor guest, and changes nothing.
- **R5** — No query or mutation returns a player GUID other than the caller's own; matches are presented to clients as `{ role, status, score, ... }` without `hostId` or `guestId`.

## Acceptance criteria

- **AC1** (R1) — Given the game is loaded, when `playerId()` is called twice, then it returns the same value; given a reload, then it returns a different value.
- **AC2** (R2) — Given a full online match, when browser storage is inspected, then no GUID appears.
- **AC3** (R3) — Given `playerId: "abc"`, when any mutation is called, then it throws `Invalid player id`.
- **AC4** (R4) — Given a match between A and B, when C calls `matches.leave` with C's GUID, then it throws `Not in this match` and the match is unchanged.
- **AC5** (R5) — Given B is matched with A, when B reads its match, then the result has `role: 'guest'` and no field equals A's GUID.

## Test plan

| ID | Covers | Test | File | Asserts |
|----|--------|------|------|---------|
| T1 | R1 | `playerId is stable within a load` | `src/net/identity.test.ts` | Two calls return the same v4 UUID |
| T2 | R1 | `a fresh module gets a fresh id` | `src/net/identity.test.ts` | After `vi.resetModules()` and re-import, the id differs |
| T3 | R2 | `identity touches no storage` | `src/net/identity.test.ts` | With `localStorage` and `sessionStorage` spies installed, importing and calling `playerId()` makes no writes |
| T4 | R4 | `roleIn returns host or guest` | `convex/lib/access.test.ts` | For a seeded match, host GUID → `'host'`, guest GUID → `'guest'` |
| T5 | R3, R4 | `roleIn rejects outsiders and bad ids` | `convex/lib/access.test.ts` | Outsider throws `Not in this match`; malformed throws `Invalid player id` |
| T6 | R5 | `toMatchView hides player ids` | `convex/lib/access.test.ts` | Serialized view of a match contains neither GUID and includes the caller's role |

**Not unit testable:** R2 across a real session (AC2) — check DevTools Application tab after a manual match. R4 and R5 are re-asserted per function in items 6, 7 and 11.

## Implementation plan

1. [ ] Add server access helpers `requirePlayerId`, `roleIn(match, playerId)` and `toMatchView(match, role)` — touches `convex/lib/access.ts`, `convex/lib/access.test.ts` — tests T4, T5, T6
2. [ ] Add the per-load identity module — touches `src/net/identity.ts`, `src/net/identity.test.ts` — tests T1, T2, T3

**Must not change:** `LOCAL_PLAYER` and the `p1`/`p2` tank IDs inside the simulation.

**High-risk steps:** Step 1 — it is the authorization layer for every match mutation. Review it before items 6 and 7 build on it.

## Risks and open questions

- A GUID is a bearer token: whoever knows it can act as that player. R5 keeps it from the opponent; it still travels in function arguments over TLS. Acceptable for a game with nothing of value behind it.
- Two tabs in one browser are two players. That is fine and makes local testing easy.
- No FERPA surface: the GUID is random, not linked to a person, and gone on reload. Matches in Convex hold only GUIDs and scores, deleted by item 11.

## Progress log

- 2026-10-18 — Planned.
- 2026-10-18 — Plan approved.
- 2026-10-18 — Started on branch story/player-identity from origin/pvp-tank.
