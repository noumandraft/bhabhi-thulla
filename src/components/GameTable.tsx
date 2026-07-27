import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode, type SVGProps } from 'react'
import type { Socket } from 'socket.io-client'
import { REACTIONS, sortCards, suitSymbol, type ActivityItem, type Card as CardType, type Reaction, type Suit } from '../../shared/game'
import type { Language, TFunction } from '../i18n'
import type { Preferences } from '../preferences'
import type { ClientPlayerView as Player, ClientRoomView, TableReaction } from '../protocol'
import { emitWithAck } from '../socket'
import { AccessibleDialog } from './AccessibleDialog'

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
const Play = (props: IconProps) => <Icon {...props}><path d="m7 4 13 8L7 20z"/></Icon>
const RotateCcw = (props: IconProps) => <Icon {...props}><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></Icon>
const Settings = (props: IconProps) => <Icon {...props}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6 1.7 1.7 0 0 0 10 3v-.2h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1z"/></Icon>
const Trophy = (props: IconProps) => <Icon {...props}><path d="M8 4h8v5a4 4 0 0 1-8 0zM8 6H4v2a4 4 0 0 0 4 4M16 6h4v2a4 4 0 0 1-4 4M12 13v5M8 21h8M9 18h6"/></Icon>
const Volume = (props: IconProps) => <Icon {...props}><path d="M11 5 6 9H2v6h4l5 4zM15 9a4 4 0 0 1 0 6M18 6a8 8 0 0 1 0 12"/></Icon>
const Wifi = (props: IconProps) => <Icon {...props}><path d="M5 12.6a10 10 0 0 1 14 0M2 9.3a15 15 0 0 1 20 0M8.5 16a5 5 0 0 1 7 0"/><circle cx="12" cy="20" r="1" fill="currentColor" stroke="none"/></Icon>
const WifiOff = (props: IconProps) => <Icon {...props}><path d="m2 2 20 20M8.5 16a5 5 0 0 1 5.7-.9M5 12.6a10 10 0 0 1 4-2M2 9.3A15 15 0 0 1 6 7M14 7a15 15 0 0 1 8 2.3"/><circle cx="12" cy="20" r="1" fill="currentColor" stroke="none"/></Icon>
const X = (props: IconProps) => <Icon {...props}><path d="M18 6 6 18M6 6l12 12"/></Icon>

function IconButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return <button className="game-v2-icon-button" type="button" aria-label={label} title={label} onClick={onClick}>{children}</button>
}

function GameLogo() {
  return <div className="game-v2-logo" aria-label="Bhabhi Thulla"><span className="game-v2-logo__cards" aria-hidden="true"><i>♠</i><i>♥</i></span><span><b>Bhabhi</b><strong>THULLA</strong></span></div>
}

function CardFace({ card }: { card: CardType }) {
  return <><span className="game-card__corner"><b>{card.rank}</b><i>{suitSymbol[card.suit]}</i></span><span className="game-card__suit" aria-hidden="true">{suitSymbol[card.suit]}</span><span className="game-card__corner game-card__corner--bottom" aria-hidden="true"><b>{card.rank}</b><i>{suitSymbol[card.suit]}</i></span></>
}

function localizedSuit(t: TFunction, suit: Suit): string {
  if (suit === 'spades') return t('suitSpades')
  if (suit === 'hearts') return t('suitHearts')
  if (suit === 'diamonds') return t('suitDiamonds')
  return t('suitClubs')
}

function PlayingCard({ card, t, interactive = false, selectable = false, selected = false, disabled = false, onClick, small = false }: {
  card: CardType; t: TFunction; interactive?: boolean; selectable?: boolean; selected?: boolean; disabled?: boolean; onClick?: () => void; small?: boolean
}) {
  const className = `game-card ${card.suit === 'hearts' || card.suit === 'diamonds' ? 'game-card--red' : ''} ${selectable ? 'game-card--selectable' : ''} ${selected ? 'is-selected' : ''} ${small ? 'game-card--small' : ''}`
  const cardName = t('cardName', { rank: card.rank, suit: localizedSuit(t, card.suit) })
  const label = selected ? t('selectedCardLabel', { card: cardName }) : cardName
  if (!interactive) return <div className={className} role="img" aria-label={label}><CardFace card={card}/></div>
  return <button type="button" className={className} disabled={disabled} onClick={onClick} aria-label={label} aria-pressed={selectable ? selected : undefined}><CardFace card={card}/></button>
}

function useCountdown(endsAt: number | null, active: boolean, expectedDuration: number, interval = 200) {
  const localEndsAt = useMemo(() => {
    if (!active || endsAt === null) return null
    const serverDelta = endsAt - Date.now()
    const tolerance = Math.max(1_000, expectedDuration * .15)
    const observedDuration = serverDelta > 0 && serverDelta <= expectedDuration + tolerance
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
  return <><span className={`game-v2-clock ${seconds <= 8 ? 'is-low' : ''}`} aria-hidden="true"><Clock3 size={16}/> {seconds}s</span><span className="sr-only" aria-live="polite">{announcement}</span></>
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
  return <article className={`game-v2-seat ${placement.className} ${isTurn ? 'is-turn' : ''} ${isRight ? 'is-right-player' : ''} ${player.escaped ? 'is-escaped' : ''} ${!player.connected ? 'is-offline' : ''}`} style={placement.style} aria-label={`${player.name}, ${status}${isRight ? `, ${t('nextRightSuffix')}` : ''}${isTurn ? `, ${t('currentTurnSuffix')}` : ''}`}>
    <div className="game-v2-seat__avatar" aria-hidden="true">{player.escaped ? <Check size={20} strokeWidth={3}/> : player.isBot ? 'AI' : initials}</div><div className="game-v2-seat__cards" aria-hidden="true"><i/><i/><i/></div><div className="game-v2-seat__copy"><b>{player.name}</b><span>{status}</span></div>{player.isHost ? <Crown className="game-v2-seat__host" size={15} aria-label={t('host')}/> : null}{isTurn ? <span className="game-v2-seat__turn">{t('turnLabel')}</span> : null}{isRight && !player.escaped ? <span className="game-v2-seat__right">{t('rightNext')}</span> : null}
  </article>
}

function activityText(item: ActivityItem, players: Player[], t: TFunction): string {
  const name = (key: string) => players.find((player) => player.id === item.data?.[key])?.name ?? t('player')
  if (item.kind === 'thulla') return t('activityThulla', { thulla: name('thullaPlayerId'), winner: name('winnerId'), count: Number(item.data?.cardCount ?? 0) })
  if (item.kind === 'take') return t('activityTake', { player: name('playerId'), target: name('targetId'), count: Number(item.data?.cardCount ?? 0) })
  if (item.kind === 'escape') return t('activityEscape', { player: name('playerId') })
  if (item.kind === 'round') return t('activityRound', { player: name('loserId') })
  if (item.kind === 'connection') {
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

function ReactionTray({ open, disabled, muted, t, onSend, onClose }: { open: boolean; disabled: boolean; muted: boolean; t: TFunction; onSend: (reaction: Reaction) => void; onClose: () => void }) {
  if (!open) return null
  return <ReactionPopover disabled={disabled} muted={muted} t={t} onSend={onSend} onClose={onClose}/>
}

function ReactionPopover({ disabled, muted, t, onSend, onClose }: Omit<Parameters<typeof ReactionTray>[0], 'open'>) {
  const closeRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null
    closeRef.current?.focus()
    return () => previousFocus?.focus()
  }, [])
  return <div id="game-v2-reaction-tray" className="game-v2-reaction-tray" role="group" aria-label={t('sendReaction')} onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); onClose() } }}><div><b>{muted ? t('reactionsMuted') : t('sendReaction')}</b><button ref={closeRef} type="button" onClick={onClose} aria-label={t('close')}><X size={17}/></button></div><div>{REACTIONS.map((reaction) => <button type="button" key={reaction} disabled={disabled} onClick={() => onSend(reaction)}>{reactionLabel(reaction, t)}</button>)}</div></div>
}

function PreferenceDialog({ language, t, preferences, onLanguage, onPreference, onClose }: { language: Language; t: TFunction; preferences: Preferences; onLanguage: (language: Language) => void; onPreference: <K extends keyof Preferences>(key: K, value: Preferences[K]) => void; onClose: () => void }) {
  return <AccessibleDialog labelId="preference-title" className="preference-sheet" onClose={onClose}><div className="sheet-header"><div><span className="game-v2-eyebrow">Bhabhi Thulla</span><h2 id="preference-title">{t('settings')}</h2></div><IconButton label={t('close')} onClick={onClose}><X size={21}/></IconButton></div><label className="preference-row"><span>{t('language')}</span><select value={language} onChange={(event) => onLanguage(event.target.value as Language)}><option value="en">{t('english')}</option><option value="roman">{t('romanUrdu')}</option><option value="ur">{t('urdu')}</option></select></label><label className="preference-row"><span><Volume size={18}/> {t('sound')}</span><input type="checkbox" checked={preferences.sound} onChange={(event) => onPreference('sound', event.target.checked)}/></label><label className="preference-row"><span><Wifi size={18}/> {t('haptics')}</span><input type="checkbox" checked={preferences.haptics} onChange={(event) => onPreference('haptics', event.target.checked)}/></label><label className="preference-row"><span><Message size={18}/> {t('muteReactions')}</span><input type="checkbox" checked={preferences.reactionsMuted} onChange={(event) => onPreference('reactionsMuted', event.target.checked)}/></label><button className="game-v2-button game-v2-button--primary game-v2-button--wide" type="button" onClick={onClose}>{t('save')}</button></AccessibleDialog>
}

function RoundResult({ room, me, loser, busy, t, onReady, onRestart, onReset }: { room: ClientRoomView; me: Player; loser?: Player; busy: boolean; t: TFunction; onReady: () => void; onRestart: () => void; onReset: () => void }) {
  const scores = room.session.scores
  const allReady = room.players.filter((player) => player.isBot || player.connected).every((player) => player.isBot || player.rematchReady)
  const dialogRef = useRef<HTMLDivElement>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null
    headingRef.current?.focus()
    return () => previousFocus?.focus()
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
  return <div className="game-v2-result"><div ref={dialogRef} className="game-v2-result__card" role="dialog" aria-modal="true" aria-labelledby="round-result-title" onKeyDown={trapFocus}><span className="sr-only" role="status" aria-live="assertive">{t('roundResultAnnouncement', { result: resultTitle })}</span><span className="game-v2-result__mark" aria-hidden="true">B</span><span className="game-v2-eyebrow">{t('roundOver')} · {t('round', { count: room.session.roundNumber })}</span><h2 ref={headingRef} id="round-result-title" tabIndex={-1}>{resultTitle}</h2><div className="game-v2-scoreboard" aria-label={t('sessionScore')}><div><b>{t('sessionScore')}</b><Trophy size={18}/></div>{scores.map((score) => <p key={score.playerId}><span>{score.playerName}</span><b>{score.escapes} {t('gotAway')}</b><em>{score.bhabhiCount} {t('bhabhi')}</em></p>)}</div><div className="game-v2-rematch-status">{room.players.map((player) => <span key={player.id} className={player.isBot || player.rematchReady ? 'is-ready' : ''}><Check size={14}/> {player.name}</span>)}</div><button className={`game-v2-button ${me.rematchReady ? 'game-v2-button--secondary' : 'game-v2-button--primary'} game-v2-button--wide`} type="button" disabled={busy} onClick={onReady}>{me.rematchReady ? t('notReady') : t('rematchReady')}</button>{me.isHost && allReady ? <button className="game-v2-button game-v2-button--primary game-v2-button--wide" type="button" disabled={busy} onClick={onRestart}><RotateCcw size={19}/> {t('playAnother')}</button> : <p className="game-v2-result__wait">{t('waitingRematch')}</p>}{me.isHost ? <button className="game-v2-reset" type="button" disabled={busy} onClick={onReset}>{t('resetSession')}</button> : null}</div></div>
}

function playAttentionTone(frequency = 660) {
  try {
    const AudioContextClass = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AudioContextClass) return
    const context = new AudioContextClass(); const oscillator = context.createOscillator(); const gain = context.createGain()
    oscillator.frequency.value = frequency; gain.gain.setValueAtTime(.0001, context.currentTime); gain.gain.exponentialRampToValueAtTime(.11, context.currentTime + .02); gain.gain.exponentialRampToValueAtTime(.0001, context.currentTime + .22); oscillator.connect(gain); gain.connect(context.destination); oscillator.start(); oscillator.stop(context.currentTime + .24); oscillator.addEventListener('ended', () => void context.close())
  } catch { /* Browser may require a prior interaction. */ }
}

export default function GameTable({ room, socket, connected, t, language, onLanguage, preferences, onPreference, liveReaction, onOpenRules, onLeave, onToast }: {
  room: ClientRoomView; socket: Socket; connected: boolean; t: TFunction; language: Language; onLanguage: (language: Language) => void; preferences: Preferences; onPreference: <K extends keyof Preferences>(key: K, value: Preferences[K]) => void; liveReaction: TableReaction | null; onOpenRules: () => void; onLeave: () => void; onToast: (message: string) => void
}) {
  const game = room.game!
  const me = room.players.find((player) => player.isYou)!
  const currentPlayer = room.players.find((player) => player.id === game.currentTurnId)
  const reconnectPlayer = room.players.find((player) => player.id === game.reconnectPlayerId)
  const loser = room.players.find((player) => player.id === game.loserId)
  const takeTarget = room.players.find((player) => player.id === game.takeTargetId)
  const opponents = useMemo(() => orderedOpponents(room.players, me.id), [room.players, me.id])
  const rightPlayer = opponents.find((player) => !player.escaped)
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null)
  const [playing, setPlaying] = useState(false)
  const [taking, setTaking] = useState(false)
  const [takeConfirmOpen, setTakeConfirmOpen] = useState(false)
  const [activityOpen, setActivityOpen] = useState(false)
  const [reactionOpen, setReactionOpen] = useState(false)
  const [preferenceOpen, setPreferenceOpen] = useState(false)
  const [explanationOpen, setExplanationOpen] = useState(false)
  const [lastExplanation, setLastExplanation] = useState('')
  const [resultBusy, setResultBusy] = useState(false)
  const opponentsRef = useRef<HTMLDivElement>(null)
  const handRef = useRef<HTMLDivElement>(null)
  const explanationButtonRef = useRef<HTMLButtonElement>(null)
  const explanationPanelRef = useRef<HTMLParagraphElement>(null)
  const explanationPreviousFocus = useRef<HTMLElement | null>(null)
  const [scrollHint, setScrollHint] = useState(false)
  const legalIds = useMemo(() => new Set(game.legalCardIds), [game.legalCardIds])
  const isResolving = game.phase === 'resolving'
  const isReconnectPause = game.phase === 'waiting_for_reconnect'
  const isMyTurn = game.phase === 'turn' && game.currentTurnId === me.id
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

  useEffect(() => { if (selectedCardId && (!game.hand.some((card) => card.id === selectedCardId) || !legalIds.has(selectedCardId) || !isMyTurn)) setSelectedCardId(null) }, [game.hand, legalIds, selectedCardId, isMyTurn])
  useEffect(() => { if (!game.canTakeRightHand || !isMyTurn) setTakeConfirmOpen(false) }, [game.canTakeRightHand, isMyTurn])
  useEffect(() => { if (!isResolving && game.trick.length > 0) setExplanationOpen(false) }, [isResolving, game.trick.length])
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
    if (preferences.scrollHintSeen) return
    const update = () => setScrollHint(Boolean((opponentsRef.current && opponentsRef.current.scrollWidth > opponentsRef.current.clientWidth + 8) || (handRef.current && handRef.current.scrollWidth > handRef.current.clientWidth + 8)))
    update(); window.addEventListener('resize', update); return () => window.removeEventListener('resize', update)
  }, [opponents.length, game.hand.length, preferences.scrollHintSeen])

  function markScrolled() { if (!preferences.scrollHintSeen) onPreference('scrollHintSeen', true); setScrollHint(false) }
  async function playSelected() { if (!selectedCardId || !isMyTurn) return; setPlaying(true); const response = await emitWithAck(socket, 'game:play', { cardId: selectedCardId }); setPlaying(false); if (!response.ok) onToast(response.error ?? t('cardPlayFailed')); else setSelectedCardId(null) }
  async function takeRightHand() { if (!game.canTakeRightHand || !takeTarget || !isMyTurn) return; setTaking(true); const response = await emitWithAck(socket, 'game:take-right', {}); setTaking(false); setTakeConfirmOpen(false); if (!response.ok) onToast(response.error ?? t('takeFailed')); else onToast(t('takeSuccess', { name: takeTarget.name })) }
  async function copyRoomCode() { try { await navigator.clipboard.writeText(room.code); onToast(t('roomCodeCopied')) } catch { onToast(`${t('roomCode')}: ${room.code}`) } }
  async function sendReaction(reaction: Reaction) { const response = await emitWithAck(socket, 'room:react', { reaction }); setReactionOpen(false); if (!response.ok) onToast(response.error ?? t('reactionFailed')) }
  async function resultAction(event: string, payload: unknown = {}) { setResultBusy(true); const response = await emitWithAck(socket, event, payload); setResultBusy(false); if (!response.ok) onToast(response.error ?? t('roundUpdateFailed')) }
  function resetSession() { if (window.confirm(t('resetConfirm'))) void resultAction('game:reset-session') }

  let tableMessage: string
  if (isReconnectPause) tableMessage = t('activityReconnectWait', { player: reconnectPlayer?.name ?? t('player') })
  else if (isResolving && game.resolvedTrick?.kind === 'thulla') tableMessage = t('thullaResult', { last: resolvedLastPlayer?.name ?? t('player'), winner: resolvedWinner?.name ?? t('player') })
  else if (isResolving && game.resolvedTrick?.kind === 'opening') tableMessage = t('openingResult', { winner: resolvedWinner?.name ?? t('player') })
  else if (isResolving && game.resolvedTrick?.kind === 'clean') tableMessage = t('cleanResult', { winner: resolvedWinner?.name ?? t('player') })
  else if (game.firstTrick) tableMessage = game.trick.length === 0 ? t('aceSpadesOpens') : t('openingEveryone')
  else if (isMyTurn) tableMessage = game.canTakeRightHand ? t('leadOrTake') : t('chooseLegalCard')
  else tableMessage = t('playerThinking', { name: currentPlayer?.name ?? t('player') })
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

  return <main className="game-v2-shell">
    <a className="game-v2-skip" href="#game-v2-hand">{t('skipToHand')}</a>
    <header className="game-v2-header"><GameLogo/><button className="game-v2-room" type="button" onClick={() => void copyRoomCode()} aria-label={t('copyRoomCode', { code: room.code })}><span>{t('room')}</span><b>{room.code}</b><Copy size={16}/></button><div className="game-v2-header__actions"><span className={`game-v2-connection ${connected ? 'is-online' : ''}`} role="status" aria-label={connected ? t('connectedServer') : t('reconnectingServer')}>{connected ? <Wifi size={17}/> : <WifiOff size={17}/>}<span>{connected ? t('live') : t('reconnecting')}</span></span><IconButton label={t('settings')} onClick={() => setPreferenceOpen(true)}><Settings size={21}/></IconButton><IconButton label={t('howToPlay')} onClick={onOpenRules}><BookOpen size={21}/></IconButton><IconButton label={t('leaveTable')} onClick={onLeave}><LogOut size={21}/></IconButton></div></header>
    <div className="game-v2-layout">
      <section className={`game-v2-table ${isResolving ? 'has-resolved' : ''} ${isReconnectPause ? 'is-paused' : ''}`} aria-label={t('cardTable')}>
        <div ref={opponentsRef} className="game-v2-opponents" data-count={opponents.length} aria-label={t('otherPlayers')} onScroll={markScrolled}>{opponents.map((player, index) => <OpponentSeat key={player.id} player={player} isTurn={player.id === game.currentTurnId} isRight={player.id === rightPlayer?.id} placement={seatPlacement(index, opponents.length)} t={t}/>)}</div>
        <div className="game-v2-direction" aria-label={t('directionDescription')}><span>{t('playDirection')}</span><i aria-hidden="true">→</i><b>{t('right')}</b></div>
        {scrollHint ? <div className="game-v2-scroll-hint" role="status">↔ {t('swipeHint')}</div> : null}
        {liveReaction && !preferences.reactionsMuted ? <div className="game-v2-live-reaction" role="status"><b>{liveReaction.playerId === me.id ? t('you') : liveReaction.playerName}</b><span>{reactionLabel(liveReaction.reaction, t)}</span></div> : null}
        <div className="game-v2-center">
          {isResolving && game.resolvedTrick?.kind === 'thulla' ? <div className="game-v2-event"><b>THULLA!</b><span>{tableMessage}</span></div> : null}
          {isReconnectPause ? <div className="game-v2-reconnect-banner" role="group" aria-label={t('disconnectedPaused', { name: reconnectPlayer?.name ?? t('player') })}><WifiOff size={21}/><div><b aria-hidden="true">{t('waitingReconnect', { name: reconnectPlayer?.name ?? t('player'), count: reconnectCountdown.seconds })}</b><span>{t('reconnectPaused')}</span></div>{me.isHost && reconnectPlayer ? <button type="button" disabled={resultBusy} onClick={() => void resultAction('game:replace-with-bot', { playerId: reconnectPlayer.id })}>{t('replaceBot')}</button> : null}</div> : null}
          <div className="game-v2-piles"><div className="game-v2-waste" aria-label={t('cardsInWaste', { count: game.wasteCount })}><div className="game-v2-card-back"/><b>{game.wasteCount}<span>{t('waste')}</span></b></div><div className={`game-v2-trick ${isResolving ? 'is-resolved' : ''} ${isResolving && resolutionCountdown.milliseconds <= 240 ? 'is-clearing' : ''}`} aria-label={isResolving ? t('completedTrickLabel') : t('currentTrickLabel')}>{visibleTrick.length === 0 ? <div className="game-v2-empty-trick"><span aria-hidden="true">♠</span><p>{game.firstTrick ? t('aceOpens') : t('leadAnySuit')}</p></div> : visibleTrick.map((entry, index) => <div className={`game-v2-trick-card ${game.resolvedTrick?.lastPlayerId === entry.playerId ? 'is-last-played' : ''}`} key={`${entry.playerId}-${entry.card.id}`} style={{ '--trick-index': index } as CSSProperties}><PlayingCard card={entry.card} t={t} small/><span>{entry.playerId === me.id ? t('you') : entry.playerName}</span></div>)}{isResolving && game.resolvedTrick ? <div className={`game-v2-resolution game-v2-resolution--${game.resolvedTrick.kind}`}><span>{game.resolvedTrick.kind === 'thulla' ? 'THULLA' : game.resolvedTrick.kind === 'opening' ? t('openingCleared') : t('trickComplete')}</span><b aria-hidden="true">{t('resolving', { count: resolutionCountdown.seconds })}</b></div> : null}</div></div>
          <p className="sr-only" aria-live="polite">{trickSummary}</p>
          <div className={`game-v2-status ${isMyTurn ? 'is-mine' : ''}`} aria-live="polite"><div><span>{isResolving ? t('nextTrick') : isReconnectPause ? t('reconnecting') : isMyTurn ? t('yourTurn') : game.firstTrick ? t('openingTrick') : t('currentTurn')}</span><b>{tableMessage}</b></div>{game.phase === 'turn' && room.status === 'playing' && game.turnEndsAt !== null ? <TurnClock endsAt={game.turnEndsAt} duration={room.settings.turnSeconds * 1_000} t={t} alertForYou={isMyTurn} sound={preferences.sound} haptics={preferences.haptics}/> : null}</div>
          {canReviewExplanation ? <div className="game-v2-explanation" onKeyDown={(event) => { if (event.key === 'Escape' && explanationOpen) { event.preventDefault(); setExplanationOpen(false) } }}><button ref={explanationButtonRef} type="button" aria-expanded={explanationOpen} aria-controls="game-v2-explanation-copy" onClick={() => setExplanationOpen((value) => !value)}><Help size={17}/> {explanationOpen ? t('hideExplanation') : t('whatHappened')}</button>{explanationOpen ? <p ref={explanationPanelRef} id="game-v2-explanation-copy" tabIndex={-1}>{lastExplanation}</p> : null}</div> : null}
        </div>
        {game.leadSuit && !isResolving ? <div className={`game-v2-lead game-v2-lead--${game.leadSuit}`}><span>{suitSymbol[game.leadSuit]}</span><b>{t('follow', { suit: localizedSuit(t, game.leadSuit) })}</b></div> : null}
        <div className="game-v2-social-actions"><button type="button" className="game-v2-reaction-toggle" disabled={!room.settings.reactionsEnabled} aria-expanded={reactionOpen} aria-controls="game-v2-reaction-tray" onClick={() => setReactionOpen((value) => !value)}><Message size={17}/> {t('reactionsLabel')}</button></div>
        <ReactionTray open={reactionOpen} disabled={!room.settings.reactionsEnabled} muted={preferences.reactionsMuted} t={t} onSend={(reaction) => void sendReaction(reaction)} onClose={() => setReactionOpen(false)}/>
        <MatchActivity items={game.activity} players={room.players} open={activityOpen} onToggle={() => setActivityOpen((value) => !value)} t={t}/>
        {room.status === 'finished' ? <RoundResult room={room} me={me} loser={loser} busy={resultBusy} t={t} onReady={() => void resultAction('game:rematch-ready', { ready: !me.rematchReady })} onRestart={() => void resultAction('game:start')} onReset={resetSession}/> : null}
      </section>
      <section id="game-v2-hand" className="game-v2-hand" aria-label={t('yourHand')} tabIndex={-1}><div className="game-v2-hand__meta"><div><span>{t('yourHand')}</span><b>{t(game.hand.length === 1 ? 'card' : 'cards', { count: game.hand.length })}</b></div>{me.escaped ? <span className="game-v2-safe"><Check size={17}/> {t('gotAway')}</span> : isMyTurn ? <span className="game-v2-your-turn">{t('yourTurn')}</span> : null}</div><div ref={handRef} className="game-v2-hand__scroller" onScroll={markScrolled}><div className="game-v2-hand__cards">{sortCards(game.hand).map((card) => { const legal = legalIds.has(card.id); return <PlayingCard key={card.id} card={card} t={t} interactive selectable={isMyTurn && legal} selected={selectedCardId === card.id} disabled={!isMyTurn || !legal || room.status !== 'playing'} onClick={() => setSelectedCardId(card.id === selectedCardId ? null : card.id)}/> })}{game.hand.length === 0 ? <div className="game-v2-empty-hand"><Check size={25}/><p>{me.escaped ? t('youGotAway') : t('powerOnTable')}</p></div> : null}</div></div><div className={`game-v2-action-bar ${game.canTakeRightHand && isMyTurn ? 'has-take' : ''}`}><p>{isResolving ? t('resolving', { count: resolutionCountdown.seconds }) : isReconnectPause ? t('waitingReconnect', { name: reconnectPlayer?.name ?? t('player'), count: reconnectCountdown.seconds }) : isMyTurn ? selectedCard ? t('cardSelected', { rank: selectedCard.rank, suit: localizedSuit(t, selectedCard.suit) }) : game.canTakeRightHand ? t('leadOrTakePlayer', { name: takeTarget?.name ?? t('player') }) : t('chooseLegalCard') : t('waitingForPlayer', { name: currentPlayer?.name ?? t('player') })}</p><div className="game-v2-actions">{game.canTakeRightHand && takeTarget && isMyTurn ? <button className="game-v2-button game-v2-button--take" type="button" disabled={taking || playing} onClick={() => setTakeConfirmOpen(true)}><HandCards size={19}/> {t('takeHand', { name: takeTarget.name, count: takeTarget.cardCount })}</button> : null}<button className="game-v2-button game-v2-button--primary" type="button" disabled={!selectedCard || !isMyTurn || playing || taking} onClick={() => void playSelected()}>{playing ? <span className="spinner"/> : <Play size={19} fill="currentColor"/>} {selectedCard ? t('playNamedCard', { card: `${selectedCard.rank}${suitSymbol[selectedCard.suit]}` }) : t('selectCard')}</button></div></div></section>
    </div>
    {takeConfirmOpen && takeTarget ? <TakeHandDialog target={takeTarget} taking={taking} activeCount={room.players.filter((player) => !player.escaped).length} t={t} onCancel={() => setTakeConfirmOpen(false)} onConfirm={() => void takeRightHand()}/> : null}
    {preferenceOpen ? <PreferenceDialog language={language} t={t} preferences={preferences} onLanguage={onLanguage} onPreference={onPreference} onClose={() => setPreferenceOpen(false)}/> : null}
  </main>
}
