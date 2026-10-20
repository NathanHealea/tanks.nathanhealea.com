---
type: story
epic: pvp-multiplayer    # removed by `wi new` when there is no parent epic
slug: turn-relay
status: staged
branch: story/turn-relay
worktree_path: /Users/nhealea/Personal/Development/tanks.nathanhealea.com/pvp-tanks-worktrees/story-turn-relay
created: 2026-10-18
approved: 2026-10-18
commit_type:         # optional override for the release subject type (default: story=feat, bug=fix, task=chore)
version: 0.11.0
review_approved: 2026-10-19
pr:                  # set by `wi pr`
tag:                 # set by `wi release`; the tag sits on the branch's last commit
---

# TURN relay for restrictive networks

## Summary

Add a TURN relay so players on networks that block direct peer-to-peer traffic can still play, and so quick matches against strangers can hide each player's IP address. A Convex action mints short-lived TURN credentials from Cloudflare for a player who is in a match; the browser adds them to its ICE servers. The secret that mints credentials stays in Convex and never reaches the browser.

## Context

Item 8 connects with STUN only, so pairs behind symmetric NATs or UDP-blocking firewalls fail with `CONNECT_FAILED` or `CONNECT_TIMEOUT`. TURN relays the traffic through a server instead. Cloudflare Realtime TURN serves `turn.cloudflare.com` on 3478/udp, 443/udp and 5349/tcp and charges $0.05 per GB of outbound data when not used with its SFU ([Cloudflare Realtime TURN](https://developers.cloudflare.com/realtime/turn/)). The site is already on Cloudflare. How Cloudflare issues credentials (endpoint, key ID, token, TTL) is not verified yet; step 1 confirms it from Cloudflare's docs before any code. Convex actions may call third-party APIs; mutations may not ([Convex mutations](https://docs.convex.dev/functions/mutation-functions)). Depends on `webrtc-connection`.

### Cloudflare credential API (confirmed 2026-10-19)

From [Generate credentials](https://developers.cloudflare.com/realtime/turn/generate-credentials/):

- `POST https://rtc.live.cloudflare.com/v1/turn/keys/$TURN_KEY_ID/credentials/generate-ice-servers` with `Authorization: Bearer $TURN_KEY_API_TOKEN`, `Content-Type: application/json`, body `{"ttl": <seconds>}`. Only `ttl` is documented; no maximum is stated, and it "should be larger than the time you'd expect the users to use the TURN service".
- Success is `201` with `{"iceServers": [{"urls": ["stun:stun.cloudflare.com:3478"]}, {"urls": ["turn:turn.cloudflare.com:3478?transport=udp", "turn:…:443?transport=udp", "turn:…:3478?transport=tcp", "turn:…:80?transport=tcp", "turns:…:5349?transport=tcp", "turns:…:443?transport=tcp"], "username": "…", "credential": "…"}]}`.
- Port 53 URLs "are known to be blocked by web browsers"; filter any out to avoid a timeout.
- Revocation: `POST …/credentials/$USERNAME/revoke` → `204`.
- Cloudflare's guidance matches this plan: the key and token stay on the server, one short-lived credential per user, and only `iceServers` goes to the browser.

The `ttl` requested is 3600 s (R1). A match lasts minutes; credentials are only needed to establish and keep the relay allocation.

## Scope

**In scope**

- `convex/turn.ts`: `turnCredentials` action that checks match membership through an internal query and calls Cloudflare.
- Convex environment variables for the TURN key ID and API token.
- Client: fetch credentials before connecting and merge them into the ICE server list; fall back to STUN-only if the action fails.
- Relay-only mode (`iceTransportPolicy: 'relay'`) for quick matches, if approved (open question).

**Out of scope**

- Self-hosted TURN (coturn).
- Relay through Convex as a fallback transport (rejected in the epic).

## Requirements

- **R1** — `turnCredentials({ playerId, matchId })` returns ICE server entries with a username and credential valid for no more than 1 hour, only to a player in that match while it is `connecting` or `playing`.
- **R2** — The Cloudflare key ID and token are read from Convex environment variables, never from client code or the repo, and never appear in responses, logs or errors.
- **R3** — Each player can obtain credentials at most twice per match; further calls are rejected.
- **R4** — If the action fails, or gives no TURN login within 10 seconds, the match does not connect: nothing is sent to the opponent and the player is told online matches can't start right now. There is no STUN-only fallback (user decision 2026-10-19: never give information about one player to another).
- **R5** — With TURN available, a pair where one side blocks UDP entirely connects over TURN on 5349/tcp or 443.
- **R6** — Every match, quick and private, sets `iceTransportPolicy: 'relay'`, so no player's IP address reaches another (user decisions 2026-10-18 for quick matches, 2026-10-19 extended to private matches).
- **R7** — At most 20 matches connect per hour across the site (counted when the host marks the match connected; pairing only checks for room, so pairs that never connect cost nothing and a burst can go slightly over), so relay traffic stays inside Cloudflare's free 1,000 GB a month ("The first 1,000 GB each month is free", shared by SFU and TURN; [Realtime pricing](https://developers.cloudflare.com/realtime/pricing/)). Estimate, not measured: ~60 KB/s per player (item 9) × ~6-minute matches ≈ 22 MB per player per match, ≈ 640 GB a month at the cap. When the hour is full, a quick-match player stays queued and sees they are in line, and is paired as soon as a slot opens; joining a private code shows the same and retries every 15 s; a rematch asks to try again in a few minutes. A count cannot bound deliberate bandwidth abuse with a minted credential: set a Cloudflare billing notification as well (user decision 2026-10-19).

## Acceptance criteria

- **AC1** (R1) — Given C is not in the match, when C calls `turnCredentials` for it, then it is rejected and Cloudflare is not called.
- **AC2** (R2) — Given the deployed site, when its JavaScript bundle is searched, then neither TURN secret appears.
- **AC3** (R4) — Given the Cloudflare API is unreachable, when two players match, then neither connects, no signal is sent, and both see that online matches can't start right now.
- **AC4** (R5) — Given one player on a network that blocks UDP, when they match, then they connect and play.
- **AC5** (R6) — Given any match, quick or private, when it connects, then `chrome://webrtc-internals` on each side shows only `relay` candidates for the remote peer.
- **AC6** (R7) — Given 20 matches have started this hour, when two more players search, then both see they are in line, and they are paired when the next hour begins.

## Test plan

| ID | Covers | Test | File | Asserts |
|----|--------|------|------|---------|
| T1 | R1 | `credentials only for match members` | `convex/turn.test.ts` | With `fetch` stubbed: member in `connecting` gets entries; outsider and `finished` match rejected with `fetch` never called |
| T2 | R2 | `secrets never leak` | `convex/turn.test.ts` | With env vars set to sentinel strings, neither appears in the return value or thrown error messages, including when Cloudflare returns an error |
| T3 | R3 | `credentials are capped per player` | `convex/turn.test.ts` | Third call by the same player for the same match is rejected |
| T4 | R4 | `client falls back to stun` | `src/net/iceServers.test.ts`, `src/net/opponent.test.ts` | withTurn: action rejects, is empty or exceeds its wait → no relay; connectToOpponent then fails with RelayUnavailableError before any connection or signal (no STUN-only fallback, per amended R4) |
| T5 | R6 | `every match is relay-only` | `src/net/opponent.test.ts`, `src/net/peer.test.ts` | Every match connects with `iceTransportPolicy 'relay'`; peer passes the policy through |
| T6 | R7 | `match starts are capped per hour` | `convex/relayBudget.test.ts` | 20 pairings in an hour succeed, the 21st leaves both queued as full; a heartbeat in the next hour pairs them; joinPrivate and the creating rematch request refuse with BUSY at the cap and use no slot; old budget rows are swept |
| T7 | R7 | `a full hour keeps the search waiting` | `src/net/quickMatch.test.ts` | join or heartbeat reporting full → state 'full'; later not full → 'searching'; matched from either; cancel from 'full' leaves the queue |

**Not unit testable:** R5 and AC4, AC5 need real networks. Verify by blocking outbound UDP on one machine (macOS `pf` rule or a restrictive network) and checking `chrome://webrtc-internals`. AC2: `grep` the `dist/` bundle for the sentinel values used in the dev deployment.

## Implementation plan

1. [x] Confirm Cloudflare's TURN credential API (endpoint, auth, TTL, response shape) from its docs and record it in this document — touches this document — tests none
2. [x] Add the `turnCredentials` action with membership check, per-player cap and secret handling — touches `convex/turn.ts`, `convex/schema.ts`, `convex/turn.test.ts` — tests T1, T2, T3
3. [x] Fetch credentials before connecting, with the STUN fallback — touches `src/net/iceServers.ts`, `src/net/iceServers.test.ts`, `src/net/peer.ts` — tests T4
4. [x] Add relay-only for quick matches, if approved — touches `src/net/peer.ts`, `src/net/peer.test.ts` — tests T5
5. [x] Cap match starts per hour and show players they are in line — touches `convex/lib/relayBudget.ts`, `convex/matchmaking.ts`, `convex/privateMatch.ts`, `convex/matches.ts`, `convex/sweep.ts`, `src/net/quickMatch.ts`, `src/ui/online/*` — tests T6, T7

**Must not change:** `connectPeer`'s failure codes and behavior when TURN is absent.

**High-risk steps:** Step 2 — handles secrets and creates a paid, billable integration. Requires setting `CLOUDFLARE_TURN_KEY_ID` and `CLOUDFLARE_TURN_KEY_API_TOKEN` in the Convex dashboard (dev and prod) by the account owner; never in `.env` files committed or bundled.

## Risks and open questions

- Never put TURN credentials in `VITE_ICE_SERVERS`: every `VITE_` variable is compiled into the public bundle, so anyone could lift them and use the relay. Keep that variable for STUN only; TURN credentials come from the `turnCredentials` action (raised in the webrtc-connection security review).

- **Decided (2026-10-18): relay-only quick matches are required before public launch** (R6 is no longer conditional), so strangers never see each other's IP addresses. Cost estimate: Hides IP addresses from strangers, but every quick match then pays TURN bandwidth: about 30–60 KB/s per direction, roughly 100–200 MB per match-hour, about $0.01 per match-hour at $0.05/GB (inferred from item 9's snapshot estimate; measure).
- ~~**Decision needed: ship before launch or not.**~~ Decided with R6: required before launch.
- Cost runaway: anyone can create matches and request credentials. The per-match cap (R3) and the membership check bound it, but set a billing alert in Cloudflare.
- ~~Credential minting API details are unverified until step 1.~~ Confirmed; see Context.

## Progress log

- 2026-10-18 — Planned.
- 2026-10-18 — Plan approved.
- 2026-10-19 — Started on branch story/turn-relay from origin/pvp-tank.
- 2026-10-19 — Step 1: Cloudflare credential API confirmed from its docs and recorded in Context (endpoint, bearer auth, ttl body, 201 iceServers shape, port 53 filtering, revoke). Stopping before step 2 (high-risk: secrets, billing) for sign-off and for the account owner to create the TURN key.
- 2026-10-19 — User signed off step 2 (secrets, paid integration) on 2026-10-19. The account owner creates the TURN key and sets the two Convex env vars; tests stub Cloudflare.
- 2026-10-19 — Steps 2-4 built. Deviations: T5's kind→policy test lives in opponent.test.ts (where the match kind is known), with a pass-through test in peer.test.ts; a quick match with no relay fails closed (CONNECT_FAILED, nothing sent) rather than falling back to direct, since R6 forbids showing a stranger's address — R4's STUN fallback applies to private matches only; convex/ declares process.env locally instead of adding @types/node; turnGrants rows are swept with their match; SHARING_NOTICE now uses R11's wording. Until CLOUDFLARE_TURN_KEY_ID and CLOUDFLARE_TURN_KEY_API_TOKEN are set, quick matches cannot connect.
- 2026-10-19 — Review cycle 1 fixes (b4f7c74, 701ac62, aed4647): only Cloudflare STUN/TURN hosts kept; a usable response needs a TURN login; quick matches without a relay fail with their own reason and message (RELAY_UNAVAILABLE, outside PeerErrorCode) and wait up to 10 s for TURN. Open for the user: fail-closed quick matches vs R4's wording; credential farming (unlimited matches → unlimited 1 h TURN logins billed to the account) needs a global/time-window cap — rate limiting was deferred to pvp-deploy-docs.
- 2026-10-19 — Review cycle 2: earlier findings resolved. Noted, not changed (LOW): with a slow Cloudflare the 10 s quick-match TURN wait leaves the slower side as little as ~5 s before the faster side's 15 s connect timeout; relay setup is normally a few seconds.
- 2026-10-19 — Test audit: 17 mutants, 10 survived before; all now killed by new tests (wait times, TURN-login parts, regex anchors, type checks, key id escaping). Gap: the RelayUnavailableError → RELAY_UNAVAILABLE mapping in OnlinePlay has no test (no component tooling). 431 tests pass.
- 2026-10-19 — User decision 2026-10-19: 'never give information about one player to another'. Quick matches fail closed without a relay; R4 amended so the STUN fallback applies to private matches only.
- 2026-10-19 — User decision 2026-10-19: private matches are relay-only too. R4, R6, AC3, AC5 rewritten; no STUN-only fallback anywhere; SHARING_NOTICE is now 'Matches go through a relay, so other players can't see your IP address.' (supersedes pvp-match-screens R11's private-match wording; pvp-deploy-docs README must match). Online play needs the two TURN env vars in every deployment. withTurn keeps its 3 s default (T4) but the app passes 10 s.
- 2026-10-19 — User decision 2026-10-19: cap relay use to stay inside Cloudflare's free tier, and tell waiting players they are in line. Added R7, AC6, T6, T7 and step 5 (20 match starts per hour, enforced where matches are made).
- 2026-10-19 — Step 5 review fixes (f78d2a2, latest): dropped queue entries rejoin; full-hour heartbeats read only the budget row; join retries stop on any non-BUSY answer; BUSY shown as status, not an invalid field; stale comment and T4/T5 rows updated. Open (HIGH, needs user): any client can use up the hour's 20 starts with ~40 calls of throwaway IDs (pairs count when created, connected or not), locking everyone out for the hour. Noted (LOW): 'in line' is not strictly first-come-first-served when a slot opens.
- 2026-10-19 — User decision 2026-10-19 on the HIGH finding: count a start when the match connects (markConnected), check only at pairing. R7 text updated. Blocking the hour now needs 20 real relayed connections; full protection needs player identity (out of scope).
- 2026-10-19 — Manual testing 2026-10-19 on dev with the TURN key set: the user reported one CONNECT_TIMEOUT on a first attempt, then 'the game worked out pretty well'. Diagnosis of the timeout: the action returns STUN plus six TURN URLs with a login and the filter keeps them all; this machine reaches turn.cloudflare.com on TCP 3478/443/5349/80. Cause not found; candidates: a slow first action call (cold start) eating into the faster side's 15 s connect timer (review LOW). AC2 bundle grep, AC4 UDP-blocked, AC5 relay-only candidates and traffic measurement were not reported. The token was typed into the session transcript: use this key for dev only, revoke it after testing, and create a separate key for production.
- 2026-10-19 — Staged: verification passed; version 0.10.0 → 0.11.0; no changelog file.
- 2026-10-19 — Review approved.
