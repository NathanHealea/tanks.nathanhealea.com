---
type: story
epic: pvp-multiplayer    # removed by `wi new` when there is no parent epic
slug: pvp-map-generator
status: released
branch: story/pvp-map-generator
worktree_path: /Users/nhealea/Personal/Development/tanks.nathanhealea.com/pvp-tanks-worktrees/story-pvp-map-generator
created: 2026-10-18
approved: 2026-10-18
commit_type:         # optional override for the release subject type (default: story=feat, bug=fix, task=chore)
version: 0.4.0
review_approved: 2026-10-18
pr:                  # set by `wi pr`
tag: v0.4.0
---

# Random symmetric PvP arena generator

## Summary

Generate a new random arena for every PvP round from a seed. Arenas are 20×14 like the campaign, point-symmetric so neither spawn has an advantage, always connected between spawns, and never give either spawn line of sight to the other at the start. The generator borrows the campaign generator's approach (seeded rejection sampling) without changing a single campaign level.

## Context

`src/game/levels.ts` builds campaign levels with `tryBuild()`: a seeded `mulberry32`, random wall segments of solid `#` and cork `o`, player spawns at column 1, a cover wall at column 3, and `isFair()` that rejects layouts where an enemy can see a spawn or cannot be reached (BFS in `reachable()`, sampled line of sight in `grid.ts` `lineOfSight()`). `mulberry32` and `reachable` are module-private. The seed for each match comes from Convex (item 6/7); the round seed is derived from it. The host generates the layout and sends the rows to the guest (item 9), so cross-engine float differences in `lineOfSight` cannot desync the two players. Depends on `pvp-test-harness` (level snapshot guard) and `pvp-sim-rules` (`createPvpGame` consumes the output).

## Scope

**In scope**

- `src/game/pvpMaps.ts` exporting `generatePvpMap(seed: number): string[]` and `roundSeed(matchSeed: number, round: number): number`.
- Moving `mulberry32` and `reachable` into a shared module used by both generators.

**Out of scope**

- Map size or theme variety, hand-authored PvP maps, power-ups.

## Requirements

- **R1** — `generatePvpMap(seed)` returns 14 rows of 20 characters using only `.`, `#`, `o`, `P` and `2`, with exactly one `P` and one `2`.
- **R2** — Every arena is point-symmetric: the cell at (c, r) equals the cell at (19 − c, 13 − r), with `P` and `2` swapping.
- **R3** — `P` is in column 1 and `2` in column 18, and `2` is reachable from `P` by driving through empty cells.
- **R4** — Neither spawn has line of sight to the other at the start, and each spawn has at least one solid or cork cell within 2 cells of it (cover).
- **R5** — Walls and cork cover between 12% and 30% of the arena.
- **R6** — The same seed always returns the same arena; different seeds give visibly different arenas (no two of 100 consecutive seeds identical).
- **R7** — Generation always succeeds: if rejection sampling has not found a valid arena within 200 attempts, a fixed valid fallback arena is returned.
- **R8** — Generation averages under 20 ms per arena in Node on the developer machine.
- **R9** — All 50 campaign layouts are unchanged.

## Acceptance criteria

- **AC1** (R1–R5) — Given seeds 1 through 1,000, when each arena is generated, then every one passes the shape, symmetry, reachability, line-of-sight, cover and density checks.
- **AC2** (R6) — Given seed 42 generated twice, then the rows are identical.
- **AC3** (R7) — Given a generator forced to reject every attempt, then the fallback arena is returned and itself passes AC1's checks.
- **AC4** (R9) — Given item 1's level snapshot test, when it runs, then it passes.

## Test plan

| ID | Covers | Test | File | Asserts |
|----|--------|------|------|---------|
| T1 | R1 | `arena has the right shape and spawns` | `src/game/pvpMaps.test.ts` | 14×20, legal characters only, one `P`, one `2` — for seeds 1–1000 |
| T2 | R2 | `arena is point-symmetric` | `src/game/pvpMaps.test.ts` | Mirror check for every cell, `P`↔`2` swapped — seeds 1–1000 |
| T3 | R3 | `spawns are connected` | `src/game/pvpMaps.test.ts` | `P` in column 1, `2` in column 18, BFS from `P` reaches `2` — seeds 1–1000 |
| T4 | R4 | `spawns are hidden and covered` | `src/game/pvpMaps.test.ts` | `lineOfSight` between spawn centers is false; cover cell within 2 — seeds 1–1000 |
| T5 | R5 | `wall density is in range` | `src/game/pvpMaps.test.ts` | Non-floor, non-spawn share within [0.12, 0.30] — seeds 1–1000 |
| T6 | R6 | `seed is deterministic and varied` | `src/game/pvpMaps.test.ts` | Same seed twice equal; seeds 1–100 produce 100 distinct arenas; `roundSeed` differs per round |
| T7 | R7 | `fallback arena is valid` | `src/game/pvpMaps.test.ts` | With attempts forced to 0, returns the fallback and it passes T1–T5's checks |
| T8 | R8 | `generation is fast` | `src/game/pvpMaps.test.ts` | 200 arenas generate in under 4 s (generous bound to avoid CI flake) |
| T9 | R9 | `campaign levels are unchanged` | `src/game/levels.test.ts` (existing) | Item 1's T2 passes after the shared-module refactor |
| T10 | R1 | `createPvpGame accepts every arena` | `src/game/pvpMaps.test.ts` | `createPvpGame(generatePvpMap(s), s)` does not throw for seeds 1–100 |
| T11 | R5 | `most arenas have cork for mines to break` | `src/game/pvpMaps.test.ts` | Over 80% of seeds 1–1000 contain cork (92% today; the spawn-front walls alone give about 63%) |
| T12 | R6 | `roundSeed rejects seeds that would lose their randomness` | `src/game/pvpMaps.test.ts` | Fractional, NaN, infinite, negative and ≥ 2³² seeds throw; 0 and 2³²−1 do not |

**Not unit testable:** Whether the arenas are fun. Verify by eye: generate 20 arenas, play several rounds in item 10's dev build, tune segment counts and cork share.

## Implementation plan

1. [x] Move `mulberry32` and `reachable` into a shared module with no output change — touches `src/game/levels.ts`, `src/game/layout.ts` — tests T9
2. [x] Add `generatePvpMap` with symmetric placement, spawn cover and the fairness check — touches `src/game/pvpMaps.ts`, `src/game/pvpMaps.test.ts` — tests T1, T2, T3, T4, T5, T6, T10
3. [x] Add the fallback arena and attempt cap, and `roundSeed` — touches `src/game/pvpMaps.ts`, `src/game/pvpMaps.test.ts` — tests T6, T7, T8

**Must not change:** `getLevel()` output for every campaign index; `parseLevel()` signature.

**High-risk steps:** None.

## Risks and open questions

- Point symmetry (180° rotation) rather than left-right mirror: mirror symmetry gives a center column where walls always pair across the middle and looks artificial; rotation keeps both players' views equivalent. Proposed; change if playtests disagree.
- The cork share decides how much mines reshape the map mid-round. Start at the campaign tier-0 value (20%) and tune.
- `lineOfSight` samples every 0.2 units and can miss a corner graze. Same limitation the campaign already accepts.

## Progress log

- 2026-10-18 — Planned.
- 2026-10-18 — Plan approved.
- 2026-10-18 — Started on branch story/pvp-map-generator from origin/pvp-tank.
- 2026-10-18 — Steps 2 and 3 landed in one commit (same file). Fallback arena is generated from seed 20261018, not hand-drawn. Mutations: dropping mirroring, reachability, density or round variation fail tests; dropping the line-of-sight or cover check changes no output because the spawn-front wall guarantees both, so those checks are kept as a guard and the tests assert the properties directly.
- 2026-10-18 — Staging review: code review LOW (seed truncation) fixed; test audit HIGH (connectivity test shared the generator's reachable) fixed with an independent flood fill; seed range made unsigned-only; fallback copy, cork presence and seed edges now tested (T11, T12). Items 6 and 7 plans updated to create unsigned 32-bit seeds.
- 2026-10-18 — Staged: verification passed; version 0.3.0 → 0.4.0; no changelog file.
- 2026-10-18 — Review approved.
- 2026-10-18 — Released 0.4.0 as v0.4.0.
