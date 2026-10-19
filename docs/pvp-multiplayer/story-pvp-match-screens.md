---
type: story
epic: pvp-multiplayer    # removed by `wi new` when there is no parent epic
slug: pvp-match-screens
status: in-progress
branch: story/pvp-match-screens
worktree_path: /Users/nhealea/Personal/Development/tanks.nathanhealea.com/pvp-tanks-worktrees/story-pvp-match-screens
created: 2026-10-18
approved: 2026-10-18
commit_type:         # optional override for the release subject type (default: story=feat, bug=fix, task=chore)
version:             # set by `wi stage`
review_approved:     # set by `wi accept`
pr:                  # set by `wi pr`
tag:                 # set by `wi release`; the tag sits on the branch's last commit
---

# Online menus, PvP HUD and match flow

## Summary

Build the screens that make online play usable: a **Play online** entry on the title screen, a menu for quick match, creating a private match and joining by code, waiting and connecting screens, a PvP HUD with the score, round countdowns and results, a match result with rematch, and a way to leave. This is the item that makes the feature visible, and it is where the accessibility requirements land.

## Context

`src/App.tsx` drives a `Screen` union (`title`, `playing`, `paused`, `popped`, `cleared`, `gameover`, `victory`) and renders an `Overlay` dialog (`role="dialog"`, `aria-modal`, heading, one `autoFocus` button) for each non-playing screen. `Hud` (`src/ui/Hud.tsx`) shows level, lives and enemies, and Sound and Pause buttons; ammo pips carry `aria-label`s. Escape and P pause via `bindDesktop`; hiding the tab pauses (`visibilitychange`). Touch controls render when `(pointer: coarse)` matches. Player colors are `p1` blue `#3d6da8` and `p2` green `#4f8a6b` (`PLAYER_COLORS` in `sim.ts`). The hooks and sessions come from items 6, 7 and 9. The repo has no component-test tooling, so the flow logic lives in a pure reducer that is unit tested, and the rendered UI is verified by hand. Depends on `random-matchmaking`, `private-match-codes` and `host-authoritative-netcode`.

## Scope

**In scope**

- Title screen: **Campaign** (today's Start) and **Play online**.
- Online menu, quick-match searching, private waiting (code, copy, share, expiry, new code), join by code, connecting, connection errors.
- PvP HUD, countdown, round result, match result, rematch, leave-match confirmation.
- Handling `?join=` links on load.
- `convex/matches.ts`: `requestRematch` mutation.
- A pure `onlineFlow` reducer and an error-message map.

**Out of scope**

- Disconnect and forfeit screens' logic (item 11 adds the states; this item renders them from the same reducer).
- Display names, chat, emotes.

## Requirements

- **R1** — **Play online** appears only when a Convex client exists; when the device is offline (`navigator.onLine === false`) it is disabled with visible text "Online play needs an internet connection."
- **R11** — The online menu states in one plain line what online play shares: private matches connect players directly, which shows each player's IP address to the other; quick matches go through a relay so strangers do not see it. The same wording appears in the README (deploy item R4). User decision, 2026-10-18.
- **R2** — The online menu offers **Quick match**, **Create private match**, **Join with code** and **Back**; each leads to its flow, and every waiting screen has **Cancel** that returns to the menu and releases the queue entry or private match.
- **R3** — The private waiting screen shows the code formatted `ABC-234` in large text, announced character by character to screen readers, with **Copy code**, **Copy link** (or **Share** where `navigator.share` exists), the time left before expiry, **Keep this code** (calls `extendPrivate`: same code, another 10 minutes) and **Make a new code**. At 1 minute left the warning is announced and **Keep this code** is offered; when the code expires the screen shows and announces an "expired" state with **Make a new code**, rather than silently returning to the menu.
- **R4** — Join with code has a labeled text input (6 characters, autocapitalized, no autocomplete), and each server error shows a specific message tied to the input with `aria-describedby`: not found "No match with that code.", expired "That code has expired. Ask for a new one.", full "That match is already full.", own code "This is your own match code. Send the link to a friend.", already in a match "You're already in a match."
- **R5** — Opening a `?join=` link starts the join flow directly; if Convex is unavailable it shows why and offers the campaign.
- **R6** — In a match, the HUD shows the round, the score as "You X – Y Them", and which tank is yours by color name ("You are Blue" / "You are Green"); there is no Pause. **Menu** (and Escape) opens "Leave match?" with **Stay** focused and **Leave** — leaving forfeits. Hiding the tab does not pause.
- **R7** — Each round opens with a 3, 2, 1 countdown; each round ends with "You won the round", "They won the round" or "Draw" for about 2 seconds, then the next round starts by itself.
- **R8** — The match result shows "You win 3–1" or "You lose 1–3", with **Rematch** and **Main menu**. Rematch starts a new match with the same opponent and the host role swapped once both players press it; until then the presser sees "Waiting for your opponent…" and can cancel.
- **R9** — Accessibility (WCAG 2.1 AA): every control is reachable and operable by keyboard with a visible focus indicator; focus moves to each new screen's heading or primary action; status changes (searching, opponent found, connecting, countdown, round result, errors, code expiry) are announced through a `role="status"` live region; text and controls meet 4.5:1 contrast (3:1 for large text and UI boundaries); player identity is never conveyed by color alone.
- **R10** — Campaign screens and controls behave as today, including pause on Escape and on tab hide.

## Acceptance criteria

- **AC1** (R1) — Given `VITE_CONVEX_URL` is unset, when the title screen shows, then there is no **Play online** button.
- **AC2** (R2) — Given a player is searching, when they press **Cancel**, then they return to the online menu and their queue entry is gone.
- **AC3** (R3, R9) — Given a VoiceOver user creates a private match, when the code appears, then VoiceOver reads "Match code: H K 7 Q 2 M" and **Copy link** is the next control.
- **AC4** (R4) — Given a player types a code that has expired, when they submit, then the expiry message appears under the input and the input is described by it.
- **AC5** (R6) — Given a match in progress, when the player presses Escape, then "Leave match?" opens with **Stay** focused, and the match keeps running behind it.
- **AC6** (R8) — Given both players press **Rematch**, then both move to connecting, and the player who was guest is now host.
- **AC7** (R9) — Given a keyboard-only user, when they go title → online → create → cancel → join by code → play → leave, then no step needs a mouse and focus is always visible.
- **AC8** (R10) — Given a campaign level, when Escape is pressed, then the game pauses as before.

## Test plan

| ID | Covers | Test | File | Asserts |
|----|--------|------|------|---------|
| T1 | R2, R7, R8 | `online flow transitions` | `src/ui/online/flow.test.ts` | Reducer walks menu → searching → connecting → countdown → playing → roundResult → matchResult; Cancel from each waiting state returns to menu |
| T2 | R2 | `cancel releases server state` | `src/ui/online/flow.test.ts` | Cancel from `searching` emits a `leaveQueue` effect; from `privateWaiting` emits `cancelPrivate` |
| T3 | R4 | `every join error has a message` | `src/ui/online/messages.test.ts` | Each of the five error codes maps to the exact copy above; unknown codes map to a generic message |
| T4 | R5 | `join link enters join flow` | `src/ui/online/flow.test.ts` | Initial state with a join code and a client → `joining` (pre-filled, not auto-joined); with no client → `unavailable` |
| T5 | R3 | `code is spoken by character` | `src/ui/online/messages.test.ts` | `spokenCode('HK7Q2M')` → `'H K 7 Q 2 M'`; `formatCode` reused from `share.ts` |
| T6 | R8 | `rematch needs both players` | `convex/matches.test.ts` | First request sets a flag; second creates a new match with host and guest swapped, same `kind`, new seed; outsider rejected |
| T7 | R8 | `rematch after opponent left fails` | `convex/matches.test.ts` | Opponent has left → `requestRematch` throws `OPPONENT_LEFT` |
| T8 | R10 | `campaign unaffected` | existing characterization tests | Item 1 tests pass |

**Connectivity matrix (deferred here from webrtc-connection step 4, required before staging this item):** with the dev deployment, connect two browsers on one machine; a laptop on home Wi-Fi against a phone on cellular; and one side on a VPN or campus network. Record for each: connected or not, time to connect, and which ICE candidate types won (`chrome://webrtc-internals`). The results decide whether `turn-relay` must ship before launch.

**Not unit testable:** R1 offline state, R3 copy and share, R6 HUD, R7 countdown visuals and all of R9. Verify manually and record results in the progress log:

- Keyboard-only walk-through of AC7 in Chrome and Firefox.
- VoiceOver on macOS Safari and iOS Safari for AC3 and the live-region announcements.
- axe DevTools scan of each new screen with zero serious or critical issues.
- Contrast check of new text and focus rings against the overlay card colors in `src/styles.css`.
- Landscape phone run-through with touch only.

## Implementation plan

1. [x] Add the pure `onlineFlow` reducer and message map — touches `src/ui/online/flow.ts`, `src/ui/online/flow.test.ts`, `src/ui/online/messages.ts`, `src/ui/online/messages.test.ts` — tests T1, T2, T3, T4, T5
2. [x] Add `requestRematch` — touches `convex/matches.ts`, `convex/matches.test.ts` — tests T6, T7
3. [x] Add the title entry point and online menu, searching, private waiting and join screens — touches `src/App.tsx`, `src/ui/online/OnlineScreens.tsx`, `src/styles.css` — tests T8 (manual checks above)
4. [x] Add connecting, countdown, round result, match result and leave-confirmation screens and the PvP HUD variant — touches `src/App.tsx`, `src/ui/online/MatchScreens.tsx`, `src/ui/Hud.tsx`, `src/styles.css` — tests T8 (manual checks above)
5. [x] Wire `?join=` handling and Escape-to-menu in matches, keeping campaign pause intact — touches `src/App.tsx`, `src/input/controls.ts` — tests T4, T8

**Must not change:** Campaign screens, copy and controls; `Overlay`'s dialog semantics.

**High-risk steps:** None.

## Risks and open questions

- `App.tsx` is already 200 lines with one screen union. Keep online screens in their own components driven by the reducer so `App` gains a branch, not a tangle.
- Escape currently pauses everywhere. In a match it must open the leave dialog instead; get this wrong and a keyboard user cannot leave, or the campaign stops pausing (AC5, AC8).
- WCAG 2.2.1 (Timing Adjustable): **Make a new code** does not extend anything, it voids the code already sent (corrected after the private-match-codes accessibility review). **Keep this code** (`extendPrivate`) extends the same code, is offered with the 1-minute warning, and works any number of times. The `CODE_EXPIRED` message tells the joiner to ask the host for a new code (3.3.3). Gameplay is real-time and exempt.
- Joining from a `?join=` link asks for confirmation ("Join HK7-Q2M?") before calling `joinPrivate`, so a link-preview bot that runs JavaScript cannot take the friend's guest slot (raised in the private-match-codes accessibility review).
- `useQuickMatch` and `usePrivateMatch` both read `myMatch`; a host with a waiting code gets `ALREADY_IN_MATCH` from quick match, which the online menu must explain.
- Open: component tests with Testing Library and an axe check in CI would make R9 regressions visible. Adds dev dependencies; ask before adding.
- Open: show a small "YOU" label above the player's own tank? Helps with color-vision differences beyond the HUD text. Cheap; proposed as part of step 4 unless declined.

## Progress log

- 2026-10-18 — Planned.
- 2026-10-18 — Plan approved.
- 2026-10-18 — Started on branch story/pvp-match-screens from origin/pvp-tank.
- 2026-10-18 — Steps 3-5 built. Deviations: the sharing line states today's behavior (direct connection) and changes with turn-relay; the round result shows during the next round's countdown rather than a separate 2 s screen (HostMatch starts the next round at once); a leave action was added to the flow for Leave match?. UI components have no automated tests (no React test library); manual checks pending.
