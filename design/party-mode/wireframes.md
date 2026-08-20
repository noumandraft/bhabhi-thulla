# Bhabhi Thulla Party / TV Mode — Responsive UX Wireframes

Status: implementation-ready UX specification

Format: text wireframes only; no production code

Surfaces: shared TV/board, player phone, ordinary desktop/mobile landing page

## 1. Experience definition

Party Mode turns one large screen into the shared card table and each player's phone into a private hand controller.

- The **board** shows only public information: room code, player names, connection state, card counts, current trick, waste, turn, direction, round resolution and results.
- A **player phone** shows that player's private cards and allowed actions, plus enough public context to act without repeatedly looking down and up.
- The board must never receive or render private hands, private legal-card identifiers, player reconnection tokens or private composer drafts.
- The current **Online Mode** remains available and visually distinct. Party Mode is a separate choice, not a setting hidden inside an online room.
- Play remains anticlockwise: the next player is the person seated on the current player's right.
- The room supports 3–8 active players. A person joining during an active round waits for the next round.

## 2. Roles and language

Use these terms consistently in UI copy and accessibility labels.

| Term | Meaning | Never call it |
|---|---|---|
| Board | The shared laptop/TV display | Host, player, controller |
| Player phone | A private hand and action controller | Remote, second screen |
| Party host | The first joined phone; controls settings/start/rematch | Board |
| Room code | Five readable characters, e.g. `K7M2Q` | Password |
| Ready | A player has joined and is prepared to begin | Connected |
| Connected | The board/server can currently reach the device | Ready |
| Waiting for next round | A late joiner is in the room but has no cards yet | Spectator |

Core button labels:

- `Play online`
- `Party / TV mode`
- `Open the shared board`
- `Join on this phone`
- `Scan to join`
- `Enter room code`
- `Join party`
- `I'm ready`
- `Start game`
- `Play selected card`
- `Take [name]'s [count] cards`
- `Ready for rematch`
- `Leave party`

## 3. Visual continuity and layout tokens

Party Mode extends the current green felt, dark shell, ivory and gold language. It should feel like the same game viewed from two roles.

### 3.1 Color roles

Use existing semantic tokens where possible.

| Role | Existing reference | Use |
|---|---|---|
| Deep shell | `--game-shell` / `#071713` | Board background, top bars |
| Felt | `--game-felt` / `#0b5140` | Shared table surface |
| Felt deep | `--game-felt-deep` / `#063b31` | Panels on felt, inactive seats |
| Ivory | `--game-ivory` / `#fff8e8` | Cards, phone hand surface, light sheets |
| Gold | `--game-power` / `#e7b649` | Primary emphasis, current turn, room code focus |
| THULLA red | `--game-thulla` / `#c7354e` | THULLA state only, paired with text/icon |
| Success green | Existing success tone | Ready/connected, always paired with label |

Avoid high-gloss 3D scenery and complex shadows. Retain tactile card depth, felt texture and one consistent elevation scale so the public state remains readable from a distance.

### 3.2 Type scale

Board sizes are minimums at a 1920×1080 reference and scale down proportionally for 1366×768.

| Content | TV reference | Phone reference |
|---|---:|---:|
| Room code | 48 px / 700 | 18 px / 800 |
| Primary status | 40–48 px / 800 | 18–20 px / 800 |
| Player name | 26–30 px / 800 | 15–16 px / 800 |
| Player card count | 20–24 px / 700 | 13–14 px / 700 |
| Supporting copy | 22–26 px / 600 | 14–16 px / 600 |
| Timer | 32–40 px tabular | 17–20 px tabular |
| Eyebrow | 18–20 px / 900 | 11–12 px / 900 |

Board body text must never be smaller than 20 px at 1080p or 16 px at 768p. Phone form text and inputs stay at least 16 px to avoid browser zoom.

### 3.3 Spacing, safe regions and touch

- Base spacing rhythm: 4, 8, 12, 16, 24, 32, 48 and 64 px.
- TV overscan-safe inset: 5% of viewport width and height. No critical label, QR code or player state sits outside it.
- Phone content inset: `max(12 px, left/right safe area)` at 320–374 px and `max(16 px, safe area)` at 375–430 px.
- Phone fixed header: 52–56 px plus top safe area.
- Phone fixed action dock: content height 80–104 px plus bottom safe area. Scrolling content reserves the exact dock height.
- Every phone target is at least 48×48 px with at least 8 px between adjacent targets.
- The card hand may scroll horizontally. No other region may cause horizontal page scrolling.
- The board has no required pointer interaction after creation. Fullscreen, sound and leave controls remain keyboard reachable.

## 4. Responsive model

### 4.1 Board classes

| Class | Reference sizes | Layout rule |
|---|---|---|
| TV-wide | 1920×1080, 2560×1440 | Seats wrap around all four table edges; central trick owns the visual center. |
| Laptop/TV | 1366×768, 1440×900 | Same hierarchy, reduced seat cards and QR; no scrolling during play. |
| Short-wide | 1366×600, 1280×720 | Collapse secondary match detail; preserve seats, trick, status and timer. |
| 4:3 board | 1024×768 | Use two side seat rails and a narrower central table. Lobby stacks QR and roster horizontally. |

At normal browser zoom the live board is a single-screen composition and does not require scrolling at any supported board size. At 200% zoom or enlarged system text, switch to an accessibility reflow with one vertical page scroll owner and a concise linear match summary; do not crop or shrink text below the specified minimums merely to preserve the single-screen composition.

### 4.2 Phone classes

| Class | Reference sizes | Layout rule |
|---|---|---|
| Narrow phone | 320×480, 320×568, 320×740 | 12 px gutters; single-column content; compact public trick; one-line primary labels where possible. |
| Standard phone | 360×640, 375×667, 390×844 | 16 px gutters; full status copy; hand cards 62–72 px wide. |
| Large phone | 430×932 | 16–20 px gutters; larger card faces and two-column secondary settings where useful. |
| Phone landscape | 667×375, 740×360, 844×390 | Public context left, private hand/actions right; bottom safe inset remains clear. |

At 200% text zoom, phone screens may become vertically scrollable, but the active card hand and primary action must remain reachable without overlap.

## 5. End-to-end state flow

```text
LANDING
  |
  +-- Play online ------------------------------> EXISTING ONLINE FLOW
  |
  +-- Party / TV mode
        |
        v
     PARTY ENTRY
        |
        +-- Open the shared board
        |      |
        |      v
        |   BOARD CREATING -> BOARD LOBBY -> LIVE BOARD -> RESULTS
        |                           ^             |           |
        |                           |             +-----------+ rematch
        |                           |
        +-- Join on this phone -----+
               |
               v
           PHONE JOIN -> PHONE LOBBY -> CONTROLLER -> RESULTS
                              |             |
                              |             +-- reconnect -> CONTROLLER
                              +-- late join -> WAITING FOR NEXT ROUND
```

Board and phone use the same room code but separate role-specific routes. Opening a board join link on a phone must not accidentally claim the board role.

## 6. Landing mode chooser

### 6.1 Content hierarchy

1. Brand and `How to play` utility.
2. Hero promise: play the Pakistani card-table classic online.
3. Mode question: `How do you want to play?`
4. Primary mode cards:
   - `Play online` — `Every player uses a full game screen.`
   - `Party / TV mode` — `Put the table on one screen and use phones for private cards.`
5. Existing practice/tutorial actions remain secondary below the mode choice.

### 6.2 Desktop / tablet wireframe

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ [Bhabhi THULLA]                                             [How to play]    │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  Bach ke nikal. Bhabhi na banna.          ┌───────────────────────────────┐  │
│  Pakistani Bhabhi Thulla with friends.    │ HOW DO YOU WANT TO PLAY?      │  │
│                                           │                               │  │
│  [trust line: Private rooms • No signup]  │ ┌─────────────┬─────────────┐ │  │
│                                           │ │ PLAY ONLINE │ PARTY / TV  │ │  │
│   [decorative cards, below copy]           │ │ Full game   │ Phones are  │ │  │
│                                           │ │ on every    │ private     │ │  │
│                                           │ │ screen      │ controllers │ │  │
│                                           │ └─────────────┴─────────────┘ │  │
│                                           │                               │  │
│                                           │ [Practice with bots]          │  │
│                                           │ [Interactive tutorial]        │  │
│                                           └───────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────────────┘
```

Interaction:

- Both mode cards are full-width buttons with a visible icon, title and one-sentence explanation.
- `Play online` remains first because it is the established flow.
- `Party / TV mode` carries a small `NEW` badge only for the first two releases; the badge is not part of the accessible name.
- Activating either card transitions in 150–250 ms without moving the hero layout.

### 6.3 Phone wireframe (320–430 px)

```text
┌────────────────────────────┐ top safe area
│ [logo]        [How to play]│ 52–56 px header
├────────────────────────────┤
│                            │
│ Bach ke nikal.             │
│ Bhabhi na banna.           │
│ Pakistani card-table fun.  │
│                            │
│ HOW DO YOU WANT TO PLAY?   │
│ ┌────────────────────────┐ │
│ │ [cards] PLAY ONLINE    │ │ 72–88 px target
│ │ Full game on every     │ │
│ │ player's screen.       │ │
│ └────────────────────────┘ │
│ ┌────────────────────────┐ │
│ │ [screen] PARTY / TV    │ │ 88–104 px target
│ │ Shared board + private │ │
│ │ cards on your phones.  │ │
│ └────────────────────────┘ │
│                            │
│ [Practice with bots]       │
│ [Interactive tutorial]     │
└────────────────────────────┘ bottom safe area
```

At 320×480 the decorative card fan is omitted. The mode chooser and both descriptions remain visible before secondary actions.

## 7. Party entry chooser

This screen prevents a common role error by asking what the current device will do.

### 7.1 Content hierarchy

1. Back link: `Back to game modes`.
2. Heading: `Start a Party Game`.
3. Explanation: `Use one shared screen for the table. Each player joins privately on a phone.`
4. Primary: `Open the shared board`.
5. Secondary: `Join on this phone`.
6. Three-step hint: `1 Open board  2 Scan code  3 Play from phones`.

### 7.2 Responsive wireframe

```text
WIDE                                      PHONE 320–430
┌──────────────────────────────────┐      ┌──────────────────────────┐
│ [← Back]                         │      │ [← Back]          [Help] │
│                                  │      ├──────────────────────────┤
│ START A PARTY GAME               │      │ START A PARTY GAME       │
│ One table. Private hands.        │      │ One table. Private hands.│
│                                  │      │                          │
│ ┌──────────────┐ ┌─────────────┐ │      │ ┌──────────────────────┐ │
│ │ SHARED BOARD │ │ PLAYER PHONE│ │      │ │ OPEN THE SHARED BOARD│ │
│ │ For a TV or  │ │ Join an     │ │      │ │ Best on TV/laptop    │ │
│ │ laptop       │ │ existing    │ │      │ └──────────────────────┘ │
│ │ [Open board] │ │ [Join]      │ │      │ ┌──────────────────────┐ │
│ └──────────────┘ └─────────────┘ │      │ │ JOIN ON THIS PHONE   │ │
│                                  │      │ │ Enter or scan a code │ │
│ 1 Open  →  2 Scan  →  3 Play    │      │ └──────────────────────┘ │
└──────────────────────────────────┘      │ 1 Open · 2 Scan · 3 Play│
                                          └──────────────────────────┘
```

If the viewport reports a phone-sized screen, `Join on this phone` receives visual emphasis but `Open the shared board` remains available. Do not automatically redirect based on device size.

## 8. Board creation and lobby

### 8.1 Board-creating state

For work lasting under 300 ms, keep the pressed state. Beyond 300 ms show:

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ [Bhabhi THULLA]                                                             │
│                                                                              │
│                         Setting up your table…                               │
│                    Keep this screen open for the party.                      │
│                           [progress indicator]                               │
└──────────────────────────────────────────────────────────────────────────────┘
```

On failure, replace the progress line with `We couldn't create the board.` and visible actions `Try again` and `Back`. `Try again` reuses the locally stored pending request ID/token so a lost acknowledgement cannot create a duplicate room; generate a new pair only after a terminal expiry/error. Do not show a blank board or technical error code as the primary message.

If an otherwise empty board remains idle for the six-hour room TTL, replace the lobby with `This party room expired` and one primary `Create a new party room` action. Do not leave a stale QR/code visible.

### 8.2 Board lobby content hierarchy

1. Brand, board connection state, sound and fullscreen utilities.
2. Heading: `Scan to join the table`.
3. QR code with encoded HTTPS join link.
4. Room code, spaced and high contrast: `K7M2Q`.
5. Fallback instruction: `Open thulla.joypad.fun and enter K7M2Q`.
6. Player roster, readiness and party host badge.
7. Lobby status: required count or not-ready names.
8. Persistent helper: `Keep this screen on. Your cards stay private on your phone.`

### 8.3 TV-wide board lobby

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ [Bhabhi THULLA]        PARTY BOARD                  [● Connected] [Sound] [⛶]│
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│ ┌────────────────────────────┐     ┌───────────────────────────────────────┐ │
│ │ SCAN TO JOIN THE TABLE     │     │ PLAYERS                         3 / 8 │ │
│ │                            │     │                                       │ │
│ │      ┌──────────────┐      │     │ [N] Nouman     HOST       ✓ Ready     │ │
│ │      │              │      │     │ [H] Hamza                 ✓ Ready     │ │
│ │      │   QR 320 px  │      │     │ [A] Ayesha                ○ Not ready │ │
│ │      │              │      │     │ [ ] Open seat                         │ │
│ │      └──────────────┘      │     │ [ ] Open seat                         │ │
│ │                            │     │                                       │ │
│ │ ROOM CODE                  │     │ Waiting for Ayesha                    │ │
│ │ K 7 M 2 Q                  │     │ Start from the host phone when ready. │ │
│ │ Open thulla.joypad.fun     │     └───────────────────────────────────────┘ │
│ └────────────────────────────┘                                               │
│                                                                              │
│        Keep this screen on. Your cards stay private on your phone.           │
└──────────────────────────────────────────────────────────────────────────────┘
```

TV requirements:

- QR is at least 280×280 px at 1080p and 220×220 px at 768p, surrounded by a four-module white quiet zone.
- Room-code glyphs are at least 48 px at 1080p with generous tracking. Use unambiguous alphabet `A–Z` excluding confusing room-code characters and digits `2–9`.
- Roster uses up to eight fixed-height rows; no scroll. Empty seats remain visible so capacity is understandable.
- A ready player is shown with both `Ready` and a check icon. Disconnected is shown with `Reconnecting…`, not only a muted color.
- The board never shows a `Start game` button. The party host starts from their phone.

### 8.4 4:3 / short-wide lobby

```text
┌──────────────────────────────────────────────────────────────┐
│ [logo]       PARTY BOARD K7M2Q       [Connected] [Sound] [⛶]│
├──────────────────────────────────────────────────────────────┤
│ ┌──────────────────────┐  ┌────────────────────────────────┐ │
│ │ Scan to join         │  │ PLAYERS 3/8                    │ │
│ │ [QR 220–240 px]      │  │ Nouman HOST       Ready       │ │
│ │ K 7 M 2 Q            │  │ Hamza             Ready       │ │
│ │ Open thulla.joypad.fun│ │ Ayesha             Not ready   │ │
│ └──────────────────────┘  │ + 5 open seats                 │ │
│                           │ Waiting for Ayesha             │ │
│                           └────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────┘
```

The full eight-row roster may collapse to `+ N open seats`; joined players never collapse.

## 9. Phone join

### 9.1 Entry routes

- QR deep link: room code is prefilled and locked read-only; focus moves to `Your name`.
- Manual route: focus starts on `Room code`; input uppercases and removes spaces.
- Previously joined room: offer `Reconnect as [name]` before the manual form when a valid local token exists.

### 9.2 Content hierarchy

1. Back/brand and connection indicator.
2. Heading: `Join the party`.
3. Room code field.
4. Name field.
5. Primary button `Join party`.
6. Privacy note: `Only your phone can see your cards.`

### 9.3 Phone wireframe

```text
┌────────────────────────────┐ top safe area
│ [←] [Bhabhi THULLA]        │
├────────────────────────────┤
│                            │
│ JOIN THE PARTY             │
│ Your phone becomes your    │
│ private hand.              │
│                            │
│ Room code                  │ visible label
│ ┌────────────────────────┐ │
│ │ K7M2Q                  │ │ 52 px field
│ └────────────────────────┘ │
│                            │
│ Your name                  │ visible label
│ ┌────────────────────────┐ │
│ │ e.g. Hamza             │ │ 52 px field
│ └────────────────────────┘ │
│ [inline error / helper]     │ reserved line
│                            │
│ ┌────────────────────────┐ │
│ │ JOIN PARTY             │ │ 52–56 px primary
│ └────────────────────────┘ │
│                            │
│ [shield] Only your phone   │
│ can see your cards.        │
└────────────────────────────┘ bottom safe area
```

Validation:

- Invalid room: `That room code doesn't exist. Check the board and try again.`
- Full room: `This party already has 8 players.`
- Name conflict: `That name is already in this room. Try another name.`
- Request timeout: `The server took too long to respond.` with `Try again`.
- Errors appear directly below the affected field or submit action, use `role="alert"`, and state both cause and recovery.

## 10. Phone lobby

### 10.1 Player lobby content hierarchy

1. Compact room header: code, connection and leave menu.
2. Confirmation: `You're in` and private-hand shield.
3. Player roster with host/ready/connection states.
4. Current player's ready control.
5. Status explaining exactly what blocks start.
6. Host-only settings and start control.

### 10.2 Standard player wireframe

```text
┌────────────────────────────┐ top safe area
│ K7M2Q        [● Live] […]  │ 52–56 px
├────────────────────────────┤
│ YOU'RE IN                  │
│ Nouman                     │
│ [shield] Your cards will   │
│ appear only on this phone. │
│                            │
│ PLAYERS               3/8  │
│ ┌────────────────────────┐ │
│ │ N Nouman (You)  Ready  │ │
│ │ H Hamza HOST    Ready  │ │
│ │ A Ayesha        Waiting│ │
│ └────────────────────────┘ │
│                            │
│ Waiting for Ayesha.        │ aria-live polite
│ Watch the board for the    │
│ shared table.              │
│                            │
│ ┌────────────────────────┐ │
│ │ I'M READY              │ │ sticky above safe area
│ └────────────────────────┘ │
└────────────────────────────┘ bottom safe area
```

After ready:

- Button changes to a selected toggle labeled `Ready ✓` with `Cancel ready` as an explicit secondary action or accessible toggle description.
- Status becomes `Waiting for the host to start.`
- Do not use an indefinite full-screen spinner; roster and leave action stay available.

### 10.3 Party-host phone lobby

```text
┌────────────────────────────┐
│ K7M2Q       HOST [● Live]  │
├────────────────────────────┤
│ PARTY HOST                 │
│ You control this party.    │
│                            │
│ PLAYERS               3/8  │
│ [roster rows and states]    │
│                            │
│ GAME SETTINGS          [⌄] │
│ Turn time             35 s │
│ Allow bots              On │
│ [+ ADD BOT]                 │
│ Reactions               On │
│ Table talk        Reactions│
│                            │
│ All 3 players are ready.   │
│ ┌────────────────────────┐ │
│ │ START GAME            │ │ fixed action dock
│ └────────────────────────┘ │
└────────────────────────────┘
```

Host details:

- `Start game` is enabled only at 3–8 active seats, including bots, with every required human connected and ready.
- Party Mode keeps the existing bot policy: at least one human phone is required, a host may add/remove bots when `Allow bots` is on, bots count toward the 3–8 active-seat limit, and bots never receive controller credentials.
- Disabled copy is specific: `Add 1 more player`, `Waiting for Ayesha`, or `Reconnect Hamza's phone`.
- Destructive `Remove player` and `Leave party` live in row menus, require confirmation and never sit beside `Start game`.
- If host leaves, the next connected human phone receives a nonblocking banner: `You're the party host now.`

### 10.4 Late-join lobby

```text
┌────────────────────────────┐
│ K7M2Q        [● Live] […]  │
├────────────────────────────┤
│ YOU'RE IN                  │
│ The current round is live. │
│                            │
│ [hourglass]                │
│ WAITING FOR NEXT ROUND     │
│ You'll get cards when this │
│ round ends.                │
│                            │
│ [public player list]        │
│ [Ready for next round]      │
│                            │
│ Keep this page open.        │
│ [Leave party]               │
└────────────────────────────┘
```

Do not show an empty hand or disabled play controls to late joiners; show a purposeful waiting state.

## 11. Live shared TV board

### 11.1 Content hierarchy

1. **Current trick and resolution** — visual center.
2. **Whose turn / what happens next** — immediately below trick.
3. **Player seats** — around perimeter, ordered anticlockwise with `RIGHT · NEXT` on the next seat.
4. **Waste pile and card count** — left of center.
5. **Direction** — persistent but quiet above trick.
6. **Room/connection utilities** — top bar.
7. **Match log/reactions** — transient edge layer only; never over trick or status.

### 11.2 TV-wide live board

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ [Bhabhi THULLA]   ROOM K7M2Q       ROUND 2       [● Live] [Sound] [Help] [⛶]│
├──────────────────────────────────────────────────────────────────────────────┤
│        [Ayesha · 7 cards]             [Hamza · 6 cards]                     │
│                                                                              │
│   [Sara · 8]       ANTICLOCKWISE  →  RIGHT             [Bilal · 9 · TURN]   │
│                                                                              │
│               ┌────────┐       ┌──────────────────────────┐                  │
│               │  12    │       │        CURRENT TRICK     │                  │
│               │ WASTE  │       │   [8♠] [4♠] [K♠] [  ]   │                  │
│               └────────┘       │   Nouman Ayesha Hamza   │                  │
│                                └──────────────────────────┘                  │
│                                                                              │
│                   ┌────────────────────────────────────┐                     │
│                   │ BILAL'S TURN                 26 s │                     │
│                   │ Waiting for Bilal to play…         │                     │
│                   └────────────────────────────────────┘                     │
│                                                                              │
│       [Zara · 6]              [Nouman · 7]       [Ali · 9 · RIGHT NEXT]    │
│                                                                              │
│  [Match log]                                              [live reaction]    │
└──────────────────────────────────────────────────────────────────────────────┘
```

Board behavior:

- Seats maintain one stable physical position for the entire match; they do not reorder when turns change.
- The active player gains a gold outline plus `TURN`; the player on their right gains a separate `RIGHT · NEXT` label.
- Disconnected seat stays in place and reads `Reconnecting…`. Never remove/reflow a seat mid-trick.
- Escaped player reads `Safe` and their card count becomes `No cards`.
- Waiting late joiners appear in a compact `Next round: 2` rail outside the active seat ring.
- No face-down hand fans are required; a public card-count chip is more readable and less visually noisy.
- The turn timer uses tabular numbers and changes label/icon as well as color below the low-time threshold.
- Public status copy examples:
  - `Nouman's turn — lead any suit.`
  - `Ayesha must follow Spades if she can.`
  - `Bilal has power.` Action choices remain private to Bilal's phone.

### 11.3 Short-wide / 4:3 live board

```text
┌──────────────────────────────────────────────────────────────┐
│ [logo] K7M2Q ROUND 2                   [Live] [Sound] [⛶]   │
├───────────────┬──────────────────────────────┬───────────────┤
│ Ayesha 7      │ ANTICLOCKWISE → RIGHT        │ Bilal 9 NEXT  │
│ Sara 8        │                              │ Hamza 6 TURN  │
│ Zara 6        │  [12 WASTE] [CURRENT TRICK]  │ Ali 9         │
│               │             [cards + names]  │               │
│               │                              │               │
│               │ HAMZA'S TURN          26 s  │               │
│               │ Follow Spades if you can.   │               │
├───────────────┴──────────────────────────────┴───────────────┤
│ Next round: 2                                      [Log]    │
└──────────────────────────────────────────────────────────────┘
```

At short heights, decorative felt padding and reaction history collapse before status, timer, trick cards or seat labels.

## 12. Live player phone controller

### 12.1 Content hierarchy

1. Connection and room identity.
2. Turn state and countdown.
3. Compact public trick context.
4. Private hand and selection state.
5. Contextual primary actions.
6. Secondary Table Talk / help / leave controls.

The phone does not recreate the full TV board. It gives enough information to make a correct move without exposing other hands or crowding the cards.

### 12.2 Standard portrait controller (375–430 px)

```text
┌────────────────────────────┐ top safe area
│ K7M2Q  PARTY     [● Live] […]│ 52–56 px header
├────────────────────────────┤
│ YOUR TURN             26 s │ gold state card
│ Lead or take right.        │
│                            │
│ NEW TRICK                  │
│ ┌────────────────────────┐ │
│ │ You have the power.    │ │ public, compact
│ │ No cards played yet.   │ │
│ └────────────────────────┘ │
│                            │
│ YOUR HAND            7     │
│ Swipe to see more →         │ only when overflowing
│ ┌───┬───┬───┬───┬───┬───┐ │
│ │2♠ │8♠ │6♥ │K♥ │Q♦ │A♣ │…│ horizontal hand
│ └───┴───┴───┴───┴───┴───┘ │
│ K of Hearts selected       │ aria-live polite
│                            │ reserved action-dock inset
├────────────────────────────┤
│ [Take Ayesha's 5] [Play K♥]│ fixed dock + bottom safe area
└────────────────────────────┘
```

Controller rules:

- Cards are at least 58×84 px at 320 px, 64×92 px at 375 px and 70×102 px at 430 px.
- A selected card rises/brightens within a reserved card lane so it does not alter document height.
- Legal cards are fully opaque. Illegal cards remain legible but carry `Cannot play` semantics; color/opacity is not the only distinction.
- First tap selects. `Play selected card` confirms. Do not submit a card on first tap.
- `Take [right player's] cards` appears only when the server says the power action is legal; it opens the existing confirmation sheet.
- With no selected card, primary copy is `Select a card`; it is visibly disabled and semantically disabled.
- Status and hand update without stealing focus. After a successful play, screen-reader focus moves to the resolution status, not to another card.
- `Table talk` is reachable from the overflow or a utility row above the dock; it must not cover the hand and action dock simultaneously.

### 12.3 Narrow 320 px controller

```text
┌──────────────────────┐
│ K7M2Q  [Live] […]    │
├──────────────────────┤
│ YOUR TURN       26 s │
│ Lead or take right.  │
│ New trick · no cards │ one compact row
│                      │
│ YOUR HAND 7    Swipe │
│ [2♠][8♠][6♥][K♥]…   │
│ Selected: K♥         │
│                      │ reserved inset
├──────────────────────┤
│ [Take 5] [Play K♥]   │ labels may shorten visually;
└──────────────────────┘ accessible names remain complete
```

At 320 px:

- The current trick may use one line of card tokens; player names move to accessible text/expandable detail.
- Primary buttons split 45/55 only when both are legal. Otherwise `Play selected card` spans the width.
- No icon-only primary action.

### 12.4 Phone landscape controller

```text
┌──────────────────────────────────────────────────────────────┐
│ K7M2Q PARTY  [Live]  YOUR TURN · Lead or take right    26 s │
├──────────────────────────┬───────────────────────────────────┤
│ NEW TRICK                │ YOUR HAND 7                       │
│ You have the power.      │ [2♠][8♠][6♥][K♥][Q♦][A♣] →       │
│ No cards played yet.     │ Selected: K♥                      │
│ [Table talk]             │ [Take Ayesha's 5] [Play K♥]      │
└──────────────────────────┴───────────────────────────────────┘
```

The right action region reserves right/bottom safe areas. The card scroller never sits under the browser gesture zone.

### 12.5 Not-your-turn phone state

```text
┌────────────────────────────┐
│ K7M2Q        [● Live] […]  │
├────────────────────────────┤
│ HAMZA'S TURN          21 s │
│ Watch the board.           │
│                            │
│ CURRENT TRICK              │
│ [public cards and names]    │
│                            │
│ YOUR HAND            7     │
│ [cards remain viewable]     │
│                            │
├────────────────────────────┤
│ Waiting for Hamza…         │ non-button status dock
└────────────────────────────┘
```

Cards remain private and viewable, but play actions are absent—not merely disabled—when it is another player's turn.

## 13. Trick resolving state

Resolution is a deliberate 3-second handoff between tricks. It communicates that all played cards were received, lets everyone inspect the last card/THULLA, and makes the next trick start obvious.

### 13.1 Shared board resolving wireframe

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ [normal stable header and seats]                                             │
│                                                                              │
│                     TRICK COMPLETE · NEXT IN 3 s                             │
│                                                                              │
│               ┌──────────────────────────────────────────┐                   │
│               │ [4♥]   [9♥]   [K♥]   [7♥]              │                   │
│               │Nouman  Ayesha  Hamza  Bilal              │                   │
│               └──────────────────────────────────────────┘                   │
│                                                                              │
│              Hamza wins the trick and keeps the power.                      │
│                       Cards move to waste.                                  │
│                                                                              │
│                        [3-second progress rail]                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

Non-negotiable placement:

- Resolution label is in a dedicated band **above** the played cards.
- Outcome sentence is in a dedicated band **below** the played cards.
- Neither band overlaps, blurs, dims or clips the final/THULLA card.
- All played cards and player labels remain at full readable contrast for the complete resolution interval.
- At zero, cards fade/slide to waste in 180–240 ms; the status becomes `Hamza leads the next trick.`

### 13.2 Phone resolving wireframe

```text
┌────────────────────────────┐
│ K7M2Q        [● Live] […]  │
├────────────────────────────┤
│ TRICK COMPLETE        3 s  │
│ [4♥][9♥][K♥][7♥]           │
│ Hamza wins and keeps the   │
│ power. Cards go to waste.  │
│                            │
│ YOUR HAND            7     │
│ [private cards remain]      │
├────────────────────────────┤
│ Next trick is starting…    │ status, not a disabled button
└────────────────────────────┘
```

No play/take actions are shown while the server is resolving.

## 14. THULLA state

THULLA is a resolving variant, not a modal. The event must feel important without hiding the evidence.

### 14.1 Shared board THULLA wireframe

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ [normal stable header and seats]                                             │
│                                                                              │
│                 ┌────────────────────────────────────────┐                   │
│                 │ THULLA!                    NEXT IN 3 s │ red/gold band     │
│                 └────────────────────────────────────────┘                   │
│                                                                              │
│               ┌──────────────────────────────────────────┐                   │
│               │ [A♥]   [7♥]   [K♠]                      │                   │
│               │Nouman  Hamza  Bilal                      │                   │
│               └──────────────────────────────────────────┘                   │
│                                ↑ final THULLA card unobscured                 │
│                                                                              │
│                  Bilal played THULLA — Nouman picks up 3.                    │
│                        Nouman keeps the power.                               │
│                                                                              │
│                        [3-second progress rail]                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

THULLA presentation:

- Use the red state band plus the literal word `THULLA!`; do not rely on red alone.
- Give one short sound/haptic cue where permitted. Never autoplay a long sound.
- Do not introduce a center-screen popup, modal, confetti layer or reaction over the cards.
- Board screen-reader announcement: `THULLA. Bilal could not follow Hearts. Nouman picks up 3 cards and keeps the power.`
- `prefers-reduced-motion`: no shake/pulse; keep the same three-second readable state and static progress text.

### 14.2 Player phone THULLA wireframe

```text
┌────────────────────────────┐
│ K7M2Q        [● Live] […]  │
├────────────────────────────┤
│ THULLA!               3 s  │
│ [A♥][7♥][K♠]                │
│ Bilal played THULLA.        │
│ Nouman picks up 3 and keeps │
│ the power.                  │
│                            │
│ YOUR HAND        updated 10 │ private count/card update
│ [private cards]             │
├────────────────────────────┤
│ Next trick is starting…    │
└────────────────────────────┘
```

If this phone belongs to the person picking up, update the private hand in the same state but do not move focus into the card scroller until resolution ends.

## 15. Reconnection and degraded states

### 15.1 Board reconnect

The board freezes the last trusted public state and adds a bounded status layer. It does not clear the table.

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ [Bhabhi THULLA]  K7M2Q                    [○ Reconnecting] [Sound] [Help] [⛶]│
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│                 [last trusted table remains visible, dimmed 20%]             │
│                                                                              │
│       ┌──────────────────────────────────────────────────────────────┐       │
│       │ CONNECTION LOST                                             │       │
│       │ Reconnecting the board… Players' phones can stay open.       │       │
│       │ Attempt 2                                      [Try now]     │       │
│       └──────────────────────────────────────────────────────────────┘       │
└──────────────────────────────────────────────────────────────────────────────┘
```

- Announce connection loss once with `role="status"`; do not repeat on every retry.
- Automatic retry uses restrained progress and exponential backoff.
- On success, status reads `Board reconnected` for 3 seconds and returns to the authoritative state.
- If the board credential is no longer valid: `This board session expired.` with `Create a new board`; never offer player join as the recovery action.

### 15.2 Phone reconnect

```text
┌────────────────────────────┐
│ K7M2Q   [○ Reconnecting] […]│
├────────────────────────────┤
│ ┌────────────────────────┐ │
│ │ CONNECTION LOST        │ │
│ │ Your hand is protected.│ │
│ │ Reconnecting… [Try now]│ │
│ └────────────────────────┘ │
│                            │
│ [last trusted hand remains │
│  visible but noninteractive]│
├────────────────────────────┤
│ Waiting for connection…   │
└────────────────────────────┘
```

- Never allow speculative card plays offline.
- Do not hide the hand; mark the entire hand read-only and explain why.
- Successful reconnect restores authoritative selection/action state. A selection made before disconnect is cleared unless the server confirms it is still this player's turn.
- Invalid token recovery: `We couldn't restore Nouman's seat.` then `Rejoin room`. Explain that rejoining during a round may wait until the next round.

### 15.3 Player disconnected on board

- Seat remains fixed.
- State changes from card count to `Reconnecting…` with a connection icon.
- Turn status becomes `Waiting for Hamza to reconnect — 18 s` while normal server timer policy continues.
- If host transfers, board announces `Ayesha is the new party host.` without interrupting the trick.

## 16. Round results and rematch

### 16.1 Shared board results hierarchy

1. Result: who is safe/who became Bhabhi according to existing game result semantics.
2. Round summary and score table.
3. Rematch readiness by player.
4. Late joiners joining the next round.
5. Instruction: `Players choose rematch on their phones.`

### 16.2 Shared board results wireframe

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ [Bhabhi THULLA]  ROOM K7M2Q        ROUND COMPLETE        [Live] [Sound] [⛶]│
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│                         BILAL IS BHABHI                                      │
│                    Nouman escaped first this round.                          │
│                                                                              │
│        ┌─────────────────────────┐   ┌──────────────────────────────┐        │
│        │ SCOREBOARD              │   │ READY FOR REMATCH            │        │
│        │ Nouman       1 escape   │   │ ✓ Nouman                    │        │
│        │ Hamza        0 escapes  │   │ ✓ Hamza                     │        │
│        │ Ayesha       0 escapes  │   │ ○ Ayesha                    │        │
│        │ Bilal        1 Bhabhi   │   │ ○ Bilal                     │        │
│        └─────────────────────────┘   │ + Sara joins next round     │        │
│                                      └──────────────────────────────┘        │
│                                                                              │
│                    Players choose rematch on their phones.                   │
└──────────────────────────────────────────────────────────────────────────────┘
```

The board does not expose a rematch button. When everyone is ready, status changes to `Everyone is ready — waiting for the host to deal.` The new deal begins only after the host uses the phone action below.

### 16.3 Player phone results wireframe

```text
┌────────────────────────────┐
│ K7M2Q        ROUND COMPLETE│
├────────────────────────────┤
│ [result mark]              │
│ BILAL IS BHABHI            │
│ Nouman escaped first.      │
│                            │
│ SCOREBOARD             [⌄] │
│ Nouman            1 escape │
│ Hamza             0        │
│ Ayesha            0        │
│ Bilal             1 Bhabhi │
│                            │
│ REMATCH                    │
│ Nouman ✓  Hamza ✓          │
│ Ayesha ○  Bilal ○          │
│                            │ reserved dock inset
├────────────────────────────┤
│ [READY FOR REMATCH]        │ fixed primary
│ [START NEXT ROUND]         │ host-only; enabled when room.canStart
│ [Leave party]              │ separated secondary
└────────────────────────────┘
```

- After selection, primary becomes `Ready ✓`; secondary `Cancel ready` remains possible until server starts.
- Host cannot force-rematch for another connected player.
- Once all required players are ready, the host sees `Start next round`; non-host phones read `Waiting for the host to deal.`
- Late joiners see `You're joining the next round` and a ready toggle, not the previous round's private result language.

## 17. Utility overlays

### 17.1 QR re-open during play

The board header room code opens a non-modal side panel, not a center modal over the trick.

```text
┌────────────────────────────────────────────────────┬─────────────────────────┐
│ live board remains readable                        │ JOIN THIS PARTY         │
│                                                    │ [QR 220 px]             │
│                                                    │ K 7 M 2 Q               │
│                                                    │ Late players join next  │
│                                                    │ round.          [Close] │
└────────────────────────────────────────────────────┴─────────────────────────┘
```

Opening the join panel never pauses play. It closes automatically after 30 seconds only if focus is not inside it.

### 17.2 Table Talk on phone

- Opens as a bottom sheet above the action dock when it is not the player's turn.
- During the player's turn, opening it must leave the timer and a condensed action path visible; submitting a reaction closes it.
- Quick reactions use text labels/accessibility names, not raw emoji as structural icons.
- Quick reactions and public match events may appear in the board edge-toast region and never cover cards, timer, or resolution bands. Table Talk text never appears on the board.

### 17.3 Help

- Board help is a right-side panel with QR join reminder and direction/rule summary.
- Phone help is a bottom sheet with `What can I play?`, `What is THULLA?`, `How does right-hand pickup work?`.
- Escape/back closes overlays and returns focus to the trigger.

## 18. Accessibility specification

### 18.1 Semantics and focus

- One `h1` per route; sequential heading hierarchy in sheets/panels.
- Landmark order: header, main status, trick, players/hand, actions, utilities.
- On phone route change, focus moves to the screen heading. During live updates, focus remains stable unless the user submitted an action.
- Card buttons announce rank, suit, legality and selection, for example: `King of Hearts, legal card, selected`.
- Board player seats are a labeled list in anticlockwise seat order, independent of their visual positions.
- Live status uses `aria-live="polite"`; errors and invalid session states use `role="alert"`.
- The countdown is not announced every second. Announce at turn start, 10 seconds and 5 seconds.
- QR has an accessible text alternative: `Open thulla.joypad.fun and join Party room K7M2Q`.

### 18.2 Contrast and non-color cues

- Normal text contrast is at least 4.5:1; large board text at least 3:1.
- Focus outline is 2–4 px and visible against felt, ivory and gold.
- Current turn uses outline + `TURN`; next right seat uses label + arrow; ready uses icon + word; connection uses icon + word.
- Red and green are never the sole distinction.
- Card suits retain standard red/black but also always show suit glyph and accessible suit name.

### 18.3 Zoom, motion and sound

- Browser zoom remains enabled.
- Phone layout supports 200% text without action overlap; long labels wrap rather than clip.
- `prefers-reduced-motion` removes card travel, shake, pulse and reaction motion. It preserves state duration and immediate visual changes.
- Sound is off until user interaction where browser policy requires it. Sound controls have visible `Sound on/off` state.
- Every sound event has a simultaneous visual/text event; no information is audio-only.

### 18.4 Keyboard and switch access

- Landing, entry, board utilities and phone flows are fully usable with keyboard.
- Tab order follows visual hierarchy; card hand uses roving focus or ordinary sequential buttons with clear boundaries.
- Arrow-key card navigation is optional enhancement; Tab/Shift+Tab and Enter/Space remain complete alternatives.
- Escape closes sheets/panels; destructive confirmations retain an explicit `Cancel` button.

## 19. Motion and feedback

| Event | Standard motion | Reduced motion |
|---|---|---|
| Mode selection | 180–240 ms crossfade/short translate | Instant crossfade |
| Card selection | 120–180 ms reserved-lane lift | Border/background only |
| Played card enters trick | 180–240 ms transform + opacity | Immediate card appearance |
| Trick clears | 180–240 ms toward waste | Immediate replacement |
| THULLA | Static red/gold band + brief emphasis | Static band |
| Sheet | 220–300 ms slide from edge/bottom | Short fade |
| Connection recovery | Status crossfade | Text replacement |

All animations are interruptible, use transform/opacity, and must not block input or cause layout shift.

## 20. State copy matrix

| State | Board primary copy | Phone primary copy |
|---|---|---|
| Need players | `Waiting for 2 more players` | `Invite 2 more players from the board code.` |
| Need ready | `Waiting for Ayesha` | `Mark ready when you're at the table.` |
| Ready to start | `Ready — start from the host phone` | Host: `All players ready.` |
| Deal | `Dealing round 2…` | `Your cards are being dealt…` |
| Own turn, lead | `Nouman's turn — lead any suit` | `Your turn — lead any suit.` |
| Own turn, follow | `Nouman's turn — follow Spades if possible` | `Your turn — follow Spades if you can.` |
| Own power | `Nouman has power` | `Lead a card or take Ayesha's hand.` |
| Other turn | `Waiting for Hamza…` | `Hamza's turn — watch the board.` |
| Resolving | `Trick complete — next in 3 s` | `Next trick is starting…` |
| THULLA | `THULLA! Bilal played THULLA — Nouman picks up 3` | Same outcome, personalized hand update if applicable |
| Late join | `Sara joins next round` | `Waiting for next round.` |
| Reconnect | `Reconnecting the board…` | `Your hand is protected. Reconnecting…` |
| Round result | `[Name] is Bhabhi` | Same, followed by rematch action |

## 21. Privacy and role-safety checks

These are UX acceptance criteria as well as server-contract requirements.

- Inspecting board DOM, network messages or accessibility tree reveals no private hand or legal-card list.
- Board screenshots contain only face-up cards that were publicly played.
- A board cannot send `play`, `take hand`, `ready`, settings or rematch actions.
- A player phone cannot claim board fullscreen or board reconnection by editing only client UI state.
- Switching from board route to phone join route requires a player join/reconnect flow; it does not reuse board credentials.
- Screen sharing the board is safe by design. Screen sharing a phone clearly risks revealing that player's hand.
- Only quick reactions and public match events may be displayed publicly, following the existing room settings. Table Talk text and history remain phone-only.

## 22. Responsive acceptance matrix

Every row must be verified in portrait and, where listed, landscape.

| Surface | Required viewport | Critical checks |
|---|---|---|
| Landing | 320×480 | Mode options readable; no decorative overlap; no horizontal scroll |
| Landing | 375×667, 430×932 | Both mode cards and descriptions; secondary actions below |
| Board lobby | 1366×768, 1920×1080 | QR scannable; all joined players visible; room code readable at distance |
| Board lobby | 1024×768 | QR and roster coexist without scrolling |
| Live board | 1366×600, 1366×768, 1920×1080 | Trick/status/seats never overlap; no scroll |
| Phone lobby | 320×480, 375×667, 430×932 | Fixed CTA clears safe area; roster/settings remain reachable |
| Phone controller | 320×480, 320×568, 375×667, 390×844, 430×932 | Hand and dock never overlap; selected card remains visible |
| Phone controller landscape | 667×375, 740×360, 844×390 | Safe-area clear; trick/hand/actions all operable |
| Resolving/THULLA | All board and phone sizes above | Event bands do not cover any played card |
| Reconnect | All phone sizes above | Last hand visible but noninteractive; recovery action reachable |
| Results | 320×480 and 1366×600 | Score content scrolls only inside phone page; rematch CTA unobscured |

## 23. Definition of done for the UX implementation

- Landing exposes Online Mode and Party / TV Mode as separate, understandable choices.
- A board can be opened, joined by QR/manual code and kept fullscreen without becoming a player.
- First joined phone has clear host controls; every phone can ready independently.
- Board receives and renders public state only.
- Phone controller renders private hand and server-authorized actions only.
- 3–8-player seating remains stable and visibly anticlockwise.
- Last played/THULLA card remains fully visible for the complete three-second resolution.
- Cards disappear at the end of resolution and next-trick status appears immediately.
- Board and phone both recover from connection loss with actionable, nontechnical messaging.
- Late joiners get a purposeful next-round state.
- Round results/rematch work across board and phones without exposing a board gameplay control.
- All required viewport checks pass with no unintended horizontal scroll, clipped text, target overlap or safe-area collision.
- Keyboard, screen-reader, reduced-motion, text zoom and contrast requirements pass WCAG 2.2 AA expectations.
