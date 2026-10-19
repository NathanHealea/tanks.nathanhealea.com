---
type: story
epic: pvp-multiplayer    # removed by `wi new` when there is no parent epic
slug: private-match-codes
status: in-progress
branch: story/private-match-codes
worktree_path: /Users/nhealea/Personal/Development/tanks.nathanhealea.com/pvp-tanks-worktrees/story-private-match-codes
created: 2026-10-18
approved: 2026-10-18
commit_type:         # optional override for the release subject type (default: story=feat, bug=fix, task=chore)
version:             # set by `wi stage`
review_approved:     # set by `wi accept`
pr:                  # set by `wi pr`
tag:                 # set by `wi release`; the tag sits on the branch's last commit
---

# Private matches with share codes and links

## Summary

Let a player create a private match and get a six-character code and a link to send to a friend. Whoever enters the code, or opens the link, joins that match and nobody else can. Codes use an alphabet without look-alike characters, expire after 10 minutes unused, and can be replaced with a fresh one.

## Context

Same backend pieces as `random-matchmaking`: the `matches` table with its `by_code` index, the access helpers from `player-identity`, and `myMatch` to watch for the guest arriving. The code creator is the host. The site is served at `https://tanks.nathanhealea.com` and Cloudflare serves `index.html` for any path (`"not_found_handling": "single-page-application"` in `wrangler.json`), so a `?join=` query string reaches the app. Screens are item 10; expiry sweeping is item 11. Depends on `convex-backend-setup` and `player-identity`.

## Scope

**In scope**

- `convex/privateMatch.ts`: `createPrivate`, `joinPrivate`, `cancelPrivate` mutations.
- `src/net/share.ts`: `normalizeCode`, `formatCode`, `buildJoinUrl`, `readJoinParam`.
- `src/net/usePrivateMatch.ts`: hook for create, join, cancel and renew, with heartbeats while waiting.

**Out of scope**

- Screens, copy-to-clipboard button and share sheet (item 10).
- QR codes.

## Requirements

- **R1** — `createPrivate` creates a `private` match in status `waiting` with the caller as host, a random unsigned 32-bit integer seed (as `roundSeed` requires), and a code of 6 characters from `ABCDEFGHJKMNPQRSTUVWXYZ23456789` (no `0`, `O`, `1`, `I`, `L`), unique among active matches, and an `expiresAt` 10 minutes out.
- **R2** — A player holds at most one waiting private match; creating another cancels the previous one so its code stops working.
- **R3** — `joinPrivate({ playerId, code })` normalizes the code (uppercase, strip spaces and dashes), sets the caller as guest and moves the match to `connecting`.
- **R4** — `joinPrivate` fails, changing nothing, with a distinct error for each case: no such code (`CODE_NOT_FOUND`), code past `expiresAt` (`CODE_EXPIRED`), match already has a guest (`MATCH_FULL`), caller is the host (`OWN_CODE`), caller already in another active match (`ALREADY_IN_MATCH`).
- **R5** — `cancelPrivate` lets the host cancel a waiting match; afterwards its code returns `CODE_NOT_FOUND`.
- **R6** — `buildJoinUrl(code)` returns `<origin>/?join=<CODE>`; on load, `readJoinParam()` reads a valid code from the URL and removes the parameter with `history.replaceState`, so a reload does not try to join again.
- **R7** — Codes are only exposed to their creator (the view returned to the host); `myMatch` for the guest does not include the code.
- ~~**R8** — While waiting, the host's client heartbeats every 10 seconds.~~ Moved to `disconnect-and-cleanup` (R9 there): no match heartbeat mutation exists until that item adds presence, and a waiting code already expires after 10 minutes.

## Acceptance criteria

- **AC1** (R1) — Given A creates a private match, then A sees a 6-character code from the allowed alphabet and the match is `waiting`.
- **AC2** (R3) — Given A's code `HK7-Q2M`, when B enters `hk7 q2m`, then B joins and both see `connecting`.
- **AC3** (R4) — Given B has joined A's match, when C enters the same code, then C gets `MATCH_FULL` and the match still has B.
- **AC4** (R4) — Given A's code is 11 minutes old, when B enters it, then B gets `CODE_EXPIRED`.
- **AC5** (R2, R5) — Given A creates code X then creates code Y, when B enters X, then B gets `CODE_NOT_FOUND`.
- **AC6** (R6) — Given B opens `/?join=HK7Q2M`, then the join starts and the address bar shows `/`.

## Test plan

| ID | Covers | Test | File | Asserts |
|----|--------|------|------|---------|
| T1 | R1 | `create returns a valid code` | `convex/privateMatch.test.ts` | 6 chars, all in alphabet, match `waiting`, host is caller, `expiresAt` = now + 10 min |
| T2 | R1 | `codes are unique among active matches` | `convex/privateMatch.test.ts` | With the code generator stubbed to collide once, the second create gets a different code |
| T3 | R2 | `second create cancels the first` | `convex/privateMatch.test.ts` | First match is `abandoned`; one waiting match for the host |
| T4 | R3 | `join normalizes and connects` | `convex/privateMatch.test.ts` | Lowercase with spaces and dashes joins; status `connecting`; guest set |
| T5 | R4 | `join errors are distinct and side-effect free` | `convex/privateMatch.test.ts` | Each of the five cases throws its code; match row unchanged after each |
| T6 | R5 | `cancel removes the code` | `convex/privateMatch.test.ts` | After cancel, join throws `CODE_NOT_FOUND`; non-host cancel throws `Not in this match` |
| T7 | R7 | `guest view omits the code` | `convex/privateMatch.test.ts` | Host view has `code`; guest view does not |
| T8 | R3 | `normalizeCode and formatCode` | `src/net/share.test.ts` | `' hk7-q2m '` → `'HK7Q2M'`; invalid characters → `null`; `formatCode('HK7Q2M')` → `'HK7-Q2M'` |
| T9 | R6 | `join url round-trips` | `src/net/share.test.ts` | `buildJoinUrl` output parsed by `readJoinParam` returns the code and calls `replaceState` without `join` |
| T10 | R6 | `invalid join param is ignored` | `src/net/share.test.ts` | `?join=<script>` returns `null` and leaves history alone |
| ~~T11~~ | R8 | moved to disconnect-and-cleanup | — | — |
| T12 | R4 | `joinErrorOf` maps each refusal | `src/net/joinErrors.test.ts` | Each of the five ConvexError codes maps to itself; any other ConvexError, plain Error or value is `UNKNOWN` |

**Not unit testable:** None.

## Implementation plan

1. [x] Add `createPrivate` and `cancelPrivate` with code generation and uniqueness — touches `convex/privateMatch.ts`, `convex/lib/codes.ts`, `convex/privateMatch.test.ts` — tests T1, T2, T3, T6
2. [x] Add `joinPrivate` with normalization and the five error cases, and the code-aware match view — touches `convex/privateMatch.ts`, `convex/lib/access.ts`, `convex/privateMatch.test.ts` — tests T4, T5, T7
3. [x] Add the share-link helpers — touches `src/net/share.ts`, `src/net/share.test.ts` — tests T8, T9, T10
4. [x] Add the `usePrivateMatch` hook and join-error mapping — touches `src/net/usePrivateMatch.ts`, `src/net/joinErrors.ts`, `src/net/joinErrors.test.ts` — tests T12

**Must not change:** `toMatchView`'s guarantee of no GUIDs (extended here only to carry `code` for the host).

**High-risk steps:** Step 2 — it decides who may join a match.

## Risks and open questions

- 31⁶ ≈ 887 million codes and a 10-minute life make guessing an active code impractical without thousands of calls a second. If abuse appears, add a rate limiter (epic open question).
- Distinct error codes tell a guesser whether a code exists but expired. Acceptable: expired codes lead nowhere. The UI copy for each is in item 10.
- If the same person opens their own share link, they hit `OWN_CODE`. Item 10 should show "This is your own match code. Send the link to a friend."

## Progress log

- 2026-10-18 — Planned.
- 2026-10-18 — Plan approved.
- 2026-10-18 — Started on branch story/private-match-codes from origin/pvp-tank.
- 2026-10-18 — Steps 1 and 2 share convex/privateMatch.ts, so they landed together after the codes module. Added tests beyond the plan: expired code frees the host, ALREADY_IN_MATCH on create, queue entry removed on create and join, guest cannot cancel, malformed ids rejected by all three functions (a mutation showed joinPrivate validation was otherwise untested).
- 2026-10-18 — Step 4: R8/T11 (waiting host heartbeat) moved to disconnect-and-cleanup R9, since no match heartbeat mutation exists before that item. Step 4 became the hook plus a tested joinErrorOf mapping (T12); the hook itself is a thin untested wrapper.
