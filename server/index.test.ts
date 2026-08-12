import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { io as connect, type Socket } from 'socket.io-client'
import {
  PROTOCOL_VERSION,
  type Ack,
  type ChatHistory,
  type ChatMessage,
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
      capabilities: ['chat-v1'],
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
