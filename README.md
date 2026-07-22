# Bhabhi Thulla

A mobile-first, real-time multiplayer version of the Pakistani/Punjabi card game Bhabhi Thulla (also called Getaway).

## What is included

- Private rooms with five-character invite codes
- Three to eight players using one 52-card deck
- Server-authoritative moves, shuffle, turns, and outcomes
- Strict follow-suit and immediate thulla resolution
- Pakistani opening rule: the Ace of Spades starts and the first trick is always discarded
- The power rule: a clean-trick winner cannot escape while owing the next lead
- Thirty-five-second turns with a legal automatic move on timeout
- Refresh/reconnect support using a private seat token in the player's browser
- Host handoff in the lobby and between rounds
- Responsive phone, landscape, tablet, and desktop layouts
- No account, database, tracking, public chat, or paid currency

Rooms and active games are held in server memory. This keeps the first release simple, but a Render restart will end active matches.

## Technology

- React, TypeScript, and Vite for the static frontend
- Node.js, Express, and Socket.IO for the multiplayer server
- Vitest for the rules engine tests

## Run locally

Requirements: Node.js 20 or newer.

```bash
npm install
npm run dev
```

Open `http://localhost:5173`. The Socket.IO server runs at `http://localhost:3001`.

Useful commands:

```bash
npm test
npm run build
npm start
```

`npm run build` creates:

- `dist/` — static frontend files for Hostinger
- `dist-server/` — compiled multiplayer server for Render

## Deploy the server to Render

The included `render.yaml` can create the free web service from a Git repository.

1. Push this project to a Git provider supported by Render.
2. In Render, create a new Blueprint and select the repository. Alternatively, create a Node web service manually.
3. Use `npm ci && npm run build:server` as the build command.
4. Use `npm start` as the start command.
5. Set `CLIENT_ORIGIN` to `https://thulla.joypad.fun`.
6. Confirm that `https://YOUR-SERVICE.onrender.com/health` returns an object with `"ok": true`.

Render must expose the service on the `PORT` environment variable; the server already does this. WebSocket traffic uses the same public port as HTTP.

## Deploy the frontend to Hostinger

Create a local `.env.production` file:

```env
VITE_SERVER_URL=https://YOUR-SERVICE.onrender.com
```

Then build the frontend:

```bash
npm ci
npm run build:client
```

Upload the **contents** of `dist/` to the document root assigned to `thulla.joypad.fun` in Hostinger. Do not upload `node_modules`, `src`, or the server files to the static host.

After deployment, verify:

1. The landing page reports **Server ready**.
2. One browser can create a room.
3. An incognito window or another device can join through the shared URL.
4. Three connected players enable **Deal the cards**.
5. Refreshing a player’s browser restores their seat.

## Environment variables

| Variable | Used by | Example |
| --- | --- | --- |
| `VITE_SERVER_URL` | Frontend build | `https://bhabhi-thulla-server.onrender.com` |
| `CLIENT_ORIGIN` | Multiplayer server | `https://thulla.joypad.fun` |
| `PORT` | Multiplayer server | Provided automatically by Render |

Multiple allowed frontend origins can be comma-separated in `CLIENT_ORIGIN`. Avoid `*` after testing.

## Rules implemented

Cards rank from high to low: A, K, Q, J, 10 through 2. Deal and play move clockwise.

1. The holder of the Ace of Spades opens with that card.
2. Every active player contributes to the opening trick. It is discarded even if someone cannot follow Spades.
3. On later tricks, a player must follow the led suit whenever possible.
4. A player without the led suit can play any card. This is a thulla and immediately stops the trick.
5. The highest card of the led suit picks up every card in a thulla trick and leads next.
6. A clean trick is discarded; its highest led-suit card holds the power and leads next.
7. A player who empties their hand gets away unless their last card won a clean trick. In that case, they draw a random card from the earlier waste and must lead it.
8. The last active player is the Bhabhi and loses the round.

The optional traditional rule that allows a player to take a neighbour’s entire hand is intentionally excluded from this first online version because it needs an accept/decline interaction and varies between families.

## Free hosting limitation

Render’s free service can sleep when idle and may restart. Active WebSocket traffic keeps a live match awake, but an instance restart still clears in-memory rooms. Durable accounts, rankings, and resumable games should be added only with persistent shared storage.
