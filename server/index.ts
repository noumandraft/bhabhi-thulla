import http from 'node:http'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import cors from 'cors'
import express from 'express'
import { Server, type Socket } from 'socket.io'
import {
  PROTOCOL_VERSION,
  type Ack,
  type ChatHistory,
  type ChatMessage,
  type ReactionEvent,
  type RoomCredentials,
  type RoomLeaveResult,
  type ServerHello,
} from '../shared/game.js'
import { GameManager, type Room } from './game.js'
import { createRoomPersistence } from './store.js'

interface WindowCounter {
  count: number
  resetsAt: number
}

export class RateLimiter {
  private readonly counters = new Map<string, WindowCounter>()

  consume(key: string, limit: number, windowMs: number): boolean {
    const now = Date.now()
    const current = this.counters.get(key)
    if (!current || current.resetsAt <= now) {
      this.counters.set(key, { count: 1, resetsAt: now + windowMs })
      return true
    }
    current.count += 1
    return current.count <= limit
  }

  cleanup(): void {
    const now = Date.now()
    for (const [key, value] of this.counters) if (value.resetsAt <= now) this.counters.delete(key)
  }
}

function recordPayload(value: unknown, allowedKeys: string[] = []): Record<string, unknown> {
  if (value === undefined || value === null) return {}
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid request.')
  const result = value as Record<string, unknown>
  if (Object.keys(result).some((key) => !allowedKeys.includes(key))) throw new Error('Invalid request fields.')
  return result
}

function textField(payload: Record<string, unknown>, key: string, maxLength: number, required = true): string | undefined {
  const value = payload[key]
  if (value === undefined && !required) return undefined
  if (typeof value !== 'string' || value.length > maxLength) throw new Error(`Invalid ${key}.`)
  return value
}

function booleanField(payload: Record<string, unknown>, key: string): boolean {
  const value = payload[key]
  if (typeof value !== 'boolean') throw new Error(`Invalid ${key}.`)
  return value
}

function clientIp(socket: Socket): string {
  const forwarded = socket.handshake.headers['x-forwarded-for']
  const firstForwarded = Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(',')[0]
  return firstForwarded?.trim() || socket.handshake.address || 'unknown'
}

function originsFrom(environment: NodeJS.ProcessEnv): string[] | true {
  const values = (environment.CLIENT_ORIGIN ?? 'http://localhost:5173')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
  if (environment.NODE_ENV === 'production' && values.includes('*')) {
    throw new Error('CLIENT_ORIGIN must be an explicit comma-separated allowlist in production.')
  }
  return values.includes('*') ? true : values
}

export interface GameServer {
  app: express.Express
  server: http.Server
  io: Server
  manager: GameManager
  listen(port?: number): Promise<number>
  close(): Promise<void>
}

export async function createGameServer(environment: NodeJS.ProcessEnv = process.env): Promise<GameServer> {
  const allowedOrigins = originsFrom(environment)
  const manager = new GameManager(createRoomPersistence(environment))
  await manager.initialize()
  const limiter = new RateLimiter()
  const connectionsByIp = new Map<string, number>()

  const app = express()
  app.disable('x-powered-by')
  app.set('trust proxy', 1)
  app.use(cors({ origin: allowedOrigins }))
  app.use(express.json({ limit: '16kb' }))

  app.get('/health', (_request, response) => {
    const persistence = manager.persistenceStatus()
    response.json({
      ok: true,
      service: 'bhabhi-thulla-server',
      now: new Date().toISOString(),
      protocolVersion: PROTOCOL_VERSION,
      version: environment.RENDER_GIT_COMMIT ?? environment.COMMIT_SHA ?? environment.npm_package_version ?? 'development',
      persistence: { mode: persistence.mode, durable: persistence.durable },
    })
  })

  app.get('/ready', (_request, response) => {
    const persistence = manager.persistenceStatus()
    response.status(persistence.ready ? 200 : 503).json({
      ok: persistence.ready,
      service: 'bhabhi-thulla-server',
      protocolVersion: PROTOCOL_VERSION,
      persistence,
    })
  })

  const server = http.createServer(app)
  const io = new Server(server, {
    cors: { origin: allowedOrigins, methods: ['GET', 'POST'] },
    pingInterval: 20_000,
    pingTimeout: 20_000,
    maxHttpBufferSize: 32 * 1024,
    perMessageDeflate: false,
  })

  function broadcast(room: Room): void {
    for (const player of room.players) {
      if (player.connected && player.socketId) io.to(player.socketId).emit('room:state', manager.view(room, player.id))
    }
  }

  function broadcastChat(room: Room, message: ChatMessage): void {
    for (const player of room.players) {
      if (!player.isBot && player.connected && player.socketId) {
        io.to(player.socketId).emit('room:chat:message', message)
      }
    }
  }

  function broadcastReaction(room: Room, reaction: ReactionEvent): void {
    for (const player of room.players) {
      if (!player.isBot && player.connected && player.socketId) {
        io.to(player.socketId).emit('room:reaction', reaction)
      }
    }
  }

  manager.setPublisher(broadcast)

  function safeAck<T>(
    socket: Socket,
    event: string,
    ack: unknown,
    action: () => T | void,
  ): T | undefined {
    const respond = typeof ack === 'function' ? ack as (value: Ack<T>) => void : undefined
    try {
      if (!limiter.consume(`socket:${socket.id}:all`, 180, 60_000)) throw new Error('Too many requests. Please slow down.')
      const data = action()
      respond?.(data === undefined ? { ok: true } : { ok: true, data: data as T })
      return data as T | undefined
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Something went wrong.'
      console.warn('socket_action_rejected', {
        event,
        roomCode: typeof socket.data.roomCode === 'string' ? socket.data.roomCode : null,
        ip: clientIp(socket),
        error: message,
      })
      respond?.({ ok: false, error: message })
      return undefined
    }
  }

  function requireSeat(socket: Socket): { roomCode: string; playerId: string } {
    const roomCode = typeof socket.data.roomCode === 'string' ? socket.data.roomCode : ''
    const playerId = typeof socket.data.playerId === 'string' ? socket.data.playerId : ''
    if (!manager.socketOwnsSeat(roomCode, playerId, socket.id)) throw new Error('Reconnect to your seat and try again.')
    return { roomCode, playerId }
  }

  function requireUnseated(socket: Socket): void {
    if (manager.socketHasSeat(socket.id)) throw new Error('This connection is already seated in a room. Leave it before joining another.')
  }

  io.on('connection', (socket) => {
    const ip = clientIp(socket)
    const usesReadyProtocol = socket.handshake.auth?.protocolVersion === PROTOCOL_VERSION
    socket.emit('server:hello', {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: ['chat-v1'],
    } satisfies ServerHello)
    const connectionCount = (connectionsByIp.get(ip) ?? 0) + 1
    connectionsByIp.set(ip, connectionCount)
    if (connectionCount > 12) {
      connectionsByIp.set(ip, connectionCount - 1)
      socket.emit('server:error', { error: 'Too many simultaneous connections from this network.' })
      socket.disconnect(true)
      return
    }

    socket.on('room:create', (raw: unknown, ack?: (value: Ack<RoomCredentials>) => void) => {
      safeAck(socket, 'room:create', ack, () => {
        requireUnseated(socket)
        if (!limiter.consume(`ip:${ip}:create`, 5, 10 * 60_000)) throw new Error('Too many rooms created. Please try again later.')
        const payload = recordPayload(raw, ['name'])
        const result = manager.createRoom(textField(payload, 'name', 80), socket.id, usesReadyProtocol)
        socket.data.roomCode = result.room.code
        socket.data.playerId = result.credentials.playerId
        void socket.join(result.room.code)
        queueMicrotask(() => broadcast(result.room))
        return result.credentials
      })
    })

    socket.on('room:join', (raw: unknown, ack?: (value: Ack<RoomCredentials>) => void) => {
      safeAck(socket, 'room:join', ack, () => {
        requireUnseated(socket)
        if (!limiter.consume(`ip:${ip}:join`, 30, 10 * 60_000)) throw new Error('Too many join attempts. Please try again later.')
        const payload = recordPayload(raw, ['code', 'name'])
        const result = manager.joinRoom(textField(payload, 'code', 12), textField(payload, 'name', 80), socket.id, usesReadyProtocol)
        socket.data.roomCode = result.room.code
        socket.data.playerId = result.credentials.playerId
        void socket.join(result.room.code)
        queueMicrotask(() => broadcast(result.room))
        return result.credentials
      })
    })

    socket.on('room:reconnect', (raw: unknown, ack?: (value: Ack<RoomCredentials>) => void) => {
      safeAck(socket, 'room:reconnect', ack, () => {
        requireUnseated(socket)
        if (!limiter.consume(`ip:${ip}:reconnect`, 60, 10 * 60_000)) throw new Error('Too many reconnect attempts. Please try again later.')
        const payload = recordPayload(raw, ['code', 'token'])
        const result = manager.reconnectRoom(
          textField(payload, 'code', 12),
          textField(payload, 'token', 160),
          socket.id,
          usesReadyProtocol,
        )
        socket.data.roomCode = result.room.code
        socket.data.playerId = result.credentials.playerId
        void socket.join(result.room.code)
        queueMicrotask(() => broadcast(result.room))
        return result.credentials
      })
    })

    socket.on('room:ready', (raw: unknown, ack?: (value: Ack) => void) => {
      safeAck(socket, 'room:ready', ack, () => {
        const seat = requireSeat(socket)
        const payload = recordPayload(raw, ['ready'])
        manager.setReady(seat.roomCode, seat.playerId, booleanField(payload, 'ready'))
      })
    })

    socket.on('room:leave', (raw: unknown, ack?: (value: Ack<RoomLeaveResult>) => void) => {
      safeAck(socket, 'room:leave', ack, () => {
        recordPayload(raw)
        const seat = requireSeat(socket)
        const result = manager.leaveRoom(seat.roomCode, seat.playerId, socket.id)
        delete socket.data.roomCode
        delete socket.data.playerId
        void socket.leave(seat.roomCode)
        return result
      })
    })

    socket.on('room:settings', (raw: unknown, ack?: (value: Ack) => void) => {
      safeAck(socket, 'room:settings', ack, () => {
        const seat = requireSeat(socket)
        const payload = recordPayload(raw, ['turnSeconds', 'allowBots', 'reactionsEnabled', 'tutorialHints', 'chatMode'])
        manager.updateSettings(seat.roomCode, seat.playerId, payload)
      })
    })

    socket.on('room:kick', (raw: unknown, ack?: (value: Ack) => void) => {
      safeAck(socket, 'room:kick', ack, () => {
        const seat = requireSeat(socket)
        const payload = recordPayload(raw, ['playerId'])
        const removed = manager.kickPlayer(seat.roomCode, seat.playerId, textField(payload, 'playerId', 64))
        if (removed.socketId) {
          io.to(removed.socketId).emit('room:kicked', { code: seat.roomCode })
          const removedSocket = io.sockets.sockets.get(removed.socketId)
          if (removedSocket) {
            delete removedSocket.data.roomCode
            delete removedSocket.data.playerId
            void removedSocket.leave(seat.roomCode)
          }
        }
      })
    })

    socket.on('room:add-bot', (raw: unknown, ack?: (value: Ack) => void) => {
      safeAck(socket, 'room:add-bot', ack, () => {
        const seat = requireSeat(socket)
        const payload = recordPayload(raw, ['name'])
        manager.addBot(seat.roomCode, seat.playerId, textField(payload, 'name', 80, false))
      })
    })

    socket.on('room:remove-bot', (raw: unknown, ack?: (value: Ack) => void) => {
      safeAck(socket, 'room:remove-bot', ack, () => {
        const seat = requireSeat(socket)
        const payload = recordPayload(raw, ['playerId'])
        manager.removeBot(seat.roomCode, seat.playerId, textField(payload, 'playerId', 64))
      })
    })

    socket.on('game:replace-with-bot', (raw: unknown, ack?: (value: Ack) => void) => {
      safeAck(socket, 'game:replace-with-bot', ack, () => {
        const seat = requireSeat(socket)
        const payload = recordPayload(raw, ['playerId'])
        manager.replaceDisconnectedWithBot(seat.roomCode, seat.playerId, textField(payload, 'playerId', 64))
      })
    })

    socket.on('room:react', (raw: unknown, ack?: (value: Ack<ReactionEvent>) => void) => {
      safeAck(socket, 'room:react', ack, () => {
        const seat = requireSeat(socket)
        if (!limiter.consume(`seat:${seat.roomCode}:${seat.playerId}:reaction`, 6, 10_000)) {
          throw new Error('Please wait before sending another reaction.')
        }
        const payload = recordPayload(raw, ['reaction'])
        const reaction = manager.createReaction(seat.roomCode, seat.playerId, textField(payload, 'reaction', 24))
        broadcastReaction(manager.rooms.get(seat.roomCode)!, reaction)
        return reaction
      })
    })

    socket.on('room:chat:history', (raw: unknown, ack?: (value: Ack<ChatHistory>) => void) => {
      safeAck(socket, 'room:chat:history', ack, () => {
        recordPayload(raw)
        const seat = requireSeat(socket)
        return manager.chatHistory(seat.roomCode, seat.playerId)
      })
    })

    socket.on('room:chat:send', (raw: unknown, ack?: (value: Ack<ChatMessage>) => void) => {
      safeAck(socket, 'room:chat:send', ack, () => {
        const seat = requireSeat(socket)
        const payload = recordPayload(raw, ['clientMessageId', 'text'])
        const limiterKey = `seat:${seat.roomCode}:${seat.playerId}:chat`
        const result = manager.createChatMessage(
          seat.roomCode,
          seat.playerId,
          textField(payload, 'clientMessageId', 64),
          textField(payload, 'text', 1_000),
          () => {
            if (!limiter.consume(`${limiterKey}:burst`, 5, 10_000)
              || !limiter.consume(`${limiterKey}:minute`, 25, 60_000)) {
              throw new Error('Please wait before sending another message.')
            }
          },
        )
        if (result.created) broadcastChat(manager.rooms.get(seat.roomCode)!, result.message)
        return result.message
      })
    })

    socket.on('game:start', (raw: unknown, ack?: (value: Ack) => void) => {
      safeAck(socket, 'game:start', ack, () => {
        recordPayload(raw)
        const seat = requireSeat(socket)
        manager.startGame(seat.roomCode, seat.playerId)
      })
    })

    socket.on('game:play', (raw: unknown, ack?: (value: Ack) => void) => {
      safeAck(socket, 'game:play', ack, () => {
        const seat = requireSeat(socket)
        const payload = recordPayload(raw, ['cardId'])
        manager.playCard(seat.roomCode, seat.playerId, textField(payload, 'cardId', 32))
      })
    })

    socket.on('game:take-right', (raw: unknown, ack?: (value: Ack) => void) => {
      safeAck(socket, 'game:take-right', ack, () => {
        recordPayload(raw)
        const seat = requireSeat(socket)
        manager.takeRightHand(seat.roomCode, seat.playerId)
      })
    })

    socket.on('game:rematch-ready', (raw: unknown, ack?: (value: Ack) => void) => {
      safeAck(socket, 'game:rematch-ready', ack, () => {
        const seat = requireSeat(socket)
        const payload = recordPayload(raw, ['ready'])
        manager.setRematchReady(seat.roomCode, seat.playerId, booleanField(payload, 'ready'))
      })
    })

    socket.on('game:reset-session', (raw: unknown, ack?: (value: Ack) => void) => {
      safeAck(socket, 'game:reset-session', ack, () => {
        recordPayload(raw)
        const seat = requireSeat(socket)
        manager.resetSession(seat.roomCode, seat.playerId)
      })
    })

    socket.on('disconnect', () => {
      const current = connectionsByIp.get(ip) ?? 1
      if (current <= 1) connectionsByIp.delete(ip)
      else connectionsByIp.set(ip, current - 1)
      manager.disconnect(socket.id)
    })
  })

  const maintenanceTimer = setInterval(() => {
    manager.removeStaleRooms()
    limiter.cleanup()
  }, 30 * 60 * 1000)
  maintenanceTimer.unref()

  return {
    app,
    server,
    io,
    manager,
    listen(port = Number(environment.PORT ?? 3001)): Promise<number> {
      return new Promise((fulfill, reject) => {
        server.once('error', reject)
        server.listen(port, '0.0.0.0', () => {
          server.off('error', reject)
          const address = server.address()
          const actualPort = typeof address === 'object' && address ? address.port : port
          console.log(`Bhabhi Thulla server listening on port ${actualPort}`)
          fulfill(actualPort)
        })
      })
    },
    async close(): Promise<void> {
      clearInterval(maintenanceTimer)
      await new Promise<void>((fulfill) => io.close(() => fulfill()))
      await manager.close()
    },
  }
}

const entryPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : ''
if (entryPath === import.meta.url) {
  const gameServer = await createGameServer()
  await gameServer.listen()
}
