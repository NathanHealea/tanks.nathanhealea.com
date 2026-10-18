---
type: task
epic: pvp-multiplayer    # removed by `wi new` when there is no parent epic
slug: pvp-test-harness
status: staged
branch: task/pvp-test-harness
worktree_path: /Users/nhealea/Personal/Development/tanks.nathanhealea.com/pvp-tanks-worktrees/task-pvp-test-harness
created: 2026-10-18
approved: 2026-10-18
commit_type:         # optional override for the release subject type (default: story=feat, bug=fix, task=chore)
version: 0.1.1
review_approved:     # set by `wi accept`
pr:                  # set by `wi pr`
tag:                 # set by `wi release`; the tag sits on the branch's last commit
---

# Add Vitest and convex-test harness

## Summary

Add a test runner so the rest of the PvP epic can be built test-first. The repo has no tests today; netcode, matchmaking races and map fairness are exactly the kind of logic that breaks quietly. This adds Vitest for the game code and convex-test for Convex functions, plus one characterization test that pins the 50 campaign levels so later refactors of `levels.ts` and `sim.ts` cannot change them unnoticed.

## Context

`package.json` has `build`, `typecheck` and `deploy` scripts and no test script. `wi config` shows `test_command` empty and `verify_commands` of `npm run typecheck` and `npm run build`. The game code in `src/game/` is plain TypeScript with no DOM or three.js imports, so it runs under Node as-is. convex-test needs `vitest` and `@edge-runtime/vm`, and runs `convex/` tests in the `edge-runtime` environment ([convex-test docs](https://docs.convex.dev/testing/convex-test)). Part of epic `pvp-multiplayer`; every later child depends on this.

## Scope

**In scope**

- Dev dependencies `vitest`, `convex-test`, `@edge-runtime/vm`.
- `vitest.config.ts` with two projects: `src/**` in `node`, `convex/**` in `edge-runtime`.
- `npm test` and `npm run test:watch` scripts.
- Characterization test for campaign levels and a short campaign simulation.
- `wi verify` running the tests (it detects the `test` script in `package.json`; no `CLAUDE.md` needed).

**Out of scope**

- Component or browser tests for React and three.js.
- Any `convex/` source (item 2 adds Convex; the `edge-runtime` project is configured but has no tests until then).

## Requirements

- **R1** — `npm test` runs every `*.test.ts` under `src/` and `convex/` once and exits non-zero on any failure.
- **R2** — The layouts of all 50 campaign levels are pinned: any change to `getLevel()` output fails a test.
- **R3** — A fixed-seed campaign simulation is pinned: running level 1 for 600 ticks with a scripted input produces the same final state as today.
- **R4** — `wi verify` runs the tests alongside typecheck and build.

## Acceptance criteria

- **AC1** (R1) — Given a test that fails, when `npm test` runs, then it exits with a non-zero status.
- **AC2** (R2) — Given someone edits `tryBuild()` in `levels.ts`, when tests run, then the level characterization test fails and names the first changed level.
- **AC3** (R3) — Given someone changes bullet or tank physics, when tests run, then the simulation characterization test fails.
- **AC4** (R4) — Given the harness is merged, when `wi verify` runs, then it runs `npm test`.

## Test plan

| ID | Covers | Test | File | Asserts |
|----|--------|------|------|---------|
| ~~T1~~ | R1 | `harness runs` | `src/game/harness.test.ts` | Removed in step 2 once T2 existed. R1's non-zero exit on failure was checked by hand and by every killed mutant in the audit |
| T2 | R2 | `campaign levels are unchanged` | `src/game/levels.test.ts` | For each index 0–49, `getLevel(i).join('\n')` matches a stored file snapshot (one test per level), and `LEVEL_COUNT` is 50 |
| T3 | R2 | `every campaign level is fair` | `src/game/levels.test.ts` | Each level has one `P`, one `2`, `enemyCount(i)` enemies, every spawn drivable from `P`, and no enemy with line of sight to a player spawn |
| T4 | R3 | `level 1 replays identically` | `src/game/sim.test.ts` | `createGame(0, ['p1'], 12345)` stepped 600 ticks with a scripted input matches a stored snapshot of tanks, bullets, mines, outcome and grid |
| T5 | R3 | `a shell that hits the last enemy wins the level`, `losing the player loses the level` | `src/game/sim.test.ts` | In a cleared arena, a hit pops the target and sets `outcome` to `'won'` or `'lost'` |
| T6 | R3 | `a shell bounces once, then ends at the next wall`, `shells meeting head-on destroy each other` | `src/game/sim.test.ts` | One `bounce` then one `bulletEnd`; head-on shells emit one `clash` |
| T7 | R3 | mine cases (fuse, arming, own team, blast radius and cork, spacing and reload) | `src/game/sim.test.ts` | Fuse fires at tick 540, an enemy trips an armed mine at tick 45, own team never trips it, the blast pops and breaks cork only inside 1.7, mines refill 8 s after the last drop |
| T8 | R2 | `difficulty and new-tank levels are unchanged`, `asking past the last level throws` | `src/game/levels.test.ts` | Snapshot of `levelDifficulty` and `newTankAt` for all 50; `getLevel(50)` and `getLevel(-1)` throw |
| T9 | R1, R2 | `npm test` fails on a missing snapshot | `package.json` (`--update none`) | Deleting a snapshot file makes `npm test` exit non-zero (checked by hand during staging) |

**Not unit testable:** R4 — verified by running `wi verify` and seeing the test step in its output.

## Implementation plan

1. [x] Add `vitest`, `convex-test` and `@edge-runtime/vm` as dev dependencies, `vitest.config.ts` with `node` and `edge-runtime` projects, and `test` / `test:watch` scripts — touches `package.json`, `package-lock.json`, `vitest.config.ts`, `tsconfig.json` — tests T1
2. [x] Pin campaign levels with snapshot and fairness tests — touches `src/game/levels.test.ts` — tests T2, T3
3. [x] Pin a fixed-seed level-1 simulation — touches `src/game/sim.test.ts` — tests T4
4. [x] Confirm `wi verify` runs `npm run test` through its `package.json` script detection, so no `CLAUDE.md` is needed — touches nothing — tests none (config only)

**Must not change:** Any file under `src/` other than new `*.test.ts` files. `npm run build` output.

**High-risk steps:** None.

## Risks and open questions

- ~~The repo has no `CLAUDE.md`; step 4 creates one holding only the workflow section.~~ Resolved: `wi` detects the `test` script in `package.json`, so no `CLAUDE.md` is created.
- `tsconfig.json` includes `src/`; test files must type-check without pulling Vitest globals into app code. Use explicit `import { describe, it, expect } from 'vitest'` rather than globals.
- T4 depends on floating-point results in Node's V8. Fine for a characterization test on one engine; it is not a cross-browser determinism guarantee (see the epic).
- Versions: pin whatever is current and at least two weeks old at build time; check `vitest` peer compatibility with Vite 8 before installing.

## Progress log

- 2026-10-18 — Planned.
- 2026-10-18 — Plan approved.
- 2026-10-18 — Started on branch task/pvp-test-harness from origin/main.
- 2026-10-18 — Step 4 changed: wi verify already runs npm run test via package.json detection (verified), so no CLAUDE.md is created; R4 still met.
- 2026-10-18 — Staging review: test-engineer audit found hit detection, bounce limit, outcome, clash and mine rules unpinned (15 of 32 mutants survived). Added T5-T9, strengthened T3, made npm test fail on missing snapshots; re-ran the 14 relevant mutants, all killed.
- 2026-10-18 — Staged: verification passed; version 0.1.0 → 0.1.1; no changelog file.
