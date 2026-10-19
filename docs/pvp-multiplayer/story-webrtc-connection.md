---
type: story
epic: pvp-multiplayer    # removed by `wi new` when there is no parent epic
slug: webrtc-connection
status: in-progress
branch: story/webrtc-connection
worktree_path: /Users/nhealea/Personal/Development/tanks.nathanhealea.com/pvp-tanks-worktrees/story-webrtc-connection
created: 2026-10-18
approved: 2026-10-18
commit_type:         # optional override for the release subject type (default: story=feat, bug=fix, task=chore)
version:             # set by `wi stage`
review_approved:     # set by `wi accept`
pr:                  # set by `wi pr`
tag:                 # set by `wi release`; the tag sits on the branch's last commit
---

# Peer-to-peer connection over Convex signaling

## Summary

Connect the two matched browsers directly with a WebRTC peer connection, using Convex to pass the connection setup messages (signaling) between them. Once two data channels are open — one reliable for round control, one unreliable for fast-changing state — the match moves to `playing` and Convex is out of the hot path. This is the riskiest item in the epic: it is where real networks fail.

## Context

WebRTC needs the two peers to exchange an SDP offer and answer (descriptions of each side's media and data setup) and ICE candidates (possible network addresses) before they can talk. That exchange needs a server both can reach; here it is Convex: each side writes messages into the `signals` table addressed to the other role, and reads its own inbox through a reactive query. STUN (a public server that tells a browser its public address) is needed to cross home routers; the proposed default is Cloudflare's `stun:stun.cloudflare.com:3478` (inferred from Cloudflare's Realtime docs; verify it resolves before building). Pairs that need a TURN relay will fail until item 12. The host (from item 6 or 7) creates the offer. Depends on `random-matchmaking` (and uses `private-match-codes` the same way).

## Scope

**In scope**

- `convex/signaling.ts`: `sendSignal` mutation, `inbox` query, and `markConnected` mutation.
- `src/net/peer.ts`: `connectPeer({ matchId, role, convex })` returning a `Link` once both channels are open.
- `src/net/link.ts`: the `Link` interface (`send`, `onMessage`, `onClose`, `close`) and `createLinkPair()` in-memory implementation for tests, with optional latency and loss.
- `src/net/iceServers.ts`: ICE server list from `VITE_ICE_SERVERS` (JSON) or the STUN default.
- A `hello` exchange on the reliable channel carrying `PROTOCOL_VERSION`.

**Out of scope**

- TURN (item 12). Game messages (item 9). Reconnecting a dropped link (item 11 treats a drop as a disconnect).

## Requirements

- **R1** — `sendSignal({ playerId, matchId, kind, payload })` stores a message addressed to the caller's opponent role; it rejects outsiders, matches not in `connecting`, payloads over 16 KB, and unknown kinds.
- **R2** — `inbox({ playerId, matchId })` returns only messages addressed to the caller's role, oldest first.
- **R3** — The host creates the peer connection, a reliable ordered channel `ctrl` and an unordered no-retransmit channel `state`, sends an offer, and applies the guest's answer; the guest applies the offer and sends an answer. Both trickle ICE candidates through Convex as they are found.
- **R4** — `connectPeer` resolves with a `Link` only when both channels are open and the `hello` exchange shows the same `PROTOCOL_VERSION` on both sides.
- **R5** — A version mismatch fails with `VERSION_MISMATCH`; no open channels within 15 seconds fails with `CONNECT_TIMEOUT`; ICE state `failed` fails with `CONNECT_FAILED`. Every failure closes the peer connection.
- **R6** — When the host's link opens, `markConnected` moves the match to `playing` and deletes that match's signals; only the host may call it.
- **R7** — Signal messages never contain player GUIDs.
- **R8** — The in-memory `Link` pair delivers messages between two endpoints with configurable delay and drop rate on the `state` channel, and never drops `ctrl` messages.

## Acceptance criteria

- **AC1** (R3, R4, R6) — Given A and B are matched on different home networks with ordinary routers, when both clients start connecting, then within 5 seconds both have an open `Link` and the match is `playing`.
- **AC2** (R5) — Given B's build has a different `PROTOCOL_VERSION`, when they connect, then both see `VERSION_MISMATCH`.
- **AC3** (R5) — Given B's network blocks UDP entirely and no TURN is configured, when they connect, then both fail with `CONNECT_FAILED` or `CONNECT_TIMEOUT` within 15 seconds.
- **AC4** (R1) — Given C is not in the match, when C calls `sendSignal` for it, then it throws and no signal is stored.

## Test plan

| ID | Covers | Test | File | Asserts |
|----|--------|------|------|---------|
| T1 | R1, R7 | `sendSignal addresses the opponent` | `convex/signaling.test.ts` | Host's signal has `to: 'guest'`; stored row has no GUID fields |
| T2 | R1 | `sendSignal rejects bad calls` | `convex/signaling.test.ts` | Outsider, wrong status, 16 KB + 1 payload and unknown kind each throw; nothing stored |
| T3 | R2 | `inbox returns only my messages in order` | `convex/signaling.test.ts` | Mixed messages → host sees guest-sent only, sorted by `createdAt` |
| T4 | R6 | `markConnected starts the match and clears signals` | `convex/signaling.test.ts` | Status `playing`, signals for the match gone; guest call throws |
| T5 | R3, R4 | `host and guest negotiate` | `src/net/peer.test.ts` | With a fake `RTCPeerConnection` pair and an in-memory signal bus, both sides resolve and the host made both channels with the right options |
| T6 | R5 | `version mismatch fails both sides` | `src/net/peer.test.ts` | Mismatched `hello` → both reject with `VERSION_MISMATCH`, `close()` called |
| T7 | R5 | `connect times out` | `src/net/peer.test.ts` | Fake timers, channels never open → `CONNECT_TIMEOUT` at 15 s, connection closed |
| T8 | R5 | `ice failure fails fast` | `src/net/peer.test.ts` | `iceconnectionstatechange` to `failed` → `CONNECT_FAILED` |
| T9 | R8 | `link pair delays and drops state only` | `src/net/link.test.ts` | 50% drop on `state` loses some; `ctrl` delivers all, in order, after the delay |
| T10 | — | `ice servers come from env or default` | `src/net/iceServers.test.ts` | Valid JSON env → parsed list; missing or invalid → STUN default |

**Not unit testable:** AC1 and AC3 depend on real networks. Verify manually: two browsers on one machine; laptop on home Wi-Fi vs phone on cellular; one side behind a VPN or campus network. Record the results (connected or not, time to connect) in the progress log, because they decide whether item 12 is required for launch.

## Implementation plan

1. [x] Add `sendSignal`, `inbox` and `markConnected` with their rules — touches `convex/signaling.ts`, `convex/signaling.test.ts` — tests T1, T2, T3, T4
2. [x] Add the `Link` interface and in-memory pair — touches `src/net/link.ts`, `src/net/link.test.ts` — tests T9
3. [x] Add `connectPeer` with negotiation, the `hello` check and the three failure modes, plus the ICE server config — touches `src/net/peer.ts`, `src/net/peer.test.ts`, `src/net/iceServers.ts`, `src/net/iceServers.test.ts` — tests T5, T6, T7, T8, T10
4. [x] Manual connectivity matrix — deferred to `pvp-match-screens` by the user (2026-10-18): nothing can start a real connection until those screens exist — touches nothing — tests none (manual)

**Must not change:** The `matches` access rules from `player-identity`.

**High-risk steps:** Step 3 — first code that sends the player's network addresses to another person's browser (see privacy risk). Review before testing with anyone outside the developer's own devices.

## Risks and open questions

- **Connectivity failures.** Without TURN some pairs never connect. Step 4's results decide whether item 12 ships before launch.
- **IP exposure.** ICE candidates carry each player's public IP address to the opponent through Convex and the peer connection. Item 12 can offer relay-only mode to hide it. No FERPA data is involved, but a student playing a random stranger reveals their IP; the epic asks for a decision.
- **Third-party service.** STUN requests go to Cloudflare. Named in the epic; confirm acceptable.
- Signals are written per ICE candidate (often 5–15 per side), so a connection costs roughly 20–40 Convex function calls plus query re-runs. Fine for the budget; batching candidates is a later optimization.
- Safari handles unordered unreliable data channels, but test it specifically; older iOS versions had data-channel bugs (unverified — confirm on a current iPhone during step 4).

## Progress log

- 2026-10-18 — Planned.
- 2026-10-18 — Plan approved.
- 2026-10-18 — Started on branch story/webrtc-connection from origin/pvp-tank.
- 2026-10-18 — Step 3 built test-first and committed; stopped for user review before any real-network use (high-risk). Mutation checks: all 10 meaningful breaks killed after adding early-ICE and late-open tests.
- 2026-10-18 — Step 4 deferred to pvp-match-screens by the user; recorded there as a required pre-staging check.
