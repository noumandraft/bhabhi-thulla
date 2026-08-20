import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode, type SVGProps } from 'react'
import type { Socket } from 'socket.io-client'
import { sortCards, suitSymbol, type ActivityItem, type ChatMode, type Reaction, type Suit } from '../../shared/game'
import type { Language, TFunction } from '../i18n'
import type { Preferences } from '../preferences'
import type { ClientPlayerView as Player, ClientRoomView, TableReaction } from '../protocol'
import { emitWithAck } from '../socket'
import { AccessibleDialog } from './AccessibleDialog'
import { GameCard as PlayingCard, localizedSuit } from './game/GameCard'

type IconProps = SVGProps<SVGSVGElement> & { size?: number }

function Icon({ size = 24, children, ...props }: IconProps & { children: ReactNode }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden={props['aria-label'] ? undefined : true} {...props}>{children}</svg>
}
const BookOpen = (props: IconProps) => <Icon {...props}><path d="M2 4h6a4 4 0 0 1 4 4v12a4 4 0 0 0-4-4H2z"/><path d="M22 4h-6a4 4 0 0 0-4 4v12a4 4 0 0 1 4-4h6z"/></Icon>
const Check = (props: IconProps) => <Icon {...props}><path d="m5 12 4 4L19 6"/></Icon>
const Clock3 = (props: IconProps) => <Icon {...props}><circle cx="12" cy="12" r="9"/><path d="M12 7v5h4"/></Icon>
const Copy = (props: IconProps) => <Icon {...props}><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 1-2-2H6a2 2 0 0 1-2 2v8a2 2 0 0 1 2 2h2"/></Icon>
const Crown = (props: IconProps) => <Icon {...props}><path d="m3 6 4 5 5-7 5 7 4-5-2 12H5z"/><path d="M5 21h14"/></Icon>
const HandCards = (props: IconProps) => <Icon {...props}><rect x="4" y="4" width="11" height="15" rx="2"/><path d="m9 8 2 2 2-2M15 8l3-1a2 2 0 0 1 2.5 1.4l1.4 5.3a2 2 0 0 1-1.4 2.5L15 17.7"/></Icon>
const Help = (props: IconProps) => <Icon {...props}><circle cx="12" cy="12" r="9"/><path d="M9.8 9a2.4 2.4 0 1 1 3.8 2c-.9.6-1.6 1.1-1.6 2.5M12 17h.01"/></Icon>
const History = (props: IconProps) => <Icon {...props}><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/></Icon>
const LogOut = (props: IconProps) => <Icon {...props}><path d="M10 17l5-5-5-5"/><path d="M15 12H3"/><path d="M15 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4"/></Icon>
const Message = (props: IconProps) => <Icon {...props}><path d="M21 15a4 4 0 0 1-4 4H8l-5 3 1.7-5A7 7 0 0 1 3 12V8a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z"/></Icon>
const Monitor = (props: IconProps) => <Icon {...props}><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></Icon>
const MoreHorizontal = (props: IconProps) => <Icon {...props}><circle cx="5" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1" fill="currentColor" stroke="none"/></Icon>
const Play = (props: IconProps) => <Icon {...props}><path d="m7 4 13 8L7 20z"/></Icon>
const RotateCcw = (props: IconProps) => <Icon {...props}><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></Icon>
const Share2 = (props: IconProps) => <Icon {...props}><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 10.5 6.8-4M8.6 13.5l6.8 4"/></Icon>
const Settings = (props: IconProps) => <Icon {...props}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6 1.7 1.7 0 0 0 10 3v-.2h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1z"/></Icon>
const Trophy = (props: IconProps) => <Icon {...props}><path d="M8 4h8v5a4 4 0 0 1-8 0zM8 6H4v2a4 4 0 0 0 4 4M16 6h4v2a4 4 0 0 1-4 4M12 13v5M8 21h8M9 18h6"/></Icon>
const Volume = (props: IconProps) => <Icon {...props}><path d="M11 5 6 9H2v6h4l5 4zM15 9a4 4 0 0 1 0 6M18 6a8 8 0 0 1 0 12"/></Icon>
const Wifi = (props: IconProps) => <Icon {...props}><path d="M5 12.6a10 10 0 0 1 14 0M2 9.3a15 15 0 0 1 20 0M8.5 16a5 5 0 0 1 7 0"/><circle cx="12" cy="20" r="1" fill="currentColor" stroke="none"/></Icon>
const WifiOff = (props: IconProps) => <Icon {...props}><path d="m2 2 20 20M8.5 16a5 5 0 0 1 5.7-.9M5 12.6a10 10 0 0 1 4-2M2 9.3A15 15 0 0 1 6 7M14 7a15 15 0 0 1 8 2.3"/><circle cx="12" cy="20" r="1" fill="currentColor" stroke="none"/></Icon>
const X = (props: IconProps) => <Icon {...props}><path d="M18 6 6 18M6 6l12 12"/></Icon>

function IconButton({ label, onClick, children, className = '', disabled = false }: { label: string; onClick: () => void; children: ReactNode; className?: string; disabled?: boolean }) {
  return <button className={`game-v2-icon-button ${className}`.trim()} type="button" aria-label={label} title={label} disabled={disabled} onClick={onClick}>{children}</button>
}

function isShareCancelled(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

function GameLogo() {
  return <div className="game-v2-logo" aria-label="Bhabhi Thulla"><span className="game-v2-logo__cards" aria-hidden="true"><i>♠</i><i>♥</i></span><span><b>Bhabhi</b><strong>THULLA</strong></span></div>
}

function useCountdown(endsAt: number | null, active: boolean, expectedDuration: number, interval = 200) {
  const localEndsAt = useMemo(() => {
    if (!active || endsAt === null) return null
    const serverDelta = endsAt - Date.now()
    const tolerance = Math.max(1_000, expectedDuration * .15)
    const observedDuration = serverDelta <= 0
      ? 0
      : serverDelta <= expectedDuration + tolerance
        ? Math.min(serverDelta, expectedDuration)
        : expectedDuration
    return performance.now() + observedDuration
  }, [active, endsAt, expectedDuration])
  const [, refresh] = useState(0)
  useEffect(() => {
    if (localEndsAt === null) return
    refresh((value) => value + 1)
    const timer = window.setInterval(() => refresh((value) => value + 1), interval)
    return () => window.clearInterval(timer)
  }, [interval, localEndsAt])
  const milliseconds = localEndsAt === null ? 0 : Math.max(0, localEndsAt - performance.now())
  return { milliseconds, seconds: Math.max(0, Math.ceil(milliseconds / 1000)) }
}

function TurnClock({ endsAt, duration, t, alertForYou = false, sound = false, haptics = false }: { endsAt: number; duration: number; t: TFunction; alertForYou?: boolean; sound?: boolean; haptics?: boolean }) {
  const { seconds } = useCountdown(endsAt, true, duration, 250)
  const [announcement, setAnnouncement] = useState('')
  const announced = useRef(new Set<number>())
  useEffect(() => { announced.current.clear(); setAnnouncement('') }, [endsAt])
  useEffect(() => {
    if (![10, 5, 0].includes(seconds) || announced.current.has(seconds)) return
    announced.current.add(seconds); setAnnouncement(seconds === 0 ? t('timeExpired') : t('secondsRemaining', { count: seconds }))
    if (seconds === 10 && alertForYou) {
      if (sound) playAttentionTone(440)
      if (haptics && navigator.vibrate) navigator.vibrate(55)
    }
  }, [seconds, alertForYou, sound, haptics, t])
  const timerLabel = seconds === 0 ? t('timeExpired') : t('secondsRemaining', { count: seconds })
  return <><span className={`game-v2-clock ${seconds <= 8 ? 'is-low' : ''}`} role="timer" aria-live="off" aria-label={timerLabel}><Clock3 size={16}/> <span aria-hidden="true">{seconds}s</span></span><span className="sr-only" aria-live="polite" aria-atomic="true">{announcement}</span></>
}

function orderedOpponents(players: Player[], playerId: string): Player[] {
  const start = players.findIndex((player) => player.id === playerId)
  if (start < 0) return players.filter((player) => player.id !== playerId)
  const ordered: Player[] = []
  for (let offset = 1; offset < players.length; offset += 1) ordered.push(players[(start - offset + players.length) % players.length])
  return ordered
}

function seatPlacement(index: number, total: number): { className: string; style?: CSSProperties } {
  if (total === 1) return { className: 'is-top', style: { left: '50%' } }
  if (total === 2) return { className: index === 0 ? 'is-right' : 'is-left' }
  if (index === 0) return { className: 'is-right' }
  if (index === total - 1) return { className: 'is-left' }
  const middleCount = total - 2; const middleIndex = index - 1
  return { className: 'is-top', style: { left: `${middleCount === 1 ? 50 : 28 + (middleIndex / (middleCount - 1)) * 44}%` } }
}

function OpponentSeat({ player, isTurn, isRight, placement, t }: { player: Player; isTurn: boolean; isRight: boolean; placement: ReturnType<typeof seatPlacement>; t: TFunction }) {
  const initials = player.name.split(' ').map((part) => part[0]).join('').slice(0, 2).toUpperCase()
  const status = player.escaped ? t('safe') : player.reconnecting || !player.connected ? t('reconnecting') : t(player.cardCount === 1 ? 'card' : 'cards', { count: player.cardCount })
  return <article id={`game-v2-opponent-${player.id}`} data-opponent-seat data-player-id={player.id} className={`game-v2-seat ${placement.className} ${isTurn ? 'is-turn' : ''} ${isRight ? 'is-right-player' : ''} ${player.escaped ? 'is-escaped' : ''} ${!player.connected ? 'is-offline' : ''}`} style={placement.style} aria-label={`${player.name}, ${status}${isRight ? `, ${t('nextRightSuffix')}` : ''}${isTurn ? `, ${t('currentTurnSuffix')}` : ''}`}>
    <div className="game-v2-seat__avatar" aria-hidden="true">{player.escaped ? <Check size={20} strokeWidth={3}/> : player.isBot ? 'AI' : initials}</div><div className="game-v2-seat__cards" aria-hidden="true"><i/><i/><i/></div><div className="game-v2-seat__copy"><b><bdi dir="auto">{player.name}</bdi></b><span>{status}</span></div>{player.isHost ? <Crown className="game-v2-seat__host" size={15} aria-label={t('host')}/> : null}{isTurn ? <span className="game-v2-seat__turn">{t('turnLabel')}</span> : null}{isRight && !player.escaped ? <span className="game-v2-seat__right">{t('rightNext')}</span> : null}
  </article>
}

function activityText(item: ActivityItem, players: Player[], t: TFunction): string {
  const name = (key: string) => players.find((player) => player.id === item.data?.[key])?.name ?? t('player')
  if (item.kind === 'thulla') return t('activityThulla', { thulla: name('thullaPlayerId'), winner: name('winnerId'), count: Number(item.data?.cardCount ?? 0) })
  if (item.kind === 'take') return t('activityTake', { player: name('playerId'), target: name('targetId'), count: Number(item.data?.cardCount ?? 0) })
  if (item.kind === 'escape') return t('activityEscape', { player: name('playerId') })
  if (item.kind === 'round') return t('activityRound', { player: name('loserId') })
  if (item.kind === 'connection') {
    if (typeof item.data?.joinedInRound === 'number') return t('queuedFriendNotice', { name: name('playerId') })
    if (/waiting/i.test(item.text)) return t('activityReconnectWait', { player: name('playerId') })
    if (/did not/i.test(item.text)) return t('activityReconnectExpired', { player: name('playerId') })
    return t('activityReconnected', { player: name('playerId') })
  }
  if (item.kind === 'power') {
    if (/opening/i.test(item.text)) return t('activityOpening')
    if (/waste/i.test(item.text)) return t('activityPowerWaste', { player: name('winnerId') })
    return t('activityPower', { player: name('winnerId') })
  }
  return item.text
}

function MatchActivity({ items, players, open, onToggle, t }: { items: ActivityItem[]; players: Player[]; open: boolean; onToggle: () => void; t: TFunction }) {
  const closeRef = useRef<HTMLButtonElement>(null)
  const previousFocus = useRef<HTMLElement | null>(null)
  useEffect(() => {
    if (open) {
      previousFocus.current = document.activeElement as HTMLElement | null
      closeRef.current?.focus()
    } else if (previousFocus.current) {
      previousFocus.current.focus()
      previousFocus.current = null
    }
  }, [open])
  return <><button className="game-v2-log-toggle" type="button" onClick={onToggle} aria-expanded={open} aria-controls="match-activity"><History size={17}/> {t('matchLog')}</button><aside id="match-activity" className={`game-v2-activity ${open ? 'is-open' : ''}`} aria-label={t('matchLog')} hidden={!open} onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); onToggle() } }}><div><b>{t('matchLog')}</b><button ref={closeRef} type="button" onClick={onToggle} aria-label={t('close')}><X size={17}/></button></div>{items.length ? items.map((item) => <p key={item.id} data-tone={item.tone}>{activityText(item, players, t)}</p>) : <p>{t('noMoves')}</p>}</aside></>
}

function TakeHandDialog({ target, taking, activeCount, t, onCancel, onConfirm }: { target: Player; taking: boolean; activeCount: number; t: TFunction; onCancel: () => void; onConfirm: () => void }) {
  return <AccessibleDialog labelId="take-v2-title" className="game-v2-take-sheet" onClose={onCancel}><span className="game-v2-take-sheet__handle" aria-hidden="true"/><span className="game-v2-take-sheet__icon"><HandCards size={29}/></span><span className="game-v2-eyebrow">{t('rightHandRule')}</span><h2 id="take-v2-title">{t('takeQuestion', { name: target.name, count: target.cardCount })}</h2><p>{t('takeExplanation', { name: target.name })}</p>{activeCount === 2 ? <p className="game-v2-take-sheet__warning">{t('takeWarning')}</p> : null}<div className="game-v2-take-sheet__actions"><button className="game-v2-button game-v2-button--secondary" type="button" disabled={taking} onClick={onCancel}>{t('cancel')}</button><button className="game-v2-button game-v2-button--danger" type="button" disabled={taking} onClick={onConfirm}>{taking ? <span className="spinner"/> : <HandCards size={19}/>} {t('takeHand', { name: target.name, count: target.cardCount })}</button></div></AccessibleDialog>
}

function reactionLabel(reaction: Reaction, t: TFunction): string {
  if (reaction === 'thulla') return t('reactionThulla')
  if (reaction === 'wah') return t('reactionWah')
  if (reaction === 'oye') return t('reactionOye')
  if (reaction === 'chalo') return t('reactionChalo')
  if (reaction === 'bach-gaya') return t('reactionBachGaya')
  return t('reactionGoodMove')
}

function PreferenceDialog({ language, t, preferences, isHost, chatSupported, chatMode, chatModeBusy, onLanguage, onPreference, onChatMode, onClose }: { language: Language; t: TFunction; preferences: Preferences; isHost: boolean; chatSupported: boolean; chatMode: ChatMode; chatModeBusy: boolean; onLanguage: (language: Language) => void; onPreference: <K extends keyof Preferences>(key: K, value: Preferences[K]) => void; onChatMode: (chatMode: ChatMode) => void; onClose: () => void }) {
  return <AccessibleDialog labelId="preference-title" className="preference-sheet" onClose={onClose}><div className="sheet-header"><div><span className="game-v2-eyebrow">Bhabhi Thulla</span><h2 id="preference-title">{t('settings')}</h2></div><IconButton label={t('close')} onClick={onClose}><X size={21}/></IconButton></div><label className="preference-row"><span>{t('language')}</span><select value={language} onChange={(event) => onLanguage(event.target.value as Language)}><option value="en">{t('english')}</option><option value="roman">{t('romanUrdu')}</option><option value="ur">{t('urdu')}</option></select></label><label className="preference-row"><span><Volume size={18}/> {t('sound')}</span><input type="checkbox" checked={preferences.sound} onChange={(event) => onPreference('sound', event.target.checked)}/></label><label className="preference-row"><span><Wifi size={18}/> {t('haptics')}</span><input type="checkbox" checked={preferences.haptics} onChange={(event) => onPreference('haptics', event.target.checked)}/></label><label className="preference-row"><span><Message size={18}/> {t('muteReactions')}</span><input type="checkbox" checked={preferences.reactionsMuted} onChange={(event) => onPreference('reactionsMuted', event.target.checked)}/></label>{chatSupported ? <label className="preference-row"><span><Message size={18}/> {t('muteChatNotifications')}</span><input type="checkbox" checked={preferences.chatNotificationsMuted} onChange={(event) => onPreference('chatNotificationsMuted', event.target.checked)}/></label> : null}{chatSupported && isHost ? <label className="preference-row"><span>{t('chatMode')}</span><select value={chatMode} disabled={chatModeBusy} onChange={(event) => onChatMode(event.target.value as ChatMode)}><option value="text">{t('chatTextAndQuick')}</option><option value="quick">{t('chatQuickOnly')}</option><option value="off">{t('chatOff')}</option></select></label> : null}<button className="game-v2-button game-v2-button--primary game-v2-button--wide" type="button" onClick={onClose}>{t('save')}</button></AccessibleDialog>
}

type ResultBusyAction = 'ready' | 'restart' | 'reset' | 'remove-waiting' | 'add-bot' | 'replace-bot' | null

function RoundResult({ room, me, loser, connected, busyAction, t, onReady, onRestart, onReset, onRemoveWaiting, onAddBot, onInvite, onLeave }: {
  room: ClientRoomView
  me: Player
  loser?: Player
  connected: boolean
  busyAction: ResultBusyAction
  t: TFunction
  onReady: () => void
  onRestart: () => void
  onReset: () => void
  onRemoveWaiting: (player: Player) => void
  onAddBot: () => void
  onInvite: () => Promise<void>
  onLeave: () => void
}) {
  const activePlayers = room.players.filter((player) => !player.waitingForNextRound)
  const waitingPlayers = room.players.filter((player) => player.waitingForNextRound)
  const waitingIds = new Set(waitingPlayers.map((player) => player.id))
  const scores = room.session.scores.filter((score) => !waitingIds.has(score.playerId))
  const participants = room.players.filter((player) => player.isBot || player.connected)
  const missingPlayers = Math.max(0, room.minPlayers - participants.length)
  const playersAwaitingReadiness = participants.filter((player) => !player.isBot && !player.rematchReady)
  const canAddBot = me.isHost && room.settings.allowBots && room.players.length < room.maxPlayers
  const serverBusy = busyAction !== null
  const [inviteBusy, setInviteBusy] = useState(false)
  const dialogRef = useRef<HTMLDivElement>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null
    headingRef.current?.focus()
    return () => {
      if (!previousFocus?.isConnected || previousFocus.closest('[inert], [aria-hidden="true"]')) return
      previousFocus.focus({ preventScroll: true })
    }
  }, [])
  function trapFocus(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'Tab') return
    const controls = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled),[href],[tabindex]:not([tabindex="-1"])') ?? [])
    if (!controls.length) { event.preventDefault(); headingRef.current?.focus(); return }
    const first = controls[0]; const last = controls[controls.length - 1]
    if (event.shiftKey && (document.activeElement === first || document.activeElement === headingRef.current)) { event.preventDefault(); last.focus() }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
  }
  const resultTitle = loser?.isYou ? t('youAreBhabhi') : t('playerIsBhabhi', { name: loser?.name ?? t('player') })
  const blockerMessage = !connected
    ? `${t('reconnectingServer')} ${t('connectionWait')}`
    : missingPlayers > 0
      ? t('needPlayers', { count: missingPlayers })
      : playersAwaitingReadiness.length > 0
        ? playersAwaitingReadiness.map((player) => t('playerWaitingStatus', { name: player.name })).join(' ')
        : me.isHost
          ? t('readyToDeal')
          : t('waitingHost')
  async function inviteFriends() {
    if (inviteBusy) return
    setInviteBusy(true)
    try { await onInvite() } finally { setInviteBusy(false) }
  }
  return <div className="game-v2-result"><div ref={dialogRef} className="game-v2-result__card" role="dialog" aria-modal="true" aria-labelledby="round-result-title" aria-describedby="round-result-blocker" aria-busy={serverBusy || undefined} onKeyDown={trapFocus}>
    <span className="sr-only" role="status" aria-live="assertive">{t('roundResultAnnouncement', { result: resultTitle })}</span>
    <div className="game-v2-result__summary"><span className="game-v2-result__mark" aria-hidden="true">B</span><span className="game-v2-eyebrow">{t('roundOver')} · {t('round', { count: room.session.roundNumber })}</span><h2 ref={headingRef} id="round-result-title" tabIndex={-1}>{resultTitle}</h2><div className="game-v2-scoreboard" aria-label={t('sessionScore')}><div><b>{t('sessionScore')}</b><Trophy size={18}/></div>{scores.map((score) => <p key={score.playerId}><span><bdi dir="auto">{score.playerName}</bdi></span><b>{score.escapes} {t('gotAway')}</b><em>{score.bhabhiCount} {t('bhabhi')}</em></p>)}</div></div>
    <div className="game-v2-result__controls" aria-busy={serverBusy || undefined}>
      {!connected ? <div className="game-v2-result__offline" role="status"><WifiOff size={19}/><span><b>{t('reconnectingServer')}</b><small>{t('connectionWait')}</small></span></div> : null}
      {waitingPlayers.length ? <div className="game-v2-result__waiting"><b>{t('waitingPlayers')}</b>{waitingPlayers.map((player) => {
        const ready = player.rematchReady || player.isBot
        return <div className="game-v2-result__waiting-person" key={player.id}><span aria-label={ready ? t('playerReadyStatus', { name: player.name }) : t('playerWaitingStatus', { name: player.name })}>{ready ? <Check size={15}/> : <Clock3 size={15}/>}<bdi dir="auto">{player.name}</bdi><small>{ready ? t('readyForNextRound') : t('waitingForReadiness')}</small></span>{me.isHost && player.id !== me.id ? <button className="game-v2-remove-waiting" data-result-action="remove-waiting" type="button" disabled={!connected || serverBusy} onClick={() => onRemoveWaiting(player)} aria-label={t('removeWaitingPlayer', { name: player.name })} title={t('removeWaitingPlayer', { name: player.name })}>{busyAction === 'remove-waiting' ? <span className="spinner"/> : <X size={17}/>}</button> : null}</div>
      })}</div> : null}
      <div className="game-v2-rematch-status">{activePlayers.map((player) => {
        const ready = player.isBot || player.rematchReady
        return <span key={player.id} className={ready ? 'is-ready' : ''} aria-label={ready ? t('playerReadyStatus', { name: player.name }) : t('playerWaitingStatus', { name: player.name })}>{ready ? <Check size={14}/> : <Clock3 size={14}/>} <bdi dir="auto">{player.name}</bdi><small>{ready ? t('readyForNextRound') : t('waitingForReadiness')}</small></span>
      })}</div>
      {me.waitingForNextRound ? <div className="game-v2-result__queued"><b>{t('joinNextRoundTitle')}</b><span>{t('joinNextRoundBody', { count: me.joinedInRound, round: me.joinedInRound })}</span></div> : null}
      <button className={`game-v2-button game-v2-result__ready ${me.rematchReady ? 'game-v2-button--secondary' : 'game-v2-button--primary'} game-v2-button--wide`} data-result-action="ready" type="button" aria-pressed={me.rematchReady} disabled={!connected || serverBusy} onClick={onReady}>{busyAction === 'ready' ? <span className="spinner"/> : <Check size={19}/>} {me.rematchReady ? t('cancelReadiness') : t('markReadyForNextRound')}</button>
      <p id="round-result-blocker" className="game-v2-result__blocker" role="status" aria-live="polite">{blockerMessage}</p>
      {canAddBot ? <button className="game-v2-button game-v2-button--secondary game-v2-button--wide game-v2-result__add-bot" data-result-action="add-bot" type="button" disabled={!connected || serverBusy} onClick={onAddBot}>{busyAction === 'add-bot' ? <span className="spinner"/> : <span aria-hidden="true">AI</span>} {t('addBot')}</button> : null}
      {me.isHost ? <button className="game-v2-button game-v2-button--primary game-v2-button--wide game-v2-result__restart" data-result-action="restart" type="button" aria-describedby="round-result-blocker" disabled={!connected || serverBusy || !room.canStart} onClick={onRestart}>{busyAction === 'restart' ? <span className="spinner"/> : <RotateCcw size={19}/>} {t('playAnother')}</button> : null}
      <div className="game-v2-result__secondary-actions">
        <button className="game-v2-button game-v2-button--secondary game-v2-result__invite" data-result-action="invite" type="button" disabled={inviteBusy} onClick={() => void inviteFriends()}>{inviteBusy ? <span className="spinner"/> : <Share2 size={18}/>} {t('copyInvite')}</button>
        <button className="game-v2-button game-v2-button--secondary game-v2-result__leave" data-result-action="leave" type="button" onClick={onLeave}><LogOut size={18}/> {t('leaveTable')}</button>
      </div>
      {me.isHost ? <button className="game-v2-reset" data-result-action="reset" type="button" disabled={!connected || serverBusy} onClick={onReset}>{busyAction === 'reset' ? <span className="spinner"/> : null}{t('resetSession')}</button> : null}
    </div>
  </div></div>
}

function playAttentionTone(frequency = 660) {
  try {
    const AudioContextClass = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AudioContextClass) return
    const context = new AudioContextClass(); const oscillator = context.createOscillator(); const gain = context.createGain()
    oscillator.frequency.value = frequency; gain.gain.setValueAtTime(.0001, context.currentTime); gain.gain.exponentialRampToValueAtTime(.11, context.currentTime + .02); gain.gain.exponentialRampToValueAtTime(.0001, context.currentTime + .22); oscillator.connect(gain); gain.connect(context.destination); oscillator.start(); oscillator.stop(context.currentTime + .24); oscillator.addEventListener('ended', () => void context.close())
  } catch { /* Browser may require a prior interaction. */ }
}

export default function GameTable({ room, socket, connected, t, language, chatSupported, onLanguage, preferences, onPreference, liveReaction, onOpenRules, onLeave, onToast }: {
  room: ClientRoomView; socket: Socket; connected: boolean; t: TFunction; language: Language; chatSupported: boolean; onLanguage: (language: Language) => void; preferences: Preferences; onPreference: <K extends keyof Preferences>(key: K, value: Preferences[K]) => void; liveReaction: TableReaction | null; onOpenRules: () => void; onLeave: () => void; onToast: (message: string, tone?: 'success' | 'error' | 'info') => void
}) {
  const game = room.game!
  const me = room.players.find((player) => player.isYou)!
  const activePlayers = useMemo(() => room.players.filter((player) => !player.waitingForNextRound), [room.players])
  const waitingPlayers = useMemo(() => room.players.filter((player) => player.waitingForNextRound), [room.players])
  const currentPlayer = room.players.find((player) => player.id === game.currentTurnId)
  const reconnectPlayer = room.players.find((player) => player.id === game.reconnectPlayerId)
  const loser = room.players.find((player) => player.id === game.loserId)
  const takeTarget = room.players.find((player) => player.id === game.takeTargetId)
  const opponents = useMemo(() => orderedOpponents(activePlayers, me.id), [activePlayers, me.id])
  const rightPlayer = me.waitingForNextRound ? undefined : opponents.find((player) => !player.escaped)
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null)
  const [playing, setPlaying] = useState(false)
  const [taking, setTaking] = useState(false)
  const [takeConfirmOpen, setTakeConfirmOpen] = useState(false)
  const [activityOpen, setActivityOpen] = useState(false)
  const [preferenceOpen, setPreferenceOpen] = useState(false)
  const [chatModeBusy, setChatModeBusy] = useState(false)
  const [explanationOpen, setExplanationOpen] = useState(false)
  const [lastExplanation, setLastExplanation] = useState('')
  const [resultBusyAction, setResultBusyAction] = useState<ResultBusyAction>(null)
  const resultBusyRef = useRef(false)
  const opponentsRef = useRef<HTMLDivElement>(null)
  const opponentAutoScrollingRef = useRef(false)
  const opponentAutoScrollTimerRef = useRef<number | null>(null)
  const opponentManualScrollUntilRef = useRef(0)
  const handRef = useRef<HTMLDivElement>(null)
  const gameStatusRef = useRef<HTMLDivElement>(null)
  const headerOverflowRef = useRef<HTMLDetailsElement>(null)
  const explanationButtonRef = useRef<HTMLButtonElement>(null)
  const explanationPanelRef = useRef<HTMLParagraphElement>(null)
  const explanationPreviousFocus = useRef<HTMLElement | null>(null)
  const [scrollHint, setScrollHint] = useState(false)
  const [handOverflow, setHandOverflow] = useState(false)
  const [opponentScrollHint, setOpponentScrollHint] = useState(false)
  const [opponentOverflow, setOpponentOverflow] = useState(false)
  const [opponentRailPosition, setOpponentRailPosition] = useState(1)
  const [opponentHintDismissed, setOpponentHintDismissed] = useState(false)
  const [queueAnnouncement, setQueueAnnouncement] = useState('')
  const [reconnectAnnouncement, setReconnectAnnouncement] = useState('')
  const legalIds = useMemo(() => new Set(game.legalCardIds), [game.legalCardIds])
  const isFinished = room.status === 'finished'
  const isResolving = game.phase === 'resolving'
  const isThullaResolution = isResolving && game.resolvedTrick?.kind === 'thulla'
  const isReconnectPause = game.phase === 'waiting_for_reconnect'
  const isMyTurn = game.phase === 'turn' && game.currentTurnId === me.id && !me.waitingForNextRound
  const preferencesBlocked = isMyTurn || isResolving || isFinished
  const canAct = connected && room.status === 'playing' && isMyTurn && !isResolving && !isReconnectPause
  const selectedCard = game.hand.find((card) => card.id === selectedCardId)
  const visibleTrick = isResolving && game.resolvedTrick ? game.resolvedTrick.cards : game.trick
  const resolvedWinner = room.players.find((player) => player.id === game.resolvedTrick?.winnerId)
  const resolvedLastPlayer = room.players.find((player) => player.id === game.resolvedTrick?.lastPlayerId)
  const resolutionCountdown = useCountdown(game.resolutionEndsAt, isResolving, 3_000, 100)
  const reconnectCountdown = useCountdown(game.reconnectEndsAt, isReconnectPause, room.settings.reconnectGraceSeconds * 1_000, 250)
  const previousMyTurn = useRef(false)
  const previousResolution = useRef<string | null>(null)
  const previousEscaped = useRef(me.escaped)
  const previousFinished = useRef(room.status === 'finished')
  const previousRoundNumber = useRef(room.session.roundNumber)
  const previousReconnect = useRef<{ active: boolean; playerId: string | null }>({ active: false, playerId: null })

  useEffect(() => { if (selectedCardId && (!game.hand.some((card) => card.id === selectedCardId) || !legalIds.has(selectedCardId) || !canAct)) setSelectedCardId(null) }, [game.hand, legalIds, selectedCardId, canAct])
  useEffect(() => { if (!game.canTakeRightHand || !canAct) setTakeConfirmOpen(false) }, [game.canTakeRightHand, canAct])
  useEffect(() => {
    setQueueAnnouncement(me.waitingForNextRound
      ? me.rematchReady
        ? t('queueReadyAnnouncement', { round: me.joinedInRound })
        : t('queueWaitingAnnouncement', { round: me.joinedInRound })
      : '')
  }, [me.joinedInRound, me.rematchReady, me.waitingForNextRound, t])
  useEffect(() => {
    const roundChanged = previousRoundNumber.current !== room.session.roundNumber
    previousRoundNumber.current = room.session.roundNumber
    const shouldClose = isMyTurn || isResolving || isFinished || roundChanged
    if (!shouldClose) return
    if (headerOverflowRef.current) headerOverflowRef.current.open = false
    if (!preferenceOpen) return
    setPreferenceOpen(false)
    if (!isFinished) window.requestAnimationFrame(() => gameStatusRef.current?.focus({ preventScroll: true }))
  }, [isFinished, isMyTurn, isResolving, preferenceOpen, room.session.roundNumber])
  useEffect(() => { if (!isResolving && game.trick.length > 0) setExplanationOpen(false) }, [isResolving, game.trick.length])
  useEffect(() => {
    const playerId = isReconnectPause ? reconnectPlayer?.id ?? null : null
    const previous = previousReconnect.current
    if (isReconnectPause && (!previous.active || previous.playerId !== playerId)) {
      setReconnectAnnouncement(t('reconnectLiveWaiting', { name: reconnectPlayer?.name ?? t('player') }))
    } else if (!isReconnectPause && previous.active) {
      setReconnectAnnouncement(isFinished ? '' : t('reconnectLiveResumed'))
    }
    previousReconnect.current = { active: isReconnectPause, playerId }
  }, [isFinished, isReconnectPause, reconnectPlayer?.id, reconnectPlayer?.name, t])
  useEffect(() => {
    const becameMyTurn = isMyTurn && !previousMyTurn.current
    previousMyTurn.current = isMyTurn
    if (!becameMyTurn) return
    if (preferences.sound) playAttentionTone()
    if (preferences.haptics && navigator.vibrate) navigator.vibrate(90)
  }, [isMyTurn, preferences.sound, preferences.haptics])
  useEffect(() => {
    const key = isResolving && game.resolvedTrick ? `${game.resolvedTrick.lastPlayerId}:${game.resolutionEndsAt}` : null
    if (!key || key === previousResolution.current) return
    previousResolution.current = key
    if (preferences.sound) playAttentionTone(game.resolvedTrick?.kind === 'thulla' ? 330 : 520)
    if (preferences.haptics && navigator.vibrate && game.resolvedTrick?.kind === 'thulla') navigator.vibrate([70, 45, 120])
  }, [isResolving, game.resolvedTrick?.lastPlayerId, game.resolvedTrick?.kind, game.resolutionEndsAt, preferences.sound, preferences.haptics])
  useEffect(() => {
    if (me.escaped && !previousEscaped.current) {
      if (preferences.sound) playAttentionTone(780)
      if (preferences.haptics && navigator.vibrate) navigator.vibrate([45, 35, 45])
    }
    previousEscaped.current = me.escaped
  }, [me.escaped, preferences.sound, preferences.haptics])
  useEffect(() => {
    const finished = room.status === 'finished'
    if (finished && !previousFinished.current && preferences.sound) playAttentionTone(260)
    previousFinished.current = finished
  }, [room.status, preferences.sound])
  useEffect(() => {
    const defaultTitle = t('documentTitle')
    function updateTitle() { document.title = isMyTurn && document.hidden ? `${t('yourTurn')} — Bhabhi Thulla` : defaultTitle }
    updateTitle(); document.addEventListener('visibilitychange', updateTitle); return () => { document.removeEventListener('visibilitychange', updateTitle); document.title = defaultTitle }
  }, [isMyTurn, t])
  useEffect(() => {
    if (explanationOpen) {
      explanationPreviousFocus.current = document.activeElement as HTMLElement | null
      explanationPanelRef.current?.focus()
      return
    }
    if (explanationPreviousFocus.current) {
      explanationPreviousFocus.current.focus()
      explanationPreviousFocus.current = null
    }
  }, [explanationOpen])
  useEffect(() => {
    const update = () => {
      const handOverflows = Boolean(handRef.current && handRef.current.scrollWidth > handRef.current.clientWidth + 8)
      const opponentsOverflow = Boolean(opponentsRef.current && opponentsRef.current.scrollWidth > opponentsRef.current.clientWidth + 8)
      setHandOverflow(handOverflows)
      setOpponentOverflow(opponentsOverflow)
      updateOpponentRailPosition()
      setScrollHint(room.settings.tutorialHints && !preferences.scrollHintSeen && handOverflows)
      setOpponentScrollHint(room.settings.tutorialHints && !opponentHintDismissed && opponentsOverflow)
    }
    const frame = window.requestAnimationFrame(update)
    const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update)
    if (handRef.current) resizeObserver?.observe(handRef.current)
    if (opponentsRef.current) resizeObserver?.observe(opponentsRef.current)
    window.addEventListener('resize', update)
    return () => { window.cancelAnimationFrame(frame); resizeObserver?.disconnect(); window.removeEventListener('resize', update) }
  }, [game.hand.length, opponentHintDismissed, opponents.length, preferences.scrollHintSeen, room.settings.tutorialHints])

  useEffect(() => {
    if (!opponentOverflow || Date.now() < opponentManualScrollUntilRef.current) return
    const targetId = currentPlayer && !currentPlayer.isYou ? currentPlayer.id : rightPlayer?.id
    if (!targetId) return
    const frame = window.requestAnimationFrame(() => {
      const rail = opponentsRef.current
      const target = opponentSeats().find((seat) => seat.dataset.playerId === targetId)
      if (!rail || !target) return
      const railBounds = rail.getBoundingClientRect()
      const targetBounds = target.getBoundingClientRect()
      const isFullyVisible = targetBounds.left >= railBounds.left + 2 && targetBounds.right <= railBounds.right - 2
      if (isFullyVisible) { updateOpponentRailPosition(); return }
      opponentAutoScrollingRef.current = true
      target.scrollIntoView({ behavior: opponentScrollBehavior(), block: 'nearest', inline: 'center' })
      if (opponentAutoScrollTimerRef.current !== null) window.clearTimeout(opponentAutoScrollTimerRef.current)
      opponentAutoScrollTimerRef.current = window.setTimeout(() => {
        opponentAutoScrollingRef.current = false
        opponentAutoScrollTimerRef.current = null
        updateOpponentRailPosition()
      }, 700)
    })
    return () => window.cancelAnimationFrame(frame)
  }, [currentPlayer?.id, opponentOverflow, opponents.length, rightPlayer?.id])

  useEffect(() => () => {
    if (opponentAutoScrollTimerRef.current !== null) window.clearTimeout(opponentAutoScrollTimerRef.current)
  }, [])

  function markHandScrolled() { if (!preferences.scrollHintSeen) onPreference('scrollHintSeen', true); setScrollHint(false) }
  function opponentScrollBehavior(): ScrollBehavior {
    return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'
  }
  function opponentSeats(): HTMLElement[] {
    return Array.from(opponentsRef.current?.querySelectorAll<HTMLElement>('[data-opponent-seat]') ?? [])
      .sort((first, second) => first.getBoundingClientRect().left - second.getBoundingClientRect().left)
  }
  function updateOpponentRailPosition() {
    const rail = opponentsRef.current
    const seats = opponentSeats()
    if (!rail || !seats.length) { setOpponentRailPosition(1); return }
    const railBounds = rail.getBoundingClientRect()
    const firstBounds = seats[0].getBoundingClientRect()
    const lastBounds = seats[seats.length - 1].getBoundingClientRect()
    if (Math.abs(firstBounds.left - railBounds.left) <= 3) { setOpponentRailPosition(1); return }
    if (Math.abs(lastBounds.right - railBounds.right) <= 3) { setOpponentRailPosition(seats.length); return }
    const railCenter = railBounds.left + rail.clientWidth / 2
    let closestIndex = 0
    let closestDistance = Number.POSITIVE_INFINITY
    seats.forEach((seat, index) => {
      const bounds = seat.getBoundingClientRect()
      const distance = Math.abs(bounds.left + bounds.width / 2 - railCenter)
      if (distance < closestDistance) { closestIndex = index; closestDistance = distance }
    })
    setOpponentRailPosition(closestIndex + 1)
  }
  function markOpponentInteraction() {
    opponentAutoScrollingRef.current = false
    if (opponentAutoScrollTimerRef.current !== null) {
      window.clearTimeout(opponentAutoScrollTimerRef.current)
      opponentAutoScrollTimerRef.current = null
    }
    opponentManualScrollUntilRef.current = Date.now() + 6_000
  }
  function markOpponentsScrolled() {
    updateOpponentRailPosition()
    if (opponentAutoScrollingRef.current) return
    setOpponentHintDismissed(true)
    setOpponentScrollHint(false)
  }
  function handleOpponentRailKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!opponentOverflow || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    const seats = opponentSeats()
    if (!seats.length) return
    event.preventDefault()
    markOpponentInteraction()
    setOpponentHintDismissed(true)
    setOpponentScrollHint(false)
    const currentIndex = Math.min(seats.length - 1, Math.max(0, opponentRailPosition - 1))
    const nextIndex = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? seats.length - 1
        : Math.min(seats.length - 1, Math.max(0, currentIndex + (event.key === 'ArrowLeft' ? -1 : 1)))
    setOpponentRailPosition(nextIndex + 1)
    seats[nextIndex].scrollIntoView({ behavior: opponentScrollBehavior(), block: 'nearest', inline: 'center' })
  }
  function openPreferences() {
    if (preferencesBlocked) return
    if (headerOverflowRef.current) headerOverflowRef.current.open = false
    setPreferenceOpen(true)
  }
  function runOverflowAction(action: () => void) {
    if (headerOverflowRef.current) headerOverflowRef.current.open = false
    action()
  }
  async function playSelected() { if (!selectedCardId || !canAct) return; setPlaying(true); const response = await emitWithAck(socket, 'game:play', { cardId: selectedCardId }); setPlaying(false); if (!response.ok) onToast(response.error ?? t('cardPlayFailed'), 'error'); else setSelectedCardId(null) }
  async function takeRightHand() { if (!game.canTakeRightHand || !takeTarget || !canAct) return; setTaking(true); const response = await emitWithAck(socket, 'game:take-right', {}); setTaking(false); setTakeConfirmOpen(false); if (!response.ok) onToast(response.error ?? t('takeFailed'), 'error'); else onToast(t('takeSuccess', { name: takeTarget.name }), 'success') }
  async function copyRoomCode() { try { await navigator.clipboard.writeText(room.code); onToast(t('roomCodeCopied'), 'success') } catch { onToast(`${t('roomCode')}: ${room.code}`, 'info') } }
  async function shareInvite() {
    const inviteUrl = `${window.location.origin}${window.location.pathname}?room=${room.code}${room.mode === 'party' ? '&mode=party' : ''}`
    const message = t('inviteMessage', { url: inviteUrl })
    try {
      if (navigator.share) await navigator.share({ title: 'Bhabhi Thulla', text: message, url: inviteUrl })
      else await navigator.clipboard.writeText(message)
      onToast(t('inviteCopied'), 'success')
    } catch (error) {
      if (isShareCancelled(error)) return
      try { await navigator.clipboard.writeText(message); onToast(t('inviteCopied'), 'success') }
      catch { onToast(t('copyInviteFailed', { code: room.code }), 'error') }
    }
  }
  async function updateChatMode(chatMode: ChatMode) { if (!connected) return; setChatModeBusy(true); const response = await emitWithAck(socket, 'room:settings', { chatMode }); setChatModeBusy(false); if (!response.ok) onToast(response.error ?? t('chatModeUpdateFailed'), 'error') }
  async function resultAction(action: Exclude<ResultBusyAction, null>, event: string, payload: unknown = {}, fallback = t('roundUpdateFailed')) {
    if (!connected) { onToast(t('reconnectingServer'), 'error'); return }
    if (resultBusyRef.current) return
    resultBusyRef.current = true
    setResultBusyAction(action)
    try {
      const response = await emitWithAck(socket, event, payload)
      if (!response.ok) onToast(response.error ?? fallback, 'error')
    } catch {
      onToast(fallback, 'error')
    } finally {
      resultBusyRef.current = false
      setResultBusyAction(null)
    }
  }
  function replaceWithBot() { if (reconnectPlayer && window.confirm(t('replaceBotConfirm', { name: reconnectPlayer.name }))) void resultAction('replace-bot', 'game:replace-with-bot', { playerId: reconnectPlayer.id }) }
  function resetSession() { if (window.confirm(t('resetConfirm'))) void resultAction('reset', 'game:reset-session') }
  function removeWaiting(player: Player) { if (window.confirm(t('removeWaitingConfirm', { name: player.name }))) void resultAction('remove-waiting', 'room:kick', { playerId: player.id }) }

  let tableMessage: string
  if (isReconnectPause) tableMessage = t('activityReconnectWait', { player: reconnectPlayer?.name ?? t('player') })
  else if (isThullaResolution) tableMessage = t('thullaResult', { last: resolvedLastPlayer?.name ?? t('player'), winner: resolvedWinner?.name ?? t('player') })
  else if (isResolving && game.resolvedTrick?.kind === 'opening') tableMessage = t('openingResult', { winner: resolvedWinner?.name ?? t('player') })
  else if (isResolving && game.resolvedTrick?.kind === 'clean') tableMessage = t('cleanResult', { winner: resolvedWinner?.name ?? t('player') })
  else if (game.firstTrick) tableMessage = game.trick.length === 0 ? t('aceSpadesOpens') : t('openingEveryone')
  else if (isMyTurn) tableMessage = game.canTakeRightHand ? t('leadOrTake') : t('chooseLegalCard')
  else tableMessage = t('playerThinking', { name: currentPlayer?.name ?? t('player') })
  const statusLabel = isThullaResolution ? `THULLA! · ${t('nextTrick')}` : isResolving ? t('nextTrick') : isMyTurn ? t('yourTurn') : game.firstTrick ? t('openingTrick') : t('currentTurn')
  const ledSuit = game.resolvedTrick?.cards[0]?.card.suit ?? game.leadSuit
  const explanation = game.resolvedTrick?.kind === 'thulla'
    ? t('explainThulla', { last: resolvedLastPlayer?.name ?? t('player'), suit: ledSuit ? localizedSuit(t, ledSuit) : t('ledSuit'), winner: resolvedWinner?.name ?? t('player') })
    : game.resolvedTrick?.kind === 'opening'
      ? t('explainOpening', { winner: resolvedWinner?.name ?? t('player') })
      : game.resolvedTrick?.kind === 'clean'
        ? t('explainClean', { winner: resolvedWinner?.name ?? t('player') })
        : game.whatHappened ?? ''
  useEffect(() => { if (isResolving && game.resolvedTrick) setLastExplanation(explanation) }, [isResolving, game.resolvedTrick?.lastPlayerId, explanation])
  const canReviewExplanation = Boolean(lastExplanation) && (isResolving || game.trick.length === 0)
  const trickSummary = visibleTrick.length
    ? visibleTrick.map((entry) => t('playedCard', { name: entry.playerId === me.id ? t('you') : entry.playerName, card: t('cardName', { rank: entry.card.rank, suit: localizedSuit(t, entry.card.suit) }) })).join(' ')
    : game.firstTrick ? t('waitingAce') : t('tableClear')
  const settingsButtonLabel = preferencesBlocked ? t('settingsUnavailable') : t('settings')

  return <main className={`game-v2-shell ${room.mode === 'party' ? 'is-party-controller' : ''} ${isFinished ? 'is-finished' : ''} ${me.waitingForNextRound ? 'is-waiting' : ''} ${isResolving ? 'is-resolving' : ''} ${isReconnectPause ? 'is-reconnecting' : ''} ${canReviewExplanation ? 'has-explanation' : ''}`}>
    {!isFinished ? <a className="game-v2-skip" href={me.waitingForNextRound ? '#game-v2-waiting-player' : '#game-v2-hand'}>{me.waitingForNextRound ? t('watchingTable') : t('skipToHand')}</a> : null}
    <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">{queueAnnouncement}</span>
    <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">{reconnectAnnouncement}</span>
    <header className="game-v2-header" aria-hidden={isFinished || undefined} inert={isFinished || undefined}>
      <GameLogo/>
      <button className="game-v2-room" type="button" onClick={() => void copyRoomCode()} aria-label={t('copyRoomCode', { code: room.code })}><span>{t('room')}</span><b>{room.code}</b><Copy size={16}/></button>
      <div className="game-v2-header__actions">
        {room.mode === 'party' ? <span className={`game-v2-party-board-status ${room.partyBoardConnected ? 'is-online' : ''}`} role="status" title={room.partyBoardConnected ? t('sharedScreenConnected') : t('sharedScreenDisconnected')}><Monitor size={17}/><span>{room.partyBoardConnected ? t('sharedScreenConnected') : t('sharedScreenDisconnected')}</span></span> : null}
        <span className={`game-v2-connection ${connected ? 'is-online' : ''}`} role="status" aria-label={connected ? t('connectedServer') : t('reconnectingServer')}>{connected ? <Wifi size={17}/> : <WifiOff size={17}/>}<span>{connected ? t('live') : t('reconnecting')}</span></span>
        <div className="game-v2-header-secondary">
          <IconButton label={settingsButtonLabel} disabled={preferencesBlocked} onClick={openPreferences}><Settings size={21}/></IconButton>
          <IconButton label={t('howToPlay')} onClick={onOpenRules}><BookOpen size={21}/></IconButton>
          <IconButton className="game-v2-icon-button--danger" label={t('leaveTable')} onClick={onLeave}><LogOut size={21}/></IconButton>
        </div>
        <details ref={headerOverflowRef} className="game-v2-header-overflow" onKeyDown={(event) => { if (event.key === 'Escape' && headerOverflowRef.current?.open) { event.preventDefault(); headerOverflowRef.current.open = false; headerOverflowRef.current.querySelector<HTMLElement>('summary')?.focus() } }}>
          <summary aria-label={t('moreOptions')} title={t('moreOptions')}><MoreHorizontal size={22}/></summary>
          <div className="game-v2-header-overflow__panel" role="group" aria-label={t('gameOptions')}>
            <button type="button" disabled={preferencesBlocked} aria-label={settingsButtonLabel} title={settingsButtonLabel} onClick={openPreferences}><Settings size={19}/><span>{t('settings')}</span></button>
            <button type="button" onClick={() => runOverflowAction(onOpenRules)}><BookOpen size={19}/><span>{t('howToPlay')}</span></button>
            <button className="is-danger" type="button" onClick={() => runOverflowAction(onLeave)}><LogOut size={19}/><span>{t('leaveTable')}</span></button>
          </div>
        </details>
      </div>
    </header>
    <div className="game-v2-layout" aria-hidden={isFinished || undefined} inert={isFinished || undefined}>
      <section className={`game-v2-table ${isResolving ? 'has-resolved' : ''} ${isReconnectPause ? 'is-paused' : ''}`} aria-label={t('cardTable')}>
        <div
          ref={opponentsRef}
          className={`game-v2-opponents ${opponentOverflow ? 'has-overflow is-keyboard-scrollable' : ''}`}
          data-count={opponents.length}
          data-overflow-position={opponentOverflow ? opponentRailPosition : undefined}
          role="region"
          tabIndex={0}
          aria-label={t('otherPlayers')}
          aria-describedby={opponentOverflow ? 'game-v2-opponent-position' : undefined}
          aria-keyshortcuts="ArrowLeft ArrowRight Home End"
          onKeyDown={handleOpponentRailKeyDown}
          onPointerDown={markOpponentInteraction}
          onWheel={markOpponentInteraction}
          onScroll={markOpponentsScrolled}
        >{opponents.map((player, index) => <OpponentSeat key={player.id} player={player} isTurn={player.id === game.currentTurnId} isRight={player.id === rightPlayer?.id} placement={seatPlacement(index, opponents.length)} t={t}/>)}</div>
        {opponentScrollHint ? <span className="game-v2-opponent-scroll-hint" role="status"><span aria-hidden="true">&harr;</span> {t('swipePlayersHint')} <b>{opponentRailPosition}/{opponents.length}</b></span> : null}
        {opponentOverflow ? <output id="game-v2-opponent-position" className="game-v2-opponent-position" role="status" aria-live="polite" aria-label={`${t('otherPlayers')}: ${opponentRailPosition} / ${opponents.length}`}><span aria-hidden="true">{opponentRailPosition} / {opponents.length}</span></output> : null}
        {room.settings.tutorialHints ? <div className="game-v2-direction" aria-label={t('directionDescription')}><span>{t('playDirection')}</span><i aria-hidden="true">→</i><b>{t('right')}</b></div> : null}
        {waitingPlayers.length && !me.waitingForNextRound ? <details className="game-v2-waiting-strip"><summary aria-label={t('waitingPlayerCount', { count: waitingPlayers.length })}><Clock3 size={16}/><span>{t('waitingPlayers')}</span><b>{waitingPlayers.length}</b></summary><div>{waitingPlayers.map((player) => {
          const ready = player.rematchReady || player.isBot
          return <div className="game-v2-waiting-person" key={player.id}><span aria-label={ready ? t('playerReadyStatus', { name: player.name }) : t('playerWaitingStatus', { name: player.name })}><bdi dir="auto">{player.name}</bdi><small>{ready ? t('readyForNextRound') : t('waitingForReadiness')}</small></span>{me.isHost ? <button className="game-v2-remove-waiting" type="button" disabled={Boolean(resultBusyAction) || !connected} onClick={() => removeWaiting(player)} aria-label={t('removeWaitingPlayer', { name: player.name })} title={t('removeWaitingPlayer', { name: player.name })}><X size={17}/></button> : null}</div>
        })}</div></details> : null}
        {liveReaction && !isResolving && !preferences.reactionsMuted ? <div className="game-v2-live-reaction" role="status"><b><bdi dir="auto">{liveReaction.playerId === me.id ? t('you') : liveReaction.playerName}</bdi></b><span>{reactionLabel(liveReaction.reaction, t)}</span></div> : null}
        <div className="game-v2-center" onKeyDown={(event) => { if (event.key === 'Escape' && explanationOpen) { event.preventDefault(); setExplanationOpen(false); explanationButtonRef.current?.focus() } }}>
          <div className="game-v2-piles"><div className="game-v2-waste" aria-label={t('cardsInWaste', { count: game.wasteCount })}><div className="game-v2-card-back"/><b>{game.wasteCount}<span>{t('waste')}</span></b></div><div className={`game-v2-trick ${isResolving ? 'is-resolved' : ''} ${isResolving && resolutionCountdown.milliseconds <= 240 ? 'is-clearing' : ''}`} aria-label={isResolving ? t('completedTrickLabel') : t('currentTrickLabel')}>{visibleTrick.length === 0 ? <div className="game-v2-empty-trick"><span aria-hidden="true">♠</span><p>{game.firstTrick ? t('aceOpens') : t('leadAnySuit')}</p></div> : visibleTrick.map((entry, index) => <div className={`game-v2-trick-card ${game.resolvedTrick?.lastPlayerId === entry.playerId ? 'is-last-played' : ''}`} key={`${entry.playerId}-${entry.card.id}`} style={{ '--trick-index': index } as CSSProperties}><PlayingCard card={entry.card} t={t} small/><span><bdi dir="auto">{entry.playerId === me.id ? t('you') : entry.playerName}</bdi></span></div>)}{isResolving && game.resolvedTrick ? <div className={`game-v2-resolution game-v2-resolution--${game.resolvedTrick.kind}`} aria-hidden="true"><Clock3 size={14}/><b>{resolutionCountdown.seconds}s</b></div> : null}</div></div>
          <p className="sr-only" aria-live="polite">{trickSummary}</p>
          {isReconnectPause ? <div className="game-v2-reconnect-banner" role="group" aria-label={t('disconnectedPaused', { name: reconnectPlayer?.name ?? t('player') })}><WifiOff size={21}/><div><b>{t('waitingReconnect', { name: reconnectPlayer?.name ?? t('player'), count: reconnectCountdown.seconds })}</b><span>{t('reconnectPaused')}</span></div>{me.isHost && reconnectPlayer ? <button type="button" disabled={Boolean(resultBusyAction) || !connected} onClick={replaceWithBot}>{resultBusyAction === 'replace-bot' ? <span className="spinner"/> : null}{t('replaceBot')}</button> : null}</div> : null}
          {!isReconnectPause ? <><span className="sr-only" aria-live="polite" aria-atomic="true">{statusLabel}. {tableMessage}</span><div ref={gameStatusRef} className={`game-v2-status ${isMyTurn ? 'is-mine' : ''} ${isThullaResolution ? 'is-thulla' : ''}`} tabIndex={-1}><div className="game-v2-status__copy">{explanationOpen ? <div className="game-v2-explanation"><p ref={explanationPanelRef} id="game-v2-explanation-copy" tabIndex={-1}>{lastExplanation}</p></div> : <><span>{statusLabel}</span><b>{tableMessage}</b></>}</div><div className="game-v2-status__actions">{game.phase === 'turn' && room.status === 'playing' && game.turnEndsAt !== null ? <TurnClock endsAt={game.turnEndsAt} duration={room.settings.turnSeconds * 1_000} t={t} alertForYou={isMyTurn} sound={preferences.sound} haptics={preferences.haptics}/> : null}{canReviewExplanation ? <button ref={explanationButtonRef} className="game-v2-explanation-toggle" type="button" aria-expanded={explanationOpen} aria-controls="game-v2-explanation-copy" aria-label={explanationOpen ? t('hideExplanation') : t('whatHappened')} title={explanationOpen ? t('hideExplanation') : t('whatHappened')} onClick={() => setExplanationOpen((value) => !value)}><Help size={17}/><span>{explanationOpen ? t('hideExplanation') : t('whatHappened')}</span></button> : null}</div></div></> : null}
        </div>
        {game.leadSuit && !isResolving ? <div className={`game-v2-lead game-v2-lead--${game.leadSuit}`}><span>{suitSymbol[game.leadSuit]}</span><b>{t('follow', { suit: localizedSuit(t, game.leadSuit) })}</b></div> : null}
        <MatchActivity items={game.activity} players={room.players} open={activityOpen} onToggle={() => setActivityOpen((value) => !value)} t={t}/>
      </section>
      {!me.waitingForNextRound && !isFinished ? <section id="game-v2-hand" className={`game-v2-hand ${!connected ? 'is-disconnected' : ''}`} aria-label={t('yourHand')} tabIndex={-1}>
        <div className="game-v2-hand__meta"><div><span>{t('yourHand')}</span><b>{t(game.hand.length === 1 ? 'card' : 'cards', { count: game.hand.length })}</b>{scrollHint ? <span className="game-v2-hand-scroll-hint" role="status">↔ {t('swipeHint')}</span> : null}</div>{me.escaped ? <span className="game-v2-safe"><Check size={17}/> {t('gotAway')}</span> : null}</div>
        <div ref={handRef} className={`game-v2-hand__scroller ${handOverflow ? 'has-overflow' : ''}`} onScroll={markHandScrolled}><div className="game-v2-hand__cards">{sortCards(game.hand).map((card) => { const legal = legalIds.has(card.id); return <PlayingCard key={card.id} card={card} t={t} interactive selectable={canAct && legal} selected={selectedCardId === card.id} unavailable={isMyTurn && connected && !legal} disabled={!canAct || !legal} onClick={() => setSelectedCardId(card.id === selectedCardId ? null : card.id)}/> })}{game.hand.length === 0 ? <div className="game-v2-empty-hand"><Check size={25}/><p>{me.escaped ? t('youGotAway') : t('powerOnTable')}</p></div> : null}</div></div>
        {!isResolving && !isReconnectPause ? <div className={`game-v2-action-bar ${game.canTakeRightHand && canAct ? 'has-take' : ''}`}><p>{!connected ? t('reconnectingServer') : isMyTurn ? selectedCard ? t('cardSelected', { rank: selectedCard.rank, suit: localizedSuit(t, selectedCard.suit) }) : game.canTakeRightHand ? t('leadOrTakePlayer', { name: takeTarget?.name ?? t('player') }) : t('chooseLegalCard') : t('waitingForPlayer', { name: currentPlayer?.name ?? t('player') })}</p><div className="game-v2-actions">{game.canTakeRightHand && takeTarget && canAct ? <button className="game-v2-button game-v2-button--take" type="button" disabled={taking || playing} onClick={() => setTakeConfirmOpen(true)}><HandCards size={19}/> {t('takeHand', { name: takeTarget.name, count: takeTarget.cardCount })}</button> : null}{selectedCard && canAct ? <button className="game-v2-button game-v2-button--primary" type="button" disabled={playing || taking} onClick={() => void playSelected()}>{playing ? <span className="spinner"/> : <Play size={19} fill="currentColor"/>} {t('playNamedCard', { card: `${selectedCard.rank}${suitSymbol[selectedCard.suit]}` })}</button> : null}</div></div> : null}
      </section> : me.waitingForNextRound && !isFinished ? <section id="game-v2-waiting-player" className="game-v2-waiting-player" tabIndex={-1} aria-labelledby="game-v2-waiting-title" aria-describedby="game-v2-waiting-copy game-v2-waiting-status"><div><span className="game-v2-eyebrow">{t('gameInProgress')}</span><h2 id="game-v2-waiting-title">{t('joinNextRoundTitle')}</h2><p id="game-v2-waiting-copy">{t('joinNextRoundBody', { count: me.joinedInRound, round: me.joinedInRound })}</p></div><div className="game-v2-waiting-player__actions"><span id="game-v2-waiting-status">{me.rematchReady ? <Check size={18}/> : <Clock3 size={18}/>} {me.rematchReady ? t('youAreReady') : t('youAreNotReady')}</span><button className={`game-v2-button ${me.rematchReady ? 'game-v2-button--secondary' : 'game-v2-button--primary'}`} type="button" aria-pressed={me.rematchReady} disabled={Boolean(resultBusyAction) || !connected} onClick={() => void resultAction('ready', 'game:rematch-ready', { ready: !me.rematchReady }, t('readyUpdateFailed'))}>{resultBusyAction === 'ready' ? <span className="spinner"/> : null}{me.rematchReady ? t('cancelReadiness') : t('markReadyForNextRound')}</button></div></section> : null}
    </div>
    {isFinished ? <RoundResult room={room} me={me} loser={loser} connected={connected} busyAction={resultBusyAction} t={t} onReady={() => void resultAction('ready', 'game:rematch-ready', { ready: !me.rematchReady }, t('readyUpdateFailed'))} onRestart={() => void resultAction('restart', 'game:start', {}, t('startFailed'))} onReset={resetSession} onRemoveWaiting={removeWaiting} onAddBot={() => void resultAction('add-bot', 'room:add-bot', {}, t('addBotFailed'))} onInvite={shareInvite} onLeave={onLeave}/> : null}
    {takeConfirmOpen && takeTarget ? <TakeHandDialog target={takeTarget} taking={taking} activeCount={activePlayers.filter((player) => !player.escaped).length} t={t} onCancel={() => setTakeConfirmOpen(false)} onConfirm={() => void takeRightHand()}/> : null}
    {preferenceOpen && !preferencesBlocked ? <PreferenceDialog language={language} t={t} preferences={preferences} isHost={me.isHost} chatSupported={chatSupported} chatMode={room.settings.chatMode} chatModeBusy={chatModeBusy} onLanguage={onLanguage} onPreference={onPreference} onChatMode={(chatMode) => void updateChatMode(chatMode)} onClose={() => setPreferenceOpen(false)}/> : null}
  </main>
}
