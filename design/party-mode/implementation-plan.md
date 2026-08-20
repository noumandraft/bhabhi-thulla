# Bhabhi Thulla Party / TV Mode Implementation Plan

Status: local MVP implementation and Phase 5 experience polish are complete. The additive Phase 6 production rollout remains intentionally deferred.

Supporting documents:

- [Protocol and security plan](./protocol.md)
- [Responsive UX wireframes](./wireframes.md)
- [QA and rollout plan](./qa-rollout.md)
- [Visual concept](./party-mode-concept.png)

The concept image communicates visual direction only. The protocol, Pakistani game rules, state copy, and responsive behavior in the written specifications are authoritative.

## 1. Product definition

Party Mode adds a second way to play without changing the existing Online Mode.

- **Online Mode:** every player sees the full table and their private hand on their own device.
- **Party / TV Mode:** one shared screen shows the public table while each player uses a phone as a private controller.

The shared board is a display, not a player. It never receives a private hand, legal-card IDs, player credentials, private chat history, or player-only actions.

### Fixed MVP decisions

1. The board creates the Party room and receives a separate board credential.
2. The QR code contains only the normal player join URL and room code. It never contains the board token.
3. The first phone that joins becomes the player host. Host controls stay on that phone.
4. The board is display-only except for local actions such as fullscreen, showing the QR code, language, sound, and leaving the display.
5. The board does not count toward the 3–8 player limit and is never included in dealing, turns, scores, or host transfer.
6. The same Pakistani rules engine, timers, late-join behavior, bots, scores, chat, reactions, and Redis persistence remain authoritative. Party rooms require at least one human phone; host-managed bots count toward the existing 3–8 active-seat limit and never receive controller credentials.
7. Text chat stays on phones. The board may show safe quick reactions and public match events.
8. A board disconnect does not stop or mutate the game. Phones retain enough turn/trick status to continue, while the host sees a board-disconnected warning.
9. One active board connection is supported per Party room in the MVP.
10. Technical support is advertised through the additive `party-v1` server capability. A separate `partyMode: 'off' | 'beta' | 'public'` hello field controls exposure, so the current production client remains compatible and rollout can be reversed without a frontend rebuild.

## 2. Primary user journeys

### Create a Party room

1. Choose **Party / TV Mode** on the landing page.
2. Choose **Open the board on this screen**.
3. The board securely generates and locally stores a pending request ID plus 32-byte board secret, then asks the server to create the empty Party room idempotently.
4. The server validates and hashes the secret, returns the code, and the board replaces the pending record with its saved board credential. It changes the URL to `?board=ABCDE` and shows a large QR code plus the five-character fallback code.
5. Players scan the QR code and arrive at `?room=ABCDE&mode=party`.
6. The first joined phone becomes host; every phone enters its name and marks ready.
7. The host configures the table and starts the round from their phone.

### Play a Party round

1. The board shows public seats, card counts, current trick, waste, direction, timer, resolution, and score.
2. Each phone shows a compact public status area plus only that player's private cards and available actions.
3. A phone submits `game:play` or `game:take-right` through the existing authenticated player-seat flow.
4. The server updates the room once, publishes personalized player views to phones, and publishes a separately generated redacted board view.
5. The board animates the public result, including the full three-second THULLA/completed-trick reveal.

### Finish and rematch

1. The board presents the Bhabhi result and shared scoreboard.
2. Phones present Ready/Play Again controls and host-only management actions.
3. Late players remain queued for the next round using the existing behavior.
4. The next round begins only after the normal readiness requirements are satisfied.

## 3. Architecture

### Shared models

Add the following additive types in `shared/game.ts`:

- `RoomMode = 'online' | 'party'`
- `PartyAvailability = 'off' | 'beta' | 'public'`
- `PartyBoardCreateRequest`
- `PartyBoardCredentials`
- `PartyBoardView`
- `PartyBoardGameView`
- `party-v1` in `ServerCapability`

`PartyBoardView` must be defined independently. It must not be produced by taking a normal `RoomView` and deleting fields afterward.

### Server domain

Extend persisted rooms with:

- `mode`
- `partyBoard`, containing the board token hash plus transient socket/presence fields
- a monotonic public-state `revision`

Legacy rooms normalize to `mode: 'online'`, `partyBoard: null`, and `revision: 0` when restored. Redis stores the board-token verifier, revision, and only a still-valid create-recovery verifier/deadline; raw request/token values, board socket IDs, and live connection state never persist.

Add domain operations for:

- creating an empty Party room;
- timing-safe board authentication;
- idempotent recovery when the create acknowledgement is lost;
- producing a redacted board view;
- retaining an empty Party lobby while its authenticated board is active;
- reconnecting a board without resuming suspended player timers.

Read `PARTY_MODE` from the server environment, normalize missing or invalid values to `off`, and include the resulting availability in `server:hello`. `off` prevents fresh Party-board creation/discovery while saved roles and direct joins to existing Party rooms remain usable; `beta` permits `/?partyBeta=1` to reveal a hidden preview but keeps the normal landing option hidden; `public` exposes the standard Party Mode option. Beta is not private access—the query controls discovery only and is never treated as authorization.

Board socket IDs remain in memory and never enter Redis snapshots.

Every authoritative `changed()` call increments `revision` exactly once before persistence/publication. Board and personalized phone views carry that revision plus a non-persisted `serverNow` sample; clients reject lower revisions and use recent clock-offset samples for aligned deadline displays.

Phase 1 also sanitizes production logs. Rate limits may keep IPs in memory, but logs must not contain IPs, room codes, names, socket IDs, chat/card data, request IDs, or any raw/hash credential.

### Socket protocol

Add the following MVP events without changing existing player events:

- client to server: `party:board:create` with the pending request ID and client-generated board token
- client to server: `party:board:reconnect`
- server to board: `party:board:state`
- server to the replaced board connection: `party:board:replaced`
- server to an idle board whose room reached the six-hour TTL: `party:board:expired`

A socket is assigned exactly one role: unassigned, player, or board. Board sockets cannot invoke player join/create/gameplay/chat mutations. Player sockets cannot authenticate as the board without disconnecting first.

### Frontend modes

Introduce an explicit application role:

- landing/entry;
- seated online player;
- seated Party controller;
- Party board.

Suggested URL shapes:

- Party join: `/?room=ABCDE&mode=party`
- Restorable board: `/?board=ABCDE`

Store the pending create pair before emitting, then store the successful board credential under a board-specific local-storage key. Retry the same pending pair after a lost acknowledgement so the server returns the same room. Never place its token or create request ID in a URL, QR code, analytics event, error message, or log.

## 4. Frontend component strategy

The existing `GameTable` combines public table state and private controller state. Refactor it in a behavior-preserving commit before adding Party screens.

Suggested reusable pieces:

- `PlayingCard`
- `PlayerSeats`
- `TrickArea`
- `TurnStatus`
- `TableSurface`
- `ControllerHand`
- `RoundSummary`

Composition after the refactor:

- Online Mode: `TableSurface` + `ControllerHand`
- Party Board: `TableSurface` only, using `PartyBoardView`
- Party Controller: compact `TurnStatus` + `ControllerHand`

Suggested new entry components:

- `PlayModeChooser`
- `PartyModeEntry`
- `PartyBoardLobby`
- `PartyBoard`
- `PartyController`
- `useBoardConnection`

The refactor must preserve current selectors used by visual QA until replacement coverage exists.

## 5. Interaction and visual rules

### Shared board

- Optimized for landscape displays at 1280×720, 1366×768, 1920×1080, and 1024×600.
- Reserve roughly 4vw around essential information for TV overscan.
- Use large names, card counts, timer digits, QR code, and status text that remain readable across a room.
- Keep the current felt-green, ivory, gold, and restrained THULLA-red design language.
- Use lightweight CSS transforms/opacity for card motion rather than performance-heavy 3D/WebGL.
- Fullscreen and Wake Lock are progressive enhancements; clear recovery copy must exist when either API is unavailable.
- QR always has a visible five-character room-code fallback.

### Phone controller

- Portrait-first at 320–430px, with landscape support.
- Show private hand, current turn, led suit, timer, current public trick summary, and player actions.
- Keep the fixed action bar above the safe-area inset and reserve matching content space underneath.
- Every target is at least 44×44px with at least 8px between adjacent actions.
- Inputs stay at 16px or larger; no page-level horizontal overflow.
- Cards may scroll horizontally, but the first-use swipe hint and a non-gesture alternative remain available.

### Accessibility

- Preserve English, Roman Urdu, and Urdu/RTL support.
- Room codes remain left-to-right in every language.
- Board state changes use concise live announcements, not per-second timer announcements.
- QR has descriptive text and the visible code alternative.
- Focus order follows visual order, with explicit focus placement after mode changes and reconnects.
- Color never acts as the only ready, turn, legal-card, connection, or error signal.
- All motion respects `prefers-reduced-motion`.

## 6. Delivery phases

### Phase 0 — Baseline and safety harness

- Capture current unit, integration, platform, and visual-QA baselines.
- Add Party fixtures and redaction assertions before UI implementation.
- Document the exact public/private field boundary.

Gate: existing Online Mode tests remain green and Party board privacy tests fail for the expected missing implementation.

### Phase 1 — Server and persistence foundation

- Add shared Party types and `party-v1` capability.
- Add the fail-closed `PARTY_MODE=off|beta|public` availability switch.
- Implement idempotent Party-room creation, board token hashing, authentication, revision/time metadata, and redacted state.
- Persist only the room mode, revision, credential verifier, and unexpired create-recovery verifier/deadline.
- Sanitize existing and Party-path production logs and add forbidden-value log tests.
- Add board role tracking and broadcasts.
- Cover legacy Redis restoration and empty-board-lobby retention.

Gate: server tests prove the board cannot receive private state or call player actions.

### Phase 2 — Behavior-preserving game UI extraction

- Extract the public table and private hand components from `GameTable`.
- Keep current Online Mode output and behavior unchanged.
- Update QA selectors only when there is an equivalent or stronger assertion.

Gate: current screenshots and all Online Mode gameplay tests pass without Party UI enabled.

### Phase 3 — Party entry and lobby

- Add progressive mode selection to the landing experience.
- Build board creation, board restoration, QR generation, and connection feedback.
- Build the controller join/lobby view.
- Make the first phone host and keep settings/start controls on that phone.

Gate: one board and three phones can create, join, ready, and start without exposing private data.

### Phase 4 — Live board and controller

- Compose the public board surface from `PartyBoardView`.
- Compose the compact phone controller from personalized `RoomView`.
- Support playing cards, right-hand take, resolving, THULLA, reconnect pauses, queued players, results, rematches, bots, reactions, and Table Talk on phones.

Gate: the full deterministic Pakistani-rules integration scenario passes with one board and three phone clients.

### Phase 5 — Experience polish

- Add fullscreen, Wake Lock, sound preferences, public reactions, restrained card motion, and board-disconnected guidance.
- Complete responsive, RTL, keyboard, screen-reader, reduced-motion, text-zoom, and slow-network QA.

Gate: every target viewport and state is operable with zero blocking collision, clipping, privacy, or reconnect defects.

### Phase 6 — Additive deployment

- Deploy the capability-compatible backend to Render first with `PARTY_MODE=beta`.
- Verify `/health`, `/ready`, Redis persistence, and standard rooms.
- Publish the frontend package to Hostinger.
- Smoke-test Online and beta Party modes in production, then change `PARTY_MODE` to `public` without rebuilding the frontend.

Gate: production passes one real board plus three controllers, and Online Mode remains unaffected.

## 7. MVP acceptance criteria

- A board can create and restore a Party room.
- Retrying a lost board-create acknowledgement returns the same room and never duplicates the lobby.
- Three to eight active seats can join by QR/room code or host-managed bots, with at least one human phone.
- The first phone becomes host and can configure/start the game.
- Every phone receives only its own private hand.
- The board receives no hand, legal-card IDs, player credentials, or private chat history.
- A card played on a phone appears on the board once and in the correct order.
- Board and phone public views converge on one monotonic revision, and deadline displays use server-time offset rather than each device's raw clock.
- Opening trick, clean trick, THULLA, right-hand take, escape, timeout, and result behavior match Online Mode.
- Completed trick/THULLA cards remain visible for the configured three seconds.
- Phone reconnect and board refresh restore the correct roles and state.
- Late joiners enter the existing next-round queue.
- Board disconnect does not corrupt or silently restart the match.
- A board-only idle lobby expires after six hours even if its display socket remains open, and the board offers one clear create-new-room recovery action.
- Online Mode continues to pass all existing tests and visual checks.
- Production logs contain no room/player/network identifiers, cards/chat, or credential/request material.
- Board and controller layouts pass the viewport/accessibility matrix in the QA plan.

## 8. Deferred beyond MVP

- Multiple simultaneous display boards or public spectator links
- Casting protocols or native TV/mobile applications
- Host-driven board-token rotation and board transfer
- Custom drag-and-drop seating
- Voice/video chat
- Public text chat on the shared screen
- Advanced 3D/WebGL card physics
- Tournament brackets, public matchmaking, accounts, or monetization

## 9. Recommended first implementation slice

Build one end-to-end path before expanding states:

1. Board creates a Party room.
2. Three phones join; the first becomes host.
3. Host starts the round.
4. Each phone receives a private hand.
5. The opening player submits one legal card.
6. The board receives and renders the public card once.
7. Board and one phone reconnect successfully.

Only after this slice is reliable should THULLA effects, chat/reactions, rematch polish, and secondary board controls be layered on top.
