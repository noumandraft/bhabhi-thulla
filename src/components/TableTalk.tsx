import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
  type SVGProps,
} from 'react'
import { CHAT_MAX_CODE_POINTS, type ChatMessage } from '../../shared/game'

export const TABLE_TALK_MESSAGE_LIMIT = CHAT_MAX_CODE_POINTS
export const TABLE_TALK_LINE_LIMIT = 3

// HTML maxLength counts UTF-16 code units. A Unicode code point needs at most
// two, while limitDraft enforces the actual server-compatible code-point cap.
const TABLE_TALK_UTF16_INPUT_LIMIT = TABLE_TALK_MESSAGE_LIMIT * 2

export type TableTalkTab = 'quick' | 'chat'

export type TableTalkMessage = Pick<ChatMessage, 'id' | 'sequence' | 'playerId' | 'playerName' | 'text' | 'createdAt'>

export interface TableTalkParticipant {
  id: string
  name: string
  canMute?: boolean
}

export interface TableTalkQuickReaction {
  id: string
  label: string
  disabled?: boolean
}

export interface TableTalkLabels {
  title: string
  open: string
  openWithUnread: (count: number) => string
  close: string
  quickTab: string
  chatTab: string
  quickHint: string
  noMessages: string
  messageList: string
  newMessages: string
  yourTurn: string
  returnToCards: string
  messageLabel: string
  messagePlaceholder: string
  send: string
  sending: string
  sendFailed: string
  charactersRemaining: (count: number) => string
  privacyHint: string
  playerControls: string
  mute: string
  unmute: string
  mutePlayer: (name: string) => string
  unmutePlayer: (name: string) => string
  mutedCount: (count: number) => string
}

export interface TableTalkProps {
  open: boolean
  unreadCount: number
  messages: readonly TableTalkMessage[]
  participants: readonly TableTalkParticipant[]
  myPlayerId: string
  quickReactions: readonly TableTalkQuickReaction[]
  mutedPlayerIds: readonly string[]
  isMyTurn: boolean
  quickEnabled?: boolean
  chatEnabled?: boolean
  onOpen: () => void
  onClose: () => void
  onReturnToCards: () => void
  onSendMessage: (message: string) => void | Promise<void>
  onSendQuickReaction: (reactionId: string) => void | Promise<void>
  onTogglePlayerMute: (playerId: string, muted: boolean) => void
  onMessagesRead?: (latestSequence: number) => void
  draft?: string
  defaultDraft?: string
  onDraftChange?: (draft: string) => void
  sending?: boolean
  sendError?: string | null
  onClearSendError?: () => void
  disabled?: boolean
  sendDisabled?: boolean
  initialTab?: TableTalkTab
  labels?: Partial<TableTalkLabels>
  formatTime?: (createdAt: number) => string
  className?: string
}

const DEFAULT_LABELS: TableTalkLabels = {
  title: 'Table talk',
  open: 'Open table talk',
  openWithUnread: (count) => `Open table talk, ${count} unread ${count === 1 ? 'message' : 'messages'}`,
  close: 'Close table talk',
  quickTab: 'Quick reactions',
  chatTab: 'Text chat',
  quickHint: 'Send a quick table reaction.',
  noMessages: 'No messages yet. Start the table talk.',
  messageList: 'Table talk messages',
  newMessages: 'New messages',
  yourTurn: 'It is your turn',
  returnToCards: 'Return to cards',
  messageLabel: 'Message everyone at this table',
  messagePlaceholder: 'Type a message…',
  send: 'Send message',
  sending: 'Sending…',
  sendFailed: 'Message could not be sent. Please try again.',
  charactersRemaining: (count) => `${count} characters remaining`,
  privacyHint: 'Everyone seated at this table can read these messages.',
  playerControls: 'Player chat controls',
  mute: 'Mute',
  unmute: 'Unmute',
  mutePlayer: (name) => `Mute ${name}`,
  unmutePlayer: (name) => `Unmute ${name}`,
  mutedCount: (count) => `${count} muted`,
}

const TOUCH_TARGET: CSSProperties = { minWidth: 44, minHeight: 44 }
const NEAR_BOTTOM_PX = 72

type IconProps = SVGProps<SVGSVGElement> & { size?: number }

function Icon({ size = 20, children, ...props }: IconProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={props['aria-label'] ? undefined : true}
      {...props}
    >
      {children}
    </svg>
  )
}

const MessageIcon = (props: IconProps) => <Icon {...props}><path d="M21 15a4 4 0 0 1-4 4H8l-5 3 1.7-5A7 7 0 0 1 3 12V8a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z" /></Icon>
const SendIcon = (props: IconProps) => <Icon {...props}><path d="m22 2-7 20-4-9-9-4Z" /><path d="M22 2 11 13" /></Icon>
const VolumeIcon = (props: IconProps) => <Icon {...props}><path d="M11 5 6 9H2v6h4l5 4z" /><path d="M15 9a4 4 0 0 1 0 6" /><path d="M18 6a8 8 0 0 1 0 12" /></Icon>
const VolumeOffIcon = (props: IconProps) => <Icon {...props}><path d="M11 5 6 9H2v6h4l5 4z" /><path d="m22 9-6 6" /><path d="m16 9 6 6" /></Icon>
const XIcon = (props: IconProps) => <Icon {...props}><path d="M18 6 6 18M6 6l12 12" /></Icon>
const CardsIcon = (props: IconProps) => <Icon {...props}><rect x="4" y="4" width="11" height="15" rx="2" /><path d="m9 8 2 2 2-2M15 8l3-1a2 2 0 0 1 2.5 1.4l1.4 5.3a2 2 0 0 1-1.4 2.5L15 17.7" /></Icon>

function defaultFormatTime(createdAt: number): string {
  const date = new Date(createdAt)
  if (!Number.isFinite(date.getTime())) return ''
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(date)
}

function dateTimeValue(createdAt: number): string | undefined {
  const date = new Date(createdAt)
  return Number.isFinite(date.getTime()) ? date.toISOString() : undefined
}

function codePointLength(value: string): number {
  return Array.from(value).length
}

function limitDraft(value: string): string {
  const normalizedLines = value.replace(/\r\n?/g, '\n').split('\n').slice(0, TABLE_TALK_LINE_LIMIT).join('\n')
  return Array.from(normalizedLines).slice(0, TABLE_TALK_MESSAGE_LIMIT).join('')
}

export function TableTalk({
  open,
  unreadCount,
  messages,
  participants,
  myPlayerId,
  quickReactions,
  mutedPlayerIds,
  isMyTurn,
  quickEnabled = true,
  chatEnabled = true,
  onOpen,
  onClose,
  onReturnToCards,
  onSendMessage,
  onSendQuickReaction,
  onTogglePlayerMute,
  onMessagesRead,
  draft: controlledDraft,
  defaultDraft = '',
  onDraftChange,
  sending = false,
  sendError = null,
  onClearSendError,
  disabled = false,
  sendDisabled = false,
  initialTab = 'quick',
  labels: labelOverrides,
  formatTime = defaultFormatTime,
  className = '',
}: TableTalkProps) {
  const labels = useMemo(() => ({ ...DEFAULT_LABELS, ...labelOverrides }), [labelOverrides])
  const [activeTabState, setActiveTab] = useState<TableTalkTab>(initialTab)
  const activeTab: TableTalkTab = activeTabState === 'quick' && quickEnabled
    ? 'quick'
    : activeTabState === 'chat' && chatEnabled
      ? 'chat'
      : quickEnabled
        ? 'quick'
        : 'chat'
  const [uncontrolledDraft, setUncontrolledDraft] = useState(limitDraft(defaultDraft))
  const [internalSending, setInternalSending] = useState(false)
  const [internalError, setInternalError] = useState<string | null>(null)
  const [sendingReactionId, setSendingReactionId] = useState<string | null>(null)
  const [hasNewMessages, setHasNewMessages] = useState(false)
  const draft = limitDraft(controlledDraft === undefined ? uncontrolledDraft : controlledDraft)
  const isSending = sending || internalSending
  const error = sendError || internalError

  const baseId = useId()
  const drawerId = `${baseId}-drawer`
  const titleId = `${baseId}-title`
  const quickTabId = `${baseId}-quick-tab`
  const quickPanelId = `${baseId}-quick-panel`
  const chatTabId = `${baseId}-chat-tab`
  const chatPanelId = `${baseId}-chat-panel`
  const inputId = `${baseId}-input`
  const countId = `${baseId}-count`
  const errorId = `${baseId}-error`

  const triggerRef = useRef<HTMLButtonElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const quickTabRef = useRef<HTMLButtonElement>(null)
  const chatTabRef = useRef<HTMLButtonElement>(null)
  const messageListRef = useRef<HTMLOListElement>(null)
  const wasOpenRef = useRef(false)
  const visitedChatRef = useRef(false)
  const nearBottomRef = useRef(true)
  const previousLastMessageIdRef = useRef<string | null>(null)

  const mutedSet = useMemo(() => new Set(mutedPlayerIds), [mutedPlayerIds])
  const visibleMessages = useMemo(
    () => messages.filter((message) => !mutedSet.has(message.playerId)),
    [messages, mutedSet],
  )
  const mutableParticipants = useMemo(
    () => participants.filter((participant) => participant.id !== myPlayerId && participant.canMute !== false),
    [myPlayerId, participants],
  )
  const mutedCount = mutableParticipants.reduce((count, participant) => count + Number(mutedSet.has(participant.id)), 0)
  const lastVisibleMessageId = visibleMessages.at(-1)?.id ?? null
  const latestSequence = messages.reduce((latest, message) => Math.max(latest, message.sequence), 0)
  const markMessagesRead = useCallback(() => onMessagesRead?.(latestSequence), [latestSequence, onMessagesRead])

  useEffect(() => {
    if ((!quickEnabled && !chatEnabled) || activeTabState === activeTab) return
    setActiveTab(activeTab)
  }, [activeTab, activeTabState, chatEnabled, quickEnabled])

  const setDraft = useCallback((nextDraft: string) => {
    const limitedDraft = limitDraft(nextDraft)
    if (controlledDraft === undefined) setUncontrolledDraft(limitedDraft)
    onDraftChange?.(limitedDraft)
    setInternalError(null)
    onClearSendError?.()
  }, [controlledDraft, onClearSendError, onDraftChange])

  const scrollToNewest = useCallback((behavior: ScrollBehavior = 'smooth') => {
    const list = messageListRef.current
    if (!list) return
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
    list.scrollTo({ top: list.scrollHeight, behavior: reduceMotion ? 'auto' : behavior })
    nearBottomRef.current = true
    setHasNewMessages(false)
    markMessagesRead()
  }, [markMessagesRead])

  useEffect(() => {
    if (open && !wasOpenRef.current) {
      window.requestAnimationFrame(() => closeRef.current?.focus())
    }
    if (!open) visitedChatRef.current = false
    wasOpenRef.current = open
  }, [open])

  useEffect(() => {
    if (!open || activeTab !== 'chat' || visitedChatRef.current) return
    visitedChatRef.current = true
    previousLastMessageIdRef.current = lastVisibleMessageId
    window.requestAnimationFrame(() => scrollToNewest('auto'))
  }, [activeTab, lastVisibleMessageId, open, scrollToNewest])

  useEffect(() => {
    if (!open || activeTab !== 'chat' || !visitedChatRef.current) return
    if (previousLastMessageIdRef.current === lastVisibleMessageId) return
    previousLastMessageIdRef.current = lastVisibleMessageId
    if (nearBottomRef.current) {
      window.requestAnimationFrame(() => scrollToNewest())
    } else {
      setHasNewMessages(true)
    }
  }, [activeTab, lastVisibleMessageId, open, scrollToNewest])

  function closeDrawer(restoreTriggerFocus = true) {
    onClose()
    if (restoreTriggerFocus) window.requestAnimationFrame(() => triggerRef.current?.focus())
  }

  function returnToCards() {
    onClose()
    onReturnToCards()
  }

  function handleDrawerKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key !== 'Escape') return
    event.preventDefault()
    closeDrawer()
  }

  function selectTab(tab: TableTalkTab, focus = false) {
    if ((tab === 'quick' && !quickEnabled) || (tab === 'chat' && !chatEnabled)) return
    setActiveTab(tab)
    if (focus) window.requestAnimationFrame(() => (tab === 'quick' ? quickTabRef : chatTabRef).current?.focus())
  }

  function handleTabKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    const availableTabs: TableTalkTab[] = [
      ...(quickEnabled ? ['quick' as const] : []),
      ...(chatEnabled ? ['chat' as const] : []),
    ]
    const currentIndex = Math.max(0, availableTabs.indexOf(activeTab))
    let nextIndex = currentIndex
    if (event.key === 'Home') nextIndex = 0
    else if (event.key === 'End') nextIndex = availableTabs.length - 1
    else if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % availableTabs.length
    else nextIndex = (currentIndex - 1 + availableTabs.length) % availableTabs.length
    selectTab(availableTabs[nextIndex], true)
  }

  function handleMessageScroll() {
    const list = messageListRef.current
    if (!list) return
    nearBottomRef.current = list.scrollHeight - list.scrollTop - list.clientHeight <= NEAR_BOTTOM_PX
    if (nearBottomRef.current) {
      setHasNewMessages(false)
      markMessagesRead()
    }
  }

  async function submitMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const message = draft.trim()
    if (!message || isSending || disabled || sendDisabled) return
    setInternalError(null)
    setInternalSending(true)
    try {
      await onSendMessage(message)
      setDraft('')
    } catch {
      setInternalError(labels.sendFailed)
    } finally {
      setInternalSending(false)
    }
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return
    event.preventDefault()
    event.currentTarget.form?.requestSubmit()
  }

  async function sendQuickReaction(reactionId: string) {
    if (disabled || sendDisabled || sendingReactionId) return
    setInternalError(null)
    setSendingReactionId(reactionId)
    try {
      await onSendQuickReaction(reactionId)
    } catch {
      setInternalError(labels.sendFailed)
    } finally {
      setSendingReactionId(null)
    }
  }

  const effectiveUnreadCount = chatEnabled ? unreadCount : 0
  const openLabel = effectiveUnreadCount > 0 ? labels.openWithUnread(effectiveUnreadCount) : labels.open
  const remainingCharacters = TABLE_TALK_MESSAGE_LIMIT - codePointLength(draft)
  const describedBy = error ? `${countId} ${errorId}` : countId

  if (!quickEnabled && !chatEnabled) return null

  return (
    <div className={`table-talk ${className}`.trim()} data-open={open || undefined} data-layout="adaptive">
      <button
        ref={triggerRef}
        className="table-talk__trigger game-v2-reaction-toggle"
        type="button"
        style={TOUCH_TARGET}
        aria-label={openLabel}
        aria-expanded={open}
        aria-controls={drawerId}
        disabled={disabled}
        onClick={() => open ? closeDrawer() : onOpen()}
      >
        <MessageIcon size={18} />
        <span className="table-talk__trigger-label">{labels.title}</span>
        {effectiveUnreadCount > 0 ? (
          <span className="table-talk__unread" aria-hidden="true">{effectiveUnreadCount > 99 ? '99+' : effectiveUnreadCount}</span>
        ) : null}
      </button>

      <aside
        id={drawerId}
        className="table-talk__drawer"
        role="dialog"
        aria-modal="false"
        aria-labelledby={titleId}
        hidden={!open}
        onKeyDown={handleDrawerKeyDown}
      >
        <header className="table-talk__header">
          <div>
            <span className="game-v2-eyebrow">Bhabhi Thulla</span>
            <h2 id={titleId}>{labels.title}</h2>
          </div>
          <button
            ref={closeRef}
            className="table-talk__icon-button game-v2-icon-button"
            type="button"
            style={TOUCH_TARGET}
            aria-label={labels.close}
            title={labels.close}
            onClick={() => closeDrawer()}
          >
            <XIcon />
          </button>
        </header>

        {isMyTurn ? (
          <div className="table-talk__turn-callout" role="status" aria-live="assertive">
            <span>{labels.yourTurn}</span>
            <button type="button" style={TOUCH_TARGET} onClick={returnToCards}>
              <CardsIcon size={18} />
              {labels.returnToCards}
            </button>
          </div>
        ) : null}

        <div className="table-talk__tabs" role="tablist" aria-label={labels.title}>
          {quickEnabled ? <button
            ref={quickTabRef}
            id={quickTabId}
            type="button"
            role="tab"
            style={TOUCH_TARGET}
            aria-selected={activeTab === 'quick'}
            aria-controls={quickPanelId}
            tabIndex={activeTab === 'quick' ? 0 : -1}
            onClick={() => selectTab('quick')}
            onKeyDown={handleTabKeyDown}
          >
            {labels.quickTab}
          </button> : null}
          {chatEnabled ? <button
            ref={chatTabRef}
            id={chatTabId}
            type="button"
            role="tab"
            style={TOUCH_TARGET}
            aria-selected={activeTab === 'chat'}
            aria-controls={chatPanelId}
            tabIndex={activeTab === 'chat' ? 0 : -1}
            onClick={() => selectTab('chat')}
            onKeyDown={handleTabKeyDown}
          >
            {labels.chatTab}
            {effectiveUnreadCount > 0 ? <span className="table-talk__tab-badge" aria-hidden="true">{effectiveUnreadCount > 99 ? '99+' : effectiveUnreadCount}</span> : null}
          </button> : null}
        </div>

        {quickEnabled ? <section
          id={quickPanelId}
          className="table-talk__panel table-talk__panel--quick"
          role="tabpanel"
          aria-labelledby={quickTabId}
          hidden={activeTab !== 'quick'}
        >
          <p>{labels.quickHint}</p>
          <div className="table-talk__quick-grid" role="group" aria-label={labels.quickTab}>
            {quickReactions.map((reaction) => (
              <button
                key={reaction.id}
                type="button"
                style={TOUCH_TARGET}
                disabled={disabled || sendDisabled || reaction.disabled || sendingReactionId !== null}
                aria-busy={sendingReactionId === reaction.id || undefined}
                onClick={() => void sendQuickReaction(reaction.id)}
              >
                {reaction.label}
              </button>
            ))}
          </div>
          {error ? <p className="table-talk__error" role="alert">{error}</p> : null}
        </section> : null}

        {chatEnabled ? <section
          id={chatPanelId}
          className="table-talk__panel table-talk__panel--chat"
          role="tabpanel"
          aria-labelledby={chatTabId}
          hidden={activeTab !== 'chat'}
        >
          <div className="table-talk__message-region">
            <ol
              ref={messageListRef}
              className="table-talk__messages"
              role="log"
              aria-label={labels.messageList}
              aria-live="polite"
              aria-relevant="additions text"
              onScroll={handleMessageScroll}
            >
              {visibleMessages.length === 0 ? <li className="table-talk__empty">{labels.noMessages}</li> : null}
              {visibleMessages.map((message) => {
                const isOwn = message.playerId === myPlayerId
                return (
                  <li key={message.id} className="table-talk__message" data-own={isOwn || undefined}>
                    <article>
                      <header>
                        <bdi dir="auto">{message.playerName}</bdi>
                        <time dateTime={dateTimeValue(message.createdAt)}>{formatTime(message.createdAt)}</time>
                      </header>
                      <p dir="auto"><bdi>{message.text}</bdi></p>
                    </article>
                  </li>
                )
              })}
            </ol>
            {hasNewMessages ? (
              <button className="table-talk__new-messages" type="button" style={TOUCH_TARGET} onClick={() => scrollToNewest()}>
                {labels.newMessages}
              </button>
            ) : null}
          </div>

          {mutableParticipants.length > 0 ? (
            <details className="table-talk__player-controls">
              <summary style={TOUCH_TARGET}>
                <VolumeOffIcon size={18} />
                <span>{labels.playerControls}</span>
                {mutedCount > 0 ? <span>{labels.mutedCount(mutedCount)}</span> : null}
              </summary>
              <ul>
                {mutableParticipants.map((participant) => {
                  const muted = mutedSet.has(participant.id)
                  const actionLabel = muted ? labels.unmutePlayer(participant.name) : labels.mutePlayer(participant.name)
                  return (
                    <li key={participant.id}>
                      <bdi dir="auto">{participant.name}</bdi>
                      <button
                        type="button"
                        style={TOUCH_TARGET}
                        aria-label={actionLabel}
                        aria-pressed={muted}
                        onClick={() => onTogglePlayerMute(participant.id, !muted)}
                      >
                        {muted ? <VolumeIcon size={18} /> : <VolumeOffIcon size={18} />}
                        {muted ? labels.unmute : labels.mute}
                      </button>
                    </li>
                  )
                })}
              </ul>
            </details>
          ) : null}

          <form className="table-talk__composer" aria-busy={isSending || undefined} onSubmit={(event) => void submitMessage(event)}>
            <label htmlFor={inputId}>{labels.messageLabel}</label>
            <div className="table-talk__composer-row">
              <textarea
                id={inputId}
                value={draft}
                rows={3}
                maxLength={TABLE_TALK_UTF16_INPUT_LIMIT}
                dir="auto"
                enterKeyHint="send"
                autoComplete="off"
                spellCheck="true"
                placeholder={labels.messagePlaceholder}
                aria-describedby={describedBy}
                style={{ minHeight: 44 }}
                disabled={disabled || sendDisabled || isSending}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={handleComposerKeyDown}
              />
              <button
                className="table-talk__send game-v2-button game-v2-button--primary"
                type="submit"
                style={TOUCH_TARGET}
                disabled={disabled || sendDisabled || isSending || draft.trim().length === 0}
                aria-label={isSending ? labels.sending : labels.send}
              >
                <SendIcon size={19} />
                <span>{isSending ? labels.sending : labels.send}</span>
              </button>
            </div>
            <div className="table-talk__composer-meta">
              <small id={countId}>{labels.charactersRemaining(remainingCharacters)}</small>
              <small>{labels.privacyHint}</small>
            </div>
            {error ? <p id={errorId} className="table-talk__error" role="alert">{error}</p> : null}
          </form>
        </section> : null}
      </aside>
    </div>
  )
}
