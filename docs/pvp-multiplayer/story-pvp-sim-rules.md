---
type: story
epic: pvp-multiplayer    # removed by `wi new` when there is no parent epic
slug: pvp-sim-rules
status: staged
branch: story/pvp-sim-rules
worktree_path: /Users/nhealea/Personal/Development/tanks.nathanhealea.com/pvp-tanks-worktrees/story-pvp-sim-rules
created: 2026-10-18
approved: 2026-10-18
commit_type:         # optional override for the release subject type (default: story=feat, bug=fix, task=chore)
version: 0.3.0
review_approved: 2026-10-18
pr:                  # set by `wi pr`
tag:                 # set by `wi release`; the tag sits on the branch's last commit
---

# Two-player PvP rules in the simulation

## Summary

Teach the simulation to run a PvP round: two player tanks on opposing teams, no AI, the last tank standing wins, and a simultaneous double pop is a draw. Add a small pure module that scores rounds into a first-to-3 match. Everything stays inside `src/game/`, plain TypeScript, so the networked session (item 9) can drive it with `step()` unchanged.

## Context

`createGame(levelIndex, playerIds, seed)` in `src/game/sim.ts` builds a campaign level: `P` → `p1`, `2` → `p2`, both on team 0 (co-op), enemies on team 1. `updateOutcome()` sets `outcome` to `'lost'` when team 0 is gone and `'won'` when team 1 is gone. Mines already trigger only for tanks on another team (`updateMines`), and bullets hit any tank including the shooter's own, which is right for PvP. `GameState.outcome` is typed `'won' | 'lost' | null`, and `Scene` passes it to `App.onOutcome`. Depends on `pvp-test-harness`; the characterization test T4 there guards campaign behavior.

## Scope

**In scope**

- `GameState.mode: 'campaign' | 'pvp'` and `GameState.winner: string | null`.
- `createPvpGame(rows, seed)` that builds a PvP round from any layout with `P` and `2` spawns.
- PvP outcome: one tank left → that tank's ID wins; zero left on the same tick → draw.
- `src/game/match.ts`: score a match round by round; first to `ROUNDS_TO_WIN = 3` wins.

**Out of scope**

- Generating PvP maps (item 5); this item tests with hand-written layouts.
- Networking, HUD, screens.

## Requirements

- **R1** — `createPvpGame(rows, seed)` creates exactly two tanks: `p1` on team 0 at `P` facing +x, and `p2` on team 1 at `2` facing −x, with player stats, and no AI tanks even if the layout has enemy letters.
- **R2** — In PvP mode, when exactly one tank is alive at the end of a tick, `outcome` becomes `'won'` and `winner` is that tank's ID.
- **R3** — In PvP mode, when both tanks pop on the same tick (crossed shots, shared mine blast, own rebound), `outcome` becomes `'draw'` and `winner` is `null`.
- **R4** — A player's own mine never triggers on its owner's proximity in PvP, but does trigger on the opponent; any blast pops every tank in range, owner included.
- **R5** — Match scoring: a won round adds one point to the winner; a draw adds none; the first player to 3 points wins the match and further rounds are refused.
- **R6** — Campaign games behave exactly as before: same tanks, same outcomes, `mode: 'campaign'`, `winner: null`.

## Acceptance criteria

- **AC1** (R1) — Given a layout with `P`, `2` and a `t`, when `createPvpGame` runs, then there are two tanks, on teams 0 and 1, and no `ai*` tank.
- **AC2** (R2) — Given p1 fires a shell that hits p2, when the tick resolves, then `outcome` is `'won'` and `winner` is `'p1'`.
- **AC3** (R3) — Given both tanks stand in one mine's blast radius, when it explodes, then `outcome` is `'draw'`.
- **AC4** (R5) — Given a score of 2–2 and a draw, when the next round is won by p2, then the match result is p2 winning 3–2.
- **AC5** (R6) — Given the harness's campaign characterization tests, when they run after this change, then they pass unchanged.

## Test plan

| ID | Covers | Test | File | Asserts |
|----|--------|------|------|---------|
| T1 | R1 | `createPvpGame builds two opposing tanks` | `src/game/pvp.test.ts` | Two tanks, IDs `p1`/`p2`, teams 0/1, facings ±π/2, kind `player`, `mode === 'pvp'` |
| T2 | R1 | `createPvpGame ignores enemy letters` | `src/game/pvp.test.ts` | A layout containing `t` and `h` yields no AI tanks and the cells are floor |
| T3 | R1 | `createPvpGame rejects a layout without both spawns` | `src/game/pvp.test.ts` | Throws when `P` or `2` is missing |
| T4 | R2 | `a hit wins the round` | `src/game/pvp.test.ts` | Scripted p1 fire into p2 in an open layout → `outcome 'won'`, `winner 'p1'` |
| T5 | R3 | `a shared blast is a draw` | `src/game/pvp.test.ts` | Both tanks beside a mine forced to `fuse` → `outcome 'draw'`, `winner null` |
| T6 | R3 | `crossed shells on one tick draw` | `src/game/pvp.test.ts` | Tanks placed so shells land the same tick → draw |
| T7 | R4 | `own mine ignores owner, trips on opponent` | `src/game/pvp.test.ts` | Owner parked on armed mine for 2 s → no explosion; opponent enters → explosion |
| T8 | R5 | `scoring counts wins and skips draws` | `src/game/match.test.ts` | Sequence win/draw/win → 2–0 for the winner, `round` advanced 3 times |
| T9 | R5 | `first to three ends the match` | `src/game/match.test.ts` | Reaching 3 sets `winner`; `applyRound` after that throws; a result other than `p1`, `p2` or `null` throws |
| T10 | R6 | `campaign games are untouched` | `src/game/sim.test.ts` (existing) | Item 1's T4 still passes; new assertion that campaign state has `mode 'campaign'`, `winner null` |

**Not unit testable:** None.

## Implementation plan

1. [x] Add `mode` and `winner` to `GameState`, `'draw'` to `outcome`, and set them in `createGame` — touches `src/game/types.ts`, `src/game/sim.ts`, `src/game/sim.test.ts`, `src/render/Scene.tsx` — tests T10
2. [x] Add `createPvpGame` by extracting spawn-to-tank construction from `createGame` — touches `src/game/sim.ts`, `src/game/pvp.test.ts` — tests T1, T2, T3
3. [x] Add the PvP branch of `updateOutcome` — touches `src/game/sim.ts`, `src/game/pvp.test.ts` — tests T4, T5, T6, T7
4. [x] Add match scoring and `ROUNDS_TO_WIN` — touches `src/game/match.ts`, `src/game/match.test.ts`, `src/game/config.ts` — tests T8, T9

**Must not change:** `createGame(levelIndex, playerIds, seed)` signature and campaign results; `step(state, inputs)` signature; `PlayerInput`; `GameEvent`.

**High-risk steps:** None.

## Risks and open questions

- Widening `outcome` to include `'draw'` touches `Scene`'s `onOutcome` type. Campaign code never sees a draw; narrow the type at the `App` boundary rather than handling an impossible case.
- R1 ignores enemy letters so item 5 can reuse the shared layout parser. If item 5 never emits them, T2 still documents the contract.
- Open (proposed default): the round ends the instant one tank is left, and in-flight shells stop mattering. The alternative — wait for bullets to clear so a dying shot can still trade — feels fairer but drags. Revisit after playtests.

## Progress log

- 2026-10-18 — Planned.
- 2026-10-18 — Plan approved.
- 2026-10-18 — Started on branch story/pvp-sim-rules from origin/pvp-tank.
- 2026-10-18 — Staging review: no HIGH/MED. Fixed: GameState.winner and applyRound share a runtime-checked PvpPlayer type (removes an unchecked cast item 9 would need; rejects junk results). T9 row now says winner. Added layout-size validation to item 9's protocol test plan (security review: parseLevel has no bounds).
- 2026-10-18 — Test audit: 25 of 32 mutants killed; 3 equivalent, 1 unreachable guard, 1 untouched campaign code; fixed the 2 real gaps (PvP outcomeTime, exact spawn error) and both are now killed. Comment and import order corrected.
- 2026-10-18 — Staged: verification passed; version 0.2.0 → 0.3.0; no changelog file.
- 2026-10-18 — Review approved.
