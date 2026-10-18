---
type: epic
slug: pvp-multiplayer
status: planned      # planned | in-progress | released
created: 2026-10-18
approved:
---

# PvP online multiplayer

## Summary

Add a two-player online mode where two people fight each other, tank against tank, on a randomly generated arena. Players never sign in: each page load mints a random GUID that identifies the player for that visit. A player either joins a random-matchmaking queue and is paired with the next waiting stranger, or creates a private match and shares a short code (or link) with a specific person. Convex runs the server-side logic — identity validation, matchmaking, share codes, match seeds, scores, cleanup — and brokers a WebRTC peer-to-peer connection that carries the live game. The single-player campaign stays exactly as it is.

## Context

The game today is a single-player campaign of 50 seeded levels (`src/game/levels.ts`) against AI tanks. The simulation was built for networking: `step(state, inputs)` in `src/game/sim.ts` is the only thing that advances the world, `GameState` is plain JSON, randomness lives in the state, inputs are a small `PlayerInput` keyed by player ID, and every level already has a player-2 spawn. `LocalSession` (`src/game/session.ts`) wraps `step()` in a fixed 60 Hz clock and the README names the plan: swap it for a networked session where one host runs `step()` and clients send only input.

The site is a static-assets Cloudflare Worker with no server code (`wrangler.json`). Convex becomes the first backend.

**Why WebRTC carries the game, not Convex (decided 2026-10-18).** Convex's free plan includes 1,000,000 function calls a month ([Convex limits](https://docs.convex.dev/production/state/limits)). Relaying inputs and state through Convex at 20 Hz is roughly 40 calls a second per match, about 144,000 an hour, so the free tier would last about seven hours of total play, and every message adds a server round trip. Convex instead handles everything that is low-frequency and must be trusted or shared (pairing, codes, seeds, scores, signaling, cleanup), and a WebRTC data channel carries the 20–60 Hz traffic directly between the two browsers. Alternatives considered: relay everything through Convex (one vendor, no NAT problems, but laggy and paid at any real traffic) and WebRTC with a Convex fallback (most robust, about double the netcode work). The fallback can be added later without changing the matchmaking layer.

**Why host-authoritative, not lockstep (inferred).** Lockstep requires bit-identical simulation on both machines. `sim.ts`, `grid.ts` and `ai.ts` use `Math.sin`, `Math.cos`, `Math.atan2` and `Math.hypot`, which ECMAScript leaves implementation-approximated, so Chrome and Safari can disagree by an ulp and desync. With one host running `step()` and streaming snapshots, the other client never needs to agree bit-for-bit. For the same reason the host generates each round's map and sends the layout, rather than both peers regenerating it from the seed.

## Scope

**In scope**

- Anonymous per-load player identity (GUID), never persisted, never tied to a person.
- Convex backend: schema, matchmaking queue, private matches with share codes and share links, WebRTC signaling, match records, scheduled cleanup.
- Random PvP arena generator: seeded, symmetric, fair, a new map every round.
- PvP rules in the simulation: two players on opposing teams, no AI, round won by the last tank standing, draws, first to 3 round wins takes the match.
- Peer-to-peer game transport over WebRTC data channels, host-authoritative, with interpolation on the guest.
- Online menus, waiting and connecting screens, PvP HUD, round and match results, rematch, leaving.
- Disconnect detection, forfeit, and expiry of stale queue entries, codes and matches.
- Optional TURN relay for players whose networks block peer-to-peer.
- Deploy pipeline for Convex alongside Cloudflare, and README updates.
- A test harness (Vitest, convex-test), because the repo has none and netcode without tests is a gamble.

**Out of scope**

- Accounts, sign-in, display names, friends lists, chat.
- Persistent stats, leaderboards, ELO or skill-based matchmaking.
- More than two players, spectators, co-op campaign online.
- Client-side prediction and rollback for the guest's own tank (open question below; first release ships interpolation only).
- Reconnecting to a match after a reload (a reload mints a new GUID by design, so it ends the match).
- Anti-cheat beyond server-side validation of who may act on a match.

## Requirements

- **R1** — Each page load generates a new random GUID that identifies the player to Convex for that load only. It is not stored in cookies, `localStorage` or anywhere else, and no personal data is collected.
- **R2** — A player can enter random matchmaking and is paired with another waiting player; two players are never paired with each other twice at once, and nobody is paired with themselves.
- **R3** — A player can create a private match and receive a short share code and share link; another player who enters that code or opens that link joins that match and nobody else can.
- **R4** — Once paired, the two browsers connect peer-to-peer and play a live match where both see the same battle with no more than about 150 ms of added delay on a typical home connection.
- **R5** — Every round is played on a freshly generated random arena that is symmetric, has both spawns reachable from each other, and gives neither spawn line of sight to the other at the start.
- **R6** — A match is first to 3 round wins; a round ends when one tank is left (that player scores) or both pop on the same tick (draw, nobody scores).
- **R7** — If a player leaves or disconnects, the other is told within 15 seconds and wins by forfeit.
- **R8** — Stale queue entries, unused codes, abandoned matches and signaling messages are removed by Convex without manual cleanup.
- **R9** — The single-player campaign plays identically to today, including when Convex is unreachable or not configured, and the app still installs and plays the campaign offline.
- **R10** — All new screens and controls meet WCAG 2.1 AA: keyboard operable, labeled, visible focus, status changes announced, sufficient contrast, and usable on touch in landscape.
- **R11** — A client can only act on a match it belongs to, and no client is ever sent the opponent's GUID.

## Acceptance criteria

- **AC1** (R1) — Given the game is loaded twice in the same browser, when each load contacts Convex, then each uses a different GUID and browser storage holds no GUID.
- **AC2** (R2) — Given two players press **Quick match** within a few seconds of each other, when the second presses it, then both move to the connecting screen in the same match.
- **AC3** (R3) — Given player A creates a private match, when player B enters A's code, then B joins A's match; when a third player enters the same code, then they see "That match is already full."
- **AC4** (R3) — Given A shares the link `https://tanks.nathanhealea.com/?join=<CODE>`, when B opens it, then B joins without typing the code.
- **AC5** (R4) — Given two players on different home networks are paired, when the match starts, then both see each other's tank move and fire, and shots that hit on the host's screen pop the tank on both screens.
- **AC6** (R5) — Given 1,000 random seeds, when an arena is generated for each, then every one is point-symmetric, connected between spawns, and has no spawn-to-spawn line of sight.
- **AC7** (R6) — Given the score is 2–2, when one player pops the other, then the match ends and both see who won 3–2.
- **AC8** (R7) — Given a match in progress, when one player closes the tab, then within 15 seconds the other sees "Opponent left. You win."
- **AC9** (R8) — Given a private code nobody uses, when 10 minutes pass, then the code no longer joins anything and its record is gone within the next sweep.
- **AC10** (R9) — Given `VITE_CONVEX_URL` is unset or the device is offline, when the game loads, then the campaign starts and plays as before and the online option explains why it is unavailable.
- **AC11** (R10) — Given a keyboard-only user, when they create a code, copy it, cancel, join by code and leave a match, then every step is reachable by Tab and Enter and every status change is announced by a screen reader.
- **AC12** (R11) — Given a client calls a match mutation with a GUID that is not in that match, then the call is rejected and the match is unchanged.

## Child work items

Each child gets its own planning pass when it is picked up. `wi` updates the
Status column by matching the Slug column, so keep slugs exact.

| # | Type | Slug | Title | Covers | Depends on | Status |
|---|------|------|-------|--------|-----------|--------|
| 1 | task | pvp-test-harness | Add Vitest and convex-test harness | — | — | released |
| 2 | task | convex-backend-setup | Add Convex backend and client wiring | R9 | 1 | planned |
| 3 | story | player-identity | Anonymous per-load player identity | R1, R11 | 2 | planned |
| 4 | story | pvp-sim-rules | Two-player PvP rules in the simulation | R6, R9 | 1 | planned |
| 5 | story | pvp-map-generator | Random symmetric PvP arena generator | R5, R9 | 1, 4 | planned |
| 6 | story | random-matchmaking | Random matchmaking queue | R2, R11 | 2, 3 | planned |
| 7 | story | private-match-codes | Private matches with share codes and links | R3, R11 | 2, 3 | planned |
| 8 | story | webrtc-connection | Peer-to-peer connection over Convex signaling | R4, R11 | 6 | planned |
| 9 | story | host-authoritative-netcode | Host-authoritative networked game session | R4, R6 | 4, 5, 8 | planned |
| 10 | story | pvp-match-screens | Online menus, PvP HUD and match flow | R2, R3, R6, R9, R10 | 6, 7, 9 | planned |
| 11 | story | disconnect-and-cleanup | Disconnects, forfeits and stale-data cleanup | R7, R8 | 9, 10 | planned |
| 12 | story | turn-relay | TURN relay for restrictive networks | R4 | 8 | planned |
| 13 | task | pvp-deploy-docs | Deploy Convex with the site and document PvP | R9 | 10, 11 | planned |

**Independently shippable:** 1, 4 and 5 ship alone with no visible change; the campaign keeps working. 2, 3, 6, 7 and 8 can merge to `main` behind the existing build because the online entry point does not exist until 10, and 10 only shows it when `VITE_CONVEX_URL` is set. 9 cannot be played without 10. 11 must ship with or before the first public deploy of 10, or abandoned data piles up. 12 is optional and can ship any time after 8. 13 is the public launch.

**Dependency order:** 1 → (2, 4) → (3, 5) → (6, 7) → 8 → 9 → 10 → 11 → 13, with 12 anywhere after 8.

## Effort

Estimates assume one developer who knows this codebase, Convex's free plan, and no surprises in WebRTC connectivity. They are ranges, not commitments.

| # | Slug | Range |
|---|------|-------|
| 1 | pvp-test-harness | 0.5–1 day |
| 2 | convex-backend-setup | 0.5–1 day |
| 3 | player-identity | 0.5 day |
| 4 | pvp-sim-rules | 1–1.5 days |
| 5 | pvp-map-generator | 1–2 days |
| 6 | random-matchmaking | 1–1.5 days |
| 7 | private-match-codes | 1–1.5 days |
| 8 | webrtc-connection | 2–4 days |
| 9 | host-authoritative-netcode | 3–5 days |
| 10 | pvp-match-screens | 2–3 days |
| 11 | disconnect-and-cleanup | 1.5–2.5 days |
| 12 | turn-relay | 1–2 days |
| 13 | pvp-deploy-docs | 0.5–1 day |
| | **Total** | **15.5–26.5 days** |

The widest ranges are 8 and 9: WebRTC failures are network-specific and hard to reproduce, and feel tuning for the guest takes playtesting.

## Risks and open questions

- **Open: peers that cannot connect.** Without a TURN relay, some pairs (symmetric NATs, strict campus or corporate firewalls) will fail to connect. Industry figures commonly put this at roughly 10–20% of pairs (unverified estimate). Item 12 adds Cloudflare TURN at $0.05 per GB after any included usage ([Cloudflare Realtime TURN](https://developers.cloudflare.com/realtime/turn/)). Decision needed before public launch: ship 12, or accept the failure rate and show a clear error.
- **Privacy: peer-to-peer reveals IP addresses.** WebRTC ICE candidates include each player's public IP address, so a random stranger learns your IP. No FERPA data is involved (no student records, no identity), but this is a real exposure for a public game that students may play. Mitigation in 12: relay-only mode for quick matches hides IPs at the cost of TURN bandwidth. Decision needed.
- **Third-party services.** STUN (needed for peer-to-peer) uses a public server; the default proposed is Cloudflare's (`stun:stun.cloudflare.com:3478`, inferred from Cloudflare's Realtime docs, verify in 8). TURN in 12 is also Cloudflare. Both send connection metadata (IP addresses) to Cloudflare, which already hosts the site.
- **Host advantage.** The host sees its own inputs with zero delay; the guest sees theirs after a round trip plus interpolation delay. Host role is assigned by Convex (first in queue, or code creator). Open: add client-side prediction for the guest's own tank in a follow-up if playtests show it feels bad.
- **Background tabs stop the host.** Browsers throttle `requestAnimationFrame` in hidden tabs, so a host who switches tabs freezes the match. Proposed (item 11): a hidden host's game is treated as a pause for up to 15 seconds, then forfeits.
- **No authentication means spoofable requests.** Anyone can mint GUIDs and spam queue entries or codes. Mitigations in 3, 6, 7: one open queue entry or private match per GUID, short expiries, and never revealing the opponent's GUID. Open: add a rate limiter (for example `@convex-dev/rate-limiter`, a new dependency) if abuse appears.
- **The host reports scores.** A modified host client could lie about round results. Accepted for a no-account casual game; stated so nobody assumes the scores are trusted.
- **Convex free-plan budget.** Heartbeats (every 10 seconds while waiting, every 5 seconds in a match, written to a separate presence table so they do not re-run match subscriptions) plus signaling cost roughly 1,500–2,500 function calls per match-hour (inferred from the design; measured in 11). The free plan's 1M calls a month supports about 400–650 match-hours a month.
- **New dependencies.** `convex` (runtime), `vitest`, `convex-test` and `@edge-runtime/vm` (dev). Approving this epic approves adding these; anything else needs a separate ask.
- **Timing and accessibility.** Share codes expire after 10 minutes. WCAG 2.1 SC 2.2.1 (Timing Adjustable) requires the user to be able to extend; item 10 adds "Make a new code" and announces expiry. Gameplay itself is real-time and exempt.
- **Reload ends the match.** Because the GUID is not persisted (by requirement), a reload or a crashed tab forfeits. Stated so it is not filed as a bug.

## Progress log

- 2026-10-18 — Planned.
- 2026-10-18 — Transport decided: Convex for matchmaking and signaling, WebRTC data channels for gameplay.
