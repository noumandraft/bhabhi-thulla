# Party / TV Mode: backend and realtime protocol

Status: implementation plan for the MVP. This document is intentionally additive: the existing Online Mode and its Socket.IO events must continue to work unchanged.

## 1. Goal and boundaries

Party Mode uses one shared laptop/TV as a public board and each player's phone as their private controller.

The MVP supports:

- one public board per Party room;
- three to eight active seats using the current game rules and anticlockwise seat order, with at least one human phone and optional host-managed bots;
- a room code and QR join link shown by the board;
- private hands and actions on phones;
- public table state, trick resolution, timers, reactions, scores, and connection state on the board;
- board and player reconnection through separate credentials;
- Redis persistence with the current six-hour room TTL;
- late phone joins using the existing "wait for next round" behavior.

The MVP does **not** add accounts, public matchmaking, remote board administration, multiple simultaneous boards, voice chat, spectators, board-side game actions, or board-token recovery. Those are deferred in section 13.

## 2. Non-negotiable invariants

1. The board never receives a hand, legal card IDs, player tokens, token hashes, socket IDs, or private text chat.
2. Redaction happens on the server. Hiding data in React or CSS is not a security boundary.
3. The board is a display role, not a player seat. It never counts toward the three-player minimum and cannot start, play, take cards, change settings, kick players, or reset the session.
4. The first phone player to join a new Party room becomes the player host. Existing host transfer behavior continues when that phone disconnects.
5. A board disconnect never pauses a turn. Phones may continue the match and the board may reconnect later.
6. Online rooms retain their current create/join/reconnect behavior and private `RoomView` projection.
7. A room code is a join code, not a secret. The board credential is a separate high-entropy secret and never appears in the QR URL.

## 3. Additive shared protocol types

Add the following types to `shared/game.ts`. Keep `PROTOCOL_VERSION` at `2.0.0` for this additive rollout; advertise support through a capability instead of forcing old clients offline.

```ts
export type RoomMode = 'online' | 'party'

export type PartyAvailability = 'off' | 'beta' | 'public'

export type ServerCapability =
  | 'chat-v1'
  | 'party-v1'

export interface ServerHello {
  protocolVersion: typeof PROTOCOL_VERSION
  capabilities?: ServerCapability[]
  partyMode?: PartyAvailability
  serverNow?: number
}

export interface PartyBoardCreateRequest {
  requestId: string
  boardToken: string
}

export interface PartyBoardCredentials {
  code: string
  boardToken: string
}

export interface PartyBoardPlayerView {
  id: string
  name: string
  cardCount: number
  connected: boolean
  escaped: boolean
  isHost: boolean
  ready: boolean
  isBot: boolean
  rematchReady: boolean
  waitingForNextRound: boolean
  joinedInRound: number
  reconnecting: boolean
  reconnectEndsAt: number | null
}

export interface PartyBoardActivityView {
  id: string
  text: string
  tone: ActivityItem['tone']
  kind?: ActivityItem['kind']
  data?: {
    playerId?: string
    targetId?: string
    winnerId?: string
    thullaPlayerId?: string
    openerId?: string
    loserId?: string
    cardCount?: number
    joinedInRound?: number
  }
}

export interface PartyBoardGameView {
  phase: GamePhase
  trick: TrickCardView[]
  resolvedTrick: ResolvedTrickView | null
  resolutionEndsAt: number | null
  pendingTurnId: string | null
  leadSuit: Suit | null
  currentTurnId: string | null
  leaderId: string | null
  firstTrick: boolean
  wasteCount: number
  loserId: string | null
  turnEndsAt: number | null
  reconnectPlayerId: string | null
  reconnectEndsAt: number | null
  activity: PartyBoardActivityView[]
}

export interface PartyBoardView {
  protocolVersion: typeof PROTOCOL_VERSION
  revision: number
  serverNow: number
  mode: 'party'
  code: string
  status: 'lobby' | 'playing' | 'finished'
  minPlayers: number
  maxPlayers: number
  settings: RoomSettings
  session: SessionView
  players: PartyBoardPlayerView[]
  game: PartyBoardGameView | null
}
```

Make these additive fields available on the existing player view:

```ts
export interface RoomView {
  // existing fields...
  revision: number
  serverNow: number
  mode: RoomMode
  partyBoardConnected: boolean
}
```

`partyBoardConnected` is always `false` for Online rooms. It lets phone clients display a small "Board disconnected; game continues" notice without revealing board credentials.

`revision` is the room's persisted monotonic public-state revision. Increment it exactly once inside the authoritative `changed()` path before persistence/publication, and include the same value in every personalized phone projection and the board projection. Clients ignore a lower revision for the same room. Existing player actions remain server-validated by phase, turn, ownership, and card legality; the MVP does not add a client-supplied revision to every action payload.

`serverNow` is generated when each view is built and is never persisted. Clients estimate `serverNow - Date.now()` from the lowest-latency recent samples and compute all absolute-deadline countdowns against that offset. This aligns the three-second reveal and turn/reconnect clocks without announcing every tick.

Do not define `PartyBoardView` by omitting fields from `RoomView` at runtime. Its type can reuse leaf types, but `GameManager.boardView()` must construct the object from an explicit allowlist. This prevents a future private `RoomView` field from accidentally leaking to the board.

## 4. Internal room model

Extend the internal models in `server/game.ts`:

```ts
export interface PartyBoard {
  tokenHash: string
  creationRequestHash: string | null
  creationRequestExpiresAt: number | null
  socketId: string | null
  connected: boolean
}

export interface Room {
  // existing fields...
  revision: number
  mode: RoomMode
  partyBoard: PartyBoard | null
}
```

Rules:

- `room:create` creates `{ mode: 'online', partyBoard: null }` exactly as today.
- `party:board:create` creates `{ mode: 'party', partyBoard }` with zero players and an empty score list.
- A Party room has exactly one board credential in the MVP.
- Before create, the board browser generates a 32-byte token with Web Crypto and a UUID request ID and stores the pending pair locally. Do not fall back to `Math.random()` when secure randomness is unavailable.
- The server strictly validates the token/request ID, stores only SHA-256 verifier hashes, and uses timing-safe token comparison. The raw board token must never enter logs, Redis, URLs, or board state.
- A repeated create carrying the same request ID and token is idempotent during the ten-minute recovery window: it rebinds/returns the original room instead of creating a duplicate. The request verifier and absolute expiry survive Redis restore; expired request verifiers are cleared.
- Maintain an in-memory `creationRequestHash -> room code` index for O(1) retry lookup and rebuild it from unexpired persisted verifiers during initialization. Verify the board-token hash as well as the request hash before revealing/rebinding the room.
- `PartyBoard.socketId` and `PartyBoard.connected` describe transport presence, not game participation.
- `Room.revision` starts at zero for new/legacy rooms, is persisted, and advances only through the authoritative change path.
- `activePlayers`, dealing, turn order, readiness, scoring, and the three-to-eight active-seat limits continue to operate only on `room.players`. Existing bots count as seats but never receive credentials; at least one connected human phone is required and only the player host may add/remove bots.

Add focused manager methods rather than branching throughout card-rule code:

```ts
createPartyRoom(request: PartyBoardCreateRequest, socketId: string, allowFresh = true): {
  room: Room
  credentials: PartyBoardCredentials
  replacedSocketId: string | null
}

reconnectPartyBoard(code: unknown, token: unknown, socketId: string): {
  room: Room
  credentials: PartyBoardCredentials
  replacedSocketId: string | null
}

socketOwnsPartyBoard(roomCode: unknown, socketId: string): boolean
disconnectPartyBoard(socketId: string): Room[]
boardView(room: Room): PartyBoardView
```

The socket layer passes `allowFresh = partyMode !== 'off'`. The manager checks an exact, unexpired idempotent retry before applying that flag, so switching availability to `off` blocks new rooms without breaking recovery of a create acknowledgement that was already issued.

`joinRoom()` remains the phone entry point for both modes. When joining a Party room with no existing human player, create the player with `isHost: true`; later players are not hosts. Online-room host selection remains unchanged.

## 5. Socket.IO event contract

All acknowledgements retain the existing `Ack<T>` envelope. Unknown fields are rejected through `recordPayload()`.

### Server hello

```ts
server:hello -> {
  protocolVersion: '2.0.0',
  capabilities: ['chat-v1', 'party-v1'],
  partyMode: 'beta',
  serverNow: 1786680000000
}
```

`party-v1` means the server understands this protocol. `partyMode` is the independently configurable availability state:

- `off`: hide Party discovery and reject fresh board creation, while saved board/player reconnect routes and direct joins to already-existing Party rooms remain usable so healthy matches can finish;
- `beta`: hide the normal landing option but permit `/?partyBeta=1` to reveal the Party entry for production smoke testing. This is a **hidden preview**, not private access: the query is not an authorization credential and a client can call the beta-capable create event directly;
- `public`: show the normal Party / TV Mode option.

Read the value from `PARTY_MODE`; missing or invalid values fail closed to `off`. The frontend shows fresh-create/discovery UI only when it sees `party-v1` plus `beta`/`public` availability, but role restoration and existing-room join/controller routes remain enabled whenever `party-v1` is present—even in `off`. This supports deploying the backend before the static frontend and disabling only new Party rooms without stranding healthy matches.

### New client-to-server events

| Event | Payload | Ack data | Authorization and behavior |
|---|---|---|---|
| `party:board:create` | `{ requestId, boardToken }` | `PartyBoardCredentials` | A fresh request requires `beta`/`public` availability plus an unbound socket and creates an empty Party lobby. An exact in-window retry may recover/rebind the original room even after availability changes to `off`. If a different board socket still owns that room, reuse reconnect's last-valid-credential-wins fencing: clear/notify the old socket with `party:board:replaced` before publishing to the replacement. Validate both high-entropy values before lookup, apply the existing room-create IP rate limit, and never log the payload. |
| `party:board:reconnect` | `{ code, boardToken }` | `PartyBoardCredentials` | Unbound socket only. Validates the hash, binds the new board socket, and publishes current state. Apply the existing reconnect IP rate limit. |

No board-side start/settings/play events are added. Player phones continue to use:

- `room:join`, `room:reconnect`, `room:ready`, `room:leave`;
- `room:settings`, `room:kick`, bot controls;
- `game:start`, `game:play`, `game:take-right`, rematch and session controls;
- chat and reaction events.

### New server-to-client events

| Event | Payload | Recipient |
|---|---|---|
| `party:board:state` | `PartyBoardView` | The currently authenticated board socket only. |
| `party:board:replaced` | `{ code }` | The formerly bound board socket when the same board credential reconnects elsewhere. |
| `party:board:expired` | `{ code }` | A connected board whose room is deleted after the normal six-hour idle TTL. |

The board may receive the existing public `room:reaction` event so reactions can animate on the TV. It must never receive `room:state`, `room:chat:message`, or chat history.

### Payload examples

```ts
// Create board
const pending = {
  requestId: crypto.randomUUID(),
  boardToken: base64Url(crypto.getRandomValues(new Uint8Array(32))),
}
persistPendingBoardCreate(pending)
socket.emit('party:board:create', pending, ack)

// Reconnect board
socket.emit('party:board:reconnect', {
  code: '8MQA3',
  boardToken: '<43-character base64url token>',
}, ack)

// Phones use the normal join event from the QR destination
socket.emit('room:join', { code: '8MQA3', name: 'Nouman' }, ack)
```

On success, replace the pending local record with `{ code, boardToken }`. If the acknowledgement or socket is lost, retry the identical pending pair; do not generate a new pair until the server returns a terminal error or the recovery window has expired. A matching retry requires both verifier hashes, so possession of a request ID alone cannot attach to the board. A retry from a second socket replaces/fences the original board exactly like credentialed reconnect. Return the same generic saved-board error for mismatched/expired recovery attempts.

The frontend constructs a join URL such as `https://thulla.joypad.fun/?room=8MQA3&mode=party`. Only the room code and non-secret mode hint are placed in the URL and QR code. Never put `boardToken` or a player token in a URL, analytics event, log, or error message.

## 6. Socket roles and authorization

Bind every participating socket to one mutually exclusive role:

```ts
socket.data.connectionRole = 'player' | 'board'
socket.data.roomCode = room.code
socket.data.playerId = player.id // player role only
```

Replace `requireUnseated()` at the transport boundary with `requireUnbound()` for fresh create/join/reconnect operations. It must reject any socket already bound as either a player or a board. The board-create handler first recognizes an exact, unexpired idempotent retry: the already-bound original socket may receive the lost acknowledgement again, and an unbound replacement socket may recover the same room after both hashes verify. Every other create path calls `requireUnbound()`. Keep `requireSeat()` for every player action and add `requireBoard()` only for future board-specific actions; the MVP create/reconnect handlers do not need a post-bind action.

This produces defense in depth:

- board sockets fail all existing player actions because they do not own a seat;
- player sockets cannot attach as boards without first leaving/disconnecting;
- a guessed room code cannot authenticate a board;
- reconnecting a board on a new socket replaces the previous board binding ("last valid credential wins");
- the replaced socket receives `party:board:replaced`, has its role data cleared, leaves the Socket.IO room, and stops receiving updates.

Use the existing explicit production CORS allowlist, 32 KiB Socket.IO buffer, global socket limiter, input length limits, and IP connection cap. Count a board as one ordinary network connection, but never as a player.

Phase 1 also replaces sensitive structured-log fields in Party and existing room paths. Rate limiting may keep normalized IPs in memory, but production logs must not contain IP addresses, room codes, player names, socket IDs, chat text, card/hand data, request IDs, or reconnect/board credentials. Log an event name, safe error category, build version, and a process-local random correlation ID where diagnosis needs grouping. Add console-capture tests that exercise success and failure paths and reject those values in serialized log arguments.

## 7. Public board projection and redaction

Implement `GameManager.boardView(room)` independently from `view(room, viewerId)`.

Allowed public card data:

- cards already played in `game.trick`;
- cards in `game.resolvedTrick` during the existing three-second reveal.

Forbidden data at every phase, including lobby and finished state:

- `Player.hand` and any card IDs derived from it;
- `legalCardIds`;
- `canTakeRightHand` and `takeTargetId` (phone-only action affordances);
- `tokenHash`, raw tokens, `socketId`, and `usesReadyProtocol`;
- waste card identities, pending waste card identities, or the undealt deck;
- chat messages, chat dedupe data, or chat history;
- board credentials, board token hash, create request ID/hash, or recovery expiry.

The implementation should manually map `room.players`, `room.game.trick`, `room.game.resolvedTrick`, and the explicitly allowlisted `PartyBoardActivityView` fields, just as the current player view resolves public player names. Drop `cardId` and every unknown activity-data key rather than forwarding the generic internal `ActivityItem.data` record. Do not serialize `room`, spread an internal `Player`, or derive the board object using `JSON.stringify(room)` followed by deletions.

Add a regression helper in tests that recursively scans the board projection. It should fail on forbidden keys (`hand`, `legalCardIds`, `token`, `tokenHash`, `requestId`, `creationRequestHash`, `creationRequestExpiresAt`, `socketId`, `usesReadyProtocol`, `pendingWasteCards`, `waste`, `cardId`) and should also prove that every unplayed card ID from every hand is absent from the encoded board state.

## 8. Broadcast behavior

Refactor the current `broadcast(room)` into a role-aware publisher:

1. For each connected player with a socket ID, emit personalized `room:state` from `manager.view(room, player.id)`.
2. If `room.mode === 'party'` and its board is connected, emit one `party:board:state` from `manager.boardView(room)`.

Continue direct per-socket emission. Joining the Socket.IO room is useful for cleanup and diagnostics but must not tempt implementation into broadcasting one private `RoomView` to all sockets.

Reaction delivery may include the authenticated Party board. Text-chat delivery remains player-only. The current `GameManager.changed()` path remains the single source for revision increment, persistence, scheduling, and state publication, so every join, ready change, deal, play, THULLA resolution, reconnect, and finish automatically updates both projections with one common revision. `serverNow` is sampled separately as each projection is built.

## 9. Lifecycle and reconnection

### Board creation and lobby

1. Board securely generates and stores pending `{ requestId, boardToken }`, creates the Party room idempotently, then replaces the pending record with `{ code, boardToken }` under a board-specific storage key.
2. The server emits an empty `party:board:state`; the UI shows code and QR.
3. First phone joins via normal `room:join` and becomes host.
4. More phones join and mark ready.
5. The phone host controls settings/bots and starts when at least three active seats are ready, including at least one connected human phone.

### During play

- The board observes public state only.
- Phones receive the same private `RoomView` and use the same game actions as Online Mode.
- A phone disconnect follows the existing 60-second active-turn reconnect grace behavior.
- A board disconnect sets `partyBoard.connected = false`, clears its socket ID, publishes `partyBoardConnected: false` to phones, and does **not** change `GameState.phase`, timers, host ownership, or `room.suspended`.
- Board reconnection republishes the latest public state. It must not resume or alter a suspended restored match; only an eligible player reconnect currently resumes match timers.
- A second valid board reconnection replaces the first board connection without duplicating state delivery.

### Late joins and rematches

The current behavior is reused: a phone joining during play has an empty hand, `waitingForNextRound: true`, and `joinedInRound = currentRound + 1`. It becomes eligible after accepting the rematch and the host starts the next round. The board simply displays that waiting seat.

### Empty rooms and cleanup

- Online rooms retain their current immediate deletion behavior when the last human leaves outside a match.
- An empty Party room is retained for the normal six-hour idle TTL so a temporarily disconnected board can reconnect and show its QR again.
- Board presence alone never refreshes `updatedAt` or makes a lobby immortal. After the TTL, `removeStaleRooms()` deletes a Party room when no human phone is connected. If the board is still connected, capture its socket, clear `connectionRole`/`roomCode`, leave the Socket.IO room, then emit `party:board:expired` directly before deletion. The same now-unbound socket can immediately run the create-new-room action.
- The existing Redis TTL remains the ultimate cleanup guard.
- Explicit "close this Party room now" and board-token rotation are deferred; the UI can forget its local board credential without altering the server room.

## 10. Redis persistence and restart behavior

Update `persistenceSnapshot()` in `server/store.ts` to persist a transport-safe Party board:

```ts
function persistedPartyBoard(board: PartyBoard | null) {
  if (!board) return null
  const requestActive = Boolean(
    board.creationRequestHash
    && board.creationRequestExpiresAt
    && board.creationRequestExpiresAt > Date.now(),
  )
  return {
    tokenHash: board.tokenHash,
    creationRequestHash: requestActive ? board.creationRequestHash : null,
    creationRequestExpiresAt: requestActive ? board.creationRequestExpiresAt : null,
  }
}
```

Persist `Room.revision` and the verifier hashes, but never the board socket ID, connected presence, request ID, raw token, or any player credential. The snapshot continues to omit `room.suspended` and Table Talk content. No new Redis key family is required: Party rooms remain under `${REDIS_KEY_PREFIX}${room.code}` with the current 21,600-second TTL.

On `GameManager.initialize()`:

- missing `room.mode` becomes `'online'`;
- missing `room.partyBoard` becomes `null`;
- Online rooms always normalize `partyBoard` to `null`;
- a valid Party board restores with `socketId: null` and `connected: false`, retaining only an unexpired creation-request verifier;
- an invalid persisted Party record without a plausible SHA-256 token hash is ignored rather than exposed as an unauthenticated board;
- missing/invalid `revision` normalizes to zero;
- existing player normalization, suspended playing-room behavior, absolute resolution/reconnect deadlines, chat epoch reset, and timer rules remain unchanged. An ordinary turn follows the current policy: after a restart the room is suspended and receives a fresh configured turn deadline only when an eligible player reconnects; the three-second resolution and reconnect-grace deadlines are never extended.

Board credential persistence means the same board browser can reconnect after a Render restart. If its local token is lost, the MVP recovery path is to create a new Party room.

## 11. Compatibility and staged rollout

This feature is additive and does not require a protocol-version bump:

- old servers omit `party-v1`, so new clients hide Party Mode;
- old clients ignore the extra hello capability, `partyMode`, and additive `RoomView` fields;
- old persisted rooms normalize to `mode: 'online'`;
- `room:create`, `room:join`, `room:reconnect`, and all game events keep their current payloads;
- an older phone client can still join a Party room through the standard room code and play safely, though it will render its existing full phone game table instead of the optimized controller UI;
- Online Mode never creates or authenticates a board.

Deployment order:

1. deploy backend support with `PARTY_MODE=beta` and verify `/health`, `/ready`, capability/availability advertisement, persistence migration, and Online Mode regression tests;
2. deploy the static frontend, which keeps the normal Party option hidden in beta;
3. use the explicit beta entry to smoke-test one real board plus three phones;
4. change `PARTY_MODE` to `public` only after the smoke test passes;
5. set `PARTY_MODE=off` to stop new Party rooms without removing the additive capability or affecting Online Mode.

## 12. Implementation map and test matrix

### Likely production files

| File | Bounded change |
|---|---|
| `shared/game.ts` | Add room/availability types, Party credentials/views, `party-v1`, and two additive player-view fields. |
| `server/game.ts` | Add Party board model, create/reconnect/disconnect helpers, first-phone host rule, `boardView()`, restore normalization, cleanup rule, and board-aware room changes. Card rules remain untouched. |
| `server/index.ts` | Parse fail-closed `PARTY_MODE`, advertise availability/time, add role binding, two board events, idempotent create/recovery, replacement handling, role-aware state/reaction broadcast, validation/rate limits, and sanitized logs. |
| `server/store.ts` | Strip board transport fields, persist only verifier hashes/recovery expiry/revision, and validate/restore the additive room shape. |
| `src/protocol.ts` | Export client aliases for Party board/player views. |
| `src/socket.ts` | Continue using `emitWithAck`; no transport abstraction rewrite is required. |
| `src/App.tsx` and new Party components | Capability gate, Party entry flow, credential storage, QR lobby, board/controller routing, and reconnection. |
| `src/styles.css` | Large-screen board and compact phone-controller layouts. |

Prefer extracting new UI components rather than adding every Party branch to `App.tsx`, for example `src/components/party/PartyModeEntry.tsx`, `PartyBoard.tsx`, `PartyController.tsx`, and `PartyJoinQr.tsx`.

### Unit tests (`server/game.test.ts`)

- Party creation validates/echoes the browser-generated high-entropy board token, returns a five-character code, creates no player, and has an empty session.
- Online creation is unchanged and sets `mode: 'online'`.
- First Party phone becomes host; second does not; the board never counts toward start eligibility.
- Three ready phones can start and receive all 52 cards; the board receives none.
- One human host plus two bots can start when bots are allowed; bots count toward capacity but have no socket, credential, or controller view.
- `boardView()` exposes current/resolved trick cards but no private fields or unplayed card IDs.
- Board disconnect leaves the game phase, current turn, deadline, and player host unchanged.
- Valid board reconnect works; invalid code/token fails with a generic saved-board error.
- A second board reconnect replaces the previous socket ID.
- Late join, rematch, score reset, host transfer, bots, THULLA, take-right, and finish work in a Party room using their existing manager paths.
- Online room views remain byte-for-byte equivalent except for the documented additive revision/time/mode/presence fields.

### Persistence tests (`server/store.test.ts`, `server/redis-store.test.ts`)

- Snapshot contains `mode: 'party'`, `revision`, the board-token hash, and only an unexpired creation-request hash/deadline, but no raw values, board/player socket ID, or connected board presence.
- Redis round-trip retains the existing prefix and six-hour TTL.
- Restored Party board is disconnected and can authenticate with the original raw token.
- Reconnecting only the board does not unsuspend a restored playing match or start a timer.
- A legacy snapshot without `mode`/`partyBoard` restores as Online Mode.
- Malformed Party-board persistence is ignored safely.
- Existing "persistence failures do not break live rooms" behavior covers Party-room writes and deletes.

### Socket tests (`server/index.test.ts`)

- Hello advertises `party-v1` and the normalized `partyMode`; missing/invalid configuration reports `off`.
- Hello and every view expose `serverNow`; board and phone views from the same change expose the same persisted `revision`.
- Board create/reconnect reject unknown fields, malformed codes/tokens, rate-limit abuse, and already-bound sockets except the exact same-socket create-ack recovery case.
- A lost create acknowledgement retried with the same pending request/token returns one room; a mismatched or expired retry creates no unauthorized attachment and returns a generic error.
- A board cannot invoke `game:start`, `game:play`, settings, chat history, or any seat action.
- A player cannot attach as a board on the same socket.
- Board receives `party:board:state`, never `room:state` or `room:chat:message`.
- Players receive personalized `room:state`, never `party:board:state`.
- Board replacement clears the prior socket binding and sends `party:board:replaced`.
- A connected but otherwise idle empty board room expires at six hours, emits `party:board:expired`, and is removed from memory/Redis.
- Expiry clears the board socket's role/room binding; the offered create-new-room action succeeds on that same connection.
- Disconnect decrements the existing per-IP connection count and updates only board presence.
- Captured success/error logs contain none of the forbidden identifiers, payloads, or credentials.

### End-to-end Socket.IO test (`server/multiplayer.integration.test.ts`)

Run one board and three phones through:

1. Party room creation;
2. first-phone host assignment and ready flow;
3. deal and at least one manual card play;
4. assertion that each phone sees only its own hand and the board sees no hand;
5. a completed clean trick and a THULLA resolution held for three seconds;
6. phone reconnect with its existing grace period;
7. board disconnect while the match continues, then board reconnect to current state;
8. a fourth phone joining mid-round and entering the next round;
9. finish, rematch, score preservation, and room expiry/cleanup.

Keep the existing Online Mode integration test unchanged as the primary regression guard.

### MVP acceptance criteria

- One desktop/TV and three real phones can complete a round without refreshing.
- The QR join flow never exposes a credential other than the room code.
- Captured board traffic contains no hand or legal-card data.
- Killing and restarting the backend preserves the room in Redis; phones and board reconnect with their own tokens.
- Dropping the board connection does not pause or corrupt the game.
- Existing Online Mode tests and live smoke checks still pass.
- The board and every phone can reconnect independently without creating duplicate seats.

## 13. Deferred work

Keep these out of the MVP unless a later product decision explicitly adds them:

- multiple synchronized boards or spectator screens;
- a phone-host action to rotate/replace a lost board credential;
- account-based ownership or recovery;
- board-side start, settings, moderation, or rematch controls;
- display of private Table Talk on the shared board;
- public room discovery or matchmaking;
- cross-room score history and analytics;
- local-network peer-to-peer transport;
- cast-specific integrations for Chromecast, AirPlay, or smart-TV app stores.
