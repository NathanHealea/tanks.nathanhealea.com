---
type: story
epic: pvp-multiplayer    # removed by `wi new` when there is no parent epic
slug: host-authoritative-netcode
status: in-progress
branch: story/host-authoritative-netcode
worktree_path: /Users/nhealea/Personal/Development/tanks.nathanhealea.com/pvp-tanks-worktrees/story-host-authoritative-netcode
created: 2026-10-18
approved: 2026-10-18
commit_type:         # optional override for the release subject type (default: story=feat, bug=fix, task=chore)
version:             # set by `wi stage`
review_approved:     # set by `wi accept`
pr:                  # set by `wi pr`
tag:                 # set by `wi release`; the tag sits on the branch's last commit
---

# Host-authoritative networked game session

## Summary

Run a live PvP match over the peer link. The host's browser runs the real simulation with `step()` at 60 Hz, using its own input and the latest input received from the guest, and sends compact state snapshots 30 times a second. The guest sends its input and draws the world by interpolating between snapshots slightly in the past, so movement looks smooth despite network jitter. The host runs the round cycle (countdown, play, result, next map) and records each round's result in Convex.

## Context

`LocalSession` in `src/game/session.ts` owns a `GameState`, accumulates real time and calls `step()` per fixed tick, keeping fire and mine actions for the first tick only. `Scene` (`src/render/Scene.tsx`) takes a `LocalSession`, reads input with `readInput()` for the hard-coded `LOCAL_PLAYER = 'p1'`, passes events to `Effects` and sound, and reports outcome and HUD values. `createPvpGame` and match scoring come from `pvp-sim-rules`; arenas from `pvp-map-generator`; the `Link` from `webrtc-connection`. Lockstep is ruled out because the simulation's trig functions are not guaranteed bit-identical across browsers (see epic). Depends on `pvp-sim-rules`, `pvp-map-generator` and `webrtc-connection`.

## Scope

**In scope**

- A `GameSession` interface that `LocalSession`, `HostSession` and `GuestSession` implement, and `Scene` accepting any of them plus a `localPlayerId`.
- `src/net/protocol.ts`: message types, `PROTOCOL_VERSION`, and validation of every incoming message.
- `src/net/hostSession.ts` and `src/net/guestSession.ts`.
- `convex/matches.ts`: `reportRound` mutation.

**Out of scope**

- Menus and HUD (item 10). Disconnect and forfeit handling (item 11).
- Client-side prediction or rollback of the guest's own tank (epic open question).

## Requirements

- **R1** — The host steps the simulation at 60 Hz with its own input as `p1` and the guest's most recent valid input as `p2`; with no guest input yet, `p2` is idle.
- **R2** — Guest input is sent about 30 times a second on the `state` channel with a sequence number and cumulative `fireCount` and `mineCount`; the host applies a fire or mine once per increase, so a dropped packet never loses a shot or mine and a repeated packet never doubles one.
- **R3** — The host validates every guest message: unknown types, non-finite numbers, move vectors longer than 1 (clamped), out-of-order sequence numbers (ignored) and counters that jump by more than 3 per message (capped) never reach `step()`.
- **R4** — The host sends a snapshot about 30 times a second on the `state` channel with the tick, tanks, bullets, mines, the events since the last snapshot, and any cork cells broken since the last snapshot.
- **R5** — The guest renders tanks and bullets interpolated between the two snapshots around a render time 66 ms behind the newest (tunable), wrapping angles the short way; it plays each event exactly once even when snapshots arrive out of order or twice.
- **R6** — The guest draws its own turret from local aim immediately, not from snapshots.
- **R7** — Each round: the host generates the arena from `roundSeed(matchSeed, round)`, sends `roundStart` with the arena rows on `ctrl`, both sides show a 3-second countdown with input ignored, then play. When the round outcome is set, after `OUTCOME_DELAY` the host sends `roundEnd` with the result and the new score on `ctrl`.
- **R8** — The host calls `reportRound({ playerId, matchId, round, result })` for each round; Convex accepts it only from the host, only for the next round number, updates the score, and on reaching 3 sets status `finished`, `winner` and `endReason: 'score'`.
- **R9** — `LocalSession` and the campaign behave as before.

## Acceptance criteria

- **AC1** (R1, R4, R5) — Given a host and guest on a 60 ms round-trip link, when the guest drives in a circle, then the host sees the guest's tank move within about 100 ms and the guest sees its own tank move smoothly with no visible jumps.
- **AC2** (R2) — Given 20% packet loss on the `state` channel, when the guest fires 10 shots, then the host fires exactly 10.
- **AC3** (R7) — Given a round ends with the host winning, when 1.8 seconds pass, then both see the round result and the score 1–0, then a new arena with a countdown.
- **AC4** (R8) — Given the guest's client calls `reportRound`, then Convex rejects it.
- **AC5** (R3) — Given a guest sends `{ move: { x: 1e9, z: NaN } }`, then the host's simulation receives an idle or clamped move and does not throw.

## Test plan

| ID | Covers | Test | File | Asserts |
|----|--------|------|------|---------|
| T1 | R3 | `protocol rejects malformed messages` | `src/net/protocol.test.ts` | Unknown type, missing fields, NaN, Infinity → `null`; long move clamped to length 1; a `roundStart` layout that is empty, not all strings, ragged, or larger than 20×14 → `null` |
| T2 | R2, R3 | `fire counters apply once per increase` | `src/net/hostSession.test.ts` | Counter 0→1→1→3 fires 3 times total over ticks; jump of 10 capped at 3; stale seq ignored |
| T3 | R1 | `host steps both players` | `src/net/hostSession.test.ts` | Over a `LinkPair`, guest moving right changes `p2.pos.x` on the host; with no input `p2` stays still |
| T4 | R4 | `snapshots carry events and grid edits` | `src/net/hostSession.test.ts` | After a mine breaks cork, the next snapshot lists the broken cells and an `explode` event |
| T5 | R5 | `guest interpolates positions and angles` | `src/net/guestSession.test.ts` | Between snapshots at x=0 and x=1, render at the midpoint gives x≈0.5; angle from 3.1 to −3.1 goes the short way |
| T6 | R5 | `events play once` | `src/net/guestSession.test.ts` | Duplicate and reordered snapshots → each event returned from `advance()` exactly once |
| T7 | R6 | `guest turret uses local aim` | `src/net/guestSession.test.ts` | Rendered `p2.turret` equals the local aim, not the snapshot value |
| T8 | R2 | `no shots lost under loss` | `src/net/session.integration.test.ts` | `LinkPair` with 20% `state` loss and 60 ms delay; guest fires 10 times spaced past cooldown → host `fire` events from `p2` = 10 |
| T9 | R7 | `round cycle runs end to end` | `src/net/session.integration.test.ts` | Forced p2 pop → `roundEnd` after `OUTCOME_DELAY`, score 1–0, next `roundStart` with a different arena, countdown ignores input |
| T10 | R8 | `reportRound accepts only the host's next round` | `convex/matches.test.ts` | Host round 1 OK; repeat round 1 rejected; guest rejected; third win sets `finished`, `winner`, `endReason` |
| T11 | R9 | `campaign unchanged` | `src/game/sim.test.ts` (existing) | Item 1's characterization tests pass |

**Not unit testable:** How smooth it feels (AC1). Verify manually with two machines, then with Chrome DevTools network throttling on the guest, and tune the snapshot rate and interpolation delay. Note the chosen values in the progress log.

## Implementation plan

1. [ ] Extract a `GameSession` interface, make `LocalSession` implement it, and pass `localPlayerId` into `Scene` instead of the `LOCAL_PLAYER` constant — touches `src/game/session.ts`, `src/render/Scene.tsx`, `src/App.tsx` — tests T11
2. [ ] Add the protocol module with validation — touches `src/net/protocol.ts`, `src/net/protocol.test.ts` — tests T1
3. [ ] Add `HostSession`: stepping, input counters, snapshots — touches `src/net/hostSession.ts`, `src/net/hostSession.test.ts` — tests T2, T3, T4
4. [ ] Add `GuestSession`: interpolation, event de-duplication, local turret — touches `src/net/guestSession.ts`, `src/net/guestSession.test.ts` — tests T5, T6, T7
5. [ ] Add the round cycle to both sessions and the end-to-end tests — touches `src/net/hostSession.ts`, `src/net/guestSession.ts`, `src/net/session.integration.test.ts` — tests T8, T9
6. [ ] Add `reportRound` and call it from the host — touches `convex/matches.ts`, `convex/matches.test.ts`, `src/net/hostSession.ts` — tests T10

**Must not change:** `step()`, `PlayerInput`, `GameEvent` shapes; campaign behavior.

**High-risk steps:** Step 3 — the host feeds data from another person's browser into the simulation; validation (step 2) must land first and be reviewed.

## Risks and open questions

- **Guest feel.** The guest's own tank responds after a round trip plus about 66 ms. On a 100 ms link that is around 170 ms, noticeable for driving. Open: add prediction for the guest's own movement (replay local input on top of the last snapshot) as a follow-up if playtests call for it.
- **Host advantage** is inherent to this design (epic risk).
- Snapshot size is estimated at 1–2 KB of JSON (2 tanks, up to ~8 bullets, up to 4 mines), about 30–60 KB/s. Measure in step 5; switch to a compact array encoding only if it matters.
- The host's `rAF` loop stops in a background tab. Item 11 owns that behavior; this item must not assume the host keeps ticking.
- Round results are reported by the host and not independently checked (epic risk, accepted).
- The guest parses the arena rows the host sends. `parseLevel` has no size limits, so the protocol must bound the layout (from pvp-sim-rules security review) before it reaches `createPvpGame` or the renderer.

## Progress log

- 2026-10-18 — Planned.
- 2026-10-18 — Plan approved.
- 2026-10-18 — Started on branch story/host-authoritative-netcode from origin/pvp-tank.
