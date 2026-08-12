# Bhabhi Thulla

A mobile-first, real-time multiplayer version of the Pakistani/Punjabi card game Bhabhi Thulla (also called Getaway), built for private games with friends.

- Frontend: React, TypeScript and Vite on static hosting
- Multiplayer server: Node.js, Express and Socket.IO
- Optional shared room state: Redis-compatible storage
- Rules and integration tests: Vitest
- Live site: <https://thulla.joypad.fun>

## Player experience

- Private five-character room codes with no signup
- Friends can join an active room with the same code, watch the public table, confirm they are ready, and take a seat on the next deal without changing the current hand
- Three to eight human or bot players using one 52-card deck
- Practice mode that immediately starts a game with two bots
- Server-authoritative shuffle, legal moves, turns, timers and results
- Anticlockwise play to the active player on the right
- Three-second completed-trick phase: all cards and the THULLA/result stay visible, no player can act, and the next turn timer starts only after the cards clear
- Sixty-second reconnect grace period with the active turn paused
- Host option to replace an unavailable player with a bot
- Ready states, host removal controls, bots and 20/35/60-second turn settings
- Session scoreboard, rematch readiness and score reset
- Private-room Table Talk with server-checked text chat and preset quick reactions
- Host-selectable text + quick, quick-only and off modes; per-player local mute and unread controls
- Optional turn sound, vibration, hidden-tab title alert, reaction mute and chat-notification mute
- English, Roman Urdu and Urdu interface options
- Interactive tutorial, illustrated rules and contextual “What happened?” explanations
- Responsive phone portrait, phone landscape, tablet and desktop table layouts
- Installable PWA with a cached static shell, explicit offline messaging and player-controlled updates

The offline shell never becomes an authoritative copy of a match. Card hands, room state, Socket.IO traffic, API responses and reconnect tokens are not stored by the service worker.

## Run locally

Use Node.js 20 or newer.

```bash
npm install
npm run dev
```

Open <http://localhost:5173>. The Socket.IO server runs at <http://localhost:3001>.

Useful commands:

```bash
npm test
npm run build
npm run qa:platform
npm run qa:visual
npm start
```

`npm run qa:platform` validates the manifest, install icons, social preview, metadata, service-worker update policy and cache exclusions.

With `npm run dev` already running, `npm run qa:visual` creates a real eight-player match and verifies:

- Mobile landing CTA placement
- Lobby, late-join waiting/readiness, resolving, reconnect and maximum-capacity finished-scoreboard fixtures at 390×844 and 844×390
- A real three-second server resolution phase
- Completed-card visibility and final-card emphasis
- Paused timer during resolution and a fresh timer afterward
- Desktop 1440×900, mobile 375×812 and landscape 844×390 gameplay
- Open Table Talk drawer/sheet layout on desktop, phone portrait and phone landscape
- Short-laptop gameplay, chat and results at 1366×600
- Horizontal overflow, 44px touch targets, accessible names, duplicate IDs, display-card semantics, reduced motion and console errors

Screenshots and `visual-qa-report.json` are written to `design/qa/`.

`npm run build` creates:

- `dist/` — static Hostinger frontend, including the stamped service worker
- `dist-server/` — compiled Render server

## Environment variables

| Variable | Used by | Required | Example / purpose |
| --- | --- | --- | --- |
| `VITE_SERVER_URL` | Frontend build | Production | `https://bhabhi-thulla-server.onrender.com` |
| `VITE_APP_COMMIT` | Frontend build | Recommended | Git commit shown in build diagnostics and used to version the service worker |
| `CLIENT_ORIGIN` | Server | Production | `https://thulla.joypad.fun`; comma-separate additional trusted origins |
| `PORT` | Server | Provided by Render | Public HTTP and WebSocket port |
| `REDIS_URL` | Server | Optional | Redis-compatible connection URL for shared room state |
| `REDIS_KEY_PREFIX` | Server | Optional | Namespace for room keys; defaults to `bhabhi-thulla:room:` |
| `REDIS_DURABLE` | Server | Optional | Set to `true` only when the selected Redis provider really persists across restart |
| `COMMIT_SHA` | Server | Optional outside Render | Source revision returned by health diagnostics |
| `RENDER_GIT_COMMIT` | Server/Render | Automatic on Render | Deployed source revision returned by health diagnostics |

Keep secrets in Render or local ignored `.env` files. Never expose `REDIS_URL` through a `VITE_` variable—every `VITE_` value is included in the public browser bundle.

### Current production values

The existing production stack is Hostinger at `thulla.joypad.fun`, the Render service at `bhabhi-thulla-server.onrender.com`, and an Upstash Redis database in Singapore. Configure the Render **web service** environment with these values:

```env
NODE_ENV=production
NODE_VERSION=22
CLIENT_ORIGIN=https://thulla.joypad.fun
REDIS_URL=rediss://default:YOUR_UPSTASH_PASSWORD@YOUR_UPSTASH_ENDPOINT:6379
REDIS_KEY_PREFIX=bhabhi-thulla:room:
REDIS_DURABLE=true
```

Copy only the `rediss://...` URL from Upstash's **node-redis** connection example into `REDIS_URL`; do not paste the JavaScript example. Keep the URL in Render's secret environment-variable field and never commit it. Render supplies `PORT` and `RENDER_GIT_COMMIT`, so do not set either manually there.

Upstash persists data to durable storage, so `REDIS_DURABLE=true` is correct for this deployment. The game still expires abandoned room keys after six hours by design. If the Redis provider is changed, reassess this flag instead of copying it blindly.

Rotate any Upstash password whose full connection URL has ever been pasted into chat, an issue, a screenshot, a log, or any other non-secret location. After rotation, replace `REDIS_URL` in Render and redeploy once.

## Persistence modes

Without `REDIS_URL`, the server deliberately uses in-memory room storage. That is convenient locally, but a restart deletes every active room and the process cannot safely scale to multiple instances.

With `REDIS_URL`, room mutations are stored with an abandonment TTL. Socket IDs are never persisted. Restored rooms remain suspended until a player reconnects, then absolute trick/reconnect deadlines are reconciled rather than silently granting a fresh timer.

Table Talk is intentionally ephemeral. The server keeps only the latest 50 messages for the active room, limits text to 200 Unicode code points and three lines, rate-limits each seat, and never writes chat content to Redis. Chat disappears when the room closes or the server process restarts.

Storage durability depends on the provider. Render's free Key Value service is in-memory and loses data when it restarts, and a free web service has an ephemeral filesystem. To make matches survive infrastructure restarts, use a persistent paid Key Value service or another durable Redis-compatible provider. Do not use the Render filesystem for match persistence.

## Deploy the server to Render

The included `render.yaml` defines the web service.

1. Provision persistent Redis-compatible storage if resumable matches are required. Copy its secret TLS connection URL into `REDIS_URL`.
2. Push the repository to GitHub.
3. In Render, create a Blueprint from the repository, or create a Node web service manually.
4. Build with `npm ci && npm run build:server`.
5. Start with `npm start`.
6. Set `CLIENT_ORIGIN=https://thulla.joypad.fun`. Add local/staging origins as a comma-separated list only when needed.
7. Render supplies `PORT` and `RENDER_GIT_COMMIT`; use `COMMIT_SHA` on another host if it does not provide a revision automatically.
8. Add `REDIS_URL` when shared persistence is available. Optionally isolate deployments with `REDIS_KEY_PREFIX`.
9. Set `REDIS_DURABLE=true` only for a provider that guarantees persistence across restart. Leave it `false` for memory-only and Render Free Key Value.
10. Verify `https://YOUR-SERVICE.onrender.com/health` for process liveness and version information.
11. Verify `https://YOUR-SERVICE.onrender.com/ready` reports the expected persistence mode and readiness before deploying the frontend.

For the current service, the two checks are:

```text
https://bhabhi-thulla-server.onrender.com/health
https://bhabhi-thulla-server.onrender.com/ready
```

With Upstash configured, `/ready` must return HTTP 200 and report `persistence.mode` as `redis`, `persistence.durable` as `true`, and `persistence.ready` as `true`. A 503 response, `mode: "memory"`, or `durable: false` means the frontend release should wait until the Render variables are corrected.

The checked-in Blueprint deliberately defaults `REDIS_DURABLE` to `false` because it cannot know which Redis provider a new deployment will use. Render Blueprint syncs can reapply values from `render.yaml`; for the current Upstash-backed service, confirm `REDIS_DURABLE=true` after any Blueprint change or sync.

Do not use `CLIENT_ORIGIN=*` in production. WebSocket traffic uses the same public port as HTTP.

## Deploy the frontend to Hostinger

Deploy the backend first so the new frontend never speaks to an older Socket.IO protocol.

Create `.env.production`:

```env
VITE_SERVER_URL=https://bhabhi-thulla-server.onrender.com
VITE_APP_COMMIT=YOUR_CURRENT_GIT_COMMIT
```

`VITE_APP_COMMIT` must be updated for every release. Obtain it with `git rev-parse --short=12 HEAD`; do not reuse the value from an older `.env.production` file.

Then build:

```bash
npm ci
npm run build:client
npm run qa:platform
```

Upload the **contents** of `dist/` to the document root assigned to `thulla.joypad.fun`. In the current Hostinger layout that is `public_html/thulla/`. `index.html` must be directly inside that directory—not inside an extra `dist/` or archive-name folder.

Upload every generated item together, including `index.html`, `sw.js`, `manifest.webmanifest`, `offline.html`, `platform.css`, `robots.txt`, `sitemap.xml`, `social-preview.png`, `social-preview.svg`, `icons/` and `assets/`. Do not upload `node_modules`, `src`, `.env.production`, Redis credentials, tests or server files. If using a zip file in hPanel, extract it into `public_html/thulla/` and verify those top-level paths before deleting the zip.

Hostinger must serve the site over HTTPS and serve `/sw.js` as JavaScript. The service worker uses network-first navigation and caches only the static shell/same-origin assets. A waiting release shows **Update & reconnect** and does not force a reload during a game.

After deployment, verify in order:

1. `/health` and `/ready` on the backend.
2. The landing page reports **Server ready**.
3. The browser application panel recognizes the manifest and service worker.
4. One browser creates a room and another device joins the shared link.
5. Three ready players can deal cards.
6. The opening trick remains visible for about three seconds with no turn clock, clears, and then starts a fresh clock.
7. Refresh restores the same seat.
8. Temporarily going offline shows the reconnect notice without exposing stale match state.
9. Phone portrait and landscape have no page-level horizontal overflow.
10. A fourth device can join an active three-player room, sees no private hands, marks itself ready, and is included only when the next round is dealt.

## Rules implemented

Cards rank from high to low: A, K, Q, J, 10 through 2. Turns move anticlockwise to the next active player sitting on the right.

1. The holder of the Ace of Spades opens with that card.
2. Every active player contributes to the opening trick. It is discarded even when someone cannot follow Spades.
3. On later tricks, a player must follow the led suit whenever possible.
4. A player without the led suit may play any card. This is a THULLA and immediately completes the trick.
5. The highest card of the led suit picks up every card in a THULLA trick and leads next.
6. A clean trick is discarded; its highest led-suit card keeps the power and leads next.
7. Before leading a new trick, the player with power may take the whole hand of the next active player on the right. That player gets away safely; the player who took the cards still leads.
8. The right-hand option can be used once before that lead and is unavailable during the opening trick.
9. A player who empties their hand gets away unless their last card won a clean trick. In that case, they draw from the earlier waste and keep the lead.
10. The last active player is the Bhabhi and loses the round.

At the end of every trick, resolution is server-authoritative: completed cards remain visible for three seconds, `currentTurnId` and the turn deadline are empty, actions are rejected, then the cards clear and a new turn deadline starts. Reconnecting during that pause reveals only the remaining display time.

## Privacy-friendly analytics

No analytics provider is currently loaded. If anonymous product analytics are introduced, implementation must follow the allowlist in [docs/analytics-events.md](docs/analytics-events.md).

The specification permits coarse funnel events such as landing viewed, room entered, match completed and reconnect succeeded. It forbids player names, room codes, reconnect tokens, card hands, socket IDs, IP addresses, session replay, advertising identifiers and cross-site tracking.

## Production limitations

- Free Render services may sleep when idle; the landing page can briefly show **Waking up server…**.
- Memory-only rooms disappear on server restart.
- Render Free Key Value is not durable across its own restart.
- The app has no accounts, global rankings, public matchmaking, public/global chat or paid currency. Text chat is limited to players currently seated in the same private room.
- Horizontal scaling requires shared room storage plus a Socket.IO scaling/sticky-session strategy.
