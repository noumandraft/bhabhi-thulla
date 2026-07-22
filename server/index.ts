import http from 'node:http'
import cors from 'cors'
import express from 'express'
import { Server } from 'socket.io'
import type { Ack, RoomCredentials } from '../shared/game.js'
import { GameManager, type Room } from './game.js'

const port = Number(process.env.PORT ?? 3001)
const origins = (process.env.CLIENT_ORIGIN ?? 'http://localhost:5173')
  .split(',')
  .map((origin) => origin.trim())

const app = express()
app.disable('x-powered-by')
app.use(cors({ origin: origins.includes('*') ? true : origins }))
app.get('/health', (_request, response) => {
  response.json({ ok: true, service: 'bhabhi-thulla-server', now: new Date().toISOString() })
})

const server = http.createServer(app)
const io = new Server(server, {
  cors: { origin: origins.includes('*') ? true : origins, methods: ['GET', 'POST'] },
  pingInterval: 20_000,
  pingTimeout: 20_000,
})
const manager = new GameManager()

function broadcast(room: Room): void {
  for (const player of room.players) {
    if (player.connected && player.socketId) {
      io.to(player.socketId).emit('room:state', manager.view(room, player.id))
    }
  }
}

manager.setPublisher(broadcast)

function safeAck<T>(ack: ((value: Ack<T>) => void) | undefined, action: () => T): T | undefined {
  try {
    const data = action()
    ack?.({ ok: true, data })
    return data
  } catch (error) {
    ack?.({ ok: false, error: error instanceof Error ? error.message : 'Something went wrong.' })
    return undefined
  }
}

io.on('connection', (socket) => {
  socket.on('room:create', (payload: { name?: string }, ack?: (value: Ack<RoomCredentials>) => void) => {
    safeAck(ack, () => {
      const result = manager.createRoom(payload?.name, socket.id)
      socket.data.roomCode = result.room.code
      socket.data.playerId = result.credentials.playerId
      void socket.join(result.room.code)
      queueMicrotask(() => broadcast(result.room))
      return result.credentials
    })
  })

  socket.on('room:join', (payload: { code?: string; name?: string }, ack?: (value: Ack<RoomCredentials>) => void) => {
    safeAck(ack, () => {
      const result = manager.joinRoom(payload?.code, payload?.name, socket.id)
      socket.data.roomCode = result.room.code
      socket.data.playerId = result.credentials.playerId
      void socket.join(result.room.code)
      queueMicrotask(() => broadcast(result.room))
      return result.credentials
    })
  })

  socket.on('room:reconnect', (payload: { code?: string; token?: string }, ack?: (value: Ack<RoomCredentials>) => void) => {
    safeAck(ack, () => {
      const result = manager.reconnectRoom(payload?.code, payload?.token, socket.id)
      socket.data.roomCode = result.room.code
      socket.data.playerId = result.credentials.playerId
      void socket.join(result.room.code)
      queueMicrotask(() => broadcast(result.room))
      return result.credentials
    })
  })

  socket.on('game:start', (_payload: unknown, ack?: (value: Ack) => void) => {
    safeAck(ack, () => {
      manager.startGame(socket.data.roomCode, socket.data.playerId)
      return undefined
    })
  })

  socket.on('game:play', (payload: { cardId?: string }, ack?: (value: Ack) => void) => {
    safeAck(ack, () => {
      manager.playCard(socket.data.roomCode, socket.data.playerId, payload?.cardId)
      return undefined
    })
  })

  socket.on('game:take-right', (_payload: unknown, ack?: (value: Ack) => void) => {
    safeAck(ack, () => {
      manager.takeRightHand(socket.data.roomCode, socket.data.playerId)
      return undefined
    })
  })

  socket.on('disconnect', () => {
    manager.disconnect(socket.id)
  })
})

setInterval(() => manager.removeStaleRooms(), 30 * 60 * 1000).unref()

server.listen(port, '0.0.0.0', () => {
  console.log(`Bhabhi Thulla server listening on port ${port}`)
})
