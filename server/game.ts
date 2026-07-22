import { randomBytes, randomInt, randomUUID } from 'node:crypto'
import {
  RANKS,
  SUITS,
  rankValue,
  sortCards,
  type ActivityItem,
  type Card,
  type RoomCredentials,
  type RoomView,
  type Suit,
} from '../shared/game.js'

const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const TURN_LENGTH_MS = 35_000

interface Player {
  id: string
  token: string
  socketId: string | null
  name: string
  hand: Card[]
  connected: boolean
  escaped: boolean
  isHost: boolean
}

interface TrickCard {
  playerId: string
  card: Card
}

interface GameState {
  trick: TrickCard[]
  waste: Card[]
  leadSuit: Suit | null
  leaderId: string | null
  currentTurnId: string | null
  firstTrick: boolean
  loserId: string | null
  turnEndsAt: number | null
  activity: ActivityItem[]
}

export interface Room {
  code: string
  status: 'lobby' | 'playing' | 'finished'
  players: Player[]
  game: GameState | null
  updatedAt: number
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

function activePlayers(room: Room): Player[] {
  return room.players.filter((player) => !player.escaped)
}

function ensureConnectedHost(room: Room): void {
  if (room.players.some((player) => player.isHost && player.connected)) return
  for (const player of room.players) player.isHost = false
  const nextHost = room.players.find((player) => player.connected)
  if (nextHost) nextHost.isHost = true
}

function nextActive(room: Room, playerId: string): Player | null {
  const startIndex = room.players.findIndex((player) => player.id === playerId)
  for (let offset = 1; offset <= room.players.length; offset += 1) {
    const candidate = room.players[(startIndex + offset) % room.players.length]
    if (!candidate.escaped) return candidate
  }
  return null
}

function highestLedCard(trick: TrickCard[], leadSuit: Suit): TrickCard {
  const suited = trick.filter((entry) => entry.card.suit === leadSuit)
  return suited.reduce((highest, entry) =>
    rankValue(entry.card.rank) > rankValue(highest.card.rank) ? entry : highest,
  )
}

function addActivity(game: GameState, text: string, tone: ActivityItem['tone'] = 'neutral'): void {
  game.activity.unshift({ id: randomUUID(), text, tone })
  game.activity = game.activity.slice(0, 12)
}

export class GameManager {
  readonly rooms = new Map<string, Room>()
  private readonly timers = new Map<string, NodeJS.Timeout>()
  private publisher: (room: Room) => void = () => undefined

  setPublisher(publisher: (room: Room) => void): void {
    this.publisher = publisher
  }

  private makeRoomCode(): string {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      let code = ''
      for (let index = 0; index < 5; index += 1) code += ROOM_ALPHABET[randomInt(ROOM_ALPHABET.length)]
      if (!this.rooms.has(code)) return code
    }
    throw new Error('Could not create a room. Please try again.')
  }

  private makePlayer(name: unknown, socketId: string, isHost: boolean): Player {
    return {
      id: randomUUID(),
      token: randomBytes(24).toString('base64url'),
      socketId,
      name: cleanName(name),
      hand: [],
      connected: true,
      escaped: false,
      isHost,
    }
  }

  createRoom(name: unknown, socketId: string): { room: Room; credentials: RoomCredentials } {
    const player = this.makePlayer(name, socketId, true)
    const room: Room = {
      code: this.makeRoomCode(),
      status: 'lobby',
      players: [player],
      game: null,
      updatedAt: Date.now(),
    }
    this.rooms.set(room.code, room)
    return { room, credentials: { code: room.code, playerId: player.id, token: player.token } }
  }

  joinRoom(codeValue: unknown, name: unknown, socketId: string): { room: Room; credentials: RoomCredentials } {
    const code = String(codeValue ?? '').trim().toUpperCase()
    const room = this.rooms.get(code)
    if (!room) throw new Error('Room not found. Check the code and try again.')
    if (room.status !== 'lobby') throw new Error('This match has already started.')
    if (room.players.length >= 8) throw new Error('This room is full.')
    const player = this.makePlayer(name, socketId, false)
    room.players.push(player)
    this.changed(room)
    return { room, credentials: { code, playerId: player.id, token: player.token } }
  }

  reconnectRoom(codeValue: unknown, tokenValue: unknown, socketId: string): { room: Room; credentials: RoomCredentials } {
    const code = String(codeValue ?? '').trim().toUpperCase()
    const token = String(tokenValue ?? '')
    const room = this.rooms.get(code)
    const player = room?.players.find((candidate) => candidate.token === token)
    if (!room || !player) throw new Error('That saved seat is no longer available.')
    player.socketId = socketId
    player.connected = true
    this.changed(room)
    return { room, credentials: { code, playerId: player.id, token: player.token } }
  }

  disconnect(socketId: string): Room | null {
    for (const room of this.rooms.values()) {
      const player = room.players.find((candidate) => candidate.socketId === socketId)
      if (!player) continue
      player.connected = false
      player.socketId = null
      if (room.status !== 'playing') ensureConnectedHost(room)
      if (room.status === 'lobby' && room.players.every((candidate) => !candidate.connected)) {
        room.updatedAt = Date.now()
      } else {
        this.changed(room)
      }
      return room
    }
    return null
  }

  startGame(roomCode: string, playerId: string): void {
    const room = this.requireRoom(roomCode)
    const requester = room.players.find((player) => player.id === playerId)
    if (!requester?.isHost) throw new Error('Only the room host can start the match.')
    if (room.status === 'playing') throw new Error('The match is already in progress.')

    room.players = room.players.filter((player) => player.connected)
    if (room.players.length < 3) throw new Error('At least 3 connected players are required.')
    room.players.forEach((player, index) => {
      player.isHost = index === 0
      player.hand = []
      player.escaped = false
    })

    const deck = shuffle(makeDeck())
    deck.forEach((card, index) => room.players[index % room.players.length].hand.push(card))
    room.players.forEach((player) => (player.hand = sortCards(player.hand)))
    const opener = room.players.find((player) => player.hand.some((card) => card.id === 'spades-A'))
    if (!opener) throw new Error('The deck could not be dealt correctly.')

    room.status = 'playing'
    room.game = {
      trick: [],
      waste: [],
      leadSuit: null,
      leaderId: opener.id,
      currentTurnId: opener.id,
      firstTrick: true,
      loserId: null,
      turnEndsAt: null,
      activity: [],
    }
    addActivity(room.game, `${opener.name} has the Ace of Spades and opens the game.`)
    this.changed(room)
  }

  playCard(roomCode: string, playerId: string, cardId: unknown, automatic = false): void {
    const room = this.requireRoom(roomCode)
    const game = room.game
    if (room.status !== 'playing' || !game) throw new Error('There is no active match.')
    if (game.currentTurnId !== playerId) throw new Error('Wait for your turn.')
    const player = room.players.find((candidate) => candidate.id === playerId)
    if (!player || player.escaped) throw new Error('You are no longer active in this match.')
    const legalCards = this.legalCards(room, playerId)
    const card = legalCards.find((candidate) => candidate.id === cardId)
    if (!card) throw new Error('You must follow the led suit when you can.')

    game.turnEndsAt = null
    player.hand = player.hand.filter((candidate) => candidate.id !== card.id)
    game.trick.push({ playerId, card })
    if (automatic) addActivity(game, `${player.name} ran out of time; ${card.rank} of ${card.suit} was played automatically.`, 'warning')

    if (game.trick.length === 1) {
      game.leadSuit = card.suit
      game.leaderId = playerId
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

  legalCards(room: Room, playerId: string): Card[] {
    const game = room.game
    const player = room.players.find((candidate) => candidate.id === playerId)
    if (!game || !player || game.currentTurnId !== playerId) return []
    if (game.firstTrick && game.trick.length === 0) {
      return player.hand.filter((card) => card.id === 'spades-A')
    }
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
    game.waste.push(...game.trick.map((entry) => entry.card))
    game.trick = []
    game.leadSuit = null
    game.leaderId = winner.playerId
    game.currentTurnId = winner.playerId
    game.firstTrick = false
    addActivity(game, 'Opening trick cleared. The Ace of Spades keeps the power.', 'good')
  }

  private resolveThulla(room: Room, thullaPlayer: Player): void {
    const game = room.game!
    const winnerEntry = highestLedCard(game.trick, game.leadSuit!)
    const winner = room.players.find((player) => player.id === winnerEntry.playerId)!
    winner.hand = sortCards([...winner.hand, ...game.trick.map((entry) => entry.card)])
    addActivity(game, `${thullaPlayer.name} played a THULLA! ${winner.name} picked up ${game.trick.length} cards.`, 'warning')
    game.trick = []
    game.leadSuit = null
    game.leaderId = winner.id
    this.escapeEmptyPlayers(room, winner.id)
    if (this.finishIfOneRemains(room)) return
    game.currentTurnId = winner.id
  }

  private resolveCleanTrick(room: Room): void {
    const game = room.game!
    const completed = [...game.trick]
    const winnerEntry = highestLedCard(completed, game.leadSuit!)
    const winner = room.players.find((player) => player.id === winnerEntry.playerId)!
    game.trick = []
    game.leadSuit = null
    game.leaderId = winner.id
    this.escapeEmptyPlayers(room, winner.id)

    if (this.finishIfOneRemains(room)) {
      game.waste.push(...completed.map((entry) => entry.card))
      return
    }

    if (winner.hand.length === 0) {
      const drawnIndex = randomInt(game.waste.length)
      const [drawn] = game.waste.splice(drawnIndex, 1)
      game.trick = [{ playerId: winner.id, card: drawn }]
      game.leadSuit = drawn.suit
      game.leaderId = winner.id
      game.currentTurnId = nextActive(room, winner.id)?.id ?? null
      addActivity(game, `${winner.name} kept the power and drew a card from the waste to lead.`, 'warning')
    } else {
      game.currentTurnId = winner.id
      addActivity(game, `${winner.name} won the trick and has the power.`)
    }
    game.waste.push(...completed.map((entry) => entry.card))
  }

  private escapeEmptyPlayers(room: Room, exceptPlayerId: string): void {
    for (const player of room.players) {
      if (!player.escaped && player.id !== exceptPlayerId && player.hand.length === 0) {
        player.escaped = true
        addActivity(room.game!, `${player.name} got away and is safe!`, 'good')
      }
    }
  }

  private finishIfOneRemains(room: Room): boolean {
    const remaining = activePlayers(room)
    if (remaining.length > 1) return false
    const loser = remaining[0]
    room.status = 'finished'
    room.game!.loserId = loser?.id ?? null
    room.game!.currentTurnId = null
    room.game!.turnEndsAt = null
    ensureConnectedHost(room)
    if (loser) addActivity(room.game!, `${loser.name} is the Bhabhi!`, 'warning')
    return true
  }

  view(room: Room, viewerId: string): RoomView {
    const viewer = room.players.find((player) => player.id === viewerId)
    if (!viewer) throw new Error('Player is not in this room.')
    return {
      code: room.code,
      status: room.status,
      yourPlayerId: viewerId,
      canStart: viewer.isHost && room.status !== 'playing' && room.players.filter((player) => player.connected).length >= 3,
      minPlayers: 3,
      maxPlayers: 8,
      players: room.players.map((player) => ({
        id: player.id,
        name: player.name,
        cardCount: player.hand.length,
        connected: player.connected,
        escaped: player.escaped,
        isHost: player.isHost,
        isYou: player.id === viewerId,
      })),
      game: room.game
        ? {
            hand: viewer.hand,
            legalCardIds: this.legalCards(room, viewerId).map((card) => card.id),
            trick: room.game.trick.map((entry) => ({
              playerId: entry.playerId,
              playerName: room.players.find((player) => player.id === entry.playerId)?.name ?? 'Player',
              card: entry.card,
            })),
            leadSuit: room.game.leadSuit,
            currentTurnId: room.game.currentTurnId,
            leaderId: room.game.leaderId,
            firstTrick: room.game.firstTrick,
            wasteCount: room.game.waste.length,
            loserId: room.game.loserId,
            turnEndsAt: room.game.turnEndsAt,
            activity: room.game.activity,
          }
        : null,
    }
  }

  removeStaleRooms(): void {
    const cutoff = Date.now() - 6 * 60 * 60 * 1000
    for (const room of this.rooms.values()) {
      if (room.updatedAt < cutoff && room.players.every((player) => !player.connected)) {
        this.clearTimer(room.code)
        this.rooms.delete(room.code)
      }
    }
  }

  private requireRoom(code: string): Room {
    const room = this.rooms.get(code)
    if (!room) throw new Error('Room no longer exists.')
    return room
  }

  private changed(room: Room): void {
    room.updatedAt = Date.now()
    this.scheduleTurn(room)
    this.publisher(room)
  }

  private clearTimer(code: string): void {
    const timer = this.timers.get(code)
    if (timer) clearTimeout(timer)
    this.timers.delete(code)
  }

  private scheduleTurn(room: Room): void {
    this.clearTimer(room.code)
    if (room.status !== 'playing' || !room.game?.currentTurnId) return
    const deadline = room.game.turnEndsAt && room.game.turnEndsAt > Date.now()
      ? room.game.turnEndsAt
      : Date.now() + TURN_LENGTH_MS
    room.game.turnEndsAt = deadline
    const expectedPlayer = room.game.currentTurnId
    const timer = setTimeout(() => {
      if (room.status !== 'playing' || room.game?.currentTurnId !== expectedPlayer) return
      const legal = this.legalCards(room, expectedPlayer)
      if (legal.length) this.playCard(room.code, expectedPlayer, legal[0].id, true)
    }, Math.max(1, deadline - Date.now()))
    timer.unref()
    this.timers.set(room.code, timer)
  }
}
