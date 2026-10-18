---
type: task
epic: pvp-multiplayer    # removed by `wi new` when there is no parent epic
slug: convex-backend-setup
status: in-progress
branch: task/convex-backend-setup
worktree_path: /Users/nhealea/Personal/Development/tanks.nathanhealea.com/pvp-tanks-worktrees/task-convex-backend-setup
created: 2026-10-18
approved: 2026-10-18
commit_type:         # optional override for the release subject type (default: story=feat, bug=fix, task=chore)
version:             # set by `wi stage`
review_approved:     # set by `wi accept`
pr:                  # set by `wi pr`
tag:                 # set by `wi release`; the tag sits on the branch's last commit
---

# Add Convex backend and client wiring

## Summary

Add Convex as the game's backend: the `convex` package, an empty-but-real schema, a `ConvexReactClient` created only when `VITE_CONVEX_URL` is set, and the dev workflow. Nothing user-visible changes. This gives every later item a place to put server functions and a guarantee that the campaign keeps working without Convex.

## Context

The app is a Vite + React 19 static site on Cloudflare (`wrangler.json`, `vite.config.ts`). `src/main.tsx` renders `<App />`. Convex's React quickstart reads `import.meta.env.VITE_CONVEX_URL`, creates a `ConvexReactClient`, wraps the app in `ConvexProvider`, and keeps backend code in `convex/` with generated bindings in `convex/_generated/` ([Convex React quickstart](https://docs.convex.dev/quickstart/react)). `npx convex dev` syncs functions to a dev deployment and writes `CONVEX_DEPLOYMENT` and `VITE_CONVEX_URL` to `.env.local`. The service worker (`public/sw.js`) already ignores cross-origin requests, so traffic to `*.convex.cloud` is not cached. Depends on `pvp-test-harness`.

## Scope

**In scope**

- `convex` dependency, `convex/schema.ts` with the tables later items fill in, `convex/tsconfig.json`, generated `_generated/`.
- `src/net/convex.ts` exporting a client that is `null` when the URL is missing.
- Wrapping the app in `ConvexProvider` only when the client exists.
- `.env.local` git-ignored; `.env.example` listing `VITE_CONVEX_URL`.
- A shared validator module for player GUIDs (used by items 3, 6, 7).

**Out of scope**

- Any matchmaking, match or signaling functions (items 6–8).
- Production deploy (item 13).

## Requirements

- **R1** — With `VITE_CONVEX_URL` unset, the app builds, loads and plays the campaign exactly as today, and makes no network request to Convex.
- **R2** — With `VITE_CONVEX_URL` set, the app holds one Convex client for its lifetime, available to React components through `ConvexProvider`.
- **R3** — The Convex schema defines `queue`, `matches` and `signals` tables with the fields and indexes listed in this document, and deploys to a dev deployment without errors.
- **R4** — A Convex function test can run against the schema with convex-test.

## Acceptance criteria

- **AC1** (R1) — Given no `.env.local`, when `npm run build` and `npm run preview` run and a level is played, then the browser's network panel shows no request to `convex.cloud`.
- **AC2** (R2) — Given a valid `VITE_CONVEX_URL`, when the app loads, then exactly one WebSocket to the deployment opens.
- **AC3** (R3) — Given the schema, when `npx convex dev --once` runs, then it reports success.
- **AC4** (R4) — Given `convex/schema.test.ts`, when `npm test` runs, then it inserts and reads a row in each table.

## Test plan

| ID | Covers | Test | File | Asserts |
|----|--------|------|------|---------|
| T1 | R1 | `client is null without a url` | `src/net/convex.test.ts` | `createConvexClient(undefined)` and `createConvexClient('')` return `null` |
| T2 | R2 | `client is created with a url` | `src/net/convex.test.ts` | `createConvexClient('https://x.convex.cloud')` returns a `ConvexReactClient` |
| T3 | R3, R4 | `schema accepts each table` | `convex/schema.test.ts` | convex-test inserts a valid row into `queue`, `matches`, `signals` and reads it back by its index |
| T4 | R3 | `schema rejects bad rows` | `convex/schema.test.ts` | Inserting a match with an unknown `status` throws |
| T5 | — | `isPlayerId accepts v4 uuids only` | `convex/lib/ids.test.ts` | Accepts `crypto.randomUUID()` output; rejects empty, too long, non-hex, v1 UUIDs |

**Not unit testable:** R1 network silence and R2 single socket — verified manually in the browser network panel per AC1 and AC2.

## Implementation plan

1. [x] Add `convex`, run `npx convex dev` to scaffold `convex/`, add `.env.local` to `.gitignore` and an `.env.example` — touches `package.json`, `package-lock.json`, `.gitignore`, `.env.example`, `convex/tsconfig.json` — tests none (scaffold)
2. [x] Define the schema and its tests — touches `convex/schema.ts`, `convex/schema.test.ts` — tests T3, T4
3. [x] Add the GUID validator — touches `convex/lib/ids.ts`, `convex/lib/ids.test.ts` — tests T5
4. [x] Create the optional client and wrap `App` in `ConvexProvider` when present — touches `src/net/convex.ts`, `src/net/convex.test.ts`, `src/main.tsx` — tests T1, T2

**Schema (proposed):**

- `queue` — `playerId: string`, `joinedAt: number`, `lastSeen: number`. Indexes `by_player (playerId)`, `by_joined (joinedAt)`.
- `matches` — `kind: 'quick' | 'private'`, `code?: string`, `expiresAt?: number`, `hostId: string`, `guestId?: string`, `status: 'waiting' | 'connecting' | 'playing' | 'finished' | 'abandoned'`, `seed: number`, `round: number`, `hostScore: number`, `guestScore: number`, `winner?: 'host' | 'guest'`, `endReason?: 'score' | 'forfeit' | 'timeout'`, `createdAt: number`, `hostSeen: number`, `guestSeen?: number`, `rematchOf?: Id<'matches'>`, `hostRematch?: boolean`, `guestRematch?: boolean`. Indexes `by_code (code)`, `by_host (hostId)`, `by_guest (guestId)`, `by_status (status, createdAt)`.
- `signals` — `matchId: Id<'matches'>`, `to: 'host' | 'guest'`, `kind: 'offer' | 'answer' | 'ice'`, `payload: string`, `createdAt: number`. Index `by_match_to (matchId, to)`.

**Must not change:** Campaign behavior, `public/sw.js`, `wrangler.json`, the `npm run build` contract (still `tsc --noEmit && vite build`).

**High-risk steps:** Step 1 creates a Convex project and dev deployment under the user's Convex account (outward-facing; `npx convex dev` prompts for login). Stop for sign-off before running it.

## Risks and open questions

- `tsc --noEmit` at the root must not try to type-check `convex/` with the browser `tsconfig`; Convex ships its own `convex/tsconfig.json`. Confirm the root `tsconfig.json` `include` stays `src`.
- `convex/_generated/` is committed by Convex's convention so the frontend builds without running `convex dev`. Keep it committed.
- The schema is a proposal; items 6, 7, 8 and 11 may refine fields. Schema changes on an empty dev deployment are free, so refine in those items rather than over-design here.

## Progress log

- 2026-10-18 — Planned.
- 2026-10-18 — Plan approved.
- 2026-10-18 — Started on branch task/convex-backend-setup from origin/pvp-tank.
- 2026-10-18 — Step 2 also adds tsc -p convex to npm run typecheck, so convex code is type-checked by wi verify; Convex 1.46 did not scaffold convex/tsconfig.json, so step 1 wrote it from Convex's template. Schema pushed to usable-manatee-416 (AC3).
- 2026-10-18 — Build complete. R1 checked from the bundle side: built with VITE_CONVEX_URL unset, the bundle has no deployment URL and no client is created; browser network-panel checks (AC1, AC2) not done in a browser. Convex client adds ~66 kB raw / 18 kB gzip.
