---
type: story
epic: pvp-multiplayer    # removed by `wi new` when there is no parent epic
slug: turn-relay
status: in-progress
branch: story/turn-relay
worktree_path: /Users/nhealea/Personal/Development/tanks.nathanhealea.com/pvp-tanks-worktrees/story-turn-relay
created: 2026-10-18
approved: 2026-10-18
commit_type:         # optional override for the release subject type (default: story=feat, bug=fix, task=chore)
version:             # set by `wi stage`
review_approved:     # set by `wi accept`
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
- **R4** — If the action fails or times out after 3 seconds, the client connects with STUN only and the connection proceeds as in item 8.
- **R5** — With TURN available, a pair where one side blocks UDP entirely connects over TURN on 5349/tcp or 443.
- **R6** — Quick matches set `iceTransportPolicy: 'relay'` so neither player's IP address reaches the other; private matches use all candidates. Required before public launch (user decision, 2026-10-18).

## Acceptance criteria

- **AC1** (R1) — Given C is not in the match, when C calls `turnCredentials` for it, then it is rejected and Cloudflare is not called.
- **AC2** (R2) — Given the deployed site, when its JavaScript bundle is searched, then neither TURN secret appears.
- **AC3** (R4) — Given the Cloudflare API is unreachable, when two players connect, then they connect with STUN as before.
- **AC4** (R5) — Given one player on a network that blocks UDP, when they match, then they connect and play.
- **AC5** (R6) — Given relay-only quick matches, when a match connects, then `chrome://webrtc-internals` on each side shows only `relay` candidates for the remote peer.

## Test plan

| ID | Covers | Test | File | Asserts |
|----|--------|------|------|---------|
| T1 | R1 | `credentials only for match members` | `convex/turn.test.ts` | With `fetch` stubbed: member in `connecting` gets entries; outsider and `finished` match rejected with `fetch` never called |
| T2 | R2 | `secrets never leak` | `convex/turn.test.ts` | With env vars set to sentinel strings, neither appears in the return value or thrown error messages, including when Cloudflare returns an error |
| T3 | R3 | `credentials are capped per player` | `convex/turn.test.ts` | Third call by the same player for the same match is rejected |
| T4 | R4 | `client falls back to stun` | `src/net/iceServers.test.ts` | Action rejects or exceeds 3 s → returned list is the STUN default |
| T5 | R6 | `relay policy follows match kind` | `src/net/peer.test.ts` | Quick match → `iceTransportPolicy 'relay'`; private → `'all'` |

**Not unit testable:** R5 and AC4, AC5 need real networks. Verify by blocking outbound UDP on one machine (macOS `pf` rule or a restrictive network) and checking `chrome://webrtc-internals`. AC2: `grep` the `dist/` bundle for the sentinel values used in the dev deployment.

## Implementation plan

1. [x] Confirm Cloudflare's TURN credential API (endpoint, auth, TTL, response shape) from its docs and record it in this document — touches this document — tests none
2. [x] Add the `turnCredentials` action with membership check, per-player cap and secret handling — touches `convex/turn.ts`, `convex/schema.ts`, `convex/turn.test.ts` — tests T1, T2, T3
3. [x] Fetch credentials before connecting, with the STUN fallback — touches `src/net/iceServers.ts`, `src/net/iceServers.test.ts`, `src/net/peer.ts` — tests T4
4. [x] Add relay-only for quick matches, if approved — touches `src/net/peer.ts`, `src/net/peer.test.ts` — tests T5

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
