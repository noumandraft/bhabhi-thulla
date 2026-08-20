import { PROTOCOL_VERSION, type Card } from '../shared/game'
import type { ClientRoomView } from './protocol'

const players: ClientRoomView['players'] = [
  { id: 'p1', name: 'Hamza', cardCount: 7, connected: true, escaped: false, isHost: true, isYou: true, ready: true, isBot: false, rematchReady: true, reconnecting: false, reconnectEndsAt: null, waitingForNextRound: false, joinedInRound: 1 },
  { id: 'p2', name: 'Ayesha', cardCount: 5, connected: true, escaped: false, isHost: false, isYou: false, ready: true, isBot: false, rematchReady: true, reconnecting: false, reconnectEndsAt: null, waitingForNextRound: false, joinedInRound: 1 },
  { id: 'p3', name: 'Bilal', cardCount: 6, connected: true, escaped: false, isHost: false, isYou: false, ready: true, isBot: true, rematchReady: true, reconnecting: false, reconnectEndsAt: null, waitingForNextRound: false, joinedInRound: 1 },
]

const cards: Card[] = [
  { id: 's2', suit: 'spades', rank: '2' }, { id: 's8', suit: 'spades', rank: '8' }, { id: 'h6', suit: 'hearts', rank: '6' },
  { id: 'hK', suit: 'hearts', rank: 'K' }, { id: 'd4', suit: 'diamonds', rank: '4' }, { id: 'dQ', suit: 'diamonds', rank: 'Q' }, { id: 'cA', suit: 'clubs', rank: 'A' },
]

function base(): ClientRoomView {
  return {
    protocolVersion: PROTOCOL_VERSION,
    revision: 1,
    serverNow: Date.now(),
    mode: 'online',
    partyBoardConnected: false,
    code: 'QA123', status: 'playing', players: players.map((player) => ({ ...player })), yourPlayerId: 'p1', canStart: false, startBlockReason: 'Match in progress.', minPlayers: 3, maxPlayers: 8,
    settings: { turnSeconds: 35, reconnectGraceSeconds: 60, allowBots: true, reactionsEnabled: true, tutorialHints: true, chatMode: 'text' },
    session: { roundNumber: 3, scores: [
      { playerId: 'p1', playerName: 'Hamza', roundsPlayed: 3, escapes: 2, firstEscapes: 1, bhabhiCount: 1, currentBhabhiStreak: 1, bestBhabhiStreak: 1 },
      { playerId: 'p2', playerName: 'Ayesha', roundsPlayed: 3, escapes: 3, firstEscapes: 2, bhabhiCount: 0, currentBhabhiStreak: 0, bestBhabhiStreak: 0 },
      { playerId: 'p3', playerName: 'Bilal', roundsPlayed: 3, escapes: 1, firstEscapes: 0, bhabhiCount: 2, currentBhabhiStreak: 0, bestBhabhiStreak: 2 },
    ] },
    game: {
      phase: 'turn', hand: cards, legalCardIds: cards.map((card) => card.id), trick: [], resolvedTrick: null, resolutionEndsAt: null, pendingTurnId: null,
      leadSuit: null, currentTurnId: 'p1', leaderId: 'p1', firstTrick: false, canTakeRightHand: true, takeTargetId: 'p2', wasteCount: 12, loserId: null,
      turnEndsAt: Date.now() + 35_000, reconnectPlayerId: null, reconnectEndsAt: null,
      activity: [{ id: 'a1', text: 'Ayesha won the last trick and has the power.', tone: 'neutral', kind: 'power' }],
    },
  }
}

export function makeQaRoom(mode: string | null): ClientRoomView | null {
  if (!mode) return null
  const room = base()
  if (mode === 'lobby') {
    room.status = 'lobby'; room.canStart = true; room.startBlockReason = null; room.game = null
    return room
  }
  if (!room.game) return room
  if (mode === 'queued') {
    room.players.push({
      id: 'p4', name: 'Nouman', cardCount: 0, connected: true, escaped: false, isHost: false, isYou: false,
      ready: true, isBot: false, rematchReady: false, reconnecting: false, reconnectEndsAt: null,
      waitingForNextRound: true, joinedInRound: room.session.roundNumber + 1,
    })
    room.game.activity.unshift({
      id: 'a0', text: 'Nouman joined and will play next round.', tone: 'good', kind: 'connection',
      data: { playerId: 'p4', joinedInRound: room.session.roundNumber + 1 },
    })
    return room
  }
  if (mode === 'many-players') {
    const extraNames = ['Nouman', 'Hira', 'Danish', 'Mehwish', 'Sana']
    extraNames.forEach((name, index) => {
      room.players.push({
        id: `p${index + 4}`, name, cardCount: 4 + (index % 4), connected: true, escaped: false,
        isHost: false, isYou: false, ready: true, isBot: false, rematchReady: true,
        reconnecting: false, reconnectEndsAt: null, waitingForNextRound: false, joinedInRound: 1,
      })
    })
    return room
  }
  if (mode === 'waiting') {
    room.players.forEach((player) => { player.isYou = false })
    room.players.push({
      id: 'p4', name: 'Nouman', cardCount: 0, connected: true, escaped: false, isHost: false, isYou: true,
      ready: false, isBot: false, rematchReady: false, reconnecting: false, reconnectEndsAt: null,
      waitingForNextRound: true, joinedInRound: room.session.roundNumber + 1,
    })
    room.yourPlayerId = 'p4'
    room.game.hand = []
    room.game.legalCardIds = []
    room.game.canTakeRightHand = false
    room.game.takeTargetId = null
    return room
  }
  if (mode === 'resolving') {
    room.game.phase = 'resolving'; room.game.currentTurnId = null; room.game.turnEndsAt = null; room.game.legalCardIds = []; room.game.hand = cards.slice(0, 5); room.game.resolutionEndsAt = Date.now() + 5 * 60_000; room.game.pendingTurnId = 'p2'
    room.game.resolvedTrick = { kind: 'thulla', winnerId: 'p2', lastPlayerId: 'p3', cards: [
      { playerId: 'p1', playerName: 'Hamza', card: { id: 'qa-s8', suit: 'spades', rank: '8' } },
      { playerId: 'p2', playerName: 'Ayesha', card: { id: 'qa-sk', suit: 'spades', rank: 'K' } },
      { playerId: 'p3', playerName: 'Bilal', card: { id: 'qa-h6', suit: 'hearts', rank: '6' } },
    ] }
    return room
  }
  if (mode === 'reconnect') {
    room.game.phase = 'waiting_for_reconnect'; room.game.currentTurnId = null; room.game.turnEndsAt = null; room.game.legalCardIds = []; room.game.reconnectPlayerId = 'p2'; room.game.reconnectEndsAt = Date.now() + 42_000
    room.players[1].connected = false; room.players[1].reconnecting = true; room.players[1].reconnectEndsAt = room.game.reconnectEndsAt
    return room
  }
  if (mode === 'finished') {
    room.status = 'finished'; room.startBlockReason = null; room.game.phase = 'turn'; room.game.currentTurnId = null; room.game.turnEndsAt = null; room.game.legalCardIds = []; room.game.loserId = 'p3'; room.game.hand = []
    return room
  }
  if (mode === 'finished-waiting') {
    room.status = 'finished'; room.canStart = false; room.startBlockReason = 'Waiting for queued friends to get ready.'; room.game.phase = 'turn'; room.game.currentTurnId = null; room.game.turnEndsAt = null; room.game.legalCardIds = []; room.game.loserId = 'p3'; room.game.hand = []
    for (let index = 4; index <= 8; index += 1) {
      room.players.push({
        id: `p${index}`, name: `Friend ${index}`, cardCount: 0, connected: true, escaped: false, isHost: false, isYou: false,
        ready: true, isBot: false, rematchReady: index % 2 === 0, reconnecting: false, reconnectEndsAt: null,
        waitingForNextRound: true, joinedInRound: room.session.roundNumber + 1,
      })
    }
    return room
  }
  return room
}
