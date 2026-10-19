---
type: story
epic: pvp-multiplayer    # removed by `wi new` when there is no parent epic
slug: disconnect-and-cleanup
status: planned      # planned | in-progress | changes-requested | staged | released
branch: story/disconnect-and-cleanup
worktree_path:       # set by `wi start`
created: 2026-10-18
approved: 2026-10-18
commit_type:         # optional override for the release subject type (default: story=feat, bug=fix, task=chore)
version:             # set by `wi stage`
review_approved:     # set by `wi accept`
pr:                  # set by `wi pr`
tag:                 # set by `wi release`; the tag sits on the branch's last commit
---

# Disconnects, forfeits and stale-data cleanup

## Summary

Make matches end cleanly when someone leaves, loses connection or hides the tab, and make Convex clean up after itself. A player who leaves forfeits immediately; a player whose connection drops is detected within 15 seconds; and a scheduled sweep removes stale queue entries, expired codes, dead matches and old records so nothing about a match outlives a day.

## Context

Matches have `status` and `endReason` (item 2), and Convex learns of round results from `reportRound` (item 9). Item 8's `Link` reports `onClose` when the data channel closes, but a silent network loss can leave a channel "open" with nothing arriving. Browsers throttle timers and stop `requestAnimationFrame` in hidden tabs, so a hidden host stops simulating. Writing heartbeats to the `matches` row would re-run both players' `myMatch` subscriptions on every beat, so presence goes in its own table. convex-test does not run cron jobs; tests call the sweep function directly ([convex-test docs](https://docs.convex.dev/testing/convex-test)). Depends on `host-authoritative-netcode` and `pvp-match-screens`.

## Scope

**In scope**

- `presence` table (`matchId`, `role`, `lastSeen`; index `by_match`), `matches.heartbeat`, `matches.leave`, `matches.reportLost`.
- `endReason` values `left`, `timeout`, `connection` added to the schema.
- Ping on the `ctrl` channel and silence detection in both sessions; a `bye` message on leave and on `pagehide`.
- Hidden-tab rule.
- `convex/crons.ts` running an internal `sweep` every minute.
- Flow states and copy for opponent-left, connection-lost and you-left outcomes (rendered by item 10's screens).

**Out of scope**

- Reconnecting into a running match.

## Requirements

- **R1** — During `connecting` and `playing`, each client calls `matches.heartbeat` every 5 seconds, which updates only its `presence` row.
- **R2** — **Leave** (item 10), closing the tab, or navigating away sends `bye` on the link when possible and calls `matches.leave` (best effort on `pagehide`); Convex sets the match `finished`, the other role as `winner`, `endReason: 'left'`. The remaining player sees "Opponent left. You win." within 2 seconds when the `bye` arrives, or within 15 seconds otherwise.
- **R3** — Each side sends a ping on `ctrl` every second. After 5 seconds with no message from the peer, the screen shows "Connection lost. Waiting for your opponent…" with the seconds remaining; any message clears it. After 15 seconds the client calls `matches.reportLost`.
- **R4** — `reportLost` decides by presence: if the opponent's `lastSeen` is more than 15 seconds old, the reporter wins (`endReason: 'timeout'`); if both are fresh, the link failed between two live players and the match ends `abandoned` with `endReason: 'connection'` and no winner ("Connection lost. No result."). It is idempotent: a second report, from either side, returns the existing result.
- **R5** — When a player's tab is hidden for 15 seconds during a match, their own client calls `matches.leave`; the hidden host shows nothing to the guest except R3's countdown.
- **R6** — Every minute, `sweep` removes queue rows with no heartbeat for 60 seconds; marks `waiting` private matches past `expiresAt` as `abandoned`; marks `connecting` matches older than 60 seconds as `abandoned` (`endReason: 'connection'`); marks `playing` matches whose presence rows are all older than 60 seconds as `abandoned` (`endReason: 'timeout'`); deletes signals of matches not in `connecting`; and deletes `finished` and `abandoned` matches older than 24 hours with their presence rows.
- **R7** — `sweep` handles at most 500 rows per table per run and finishes well within Convex's 1-second mutation limit ([Convex limits](https://docs.convex.dev/production/state/limits)); leftovers are handled next run.
- **R8** — `leave`, `heartbeat` and `reportLost` reject outsiders and malformed GUIDs.
- **R9** — While a private match is `waiting`, the host's client heartbeats every 10 seconds, so a host who closed the tab is detected before the 10-minute code expiry (moved here from private-match-codes R8).

## Acceptance criteria

- **AC1** (R2) — Given a match in progress, when the guest closes the tab, then the host sees "Opponent left. You win." within 15 seconds and the match is `finished` with the host as winner.
- **AC2** (R3, R4) — Given the host's Wi-Fi is turned off mid-round, when 15 seconds pass, then the guest sees "Opponent left. You win." (host's presence is stale).
- **AC3** (R4) — Given both players are online but the data channel dies, when 15 seconds pass, then both see "Connection lost. No result." and the match is `abandoned`.
- **AC4** (R5) — Given the host switches tabs for 20 seconds, then the guest wins by `left`.
- **AC5** (R6) — Given a finished match from 25 hours ago, when `sweep` runs, then the match and its presence rows are gone.

## Test plan

| ID | Covers | Test | File | Asserts |
|----|--------|------|------|---------|
| T1 | R1, R8 | `heartbeat writes presence only` | `convex/matches.test.ts` | Presence `lastSeen` updated; `matches` row unchanged; outsider rejected |
| T2 | R2 | `leave forfeits to the other role` | `convex/matches.test.ts` | Guest leaves → `finished`, `winner 'host'`, `endReason 'left'`; leaving a finished match is a no-op |
| T3 | R4 | `reportLost with stale opponent wins` | `convex/matches.test.ts` | Fake timers, opponent presence 20 s old → reporter wins `timeout` |
| T4 | R4 | `reportLost with both fresh abandons` | `convex/matches.test.ts` | Both fresh → `abandoned`, `connection`, no winner; second report returns the same |
| T5 | R6 | `sweep clears each kind of stale data` | `convex/sweep.test.ts` | Seeds one row for each rule plus a fresh control row; after `sweep`, each stale row is handled per R6 and controls are untouched |
| T6 | R7 | `sweep caps work per run` | `convex/sweep.test.ts` | 600 stale queue rows → 500 removed in one run, 100 in the next |
| T7 | R3 | `silence timer shows countdown then reports` | `src/net/silence.test.ts` | Fake timers: 5 s silence → `lost` state with 10 s left; message resets; 15 s → `reportLost` called once |
| T8 | R2 | `bye ends the match immediately` | `src/net/session.integration.test.ts` | Guest sends `bye` → host flow state `opponentLeft` on next tick |
| T9 | R5 | `hidden tab leaves after 15 s` | `src/net/visibility.test.ts` | Simulated `visibilitychange` hidden for 15 s → `leave` called; visible again at 14 s → not called |

**Not unit testable:** AC1–AC4 on real devices: close tab, toggle Wi-Fi, kill the browser process, background the app on iOS. Record each outcome in the progress log. Also measure Convex function calls for a 10-minute match in the Convex dashboard and record it against the epic's budget estimate.

## Implementation plan

1. [ ] Add the `presence` table, `endReason` values, and `heartbeat`, `leave` and `reportLost` — touches `convex/schema.ts`, `convex/matches.ts`, `convex/matches.test.ts` — tests T1, T2, T3, T4
2. [ ] Add `sweep` and the cron — touches `convex/sweep.ts`, `convex/crons.ts`, `convex/sweep.test.ts` — tests T5, T6
3. [ ] Add ping, silence detection and `bye` to both sessions — touches `src/net/silence.ts`, `src/net/silence.test.ts`, `src/net/hostSession.ts`, `src/net/guestSession.ts`, `src/net/session.integration.test.ts` — tests T7, T8
4. [ ] Add the hidden-tab rule, heartbeats and `pagehide` leave to the match lifecycle, and the outcome states to the flow reducer — touches `src/net/visibility.ts`, `src/net/visibility.test.ts`, `src/ui/online/flow.ts`, `src/App.tsx` — tests T9

**Must not change:** `reportRound` semantics; campaign pause on tab hide.

**High-risk steps:** Step 2 — `sweep` deletes data on a schedule. A wrong filter deletes live matches. Review the query conditions and run it against the dev deployment with seeded data before production.

## Risks and open questions

- `pagehide` calls are best effort; mobile browsers often kill the page before a request lands. The 15-second silence path is the real guarantee.
- A player on a flaky connection who is still heartbeating to Convex but whose data channel is dead gets "No result" rather than a loss. That is deliberate: Convex cannot tell who broke the link.
- A hidden tab's timers are throttled; Chrome may run them once a minute after 5 minutes hidden. The 15-second rule fires well before that, but confirm on iOS Safari, which may suspend the page entirely — then R3's path on the opponent's side decides.
- Retention: 24 hours is proposed for finished matches. They contain only random GUIDs, roles and scores; shorten it if you want nothing kept.

## Progress log

- 2026-10-18 — Planned.
- 2026-10-18 — Plan approved.
