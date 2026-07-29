import { createHash, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto'
import {
  CHAT_HISTORY_LIMIT,
  CHAT_MAX_CODE_POINTS,
  CHAT_MODES,
  PROTOCOL_VERSION,
  RANKS,
  REACTIONS,
  RECONNECT_GRACE_MS,
  SUITS,
  TRICK_RESOLUTION_MS,
  TURN_SECONDS,
  rankValue,
  sortCards,
  type ActivityItem,
  type Card,
  type ChatHistory,
  type ChatMessage,
  type ChatMode,
  type GamePhase,
  type Reaction,
  type ReactionEvent,
  type ResolvedTrickView,
  type RoomCredentials,
  type RoomLeaveResult,
  type RoomSettings,
  type RoomView,
  type SessionScore,
  type Suit,
  type TurnSeconds,
} from '../shared/game.js'

const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const ROOM_TTL_MS = 6 * 60 * 60 * 1000
const CHAT_DEDUPE_TTL_MS = 10 * 60 * 1000
const CHAT_DEDUPE_LIMIT = 256
const CLIENT_MESSAGE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const CHAT_CONTROL_CHARACTER_PATTERN = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/u
const CHAT_BIDI_CONTROL_PATTERN = /[\u202a-\u202e\u2066-\u2069]/u

export interface Player {
  id: string
  tokenHash: string
  socketId: string | null
  name: string
  hand: Card[]
  connected: boolean
  escaped: boolean
  isHost: boolean
  ready: boolean
  isBot: boolean
  rematchReady: boolean
  reconnectGraceUsed: boolean
  /** Internal rollout bridge. Never include this capability flag in RoomView. */
  usesReadyProtocol: boolean
}

export interface TrickCard {
  playerId: string
  card: Card
}

export interface ResolvedTrick {
  cards: TrickCard[]
  kind: ResolvedTrickView['kind']
  winnerId: string
  lastPlayerId: string
}

export interface GameState {
  phase: GamePhase
  trick: TrickCard[]
  resolvedTrick: ResolvedTrick | null
  resolutionEndsAt: number | null
  pendingTurnId: string | null
  pendingLoserId: string | null
  pendingWasteLeadPlayerId: string | null
  pendingWasteCards: Card[]
  waste: Card[]
  leadSuit: Suit | null
  leaderId: string | null
  currentTurnId: string | null
  firstTrick: boolean
  takeUsedForLead: boolean
  loserId: string | null
  turnEndsAt: number | null
  turnRemainingMs: number | null
  reconnectPlayerId: string | null
  reconnectEndsAt: number | null
  roundEscapeOrder: string[]
  roundPlayerIds: string[]
  scoreRecorded: boolean
  activity: ActivityItem[]
}

export interface Room {
  code: string
  status: 'lobby' | 'playing' | 'finished'
  players: Player[]
  game: GameState | null
  settings: RoomSettings
  session: {
    roundNumber: number
    scores: SessionScore[]
  }
  updatedAt: number
  /** Restored rooms stay inert until a player reconnects. Never persist this flag. */
  suspended?: boolean
}

export interface PersistenceStatus {
  mode: string
  durable: boolean
  ready: boolean
  error?: string
}

export interface RoomPersistence {
  initialize(): Promise<void>
  loadAll(): Promise<Room[]>
  save(room: Room): Promise<void>
  delete(code: string): Promise<void>
  close?(): Promise<void>
  status(): PersistenceStatus
}

interface ChatRoomState {
  epoch: string
  nextSequence: number
  messages: ChatMessage[]
  dedupe: Map<string, ChatDedupeEntry>
}

type ChatDedupeEntry = Omit<ChatMessage, 'text'> & { textHash: string; expiresAt: number }

export interface ChatMessageResult {
  message: ChatMessage
  created: boolean
}

class MemoryPersistence implements RoomPersistence {
  async initialize(): Promise<void> {}
  async loadAll(): Promise<Room[]> { return [] }
  async save(_room: Room): Promise<void> {}
  async delete(_code: string): Promise<void> {}
  status(): PersistenceStatus { return { mode: 'memory', durable: false, ready: true } }
}

function makeDeck(): Card[] {
  return SUITS.flatMap((suit) => RANKS.map((rank) => ({ id: `${suit}-${rank}`, suit, rank })))
}

function shuffle<T>(items: T[]): T[] {
  const result = [...items]
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = randomInt(index + 1)
    ;[result[index], result[swapIndex]] = [result[swapIndex], result[index]]
  }
  return result
}

function cleanName(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Enter a player name.')
  const name = value.normalize('NFKC').replace(/\s+/g, ' ').trim().slice(0, 20)
  if (name.length < 2) throw new Error('Name must be at least 2 characters.')
  return name
}

function cleanCode(value: unknown): string {
  const code = typeof value === 'string' ? value.trim().toUpperCase() : ''
  if (!/^[A-Z2-9]{5}$/.test(code)) throw new Error('Enter a valid 5-character room code.')
  return code
}

function cleanClientMessageId(value: unknown): string {
  const id = typeof value === 'string' ? value.trim().toLowerCase() : ''
  if (!CLIENT_MESSAGE_ID_PATTERN.test(id)) throw new Error('Invalid chat message id.')
  return id
}

function cleanChatText(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Enter a chat message.')
  const normalized = value.normalize('NFKC').replace(/\r\n?|[\u2028\u2029]/g, '\n')
  if (CHAT_CONTROL_CHARACTER_PATTERN.test(normalized) || CHAT_BIDI_CONTROL_PATTERN.test(normalized)) {
    throw new Error('That message contains unsupported characters.')
  }
  const text = normalized.trim()
  if (!text) throw new Error('Enter a chat message.')
  if (text.split('\n').length > 3) throw new Error('Chat messages can use at most 3 lines.')
  if ([...text].length > CHAT_MAX_CODE_POINTS) {
    throw new Error(`Chat messages can use at most ${CHAT_MAX_CODE_POINTS} characters.`)
  }
  return text
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

function hashChatText(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

function chatDedupeKey(playerId: string, clientMessageId: string): string {
  return `${playerId}:${clientMessageId}`
}

function pruneChatDedupe(chat: ChatRoomState, now: number): void {
  for (const [key, entry] of chat.dedupe) {
    if (entry.expiresAt <= now) chat.dedupe.delete(key)
  }
  while (chat.dedupe.size > CHAT_DEDUPE_LIMIT) {
    const oldest = chat.dedupe.keys().next().value as string | undefined
    if (!oldest) break
    chat.dedupe.delete(oldest)
  }
}

function tokenMatches(token: string, expectedHash: string): boolean {
  const actual = Buffer.from(hashToken(token), 'hex')
  const expected = Buffer.from(expectedHash, 'hex')
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

function activePlayers(room: Room): Player[] {
  return room.players.filter((player) => !player.escaped)
}

function ensureConnectedHost(room: Room): void {
  const connectedHumans = room.players.filter((player) => player.connected && !player.isBot)
  const nextHost = connectedHumans.find((player) => player.isHost) ?? connectedHumans[0]
  for (const player of room.players) player.isHost = player.id === nextHost?.id
}

/** Anticlockwise: the next active seat is the array item immediately to the right. */
function nextActive(room: Room, playerId: string): Player | null {
  const startIndex = room.players.findIndex((player) => player.id === playerId)
  if (startIndex < 0) return null
  for (let offset = 1; offset <= room.players.length; offset += 1) {
    const candidate = room.players[(startIndex - offset + room.players.length) % room.players.length]
    if (!candidate.escaped) return candidate
  }
  return null
}

function highestLedCard(trick: TrickCard[], leadSuit: Suit): TrickCard {
  const suited = trick.filter((entry) => entry.card.suit === leadSuit)
  if (!suited.length) throw new Error('The trick has no card in the led suit.')
  return suited.reduce((highest, entry) =>
    rankValue(entry.card.rank) > rankValue(highest.card.rank) ? entry : highest,
  )
}

function addActivity(
  game: GameState,
  text: string,
  tone: ActivityItem['tone'] = 'neutral',
  kind: NonNullable<ActivityItem['kind']> = 'general',
  data?: ActivityItem['data'],
): void {
  game.activity.unshift({ id: randomUUID(), text, tone, kind, data })
  game.activity = game.activity.slice(0, 16)
}

function defaultSettings(): RoomSettings {
  return {
    turnSeconds: 35,
    reconnectGraceSeconds: 60,
    allowBots: true,
    reactionsEnabled: true,
    tutorialHints: true,
    chatMode: 'text',
  }
}

function newScore(player: Player): SessionScore {
  return {
    playerId: player.id,
    playerName: player.name,
    roundsPlayed: 0,
    escapes: 0,
    firstEscapes: 0,
    bhabhiCount: 0,
    currentBhabhiStreak: 0,
    bestBhabhiStreak: 0,
  }
}

export class GameManager {
  readonly rooms = new Map<string, Room>()
  private readonly timers = new Map<string, NodeJS.Timeout>()
  private readonly chatRooms = new Map<string, ChatRoomState>()
  private publisher: (room: Room) => void = () => undefined
  private readonly persistence: RoomPersistence

  constructor(persistence: RoomPersistence = new MemoryPersistence()) {
    this.persistence = persistence
  }

  async initialize(): Promise<void> {
    await this.persistence.initialize()
    const now = Date.now()
    for (const restored of await this.persistence.loadAll()) {
      if (!restored?.code || restored.updatedAt < now - ROOM_TTL_MS) continue
      restored.settings = { ...defaultSettings(), ...restored.settings, reconnectGraceSeconds: 60 }
      restored.session ??= { roundNumber: 0, scores: [] }
      restored.players = restored.players.map((player) => ({
        ...player,
        socketId: null,
        connected: player.isBot,
        usesReadyProtocol: player.usesReadyProtocol ?? false,
        ready: player.isBot || !(player.usesReadyProtocol ?? false) ? true : Boolean(player.ready),
        rematchReady: player.isBot || !(player.usesReadyProtocol ?? false) ? true : Boolean(player.rematchReady),
        reconnectGraceUsed: Boolean(player.reconnectGraceUsed),
      }))
      for (const player of restored.players) this.ensureScore(restored, player)
      restored.suspended = restored.status === 'playing'
      if (restored.game) this.normalizeRestoredGame(restored.game)
      this.rooms.set(restored.code, restored)
    }
  }

  persistenceStatus(): PersistenceStatus {
    return this.persistence.status()
  }

  socketOwnsSeat(roomCode: unknown, playerId: unknown, socketId: string): boolean {
    if (typeof roomCode !== 'string' || typeof playerId !== 'string') return false
    const room = this.rooms.get(roomCode.trim().toUpperCase())
    return Boolean(room?.players.some((player) => player.id === playerId && player.socketId === socketId && player.connected))
  }

  socketHasSeat(socketId: string): boolean {
    return Boolean(socketId && [...this.rooms.values()].some((room) =>
      room.players.some((player) => player.socketId === socketId),
    ))
  }

  private ensureSocketHasNoSeat(socketId: string): void {
    if (this.socketHasSeat(socketId)) throw new Error('This connection is already seated in a room. Leave it before joining another.')
  }

  async close(): Promise<void> {
    for (const code of this.timers.keys()) this.clearTimer(code)
    await this.persistence.close?.()
  }

  setPublisher(publisher: (room: Room) => void): void {
    this.publisher = publisher
  }

  private normalizeRestoredGame(game: GameState): void {
    game.phase ??= game.resolvedTrick ? 'resolving' : 'turn'
    game.resolutionEndsAt ??= null
    game.pendingTurnId ??= null
    game.pendingLoserId ??= null
    game.pendingWasteLeadPlayerId ??= null
    game.pendingWasteCards ??= []
    game.turnRemainingMs ??= null
    game.reconnectPlayerId ??= null
    game.reconnectEndsAt ??= null
    game.roundEscapeOrder ??= []
    game.roundPlayerIds ??= []
    game.scoreRecorded ??= false
    game.turnEndsAt = null
    if (game.phase === 'waiting_for_reconnect') {
      game.turnRemainingMs ??= 0
    }
  }

  private makeRoomCode(): string {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      let code = ''
      for (let index = 0; index < 5; index += 1) code += ROOM_ALPHABET[randomInt(ROOM_ALPHABET.length)]
      if (!this.rooms.has(code)) return code
    }
    throw new Error('Could not create a room. Please try again.')
  }

  private makePlayer(
    name: unknown,
    socketId: string | null,
    isHost: boolean,
    isBot = false,
    usesReadyProtocol = true,
  ): { player: Player; token: string } {
    const token = randomBytes(32).toString('base64url')
    return {
      token,
      player: {
        id: randomUUID(),
        tokenHash: hashToken(token),
        socketId,
        name: cleanName(name),
        hand: [],
        connected: isBot || Boolean(socketId),
        escaped: false,
        isHost,
        ready: isBot || !usesReadyProtocol,
        isBot,
        rematchReady: isBot || !usesReadyProtocol,
        reconnectGraceUsed: false,
        usesReadyProtocol,
      },
    }
  }

  createRoom(name: unknown, socketId: string, usesReadyProtocol = true): { room: Room; credentials: RoomCredentials } {
    this.ensureSocketHasNoSeat(socketId)
    const { player, token } = this.makePlayer(name, socketId, true, false, usesReadyProtocol)
    const room: Room = {
      code: this.makeRoomCode(),
      status: 'lobby',
      players: [player],
      game: null,
      settings: defaultSettings(),
      session: { roundNumber: 0, scores: [newScore(player)] },
      updatedAt: Date.now(),
    }
    this.rooms.set(room.code, room)
    this.changed(room)
    return { room, credentials: { code: room.code, playerId: player.id, token } }
  }

  joinRoom(codeValue: unknown, name: unknown, socketId: string, usesReadyProtocol = true): { room: Room; credentials: RoomCredentials } {
    this.ensureSocketHasNoSeat(socketId)
    const code = cleanCode(codeValue)
    const room = this.rooms.get(code)
    if (!room) throw new Error('Room not found. Check the code and try again.')
    if (room.status !== 'lobby') throw new Error('This match has already started.')
    if (room.players.length >= 8) throw new Error('This room is full.')
    const { player, token } = this.makePlayer(name, socketId, false, false, usesReadyProtocol)
    room.players.push(player)
    room.session.scores.push(newScore(player))
    ensureConnectedHost(room)
    this.changed(room)
    return { room, credentials: { code, playerId: player.id, token } }
  }

  reconnectRoom(
    codeValue: unknown,
    tokenValue: unknown,
    socketId: string,
    usesReadyProtocol?: boolean,
  ): { room: Room; credentials: RoomCredentials } {
    this.ensureSocketHasNoSeat(socketId)
    const code = cleanCode(codeValue)
    const token = typeof tokenValue === 'string' ? tokenValue : ''
    if (token.length < 32 || token.length > 128) throw new Error('That saved seat is no longer available.')
    const room = this.rooms.get(code)
    const player = room?.players.find((candidate) => !candidate.isBot && tokenMatches(token, candidate.tokenHash))
    if (!room || !player) throw new Error('That saved seat is no longer available.')
    player.socketId = socketId
    player.connected = true
    if (usesReadyProtocol === true) player.usesReadyProtocol = true
    room.suspended = false
    ensureConnectedHost(room)

    const game = room.game
    if (room.status === 'playing' && game) {
      if (game.phase === 'waiting_for_reconnect' && game.reconnectPlayerId === player.id) {
        if (game.reconnectEndsAt !== null && game.reconnectEndsAt <= Date.now()) {
          this.expireReconnectWait(room, player.id)
        } else {
          game.phase = 'turn'
          game.reconnectPlayerId = null
          game.reconnectEndsAt = null
          game.turnEndsAt = Date.now() + Math.max(0, game.turnRemainingMs ?? 0)
          game.turnRemainingMs = null
          addActivity(game, `${player.name} reconnected.`, 'good', 'connection', { playerId: player.id })
        }
      } else if (game.phase === 'resolving' && game.resolutionEndsAt && game.resolutionEndsAt <= Date.now()) {
        this.completeResolution(room)
      }
    }
    this.changed(room)
    return { room, credentials: { code, playerId: player.id, token } }
  }

  disconnect(socketId: string): Room[] {
    const changedRooms: Room[] = []
    for (const room of this.rooms.values()) {
      const matches = room.players.filter((candidate) => candidate.socketId === socketId)
      if (!matches.length) continue
      for (const player of matches) {
        player.connected = false
        player.socketId = null
        const game = room.game
        if (room.status === 'playing' && game?.phase === 'turn' && game.currentTurnId === player.id && !player.reconnectGraceUsed) {
          this.beginReconnectWait(room, player)
          addActivity(game, `Waiting for ${player.name} to reconnect.`, 'warning', 'connection', { playerId: player.id })
        }
      }
      ensureConnectedHost(room)
      this.changed(room)
      changedRooms.push(room)
    }
    return changedRooms
  }

  leaveRoom(roomCode: string, playerId: string, socketId?: string): RoomLeaveResult {
    const room = this.requireRoom(roomCode)
    const player = this.requirePlayer(room, playerId)
    if (socketId !== undefined && player.socketId !== socketId) throw new Error('Reconnect to your seat and try again.')
    const result: RoomLeaveResult = {
      code: room.code,
      roomDeleted: false,
      leftDuringPlay: room.status === 'playing',
    }

    if (room.status !== 'playing') {
      room.players = room.players.filter((candidate) => candidate.id !== player.id)
      ensureConnectedHost(room)
      if (!room.players.some((candidate) => !candidate.isBot)) {
        result.roomDeleted = true
        this.deleteRoom(room)
      } else {
        this.changed(room)
      }
      return result
    }

    const game = room.game!
    // A deliberate leave is final for this round: rotate the hash so saved credentials cannot reclaim it.
    player.tokenHash = hashToken(randomBytes(32).toString('base64url'))
    player.socketId = null
    player.reconnectGraceUsed = true
    player.ready = true
    player.rematchReady = true
    if (room.settings.allowBots) {
      player.isBot = true
      player.connected = true
      addActivity(game, `${player.name}'s seat will continue as a bot.`, 'warning', 'connection', { playerId: player.id })
    } else {
      player.connected = false
      addActivity(game, `${player.name} left; their seat will continue automatically.`, 'warning', 'connection', { playerId: player.id })
    }
    if (game.phase === 'waiting_for_reconnect' && game.reconnectPlayerId === player.id) {
      game.phase = 'turn'
      game.reconnectPlayerId = null
      game.reconnectEndsAt = null
      game.turnRemainingMs = null
      game.turnEndsAt = null
    }
    ensureConnectedHost(room)
    this.changed(room)
    return result
  }

  setReady(roomCode: string, playerId: string, value: unknown): void {
    const room = this.requireRoom(roomCode)
    if (room.status !== 'lobby') throw new Error('Ready status can only be changed in the lobby.')
    const player = this.requirePlayer(room, playerId)
    if (player.isBot) throw new Error('Bots are always ready.')
    if (typeof value !== 'boolean') throw new Error('Ready status must be true or false.')
    player.ready = value
    this.changed(room)
  }

  updateSettings(roomCode: string, playerId: string, patch: unknown): void {
    const room = this.requireRoom(roomCode)
    this.requireHost(room, playerId)
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('Invalid room settings.')
    const value = patch as Record<string, unknown>
    const allowed = new Set(['turnSeconds', 'allowBots', 'reactionsEnabled', 'tutorialHints', 'chatMode'])
    const keys = Object.keys(value)
    if (keys.some((key) => !allowed.has(key))) throw new Error('Unknown room setting.')
    if (room.status === 'playing' && (keys.length !== 1 || keys[0] !== 'chatMode')) {
      throw new Error('Only chat mode can be changed during a match.')
    }
    const nextSettings: RoomSettings = { ...room.settings }
    if (value.turnSeconds !== undefined) {
      if (!TURN_SECONDS.includes(value.turnSeconds as TurnSeconds)) throw new Error('Turn time must be 20, 35, or 60 seconds.')
      nextSettings.turnSeconds = value.turnSeconds as TurnSeconds
    }
    for (const key of ['allowBots', 'reactionsEnabled', 'tutorialHints'] as const) {
      if (value[key] !== undefined) {
        if (typeof value[key] !== 'boolean') throw new Error(`${key} must be true or false.`)
        nextSettings[key] = value[key] as boolean
      }
    }
    if (value.chatMode !== undefined) {
      if (typeof value.chatMode !== 'string' || !CHAT_MODES.includes(value.chatMode as ChatMode)) {
        throw new Error('chatMode must be text, quick, or off.')
      }
      nextSettings.chatMode = value.chatMode as ChatMode
      if (nextSettings.chatMode === 'text' || nextSettings.chatMode === 'quick') nextSettings.reactionsEnabled = true
    }
    if (!nextSettings.allowBots && room.players.some((player) => player.isBot)) {
      throw new Error('Remove existing bots before disabling bots.')
    }
    room.settings = nextSettings
    this.changed(room)
  }

  kickPlayer(roomCode: string, hostId: string, targetId: unknown): Player {
    const room = this.requireRoom(roomCode)
    this.requireHost(room, hostId)
    if (room.status === 'playing') throw new Error('Players cannot be removed during a match.')
    if (typeof targetId !== 'string') throw new Error('Choose a player to remove.')
    const target = this.requirePlayer(room, targetId)
    if (target.id === hostId) throw new Error('The host cannot remove themselves.')
    room.players = room.players.filter((player) => player.id !== target.id)
    ensureConnectedHost(room)
    this.changed(room)
    return target
  }

  addBot(roomCode: string, hostId: string, nameValue?: unknown): Player {
    const room = this.requireRoom(roomCode)
    this.requireHost(room, hostId)
    if (room.status === 'playing') throw new Error('Bots can only be added between rounds.')
    if (!room.settings.allowBots) throw new Error('Bots are disabled for this room.')
    if (room.players.length >= 8) throw new Error('This room is full.')
    const botCount = room.players.filter((player) => player.isBot).length + 1
    const name = nameValue === undefined || nameValue === '' ? `Bot ${botCount}` : nameValue
    const { player } = this.makePlayer(name, null, false, true)
    room.players.push(player)
    this.ensureScore(room, player)
    this.changed(room)
    return player
  }

  removeBot(roomCode: string, hostId: string, targetId: unknown): void {
    const room = this.requireRoom(roomCode)
    this.requireHost(room, hostId)
    if (room.status === 'playing') throw new Error('Bots cannot be removed during a match.')
    if (typeof targetId !== 'string') throw new Error('Choose a bot to remove.')
    const target = this.requirePlayer(room, targetId)
    if (!target.isBot) throw new Error('That player is not a bot.')
    room.players = room.players.filter((player) => player.id !== target.id)
    this.changed(room)
  }

  replaceDisconnectedWithBot(roomCode: string, hostId: string, targetId: unknown): void {
    const room = this.requireRoom(roomCode)
    this.requireHost(room, hostId)
    if (room.status !== 'playing' || !room.game) throw new Error('A replacement is only needed during a match.')
    if (!room.settings.allowBots) throw new Error('Bots are disabled for this room.')
    if (typeof targetId !== 'string') throw new Error('Choose a disconnected player.')
    const target = this.requirePlayer(room, targetId)
    if (target.isBot || target.connected) throw new Error('Only a disconnected player can be replaced.')
    target.isBot = true
    target.connected = true
    target.socketId = null
    target.ready = true
    target.rematchReady = true
    target.reconnectGraceUsed = true
    const game = room.game
    if (game.phase === 'waiting_for_reconnect' && game.reconnectPlayerId === target.id) {
      game.phase = 'turn'
      game.reconnectPlayerId = null
      game.reconnectEndsAt = null
      game.turnRemainingMs = null
      game.turnEndsAt = null
    }
    addActivity(game, `${target.name}'s seat is now playing as a bot.`, 'warning', 'connection', { playerId: target.id })
    this.changed(room)
  }

  setRematchReady(roomCode: string, playerId: string, value: unknown): void {
    const room = this.requireRoom(roomCode)
    if (room.status !== 'finished') throw new Error('The current round has not finished.')
    const player = this.requirePlayer(room, playerId)
    if (player.isBot) throw new Error('Bots are always ready.')
    if (typeof value !== 'boolean') throw new Error('Rematch status must be true or false.')
    player.rematchReady = value
    this.changed(room)
  }

  resetSession(roomCode: string, hostId: string): void {
    const room = this.requireRoom(roomCode)
    this.requireHost(room, hostId)
    if (room.status === 'playing') throw new Error('The scoreboard cannot be reset during a match.')
    room.session.roundNumber = 0
    room.session.scores = room.players.map(newScore)
    this.changed(room)
  }

  createReaction(roomCode: string, playerId: string, reactionValue: unknown): ReactionEvent {
    const room = this.requireRoom(roomCode)
    if (room.settings.chatMode === 'off') throw new Error('Chat is disabled in this room.')
    if (!room.settings.reactionsEnabled) throw new Error('Reactions are disabled in this room.')
    const player = this.requirePlayer(room, playerId)
    if (typeof reactionValue !== 'string' || !REACTIONS.includes(reactionValue as Reaction)) {
      throw new Error('Choose an available reaction.')
    }
    return {
      id: randomUUID(),
      playerId: player.id,
      playerName: player.name,
      reaction: reactionValue as Reaction,
      createdAt: Date.now(),
    }
  }

  chatHistory(roomCode: string, playerId: string): ChatHistory {
    const room = this.requireRoom(roomCode)
    const player = this.requirePlayer(room, playerId)
    if (player.isBot) throw new Error('Bots cannot use chat.')
    const chat = this.ensureChatRoom(room.code)
    pruneChatDedupe(chat, Date.now())
    return { epoch: chat.epoch, messages: chat.messages.map((message) => ({ ...message })) }
  }

  createChatMessage(
    roomCode: string,
    playerId: string,
    clientMessageIdValue: unknown,
    textValue: unknown,
    beforeCreate: () => void = () => undefined,
  ): ChatMessageResult {
    const room = this.requireRoom(roomCode)
    const player = this.requirePlayer(room, playerId)
    const clientMessageId = cleanClientMessageId(clientMessageIdValue)
    const text = cleanChatText(textValue)
    const now = Date.now()
    const dedupeKey = chatDedupeKey(player.id, clientMessageId)
    const currentChat = this.chatRooms.get(room.code)
    if (currentChat) pruneChatDedupe(currentChat, now)
    const existing = currentChat?.dedupe.get(dedupeKey)
    if (existing) {
      if (existing.textHash !== hashChatText(text)) throw new Error('That chat message id has already been used.')
      const { textHash: _textHash, expiresAt: _expiresAt, ...message } = existing
      return { message: { ...message, text }, created: false }
    }
    if (player.isBot) throw new Error('Bots cannot use chat.')
    if (room.settings.chatMode !== 'text') throw new Error('Text chat is not available in this room.')

    beforeCreate()
    const chat = currentChat ?? this.ensureChatRoom(room.code)
    const message: ChatMessage = {
      id: randomUUID(),
      epoch: chat.epoch,
      clientMessageId,
      sequence: chat.nextSequence,
      playerId: player.id,
      playerName: player.name,
      text,
      createdAt: now,
    }
    chat.nextSequence += 1
    chat.messages.push(message)
    if (chat.messages.length > CHAT_HISTORY_LIMIT) chat.messages.splice(0, chat.messages.length - CHAT_HISTORY_LIMIT)
    const { text: _text, ...messageMetadata } = message
    chat.dedupe.set(dedupeKey, {
      ...messageMetadata,
      textHash: hashChatText(text),
      expiresAt: now + CHAT_DEDUPE_TTL_MS,
    })
    pruneChatDedupe(chat, now)
    return { message: { ...message }, created: true }
  }

  private ensureChatRoom(roomCode: string): ChatRoomState {
    let chat = this.chatRooms.get(roomCode)
    if (!chat) {
      chat = { epoch: randomUUID(), nextSequence: 1, messages: [], dedupe: new Map() }
      this.chatRooms.set(roomCode, chat)
    }
    return chat
  }

  startGame(roomCode: string, playerId: string): void {
    const room = this.requireRoom(roomCode)
    this.requireHost(room, playerId)
    if (room.status === 'playing') throw new Error('The match is already in progress.')
    const blockReason = this.startBlockReason(room)
    if (blockReason) throw new Error(blockReason)

    room.players = room.players.filter((player) => player.isBot || player.connected)
    room.players.forEach((player) => {
      player.hand = []
      player.escaped = false
      player.ready = player.isBot || !player.usesReadyProtocol
      player.rematchReady = player.isBot || !player.usesReadyProtocol
      player.reconnectGraceUsed = false
      this.ensureScore(room, player)
    })
    ensureConnectedHost(room)

    const deck = shuffle(makeDeck())
    deck.forEach((card, index) => room.players[index % room.players.length].hand.push(card))
    room.players.forEach((player) => (player.hand = sortCards(player.hand)))
    const opener = room.players.find((player) => player.hand.some((card) => card.id === 'spades-A'))
    if (!opener) throw new Error('The deck could not be dealt correctly.')

    room.status = 'playing'
    room.session.roundNumber += 1
    room.game = {
      phase: 'turn',
      trick: [],
      resolvedTrick: null,
      resolutionEndsAt: null,
      pendingTurnId: null,
      pendingLoserId: null,
      pendingWasteLeadPlayerId: null,
      pendingWasteCards: [],
      waste: [],
      leadSuit: null,
      leaderId: opener.id,
      currentTurnId: opener.id,
      firstTrick: true,
      takeUsedForLead: false,
      loserId: null,
      turnEndsAt: null,
      turnRemainingMs: null,
      reconnectPlayerId: null,
      reconnectEndsAt: null,
      roundEscapeOrder: [],
      roundPlayerIds: room.players.map((player) => player.id),
      scoreRecorded: false,
      activity: [],
    }
    addActivity(room.game, `${opener.name} has the Ace of Spades and opens. Play moves anticlockwise to the right.`, 'neutral', 'general', { openerId: opener.id })
    room.suspended = false
    this.changed(room)
  }

  playCard(roomCode: string, playerId: string, cardId: unknown, automatic = false): void {
    const room = this.requireRoom(roomCode)
    const game = room.game
    if (room.status !== 'playing' || !game) throw new Error('There is no active match.')
    if (game.phase === 'resolving') throw new Error('The completed trick is still being shown.')
    if (game.phase === 'waiting_for_reconnect') throw new Error('The match is waiting for a player to reconnect.')
    if (game.currentTurnId !== playerId) throw new Error('Wait for your turn.')
    const player = this.requirePlayer(room, playerId)
    if (player.escaped) throw new Error('You are no longer active in this match.')
    if (typeof cardId !== 'string' || cardId.length > 32) throw new Error('Choose a valid card.')
    const legalCards = this.legalCards(room, playerId)
    const card = legalCards.find((candidate) => candidate.id === cardId)
    if (!card) throw new Error('You must follow the led suit when you can.')

    game.turnEndsAt = null
    player.hand = player.hand.filter((candidate) => candidate.id !== card.id)
    game.trick.push({ playerId, card })
    if (automatic) addActivity(game, `${player.name} ran out of time; ${card.rank} of ${card.suit} was played automatically.`, 'warning', 'general', { playerId, cardId: card.id })

    if (game.trick.length === 1) {
      game.leadSuit = card.suit
      game.leaderId = playerId
      game.takeUsedForLead = true
    }

    if (game.firstTrick) {
      this.resolveFirstTrickOrAdvance(room, player)
      this.changed(room)
      return
    }

    const isThulla = game.trick.length > 1 && card.suit !== game.leadSuit
    if (isThulla) {
      this.resolveThulla(room, player)
      this.changed(room)
      return
    }

    if (game.trick.length === activePlayers(room).length) {
      this.resolveCleanTrick(room)
    } else {
      game.currentTurnId = nextActive(room, player.id)?.id ?? null
    }
    this.changed(room)
  }

  takeRightHand(roomCode: string, playerId: string): void {
    const room = this.requireRoom(roomCode)
    const game = room.game
    if (room.status !== 'playing' || !game) throw new Error('There is no active match.')
    if (game.phase !== 'turn') throw new Error('Wait for the next trick to begin.')
    if (game.firstTrick || game.trick.length > 0) throw new Error("You can only take the right-hand player's cards before leading a new trick.")
    if (game.currentTurnId !== playerId) throw new Error('Only the player with the power can take the right-hand cards.')
    if (game.takeUsedForLead) throw new Error('You already used the right-hand option for this trick.')

    const player = this.requirePlayer(room, playerId)
    const target = nextActive(room, playerId)
    if (player.escaped || !target || target.id === player.id) throw new Error('There is no active player on your right.')

    const takenCount = target.hand.length
    player.hand = sortCards([...player.hand, ...target.hand])
    target.hand = []
    this.markEscaped(room, target)
    game.takeUsedForLead = true
    game.turnEndsAt = null
    addActivity(game, `${player.name} took ${takenCount} cards from ${target.name} on the right. ${target.name} got away.`, 'warning', 'take', { playerId, targetId: target.id, cardCount: takenCount })

    const loserId = this.onlyRemainingPlayerId(room)
    if (loserId) this.finalizeMatch(room, loserId)
    else {
      game.currentTurnId = player.id
      game.leaderId = player.id
    }
    this.changed(room)
  }

  legalCards(room: Room, playerId: string): Card[] {
    const game = room.game
    const player = room.players.find((candidate) => candidate.id === playerId)
    if (!game || game.phase !== 'turn' || !player || game.currentTurnId !== playerId) return []
    if (game.firstTrick && game.trick.length === 0) return player.hand.filter((card) => card.id === 'spades-A')
    if (!game.leadSuit || game.trick.length === 0) return player.hand
    const followingSuit = player.hand.filter((card) => card.suit === game.leadSuit)
    return followingSuit.length ? followingSuit : player.hand
  }

  private resolveFirstTrickOrAdvance(room: Room, player: Player): void {
    const game = room.game!
    if (game.trick.length < activePlayers(room).length) {
      game.currentTurnId = nextActive(room, player.id)?.id ?? null
      return
    }
    const winner = highestLedCard(game.trick, 'spades')
    const completed = [...game.trick]
    game.waste.push(...completed.map((entry) => entry.card))
    game.firstTrick = false
    addActivity(game, 'Opening trick cleared. The Ace of Spades keeps the power.', 'good', 'power', { winnerId: winner.playerId })
    this.beginResolution(room, {
      cards: completed,
      kind: 'opening',
      winnerId: winner.playerId,
      lastPlayerId: player.id,
    }, winner.playerId)
  }

  private resolveThulla(room: Room, thullaPlayer: Player): void {
    const game = room.game!
    const completed = [...game.trick]
    const winnerEntry = highestLedCard(completed, game.leadSuit!)
    const winner = this.requirePlayer(room, winnerEntry.playerId)
    winner.hand = sortCards([...winner.hand, ...completed.map((entry) => entry.card)])
    addActivity(game, `${thullaPlayer.name} played a THULLA! ${winner.name} picked up ${completed.length} cards.`, 'warning', 'thulla', { thullaPlayerId: thullaPlayer.id, winnerId: winner.id, cardCount: completed.length })
    this.escapeEmptyPlayers(room, winner.id)
    this.beginResolution(room, {
      cards: completed,
      kind: 'thulla',
      winnerId: winner.id,
      lastPlayerId: thullaPlayer.id,
    }, winner.id, this.onlyRemainingPlayerId(room))
  }

  private resolveCleanTrick(room: Room): void {
    const game = room.game!
    const completed = [...game.trick]
    const winnerEntry = highestLedCard(completed, game.leadSuit!)
    const winner = this.requirePlayer(room, winnerEntry.playerId)
    this.escapeEmptyPlayers(room, winner.id)
    const loserId = this.onlyRemainingPlayerId(room)
    const needsWasteLead = !loserId && winner.hand.length === 0
    if (needsWasteLead) {
      addActivity(game, `${winner.name} kept the power and will draw a card from the waste to lead.`, 'warning', 'power', { winnerId: winner.id })
    } else if (!loserId) {
      addActivity(game, `${winner.name} won the trick and has the power.`, 'neutral', 'power', { winnerId: winner.id })
    }
    this.beginResolution(room, {
      cards: completed,
      kind: 'clean',
      winnerId: winner.id,
      lastPlayerId: completed[completed.length - 1].playerId,
    }, winner.id, loserId, needsWasteLead ? winner.id : null, completed.map((entry) => entry.card))
  }

  private beginResolution(
    room: Room,
    resolved: ResolvedTrick,
    pendingTurnId: string,
    pendingLoserId: string | null = null,
    pendingWasteLeadPlayerId: string | null = null,
    pendingWasteCards: Card[] = [],
  ): void {
    const game = room.game!
    game.phase = 'resolving'
    game.resolvedTrick = resolved
    game.resolutionEndsAt = Date.now() + TRICK_RESOLUTION_MS
    game.pendingTurnId = pendingTurnId
    game.pendingLoserId = pendingLoserId
    game.pendingWasteLeadPlayerId = pendingWasteLeadPlayerId
    game.pendingWasteCards = pendingWasteCards
    game.trick = []
    game.leadSuit = null
    game.leaderId = pendingTurnId
    game.currentTurnId = null
    game.turnEndsAt = null
    game.turnRemainingMs = null
    game.reconnectPlayerId = null
    game.reconnectEndsAt = null
    game.takeUsedForLead = false
  }

  private completeResolution(room: Room): void {
    const game = room.game
    if (!game || game.phase !== 'resolving') return
    const pendingTurnId = game.pendingTurnId
    const pendingLoserId = game.pendingLoserId
    const wasteLeaderId = game.pendingWasteLeadPlayerId
    const pendingWasteCards = game.pendingWasteCards
    game.resolvedTrick = null
    game.resolutionEndsAt = null
    game.pendingTurnId = null
    game.pendingLoserId = null
    game.pendingWasteLeadPlayerId = null
    game.pendingWasteCards = []

    if (pendingLoserId) {
      game.waste.push(...pendingWasteCards)
      this.finalizeMatch(room, pendingLoserId)
      return
    }

    game.phase = 'turn'
    game.currentTurnId = pendingTurnId
    game.turnEndsAt = null
    if (wasteLeaderId) {
      if (!game.waste.length) throw new Error('No waste card is available for the power lead.')
      const drawnIndex = randomInt(game.waste.length)
      const [drawn] = game.waste.splice(drawnIndex, 1)
      game.trick = [{ playerId: wasteLeaderId, card: drawn }]
      game.leadSuit = drawn.suit
      game.leaderId = wasteLeaderId
      game.currentTurnId = nextActive(room, wasteLeaderId)?.id ?? null
      game.takeUsedForLead = true
    }
    game.waste.push(...pendingWasteCards)
  }

  private escapeEmptyPlayers(room: Room, exceptPlayerId: string): void {
    for (const player of room.players) {
      if (!player.escaped && player.id !== exceptPlayerId && player.hand.length === 0) this.markEscaped(room, player)
    }
  }

  private markEscaped(room: Room, player: Player): void {
    if (player.escaped) return
    player.escaped = true
    room.game?.roundEscapeOrder.push(player.id)
    if (room.game) addActivity(room.game, `${player.name} got away and is safe!`, 'good', 'escape', { playerId: player.id })
  }

  private onlyRemainingPlayerId(room: Room): string | null {
    const remaining = activePlayers(room)
    return remaining.length <= 1 ? remaining[0]?.id ?? null : null
  }

  private finalizeMatch(room: Room, loserId: string): void {
    const game = room.game!
    room.status = 'finished'
    game.phase = 'turn'
    game.loserId = loserId
    game.currentTurnId = null
    game.turnEndsAt = null
    game.turnRemainingMs = null
    game.reconnectPlayerId = null
    game.reconnectEndsAt = null
    const loser = this.requirePlayer(room, loserId)
    addActivity(game, `${loser.name} is the Bhabhi!`, 'warning', 'round', { loserId })
    this.recordScore(room, loserId)
    for (const player of room.players) player.rematchReady = player.isBot || !player.usesReadyProtocol
    ensureConnectedHost(room)
  }

  private recordScore(room: Room, loserId: string): void {
    const game = room.game!
    if (game.scoreRecorded) return
    game.scoreRecorded = true
    const firstEscapeId = game.roundEscapeOrder[0] ?? null
    for (const playerId of game.roundPlayerIds) {
      const player = room.players.find((candidate) => candidate.id === playerId)
      if (!player) continue
      const score = this.ensureScore(room, player)
      score.playerName = player.name
      score.roundsPlayed += 1
      if (playerId === loserId) {
        score.bhabhiCount += 1
        score.currentBhabhiStreak += 1
        score.bestBhabhiStreak = Math.max(score.bestBhabhiStreak, score.currentBhabhiStreak)
      } else {
        score.escapes += 1
        score.currentBhabhiStreak = 0
      }
      if (playerId === firstEscapeId) score.firstEscapes += 1
    }
  }

  private ensureScore(room: Room, player: Player): SessionScore {
    let score = room.session.scores.find((candidate) => candidate.playerId === player.id)
    if (!score) {
      score = newScore(player)
      room.session.scores.push(score)
    }
    return score
  }

  private beginReconnectWait(room: Room, player: Player): void {
    const game = room.game!
    const now = Date.now()
    player.reconnectGraceUsed = true
    game.phase = 'waiting_for_reconnect'
    game.turnRemainingMs = Math.max(0, (game.turnEndsAt ?? now + room.settings.turnSeconds * 1_000) - now)
    game.turnEndsAt = null
    game.reconnectPlayerId = player.id
    game.reconnectEndsAt = now + RECONNECT_GRACE_MS
  }

  private expireReconnectWait(room: Room, expectedPlayerId: string): void {
    const game = room.game
    if (!game || game.phase !== 'waiting_for_reconnect' || game.reconnectPlayerId !== expectedPlayerId) return
    const player = this.requirePlayer(room, expectedPlayerId)
    player.reconnectGraceUsed = true
    game.phase = 'turn'
    game.reconnectPlayerId = null
    game.reconnectEndsAt = null
    game.turnRemainingMs = null
    game.turnEndsAt = null
    addActivity(game, `${player.name} did not reconnect; play continues automatically.`, 'warning', 'connection', { playerId: player.id })
    const legal = this.legalCards(room, expectedPlayerId)
    if (legal.length) this.playCard(room.code, expectedPlayerId, this.chooseBotCard(legal).id, true)
    else this.changed(room)
  }

  private chooseBotCard(cards: Card[]): Card {
    return [...cards].sort((a, b) => rankValue(a.rank) - rankValue(b.rank) || SUITS.indexOf(a.suit) - SUITS.indexOf(b.suit))[0]
  }

  view(room: Room, viewerId: string): RoomView {
    const viewer = this.requirePlayer(room, viewerId)
    const game = room.game
    const canTakeRightHand = Boolean(
      room.status === 'playing'
      && game?.phase === 'turn'
      && !game.firstTrick
      && game.trick.length === 0
      && game.currentTurnId === viewerId
      && !game.takeUsedForLead
      && !viewer.escaped
      && activePlayers(room).length > 1,
    )
    const takeTarget = canTakeRightHand ? nextActive(room, viewerId) : null
    const startBlockReason = this.startBlockReason(room)
    return {
      protocolVersion: PROTOCOL_VERSION,
      code: room.code,
      status: room.status,
      yourPlayerId: viewerId,
      canStart: viewer.isHost && !startBlockReason,
      startBlockReason: viewer.isHost ? startBlockReason : 'Only the host can start the match.',
      minPlayers: 3,
      maxPlayers: 8,
      settings: room.settings,
      session: room.session,
      players: room.players.map((player) => ({
        id: player.id,
        name: player.name,
        cardCount: player.hand.length,
        connected: player.connected,
        escaped: player.escaped,
        isHost: player.isHost,
        isYou: player.id === viewerId,
        ready: player.ready,
        isBot: player.isBot,
        rematchReady: player.rematchReady,
        reconnecting: game?.phase === 'waiting_for_reconnect' && game.reconnectPlayerId === player.id,
        reconnectEndsAt: game?.phase === 'waiting_for_reconnect' && game.reconnectPlayerId === player.id ? game.reconnectEndsAt : null,
      })),
      game: game
        ? {
            phase: game.phase,
            hand: viewer.hand,
            legalCardIds: this.legalCards(room, viewerId).map((card) => card.id),
            trick: game.trick.map((entry) => ({
              playerId: entry.playerId,
              playerName: room.players.find((player) => player.id === entry.playerId)?.name ?? 'Player',
              card: entry.card,
            })),
            resolvedTrick: game.resolvedTrick
              ? {
                  ...game.resolvedTrick,
                  cards: game.resolvedTrick.cards.map((entry) => ({
                    playerId: entry.playerId,
                    playerName: room.players.find((player) => player.id === entry.playerId)?.name ?? 'Player',
                    card: entry.card,
                  })),
                }
              : null,
            resolutionEndsAt: game.resolutionEndsAt,
            pendingTurnId: game.pendingTurnId,
            leadSuit: game.leadSuit,
            currentTurnId: game.currentTurnId,
            leaderId: game.leaderId,
            firstTrick: game.firstTrick,
            canTakeRightHand,
            takeTargetId: takeTarget?.id ?? null,
            wasteCount: game.waste.length,
            loserId: game.loserId,
            turnEndsAt: game.turnEndsAt,
            reconnectPlayerId: game.reconnectPlayerId,
            reconnectEndsAt: game.reconnectEndsAt,
            activity: game.activity,
          }
        : null,
    }
  }

  removeStaleRooms(): void {
    const cutoff = Date.now() - ROOM_TTL_MS
    for (const room of this.rooms.values()) {
      if (room.updatedAt < cutoff && room.players.every((player) => player.isBot || !player.connected)) {
        this.deleteRoom(room)
      }
    }
  }

  private startBlockReason(room: Room): string | null {
    if (room.status === 'playing') return 'The match is already in progress.'
    const participants = room.players.filter((player) => player.isBot || player.connected)
    if (participants.length < 3) return 'At least 3 connected players are required.'
    if (room.status === 'lobby') {
      const waiting = participants.filter((player) => !player.ready)
      if (waiting.length) return `Waiting for ${waiting.map((player) => player.name).join(', ')} to get ready.`
    } else {
      const waiting = participants.filter((player) => !player.rematchReady)
      if (waiting.length) return `Waiting for ${waiting.map((player) => player.name).join(', ')} to accept the rematch.`
    }
    return null
  }

  private requireRoom(codeValue: unknown): Room {
    if (typeof codeValue !== 'string') throw new Error('Room no longer exists.')
    const room = this.rooms.get(codeValue.trim().toUpperCase())
    if (!room) throw new Error('Room no longer exists.')
    return room
  }

  private deleteRoom(room: Room): void {
    this.clearTimer(room.code)
    this.chatRooms.delete(room.code)
    this.rooms.delete(room.code)
    void this.persistence.delete(room.code).catch((error) => console.error('room_store_delete_failed', { code: room.code, error: String(error) }))
  }

  private requirePlayer(room: Room, playerId: unknown): Player {
    if (typeof playerId !== 'string') throw new Error('Player is not in this room.')
    const player = room.players.find((candidate) => candidate.id === playerId)
    if (!player) throw new Error('Player is not in this room.')
    return player
  }

  private requireHost(room: Room, playerId: unknown): Player {
    const player = this.requirePlayer(room, playerId)
    if (!player.isHost) throw new Error('Only the room host can do that.')
    return player
  }

  private changed(room: Room): void {
    room.updatedAt = Date.now()
    this.scheduleRoom(room)
    this.publisher(room)
    void this.persistence.save(room).catch((error) => console.error('room_store_save_failed', { code: room.code, error: String(error) }))
  }

  private clearTimer(code: string): void {
    const timer = this.timers.get(code)
    if (timer) clearTimeout(timer)
    this.timers.delete(code)
  }

  private scheduleRoom(room: Room): void {
    this.clearTimer(room.code)
    const game = room.game
    if (room.suspended || room.status !== 'playing' || !game) return
    const now = Date.now()

    if (game.phase === 'resolving') {
      const deadline = game.resolutionEndsAt ?? now + TRICK_RESOLUTION_MS
      game.resolutionEndsAt = deadline
      const timer = setTimeout(() => {
        if (room.game?.phase !== 'resolving' || room.game.resolutionEndsAt !== deadline) return
        this.completeResolution(room)
        this.changed(room)
      }, Math.max(1, deadline - now))
      timer.unref()
      this.timers.set(room.code, timer)
      return
    }

    if (game.phase === 'waiting_for_reconnect') {
      const expectedPlayer = game.reconnectPlayerId
      if (!expectedPlayer) return
      const deadline = game.reconnectEndsAt ?? now + RECONNECT_GRACE_MS
      game.reconnectEndsAt = deadline
      const timer = setTimeout(() => this.expireReconnectWait(room, expectedPlayer), Math.max(1, deadline - now))
      timer.unref()
      this.timers.set(room.code, timer)
      return
    }

    if (!game.currentTurnId) return
    const player = room.players.find((candidate) => candidate.id === game.currentTurnId)
    if (!player) return

    if (!player.connected && !player.isBot && !player.reconnectGraceUsed) {
      this.beginReconnectWait(room, player)
      this.scheduleRoom(room)
      return
    }

    const isAutomaticSeat = player.isBot || !player.connected
    const deadline = isAutomaticSeat
      ? now + randomInt(700, 1_401)
      : game.turnEndsAt !== null
        ? game.turnEndsAt
        : now + room.settings.turnSeconds * 1_000
    game.turnEndsAt = isAutomaticSeat ? null : deadline
    const expectedPlayer = game.currentTurnId
    const timer = setTimeout(() => {
      if (room.status !== 'playing' || room.game?.phase !== 'turn' || room.game.currentTurnId !== expectedPlayer) return
      const legal = this.legalCards(room, expectedPlayer)
      if (legal.length) this.playCard(room.code, expectedPlayer, this.chooseBotCard(legal).id, true)
    }, Math.max(1, deadline - now))
    timer.unref()
    this.timers.set(room.code, timer)
  }
}
