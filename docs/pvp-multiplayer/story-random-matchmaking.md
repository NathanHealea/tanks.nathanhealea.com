---
type: story
epic: pvp-multiplayer    # removed by `wi new` when there is no parent epic
slug: random-matchmaking
status: planned      # planned | in-progress | changes-requested | staged | released
branch: story/random-matchmaking
worktree_path:       # set by `wi start`
created: 2026-10-18
approved: 2026-10-18
commit_type:         # optional override for the release subject type (default: story=feat, bug=fix, task=chore)
version:             # set by `wi stage`
review_approved:     # set by `wi accept`
pr:                  # set by `wi pr`
tag:                 # set by `wi release`; the tag sits on the branch's last commit
---

# Random matchmaking queue

## Summary

Let a player press **Quick match** and get paired with the next stranger who is waiting. Convex holds a first-in, first-out queue; the mutation that joins the queue either pairs the caller with the oldest live entry and creates a match, or adds the caller to the queue. Convex mutations are serializable transactions that retry on conflict ([Convex OCC](https://docs.convex.dev/database/advanced/occ)), so two simultaneous joiners cannot both grab the same waiting player.

## Context

The schema from `convex-backend-setup` defines `queue` and `matches`. `player-identity` supplies the per-load GUID, `requirePlayerId`, `roleIn` and `toMatchView`. The client learns it has been matched by subscribing to a Convex query, which re-runs whenever the match row changes. Host and guest roles matter later: the host runs the simulation (item 9) and sends the WebRTC offer (item 8). The UI that calls this is item 10; stale-entry sweeping is item 11. Depends on `convex-backend-setup` and `player-identity`.

## Scope

**In scope**

- `convex/matchmaking.ts`: `joinQueue`, `leaveQueue`, `queueHeartbeat` mutations and `myMatch` query.
- `src/net/useQuickMatch.ts`: a React hook exposing `idle | searching | matched | error`, sending heartbeats while searching and leaving on cancel or page hide.

**Out of scope**

- Skill-based or region-based pairing.
- Screens and copy (item 10). Deleting stale rows (item 11).

## Requirements

- **R1** — When the queue holds a live entry from another player (heartbeat within the last 30 seconds), `joinQueue` removes that entry and creates a `quick` match in status `connecting`, with the waiting player as host, the caller as guest, a random 32-bit `seed`, `round: 0` and scores 0–0.
- **R2** — When no live entry from another player exists, `joinQueue` adds the caller to the queue and returns `{ status: 'queued' }`.
- **R3** — Pairing is first-in, first-out among live entries; entries older than 30 seconds since their last heartbeat are never paired.
- **R4** — A player is never paired with themselves and is never in more than one active match (`waiting`, `connecting` or `playing`) or more than one queue entry; calling `joinQueue` again while queued or matched returns the current state without creating anything.
- **R5** — `myMatch({ playerId })` returns the caller's active match as a view without GUIDs (role, status, kind, round, scores), or `null`.
- **R6** — `leaveQueue` removes the caller's queue entry; it is a no-op if there is none.
- **R7** — While searching, the client sends `queueHeartbeat` every 10 seconds, and calls `leaveQueue` when the player cancels, the component unmounts, or the page fires `pagehide`.
- **R8** — Every function rejects malformed GUIDs.

## Acceptance criteria

- **AC1** (R1, R2) — Given an empty queue, when A joins then B joins, then A is queued, B's join creates a match with A as host and B as guest, and both `myMatch` queries return it.
- **AC2** (R3) — Given A queued 40 seconds ago with no heartbeat and C queued 5 seconds ago, when B joins, then B is paired with C.
- **AC3** (R4) — Given A is queued, when A calls `joinQueue` again, then nothing new is created and A is still queued alone.
- **AC4** (R4) — Given two players join at the same moment while A waits, then exactly one of them is paired with A and the other is queued.
- **AC5** (R5) — Given A and B are matched, when A reads `myMatch`, then the result has `role: 'host'` and contains neither GUID.
- **AC6** (R7) — Given a searching client, when the player presses **Cancel**, then `leaveQueue` is called and the hook returns to `idle`.

## Test plan

| ID | Covers | Test | File | Asserts |
|----|--------|------|------|---------|
| T1 | R2 | `first joiner is queued` | `convex/matchmaking.test.ts` | Empty queue → `{ status: 'queued' }`, one queue row |
| T2 | R1 | `second joiner is paired` | `convex/matchmaking.test.ts` | Match row with host A, guest B, `connecting`, seed is a 32-bit integer, queue empty |
| T3 | R3 | `stale entries are skipped` | `convex/matchmaking.test.ts` | Using fake timers, A ages 40 s; B joins → B queued, not paired with A |
| T4 | R3 | `pairing is FIFO` | `convex/matchmaking.test.ts` | A, then C queued; B joins → paired with A |
| T5 | R4 | `rejoining is idempotent` | `convex/matchmaking.test.ts` | A joins twice → one queue row; A matched then joins → returns matched, no new rows |
| T6 | R4 | `never paired with self` | `convex/matchmaking.test.ts` | Only A in queue, A joins → still queued |
| T7 | R4 | `concurrent joiners pair once` | `convex/matchmaking.test.ts` | A queued; `Promise.all` of B and C joining → exactly one match containing A, one queue row left |
| T8 | R5 | `myMatch hides guids` | `convex/matchmaking.test.ts` | View has `role`, no value equal to either GUID; outsider gets `null` |
| T9 | R6 | `leaveQueue removes and tolerates absence` | `convex/matchmaking.test.ts` | Removes A's row; second call does not throw |
| T10 | R8 | `bad guid is rejected` | `convex/matchmaking.test.ts` | Each function throws `Invalid player id` for `'x'` |
| T11 | R7 | `hook heartbeats and leaves` | `src/net/useQuickMatch.test.ts` | With a fake Convex client and fake timers: heartbeat every 10 s while searching; `leaveQueue` on cancel and unmount |

**Not unit testable:** AC4 under real network concurrency — convex-test runs mutations serially, so T7 proves logic, not Convex's OCC. Verify manually by joining from three browser tabs at once against the dev deployment.

## Implementation plan

1. [ ] Add `joinQueue` with pairing, idempotency and staleness rules — touches `convex/matchmaking.ts`, `convex/matchmaking.test.ts` — tests T1, T2, T3, T4, T5, T6, T7, T10
2. [ ] Add `leaveQueue`, `queueHeartbeat` and `myMatch` — touches `convex/matchmaking.ts`, `convex/matchmaking.test.ts` — tests T8, T9, T10
3. [ ] Add the `useQuickMatch` client hook — touches `src/net/useQuickMatch.ts`, `src/net/useQuickMatch.test.ts` — tests T11

**Must not change:** The `requirePlayerId` / `roleIn` / `toMatchView` contracts from `player-identity`.

**High-risk steps:** Step 1 — it creates matches and decides who may act on them. Review the authorization path before item 8 builds on it.

## Risks and open questions

- The match seed is drawn inside the mutation. Convex mutations must be deterministic; Convex seeds `Math.random` per mutation so retries draw the same value (inferred from Convex's determinism rules — confirm in the docs before building).
- The pairing lookup by `joinedAt` scans from the oldest row; with stale rows piling up until item 11 sweeps them, the scan grows. Bound it: take the first 20 by `by_joined` and filter in code.
- Open: should the queue show "N players searching"? Cheap to add as a query, but a count of 0 most of the time may discourage people. Not in scope unless asked.

## Progress log

- 2026-10-18 — Planned.
- 2026-10-18 — Plan approved.
