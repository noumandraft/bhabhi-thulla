import { createClient, type RedisClientType } from 'redis'
import type { RoomMode } from '../shared/game.js'
import type { PartyBoard, PersistenceStatus, Player, Room, RoomPersistence } from './game.js'

const DEFAULT_TTL_SECONDS = 6 * 60 * 60
const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/

interface PersistedPartyBoard {
  tokenHash: string
  creationRequestHash: string | null
  creationRequestExpiresAt: number | null
}

export type PersistedRoom = Omit<Room, 'players' | 'suspended' | 'partyBoard'> & {
  players: Omit<Player, 'socketId'>[]
  revision: number
  mode: RoomMode
  partyBoard: PersistedPartyBoard | null
}

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
  return {
    id: player.id,
    tokenHash: player.tokenHash,
    name: player.name,
    hand: player.hand,
    // Human transport presence is process-local. Bots are always available to the game engine.
    connected: player.isBot,
    escaped: player.escaped,
    isHost: player.isHost,
    ready: player.ready,
    isBot: player.isBot,
    rematchReady: player.rematchReady,
    waitingForNextRound: player.waitingForNextRound,
    joinedInRound: player.joinedInRound,
    reconnectGraceUsed: player.reconnectGraceUsed,
    usesReadyProtocol: player.usesReadyProtocol,
  }
}

function persistedPartyBoard(board: PartyBoard | null): PersistedPartyBoard | null {
  if (!board || !SHA256_HEX_PATTERN.test(board.tokenHash)) return null
  const requestActive = Boolean(
    board.creationRequestHash
    && SHA256_HEX_PATTERN.test(board.creationRequestHash)
    && board.creationRequestExpiresAt
    && board.creationRequestExpiresAt > Date.now(),
  )
  return {
    tokenHash: board.tokenHash,
    creationRequestHash: requestActive ? board.creationRequestHash : null,
    creationRequestExpiresAt: requestActive ? board.creationRequestExpiresAt : null,
  }
}

export function persistenceSnapshot(room: Room): PersistedRoom {
  const mode: RoomMode = room.mode === 'party' ? 'party' : 'online'
  return {
    code: room.code,
    status: room.status,
    players: room.players.map(persistedPlayer),
    game: room.game,
    settings: room.settings,
    session: room.session,
    updatedAt: room.updatedAt,
    revision: Number.isInteger(room.revision) && room.revision >= 0 ? room.revision : 0,
    mode,
    partyBoard: mode === 'party' ? persistedPartyBoard(room.partyBoard) : null,
  }
}

function record(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function safePartyBoard(value: unknown): PersistedPartyBoard | null {
  const board = record(value)
  if (!board || typeof board.tokenHash !== 'string' || !SHA256_HEX_PATTERN.test(board.tokenHash)) return null
  const requestActive = typeof board.creationRequestHash === 'string'
    && SHA256_HEX_PATTERN.test(board.creationRequestHash)
    && typeof board.creationRequestExpiresAt === 'number'
    && Number.isFinite(board.creationRequestExpiresAt)
    && board.creationRequestExpiresAt > Date.now()
  return {
    tokenHash: board.tokenHash,
    creationRequestHash: requestActive ? board.creationRequestHash as string : null,
    creationRequestExpiresAt: requestActive ? board.creationRequestExpiresAt as number : null,
  }
}

function safePersistedPlayer(value: unknown): Omit<Player, 'socketId'> | null {
  const player = record(value)
  if (!player || typeof player.id !== 'string' || typeof player.tokenHash !== 'string' || typeof player.name !== 'string') return null
  if (!Array.isArray(player.hand) || typeof player.isBot !== 'boolean') return null
  return {
    id: player.id,
    tokenHash: player.tokenHash,
    name: player.name,
    hand: player.hand as Player['hand'],
    connected: player.isBot,
    escaped: Boolean(player.escaped),
    isHost: Boolean(player.isHost),
    ready: Boolean(player.ready),
    isBot: player.isBot,
    rematchReady: Boolean(player.rematchReady),
    waitingForNextRound: Boolean(player.waitingForNextRound),
    joinedInRound: typeof player.joinedInRound === 'number' ? player.joinedInRound : 1,
    reconnectGraceUsed: Boolean(player.reconnectGraceUsed),
    usesReadyProtocol: Boolean(player.usesReadyProtocol),
  }
}

function safePersistedRoom(value: unknown): Room | null {
  const source = record(value)
  if (!source) return null
  if (typeof source.code !== 'string' || !Array.isArray(source.players)) return null
  if (source.status !== 'lobby' && source.status !== 'playing' && source.status !== 'finished') return null
  if (typeof source.updatedAt !== 'number' || !Number.isFinite(source.updatedAt)) return null
  if (source.mode !== undefined && source.mode !== 'online' && source.mode !== 'party') return null

  const players = source.players.map(safePersistedPlayer)
  if (players.some((player) => player === null)) return null

  const mode: RoomMode = source.mode === 'party' ? 'party' : 'online'
  const partyBoard = mode === 'party' ? safePartyBoard(source.partyBoard) : null
  if (mode === 'party' && !partyBoard) return null

  const revision = typeof source.revision === 'number'
    && Number.isInteger(source.revision)
    && source.revision >= 0
    ? source.revision
    : 0

  // Build from an allowlist so unexpected persisted fields (including transport
  // presence, raw credentials, suspension, and chat data) never enter live state.
  return {
    code: source.code,
    status: source.status,
    players: players as Omit<Player, 'socketId'>[],
    game: (source.game ?? null) as Room['game'],
    settings: source.settings as Room['settings'],
    session: source.session as Room['session'],
    updatedAt: source.updatedAt,
    revision,
    mode,
    partyBoard,
  } as unknown as Room
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
      console.error('redis_error', { category: 'persistence' })
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
          const room = safePersistedRoom(parsed)
          if (room) rooms.push(room)
          else console.warn('redis_room_ignored', { category: 'persistence', reason: 'invalid_shape' })
        } catch {
          console.warn('redis_room_ignored', { category: 'persistence', reason: 'invalid_json' })
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
