import {
  PROTOCOL_VERSION,
  type Card,
  type PartyBoardPlayerView,
  type PartyBoardView,
  type ReactionEvent,
  type SessionScore,
} from '../shared/game'
import type { PartyBoardFixtureState } from './components/party/PartyBoard'

const names = ['Hamza', 'Ayesha', 'Bilal', 'Nouman', 'Hira', 'Danish', 'Mehwish', 'Sana']

function players(count = 4): PartyBoardPlayerView[] {
  return names.slice(0, count).map((name, index) => ({
    id: `party-p${index + 1}`,
    name,
    cardCount: 8 - index % 4,
    connected: true,
    escaped: false,
    isHost: index === 0,
    ready: true,
    isBot: index === 2,
    rematchReady: index !== count - 1,
    waitingForNextRound: false,
    joinedInRound: 1,
    reconnecting: false,
    reconnectEndsAt: null,
  }))
}

function scores(boardPlayers: PartyBoardPlayerView[]): SessionScore[] {
  return boardPlayers.map((player, index) => ({
    playerId: player.id,
    playerName: player.name,
    roundsPlayed: 3,
    escapes: (index + 2) % 4,
    firstEscapes: index % 2,
    bhabhiCount: index === 2 ? 2 : index % 2,
    currentBhabhiStreak: index === 2 ? 1 : 0,
    bestBhabhiStreak: index === 2 ? 2 : index % 2,
  }))
}

function card(id: string, suit: Card['suit'], rank: Card['rank']): Card {
  return { id, suit, rank }
}

function base(count = 4): PartyBoardView {
  const boardPlayers = players(count)
  const now = Date.now()
  return {
    protocolVersion: PROTOCOL_VERSION,
    revision: 12,
    serverNow: now,
    mode: 'party',
    code: 'TNK7M',
    status: 'playing',
    minPlayers: 3,
    maxPlayers: 8,
    settings: { turnSeconds: 35, reconnectGraceSeconds: 60, allowBots: true, reactionsEnabled: true, tutorialHints: true, chatMode: 'text' },
    session: { roundNumber: 3, scores: scores(boardPlayers) },
    players: boardPlayers,
    game: {
      phase: 'turn',
      trick: [
        { playerId: boardPlayers[0].id, playerName: boardPlayers[0].name, card: card('party-s4', 'spades', '4') },
        { playerId: boardPlayers[1].id, playerName: boardPlayers[1].name, card: card('party-sj', 'spades', 'J') },
      ],
      resolvedTrick: null,
      resolutionEndsAt: null,
      pendingTurnId: null,
      leadSuit: 'spades',
      currentTurnId: boardPlayers[2].id,
      leaderId: boardPlayers[0].id,
      firstTrick: false,
      wasteCount: 12,
      loserId: null,
      turnEndsAt: now + 5 * 60_000,
      reconnectPlayerId: null,
      reconnectEndsAt: null,
      activity: [{ id: 'party-a1', text: 'Ayesha won the last trick and has the power.', tone: 'neutral', kind: 'power', data: { playerId: boardPlayers[1].id } }],
    },
  }
}

export function makePartyBoardQaFixture(mode: string | null): PartyBoardFixtureState | null {
  if (!mode) return null
  const circularCount = mode.match(/^circle-([3-8])$/)?.[1]
  const count = circularCount ? Number(circularCount) : mode === 'many' ? 8 : 4
  const view = base(count)
  let reaction: ReactionEvent | null = null
  let connected = mode !== 'offline'
  let status: PartyBoardFixtureState['status'] = connected ? 'ready' : 'offline'

  if (mode === 'lobby') {
    view.status = 'lobby'
    view.game = null
    view.players = view.players.slice(0, 3)
    view.players[2].ready = false
    view.session.scores = scores(view.players)
  } else if (mode === 'resolving') {
    const boardPlayers = view.players
    view.game = {
      ...view.game!,
      phase: 'resolving',
      trick: [],
      resolvedTrick: {
        kind: 'thulla',
        winnerId: boardPlayers[1].id,
        lastPlayerId: boardPlayers[2].id,
        cards: [
          { playerId: boardPlayers[0].id, playerName: boardPlayers[0].name, card: card('party-r7', 'spades', '7') },
          { playerId: boardPlayers[1].id, playerName: boardPlayers[1].name, card: card('party-rk', 'spades', 'K') },
          { playerId: boardPlayers[2].id, playerName: boardPlayers[2].name, card: card('party-rh', 'hearts', '5') },
        ],
      },
      resolutionEndsAt: Date.now() + 5 * 60_000,
      pendingTurnId: boardPlayers[1].id,
      currentTurnId: null,
      turnEndsAt: null,
    }
  } else if (mode === 'finished') {
    view.status = 'finished'
    view.game = { ...view.game!, trick: [], currentTurnId: null, turnEndsAt: null, loserId: view.players[2].id }
  } else if (mode === 'reconnect') {
    const reconnecting = view.players[1]
    reconnecting.connected = false
    reconnecting.reconnecting = true
    reconnecting.reconnectEndsAt = Date.now() + 5 * 60_000
    view.game = {
      ...view.game!, phase: 'waiting_for_reconnect', currentTurnId: null, turnEndsAt: null,
      reconnectPlayerId: reconnecting.id, reconnectEndsAt: reconnecting.reconnectEndsAt,
    }
  } else if (mode === 'reaction') {
    reaction = {
      id: 'party-reaction-1',
      playerId: view.players[1].id,
      playerName: view.players[1].name,
      reaction: 'wah',
      createdAt: Date.now(),
    }
  } else if (mode === 'expired') {
    connected = false
    status = 'expired'
    return { status, connected, view: null, error: 'This Party room expired after being inactive.' }
  }

  return { status, connected, view, reaction }
}
