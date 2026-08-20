import { randomBytes, randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { io as connect, type Socket } from 'socket.io-client'
import {
  PROTOCOL_VERSION,
  type Ack,
  type ChatHistory,
  type ChatMessage,
  type PartyBoardCredentials,
  type PartyBoardCreateRequest,
  type PartyBoardView,
  type ReactionEvent,
  type RoomCredentials,
  type RoomLeaveResult,
  type RoomView,
  type ServerHello,
} from '../shared/game.js'
import { createGameServer, RateLimiter, type GameServer } from './index.js'

type ObservedSocket = Socket & { observedHello?: ServerHello }

function connectedSocket(url: string, usesReadyProtocol = true): Promise<Socket> {
  return new Promise((fulfill, reject) => {
    const socket = connect(url, {
      transports: ['websocket'],
      forceNew: true,
      extraHeaders: { Origin: 'http://localhost:5173' },
      auth: usesReadyProtocol ? { protocolVersion: PROTOCOL_VERSION } : {},
    }) as ObservedSocket
    socket.on('server:hello', (hello: ServerHello) => { socket.observedHello = hello })
    socket.once('connect', () => fulfill(socket))
    socket.once('connect_error', reject)
  })
}

function emitAck<T = undefined>(socket: Socket, event: string, payload: unknown): Promise<Ack<T>> {
  return new Promise((fulfill) => socket.emit(event, payload, (ack: Ack<T>) => fulfill(ack)))
}

function makeBoardRequest(): PartyBoardCreateRequest {
  return {
    requestId: randomUUID(),
    boardToken: randomBytes(32).toString('base64url'),
  }
}

function nextEvent<T>(socket: Socket, event: string): Promise<T> {
  return new Promise((fulfill) => socket.once(event, fulfill))
}

function nextMatchingEvent<T>(socket: Socket, event: string, matches: (value: T) => boolean): Promise<T> {
  return new Promise((fulfill) => {
    const listener = (value: T) => {
      if (!matches(value)) return
      socket.off(event, listener)
      fulfill(value)
    }
    socket.on(event, listener)
  })
}

function recursiveKeys(value: unknown, output = new Set<string>()): Set<string> {
  if (!value || typeof value !== 'object') return output
  if (Array.isArray(value)) {
    for (const item of value) recursiveKeys(item, output)
    return output
  }
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    output.add(key)
    recursiveKeys(item, output)
  }
  return output
}

describe('Socket.IO server protocol', () => {
  let gameServer: GameServer | undefined
  const sockets: Socket[] = []

  afterEach(async () => {
    for (const socket of sockets) socket.disconnect()
    sockets.length = 0
    await gameServer?.close()
    gameServer = undefined
  })

  it('serves health/readiness and synchronizes a three-player resolving phase', async () => {
    gameServer = await createGameServer({
      ...process.env,
      NODE_ENV: 'test',
      CLIENT_ORIGIN: 'http://localhost:5173',
      REDIS_URL: '',
    })
    const port = await gameServer.listen(0)
    const url = `http://127.0.0.1:${port}`

    const health = await fetch(`${url}/health`).then((response) => response.json()) as Record<string, unknown>
    expect(health).toMatchObject({
      ok: true,
      protocolVersion: '2.0.0',
      persistence: { mode: 'memory', durable: false },
    })
    const ready = await fetch(`${url}/ready`)
    expect(ready.status).toBe(200)
    expect(await ready.json()).toMatchObject({ ok: true, persistence: { ready: true } })

    sockets.push(await connectedSocket(url), await connectedSocket(url), await connectedSocket(url))
    expect((sockets[0] as ObservedSocket).observedHello).toEqual({
      protocolVersion: PROTOCOL_VERSION,
      capabilities: ['chat-v1', 'party-v1'],
      partyMode: 'off',
      serverNow: expect.any(Number),
    })
    const created = await emitAck<RoomCredentials>(sockets[0], 'room:create', { name: 'Host Player' })
    expect(created.ok).toBe(true)
    expect(await emitAck(sockets[0], 'room:create', { name: 'Duplicate Host' })).toMatchObject({
      ok: false, error: expect.stringContaining('already seated'),
    })
    expect(await emitAck(sockets[0], 'room:join', { code: created.data!.code, name: 'Duplicate Host' })).toMatchObject({
      ok: false, error: expect.stringContaining('already seated'),
    })
    const credentials = [created.data!]
    credentials.push((await emitAck<RoomCredentials>(sockets[1], 'room:join', { code: created.data!.code, name: 'Player One' })).data!)
    credentials.push((await emitAck<RoomCredentials>(sockets[2], 'room:join', { code: created.data!.code, name: 'Player Two' })).data!)

    expect(await emitAck(sockets[0], 'game:start', {})).toMatchObject({
      ok: false, error: expect.stringContaining('Waiting for'),
    })

    // A non-function final argument must never be invoked as an acknowledgement after mutation.
    sockets[0].emit('room:settings', { turnSeconds: 20 }, 'not-an-acknowledgement')
    await new Promise((fulfill) => setTimeout(fulfill, 25))
    expect(gameServer.manager.rooms.get(created.data!.code)?.settings.turnSeconds).toBe(20)
    expect(sockets[0].connected).toBe(true)
    expect((await emitAck(sockets[0], 'room:settings', { turnSeconds: 35 })).ok).toBe(true)

    const invalidReady = await emitAck(sockets[1], 'room:ready', { ready: 'yes' })
    expect(invalidReady).toMatchObject({ ok: false, error: 'Invalid ready.' })
    for (const socket of sockets) expect((await emitAck(socket, 'room:ready', { ready: true })).ok).toBe(true)
    expect((await emitAck(sockets[0], 'game:start', {})).ok).toBe(true)

    const room = gameServer.manager.rooms.get(created.data!.code)!
    while (room.game?.firstTrick && room.game.phase === 'turn') {
      const currentId = room.game.currentTurnId!
      const clientIndex = credentials.findIndex((credential) => credential.playerId === currentId)
      const legal = gameServer.manager.legalCards(room, currentId)
      expect(clientIndex).toBeGreaterThanOrEqual(0)
      expect((await emitAck(sockets[clientIndex], 'game:play', { cardId: legal[0].id })).ok).toBe(true)
    }
    expect(room.game).toMatchObject({
      phase: 'resolving', currentTurnId: null, turnEndsAt: null,
    })
    expect(room.game?.resolutionEndsAt).toBeGreaterThan(Date.now())
    expect(room.game?.resolvedTrick?.cards).toHaveLength(3)

    const pendingClient = credentials.findIndex((credential) => credential.playerId === room.game?.pendingTurnId)
    const stalePlay = await emitAck(sockets[pendingClient], 'game:play', { cardId: 'spades-2' })
    expect(stalePlay).toMatchObject({ ok: false, error: 'The completed trick is still being shown.' })

    const reactionPromise = new Promise<ReactionEvent>((fulfill) => sockets[1].once('room:reaction', fulfill))
    expect((await emitAck<ReactionEvent>(sockets[0], 'room:react', { reaction: 'wah' })).ok).toBe(true)
    expect(await reactionPromise).toMatchObject({
      playerId: credentials[0].playerId, playerName: 'Host Player', reaction: 'wah',
    })

    const reconnected = await connectedSocket(url)
    sockets.push(reconnected)
    const statePromise = new Promise<RoomView>((fulfill) => reconnected.once('room:state', fulfill))
    expect((await emitAck<RoomCredentials>(reconnected, 'room:reconnect', {
      code: created.data!.code,
      token: credentials[pendingClient].token,
    })).ok).toBe(true)
    const state = await statePromise
    expect(state.game?.phase).toBe('resolving')
    expect(state.game?.resolutionEndsAt).toBe(room.game?.resolutionEndsAt)
  })

  it('supports deliberate leave, host transfer, room deletion, and reseating the same socket', async () => {
    gameServer = await createGameServer({
      ...process.env,
      NODE_ENV: 'test',
      CLIENT_ORIGIN: 'http://localhost:5173',
      REDIS_URL: '',
    })
    const port = await gameServer.listen(0)
    const url = `http://127.0.0.1:${port}`
    sockets.push(await connectedSocket(url), await connectedSocket(url))
    const created = await emitAck<RoomCredentials>(sockets[0], 'room:create', { name: 'First Host' })
    const joined = await emitAck<RoomCredentials>(sockets[1], 'room:join', {
      code: created.data!.code, name: 'Next Host',
    })

    const left = await emitAck<RoomLeaveResult>(sockets[0], 'room:leave', {})
    expect(left).toMatchObject({
      ok: true,
      data: { code: created.data!.code, roomDeleted: false, leftDuringPlay: false },
    })
    const oldRoom = gameServer.manager.rooms.get(created.data!.code)!
    expect(oldRoom.players).toHaveLength(1)
    expect(oldRoom.players[0]).toMatchObject({ id: joined.data!.playerId, isHost: true })
    const serverSocket = gameServer.io.sockets.sockets.get(sockets[0].id!)!
    await new Promise((fulfill) => setTimeout(fulfill, 10))
    expect(serverSocket.rooms.has(created.data!.code)).toBe(false)
    expect(serverSocket.data.roomCode).toBeUndefined()

    const reseated = await emitAck<RoomCredentials>(sockets[0], 'room:create', { name: 'New Host' })
    expect(reseated.ok).toBe(true)
    expect(reseated.data!.code).not.toBe(created.data!.code)

    const deleted = await emitAck<RoomLeaveResult>(sockets[1], 'room:leave', {})
    expect(deleted).toMatchObject({ ok: true, data: { roomDeleted: true } })
    expect(gameServer.manager.rooms.has(created.data!.code)).toBe(false)
  })

  it('accepts a socket into an active room as a next-round seat', async () => {
    gameServer = await createGameServer({
      ...process.env,
      NODE_ENV: 'test',
      CLIENT_ORIGIN: 'http://localhost:5173',
      REDIS_URL: '',
    })
    const port = await gameServer.listen(0)
    const url = `http://127.0.0.1:${port}`
    sockets.push(
      await connectedSocket(url),
      await connectedSocket(url),
      await connectedSocket(url),
      await connectedSocket(url),
    )

    const created = await emitAck<RoomCredentials>(sockets[0], 'room:create', { name: 'Queue Host' })
    const first = await emitAck<RoomCredentials>(sockets[1], 'room:join', {
      code: created.data!.code, name: 'First Player',
    })
    await emitAck<RoomCredentials>(sockets[2], 'room:join', {
      code: created.data!.code, name: 'Second Player',
    })
    for (const socket of sockets.slice(0, 3)) {
      expect((await emitAck(socket, 'room:ready', { ready: true })).ok).toBe(true)
    }
    expect((await emitAck(sockets[0], 'game:start', {})).ok).toBe(true)

    const late = await emitAck<RoomCredentials>(sockets[3], 'room:join', {
      code: created.data!.code, name: 'Late Friend',
    })
    expect(late.ok).toBe(true)
    const room = gameServer.manager.rooms.get(created.data!.code)!
    const lateView = gameServer.manager.view(room, late.data!.playerId)
    expect(lateView).toMatchObject({
      status: 'playing',
      yourPlayerId: late.data!.playerId,
      game: { hand: [], legalCardIds: [], canTakeRightHand: false },
    })
    expect(lateView.players.find((player) => player.id === late.data!.playerId)).toMatchObject({
      waitingForNextRound: true, joinedInRound: 2, rematchReady: false, cardCount: 0,
    })
    expect(await emitAck(sockets[1], 'game:rematch-ready', { ready: true })).toMatchObject({
      ok: false, error: expect.stringContaining('waiting for the next round'),
    })
    expect((await emitAck(sockets[3], 'game:rematch-ready', { ready: true })).ok).toBe(true)
    expect(gameServer.manager.view(room, late.data!.playerId).players.find(
      (player) => player.id === late.data!.playerId,
    )?.rematchReady).toBe(true)

    expect(await emitAck(sockets[0], 'room:kick', { playerId: first.data!.playerId })).toMatchObject({
      ok: false, error: expect.stringContaining('waiting for the next round'),
    })
    const kicked = new Promise<{ code: string }>((fulfill) => sockets[3].once('room:kicked', fulfill))
    expect((await emitAck(sockets[0], 'room:kick', { playerId: late.data!.playerId })).ok).toBe(true)
    expect(await kicked).toEqual({ code: created.data!.code })
    expect(room.players.some((player) => player.id === late.data!.playerId)).toBe(false)
  })

  it('lets legacy sockets start and rematch without ready events while v2 remains explicit', async () => {
    gameServer = await createGameServer({
      ...process.env,
      NODE_ENV: 'test',
      CLIENT_ORIGIN: 'http://localhost:5173',
      REDIS_URL: '',
    })
    const port = await gameServer.listen(0)
    const url = `http://127.0.0.1:${port}`
    sockets.push(
      await connectedSocket(url, false),
      await connectedSocket(url, false),
      await connectedSocket(url, false),
    )
    const created = await emitAck<RoomCredentials>(sockets[0], 'room:create', { name: 'Legacy Host' })
    const credentials = [created.data!]
    credentials.push((await emitAck<RoomCredentials>(sockets[1], 'room:join', {
      code: created.data!.code, name: 'Legacy One',
    })).data!)
    credentials.push((await emitAck<RoomCredentials>(sockets[2], 'room:join', {
      code: created.data!.code, name: 'Legacy Two',
    })).data!)

    expect((await emitAck(sockets[0], 'game:start', {})).ok).toBe(true)
    const room = gameServer.manager.rooms.get(created.data!.code)!
    expect(room.players.every((player) => !player.usesReadyProtocol && player.ready)).toBe(true)
    const [host, middle, right] = room.players
    middle.escaped = true
    middle.hand = []
    Object.assign(room.game!, {
      phase: 'turn', firstTrick: false, trick: [], leadSuit: null,
      currentTurnId: host.id, leaderId: host.id, takeUsedForLead: false,
    })
    host.hand = [{ id: 'diamonds-2', suit: 'diamonds', rank: '2' }]
    right.hand = [{ id: 'hearts-3', suit: 'hearts', rank: '3' }]
    expect((await emitAck(sockets[0], 'game:take-right', {})).ok).toBe(true)
    expect(room.status).toBe('finished')
    expect(room.players.every((player) => player.rematchReady)).toBe(true)
    expect((await emitAck(sockets[0], 'game:start', {})).ok).toBe(true)
    expect(room).toMatchObject({ status: 'playing', session: { roundNumber: 2 } })
    expect(credentials.map((credential) => credential.playerId)).toEqual([host.id, middle.id, right.id])
  })

  it('broadcasts deduplicated room-only chat and returns bounded seat history', async () => {
    gameServer = await createGameServer({
      ...process.env,
      NODE_ENV: 'test',
      CLIENT_ORIGIN: 'http://localhost:5173',
      REDIS_URL: '',
    })
    const port = await gameServer.listen(0)
    const url = `http://127.0.0.1:${port}`
    sockets.push(
      await connectedSocket(url),
      await connectedSocket(url),
      await connectedSocket(url),
      await connectedSocket(url),
    )
    const created = await emitAck<RoomCredentials>(sockets[0], 'room:create', { name: 'Chat Host' })
    const joined = await emitAck<RoomCredentials>(sockets[1], 'room:join', {
      code: created.data!.code,
      name: 'Chat Friend',
    })
    await emitAck<RoomCredentials>(sockets[2], 'room:create', { name: 'Other Room' })

    const peerMessages: ChatMessage[] = []
    const otherRoomMessages: ChatMessage[] = []
    sockets[1].on('room:chat:message', (message: ChatMessage) => peerMessages.push(message))
    sockets[2].on('room:chat:message', (message: ChatMessage) => otherRoomMessages.push(message))
    const clientMessageId = randomUUID()
    const sent = await emitAck<ChatMessage>(sockets[0], 'room:chat:send', {
      clientMessageId,
      text: '  Table talk\r\nٹھلا  ',
    })
    expect(sent).toMatchObject({
      ok: true,
      data: {
        epoch: expect.any(String),
        clientMessageId,
        sequence: 1,
        playerId: created.data!.playerId,
        playerName: 'Chat Host',
        text: 'Table talk\nٹھلا',
      },
    })
    await new Promise((fulfill) => setTimeout(fulfill, 20))
    expect(peerMessages).toEqual([sent.data])
    expect(otherRoomMessages).toEqual([])

    const retried = await emitAck<ChatMessage>(sockets[0], 'room:chat:send', {
      clientMessageId,
      text: 'Table talk\nٹھلا',
    })
    expect(retried).toEqual(sent)
    await new Promise((fulfill) => setTimeout(fulfill, 20))
    expect(peerMessages).toHaveLength(1)

    const history = await emitAck<ChatHistory>(sockets[1], 'room:chat:history', {})
    expect(history).toEqual({
      ok: true,
      data: { epoch: sent.data!.epoch, messages: [sent.data] },
    })
    expect(joined.data!.playerId).not.toBe(sent.data!.playerId)
    expect(await emitAck(sockets[0], 'room:chat:send', {
      clientMessageId: randomUUID(), text: 'Spoof', playerId: joined.data!.playerId,
    })).toMatchObject({ ok: false, error: 'Invalid request fields.' })
    expect(await emitAck(sockets[3], 'room:chat:send', {
      clientMessageId: randomUUID(), text: 'Not seated',
    })).toMatchObject({ ok: false, error: expect.stringContaining('Reconnect') })
  })

  it('keeps the per-seat chat burst limit across reconnects without charging deduplicated retries', async () => {
    gameServer = await createGameServer({
      ...process.env,
      NODE_ENV: 'test',
      CLIENT_ORIGIN: 'http://localhost:5173',
      REDIS_URL: '',
    })
    const port = await gameServer.listen(0)
    const url = `http://127.0.0.1:${port}`
    sockets.push(await connectedSocket(url))
    const created = await emitAck<RoomCredentials>(sockets[0], 'room:create', { name: 'Fast Chatter' })

    for (const invalid of [
      { clientMessageId: 'not-a-uuid', text: 'Invalid id' },
      { clientMessageId: randomUUID(), text: '   ' },
      { clientMessageId: randomUUID(), text: 'one\ntwo\nthree\nfour' },
    ]) {
      expect((await emitAck(sockets[0], 'room:chat:send', invalid)).ok).toBe(false)
    }

    let first: Ack<ChatMessage> | undefined
    for (let message = 0; message < 5; message += 1) {
      const response = await emitAck<ChatMessage>(sockets[0], 'room:chat:send', {
        clientMessageId: randomUUID(),
        text: `Message ${message}`,
      })
      first ??= response
      expect(response.ok).toBe(true)
    }
    expect(await emitAck<ChatMessage>(sockets[0], 'room:chat:send', {
      clientMessageId: first!.data!.clientMessageId,
      text: first!.data!.text,
    })).toEqual(first)
    expect(await emitAck(sockets[0], 'room:chat:send', {
      clientMessageId: randomUUID(), text: 'Burst overflow',
    })).toMatchObject({ ok: false, error: expect.stringContaining('wait') })

    sockets[0].disconnect()
    const reconnected = await connectedSocket(url)
    sockets.push(reconnected)
    expect((await emitAck<RoomCredentials>(reconnected, 'room:reconnect', {
      code: created.data!.code,
      token: created.data!.token,
    })).ok).toBe(true)
    expect(await emitAck(reconnected, 'room:chat:send', {
      clientMessageId: randomUUID(), text: 'Reconnect cannot bypass the seat limit',
    })).toMatchObject({ ok: false, error: expect.stringContaining('wait') })
  })

  it('replays messages missed while disconnected through history without duplicating live delivery', async () => {
    gameServer = await createGameServer({
      ...process.env,
      NODE_ENV: 'test',
      CLIENT_ORIGIN: 'http://localhost:5173',
      REDIS_URL: '',
    })
    const port = await gameServer.listen(0)
    const url = `http://127.0.0.1:${port}`
    sockets.push(await connectedSocket(url), await connectedSocket(url))
    const created = await emitAck<RoomCredentials>(sockets[0], 'room:create', { name: 'Returning Host' })
    expect((await emitAck<RoomCredentials>(sockets[1], 'room:join', {
      code: created.data!.code,
      name: 'Connected Friend',
    })).ok).toBe(true)

    sockets[0].disconnect()
    await vi.waitFor(() => expect(
      gameServer!.manager.rooms.get(created.data!.code)?.players
        .find((player) => player.id === created.data!.playerId)?.connected,
    ).toBe(false))

    const missed: ChatMessage[] = []
    for (const text of ['First missed message', 'Second missed message']) {
      const response = await emitAck<ChatMessage>(sockets[1], 'room:chat:send', {
        clientMessageId: randomUUID(),
        text,
      })
      expect(response.ok).toBe(true)
      missed.push(response.data!)
    }

    const reconnected = await connectedSocket(url)
    sockets.push(reconnected)
    const liveMessages: ChatMessage[] = []
    reconnected.on('room:chat:message', (message: ChatMessage) => liveMessages.push(message))
    expect((await emitAck<RoomCredentials>(reconnected, 'room:reconnect', {
      code: created.data!.code,
      token: created.data!.token,
    })).ok).toBe(true)
    await new Promise((fulfill) => setTimeout(fulfill, 20))
    expect(liveMessages).toEqual([])

    const history = await emitAck<ChatHistory>(reconnected, 'room:chat:history', {})
    expect(history).toEqual({
      ok: true,
      data: {
        epoch: missed[0].epoch,
        messages: missed,
      },
    })
    expect(missed.map((message) => message.sequence)).toEqual([1, 2])

    const nextClientMessageId = randomUUID()
    const next = await emitAck<ChatMessage>(sockets[1], 'room:chat:send', {
      clientMessageId: nextClientMessageId,
      text: 'Live after reconnect',
    })
    expect(next.ok).toBe(true)
    await vi.waitFor(() => expect(liveMessages).toEqual([next.data]))

    expect(await emitAck<ChatMessage>(sockets[1], 'room:chat:send', {
      clientMessageId: nextClientMessageId,
      text: 'Live after reconnect',
    })).toEqual(next)
    await new Promise((fulfill) => setTimeout(fulfill, 20))
    expect(liveMessages).toEqual([next.data])
  })

  it('keeps reaction limits on the seat and excludes a superseded socket from broadcasts', async () => {
    gameServer = await createGameServer({
      ...process.env,
      NODE_ENV: 'test',
      CLIENT_ORIGIN: 'http://localhost:5173',
      REDIS_URL: '',
    })
    const port = await gameServer.listen(0)
    const url = `http://127.0.0.1:${port}`
    sockets.push(await connectedSocket(url), await connectedSocket(url), await connectedSocket(url))
    const created = await emitAck<RoomCredentials>(sockets[0], 'room:create', { name: 'Reaction Host' })
    expect((await emitAck<RoomCredentials>(sockets[1], 'room:join', {
      code: created.data!.code,
      name: 'Reaction Friend',
    })).ok).toBe(true)

    for (let count = 0; count < 6; count += 1) {
      expect((await emitAck<ReactionEvent>(sockets[0], 'room:react', { reaction: 'wah' })).ok).toBe(true)
    }
    expect((await emitAck<RoomCredentials>(sockets[2], 'room:reconnect', {
      code: created.data!.code,
      token: created.data!.token,
    })).ok).toBe(true)

    const supersededReactions: ReactionEvent[] = []
    const currentReactions: ReactionEvent[] = []
    sockets[0].on('room:reaction', (reaction: ReactionEvent) => supersededReactions.push(reaction))
    sockets[2].on('room:reaction', (reaction: ReactionEvent) => currentReactions.push(reaction))
    expect((await emitAck<ReactionEvent>(sockets[1], 'room:react', { reaction: 'oye' })).ok).toBe(true)
    await new Promise((fulfill) => setTimeout(fulfill, 20))
    expect(supersededReactions).toEqual([])
    expect(currentReactions).toHaveLength(1)

    expect(await emitAck(sockets[2], 'room:react', { reaction: 'chalo' })).toMatchObject({
      ok: false,
      error: expect.stringContaining('wait'),
    })
  })
  it('advertises Party capability and fails closed for missing or invalid availability', async () => {
    for (const [configured, expected] of [
      [undefined, 'off'],
      ['PUBLIC', 'off'],
      ['unexpected', 'off'],
      ['beta', 'beta'],
      ['public', 'public'],
    ] as const) {
      gameServer = await createGameServer({
        ...process.env,
        NODE_ENV: 'test',
        CLIENT_ORIGIN: 'http://localhost:5173',
        REDIS_URL: '',
        PARTY_MODE: configured,
      })
      const port = await gameServer.listen(0)
      const socket = await connectedSocket(`http://127.0.0.1:${port}`) as ObservedSocket
      sockets.push(socket)
      await vi.waitFor(() => expect(socket.observedHello).toBeDefined())
      expect(socket.observedHello).toMatchObject({
        protocolVersion: PROTOCOL_VERSION,
        capabilities: ['chat-v1', 'party-v1'],
        partyMode: expected,
        serverNow: expect.any(Number),
      })
      expect(Math.abs(Date.now() - socket.observedHello!.serverNow!)).toBeLessThan(5_000)
      socket.disconnect()
      sockets.pop()
      await gameServer.close()
      gameServer = undefined
    }
  })

  it('keeps Party board traffic public-only while phones retain private state and actions', async () => {
    gameServer = await createGameServer({
      ...process.env,
      NODE_ENV: 'test',
      CLIENT_ORIGIN: 'http://localhost:5173',
      REDIS_URL: '',
      PARTY_MODE: 'beta',
    })
    const port = await gameServer.listen(0)
    const url = `http://127.0.0.1:${port}`
    sockets.push(
      await connectedSocket(url),
      await connectedSocket(url),
      await connectedSocket(url),
      await connectedSocket(url),
    )
    const [board, host, second, third] = sockets
    const boardRoomStates: RoomView[] = []
    const boardChat: ChatMessage[] = []
    const phoneBoardStates: PartyBoardView[][] = [[], [], []]
    board.on('room:state', (state: RoomView) => boardRoomStates.push(state))
    board.on('room:chat:message', (message: ChatMessage) => boardChat.push(message))
    ;[host, second, third].forEach((socket, index) => {
      socket.on('party:board:state', (state: PartyBoardView) => phoneBoardStates[index].push(state))
    })

    const request = makeBoardRequest()
    const initialBoardState = nextEvent<PartyBoardView>(board, 'party:board:state')
    const created = await emitAck<PartyBoardCredentials>(board, 'party:board:create', request)
    expect(created).toEqual({
      ok: true,
      data: { code: expect.stringMatching(/^[A-HJ-NP-Z2-9]{5}$/), boardToken: request.boardToken },
    })
    expect(await initialBoardState).toMatchObject({
      protocolVersion: PROTOCOL_VERSION,
      revision: expect.any(Number),
      serverNow: expect.any(Number),
      mode: 'party',
      code: created.data!.code,
      status: 'lobby',
      players: [],
      game: null,
    })

    expect(await emitAck<PartyBoardCredentials>(board, 'party:board:create', request)).toEqual(created)
    expect(gameServer.manager.rooms.size).toBe(1)
    expect(await emitAck(board, 'party:board:create', { ...request, extra: true })).toMatchObject({
      ok: false,
      error: 'Invalid request fields.',
    })
    expect(await emitAck(board, 'room:create', { name: 'Board is not a player' })).toMatchObject({
      ok: false,
      error: expect.stringContaining('already connected'),
    })
    expect(await emitAck(board, 'game:start', {})).toMatchObject({
      ok: false,
      error: expect.stringContaining('Reconnect'),
    })
    expect(await emitAck(board, 'room:chat:history', {})).toMatchObject({
      ok: false,
      error: expect.stringContaining('Reconnect'),
    })

    const credentials: RoomCredentials[] = []
    for (const [index, socket] of [host, second, third].entries()) {
      const response = await emitAck<RoomCredentials>(socket, 'room:join', {
        code: created.data!.code,
        name: `Phone ${index + 1}`,
      })
      expect(response.ok).toBe(true)
      credentials.push(response.data!)
      expect((await emitAck(socket, 'room:ready', { ready: true })).ok).toBe(true)
    }
    const startedBoardState = nextMatchingEvent<PartyBoardView>(
      board,
      'party:board:state',
      (state) => state.status === 'playing',
    )
    expect((await emitAck(host, 'game:start', {})).ok).toBe(true)
    const publicState = await startedBoardState
    const room = gameServer.manager.rooms.get(created.data!.code)!
    const privateState = gameServer.manager.view(room, credentials[0].playerId)
    expect(publicState).toMatchObject({
      mode: 'party',
      revision: privateState.revision,
      status: 'playing',
      players: [
        { name: 'Phone 1', isHost: true, cardCount: expect.any(Number) },
        { name: 'Phone 2', isHost: false, cardCount: expect.any(Number) },
        { name: 'Phone 3', isHost: false, cardCount: expect.any(Number) },
      ],
      game: { phase: 'turn', trick: [], resolvedTrick: null },
    })
    const forbiddenKeys = [
      'hand', 'legalCardIds', 'token', 'tokenHash', 'requestId', 'creationRequestHash',
      'creationRequestExpiresAt', 'socketId', 'usesReadyProtocol', 'pendingWasteCards',
      'waste', 'cardId', 'canTakeRightHand', 'takeTargetId',
    ]
    const keys = recursiveKeys(publicState)
    for (const key of forbiddenKeys) expect(keys.has(key), key).toBe(false)
    const encodedBoard = JSON.stringify(publicState)
    for (const player of room.players) {
      for (const card of player.hand) expect(encodedBoard).not.toContain(card.id)
    }
    expect(privateState.game?.hand.length).toBeGreaterThan(0)
    expect(privateState.partyBoardConnected).toBe(true)

    expect((await emitAck<ChatMessage>(host, 'room:chat:send', {
      clientMessageId: randomUUID(),
      text: 'Phones only: private table talk',
    })).ok).toBe(true)
    await new Promise((fulfill) => setTimeout(fulfill, 20))
    expect(boardChat).toEqual([])

    const boardReaction = nextEvent<ReactionEvent>(board, 'room:reaction')
    expect((await emitAck<ReactionEvent>(host, 'room:react', { reaction: 'wah' })).ok).toBe(true)
    expect(await boardReaction).toMatchObject({
      playerId: credentials[0].playerId,
      playerName: 'Phone 1',
      reaction: 'wah',
    })
    await new Promise((fulfill) => setTimeout(fulfill, 20))
    expect(boardRoomStates).toEqual([])
    expect(phoneBoardStates).toEqual([[], [], []])
  })
  it('fences replaced boards and lets play continue through a board disconnect and reconnect', async () => {
    gameServer = await createGameServer({
      ...process.env,
      NODE_ENV: 'test',
      CLIENT_ORIGIN: 'http://localhost:5173',
      REDIS_URL: '',
      PARTY_MODE: 'public',
    })
    const port = await gameServer.listen(0)
    const url = `http://127.0.0.1:${port}`
    sockets.push(
      await connectedSocket(url),
      await connectedSocket(url),
      await connectedSocket(url),
      await connectedSocket(url),
      await connectedSocket(url),
    )
    const [firstBoard, replacementBoard, host, second, third] = sockets
    const request = makeBoardRequest()
    const created = await emitAck<PartyBoardCredentials>(firstBoard, 'party:board:create', request)
    expect(created.ok).toBe(true)

    const replacedEvent = nextEvent<{ code: string }>(firstBoard, 'party:board:replaced')
    const replacementState = nextEvent<PartyBoardView>(replacementBoard, 'party:board:state')
    expect(await emitAck<PartyBoardCredentials>(replacementBoard, 'party:board:reconnect', {
      code: created.data!.code,
      boardToken: created.data!.boardToken,
    })).toEqual(created)
    expect(await replacedEvent).toEqual({ code: created.data!.code })
    expect((await replacementState).code).toBe(created.data!.code)
    const firstServerSocket = gameServer.io.sockets.sockets.get(firstBoard.id!)!
    expect(firstServerSocket.data.connectionRole).toBeUndefined()
    expect(firstServerSocket.data.roomCode).toBeUndefined()

    const oldBoardStates: PartyBoardView[] = []
    firstBoard.on('party:board:state', (state: PartyBoardView) => oldBoardStates.push(state))
    const credentials: RoomCredentials[] = []
    for (const [index, socket] of [host, second, third].entries()) {
      const joined = await emitAck<RoomCredentials>(socket, 'room:join', {
        code: created.data!.code,
        name: `Continuity ${index + 1}`,
      })
      expect(joined.ok).toBe(true)
      credentials.push(joined.data!)
      expect((await emitAck(socket, 'room:ready', { ready: true })).ok).toBe(true)
    }
    const currentBoardState = nextMatchingEvent<PartyBoardView>(
      replacementBoard,
      'party:board:state',
      (state) => state.status === 'playing',
    )
    expect((await emitAck(host, 'game:start', {})).ok).toBe(true)
    const beforeDisconnect = await currentBoardState
    const room = gameServer.manager.rooms.get(created.data!.code)!
    const phaseBefore = room.game?.phase
    const turnBefore = room.game?.currentTurnId
    const deadlineBefore = room.game?.turnEndsAt

    const phoneSeesDisconnect = nextMatchingEvent<RoomView>(
      host,
      'room:state',
      (state) => !state.partyBoardConnected,
    )
    replacementBoard.disconnect()
    const disconnectedView = await phoneSeesDisconnect
    expect(disconnectedView.partyBoardConnected).toBe(false)
    expect(room.game).toMatchObject({
      phase: phaseBefore,
      currentTurnId: turnBefore,
      turnEndsAt: deadlineBefore,
    })
    expect(room.suspended).not.toBe(true)

    const returningBoard = await connectedSocket(url)
    sockets.push(returningBoard)
    const reconnectedState = nextMatchingEvent<PartyBoardView>(
      returningBoard,
      'party:board:state',
      (state) => state.status === 'playing',
    )
    const phoneSeesReconnect = nextMatchingEvent<RoomView>(
      host,
      'room:state',
      (state) => state.partyBoardConnected && state.revision > disconnectedView.revision,
    )
    expect(await emitAck<PartyBoardCredentials>(returningBoard, 'party:board:reconnect', {
      code: created.data!.code,
      boardToken: created.data!.boardToken,
    })).toEqual(created)
    expect(await reconnectedState).toMatchObject({
      code: beforeDisconnect.code,
      status: 'playing',
      game: { phase: phaseBefore, currentTurnId: turnBefore, turnEndsAt: deadlineBefore },
    })
    expect((await phoneSeesReconnect).partyBoardConnected).toBe(true)
    await new Promise((fulfill) => setTimeout(fulfill, 20))
    expect(oldBoardStates).toEqual([])

    expect(await emitAck(firstBoard, 'party:board:reconnect', {
      code: created.data!.code,
      boardToken: created.data!.boardToken,
    })).toMatchObject({ ok: true })
    expect(await emitAck(host, 'party:board:reconnect', {
      code: created.data!.code,
      boardToken: created.data!.boardToken,
    })).toMatchObject({ ok: false, error: expect.stringContaining('already seated') })
    expect(credentials).toHaveLength(3)
  })

  it('blocks fresh Party creation while off but preserves exact recovery, board reconnect, and phone join', async () => {
    gameServer = await createGameServer({
      ...process.env,
      NODE_ENV: 'test',
      CLIENT_ORIGIN: 'http://localhost:5173',
      REDIS_URL: '',
      PARTY_MODE: 'off',
    })
    const port = await gameServer.listen(0)
    const url = `http://127.0.0.1:${port}`
    sockets.push(await connectedSocket(url), await connectedSocket(url), await connectedSocket(url))
    const [board, replacement, phone] = sockets

    expect(await emitAck(board, 'party:board:create', makeBoardRequest())).toMatchObject({
      ok: false,
      error: expect.stringContaining('not available'),
    })
    expect(gameServer.manager.rooms.size).toBe(0)

    const recoverable = makeBoardRequest()
    const seeded = gameServer.manager.createPartyRoom(recoverable, 'lost-ack-socket', true)
    const recovered = await emitAck<PartyBoardCredentials>(board, 'party:board:create', recoverable)
    expect(recovered).toEqual({ ok: true, data: seeded.credentials })
    expect(gameServer.manager.rooms.size).toBe(1)

    expect(await emitAck<PartyBoardCredentials>(replacement, 'party:board:reconnect', {
      code: seeded.credentials.code,
      boardToken: seeded.credentials.boardToken,
    })).toEqual({ ok: true, data: seeded.credentials })
    expect(await emitAck<RoomCredentials>(phone, 'room:join', {
      code: seeded.credentials.code,
      name: 'Phone in existing room',
    })).toMatchObject({ ok: true, data: { code: seeded.credentials.code } })
    expect(await emitAck(replacement, 'party:board:reconnect', {
      code: seeded.credentials.code,
      boardToken: `${seeded.credentials.boardToken}x`,
    })).toMatchObject({ ok: false })
  })

  it('expires an idle empty Party room, clears the board role, and lets that socket create again', async () => {
    gameServer = await createGameServer({
      ...process.env,
      NODE_ENV: 'test',
      CLIENT_ORIGIN: 'http://localhost:5173',
      REDIS_URL: '',
      PARTY_MODE: 'public',
    })
    const port = await gameServer.listen(0)
    const url = `http://127.0.0.1:${port}`
    const board = await connectedSocket(url)
    sockets.push(board)
    const first = await emitAck<PartyBoardCredentials>(board, 'party:board:create', makeBoardRequest())
    expect(first.ok).toBe(true)
    const room = gameServer.manager.rooms.get(first.data!.code)!
    room.updatedAt = Date.now() - 6 * 60 * 60 * 1_000 - 1

    const expired = nextEvent<{ code: string }>(board, 'party:board:expired')
    gameServer.runMaintenance()
    expect(await expired).toEqual({ code: first.data!.code })
    expect(gameServer.manager.rooms.has(first.data!.code)).toBe(false)
    const serverSocket = gameServer.io.sockets.sockets.get(board.id!)!
    expect(serverSocket.data.connectionRole).toBeUndefined()
    expect(serverSocket.data.roomCode).toBeUndefined()

    const second = await emitAck<PartyBoardCredentials>(board, 'party:board:create', makeBoardRequest())
    expect(second.ok).toBe(true)
    expect(second.data!.code).not.toBe(first.data!.code)
  })

  it('keeps production socket logs free of credentials and user identifiers', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    try {
      gameServer = await createGameServer({
        ...process.env,
        NODE_ENV: 'production',
        CLIENT_ORIGIN: 'http://localhost:5173',
        REDIS_URL: '',
        PARTY_MODE: 'public',
        COMMIT_SHA: 'safe-build-version',
      })
      const port = await gameServer.listen(0)
      const url = `http://127.0.0.1:${port}`
      sockets.push(await connectedSocket(url), await connectedSocket(url), await connectedSocket(url))
      const [board, player, attacker] = sockets
      const request = makeBoardRequest()
      const created = await emitAck<PartyBoardCredentials>(board, 'party:board:create', request)
      const playerName = 'Sensitive Player Name'
      const joined = await emitAck<RoomCredentials>(player, 'room:join', {
        code: created.data!.code,
        name: playerName,
      })
      const chatText = 'Sensitive private chat text'
      await emitAck(player, 'room:chat:send', { clientMessageId: randomUUID(), text: chatText })
      await emitAck(player, 'game:start', {})
      await emitAck(attacker, 'party:board:reconnect', {
        code: created.data!.code,
        boardToken: randomBytes(32).toString('base64url'),
      })

      const logs = JSON.stringify([...warn.mock.calls, ...info.mock.calls])
      for (const forbidden of [
        request.requestId,
        request.boardToken,
        created.data!.code,
        joined.data!.playerId,
        joined.data!.token,
        playerName,
        chatText,
        board.id!,
        player.id!,
        '127.0.0.1',
      ]) expect(logs).not.toContain(forbidden)
      expect(logs).toContain('safe-build-version')
      expect(logs).toContain('correlationId')
      expect(logs).toContain('socket_action_rejected')
      expect(logs).toContain('party_board_created')
    } finally {
      for (const socket of sockets) socket.disconnect()
      sockets.length = 0
      await gameServer?.close()
      gameServer = undefined
      warn.mockRestore()
      info.mockRestore()
    }
  })
})

describe('RateLimiter', () => {
  it('resets a 25-message minute window only after its deadline', () => {
    let now = Date.now()
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => now)
    try {
      const limiter = new RateLimiter()
      for (let count = 0; count < 25; count += 1) expect(limiter.consume('seat:room:player:chat', 25, 60_000)).toBe(true)
      expect(limiter.consume('seat:room:player:chat', 25, 60_000)).toBe(false)
      now += 59_999
      expect(limiter.consume('seat:room:player:chat', 25, 60_000)).toBe(false)
      now += 1
      expect(limiter.consume('seat:room:player:chat', 25, 60_000)).toBe(true)
    } finally {
      clock.mockRestore()
    }
  })
})
