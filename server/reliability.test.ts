import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TRICK_RESOLUTION_MS, type Card } from '../shared/game.js'
import { GameManager, type Room } from './game.js'

function physicalCards(room: Room): Card[] {
  const game = room.game
  const cards = room.players.flatMap((player) => player.hand)
  if (!game) return cards

  cards.push(...game.waste)
  if (game.phase === 'turn') cards.push(...game.trick.map((entry) => entry.card))
  // A clean completed trick has not entered the waste yet. Opening-trick cards
  // already have, while THULLA cards already belong to the picker-up's hand.
  if (game.phase === 'resolving' && game.resolvedTrick?.kind === 'clean') {
    cards.push(...game.pendingWasteCards)
  }
  return cards
}

function expectEngineInvariants(room: Room): void {
  const cards = physicalCards(room)
  expect(cards, 'all 52 physical cards remain accounted for').toHaveLength(52)
  expect(new Set(cards.map((card) => card.id)).size, 'physical cards never duplicate').toBe(52)

  const game = room.game
  if (!game || room.status !== 'playing') return
  const active = room.players.filter((player) => !player.waitingForNextRound && !player.escaped)

  if (game.phase === 'resolving') {
    expect(game.currentTurnId).toBeNull()
    expect(game.resolvedTrick).not.toBeNull()
    expect(game.resolutionEndsAt).not.toBeNull()
    return
  }

  expect(game.phase).toBe('turn')
  const current = active.find((player) => player.id === game.currentTurnId)
  expect(current, 'the active turn always belongs to an active player').toBeDefined()
  expect(current!.hand.length, 'the active player always has a playable card').toBeGreaterThan(0)
  expect(new Set(game.trick.map((entry) => entry.playerId)).size).toBe(game.trick.length)
  if (game.trick.length) {
    expect(game.leadSuit).toBe(game.trick[0].card.suit)
  } else {
    expect(game.leadSuit).toBeNull()
  }
  expect(game.currentTurnId ? game.currentTurnId : '').not.toBe('')
}

async function playRound(manager: GameManager, room: Room): Promise<number> {
  let actions = 0
  let powerOpportunities = 0

  while (room.status === 'playing') {
    expectEngineInvariants(room)
    const game = room.game!

    if (game.phase === 'resolving') {
      await vi.advanceTimersByTimeAsync(TRICK_RESOLUTION_MS)
      continue
    }

    expect(game.phase).toBe('turn')
    const currentId = game.currentTurnId!
    const currentView = manager.view(room, currentId).game!
    if (currentView.canTakeRightHand) {
      powerOpportunities += 1
      // Exercise ordinary tricks and THULLAs, but guarantee eventual progress
      // even for an unusually cyclical shuffled deal.
      if (powerOpportunities % 7 === 0) {
        manager.takeRightHand(room.code, currentId)
        actions += 1
        continue
      }
    }

    const legal = manager.legalCards(room, currentId)
    expect(legal.length).toBeGreaterThan(0)
    const chosen = legal[actions % legal.length]
    manager.playCard(room.code, currentId, chosen.id)
    actions += 1
    expect(actions, 'a round must terminate without cycling indefinitely').toBeLessThan(2_000)
  }

  expectEngineInvariants(room)
  const remaining = room.players.filter((player) => !player.waitingForNextRound && !player.escaped)
  expect(remaining.map((player) => player.id)).toEqual([room.game!.loserId])
  return actions
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-08-11T12:00:00.000Z'))
})

afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
})

describe('multiplayer engine reliability', () => {
  it('finishes two invariant-safe rounds for every supported table size', async () => {
    for (let playerCount = 3; playerCount <= 8; playerCount += 1) {
      const manager = new GameManager()
      const created = manager.createRoom('Player 1', `socket-${playerCount}-1`)
      const credentials = [created.credentials]
      for (let index = 2; index <= playerCount; index += 1) {
        credentials.push(manager.joinRoom(
          created.room.code,
          `Player ${index}`,
          `socket-${playerCount}-${index}`,
        ).credentials)
      }

      for (const credential of credentials) manager.setReady(created.room.code, credential.playerId, true)
      manager.startGame(created.room.code, created.credentials.playerId)
      expect(await playRound(manager, created.room)).toBeGreaterThan(0)

      for (const credential of credentials) {
        manager.setRematchReady(created.room.code, credential.playerId, true)
      }
      expect(manager.view(created.room, created.credentials.playerId).canStart).toBe(true)
      manager.startGame(created.room.code, created.credentials.playerId)
      expect(await playRound(manager, created.room)).toBeGreaterThan(0)

      expect(created.room.session.roundNumber).toBe(2)
      expect(created.room.session.scores).toHaveLength(playerCount)
      expect(created.room.session.scores.every((score) => score.roundsPlayed === 2)).toBe(true)
      expect(created.room.session.scores.reduce((total, score) => total + score.bhabhiCount, 0)).toBe(2)
      await manager.close()
    }
  }, 20_000)
})
