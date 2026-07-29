import { describe, expect, it } from 'vitest'
import { CHAT_HISTORY_LIMIT, type ChatMessage } from '../shared/game'
import { chatAttemptFor, countUnreadChatMessages, mergeChatMessages, reconcileChatHistory } from './chatModel'

function message(sequence: number, playerId = 'friend'): ChatMessage {
  return {
    id: `message-${sequence}`,
    clientMessageId: `client-${sequence}`,
    epoch: 'epoch-one',
    sequence,
    playerId,
    playerName: playerId,
    text: `Message ${sequence}`,
    createdAt: sequence,
  }
}

describe('Table Talk client model', () => {
  it('merges live messages with later history in sequence order and deduplicates acknowledgements', () => {
    const live = message(3)
    const merged = mergeChatMessages([live], [message(1), message(2), { ...live }])
    expect(merged.map((entry) => entry.sequence)).toEqual([1, 2, 3])
    expect(merged.filter((entry) => entry.id === live.id)).toHaveLength(1)
  })

  it('keeps only the newest bounded history', () => {
    const messages = Array.from({ length: CHAT_HISTORY_LIMIT + 7 }, (_, index) => message(index + 1))
    const merged = mergeChatMessages([], messages)
    expect(merged).toHaveLength(CHAT_HISTORY_LIMIT)
    expect(merged[0].sequence).toBe(8)
    expect(merged.at(-1)?.sequence).toBe(CHAT_HISTORY_LIMIT + 7)
  })

  it('drops stale cached messages when the server chat epoch changes', () => {
    const cached = [message(8), message(9)]
    const restarted = [{ ...message(1), id: 'new-message-1', epoch: 'epoch-two' }]
    const result = reconcileChatHistory(cached, 'epoch-one', { epoch: 'epoch-two', messages: restarted })
    expect(result.epochChanged).toBe(true)
    expect(result.messages).toEqual(restarted)
  })

  it('excludes own and locally muted messages from unread counts', () => {
    const messages = [message(2, 'me'), message(3, 'muted'), message(4, 'friend'), message(5, 'friend')]
    expect(countUnreadChatMessages(messages, 2, 'me', ['muted'])).toBe(2)
    expect(countUnreadChatMessages(messages, 5, 'me', ['muted'])).toBe(0)
  })

  it('reuses a client message id for an unchanged retry and replaces it after an edit', () => {
    let nextId = 0
    const createId = () => `id-${++nextId}`
    const first = chatAttemptFor('  hello  ', null, createId)
    const retry = chatAttemptFor('hello', first, createId)
    const edited = chatAttemptFor('hello again', retry, createId)
    expect(retry).toBe(first)
    expect(edited).toEqual({ clientMessageId: 'id-2', text: 'hello again' })
  })
})
