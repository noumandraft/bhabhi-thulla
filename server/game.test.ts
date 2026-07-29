import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RECONNECT_GRACE_MS, TRICK_RESOLUTION_MS, type Card } from '../shared/game.js'
import { GameManager, type Room } from './game.js'

function readyEveryone(manager: GameManager, room: Room): void {
  for (const player of room.players) if (!player.isBot) manager.setReady(room.code, player.id, true)
}

function setupLobby(playerCount = 3) {
  const manager = new GameManager()
  const created = manager.createRoom('Host Player', 'socket-0')
  const credentials = [created.credentials]
  for (let index = 1; index < playerCount; index += 1) {
    credentials.push(manager.joinRoom(created.room.code, `Player ${index}`, `socket-${index}`).credentials)
  }
  return { manager, room: created.room, credentials }
}

function setupGame(playerCount = 3) {
  const setup = setupLobby(playerCount)
  readyEveryone(setup.manager, setup.room)
  setup.manager.startGame(setup.room.code, setup.credentials[0].playerId)
  return setup
}

function rightOf(room: Room, playerId: string) {
  const start = room.players.findIndex((player) => player.id === playerId)
  for (let offset = 1; offset <= room.players.length; offset += 1) {
    const player = room.players[(start - offset + room.players.length) % room.players.length]
    if (!player.escaped) return player
  }
  throw new Error('No right-hand player')
}

function chatClientId(index: number): string {
  return `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-07-27T12:00:00.000Z'))
})

afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
})

describe('Pakistani Bhabhi rules', () => {
  it('deals all 52 cards evenly and forces the Ace of Spades to open', () => {
    const { manager, room } = setupGame(4)
    expect(room.players.reduce((total, player) => total + player.hand.length, 0)).toBe(52)
    const counts = room.players.map((player) => player.hand.length)
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1)
    const opener = room.players.find((player) => player.id === room.game?.currentTurnId)!
    expect(manager.legalCards(room, opener.id).map((card) => card.id)).toEqual(['spades-A'])
  })

  it('moves each turn anticlockwise to the player on the right', () => {
    const { manager, room } = setupGame(4)
    const opener = room.players.find((player) => player.id === room.game?.currentTurnId)!
    const rightPlayer = rightOf(room, opener.id)
    manager.playCard(room.code, opener.id, 'spades-A')
    expect(room.game?.currentTurnId).toBe(rightPlayer.id)
  })

  it('only allows cards of the led suit when the player can follow', () => {
    const { manager, room } = setupGame(3)
    const game = room.game!
    const current = room.players.find((player) => player.id === game.currentTurnId)!
    Object.assign(game, { phase: 'turn', firstTrick: false, trick: [], leadSuit: null, currentTurnId: current.id })
    current.hand = [
      { id: 'hearts-2', suit: 'hearts', rank: '2' },
      { id: 'clubs-A', suit: 'clubs', rank: 'A' },
    ]
    manager.playCard(room.code, current.id, 'hearts-2')
    const follower = room.players.find((player) => player.id === game.currentTurnId)!
    follower.hand = [
      { id: 'hearts-5', suit: 'hearts', rank: '5' },
      { id: 'spades-K', suit: 'spades', rank: 'K' },
    ]
    expect(manager.legalCards(room, follower.id).map((card) => card.id)).toEqual(['hearts-5'])
  })

  it('shows a THULLA for exactly three seconds with no active turn, then starts a fresh timer', async () => {
    const { manager, room } = setupGame(3)
    const [leader, cutter, follower] = room.players
    Object.assign(room.game!, {
      phase: 'turn', firstTrick: false, trick: [], leadSuit: null, currentTurnId: leader.id,
      resolvedTrick: null, resolutionEndsAt: null, turnEndsAt: Date.now() + 35_000,
    })
    leader.hand = [{ id: 'hearts-A', suit: 'hearts', rank: 'A' }]
    follower.hand = [
      { id: 'hearts-K', suit: 'hearts', rank: 'K' },
      { id: 'clubs-3', suit: 'clubs', rank: '3' },
    ]
    cutter.hand = [
      { id: 'diamonds-2', suit: 'diamonds', rank: '2' },
      { id: 'clubs-2', suit: 'clubs', rank: '2' },
    ]

    manager.playCard(room.code, leader.id, 'hearts-A')
    manager.playCard(room.code, follower.id, 'hearts-K')
    manager.playCard(room.code, cutter.id, 'diamonds-2')

    expect(room.game).toMatchObject({
      phase: 'resolving',
      currentTurnId: null,
      turnEndsAt: null,
      pendingTurnId: leader.id,
      resolutionEndsAt: Date.now() + TRICK_RESOLUTION_MS,
    })
    expect(manager.view(room, leader.id).game?.resolvedTrick).toMatchObject({
      kind: 'thulla', winnerId: leader.id, lastPlayerId: cutter.id,
    })
    expect(manager.view(room, leader.id).game?.resolvedTrick?.cards.map((entry) => entry.card.id)).toEqual([
      'hearts-A', 'hearts-K', 'diamonds-2',
    ])
    expect(() => manager.playCard(room.code, leader.id, 'diamonds-2')).toThrow('still being shown')
    expect(() => manager.takeRightHand(room.code, leader.id)).toThrow('next trick')

    await vi.advanceTimersByTimeAsync(TRICK_RESOLUTION_MS - 1)
    expect(room.game?.phase).toBe('resolving')
    await vi.advanceTimersByTimeAsync(1)
    expect(room.game).toMatchObject({
      phase: 'turn', currentTurnId: leader.id, resolvedTrick: null,
      resolutionEndsAt: null, turnEndsAt: Date.now() + 35_000,
    })
  })

  it('shows a clean trick before drawing the power lead from the existing waste', async () => {
    const { manager, room } = setupGame(3)
    const leader = room.players[0]
    const follower = rightOf(room, leader.id)
    const lastPlayer = rightOf(room, follower.id)
    Object.assign(room.game!, {
      phase: 'turn', firstTrick: false, trick: [], leadSuit: null, currentTurnId: leader.id,
      waste: [{ id: 'clubs-9', suit: 'clubs', rank: '9' } satisfies Card],
    })
    leader.hand = [{ id: 'hearts-A', suit: 'hearts', rank: 'A' }]
    follower.hand = [
      { id: 'hearts-K', suit: 'hearts', rank: 'K' },
      { id: 'clubs-2', suit: 'clubs', rank: '2' },
    ]
    lastPlayer.hand = [
      { id: 'hearts-Q', suit: 'hearts', rank: 'Q' },
      { id: 'diamonds-2', suit: 'diamonds', rank: '2' },
    ]
    manager.playCard(room.code, leader.id, 'hearts-A')
    manager.playCard(room.code, follower.id, 'hearts-K')
    manager.playCard(room.code, lastPlayer.id, 'hearts-Q')

    expect(room.game?.phase).toBe('resolving')
    expect(room.game?.trick).toHaveLength(0)
    expect(manager.view(room, follower.id).game?.resolvedTrick?.kind).toBe('clean')
    await vi.advanceTimersByTimeAsync(TRICK_RESOLUTION_MS)
    expect(room.game?.resolvedTrick).toBeNull()
    expect(room.game?.trick).toEqual([{ playerId: leader.id, card: { id: 'clubs-9', suit: 'clubs', rank: '9' } }])
    expect(room.game?.currentTurnId).toBe(follower.id)
  })

  it("lets the player with power take the next active right-hand player's cards", () => {
    const { manager, room } = setupGame(4)
    const leader = room.players[0]
    const rightPlayer = rightOf(room, leader.id)
    Object.assign(room.game!, {
      phase: 'turn', firstTrick: false, trick: [], leadSuit: null,
      leaderId: leader.id, currentTurnId: leader.id, takeUsedForLead: false,
    })
    leader.hand = [{ id: 'diamonds-2', suit: 'diamonds', rank: '2' }]
    rightPlayer.hand = [
      { id: 'spades-K', suit: 'spades', rank: 'K' },
      { id: 'hearts-3', suit: 'hearts', rank: '3' },
    ]
    expect(manager.view(room, leader.id).game).toMatchObject({ canTakeRightHand: true, takeTargetId: rightPlayer.id })
    manager.takeRightHand(room.code, leader.id)
    expect(leader.hand.map((card) => card.id)).toEqual(['spades-K', 'hearts-3', 'diamonds-2'])
    expect(rightPlayer).toMatchObject({ hand: [], escaped: true })
    expect(room.game?.currentTurnId).toBe(leader.id)
  })
})

describe('lobby, bots, reconnection and sessions', () => {
  it('keeps legacy seats automatically ready for initial games and rematches', () => {
    const manager = new GameManager()
    const created = manager.createRoom('Legacy Host', 'legacy-0', false)
    const joinedOne = manager.joinRoom(created.room.code, 'Legacy One', 'legacy-1', false)
    const joinedTwo = manager.joinRoom(created.room.code, 'Legacy Two', 'legacy-2', false)
    expect(created.room.players.every((player) => player.ready && !player.usesReadyProtocol)).toBe(true)
    expect(manager.view(created.room, created.credentials.playerId).canStart).toBe(true)
    manager.startGame(created.room.code, created.credentials.playerId)

    const [host, middle, right] = created.room.players
    middle.escaped = true
    middle.hand = []
    Object.assign(created.room.game!, {
      phase: 'turn', firstTrick: false, trick: [], leadSuit: null,
      currentTurnId: host.id, leaderId: host.id, takeUsedForLead: false,
    })
    host.hand = [{ id: 'diamonds-2', suit: 'diamonds', rank: '2' }]
    right.hand = [{ id: 'hearts-3', suit: 'hearts', rank: '3' }]
    manager.takeRightHand(created.room.code, host.id)
    expect(created.room.status).toBe('finished')
    expect(created.room.players.every((player) => player.rematchReady)).toBe(true)
    expect(manager.view(created.room, host.id).canStart).toBe(true)
    manager.startGame(created.room.code, host.id)
    expect(created.room.session.roundNumber).toBe(2)
    expect(joinedOne.credentials.playerId).toBe(middle.id)
    expect(joinedTwo.credentials.playerId).toBe(right.id)
  })

  it('preserves a legacy seat mode on legacy reconnect and can upgrade it on a v2 reconnect', () => {
    const manager = new GameManager()
    const created = manager.createRoom('Legacy Host', 'legacy-socket', false)
    manager.disconnect('legacy-socket')
    manager.reconnectRoom(created.room.code, created.credentials.token, 'legacy-return', false)
    expect(created.room.players[0]).toMatchObject({ usesReadyProtocol: false, ready: true })
    manager.disconnect('legacy-return')
    manager.reconnectRoom(created.room.code, created.credentials.token, 'v2-return', true)
    expect(created.room.players[0]).toMatchObject({ usesReadyProtocol: true, ready: true })
  })

  it('enforces one seat per socket and disconnects every legacy duplicate safely', () => {
    const { manager, room } = setupLobby(2)
    expect(manager.socketHasSeat('socket-0')).toBe(true)
    expect(() => manager.joinRoom(room.code, 'Duplicate Seat', 'socket-0')).toThrow('already seated')

    const secondRoom = manager.createRoom('Second Host', 'socket-other').room
    secondRoom.players[0].socketId = 'socket-0'
    secondRoom.players[0].connected = true
    const affected = manager.disconnect('socket-0')
    expect(affected.map((candidate) => candidate.code).sort()).toEqual([room.code, secondRoom.code].sort())
    expect(room.players[0]).toMatchObject({ connected: false, socketId: null, isHost: false })
    expect(room.players[1]).toMatchObject({ connected: true, isHost: true })
    expect(secondRoom.players[0]).toMatchObject({ connected: false, socketId: null, isHost: false })
  })

  it('removes deliberate lobby leaves, transfers host, and deletes bot-only rooms', () => {
    const { manager, room, credentials } = setupLobby(3)
    expect(manager.leaveRoom(room.code, credentials[0].playerId, 'socket-0')).toEqual({
      code: room.code, roomDeleted: false, leftDuringPlay: false,
    })
    expect(room.players.some((player) => player.id === credentials[0].playerId)).toBe(false)
    expect(room.players.find((player) => player.id === credentials[1].playerId)?.isHost).toBe(true)

    manager.leaveRoom(room.code, credentials[1].playerId, 'socket-1')
    expect(room.players.find((player) => player.id === credentials[2].playerId)?.isHost).toBe(true)
    manager.addBot(room.code, credentials[2].playerId)
    expect(manager.leaveRoom(room.code, credentials[2].playerId, 'socket-2').roomDeleted).toBe(true)
    expect(manager.rooms.has(room.code)).toBe(false)
  })

  it('makes an in-game deliberate leave final and continues its active seat as a bot', async () => {
    const { manager, room, credentials } = setupGame(3)
    const active = room.players.find((player) => player.id === room.game?.currentTurnId)!
    const activeIndex = room.players.indexOf(active)
    const savedToken = credentials[activeIndex].token
    manager.leaveRoom(room.code, active.id, active.socketId!)
    expect(active).toMatchObject({ isBot: true, connected: true, socketId: null, reconnectGraceUsed: true })
    expect(room.game?.phase).toBe('turn')
    expect(room.game?.reconnectPlayerId).toBeNull()
    expect(room.players.filter((player) => player.connected && !player.isBot).some((player) => player.isHost)).toBe(true)
    expect(() => manager.reconnectRoom(room.code, savedToken, 'new-socket')).toThrow('saved seat')
    await vi.advanceTimersByTimeAsync(1_401)
    expect(active.hand.some((card) => card.id === 'spades-A')).toBe(false)
  })

  it('continues an in-game deliberate leave automatically when bots are disabled', async () => {
    const { manager, room, credentials } = setupLobby(3)
    manager.updateSettings(room.code, credentials[0].playerId, { allowBots: false })
    readyEveryone(manager, room)
    manager.startGame(room.code, credentials[0].playerId)
    const active = room.players.find((player) => player.id === room.game?.currentTurnId)!
    manager.leaveRoom(room.code, active.id, active.socketId!)
    expect(active).toMatchObject({ isBot: false, connected: false, reconnectGraceUsed: true })
    expect(room.game).toMatchObject({ phase: 'turn', reconnectPlayerId: null })
    await vi.advanceTimersByTimeAsync(1_401)
    expect(active.hand.some((card) => card.id === 'spades-A')).toBe(false)
  })

  it('requires ready players and applies host room settings', () => {
    const { manager, room, credentials } = setupLobby(3)
    expect(manager.view(room, credentials[0].playerId).canStart).toBe(false)
    manager.updateSettings(room.code, credentials[0].playerId, {
      turnSeconds: 20, allowBots: true, reactionsEnabled: false, tutorialHints: false,
    })
    readyEveryone(manager, room)
    expect(manager.view(room, credentials[0].playerId)).toMatchObject({
      canStart: true,
      settings: { turnSeconds: 20, reactionsEnabled: false, tutorialHints: false },
    })
  })

  it('validates setting patches atomically before changing the room', () => {
    const { manager, room, credentials } = setupLobby(2)
    manager.addBot(room.code, credentials[0].playerId)
    const before = structuredClone(room.settings)
    expect(() => manager.updateSettings(room.code, credentials[0].playerId, {
      turnSeconds: 20, tutorialHints: false, allowBots: false,
    })).toThrow('Remove existing bots')
    expect(room.settings).toEqual(before)
    expect(() => manager.updateSettings(room.code, credentials[0].playerId, {
      turnSeconds: 20, tutorialHints: 'no',
    })).toThrow('tutorialHints')
    expect(room.settings).toEqual(before)
  })

  it('lets the host add and remove lobby bots and runs a legal bot turn', async () => {
    const { manager, room, credentials } = setupLobby(1)
    const botOne = manager.addBot(room.code, credentials[0].playerId)
    manager.addBot(room.code, credentials[0].playerId, 'Sana Bot')
    manager.setReady(room.code, credentials[0].playerId, true)
    manager.startGame(room.code, credentials[0].playerId)

    const game = room.game!
    Object.assign(game, { phase: 'turn', firstTrick: false, trick: [], leadSuit: null, currentTurnId: botOne.id, turnEndsAt: null })
    botOne.hand = [{ id: 'clubs-2', suit: 'clubs', rank: '2' }]
    // Trigger timer rescheduling through a harmless reconnect-independent state publication.
    manager.updateSettings // keep public API referenced for type coverage
    manager.playCard(room.code, botOne.id, 'clubs-2', true)
    expect(game.trick).toEqual([{ playerId: botOne.id, card: { id: 'clubs-2', suit: 'clubs', rank: '2' } }])

    // Removal is deliberately restricted to between rounds/lobby.
    expect(() => manager.removeBot(room.code, credentials[0].playerId, botOne.id)).toThrow('during a match')
    await vi.advanceTimersByTimeAsync(1)
  })

  it('pauses an active turn for 60 seconds and restores the exact remaining time on reconnect', () => {
    const { manager, room, credentials } = setupGame(3)
    const active = room.players.find((player) => player.id === room.game?.currentTurnId)!
    const activeIndex = room.players.indexOf(active)
    vi.advanceTimersByTime(32_000)
    manager.disconnect(`socket-${activeIndex}`)
    expect(room.game).toMatchObject({
      phase: 'waiting_for_reconnect', currentTurnId: active.id, turnEndsAt: null,
      reconnectPlayerId: active.id, reconnectEndsAt: Date.now() + RECONNECT_GRACE_MS,
    })
    vi.advanceTimersByTime(1_000)
    manager.reconnectRoom(room.code, credentials[activeIndex].token, 'new-socket')
    expect(room.game).toMatchObject({
      phase: 'turn', reconnectPlayerId: null, reconnectEndsAt: null,
      turnEndsAt: Date.now() + 3_000,
    })
  })

  it('always leaves exactly one connected human host after disconnect and reconnect', () => {
    const { manager, room, credentials } = setupLobby(3)
    manager.disconnect('socket-0')
    expect(room.players.filter((player) => player.connected && player.isHost).map((player) => player.id)).toEqual([
      credentials[1].playerId,
    ])
    for (const player of room.players) player.isHost = false
    manager.reconnectRoom(room.code, credentials[0].token, 'host-returned')
    const connectedHosts = room.players.filter((player) => player.connected && !player.isBot && player.isHost)
    expect(connectedHosts).toHaveLength(1)
  })

  it('continues with an automatic legal move when reconnect grace expires', async () => {
    const { manager, room } = setupGame(3)
    const active = room.players.find((player) => player.id === room.game?.currentTurnId)!
    const socketIndex = room.players.indexOf(active)
    manager.disconnect(`socket-${socketIndex}`)
    await vi.advanceTimersByTimeAsync(RECONNECT_GRACE_MS)
    expect(active.hand.some((card) => card.id === 'spades-A')).toBe(false)
    expect(active.reconnectGraceUsed).toBe(true)
    expect(room.game?.phase).toBe('turn')
    expect(room.game?.currentTurnId).not.toBe(active.id)
  })

  it('can replace a disconnected seat with a bot without changing its hand or seat', () => {
    const { manager, room, credentials } = setupGame(3)
    const target = room.players.find((player) => !player.isHost)!
    const originalHand = [...target.hand]
    manager.disconnect(target.socketId!)
    manager.replaceDisconnectedWithBot(room.code, credentials[0].playerId, target.id)
    expect(target).toMatchObject({ id: target.id, isBot: true, connected: true })
    expect(target.hand).toEqual(originalHand)
  })

  it('records a finished round, waits through final resolution, and supports a rematch', async () => {
    const { manager, room, credentials } = setupGame(3)
    const leader = room.players[0]
    const follower = rightOf(room, leader.id)
    const third = room.players.find((player) => player.id !== leader.id && player.id !== follower.id)!
    third.escaped = true
    third.hand = []
    room.game!.roundEscapeOrder.push(third.id)
    Object.assign(room.game!, {
      phase: 'turn', firstTrick: false, trick: [], leadSuit: null,
      currentTurnId: leader.id, resolvedTrick: null, resolutionEndsAt: null,
    })
    leader.hand = [{ id: 'hearts-A', suit: 'hearts', rank: 'A' }]
    follower.hand = [{ id: 'hearts-K', suit: 'hearts', rank: 'K' }]
    manager.playCard(room.code, leader.id, 'hearts-A')
    manager.playCard(room.code, follower.id, 'hearts-K')
    expect(room.status).toBe('playing')
    expect(room.game).toMatchObject({ phase: 'resolving', pendingLoserId: leader.id, currentTurnId: null })

    await vi.advanceTimersByTimeAsync(TRICK_RESOLUTION_MS)
    expect(room).toMatchObject({ status: 'finished', game: { loserId: leader.id, resolvedTrick: null } })
    expect(room.session.scores.find((score) => score.playerId === leader.id)).toMatchObject({
      roundsPlayed: 1, bhabhiCount: 1, currentBhabhiStreak: 1,
    })
    expect(room.session.scores.find((score) => score.playerId === third.id)?.firstEscapes).toBe(1)

    for (const credential of credentials) manager.setRematchReady(room.code, credential.playerId, true)
    expect(manager.view(room, credentials[0].playerId).canStart).toBe(true)
    manager.startGame(room.code, credentials[0].playerId)
    expect(room).toMatchObject({ status: 'playing', session: { roundNumber: 2 } })
  })

  it('creates structured allowlisted reactions', () => {
    const { manager, room, credentials } = setupLobby(3)
    const event = manager.createReaction(room.code, credentials[1].playerId, 'wah')
    expect(event).toMatchObject({ playerId: credentials[1].playerId, reaction: 'wah', createdAt: Date.now() })
    expect(() => manager.createReaction(room.code, credentials[1].playerId, 'anything')).toThrow('available reaction')
  })
})

describe('Table Talk chat', () => {
  it('normalizes text, authors identity on the server, and deduplicates client retries', () => {
    const { manager, room, credentials } = setupLobby(2)
    const first = manager.createChatMessage(
      room.code,
      credentials[1].playerId,
      chatClientId(1),
      '  Ｈello\r\nدنیا  ',
    )
    expect(first).toMatchObject({
      created: true,
      message: {
        clientMessageId: chatClientId(1),
        sequence: 1,
        playerId: credentials[1].playerId,
        playerName: 'Player 1',
        text: 'Hello\nدنیا',
        createdAt: Date.now(),
      },
    })
    expect(first.message.id).toMatch(/^[0-9a-f-]{36}$/)

    const retry = manager.createChatMessage(
      room.code,
      credentials[1].playerId,
      chatClientId(1).toUpperCase(),
      'Hello\nدنیا',
      () => { throw new Error('A retry must not consume its rate limit.') },
    )
    expect(retry).toEqual({ created: false, message: first.message })
    expect(manager.chatHistory(room.code, credentials[0].playerId).messages).toEqual([first.message])
    expect(() => manager.createChatMessage(
      room.code,
      credentials[1].playerId,
      chatClientId(1),
      'Changed retry text',
    )).toThrow('already been used')
  })

  it('rejects unsafe or oversized text, non-UUID ids, bots, and non-text modes', () => {
    const { manager, room, credentials } = setupLobby(2)
    const send = (index: number, text: unknown, clientId: unknown = chatClientId(index)) =>
      manager.createChatMessage(room.code, credentials[1].playerId, clientId, text)

    expect(() => send(1, '   ')).toThrow('Enter a chat message')
    expect(() => send(2, 'one\ntwo\nthree\nfour')).toThrow('at most 3 lines')
    expect(() => send(3, '🙂'.repeat(201))).toThrow('at most 200 characters')
    expect(() => send(4, 'hello\tworld')).toThrow('unsupported characters')
    expect(() => send(5, 'safe\u202etext')).toThrow('unsupported characters')
    expect(() => send(6, 'hello', 'not-a-uuid')).toThrow('Invalid chat message id')

    const bot = manager.addBot(room.code, credentials[0].playerId)
    expect(() => manager.createChatMessage(room.code, bot.id, chatClientId(7), 'Bot text')).toThrow('Bots cannot')
    manager.updateSettings(room.code, credentials[0].playerId, { chatMode: 'quick' })
    expect(() => send(8, 'Text while quick chat is selected')).toThrow('not available')
    manager.updateSettings(room.code, credentials[0].playerId, { chatMode: 'off' })
    expect(() => send(9, 'Text while chat is off')).toThrow('not available')
    expect(() => manager.updateSettings(room.code, credentials[0].playerId, { chatMode: 'unknown' })).toThrow('text, quick, or off')
  })

  it('allows reactions in text and quick modes but rejects them when chat is off', () => {
    const { manager, room, credentials } = setupLobby(2)
    expect(manager.createReaction(room.code, credentials[1].playerId, 'wah')).toMatchObject({ reaction: 'wah' })
    manager.updateSettings(room.code, credentials[0].playerId, { chatMode: 'quick' })
    expect(manager.createReaction(room.code, credentials[1].playerId, 'oye')).toMatchObject({ reaction: 'oye' })
    manager.updateSettings(room.code, credentials[0].playerId, { reactionsEnabled: false })
    expect(() => manager.createReaction(room.code, credentials[1].playerId, 'oye')).toThrow('Reactions are disabled')
    manager.updateSettings(room.code, credentials[0].playerId, { reactionsEnabled: true })
    manager.updateSettings(room.code, credentials[0].playerId, { chatMode: 'off' })
    expect(() => manager.createReaction(room.code, credentials[1].playerId, 'chalo')).toThrow('Chat is disabled')
  })

  it('lets the host emergency-change only chat mode during an active match', () => {
    const { manager, room, credentials } = setupLobby(3)
    manager.updateSettings(room.code, credentials[0].playerId, { reactionsEnabled: false })
    readyEveryone(manager, room)
    manager.startGame(room.code, credentials[0].playerId)
    const originalTurnSeconds = room.settings.turnSeconds
    manager.updateSettings(room.code, credentials[0].playerId, { chatMode: 'quick' })
    expect(room.settings).toMatchObject({ chatMode: 'quick', reactionsEnabled: true })
    expect(manager.createReaction(room.code, credentials[1].playerId, 'wah')).toMatchObject({ reaction: 'wah' })
    manager.updateSettings(room.code, credentials[0].playerId, { chatMode: 'off' })
    expect(room.settings.chatMode).toBe('off')
    expect(() => manager.createReaction(room.code, credentials[1].playerId, 'wah')).toThrow('Chat is disabled')

    expect(() => manager.updateSettings(room.code, credentials[0].playerId, { turnSeconds: 20 })).toThrow('Only chat mode')
    expect(() => manager.updateSettings(room.code, credentials[0].playerId, {
      chatMode: 'text', reactionsEnabled: false,
    })).toThrow('Only chat mode')
    expect(room.settings).toMatchObject({ chatMode: 'off', turnSeconds: originalTurnSeconds, reactionsEnabled: true })
    expect(() => manager.updateSettings(room.code, credentials[1].playerId, { chatMode: 'text' })).toThrow('Only the room host')
  })

  it('keeps only the latest 50 messages and clears ephemeral history with the room', () => {
    const { manager, room, credentials } = setupLobby(1)
    let firstMessage: ReturnType<GameManager['createChatMessage']>['message'] | undefined
    for (let index = 1; index <= 55; index += 1) {
      const result = manager.createChatMessage(room.code, credentials[0].playerId, chatClientId(index), `Message ${index}`)
      if (index === 1) firstMessage = result.message
    }
    const history = manager.chatHistory(room.code, credentials[0].playerId).messages
    expect(history).toHaveLength(50)
    expect(history[0]).toMatchObject({ sequence: 6, text: 'Message 6' })
    expect(history.at(-1)).toMatchObject({ sequence: 55, text: 'Message 55' })
    const retry = manager.createChatMessage(
      room.code,
      credentials[0].playerId,
      chatClientId(1),
      'Message 1',
      () => { throw new Error('An evicted retry must not consume its rate limit.') },
    )
    expect(retry).toEqual({ created: false, message: firstMessage })
    expect(manager.chatHistory(room.code, credentials[0].playerId).messages).toHaveLength(50)

    manager.leaveRoom(room.code, credentials[0].playerId, 'socket-0')
    expect(manager.rooms.has(room.code)).toBe(false)
    const chatRooms = (manager as unknown as { chatRooms: Map<string, unknown> }).chatRooms
    expect(chatRooms.has(room.code)).toBe(false)
  })

  it('bounds retry metadata and expires deduplication after ten minutes', () => {
    const { manager, room, credentials } = setupLobby(1)
    for (let index = 1; index <= 300; index += 1) {
      manager.createChatMessage(room.code, credentials[0].playerId, chatClientId(index), `Bounded ${index}`)
    }
    const chatRooms = (manager as unknown as {
      chatRooms: Map<string, { dedupe: Map<string, unknown> }>
    }).chatRooms
    expect(chatRooms.get(room.code)?.dedupe.size).toBe(256)

    const clientMessageId = chatClientId(1_000)
    const first = manager.createChatMessage(room.code, credentials[0].playerId, clientMessageId, 'Expires later')
    vi.advanceTimersByTime(10 * 60 * 1000 + 1)
    const afterExpiry = manager.createChatMessage(room.code, credentials[0].playerId, clientMessageId, 'Expires later')
    expect(afterExpiry).toMatchObject({ created: true, message: { sequence: first.message.sequence + 1 } })
    expect(afterExpiry.message.id).not.toBe(first.message.id)
    expect(afterExpiry.message.epoch).toBe(first.message.epoch)
  })
})
