import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GameManager, type PersistenceStatus, type Room, type RoomPersistence } from './game.js'
import { MemoryRoomStore, persistenceSnapshot } from './store.js'

class CaptureStore implements RoomPersistence {
  saved: Room[] = []
  constructor(private readonly restored: Room[] = []) {}
  async initialize(): Promise<void> {}
  async loadAll(): Promise<Room[]> { return this.restored }
  async save(room: Room): Promise<void> { this.saved.push(JSON.parse(JSON.stringify(persistenceSnapshot(room))) as Room) }
  async delete(_code: string): Promise<void> {}
  status(): PersistenceStatus { return { mode: 'test', durable: true, ready: true } }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-07-27T12:00:00.000Z'))
})

afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
})

describe('room persistence', () => {
  it('reports the memory fallback as ready but explicitly non-durable', () => {
    expect(new MemoryRoomStore().status()).toEqual({ mode: 'memory', durable: false, ready: true })
  })

  it('never serializes socket ids or raw reconnect tokens', () => {
    const store = new CaptureStore()
    const manager = new GameManager(store)
    const created = manager.createRoom('Host Player', 'sensitive-socket-id')
    const serialized = JSON.stringify(persistenceSnapshot(created.room))
    expect(serialized).not.toContain('socketId')
    expect(serialized).not.toContain('sensitive-socket-id')
    expect(serialized).not.toContain(created.credentials.token)
    expect(serialized).toContain('tokenHash')
  })

  it('keeps Table Talk message content outside persisted room snapshots', () => {
    const store = new CaptureStore()
    const manager = new GameManager(store)
    const created = manager.createRoom('Chat Host', 'chat-socket')
    manager.createChatMessage(
      created.room.code,
      created.credentials.playerId,
      '00000000-0000-4000-8000-000000000001',
      'This private message must stay ephemeral.',
    )
    const serialized = JSON.stringify(persistenceSnapshot(created.room))
    expect(serialized).not.toContain('This private message must stay ephemeral.')
    expect(serialized).not.toContain('clientMessageId')
  })

  it('starts a fresh empty chat epoch when a persisted room is restored', async () => {
    const first = new GameManager(new CaptureStore())
    const created = first.createRoom('Chat Host', 'chat-socket')
    const sent = first.createChatMessage(
      created.room.code,
      created.credentials.playerId,
      '00000000-0000-4000-8000-000000000001',
      'Ephemeral before restart',
    )
    const restored = JSON.parse(JSON.stringify(persistenceSnapshot(created.room))) as Room
    const second = new GameManager(new CaptureStore([restored]))
    await second.initialize()
    const history = second.chatHistory(created.room.code, created.credentials.playerId)
    expect(history.messages).toEqual([])
    expect(history.epoch).not.toBe(sent.message.epoch)
  })

  it('normalizes restored seats without a capability flag as legacy-compatible', async () => {
    const first = new GameManager(new CaptureStore())
    const created = first.createRoom('Old Player', 'old-socket')
    const restored = JSON.parse(JSON.stringify(persistenceSnapshot(created.room))) as Room
    const oldPlayer = restored.players[0] as typeof restored.players[0] & { usesReadyProtocol?: boolean }
    delete oldPlayer.usesReadyProtocol
    oldPlayer.ready = false
    oldPlayer.rematchReady = false
    const second = new GameManager(new CaptureStore([restored]))
    await second.initialize()
    expect(second.rooms.get(created.room.code)?.players[0]).toMatchObject({
      usesReadyProtocol: false,
      ready: true,
      rematchReady: true,
    })
  })

  it('restores an active room suspended and preserves its absolute reconnect deadline', async () => {
    const firstStore = new CaptureStore()
    const first = new GameManager(firstStore)
    const created = first.createRoom('Host Player', 'socket-0')
    const joinedOne = first.joinRoom(created.room.code, 'Player One', 'socket-1')
    const joinedTwo = first.joinRoom(created.room.code, 'Player Two', 'socket-2')
    for (const player of created.room.players) first.setReady(created.room.code, player.id, true)
    first.startGame(created.room.code, created.credentials.playerId)
    const active = created.room.players.find((player) => player.id === created.room.game?.currentTurnId)!
    const activeIndex = created.room.players.indexOf(active)
    const activeCredentials = [created.credentials, joinedOne.credentials, joinedTwo.credentials][activeIndex]
    first.disconnect(`socket-${activeIndex}`)
    const originalReconnectEndsAt = created.room.game!.reconnectEndsAt
    const restoredData = JSON.parse(JSON.stringify(persistenceSnapshot(created.room))) as Room

    vi.advanceTimersByTime(30_000)
    const second = new GameManager(new CaptureStore([restoredData]))
    await second.initialize()
    const room = second.rooms.get(created.room.code)!
    expect(room.game?.reconnectEndsAt).toBe(originalReconnectEndsAt)
    const before = JSON.stringify(room)
    await vi.advanceTimersByTimeAsync(20_000)
    expect(room.suspended).toBe(true)
    expect(JSON.stringify(room)).toBe(before)
    expect(room.players.filter((player) => !player.isBot).every((player) => !player.connected)).toBe(true)

    second.reconnectRoom(room.code, activeCredentials.token, 'restored-socket')
    expect(room.suspended).toBe(false)
    expect(room.players.find((player) => player.id === activeCredentials.playerId)).toMatchObject({
      connected: true, socketId: 'restored-socket',
    })
    expect(room.game).toMatchObject({ phase: 'turn', reconnectEndsAt: null, turnEndsAt: Date.now() + 35_000 })
    expect(() => second.reconnectRoom(room.code, joinedTwo.credentials.token + 'wrong', 'bad')).toThrow('saved seat')
  })

  it('does not reset an expired persisted grace period when the active seat reconnects', async () => {
    const first = new GameManager(new CaptureStore())
    const created = first.createRoom('Host Player', 'socket-0')
    const joinedOne = first.joinRoom(created.room.code, 'Player One', 'socket-1')
    const joinedTwo = first.joinRoom(created.room.code, 'Player Two', 'socket-2')
    const credentials = [created.credentials, joinedOne.credentials, joinedTwo.credentials]
    for (const player of created.room.players) first.setReady(created.room.code, player.id, true)
    first.startGame(created.room.code, created.credentials.playerId)
    const active = created.room.players.find((player) => player.id === created.room.game?.currentTurnId)!
    const activeIndex = created.room.players.indexOf(active)
    first.disconnect(`socket-${activeIndex}`)
    const restoredData = JSON.parse(JSON.stringify(persistenceSnapshot(created.room))) as Room

    await first.close()
    vi.advanceTimersByTime(61_000)
    const second = new GameManager(new CaptureStore([restoredData]))
    await second.initialize()
    const room = second.rooms.get(created.room.code)!
    second.reconnectRoom(room.code, credentials[activeIndex].token, 'late-socket')
    expect(active.hand.some((card) => card.id === 'spades-A')).toBe(true)
    const restoredActive = room.players.find((player) => player.id === credentials[activeIndex].playerId)!
    expect(restoredActive.hand.some((card) => card.id === 'spades-A')).toBe(false)
    // The expired seat was auto-played immediately. A new wait may now belong to the next offline seat.
    expect(room.game?.currentTurnId).not.toBe(restoredActive.id)
    expect(room.game?.reconnectPlayerId).not.toBe(restoredActive.id)
  })
})
