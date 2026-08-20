# Party / TV Mode QA and Rollout Plan

## Purpose

This document defines the release gates for Party / TV Mode: one shared board on a laptop or TV plus private player-phone controllers. The standard all-human topology is three to eight phones; the existing optional bot policy also permits one human phone plus bots for a total of three to eight active seats. The feature is additive. Existing Online Mode must keep its current protocol, rules, rooms, reconnect behavior, and UI throughout the rollout.

The MVP is releasable only when all hard gates in this document pass. A privacy failure, an Online Mode regression, or a server-authority failure is a release blocker rather than a known issue.

## Non-negotiable invariants

- The board is a display client, not a player seat. It cannot play a card, take the right-hand player's cards, ready a player, start a round, change settings, kick a player, or read Table Talk.
- A Party room contains exactly one active board session and three to eight player seats. A replacement board may reconnect with the board credential, but it must not create a ninth player or duplicate the board session.
- The first phone successfully seated is the player host. A simultaneous first-join race still produces exactly one host.
- The server remains authoritative for shuffle, hands, legal moves, turn order, timers, THULLA resolution, taking the right-hand hand, round results, and rematches.
- Turns remain anticlockwise to the active player on the right and use the same Pakistani rules as Online Mode.
- The public board receives a dedicated allowlisted view. It never receives concealed cards, deck order, discard history that is not already public, legal-card IDs, reconnect/player tokens, board credentials, socket IDs, or Table Talk content/history.
- Each phone receives only its own hand and legal actions. It receives public card counts for other seats, never their card faces.
- A played card may become public only after the server accepts the action. The completed trick and THULLA result remain visible for the existing three-second resolution phase, then clear before the next turn clock begins.
- QR and share URLs contain only a room locator and Party join intent. They never contain a player token, board credential, or privileged capability.
- Party state persistence follows the existing privacy rules: no socket IDs, raw reconnect credentials, or chat in Redis. A board reconnect credential is stored server-side only as a one-way verifier.
- Online Mode clients ignore the additive `party-v1` capability and `partyMode` availability field and continue working against the new server without a frontend upgrade.

## Release severity and evidence

| Severity | Meaning | Release decision |
| --- | --- | --- |
| P0 | Private data disclosure, unauthorized action, room-state corruption, or credentials in logs/URLs | Stop testing, disable new Party rooms, and roll back immediately |
| P1 | Online Mode regression, repeatable board/controller desync, inability to start/finish a valid game, or broken reconnect | Block release or roll back |
| P2 | Critical control obscured, inaccessible, or unusable on a supported viewport; material performance regression | Block public exposure until fixed |
| P3 | Cosmetic defect with a clear workaround and no gameplay/accessibility impact | May ship only with an owner and scheduled fix |

Every gate records the commit, backend version, frontend build marker, browser/device matrix, test output, and sanitized screenshots under `design/qa/party-mode/`. Network traces must come only from synthetic test rooms and must be checked for credentials before retention.

## Phased delivery gates

### Gate 0 — Contract and threat-model freeze

Deliverables:

- Room mode and role model: `online` versus `party`, and `player` versus `board`.
- Separate schemas for player view, board view, commands, acknowledgements, and reconnect credentials.
- An allowlist for the board payload; do not derive it by deleting fields from a player payload.
- An authorization table for every Socket.IO event and role.
- A versioned, backward-compatible Redis shape or a separate Party key namespace.
- Server-advertised `party-v1` capability plus `partyMode: off | beta | public` availability. Old clients must safely ignore both additive fields.
- Recovery behavior for phone refresh, board refresh, duplicate tabs, network loss, server restart, and host departure.

Exit criteria:

- Contract review finds no route by which the board can obtain private state or send player commands.
- Unknown/additive fields are ignored by the current production client.
- Party persistence cannot make an older server misread or corrupt existing Online rooms.
- Every threat has a testable mitigation and an assigned automated or manual check.

### Gate 1 — Backend behind off/hidden-preview availability

Implement Party room/domain behavior and Socket.IO protocol while the production capability remains `off` or `beta`.

Exit criteria:

- All existing tests pass unchanged.
- New unit, contract, authorization, persistence, and Socket.IO integration tests pass.
- A current Online Mode frontend completes create, join, play, THULLA, reconnect, finish, and rematch against the new server.
- `/health` reports the expected commit and `/ready` returns HTTP 200 with Redis `mode: redis`, `durable: true`, and `ready: true`.
- Logs contain no player name, room code, hand, legal-card list, reconnect credential, board credential, socket ID, or chat text.

### Gate 2 — Board and controller UI in local/hidden-preview access

Build the shared board and private controller as separate views while the normal landing-page Party option remains hidden. In `beta`, `/?partyBeta=1` may reveal the entry; this is a hidden preview rather than an access-control boundary. The query grants no room privilege and does nothing when availability is `off`.

Exit criteria:

- Fixture-driven UI tests cover lobby, ready, playing, resolving, reconnecting, finished, capacity, and recoverable error states.
- The board remains useful at the minimum supported board viewport, and the phone controller remains operable at the minimum supported phone viewport.
- All critical controls have semantic roles, visible focus, accessible names, 44 by 44 CSS-pixel minimum targets, and at least 8 CSS pixels between adjacent targets.
- No page-level horizontal overflow, clipped cards, obscured actions, or content hidden behind fixed UI/safe areas occurs in the responsive matrix.
- Reduced-motion, keyboard-only, screen-reader, 200% zoom, and Urdu/RTL checks pass.

### Gate 3 — Real multi-client integration

Run real Socket.IO clients against one server, not independent fixtures. The harness must control one board and three to eight phones for the all-human matrix, plus the explicit phone-and-bots scenario, and compare every received view to authoritative server state.

Exit criteria:

- All scenarios in the multi-client matrix pass at minimum, typical, and maximum capacity.
- Every accepted action appears once on the board and all phones; every rejected or duplicate action changes state zero times.
- Public card counts always equal authoritative hand sizes, while concealed card identities never appear in unauthorized payloads.
- Board and phones converge on the same public revision after reconnect, late join, resolution, rematch, and server restore.
- The harness closes sockets and deletes/expires synthetic rooms after each run.

### Gate 4 — Device, accessibility, performance, and soak sign-off

Run the responsive matrix in Chromium plus representative Safari/WebKit and Firefox coverage. Use at least one physical iPhone/iPad class device, one physical Android phone, and the actual laptop/TV connection intended for play.

Exit criteria:

- Accessibility and responsive gates pass with no P0–P2 issue.
- Warm-server performance stays inside the budgets below.
- One board plus eight phones completes a full round and rematch without desync.
- A 60-minute one-board/eight-phone soak has no socket leak, duplicate action, progressive timer drift, unbounded memory growth, or UI degradation.
- Slow-network, temporary offline, phone background/resume, board refresh, and Redis-backed server restart recover as specified.

### Gate 5 — Additive production rollout

Deploy the compatible backend first, verify it with the existing frontend, then deploy the Hostinger build. Keep Party in `beta` until the production smoke test passes. Only then change the advertised capability to `public`.

Exit criteria:

- Render and Hostinger checks in the deployment sequence pass in order.
- Production smoke passes with one board and at least three real phones.
- Existing Online Mode smoke passes before and after Hostinger deployment.
- No rollback threshold is crossed during the initial observation window.

## Automated test plan

The existing commands remain mandatory:

```text
npm test
npm run build
npm run qa:platform
npm run qa:visual
```

Add a repeatable Party integration/visual harness (proposed command: `npm run qa:party`) and a bounded load/soak harness (proposed command: `npm run qa:party:load`). The command names are proposals until added to `package.json`; the gates, not the names, are mandatory.

### Unit and domain tests

- Create `online` and `party` rooms with valid defaults; reject unknown modes.
- Enforce three-player minimum and eight-player maximum without counting the board.
- Elect exactly one player host, including concurrent first joins and host transfer/leave.
- Preserve existing deal, legal-card, THULLA, take-right, resolution, winner/Bhabhi, scoring, and rematch logic.
- Reject start until the Party minimum is seated and every required human is ready.
- Keep the board outside turn order, card dealing, active-player count, scores, and Bhabhi selection.
- Produce a board view from an explicit allowlist and a phone view scoped to one player.
- Increment one persisted room revision per authoritative change and expose the same revision plus non-persisted `serverNow` in board/phone views.
- Hash/verify player and board reconnect credentials; never serialize raw credentials.
- Restore Party rooms from Redis without extending absolute resolution or reconnect deadlines. Preserve the current ordinary-turn policy: restored play is suspended and receives a fresh configured turn deadline only after an eligible player reconnects.
- Accept the existing Online room persistence shape and prevent Party fields from changing its behavior.

### Protocol and authorization tests

- Board create/attach, phone join, ready, start, settings, play, take-right, reaction, finish, and rematch acknowledgements use strict payload validation. Retrying the same securely generated create request/token after a lost acknowledgement returns one room; altered/expired retries attach to nothing.
- A board attempting every player/host event receives a generic authorization error and causes no mutation.
- A non-host phone attempting host events is rejected without revealing host credentials or internal IDs.
- A phone cannot request another player's private view by changing a payload player ID.
- A board reconnect credential cannot reconnect a player, and a player credential cannot attach a board.
- Replayed and simultaneous double-tap actions are idempotently rejected after the first acceptance.
- Out-of-turn, illegal-suit, duplicate/outdated-turn, resolving-phase, over-capacity, invalid-code, and malformed-payload actions cause no mutation.
- An old Online client completes its existing protocol against the additive server.
- CORS and origin checks reject untrusted web origins while allowing the configured Hostinger origin.

### UI/component tests

- Landing selection clearly separates Online Mode from Party / TV Mode.
- Board lobby shows a readable room code, decodable QR, connection state, player list, and waiting guidance without a private-hand container in the DOM.
- First phone host, later phone guest, ready/unready, disabled, loading, error, offline, reconnecting, and kicked/left states render correctly.
- Phone card controls expose accessible card names and playable/unplayable state; disabled cards cannot emit actions.
- The action remains pending until server acknowledgement, prevents duplicate taps, and offers a recovery path after timeout/rejection.
- Board and controller resolution views keep the last card/THULLA visible for the full display interval and do not start a turn clock early.
- Rematch readiness, next-round late join, host departure, board replacement, and room-ended screens provide a clear next action.
- QR regeneration/replacement never changes an active player's credentials or seat.

### Visual and DOM assertions

- Capture every state at every required viewport, plus three-player and eight-player board layouts.
- Assert `scrollWidth <= clientWidth` at the page level.
- Assert no pairwise collision among header, seats, table cards, status/timer, QR panel, primary action, Table Talk trigger, and safe-area regions.
- Assert all visible interactive elements have an accessible name and a minimum 44 by 44 CSS-pixel hit box.
- Assert adjacent mobile targets have at least 8 CSS pixels of separation.
- Assert no duplicate IDs, invalid nested interactive elements, hidden focused controls, or console errors/warnings.
- Decode the QR from the rendered screenshot and verify that it contains only the public join URL and correct room code.
- Run the same assertions with `prefers-reduced-motion: reduce`, 200% text/zoom, and Urdu RTL.

## Multi-client integration matrix

| ID | Topology and setup | Actions | Required result |
| --- | --- | --- | --- |
| P-01 | 1 board + 3 phones | Two phones race to join first; all ready; host starts | Exactly one phone is host; board is not a seat; all three receive distinct hands |
| P-02 | 1 board + 3 phones | Complete opening trick, clean trick, THULLA, take-right, final card, and round | Rules match Online Mode; board shows only accepted public cards; three-second resolution is synchronized |
| P-03 | 1 board + 4 phones | Fourth phone joins during an active round | It sees public table state and no hand, waits for next round, readies, and is dealt only on rematch |
| P-04 | 1 board + 8 phones | Ready/start and play at maximum capacity | No ninth seat; every turn advances right/anticlockwise once; all public views converge |
| P-05 | 1 board + 8 phones | A ninth phone attempts to join | Clear capacity error; no credentials or player details leak; existing room is unchanged |
| P-06 | 1 board + 3 phones | Two taps and two sockets submit the same action after authoritative state has advanced | One action is accepted at most; no duplicate card, turn advance, or animation occurs |
| P-07 | 1 board + 3 phones | Board sends each player/host command directly | Every command is rejected and authoritative state is byte-for-byte unchanged |
| P-08 | 1 board + 3 phones | Non-active phone submits legal-looking and illegal cards | Both are rejected without disclosing the active player's legal moves |
| P-09 | 1 board + 3 phones | Active phone drops offline during its turn, then reconnects within grace | Turn pauses per existing policy; same seat and hand return; one fresh deadline is shown everywhere |
| P-10 | 1 board + 3 phones | Phone refreshes, opens a duplicate tab, backgrounds, then resumes | One authoritative seat remains; old connection is fenced or read-only; no double play is possible |
| P-11 | 1 board + 3 phones | Board disconnects while phones continue, then refreshes/reconnects | Player turn is not reassigned merely because the display left; replacement board gets the latest public revision only |
| P-12 | 1 board + 3 phones | Wrong/expired board credential attempts attachment | Generic failure; no room state, player names, or credential validity details are revealed |
| P-13 | 1 board + 3 phones | Player host leaves before start and during/after a round | Host transfer and game policy are deterministic; board never becomes host |
| P-14 | 1 board + 3 phones | Restart server with Redis during turn and during three-second resolution | Room restores suspended; an ordinary turn gets one fresh configured deadline only after eligible player reconnect, while an unexpired resolution/reconnect deadline is never extended |
| P-15 | 1 board + 3 phones | Introduce latency, reordering, brief packet loss, and a 15-second outage | Revision ordering prevents stale paint; clear reconnect UI appears; all clients converge after recovery |
| P-16 | 1 board + 3 phones | Finish, mark rematch readiness, add a waiting player where allowed, and redeal | Scores and readiness are public; only seated phones receive new private hands |
| P-17 | Current Online frontend + new server | Complete create/join/game/reconnect/rematch | No Party dependency, changed copy, event error, or behavioral regression appears |
| P-18 | 1 board + 8 phones for 60 minutes | Repeated rounds, refreshes, reactions, and reconnects | No memory/socket growth trend, duplicate listeners, timer drift, desync, or credential exposure |
| P-19 | 1 board + 1 phone + 2 bots | Host enables/adds bots, starts, plays, rematches, removes/adds a bot | Bots count toward 3–8 seats, receive no socket/credential/private projection, and existing bot rules match Online Mode |
| P-20 | Board create with no phones | Lose the create acknowledgement; retry the identical stored request ID/token once while the original socket remains connected and once after it drops | Exactly one room/code exists; a replacement fences/notifies the old board; altered/expired pairs attach to nothing and disclose no room details |
| P-21 | 1 connected board + no phones | Advance idle time beyond the six-hour room TTL, then use the offered create-new-room action on the same socket | Board receives the explicit expired state; old room is removed from memory/Redis; socket role/room binding is cleared; one new room is created successfully |

For P-01 through P-21, compare a normalized public projection from every phone with the board view after each server revision. Differences are allowed only for the phone's own private fields and role-specific controls.

## Privacy and security assertions

### Board payload denylist

Inspect every board event, acknowledgement, initial state, reconnect state, and error. Fail the run if any payload contains:

- Any concealed card rank/suit or unplayed card ID.
- `hand`, `legalCards`, `legalCardIds`, deck order, historical activity `cardId`, or equivalent derived hints.
- Player/board reconnect tokens or verifiers, create request IDs/verifiers/expiry, auth headers, cookies, or socket IDs.
- Table Talk messages, history, drafts, unread content, or notification previews.
- Server-only shuffle seed, next card, bot decision state, persistence keys, or internal error stack.

Public player display names, seat order, card counts, ready/connected state, accepted played cards, trick result, scores, and timers are permitted. Tests should use known concealed-card sentinels and scan serialized board traffic before each sentinel becomes public through accepted play.

### Phone isolation

- Phone A traffic may contain Phone A's hand/legal actions but none from Phones B–H.
- Public card counts must not be accompanied by DOM nodes, CSS-hidden card faces, source-map data, preload data, or optimistic hints for another hand.
- Changing a client-supplied player/room/role identifier cannot change the server-selected identity associated with the credential and socket.
- Table Talk remains phone-only and room-scoped. The board is not silently subscribed and receives no notification preview.

### Credentials, persistence, and diagnostics

- QR/share/history/referrer/analytics URLs contain no secret.
- Browser storage keeps only the credential needed by that role; a board never stores a player credential and a phone never stores a board credential.
- Redis snapshots contain neither raw credential/request ID nor socket ID nor chat; only the board-token verifier and an unexpired create-request verifier/deadline may persist. Party keys expire according to the room abandonment policy.
- Production logs and coarse metrics use result categories and room mode only—never names, room codes, cards, chat, credentials, IP addresses, or full user agents.
- Errors returned to clients are actionable but generic enough to prevent room enumeration and credential probing.
- Source maps, QA traces, screenshots, and test reports contain only synthetic test data and no reusable credentials.

Any failed assertion in this section is P0.

## Responsive viewport matrix

### Phone controller

| Viewport | Purpose | Required checks |
| --- | --- | --- |
| 320×568 portrait | Smallest supported phone | Join form, full hand scrolling, turn state, and primary action remain reachable without horizontal page overflow |
| 360×800 portrait | Common Android | Safe-area spacing, keyboard-open join form, cards, and sticky action area |
| 375×667 portrait | Short iPhone class | No collision among hand, status/timer, Table Talk, and action controls |
| 375×812 portrait | Tall compact phone | Core action remains in thumb reach; fixed controls reserve document space |
| 390×844 portrait | Current primary mobile QA | All lobby/game/reconnect/result states and open Table Talk sheet |
| 412×915 portrait | Large Android | Hand does not over-expand; readable line lengths and consistent gutters |
| 430×932 portrait | Large iPhone class | Safe-area top/bottom insets and card selection states |
| 844×390 landscape | Short landscape | No clipped header/hand/action; table status remains visible alongside the hand |
| 915×412 landscape | Large landscape phone | Keyboard, sheet, and action controls avoid OS gesture regions |
| 768×1024 and 1024×768 | Tablet controller | Content width is constrained; no desktop-sized gaps or edge-to-edge long text |

### Shared board

| Viewport | Purpose | Required checks |
| --- | --- | --- |
| 1024×576 | Minimum board/short display | QR lobby and live table remain complete; no control or seat is below an inaccessible fold |
| 1280×720 | Minimum TV target | Three- and eight-seat layouts, trick, timer, room state, and result are simultaneously readable |
| 1366×600 | Short laptop | Header and bottom status do not overlap the table or seats |
| 1366×768 | Common laptop/TV browser | Lobby QR and code are prominent; live board uses available space without crowding |
| 1440×900 | Current desktop QA | All board states, fullscreen affordance, and eight-seat layout |
| 1920×1080 | Full-HD TV | Elements scale without excessive empty space; names/card counts remain legible at room distance |
| 2560×1440 | High-density monitor | Content max-size prevents over-stretching; cards and type remain crisp |
| 3840×2160 | 4K TV | CSS scaling and assets remain sharp; no tiny fixed-pixel UI |
| 768×1024 portrait | Accidental tablet board | Show a usable compact board or clear rotate/use-larger-screen guidance; never reveal private content |

At every viewport, test three and eight seats, long permitted names, Urdu/RTL, browser zoom at 100% and 200%, open browser chrome, fullscreen enter/exit, and a simulated notch/safe area where applicable. At 100% the board remains a complete single-screen composition; at 200% it may use one vertical scroll owner and the specified accessible linear summary, with no content loss or two-dimensional page scrolling. The QR must decode from a screenshot at every supported lobby viewport.

## Accessibility gates

Target WCAG 2.2 AA for both views.

- All controller flows work with keyboard only. Focus order follows visual order, focus is never trapped, and focus returns predictably after dialogs, card submission, reconnect, and errors.
- Cards are semantic buttons with names such as “Five of Hearts, playable” or “Five of Hearts, unavailable—follow Spades.” Visual suit/rank is not the only accessible label.
- Status changes use restrained `aria-live` announcements: turn changes, accepted/rejected play, THULLA, reconnect, and result. Per-second timer ticks must not flood the screen reader.
- Board content has a logical reading order and a concise public match summary. Decorative cards/logos are hidden from assistive technology; meaningful images have text alternatives.
- Visible focus indicators have at least 3:1 contrast against adjacent colors. Normal text meets 4.5:1 and large text/UI boundaries meet 3:1.
- Turn, playable state, readiness, connection, errors, and suit information are conveyed by text/icon/shape in addition to color.
- Touch targets are at least 44 by 44 CSS pixels with 8-pixel separation, including cards, fullscreen, copy, help, chat, and close controls.
- Browser zoom is not disabled. At 200% zoom or enlarged system text, controls remain operable and content can reflow without loss.
- `prefers-reduced-motion: reduce` removes card flight, confetti, pulsing, and parallax while preserving immediate state clarity. No critical wait depends on animation completion.
- Audio/vibration is optional and never the only indication of a turn, accepted card, error, or result.
- English, Roman Urdu, and Urdu labels remain understandable. RTL reverses text/layout conventions where appropriate but does not reverse the game's explicitly communicated “right/anticlockwise” rule.
- Automated axe-style checks report zero critical/serious findings; keyboard and screen-reader passes remain mandatory because automation is not sufficient.

## Performance and reliability budgets

Measure with a warm backend separately from Render free-tier cold start.

- Controller tap feedback appears within 100 ms. A card is committed visually only after server acceptance.
- In a controlled regional test, action acknowledgement p95 is at most 300 ms and accepted public state appears on all nine clients p95 within 500 ms of emission.
- No gameplay state update creates a main-thread task over 100 ms; normal state render work should fit within a 16 ms frame budget on the reference mid-range phone.
- Warm navigation LCP is at most 2.5 seconds, CLS is at most 0.1, and interaction responsiveness is at most 200 ms in the lab profile.
- Joining/attaching a warm room reaches a usable lobby within two seconds on the throttled mobile profile.
- A Render cold start shows “Waking up server…” feedback within one second, retains join intent, and retries without duplicate rooms or seats. Cold-start time is reported separately and does not waive correctness.
- The Party route is code-split where practical. Any initial compressed-JavaScript increase over 10% or new single asset over 300 KB needs review and an explicit waiver.
- QR generation completes within 200 ms and reserves layout space so it does not cause a visible shift.
- One board plus eight phones runs for 60 minutes with no unbounded heap/listener growth and no more than one active socket per role after reconnect fencing.
- The load check runs at least ten concurrent maximum-capacity Party rooms (90 sockets) in a controlled environment, with under 1% action/join errors and zero state divergence. This is a pre-release capacity signal, not permission to horizontally scale Socket.IO without an adapter/sticky-session design.
- Reconnect after restored network completes within five seconds on a warm server. With a cold server, the waiting state remains accurate and recovery completes once `/ready` succeeds.

## Reconnect and continuity checklist

- Phone refresh restores the same player ID, hand, readiness, language, and local preferences without exposing the reconnect credential in the URL.
- Board refresh restores the same public table. It never inherits the player host's credential merely because the host opened the board.
- A newly attached board invalidates or fences the previous board connection so two boards cannot issue privileged attach/transfer operations.
- Board loss does not consume a player turn or reassign power. Phones show enough public status to continue or wait while the display reconnects.
- Active-player loss uses the existing 60-second grace behavior and pauses/resumes one deadline consistently on all clients.
- Reconnect during the three-second resolution displays only the remaining resolution time and does not replay or extend the phase.
- Late reconnect after grace follows the existing deterministic skip/replacement policy; it never silently grants a new turn.
- Server restart with Redis restores a suspended room. Resolution/reconnect deadlines remain absolute; an ordinary turn follows the existing single-fresh-deadline-on-eligible-reconnect policy. Board and phones converge after credentialed reconnect.
- Duplicate tabs/sockets are fenced; a stale tab cannot submit a second card or overwrite newer state.
- Offline and timeout messages state what happened and provide retry/leave options. No blank/frozen UI is accepted.

## Additive deployment sequence

### 1. Prepare a reversible release

1. Keep the last-known-good server commit and Hostinger zip available.
2. Ensure Party protocol/storage changes are additive and the production capability defaults to `beta`, not `public`.
3. Run `npm ci`, all unit/integration tests, both QA suites, Party QA, and the load/soak gate against the release commit.
4. Build with a fresh `VITE_APP_COMMIT` from that same commit and scan the output for secrets.
5. Confirm no destructive Redis migration is required. Prefer a versioned Party schema or separate namespaced keys so Online rooms survive rollback.

### 2. Deploy Render first

1. Push/deploy the server commit while the current Hostinger frontend remains live.
2. Wait for deployment success, then verify `/health` reports the exact commit.
3. Verify `/ready` is HTTP 200 and reports Redis, durable, and ready.
4. Run a complete current Online Mode smoke against the new server.
5. Use the beta hidden-preview route to run one board plus three phones, reconnect, finish, and rematch.
6. Inspect Render logs/metrics for authorization errors, desync, crashes, secret-bearing output, Redis failures, or rising Socket.IO errors.
7. Do not continue to Hostinger if any backend, compatibility, readiness, or privacy gate fails.

### 3. Deploy Hostinger second

1. Build the static frontend from the verified server-compatible commit and run `qa:platform` plus Party visual QA against the production backend.
2. Package the contents of `dist/` at the archive root. Include all generated assets, manifest, offline page, and commit-stamped/versioned service worker.
3. Upload/extract into `public_html/thulla/`, overwriting the complete prior asset set without adding a wrapper directory.
4. Verify the production HTML references the new hashed assets and the service worker advertises the new build while preserving the controlled “Update & reconnect” behavior during games.
5. With Party still in hidden-preview beta, smoke landing, Online Mode, board lobby QR, three-phone join, play/THULLA, board refresh, phone refresh, finish, and rematch.
6. Verify representative phone portrait/landscape and 1280×720/1920×1080 board layouts with no console errors or private fields in board traffic.

### 4. Expose and observe

1. Change the server-advertised `partyMode` availability from `beta` to `public` only after the production smoke passes; keep the technical `party-v1` capability unchanged.
2. Confirm the normal landing page now shows Party / TV Mode while old clients continue ignoring the additive capability.
3. Observe the first release window for join/start success, disconnect/reconnect outcomes, unhandled exceptions, authorization rejects, and readiness. Metrics must remain coarse and privacy-safe.
4. Disable creation of new Party rooms first if thresholds degrade; allow healthy active rooms to finish unless a privacy/security incident requires immediate termination.

## Rollback criteria and actions

### Immediate rollback/kill criteria

- Any private hand, legal move, credential, Table Talk content, or concealed card appears on the board, in a URL, in analytics, or in logs.
- A board/non-host/other phone can cause an unauthorized state mutation.
- Existing Online Mode can no longer create, join, play, reconnect, finish, or rematch.
- Server or Redis state corruption, repeated room loss, duplicate cards, divergent winners, or irreconcilable client revisions occurs.
- `/ready` is not HTTP 200 Redis/durable/ready after the server deployment.

### Disable-new-room criteria

- Party create/join/start failure exceeds 2% over a meaningful rolling sample excluding invalid user input.
- Reconnect success falls below 95% on warm-server recoverable disconnects.
- More than one confirmed board/phone desync occurs in production.
- A supported viewport hides a primary gameplay control or has repeatable page-level overflow.
- Action-to-all-clients p95 exceeds one second on a warm service for 15 minutes, or the server shows sustained resource saturation.

### Rollback procedure

1. Set `PARTY_MODE=off` to stop all fresh Party-room creation. Keep `party-v1` advertised so saved boards/phones and direct joins to existing healthy rooms can reconnect and finish.
2. For a UI-only problem, restore the previous Hostinger artifact. The additive server may remain because current Online clients are compatible.
3. For a backend/protocol regression, restore the previous Hostinger artifact, then roll Render back to the last-known-good commit after confirming the Redis schema is backward-compatible.
4. Preserve healthy Online room keys. Delete only isolated Party keys when corruption/privacy response requires it.
5. For a credential/private-data incident, terminate affected Party sessions, purge affected Party keys, invalidate/rotate board credentials, remove exposed logs/artifacts where possible, and document the incident before re-enabling.
6. Re-run `/health`, `/ready`, and a complete Online Mode smoke after rollback.
7. Do not re-expose Party until the failing scenario has an automated regression test and every earlier gate passes again.

## MVP acceptance checklist

### Product flow

- [ ] Landing page offers distinct Online Mode and Party / TV Mode choices.
- [ ] A shared screen can create/attach a board and show a large room code plus decodable QR.
- [ ] Up to eight phones can join by QR/code; the room starts with 3–8 active seats and at least one human phone, while the board never counts as a player.
- [ ] The first seated phone is the host and controls ready/start/settings/rematch actions.
- [ ] The board shows seats, public card counts, turn/power, played trick, waste, THULLA/result, timer, scores, and reconnect state.
- [ ] Each phone shows only its private hand, legal interactions, essential public status, and phone-only Table Talk.
- [ ] Late joiners wait safely for the next deal and receive no hand from the active round.

### Rules and synchronization

- [ ] Ace of Spades opening, follow-suit, THULLA, clean trick, take-right, final-card/waste, Bhabhi result, scoring, and rematch match Online Mode.
- [ ] Play advances anticlockwise to the active player on the right.
- [ ] Completed cards/THULLA stay visible for about three seconds, actions are locked, then the board clears and a fresh turn timer begins.
- [ ] One accepted action produces exactly one authoritative revision and every connected client converges.
- [ ] Maximum-capacity and simultaneous-input tests pass without duplicate seats/cards/actions.

### Privacy and authorization

- [ ] Board payload and DOM contain no concealed hand, legal moves, credentials, socket IDs, deck order, or Table Talk.
- [ ] Each phone receives no other phone's concealed cards or legal moves.
- [ ] QR/share URLs contain no credential.
- [ ] Board, non-host, stale, and spoofed commands are rejected with zero mutation.
- [ ] Redis, logs, analytics, traces, and artifacts pass the privacy assertions.

### Resilience and compatibility

- [ ] Phone refresh/background/offline restores the same seat and hand within policy.
- [ ] Board refresh/replacement restores only current public state and does not alter gameplay.
- [ ] Active-player grace, resolution reconnect, duplicate-tab fencing, and Redis-backed server restart tests pass.
- [ ] Current Online Mode passes its complete regression suite against the additive server and frontend.
- [ ] Free-tier cold start presents useful progress and does not create duplicate rooms/seats.

### UX quality

- [ ] All required phone, tablet, laptop, TV, orientation, safe-area, zoom, and RTL viewports pass without overlap or page-level overflow.
- [ ] Touch targets, spacing, contrast, focus, accessible names, live announcements, keyboard flow, screen-reader flow, and reduced motion meet the accessibility gates.
- [ ] Performance, eight-phone full-round, 60-minute soak, and controlled load budgets pass.
- [ ] No P0, P1, or P2 issue remains open.

### Deployment readiness

- [ ] Backend is deployed and verified before the Hostinger frontend.
- [ ] `/health` commit and `/ready` Redis durability are correct.
- [ ] Previous Render commit and Hostinger artifact are available for rollback.
- [ ] Beta production smoke passes before capability changes to `public`.
- [ ] Post-release monitoring is privacy-safe and rollback ownership is explicit.

Party / TV Mode is MVP-complete only when every checkbox is satisfied and the evidence is attached to the release commit.
