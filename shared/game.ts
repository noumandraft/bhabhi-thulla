export const SUITS = ['spades', 'hearts', 'diamonds', 'clubs'] as const
export const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'] as const

export type Suit = (typeof SUITS)[number]
export type Rank = (typeof RANKS)[number]

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
  kind?: 'general' | 'thulla' | 'power' | 'escape' | 'take' | 'round'
}

export interface RoomView {
  code: string
  status: 'lobby' | 'playing' | 'finished'
  players: PlayerView[]
  yourPlayerId: string
  canStart: boolean
  minPlayers: number
  maxPlayers: number
  game: null | {
    hand: Card[]
    legalCardIds: string[]
    trick: TrickCardView[]
    resolvedTrick: ResolvedTrickView | null
    leadSuit: Suit | null
    currentTurnId: string | null
    leaderId: string | null
    firstTrick: boolean
    canTakeRightHand: boolean
    takeTargetId: string | null
    wasteCount: number
    loserId: string | null
    turnEndsAt: number | null
    activity: ActivityItem[]
  }
}

export interface RoomCredentials {
  code: string
  playerId: string
  token: string
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
