import { afterEach, describe, expect, it } from 'vitest'
import { io as connect, type Socket } from 'socket.io-client'
import {
  PROTOCOL_VERSION,
  type Ack,
  type RoomCredentials,
  type RoomLeaveResult,
  type RoomView,
} from '../shared/game.js'
import { createGameServer, type GameServer } from './index.js'

interface Participant {
  name: string
  socket: Socket
  credentials: RoomCredentials
}

function emitAck<T = undefined>(socket: Socket, event: string, payload: unknown): Promise<Ack<T>> {
  return new Promise((resolve) => socket.emit(event, payload, (response: Ack<T>) => resolve(response)))
}

async function waitFor(
  predicate: () => boolean,
  description: string,
  timeoutMs = 3_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`Timed out waiting for ${description}.`)
}

function configureTakeToFinish(gameServer: GameServer, roomCode: string, actorId: string): string {
  const room = gameServer.manager.rooms.get(roomCode)
  if (!room?.game) throw new Error('Expected an active room before configuring the deterministic finish.')
  const active = room.players.filter((player) => !player.waitingForNextRound)
  const actorIndex = room.players.findIndex((player) => player.id === actorId)
  let target = null
  for (let offset = 1; offset <= room.players.length; offset += 1) {
    const candidate = room.players[(actorIndex - offset + room.players.length) % room.players.length]
    if (!candidate.waitingForNextRound && candidate.id !== actorId) {
      target = candidate
      break
    }
  }
  if (!target) throw new Error('Could not identify the right-hand player for the deterministic finish.')
  const availableCards = active.flatMap((player) => player.hand)
  if (availableCards.length < 2) throw new Error('The dealt room did not retain enough cards for the deterministic finish.')
  for (const player of active) {
    player.escaped = player.id !== actorId && player.id !== target.id
    player.hand = []
  }
  const actor = active.find((player) => player.id === actorId)
  if (!actor) throw new Error('The finishing actor is not an active player.')
  actor.hand = [availableCards[0]]
  target.hand = [availableCards[1]]
  Object.assign(room.game, {
    phase: 'turn',
    firstTrick: false,
    trick: [],
    resolvedTrick: null,
    resolutionEndsAt: null,
    pendingTurnId: null,
    pendingLoserId: null,
    pendingWasteLeadPlayerId: null,
    pendingWasteCards: [],
    leadSuit: null,
    leaderId: actorId,
    currentTurnId: actorId,
    takeUsedForLead: false,
    turnEndsAt: null,
    turnRemainingMs: null,
    reconnectPlayerId: null,
    reconnectEndsAt: null,
  })
  return target.id
}

describe('multiplayer Socket.IO reliability', () => {
  let gameServer: GameServer | undefined
  const sockets: Socket[] = []
  const latestStates = new Map<Socket, RoomView>()

  async function connectedSocket(url: string): Promise<Socket> {
    const socket = await new Promise<Socket>((resolve, reject) => {
      const candidate = connect(url, {
        transports: ['websocket'],
        forceNew: true,
        extraHeaders: { Origin: 'http://localhost:5173' },
        auth: { protocolVersion: PROTOCOL_VERSION },
      })
      candidate.once('connect', () => resolve(candidate))
      candidate.once('connect_error', reject)
    })
    socket.on('room:state', (state: RoomView) => latestStates.set(socket, state))
    sockets.push(socket)
    return socket
  }

  afterEach(async () => {
    for (const socket of sockets) socket.disconnect()
    sockets.length = 0
    latestStates.clear()
    await gameServer?.close()
    gameServer = undefined
  })

  it('scales one room from three active players to eight through queueing, recovery, rematch, and cleanup', async () => {
    gameServer = await createGameServer({
      ...process.env,
      NODE_ENV: 'test',
      CLIENT_ORIGIN: 'http://localhost:5173',
      REDIS_URL: '',
    })
    const port = await gameServer.listen(0)
    const url = `http://127.0.0.1:${port}`
    const names = ['Host', 'Ayesha', 'Bilal', 'Nouman', 'Hira', 'Danish', 'Mehwish', 'Sana']
    const clients = await Promise.all(names.map(async (name) => ({ name, socket: await connectedSocket(url) })))

    const created = await emitAck<RoomCredentials>(clients[0].socket, 'room:create', { name: clients[0].name })
    expect(created).toMatchObject({ ok: true, data: { code: expect.any(String), token: expect.any(String) } })
    const roomCode = created.data!.code
    const participants: Participant[] = [{ ...clients[0], credentials: created.data! }]
    for (const client of clients.slice(1, 3)) {
      const joined = await emitAck<RoomCredentials>(client.socket, 'room:join', { code: roomCode, name: client.name })
      expect(joined.ok).toBe(true)
      participants.push({ ...client, credentials: joined.data! })
    }

    const lobby = gameServer.manager.rooms.get(roomCode)!
    expect(lobby.players).toHaveLength(3)
    for (const participant of participants) {
      expect((await emitAck(participant.socket, 'room:ready', { ready: true })).ok).toBe(true)
    }
    expect((await emitAck(participants[0].socket, 'game:start', {})).ok).toBe(true)
    expect(lobby).toMatchObject({ status: 'playing', session: { roundNumber: 1 } })
    expect(lobby.players.reduce((total, player) => total + player.hand.length, 0)).toBe(52)

    for (const client of clients.slice(3)) {
      const joined = await emitAck<RoomCredentials>(client.socket, 'room:join', { code: roomCode, name: client.name })
      expect(joined.ok).toBe(true)
      participants.push({ ...client, credentials: joined.data! })
      const queued = lobby.players.find((player) => player.id === joined.data!.playerId)
      expect(queued).toMatchObject({
        waitingForNextRound: true,
        joinedInRound: 2,
        rematchReady: false,
        hand: [],
      })
      expect((await emitAck(client.socket, 'game:rematch-ready', { ready: true })).ok).toBe(true)
    }
    expect(lobby.players).toHaveLength(8)
    expect(lobby.players.filter((player) => player.waitingForNextRound)).toHaveLength(5)
    await waitFor(
      () => participants.every(({ socket }) => latestStates.get(socket)?.players.length === 8),
      'all eight clients to receive the queued-room state',
    )

    const interruptedId = lobby.game!.currentTurnId!
    const interrupted = participants.find((participant) => participant.credentials.playerId === interruptedId)!
    interrupted.socket.disconnect()
    await waitFor(
      () => lobby.game?.phase === 'waiting_for_reconnect' && lobby.game.reconnectPlayerId === interruptedId,
      'the active turn to pause for reconnection',
    )
    expect(lobby.players.find((player) => player.id === interruptedId)).toMatchObject({ connected: false })

    const resumedSocket = await connectedSocket(url)
    const resumed = await emitAck<RoomCredentials>(resumedSocket, 'room:reconnect', {
      code: roomCode,
      token: interrupted.credentials.token,
    })
    expect(resumed.ok).toBe(true)
    interrupted.socket = resumedSocket
    await waitFor(
      () => lobby.game?.phase === 'turn' && lobby.game.currentTurnId === interruptedId,
      'the interrupted turn to resume on the replacement socket',
    )
    expect(lobby.game).toMatchObject({ reconnectPlayerId: null, reconnectEndsAt: null })

    const hostBeforeDisconnect = lobby.players.find((player) => player.isHost)!
    const hostParticipant = participants.find((participant) => participant.credentials.playerId === hostBeforeDisconnect.id)!
    hostParticipant.socket.disconnect()
    await waitFor(
      () => lobby.players.filter((player) => player.isHost && player.connected && !player.isBot).length === 1
        && !lobby.players.find((player) => player.id === hostBeforeDisconnect.id)?.isHost,
      'host ownership to transfer to a connected active player',
    )
    const transferredHost = lobby.players.find((player) => player.isHost)!
    expect(transferredHost).toMatchObject({ connected: true, waitingForNextRound: false, isBot: false })
    expect(transferredHost.id).not.toBe(hostBeforeDisconnect.id)

    const returnedHostSocket = await connectedSocket(url)
    expect((await emitAck<RoomCredentials>(returnedHostSocket, 'room:reconnect', {
      code: roomCode,
      token: hostParticipant.credentials.token,
    })).ok).toBe(true)
    hostParticipant.socket = returnedHostSocket
    await waitFor(
      () => lobby.players.find((player) => player.id === hostBeforeDisconnect.id)?.connected === true
        && lobby.game?.phase !== 'waiting_for_reconnect',
      'the former host seat to reconnect without reclaiming ownership',
    )
    expect(lobby.players.filter((player) => player.isHost)).toEqual([
      expect.objectContaining({ id: transferredHost.id, connected: true }),
    ])

    const transferredHostParticipant = participants.find(
      (participant) => participant.credentials.playerId === transferredHost.id,
    )!
    const firstTargetId = configureTakeToFinish(gameServer, roomCode, transferredHost.id)
    expect((await emitAck(transferredHostParticipant.socket, 'game:take-right', {})).ok).toBe(true)
    expect(lobby).toMatchObject({ status: 'finished', game: { loserId: transferredHost.id } })
    expect(lobby.players.find((player) => player.id === firstTargetId)?.escaped).toBe(true)
    expect(lobby.players.filter((player) => player.waitingForNextRound).every((player) => player.rematchReady)).toBe(true)

    for (const participant of participants.slice(0, 3)) {
      expect((await emitAck(participant.socket, 'game:rematch-ready', { ready: true })).ok).toBe(true)
    }
    expect(gameServer.manager.view(lobby, transferredHost.id)).toMatchObject({ canStart: true, startBlockReason: null })
    expect((await emitAck(transferredHostParticipant.socket, 'game:start', {})).ok).toBe(true)
    expect(lobby).toMatchObject({ status: 'playing', session: { roundNumber: 2 } })
    expect(lobby.players).toHaveLength(8)
    expect(lobby.players.every((player) => !player.waitingForNextRound)).toBe(true)
    expect(lobby.players.reduce((total, player) => total + player.hand.length, 0)).toBe(52)
    expect(Math.max(...lobby.players.map((player) => player.hand.length))).toBe(7)
    expect(Math.min(...lobby.players.map((player) => player.hand.length))).toBe(6)
    await waitFor(
      () => participants.every(({ socket }) => latestStates.get(socket)?.status === 'playing'
        && latestStates.get(socket)?.players.every((player) => !player.waitingForNextRound)),
      'all eight clients to receive the second-round deal',
    )

    configureTakeToFinish(gameServer, roomCode, transferredHost.id)
    expect((await emitAck(transferredHostParticipant.socket, 'game:take-right', {})).ok).toBe(true)
    expect(lobby.status).toBe('finished')

    const leaveResults: RoomLeaveResult[] = []
    for (const participant of participants) {
      const left = await emitAck<RoomLeaveResult>(participant.socket, 'room:leave', {})
      expect(left.ok).toBe(true)
      leaveResults.push(left.data!)
    }
    expect(leaveResults.slice(0, -1).every((result) => !result.roomDeleted && !result.leftDuringPlay)).toBe(true)
    expect(leaveResults.at(-1)).toMatchObject({ code: roomCode, roomDeleted: true, leftDuringPlay: false })
    expect(gameServer.manager.rooms.has(roomCode)).toBe(false)
    await waitFor(
      () => participants.every(({ socket }) => {
        const serverSocket = gameServer?.io.sockets.sockets.get(socket.id ?? '')
        return Boolean(serverSocket && !serverSocket.rooms.has(roomCode)
          && serverSocket.data.roomCode === undefined && serverSocket.data.playerId === undefined)
      }),
      'all connected sockets to leave the deleted room',
    )
  }, 20_000)
})
