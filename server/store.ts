import { createClient, type RedisClientType } from 'redis'
import type { PersistenceStatus, Player, Room, RoomPersistence } from './game.js'

const DEFAULT_TTL_SECONDS = 6 * 60 * 60

/**
 * Development/default store. It intentionally does not pretend to survive a process restart.
 * GameManager owns the live Map; this adapter only reports the durability contract.
 */
export class MemoryRoomStore implements RoomPersistence {
  async initialize(): Promise<void> {}
  async loadAll(): Promise<Room[]> { return [] }
  async save(_room: Room): Promise<void> {}
  async delete(_code: string): Promise<void> {}
  status(): PersistenceStatus { return { mode: 'memory', durable: false, ready: true } }
}

function persistedPlayer(player: Player): Omit<Player, 'socketId'> {
  const { socketId: _socketId, ...safe } = player
  return {
    ...safe,
    // Human transport presence is process-local. Bots are always available to the game engine.
    connected: safe.isBot,
  }
}

export function persistenceSnapshot(room: Room): Omit<Room, 'players' | 'suspended'> & { players: Omit<Player, 'socketId'>[] } {
  const { suspended: _suspended, ...safe } = room
  return {
    ...safe,
    players: room.players.map(persistedPlayer),
  }
}

function looksLikeRoom(value: unknown): value is Room {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const room = value as Partial<Room>
  return typeof room.code === 'string'
    && Array.isArray(room.players)
    && (room.status === 'lobby' || room.status === 'playing' || room.status === 'finished')
    && typeof room.updatedAt === 'number'
}

export class RedisRoomStore implements RoomPersistence {
  private readonly client: RedisClientType
  private readonly prefix: string
  private readonly durable: boolean
  private lastError: string | undefined

  constructor(url: string, prefix = 'bhabhi-thulla:room:', durable = false) {
    this.prefix = prefix
    this.durable = durable
    this.client = createClient({ url })
    this.client.on('error', (error) => {
      this.lastError = error instanceof Error ? error.message : String(error)
      console.error('redis_error', { error: this.lastError })
    })
    this.client.on('ready', () => { this.lastError = undefined })
  }

  async initialize(): Promise<void> {
    await this.client.connect()
    await this.client.ping()
  }

  async loadAll(): Promise<Room[]> {
    const rooms: Room[] = []
    for await (const scanned of this.client.scanIterator({ MATCH: `${this.prefix}*`, COUNT: 100 })) {
      const keys = Array.isArray(scanned) ? scanned : [scanned]
      for (const key of keys) {
        const encoded = await this.client.get(key)
        if (!encoded) continue
        try {
          const parsed: unknown = JSON.parse(encoded)
          if (looksLikeRoom(parsed)) rooms.push(parsed)
          else console.warn('redis_room_ignored', { key, reason: 'invalid_shape' })
        } catch (error) {
          console.warn('redis_room_ignored', { key, reason: error instanceof Error ? error.message : String(error) })
        }
      }
    }
    return rooms
  }

  async save(room: Room): Promise<void> {
    await this.client.set(`${this.prefix}${room.code}`, JSON.stringify(persistenceSnapshot(room)), { EX: DEFAULT_TTL_SECONDS })
  }

  async delete(code: string): Promise<void> {
    await this.client.del(`${this.prefix}${code}`)
  }

  async close(): Promise<void> {
    if (this.client.isOpen) await this.client.quit()
  }

  status(): PersistenceStatus {
    return {
      mode: 'redis',
      durable: this.durable,
      ready: this.client.isReady,
      ...(this.lastError ? { error: this.lastError } : {}),
    }
  }
}

export function createRoomPersistence(environment: NodeJS.ProcessEnv = process.env): RoomPersistence {
  const redisUrl = environment.REDIS_URL?.trim()
  if (!redisUrl) return new MemoryRoomStore()
  return new RedisRoomStore(
    redisUrl,
    environment.REDIS_KEY_PREFIX?.trim() || undefined,
    environment.REDIS_DURABLE?.trim().toLowerCase() === 'true',
  )
}
