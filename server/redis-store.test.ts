import { createHash } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GameManager, type PersistenceStatus, type Room, type RoomPersistence } from './game.js'

const createClientMock = vi.hoisted(() => vi.fn())

vi.mock('redis', () => ({ createClient: createClientMock }))

import { createRoomPersistence, MemoryRoomStore, persistenceSnapshot, RedisRoomStore } from './store.js'

type RedisListener = (...values: unknown[]) => void

class FakeRedisClient {
  isOpen = false
  isReady = false
  private readonly listeners = new Map<string, RedisListener[]>()

  constructor(readonly values = new Map<string, string>()) {}

  on = vi.fn((event: string, listener: RedisListener) => {
    const listeners = this.listeners.get(event) ?? []
    listeners.push(listener)
    this.listeners.set(event, listeners)
    return this
  })

  connect = vi.fn(async () => {
    this.isOpen = true
    this.isReady = true
    this.emit('ready')
  })

  ping = vi.fn(async () => 'PONG')

  get = vi.fn(async (key: string) => this.values.get(key) ?? null)

  set = vi.fn(async (key: string, value: string, _options: { EX: number }) => {
    this.values.set(key, value)
    return 'OK'
  })

  del = vi.fn(async (key: string) => Number(this.values.delete(key)))

  scanIterator = vi.fn((options: { MATCH: string; COUNT: number }) => {
    const prefix = options.MATCH.endsWith('*') ? options.MATCH.slice(0, -1) : options.MATCH
    const keys = [...this.values.keys()].filter((key) => key.startsWith(prefix))
    return (async function* scan() {
      if (keys.length > 0) yield keys.slice(0, 2)
      for (const key of keys.slice(2)) yield key
    })()
  })

  quit = vi.fn(async () => {
    this.isOpen = false
    this.isReady = false
    return 'OK'
  })

  emit(event: string, ...values: unknown[]): void {
    for (const listener of this.listeners.get(event) ?? []) listener(...values)
  }
}

class RejectingRoomStore implements RoomPersistence {
  readonly save = vi.fn(async (_room: Room) => { throw new Error('save unavailable') })
  readonly delete = vi.fn(async (_code: string) => { throw new Error('delete unavailable') })
  async initialize(): Promise<void> {}
  async loadAll(): Promise<Room[]> { return [] }
  status(): PersistenceStatus { return { mode: 'test-failure', durable: false, ready: false } }
}

beforeEach(() => {
  createClientMock.mockReset()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('Redis room persistence contract', () => {
  it('round-trips a transport-safe room through a prefixed key with a six-hour TTL', async () => {
    const source = new GameManager()
    const created = source.createRoom('Durable Host', 'private-socket')
    const backend = new Map<string, string>()
    const writerClient = new FakeRedisClient(backend)
    const readerClient = new FakeRedisClient(backend)
    createClientMock.mockReturnValueOnce(writerClient).mockReturnValueOnce(readerClient)

    const writer = new RedisRoomStore('redis://local-test', 'test:room:', true)
    await writer.initialize()
    await writer.save(created.room)

    const key = `test:room:${created.room.code}`
    expect(createClientMock).toHaveBeenNthCalledWith(1, { url: 'redis://local-test' })
    expect(writerClient.connect).toHaveBeenCalledOnce()
    expect(writerClient.ping).toHaveBeenCalledOnce()
    expect(writerClient.set).toHaveBeenCalledWith(key, expect.any(String), { EX: 21_600 })
    const encoded = backend.get(key)!
    expect(encoded).not.toContain('socketId')
    expect(encoded).not.toContain('private-socket')
    expect(encoded).not.toContain(created.credentials.token)
    expect(JSON.parse(encoded).players[0]).toMatchObject({ connected: false, tokenHash: expect.any(String) })

    const reader = new RedisRoomStore('redis://local-test', 'test:room:', true)
    const restoredManager = new GameManager(reader)
    await restoredManager.initialize()
    expect(readerClient.scanIterator).toHaveBeenCalledWith({ MATCH: 'test:room:*', COUNT: 100 })
    expect(restoredManager.rooms.get(created.room.code)).toMatchObject({
      code: created.room.code,
      status: 'lobby',
      suspended: false,
      players: [{
        id: created.credentials.playerId,
        name: 'Durable Host',
        connected: false,
        socketId: null,
      }],
    })
    expect(reader.status()).toEqual({ mode: 'redis', durable: true, ready: true })

    await writer.delete(created.room.code)
    expect(writerClient.del).toHaveBeenCalledWith(key)
    expect(backend.has(key)).toBe(false)
    await writer.close()
    await restoredManager.close()
    expect(writerClient.quit).toHaveBeenCalledOnce()
    expect(readerClient.quit).toHaveBeenCalledOnce()
  })

  it('round-trips Party verifier state while keeping board presence and raw credentials out of Redis', async () => {
    const rawBoardToken = 'A'.repeat(43)
    const rawRequestId = '00000000-0000-4000-8000-000000000001'
    const source = new GameManager()
    const created = source.createRoom('Party Host', 'private-player-socket')
    const partyRoom = created.room as Room & {
      revision: number
      mode: 'party'
      partyBoard: {
        tokenHash: string
        creationRequestHash: string | null
        creationRequestExpiresAt: number | null
        socketId: string | null
        connected: boolean
        boardToken?: string
        requestId?: string
      }
    }
    partyRoom.revision = 29
    partyRoom.mode = 'party'
    partyRoom.partyBoard = {
      tokenHash: createHash('sha256').update(rawBoardToken).digest('hex'),
      creationRequestHash: createHash('sha256').update(rawRequestId).digest('hex'),
      creationRequestExpiresAt: Date.now() + 10 * 60 * 1000,
      socketId: 'private-board-socket',
      connected: true,
      boardToken: rawBoardToken,
      requestId: rawRequestId,
    }

    const backend = new Map<string, string>()
    const writerClient = new FakeRedisClient(backend)
    const readerClient = new FakeRedisClient(backend)
    createClientMock.mockReturnValueOnce(writerClient).mockReturnValueOnce(readerClient)

    const prefix = 'party-test:room:'
    const writer = new RedisRoomStore('redis://local-test', prefix, true)
    await writer.initialize()
    await writer.save(partyRoom)

    const key = `${prefix}${partyRoom.code}`
    expect(writerClient.set).toHaveBeenCalledWith(key, expect.any(String), { EX: 21_600 })
    const encoded = backend.get(key)!
    const stored = JSON.parse(encoded)
    expect(stored).toMatchObject({ mode: 'party', revision: 29 })
    expect(stored.partyBoard).toEqual({
      tokenHash: partyRoom.partyBoard.tokenHash,
      creationRequestHash: partyRoom.partyBoard.creationRequestHash,
      creationRequestExpiresAt: partyRoom.partyBoard.creationRequestExpiresAt,
    })
    expect(encoded).not.toContain('private-player-socket')
    expect(encoded).not.toContain('private-board-socket')
    expect(encoded).not.toContain(rawBoardToken)
    expect(encoded).not.toContain(rawRequestId)

    const reader = new RedisRoomStore('redis://local-test', prefix, true)
    const restoredManager = new GameManager(reader)
    await restoredManager.initialize()
    const restored = restoredManager.rooms.get(partyRoom.code)!
    expect(restored).toMatchObject({ mode: 'party', revision: 29 })
    expect(restored.partyBoard).toMatchObject({
      tokenHash: partyRoom.partyBoard.tokenHash,
      connected: false,
      socketId: null,
    })

    const rebound = restoredManager.reconnectPartyBoard(partyRoom.code, rawBoardToken, 'restored-board-socket')
    expect(rebound.room.partyBoard).toMatchObject({ connected: true, socketId: 'restored-board-socket' })

    await writer.close()
    await restoredManager.close()
  })

  it('loads only valid rooms under its prefix and ignores malformed Redis values', async () => {
    const source = new GameManager()
    const created = source.createRoom('Valid Host', 'socket-valid')
    const prefix = 'isolated:rooms:'
    const backend = new Map<string, string>([
      [`${prefix}${created.room.code}`, JSON.stringify(persistenceSnapshot(created.room))],
      [`${prefix}BROKEN`, '{not-json'],
      [`${prefix}INVALID`, JSON.stringify({ code: 'INVALID', players: [], status: 'unknown', updatedAt: Date.now() })],
      [`other:${created.room.code}`, JSON.stringify(persistenceSnapshot(created.room))],
    ])
    const client = new FakeRedisClient(backend)
    createClientMock.mockReturnValue(client)
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const store = new RedisRoomStore('redis://local-test', prefix)

    expect(await store.loadAll()).toEqual([persistenceSnapshot(created.room)])
    expect(client.scanIterator).toHaveBeenCalledWith({ MATCH: `${prefix}*`, COUNT: 100 })
    expect(client.get).not.toHaveBeenCalledWith(`other:${created.room.code}`)
    expect(warning).toHaveBeenCalledTimes(2)
  })

  it('sanitizes legacy and Party snapshots and ignores a Party room with an invalid board verifier', async () => {
    const source = new GameManager()
    const online = source.createRoom('Legacy Host', 'legacy-socket').room
    const legacy = JSON.parse(JSON.stringify(persistenceSnapshot(online))) as Record<string, unknown>
    delete legacy.mode
    delete legacy.revision
    delete legacy.partyBoard

    const party = JSON.parse(JSON.stringify(persistenceSnapshot(online))) as Record<string, unknown>
    party.code = 'PARTY'
    party.mode = 'party'
    party.revision = 8
    party.partyBoard = {
      tokenHash: 'e'.repeat(64),
      creationRequestHash: 'not-a-sha256-hash',
      creationRequestExpiresAt: Date.now() + 60_000,
      socketId: 'must-be-dropped',
      connected: true,
      boardToken: 'must-also-be-dropped',
    }
    party.suspended = true
    party.chat = { messages: ['private'] }

    const corruptParty = {
      ...party,
      code: 'BADBD',
      partyBoard: { tokenHash: 'too-short' },
    }
    const prefix = 'sanitized:rooms:'
    const backend = new Map<string, string>([
      [`${prefix}${online.code}`, JSON.stringify(legacy)],
      [`${prefix}PARTY`, JSON.stringify(party)],
      [`${prefix}BADBD`, JSON.stringify(corruptParty)],
    ])
    const client = new FakeRedisClient(backend)
    createClientMock.mockReturnValue(client)
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const store = new RedisRoomStore('redis://local-test', prefix)

    const loaded = await store.loadAll()
    expect(loaded).toHaveLength(2)
    expect(loaded.find((room) => room.code === online.code)).toMatchObject({
      mode: 'online', revision: 0, partyBoard: null,
    })
    const loadedParty = loaded.find((room) => room.code === 'PARTY')!
    expect(loadedParty).toMatchObject({ mode: 'party', revision: 8 })
    expect(loadedParty.partyBoard).toEqual({
      tokenHash: 'e'.repeat(64),
      creationRequestHash: null,
      creationRequestExpiresAt: null,
    })
    expect(loadedParty).not.toHaveProperty('suspended')
    expect(loadedParty).not.toHaveProperty('chat')
    expect(loadedParty.partyBoard).not.toHaveProperty('socketId')
    expect(loadedParty.partyBoard).not.toHaveProperty('connected')
    expect(JSON.stringify(loadedParty)).not.toContain('must-be-dropped')
    expect(JSON.stringify(loadedParty)).not.toContain('must-also-be-dropped')
    expect(JSON.stringify(loadedParty)).not.toContain('private')
    expect(warning).toHaveBeenCalledOnce()
  })

  it('uses memory without a Redis URL and honors configured prefix and durability flags', async () => {
    expect(createRoomPersistence({})).toBeInstanceOf(MemoryRoomStore)
    expect(createRoomPersistence({ REDIS_URL: '   ' })).toBeInstanceOf(MemoryRoomStore)

    const client = new FakeRedisClient()
    createClientMock.mockReturnValue(client)
    const configured = createRoomPersistence({
      REDIS_URL: '  redis://configured-test  ',
      REDIS_KEY_PREFIX: '  configured:room:  ',
      REDIS_DURABLE: ' TRUE ',
    })
    expect(configured).toBeInstanceOf(RedisRoomStore)
    expect(configured.status()).toEqual({ mode: 'redis', durable: true, ready: false })

    const source = new GameManager()
    const created = source.createRoom('Configured Host', 'configured-socket')
    await configured.save(created.room)
    expect(createClientMock).toHaveBeenCalledWith({ url: 'redis://configured-test' })
    expect(client.set).toHaveBeenCalledWith(
      `configured:room:${created.room.code}`,
      expect.any(String),
      { EX: 21_600 },
    )
  })

  it('reports Redis errors until ready fires again', () => {
    const client = new FakeRedisClient()
    createClientMock.mockReturnValue(client)
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const store = new RedisRoomStore('redis://local-test', 'status:', true)

    client.emit('error', new Error('connection dropped'))
    expect(store.status()).toEqual({
      mode: 'redis', durable: true, ready: false, error: 'connection dropped',
    })
    expect(logged).toHaveBeenCalledWith('redis_error', { category: 'persistence' })

    client.isReady = true
    client.emit('ready')
    expect(store.status()).toEqual({ mode: 'redis', durable: true, ready: true })
  })

  it('keeps live rooms usable when asynchronous persistence writes or deletes fail', async () => {
    const store = new RejectingRoomStore()
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const manager = new GameManager(store)
    await manager.initialize()

    const created = manager.createRoom('Fallback Host', 'fallback-socket')
    expect(manager.rooms.get(created.room.code)).toBe(created.room)
    await vi.waitFor(() => expect(logged).toHaveBeenCalledWith(
      'room_store_save_failed',
      { category: 'persistence' },
    ))

    expect(manager.leaveRoom(created.room.code, created.credentials.playerId, 'fallback-socket')).toMatchObject({
      roomDeleted: true,
    })
    expect(manager.rooms.has(created.room.code)).toBe(false)
    await vi.waitFor(() => expect(logged).toHaveBeenCalledWith(
      'room_store_delete_failed',
      { category: 'persistence' },
    ))
  })
})
