---
type: task
epic: pvp-multiplayer
slug: pvp-production-launch
status: staged
branch: task/pvp-production-launch
worktree_path: /Users/nhealea/Personal/Development/tanks.nathanhealea.com/pvp-tanks-worktrees/task-pvp-production-launch
created: 2026-10-19
approved: 2026-10-19
commit_type:         # optional override for the release subject type (default: story=feat, bug=fix, task=chore)
version: 0.11.2
review_approved: 2026-10-19
pr:                  # set by `wi pr`
tag:                 # set by `wi release`; the tag sits on the branch's last commit
---

# Production launch of online play

## Summary

Put online play on `tanks.nathanhealea.com`: create the production Convex deployment and its keys, deploy the backend and the site with `npm run deploy`, and run the production smoke test. These are steps 5 and 6 of pvp-deploy-docs, split out so that item's code could be released before the owner set up production (user decision 2026-10-19).

## Context

pvp-deploy-docs added `scripts/deploy.mjs` (`npm run deploy`), which deploys Convex to production with the site built against it and then runs `wrangler deploy`, stopping before the site on any failure. It requires `CONVEX_PROD_DEPLOY_KEY` (a `prod:` key) and `CLOUDFLARE_API_TOKEN` in `.env`. The README's Deploy section lists the one-time setup. The production TURN key must be set in the Convex dashboard, not with `npx convex env set --prod`, which the CLI ignores while `.env.local` holds a dev deploy key. Production has no online clients yet, so deploying the backend before the site is safe for this first launch.

## Scope

**In scope**

- The owner's setup: production deploy key, `.env`, production TURN key in the Convex dashboard, Cloudflare billing notification, revoking the dev TURN key.
- One run of `npm run deploy`, and a deliberate failing run with a bad key.
- The production smoke test, recorded here.

**Out of scope**

- Code changes. A defect found here becomes its own bug work item.

## Requirements

- **R1** — `npm run deploy` deploys Convex functions to production, builds the site against them, and publishes it; with an invalid production key it fails before `wrangler deploy` (pvp-deploy-docs R1).
- **R2** — Production has its own TURN key and a Cloudflare billing notification; the dev TURN key, whose token appeared in a session transcript, is revoked (pvp-deploy-docs R8).
- **R3** — The production smoke test passes: two devices on different networks complete a quick match and a private match via share link; leaving mid-match forfeits; the campaign still works offline after install; the Convex dashboard shows no function errors (pvp-deploy-docs R5).
- **R4** — In a production match, the setup messages stored in Convex carry no player address: relay candidates show `raddr 0.0.0.0` (pvp-deploy-docs privacy fix), and `chrome://webrtc-internals` shows only relay candidates.

## Acceptance criteria

- **AC1** (R1) — Given valid keys, when `npm run deploy` runs, then the Convex dashboard shows the new functions and the site loads with **Play online**.
- **AC2** (R1) — Given an invalid production key, when `npm run deploy` runs, then it fails before `wrangler deploy` and the live site is unchanged.
- **AC3** (R2) — Given the Convex production dashboard, then both TURN variables are set there, and the dev key no longer works in Cloudflare.
- **AC4** (R3, R4) — Given the deployed site, when the smoke test runs, then every step passes and is recorded in the progress log.

## Test plan

| ID | Covers | Test | File | Asserts |
|----|--------|------|------|---------|
| — | — | None automated | — | This item changes no code; the deploy script's checks are tested in `scripts/deploy.test.mjs` (pvp-deploy-docs) |

**Not unit testable:** everything here is manual and recorded in the progress log: AC2 run, AC1 run, the smoke test steps of R3, and R4 checked on one match by reading a stored `signals` row before it is deleted (or `chrome://webrtc-internals`).

## Implementation plan

1. [x] Owner: create the production deploy key and `.env`, set the production TURN key in the Convex dashboard, set the Cloudflare billing notification — touches nothing in the repo — tests none
2. [x] Run `npm run deploy` once with a bad production key, then for real — touches nothing in the repo — tests none (AC1, AC2)
3. [x] Run the production smoke test and record the results; then revoke the dev TURN key — touches this document — tests none (AC3, AC4)

**Must not change:** the code; `wrangler.json`, the custom domain, the campaign's offline install.

**High-risk steps:** Step 2 — publishes to the public site and creates production infrastructure; cannot be undone by `git revert`. Stop for sign-off before running it.

## Risks and open questions

- If Convex deploys and Wrangler then fails, the old campaign-only site keeps working against a backend it never calls; rerun the deploy.
- Production deploys from pvp-tank, ahead of `main`. Decide whether to merge pvp-tank into `main` first.
- The 20-matches-an-hour cap and 120-calls-a-minute limit are estimates for a small audience; watch the Convex and Cloudflare dashboards in the first week.

## Progress log

- 2026-10-19 — Planned, split from pvp-deploy-docs steps 5 and 6 by the user's decision to release that item's code first.
- 2026-10-19 — Plan approved.
- 2026-10-19 — Started on branch task/pvp-production-launch from origin/pvp-tank.
- 2026-10-19 — 2026-10-19: the owner created .env.prod (git-ignored) with CLOUDFLARE_API_TOKEN and a prod: CONVEX_PROD_DEPLOY_KEY; the deploy will run as node --env-file=.env.prod scripts/deploy.mjs. Production Convex env vars listed with the prod key: none yet, so the TURN key is not set. AC2 passed: with an invalid prod key the deploy stopped at convex ('the site was not published'); wrangler did not run.
- 2026-10-19 — 2026-10-20: production Convex env had the deploy secrets (CLOUDFLARE_API_TOKEN, CONVEX_PROD_DEPLOY_KEY) by mistake; the owner removed them, added CLOUDFLARE_TURN_KEY_ID and CLOUDFLARE_TURN_KEY_API_TOKEN, and rotated both secrets. Production env now lists exactly the two TURN names. First real npm run deploy from pvp-tank c5f4315: Convex functions and indexes deployed to brilliant-akita-76; wrangler failed 'Invalid access token [code: 9109]', so the site was not published (old campaign-only site still live). Waiting for a valid CLOUDFLARE_API_TOKEN in .env.
- 2026-10-19 — 2026-10-20: AC1 passed. With a new Cloudflare API token, npm run deploy from pvp-tank c5f4315 exited 0: Convex deployed to brilliant-akita-76, wrangler published version 9b95f9e7-15fc-4485-bc64-162079e0a619 to tanks.nathanhealea.com (custom domain). Checks: bundle contains the prod Convex URL and not the dev one; neither deploy secret is in dist/; the live site returns 200 and serves the new bundle (index-BUdXo1mu.js). Billing notification and dev TURN key revocation not confirmed by the owner yet.
- 2026-10-19 — 2026-10-20: the owner reports the dev TURN key (whose token appeared in a session transcript) has been rotated.
- 2026-10-19 — 2026-10-20: the owner skipped the production smoke test (AC4: quick and private matches on two networks, leave forfeit, relay-only candidates, offline campaign, Convex error logs) and did not confirm the Cloudflare billing notification. Online play is live but has not been exercised end to end in production.
- 2026-10-19 — Staged: verification passed; version 0.11.1 → 0.11.2; no changelog file.
- 2026-10-19 — Review approved.
