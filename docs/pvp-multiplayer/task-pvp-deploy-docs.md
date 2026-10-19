---
type: task
epic: pvp-multiplayer    # removed by `wi new` when there is no parent epic
slug: pvp-deploy-docs
status: planned      # planned | in-progress | changes-requested | staged | released
branch: task/pvp-deploy-docs
worktree_path:       # set by `wi start`
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
- **R4** — The README states plainly what online play shares: a random per-visit ID and scores stored in Convex for up to 24 hours, and each player's IP address shared with their opponent (unless relay-only applies) and with Cloudflare's STUN/TURN servers.
- **R5** — The production smoke test passes: two devices on different networks complete a quick match and a private match via share link, and the campaign still works offline after install.
- **R6** — Before the public deploy, the public matchmaking functions (`joinQueue`, `createPrivate`, `joinPrivate`) are rate limited, so one client minting player ids in a loop cannot grow the `queue` and `matches` tables or exhaust the Convex function-call budget. Deferred here from the random-matchmaking security review (2026-10-18).

## Acceptance criteria

- **AC1** (R1) — Given valid keys, when `npm run deploy` runs, then the Convex dashboard shows the new functions and `tanks.nathanhealea.com` loads with **Play online**.
- **AC2** (R1) — Given an invalid `CONVEX_DEPLOY_KEY`, when `npm run deploy` runs, then it fails before `wrangler deploy`.
- **AC3** (R2) — Given the repo, when `git ls-files` is checked, then no `.env*` other than `.env.example` is tracked.
- **AC4** (R5) — Given the deployed site, when the smoke test runs, then every step passes and is recorded in the progress log.
- **AC5** (R6) — Given a client calling `joinQueue` with a new player id in a tight loop, when it exceeds the limit, then further calls are rejected with a clear error and no rows are created for them.

## Test plan

| ID | Covers | Test | File | Asserts |
|----|--------|------|------|---------|
| T1 | R2 | `no env files are tracked` | `src/repo.test.ts` | `git ls-files` output contains no `.env` paths except `.env.example` |
| T2 | R6 | `matchmaking calls are rate limited` | `convex/rateLimit.test.ts` | Past the limit within one window, `joinQueue` throws and inserts nothing; the next window accepts calls again |

**Not unit testable:** R1 — run `npm run deploy` once with a bad deploy key (AC2) and once for real (AC1). R3, R4 — read-through by someone who has not seen the code: can they run it locally from the README alone? R5 — manual smoke test on production: (1) quick match laptop vs phone on cellular; (2) private match via share link; (3) leave mid-match and see the forfeit; (4) install the PWA, go offline, play a campaign level; (5) check the Convex dashboard for errors.

## Implementation plan

1. [ ] Confirm `convex deploy --cmd` sets `VITE_CONVEX_URL` for Vite, then update the `deploy` script and `.env.example` — touches `package.json`, `.env.example` — tests T1
2. [ ] Create the production Convex deployment, set its environment variables, and deploy — touches nothing in the repo — tests none (manual AC1, AC2)
3. [ ] Update the README — touches `README.md` — tests none (read-through)
4. [ ] Run the production smoke test and record the results — touches this document — tests none (manual R5)

**Must not change:** The Cloudflare Worker config in `wrangler.json`, the custom domain, and the campaign's offline install.

**High-risk steps:** Step 2 — creates production infrastructure and publishes to the public site; cannot be undone by `git revert`. Stop for sign-off before running it.

## Risks and open questions

- If Convex deploys and Wrangler then fails, the old site talks to the new backend. Keep backend changes backward compatible within a release, or accept a short window; `PROTOCOL_VERSION` covers client-to-client mismatches but not client-to-Convex.
- The README's privacy wording depends on the item 12 decision (relay-only or not). Write it after that decision.
- **Open: how to rate limit (R6).** Either `@convex-dev/rate-limiter` (Convex's official component; a new dependency, needs approval) or a hand-built counter table with a global per-minute cap (no dependency, more code to own). Decide when this item is planned in detail. Adding R6 means a new implementation step before the production deploy step.

## Progress log

- 2026-10-18 — Planned.
- 2026-10-18 — Plan approved.
- 2026-10-18 — Added R6/AC5/T2: rate-limit the public matchmaking functions before the public deploy, deferred here from the random-matchmaking security review at the user's direction. Mechanism is an open decision.
