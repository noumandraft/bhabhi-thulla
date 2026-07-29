import { CHAT_HISTORY_LIMIT, type ChatHistory, type ChatMessage } from '../shared/game'

export interface PendingChatAttempt {
  clientMessageId: string
  text: string
}

export interface ReconciledChatHistory {
  epochChanged: boolean
  messages: ChatMessage[]
}

export function mergeChatMessages(current: readonly ChatMessage[], incoming: readonly ChatMessage[]): ChatMessage[] {
  const incomingEpoch = incoming.at(-1)?.epoch
  const compatibleCurrent = incomingEpoch === undefined
    ? current
    : current.filter((message) => message.epoch === incomingEpoch)
  const byId = new Map(compatibleCurrent.map((message) => [message.id, message]))
  for (const message of incoming) byId.set(message.id, message)
  return [...byId.values()]
    .sort((left, right) => left.sequence - right.sequence || left.createdAt - right.createdAt)
    .slice(-CHAT_HISTORY_LIMIT)
}

export function reconcileChatHistory(
  current: readonly ChatMessage[],
  currentEpoch: string | null,
  history: ChatHistory,
): ReconciledChatHistory {
  const epochChanged = currentEpoch !== null && currentEpoch !== history.epoch
  return {
    epochChanged,
    messages: mergeChatMessages(epochChanged ? [] : current, history.messages),
  }
}

export function countUnreadChatMessages(
  messages: readonly ChatMessage[],
  lastReadSequence: number,
  myPlayerId: string,
  mutedPlayerIds: readonly string[],
): number {
  const muted = new Set(mutedPlayerIds)
  return messages.filter((message) => (
    message.sequence > lastReadSequence
    && message.playerId !== myPlayerId
    && !muted.has(message.playerId)
  )).length
}

export function chatAttemptFor(
  text: string,
  pending: PendingChatAttempt | null,
  createId: () => string,
): PendingChatAttempt {
  const cleanText = text.trim()
  return pending?.text === cleanText ? pending : { clientMessageId: createId(), text: cleanText }
}
