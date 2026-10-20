---
type: task
epic: pvp-multiplayer    # removed by `wi new` when there is no parent epic
slug: pvp-deploy-docs
status: in-progress
branch: task/pvp-deploy-docs
worktree_path: /Users/nhealea/Personal/Development/tanks.nathanhealea.com/pvp-tanks-worktrees/task-pvp-deploy-docs
created: 2026-10-18
approved: 2026-10-18
commit_type:         # optional override for the release subject type (default: story=feat, bug=fix, task=chore)
version:             # set by `wi stage`
review_approved:     # set by `wi accept`
pr:                  # set by `wi pr`
tag:                 # set by `wi release`; the tag sits on the branch's last commit
---

# Deploy Convex with the site and document PvP

## Summary

Make `npm run deploy` publish both halves of the game — Convex functions to the production deployment and the static site to Cloudflare — with the production Convex URL baked into the build. Update the README so a reader can play online, run it locally with Convex, deploy it, and understand what data online play shares.

## Context

`npm run deploy` is `npm run build && wrangler deploy`, with `CLOUDFLARE_API_TOKEN` in `.env`. `npx convex deploy` pushes functions to production using `CONVEX_DEPLOY_KEY`, and its `--cmd` option runs the frontend build with the production URL in the environment; for Vite it sets `VITE_CONVEX_URL` (inferred from Convex's hosting docs; verify in step 1). The README has a "Built for two players later" section describing the plan this epic carries out, plus "Run it locally", "Deploy" and "How the code is laid out" sections that all need updating. The service worker serves pages network-first, so a new deploy reaches installed copies on next load; a stale client meeting a new one fails with `VERSION_MISMATCH` (item 8). Depends on `pvp-match-screens` and `disconnect-and-cleanup`.

## Scope

**In scope**

- `deploy` script running `convex deploy` with the site build, then `wrangler deploy`.
- `.env.example` listing `CLOUDFLARE_API_TOKEN`, `CONVEX_DEPLOY_KEY`, `VITE_CONVEX_URL` (dev), and optional `VITE_ICE_SERVERS`.
- README sections: playing online, local development with Convex, deploying, privacy, layout of `convex/` and `src/net/`.
- A production smoke test.

**Out of scope**

- CI/CD pipelines.

## Requirements

- **R1** — `npm run deploy` deploys Convex functions to production, builds the site with the production `VITE_CONVEX_URL`, and deploys it to Cloudflare; if either deploy fails, the command exits non-zero and the site is not deployed with a mismatched backend.
- **R2** — No secret is committed: `.env` and `.env.local` stay ignored; `.env.example` holds names only.
- **R3** — The README explains how to play online (quick match, private code, share link), how to run with `npx convex dev`, which environment variables to set where, and how to deploy.
- **R4** — The README states plainly what online play shares: a random per-visit ID, match scores and presence times stored in Convex for up to 24 hours; that every match goes through Cloudflare's TURN relay, so other players never see your IP address, but Cloudflare does; and that Cloudflare also serves the site. The in-game notice says the same in short form (turn-relay R6).
- **R5** — The production smoke test passes: two devices on different networks complete a quick match and a private match via share link, and the campaign still works offline after install.
- **R6** — Before the public deploy, `joinQueue`, `createPrivate` and `joinPrivate` share one sitewide limit of 120 calls per minute (user decision 2026-10-19: hand-built counter, no new dependency). A call over the limit is refused with ConvexError `RATE_LIMITED`, creates no rows, and the player is told to try again in a minute. Queue heartbeats are not counted. Without player identity the limit is sitewide: a flood blocks everyone for that minute. Deferred here from the random-matchmaking security review (2026-10-18).
- **R7** — Private match codes are drawn with `crypto.getRandomValues` in a Convex action, which Convex does not hold to its determinism rules, instead of the seeded `Math.random` of a mutation, whose seed Convex does not document as unpredictable ([Convex runtimes](https://docs.convex.dev/functions/runtimes)). Revisited here per the 2026-10-18 decision.
- **R8** — Production has its own TURN key, set by the account owner in the production deployment's settings in the Convex dashboard (not `npx convex env set --prod`, which the CLI ignores while a dev deploy key is in `.env.local`), and a Cloudflare billing notification. The dev key, whose token appeared in a session transcript, is revoked after testing.

## Acceptance criteria

- **AC1** (R1) — Given valid keys, when `npm run deploy` runs, then the Convex dashboard shows the new functions and `tanks.nathanhealea.com` loads with **Play online**.
- **AC2** (R1) — Given an invalid `CONVEX_DEPLOY_KEY`, when `npm run deploy` runs, then it fails before `wrangler deploy`.
- **AC3** (R2) — Given the repo, when `git ls-files` is checked, then no `.env*` other than `.env.example` is tracked.
- **AC4** (R5) — Given the deployed site, when the smoke test runs, then every step passes and is recorded in the progress log.
- **AC5** (R6) — Given a client calling `joinQueue` with a new player id in a tight loop, when it exceeds the limit, then further calls are rejected with a clear error and no rows are created for them.
- **AC6** (R7) — Given many private matches created in a row, when their codes are compared, then they show no repeat or pattern and come from the action path, not a mutation.

## Test plan

| ID | Covers | Test | File | Asserts |
|----|--------|------|------|---------|
| T1 | R2 | `no env files are tracked` | `scripts/repo.test.mjs` | `git ls-files` output contains no `.env` paths except `.env.example` |
| T2 | R6 | `matchmaking calls are rate limited` | `convex/rateLimit.test.ts` | The 121st call to joinQueue, createPrivate or joinPrivate within one minute throws RATE_LIMITED and inserts nothing; heartbeats are not counted; the next minute accepts calls; old counter rows are swept |
| T3 | R7 | `codes come from an unpredictable source` | `convex/privateMatch.test.ts` | `createPrivate` (now an action) stores a code drawn from `crypto.getRandomValues` (stubbed to a fixed sequence → that exact code); a collision with a live code draws again |

**Not unit testable:** R1 — run `npm run deploy` once with a bad deploy key (AC2) and once for real (AC1). R3, R4 — read-through by someone who has not seen the code: can they run it locally from the README alone? R5 — manual smoke test on production: (1) quick match laptop vs phone on cellular; (2) private match via share link; (3) leave mid-match and see the forfeit; (4) install the PWA, go offline, play a campaign level; (5) check the Convex dashboard for errors.

## Implementation plan

1. [x] Confirm `convex deploy --cmd` sets `VITE_CONVEX_URL` for Vite, then update the `deploy` script and `.env.example` — touches `package.json`, `.env.example`, `scripts/deploy.mjs`, `scripts/repo.test.mjs`, `vitest.config.ts` — tests T1
2. [x] Add the sitewide matchmaking rate limit and its player message — touches `convex/lib/rateLimit.ts`, `convex/schema.ts`, `convex/matchmaking.ts`, `convex/privateMatch.ts`, `convex/sweep.ts`, `convex/rateLimit.test.ts`, `src/ui/online/*` — tests T2
3. [x] Draw private codes in an action with `crypto.getRandomValues` — touches `convex/privateMatch.ts`, `convex/privateMatch.test.ts`, `src/net/usePrivateMatch.ts` — tests T3
4. [x] Update the README — touches `README.md` — tests none (read-through)
5. [ ] Create the production Convex deployment, set its environment variables (the owner sets the TURN key), and deploy — touches nothing in the repo — tests none (manual AC1, AC2)
6. [ ] Run the production smoke test and record the results — touches this document — tests none (manual R5)

**Must not change:** The Cloudflare Worker config in `wrangler.json`, the custom domain, and the campaign's offline install.

**High-risk steps:** Step 5 — creates production infrastructure and publishes to the public site; cannot be undone by `git revert`. Stop for sign-off before running it. Step 3 changes how a security-relevant value is generated; review its tests with the security reviewer.

## Risks and open questions

- If Convex deploys and Wrangler then fails, the old site talks to the new backend. Keep backend changes backward compatible within a release, or accept a short window; `PROTOCOL_VERSION` covers client-to-client mismatches but not client-to-Convex.
- ~~The README's privacy wording depends on the item 12 decision.~~ Decided: every match is relay-only (R4).
- ~~**Open: how to rate limit (R6).**~~ Decided 2026-10-19: hand-built, 120 calls a minute sitewide. Either `@convex-dev/rate-limiter` (Convex's official component; a new dependency, needs approval) or a hand-built counter table with a global per-minute cap (no dependency, more code to own). Decide when this item is planned in detail. Adding R6 means a new implementation step before the production deploy step.
- ~~**Revisit with R6: share-code randomness.**~~ Proposed as R7 (action + `crypto.getRandomValues`). Private codes come from Convex's seeded `Math.random`; Convex's docs do not say whether that seed is unpredictable to clients. Kept for now by the user's decision (2026-10-18); the alternative is generating codes in a Convex action with `crypto.getRandomValues`. The rate limit does not slow guessing: a wrong code fails before it is counted, and a failed mutation rolls the count back. Guessing is bounded by the 31⁶ code space and the 10-minute life (review 2026-10-19).

- Deploy order: `npx convex deploy --cmd` builds the site with the production URL and then pushes the backend; `wrangler deploy` follows, so the backend is live before the site. Item 11 asked for the site first because matches in play on old clients have no presence rows; production has no online clients before this first launch, so the order is safe now. Later releases that change presence need the site first.
- Rate limiting is sitewide only: the cost of anonymous play without identity.

## Progress log

- 2026-10-18 — Planned.
- 2026-10-18 — Plan approved.
- 2026-10-18 — Added R6/AC5/T2: rate-limit the public matchmaking functions before the public deploy, deferred here from the random-matchmaking security review at the user's direction. Mechanism is an open decision.
- 2026-10-19 — Started on branch task/pvp-deploy-docs from origin/pvp-tank.
- 2026-10-19 — Plan revised 2026-10-19 after items 10-12: R4 relay-only wording; R6 hand-built sitewide limit of 120 calls/min (user decision); R7 codes from crypto.getRandomValues in an action (proposed); R8 production TURN key and billing notification; steps now 1 deploy script, 2 rate limit, 3 codes, 4 README, 5 production deploy (high-risk), 6 smoke test. Confirmed from Convex docs: deploy --cmd sets VITE_CONVEX_URL, builds, then pushes the backend. Awaiting the user's approval of the revised plan.
- 2026-10-19 — Step 1: verified from convex deploy --help that it targets the deployment of whatever CONVEX_DEPLOY_KEY it finds, and by a dry run that a key given inline wins over .env.local's dev key. scripts/deploy.mjs requires CONVEX_PROD_DEPLOY_KEY (prod:) from .env; tested with no key, a dev key and an invalid prod key: each stops before wrangler (AC2 locally). T1 passed before any change (no env file was tracked); it is a guard.
- 2026-10-19 — Review fixes (612cc7d..59782ee): relay candidates' related address (the player's own IP as the relay saw it) is blanked in every outgoing candidate, offer and answer — found by the privacy review, needs a real-browser check that relay connections still form; README production TURN step moved to the dashboard because the CLI ignores --prod while .env.local holds a dev deploy key (confirmed in convex/dist/esm/cli/lib/api.js:118-121); README privacy notes completed (Convex sees IPs, relay metadata, all match records 24 h, queue); .gitignore ignores .env*; .env.example documents VITE_ICE_SERVERS; Risks corrected: the rate limit does not slow code guessing. Steps 1-4 done; stopping before step 5 (production deploy, high-risk) for sign-off.
