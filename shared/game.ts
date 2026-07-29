export const SUITS = ['spades', 'hearts', 'diamonds', 'clubs'] as const
export const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'] as const
export const TURN_SECONDS = [20, 35, 60] as const
export const TRICK_RESOLUTION_MS = 3_000
export const RECONNECT_GRACE_MS = 60_000
export const PROTOCOL_VERSION = '2.0.0'
export const CHAT_MODES = ['text', 'quick', 'off'] as const
export const CHAT_MAX_CODE_POINTS = 200
export const CHAT_HISTORY_LIMIT = 50

export const REACTIONS = ['thulla', 'wah', 'oye', 'chalo', 'bach-gaya', 'good-move'] as const

export type Suit = (typeof SUITS)[number]
export type Rank = (typeof RANKS)[number]
export type TurnSeconds = (typeof TURN_SECONDS)[number]
export type Reaction = (typeof REACTIONS)[number]
export type ChatMode = (typeof CHAT_MODES)[number]
export type ServerCapability = 'chat-v1'
export type GamePhase = 'turn' | 'resolving' | 'waiting_for_reconnect'

export interface Card {
  id: string
  suit: Suit
  rank: Rank
}

export interface PlayerView {
  id: string
  name: string
  cardCount: number
  connected: boolean
  escaped: boolean
  isHost: boolean
  isYou: boolean
  ready: boolean
  isBot: boolean
  rematchReady: boolean
  reconnecting: boolean
  reconnectEndsAt: number | null
}

export interface TrickCardView {
  playerId: string
  playerName: string
  card: Card
}

export interface ResolvedTrickView {
  cards: TrickCardView[]
  kind: 'opening' | 'clean' | 'thulla'
  winnerId: string
  lastPlayerId: string
}

export interface ActivityItem {
  id: string
  text: string
  tone: 'neutral' | 'good' | 'warning'
  kind?: 'general' | 'thulla' | 'power' | 'escape' | 'take' | 'round' | 'connection'
  data?: Record<string, string | number | boolean | null>
}

export interface RoomSettings {
  turnSeconds: TurnSeconds
  reconnectGraceSeconds: 60
  allowBots: boolean
  reactionsEnabled: boolean
  tutorialHints: boolean
  chatMode: ChatMode
}

export interface SessionScore {
  playerId: string
  playerName: string
  roundsPlayed: number
  escapes: number
  firstEscapes: number
  bhabhiCount: number
  currentBhabhiStreak: number
  bestBhabhiStreak: number
}

export interface SessionView {
  roundNumber: number
  scores: SessionScore[]
}

export interface ReactionEvent {
  id: string
  playerId: string
  playerName: string
  reaction: Reaction
  createdAt: number
}

export interface ChatMessage {
  id: string
  epoch: string
  clientMessageId: string
  sequence: number
  playerId: string
  playerName: string
  text: string
  createdAt: number
}

export interface ChatHistory {
  epoch: string
  messages: ChatMessage[]
}

export interface RoomView {
  protocolVersion: typeof PROTOCOL_VERSION
  code: string
  status: 'lobby' | 'playing' | 'finished'
  players: PlayerView[]
  yourPlayerId: string
  canStart: boolean
  startBlockReason: string | null
  minPlayers: number
  maxPlayers: number
  settings: RoomSettings
  session: SessionView
  game: null | {
    phase: GamePhase
    hand: Card[]
    legalCardIds: string[]
    trick: TrickCardView[]
    resolvedTrick: ResolvedTrickView | null
    resolutionEndsAt: number | null
    pendingTurnId: string | null
    leadSuit: Suit | null
    currentTurnId: string | null
    leaderId: string | null
    firstTrick: boolean
    canTakeRightHand: boolean
    takeTargetId: string | null
    wasteCount: number
    loserId: string | null
    turnEndsAt: number | null
    reconnectPlayerId: string | null
    reconnectEndsAt: number | null
    activity: ActivityItem[]
  }
}

export interface RoomCredentials {
  code: string
  playerId: string
  token: string
}

export interface RoomLeaveResult {
  code: string
  roomDeleted: boolean
  leftDuringPlay: boolean
}

export interface ServerHello {
  protocolVersion: typeof PROTOCOL_VERSION
  capabilities?: ServerCapability[]
}

export interface Ack<T = undefined> {
  ok: boolean
  data?: T
  error?: string
}

export const suitSymbol: Record<Suit, string> = {
  spades: '♠',
  hearts: '♥',
  diamonds: '♦',
  clubs: '♣',
}

export const suitLabel: Record<Suit, string> = {
  spades: 'Spades',
  hearts: 'Hearts',
  diamonds: 'Diamonds',
  clubs: 'Clubs',
}

export function rankValue(rank: Rank): number {
  return RANKS.indexOf(rank)
}

export function sortCards(cards: Card[]): Card[] {
  return [...cards].sort((a, b) => {
    const suitDifference = SUITS.indexOf(a.suit) - SUITS.indexOf(b.suit)
    return suitDifference || rankValue(a.rank) - rankValue(b.rank)
  })
}
