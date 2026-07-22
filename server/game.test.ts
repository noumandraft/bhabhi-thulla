import { describe, expect, it } from 'vitest'
import { GameManager } from './game.js'

function setupGame(playerCount = 3) {
  const manager = new GameManager()
  const created = manager.createRoom('Host Player', 'socket-0')
  const credentials = [created.credentials]
  for (let index = 1; index < playerCount; index += 1) {
    credentials.push(manager.joinRoom(created.room.code, `Player ${index}`, `socket-${index}`).credentials)
  }
  manager.startGame(created.room.code, created.credentials.playerId)
  return { manager, room: created.room, credentials }
}

describe('Pakistani Bhabhi rules', () => {
  it('deals all 52 cards and forces the Ace of Spades to open', () => {
    const { manager, room } = setupGame(4)
    expect(room.players.reduce((total, player) => total + player.hand.length, 0)).toBe(52)
    const opener = room.players.find((player) => player.id === room.game?.currentTurnId)!
    expect(manager.legalCards(room, opener.id).map((card) => card.id)).toEqual(['spades-A'])
  })

  it('deals cards as evenly as possible', () => {
    const { room } = setupGame(3)
    const counts = room.players.map((player) => player.hand.length)
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1)
  })

  it('moves each turn anticlockwise to the player on the right', () => {
    const { manager, room } = setupGame(4)
    const openerIndex = room.players.findIndex((player) => player.id === room.game?.currentTurnId)
    const opener = room.players[openerIndex]
    const rightPlayer = room.players[(openerIndex - 1 + room.players.length) % room.players.length]
    manager.playCard(room.code, opener.id, 'spades-A')
    expect(room.game?.currentTurnId).toBe(rightPlayer.id)
  })

  it('only allows cards of the led suit when the player can follow', () => {
    const { manager, room } = setupGame(3)
    const game = room.game!
    const current = room.players.find((player) => player.id === game.currentTurnId)!
    game.firstTrick = false
    game.trick = []
    game.leadSuit = null
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

  it('ends a trick on a thulla and makes the highest led suit pick up', () => {
    const { manager, room } = setupGame(3)
    const [leader, cutter, follower] = room.players
    Object.assign(room.game!, { firstTrick: false, trick: [], leadSuit: null, currentTurnId: leader.id })
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
    expect(room.game?.trick).toHaveLength(0)
    expect(leader.hand).toHaveLength(3)
    expect(room.game?.currentTurnId).toBe(leader.id)
  })

  it('forces a clean-trick winner with no hand to draw and lead from waste', () => {
    const { manager, room } = setupGame(3)
    const [leader, lastPlayer, follower] = room.players
    Object.assign(room.game!, {
      firstTrick: false,
      trick: [],
      leadSuit: null,
      currentTurnId: leader.id,
      waste: [{ id: 'clubs-9', suit: 'clubs', rank: '9' }],
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
    expect(leader.escaped).toBe(false)
    expect(room.game?.trick).toEqual([{ playerId: leader.id, card: { id: 'clubs-9', suit: 'clubs', rank: '9' } }])
    expect(room.game?.currentTurnId).toBe(follower.id)
  })

  it('lets the player with power take the next active right-hand player’s cards before leading', () => {
    const { manager, room } = setupGame(4)
    const [leader, , , rightPlayer] = room.players
    Object.assign(room.game!, {
      firstTrick: false,
      trick: [],
      leadSuit: null,
      leaderId: leader.id,
      currentTurnId: leader.id,
      takeUsedForLead: false,
    })
    leader.hand = [{ id: 'diamonds-2', suit: 'diamonds', rank: '2' }]
    rightPlayer.hand = [
      { id: 'spades-K', suit: 'spades', rank: 'K' },
      { id: 'hearts-3', suit: 'hearts', rank: '3' },
    ]

    const viewBefore = manager.view(room, leader.id)
    expect(viewBefore.game?.canTakeRightHand).toBe(true)
    expect(viewBefore.game?.takeTargetId).toBe(rightPlayer.id)

    manager.takeRightHand(room.code, leader.id)

    expect(leader.hand.map((card) => card.id)).toEqual(['spades-K', 'hearts-3', 'diamonds-2'])
    expect(rightPlayer.hand).toHaveLength(0)
    expect(rightPlayer.escaped).toBe(true)
    expect(room.game?.currentTurnId).toBe(leader.id)
    expect(manager.view(room, leader.id).game?.canTakeRightHand).toBe(false)
  })
})
