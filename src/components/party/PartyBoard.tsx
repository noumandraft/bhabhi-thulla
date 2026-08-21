import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type SVGProps } from 'react'
import QRCode from 'qrcode'
import { suitSymbol, type PartyBoardPlayerView, type PartyBoardView, type Reaction, type ReactionEvent } from '../../../shared/game'
import type { Language, TFunction, TranslationKey } from '../../i18n'
import { GameCard } from '../game/GameCard'
import { usePartyBoard, type PartyBoardConnection, type PartyBoardConnectionStatus } from './usePartyBoard'
import {
  clearBoardCodeFromUrl,
  readPartyBoardSoundPreference,
  savePartyBoardSoundPreference,
} from './partyStorage'
import { usePartyWakeLock } from './usePartyWakeLock'

type IconProps = SVGProps<SVGSVGElement> & { size?: number }
function Icon({ size = 24, children, ...props }: IconProps & { children: ReactNode }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>{children}</svg>
}
const ArrowLeft = (props: IconProps) => <Icon {...props}><path d="m15 18-6-6 6-6"/></Icon>
const Check = (props: IconProps) => <Icon {...props}><path d="m5 12 4 4L19 6"/></Icon>
const Crown = (props: IconProps) => <Icon {...props}><path d="m3 6 4 5 5-7 5 7 4-5-2 12H5z"/></Icon>
const Expand = (props: IconProps) => <Icon {...props}><path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5"/></Icon>
const Monitor = (props: IconProps) => <Icon {...props}><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></Icon>
const Refresh = (props: IconProps) => <Icon {...props}><path d="M20 12a8 8 0 1 1-2.3-5.7L20 8"/><path d="M20 3v5h-5"/></Icon>
const Smartphone = (props: IconProps) => <Icon {...props}><rect x="5" y="2" width="14" height="20" rx="2"/><path d="M12 18h.01"/></Icon>
const Volume2 = (props: IconProps) => <Icon {...props}><path d="M11 5 6 9H2v6h4l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/></Icon>
const VolumeX = (props: IconProps) => <Icon {...props}><path d="M11 5 6 9H2v6h4l5 4z"/><path d="m22 9-6 6M16 9l6 6"/></Icon>
const WifiOff = (props: IconProps) => <Icon {...props}><path d="m2 2 20 20M8.5 16a5 5 0 0 1 5.7-.9M5 12.6a10 10 0 0 1 4-2M2 9.3A15 15 0 0 1 6 7M14 7a15 15 0 0 1 8 2.3"/></Icon>

type BoardSoundKind = 'enabled' | 'reaction' | 'thulla' | 'round'

interface AudioWindow extends Window {
  webkitAudioContext?: typeof AudioContext
}

let boardAudioContext: AudioContext | null = null

function playBoardTone(kind: BoardSoundKind): void {
  const AudioContextClass = window.AudioContext ?? (window as AudioWindow).webkitAudioContext
  if (!AudioContextClass) return
  try {
    boardAudioContext ??= new AudioContextClass()
    const context = boardAudioContext
    if (context.state === 'suspended') void context.resume()
    const now = context.currentTime
    const notes = kind === 'thulla' ? [220, 330] : kind === 'round' ? [440, 660] : kind === 'reaction' ? [560] : [480]
    notes.forEach((frequency, index) => {
      const start = now + index * .11
      const oscillator = context.createOscillator()
      const gain = context.createGain()
      oscillator.type = 'sine'
      oscillator.frequency.setValueAtTime(frequency, start)
      gain.gain.setValueAtTime(.0001, start)
      gain.gain.exponentialRampToValueAtTime(.055, start + .018)
      gain.gain.exponentialRampToValueAtTime(.0001, start + .12)
      oscillator.connect(gain).connect(context.destination)
      oscillator.start(start)
      oscillator.stop(start + .13)
    })
  } catch {
    // Audio is optional; unsupported or blocked playback must not interrupt the board.
  }
}

function reactionLabel(reaction: Reaction, t: TFunction): string {
  const keys: Record<Reaction, TranslationKey> = {
    thulla: 'reactionThulla', wah: 'reactionWah', oye: 'reactionOye', chalo: 'reactionChalo',
    'bach-gaya': 'reactionBachGaya', 'good-move': 'reactionGoodMove',
  }
  return t(keys[reaction])
}

function BoardLogo() {
  return <div className="party-board__brand" aria-label="Bhabhi Thulla Party Mode"><span aria-hidden="true">♥</span><div><b>Bhabhi</b><strong>THULLA</strong></div><i>PARTY</i></div>
}

function BoardLanguage({ language, onLanguage, t }: { language: Language; onLanguage: (language: Language) => void; t: TFunction }) {
  return <label className="party-board__language"><span className="sr-only">{t('language')}</span><select value={language} onChange={(event) => onLanguage(event.target.value as Language)} aria-label={t('language')}><option value="en">EN</option><option value="roman">RU</option><option value="ur">اردو</option></select></label>
}

function useBoardClock(target: number | null | undefined, serverNow: number, duration: number): number {
  const [remaining, setRemaining] = useState(0)
  useEffect(() => {
    if (!target) { setRemaining(0); return }
    const offset = serverNow - Date.now()
    const update = () => setRemaining(Math.max(0, Math.min(duration, Math.ceil((target - (Date.now() + offset)) / 1_000))))
    update()
    const interval = window.setInterval(update, 250)
    return () => window.clearInterval(interval)
  }, [duration, serverNow, target])
  return remaining
}

type RadialSeatStyle = CSSProperties & {
  '--party-seat-x': string
  '--party-seat-y': string
  '--party-seat-x-compact': string
  '--party-seat-y-compact': string
  '--party-seat-order': number
}

function radialSeatStyle(index: number, total: number): RadialSeatStyle {
  const angle = -Math.PI / 2 + (Math.PI * 2 * index) / Math.max(total, 1)
  const cosine = Math.cos(angle)
  const sine = Math.sin(angle)
  return {
    '--party-seat-x': `${(50 + cosine * 42).toFixed(3)}%`,
    '--party-seat-y': `${(50 + sine * 38).toFixed(3)}%`,
    '--party-seat-x-compact': `${(50 + cosine * 34).toFixed(3)}%`,
    '--party-seat-y-compact': `${(50 + sine * 38).toFixed(3)}%`,
    '--party-seat-order': index,
  }
}

function PlayerTile({ player, current, loser, t }: { player: PartyBoardPlayerView; current?: boolean; loser?: boolean; t: TFunction }) {
  const initials = player.name.split(/\s+/).filter(Boolean).map((part) => part[0]).join('').slice(0, 2).toUpperCase()
  const state = loser ? t('partyBhabhi') : player.escaped ? t('safe') : player.reconnecting || !player.connected ? t('reconnecting') : player.waitingForNextRound ? t('watchingTable') : t('cards', { count: player.cardCount })
  return <article className={`party-player ${current ? 'is-current' : ''} ${player.escaped ? 'is-safe' : ''} ${!player.connected ? 'is-offline' : ''} ${loser ? 'is-loser' : ''}`} data-player-id={player.id}>
    <span className="party-player__avatar">{player.isBot ? 'AI' : initials}</span>
    <div className="party-player__copy"><b><bdi dir="auto">{player.name}</bdi></b><span>{state}</span></div>
    {player.isHost ? <Crown className="party-player__host" size={19}/> : null}
    {current ? <span className="party-player__turn">{t('currentTurn')}</span> : null}
  </article>
}

function EmptySeat({ t }: { t: TFunction }) {
  return <div className="party-player party-player--empty"><span>+</span><b>{t('openSeat')}</b></div>
}

function QrJoin({ code, t, compact = false }: { code: string; t: TFunction; compact?: boolean }) {
  const joinUrl = useMemo(() => {
    const url = new URL('/', window.location.origin)
    url.searchParams.set('room', code)
    url.searchParams.set('mode', 'party')
    return url.toString()
  }, [code])
  const [src, setSrc] = useState('')
  useEffect(() => {
    let active = true
    void QRCode.toDataURL(joinUrl, { width: compact ? 196 : 320, margin: 3, color: { dark: '#062f28', light: '#fffdf5' }, errorCorrectionLevel: 'M' })
      .then((value) => { if (active) setSrc(value) })
    return () => { active = false }
  }, [compact, joinUrl])

  return <div className={`party-qr ${compact ? 'party-qr--compact' : ''}`}>
    <div className="party-qr__image">{src ? <img src={src} alt={t('scanQrAlt', { code })}/> : <span className="spinner spinner--large"/>}</div>
    <div className="party-qr__copy"><span><Smartphone size={22}/> {t('scanToJoin')}</span><b dir="ltr">{code}</b><small>{t('enterCodeFallback')}</small></div>
  </div>
}

function BoardLobby({ view, t }: { view: PartyBoardView; t: TFunction }) {
  const connectedPlayers = view.players.filter((player) => player.connected || player.isBot)
  const readyCount = connectedPlayers.filter((player) => player.isBot || player.ready).length
  const emptyCount = Math.max(0, Math.min(3, view.minPlayers - view.players.length))
  return <main className="party-board__lobby" aria-labelledby="party-board-title">
    <section className="party-board__join-panel">
      <span className="party-board__eyebrow"><Monitor size={21}/> {t('sharedScreen')}</span>
      <h1 id="party-board-title">{t('joinWithPhones')}</h1>
      <p>{t('joinWithPhonesBody')}</p>
      <QrJoin code={view.code} t={t}/>
      <p className="party-board__privacy"><Check size={20}/> {t('cardsStayPrivate')}</p>
    </section>
    <section className="party-board__roster" aria-labelledby="party-players-title">
      <div className="party-board__section-heading"><div><span>{t('partyPlayers')}</span><h2 id="party-players-title">{t('playersJoined', { count: view.players.length, total: view.maxPlayers })}</h2></div><b>{readyCount}/{Math.max(view.minPlayers, connectedPlayers.length)} {t('ready')}</b></div>
      <div className="party-board__players">{view.players.map((player) => <PlayerTile key={player.id} player={player} t={t}/>)}{Array.from({ length: emptyCount }, (_, index) => <EmptySeat key={index} t={t}/>)}</div>
      <div className="party-board__lobby-status" role="status" aria-live="polite"><span className="live-dot"/><div><b>{view.players.length < view.minPlayers ? t('waitingForPhones') : readyCount < connectedPlayers.length ? t('waitingForReadiness') : t('readyToDeal')}</b><small>{view.players.length ? t('hostControlsOnPhone') : t('firstPhoneHost')}</small></div></div>
    </section>
  </main>
}

function BoardGame({ view, t }: { view: PartyBoardView; t: TFunction }) {
  const game = view.game!
  const resolving = game.phase === 'resolving'
  const visibleTrick = resolving && game.resolvedTrick ? game.resolvedTrick.cards : game.trick
  const turnRemaining = useBoardClock(game.turnEndsAt, view.serverNow, view.settings.turnSeconds)
  const resolveRemaining = useBoardClock(game.resolutionEndsAt, view.serverNow, 3)
  const reconnectRemaining = useBoardClock(game.reconnectEndsAt, view.serverNow, view.settings.reconnectGraceSeconds)
  const currentPlayer = view.players.find((player) => player.id === game.currentTurnId)
  const winner = view.players.find((player) => player.id === game.resolvedTrick?.winnerId)
  const last = view.players.find((player) => player.id === game.resolvedTrick?.lastPlayerId)
  const resultText = resolving && game.resolvedTrick?.kind === 'thulla'
    ? t('thullaResult', { last: last?.name ?? t('player'), winner: winner?.name ?? t('player') })
    : resolving && game.resolvedTrick?.kind === 'opening'
      ? t('openingResult', { winner: winner?.name ?? t('player') })
      : resolving
        ? t('cleanResult', { winner: winner?.name ?? t('player') })
        : game.phase === 'waiting_for_reconnect'
          ? t('waitingReconnect', { name: view.players.find((player) => player.id === game.reconnectPlayerId)?.name ?? t('player'), count: reconnectRemaining })
          : game.firstTrick ? t('openingEveryone') : currentPlayer ? t('playerThinking', { name: currentPlayer.name }) : t('tableClear')

  return <main className={`party-board__game ${resolving ? 'is-resolving' : ''}`} data-player-count={view.players.length}>
    <section className="party-board__table" aria-label={t('cardTable')} data-seat-count={view.players.length}>
      <div className="party-board__orbit" aria-hidden="true"/>
      <div className="party-board__seat-ring" role="list" aria-label={`${t('partyPlayers')}: ${view.players.length}`}>
        {view.players.map((player, index) => <div
          className="party-board__radial-seat"
          data-seat-index={index}
          data-player-id={player.id}
          role="listitem"
          style={radialSeatStyle(index, view.players.length)}
          key={player.id}
        ><PlayerTile player={player} current={player.id === game.currentTurnId} t={t}/></div>)}
      </div>
      <div className="party-board__direction"><span>{t('playDirection')}</span><b>→ {t('right')}</b></div>
      <div className="party-board__waste" aria-label={t('cardsInWaste', { count: game.wasteCount })}><span className="party-card-back"/><b>{game.wasteCount}</b><small>{t('waste')}</small></div>
      <div className="party-board__trick" aria-label={resolving ? t('completedTrickLabel') : t('currentTrickLabel')}>
        {visibleTrick.length ? visibleTrick.map((entry, index) => <div className="party-board__played-card" style={{ '--party-card-index': index - (visibleTrick.length - 1) / 2 } as CSSProperties} key={`${entry.playerId}-${entry.card.id}`}><GameCard card={entry.card} t={t}/><b><bdi dir="auto">{entry.playerName}</bdi></b></div>) : <div className="party-board__lead"><span>{game.leadSuit ? suitSymbol[game.leadSuit] : '♠'}</span><b>{game.leadSuit ? t('follow', { suit: game.leadSuit }) : t('leadAnySuit')}</b></div>}
      </div>
      <div className={`party-board__status ${game.resolvedTrick?.kind === 'thulla' ? 'is-thulla' : ''}`}><span className="sr-only" role="status" aria-live="polite" aria-atomic="true">{resultText}</span><div><span>{resolving ? game.resolvedTrick?.kind === 'thulla' ? 'THULLA!' : t('trickComplete') : game.firstTrick ? t('openingTrick') : t('currentTurn')}</span><b>{resultText}</b></div>{resolving ? <time role="timer" aria-live="off" aria-label={t('secondsRemaining', { count: resolveRemaining })}>{resolveRemaining}s</time> : game.phase === 'turn' ? <time role="timer" aria-live="off" aria-label={t('secondsRemaining', { count: turnRemaining })}>{turnRemaining}s</time> : null}</div>
    </section>
  </main>
}

function BoardResults({ view, t }: { view: PartyBoardView; t: TFunction }) {
  const loser = view.players.find((player) => player.id === view.game?.loserId)
  const scores = [...view.session.scores].sort((a, b) => b.escapes - a.escapes || a.bhabhiCount - b.bhabhiCount)
  const ready = view.players.filter((player) => player.isBot || player.rematchReady).length
  return <main className="party-board__results" aria-labelledby="party-result-title">
    <section className="party-board__result-hero"><span className="party-board__result-cards" aria-hidden="true">♠ ♥</span><span className="party-board__eyebrow">{t('roundOver')}</span><h1 id="party-result-title">{loser ? t('playerIsBhabhi', { name: loser.name }) : t('roundOver')}</h1><p>{t('playersChooseRematch')}</p><div className="party-board__rematch-status"><span>{ready}/{view.players.length}</span><b>{t('readyForNextRound')}</b></div></section>
    <section className="party-board__scoreboard"><div className="party-board__section-heading"><div><span>{t('sessionScore')}</span><h2>{t('round', { count: view.session.roundNumber })}</h2></div></div>{scores.map((score, index) => <div className="party-board__score" key={score.playerId}><span>{index + 1}</span><b><bdi dir="auto">{score.playerName}</bdi></b><strong>{score.escapes} {t('gotAway')}</strong><small>{score.bhabhiCount}× {t('bhabhi')}</small></div>)}</section>
  </main>
}

function BoardUnavailable({ status, error, t, onRetry, onNew, onBack }: { status: PartyBoardConnectionStatus; error: string; t: TFunction; onRetry: () => void; onNew: () => void; onBack: () => void }) {
  const terminal = status === 'expired' || status === 'replaced'
  return <main className="party-board__empty"><div className="party-board__empty-card"><span className="party-board__empty-icon">{status === 'offline' ? <WifiOff size={38}/> : <Monitor size={38}/>}</span><span className="party-board__eyebrow">{t('partyMode')}</span><h1>{terminal ? t('boardUnavailable') : t('openingPartyBoard')}</h1><p>{error || t('openingPartyBoardBody')}</p><div className="party-board__empty-actions">{!terminal ? <button className="button button--primary" type="button" onClick={onRetry}><Refresh size={20}/> {t('tryAgain')}</button> : null}<button className="button button--secondary" type="button" onClick={onNew}>{t('createNewParty')}</button><button className="text-button" type="button" onClick={onBack}><ArrowLeft size={19}/> {t('back')}</button></div></div></main>
}

function useBoardSounds(view: PartyBoardView | null, reaction: ReactionEvent | null, enabled: boolean): void {
  const previousSignalRef = useRef<string | null>(null)
  const previousReactionRef = useRef<string | null>(null)

  useEffect(() => {
    const signal = view?.status === 'finished'
      ? `round:${view.session.roundNumber}`
      : view?.game?.phase === 'resolving' && view.game.resolvedTrick?.kind === 'thulla'
        ? `thulla:${view.game.resolvedTrick.lastPlayerId}:${view.game.resolutionEndsAt ?? view.revision}`
        : ''
    if (previousSignalRef.current !== null && enabled && signal && signal !== previousSignalRef.current) {
      playBoardTone(signal.startsWith('thulla:') ? 'thulla' : 'round')
    }
    previousSignalRef.current = signal
  }, [enabled, view])

  useEffect(() => {
    if (reaction && reaction.id !== previousReactionRef.current) {
      if (enabled) playBoardTone('reaction')
      previousReactionRef.current = reaction.id
    }
  }, [enabled, reaction])
}

export interface PartyBoardFixtureState {
  status: PartyBoardConnectionStatus
  connected: boolean
  view: PartyBoardView | null
  error?: string
  reaction?: ReactionEvent | null
}

interface PartyBoardExperienceProps {
  serverUrl: string
  language: Language
  onLanguage: (language: Language) => void
  t: TFunction
  onExit: () => void
  fixture?: PartyBoardFixtureState | null
}

function PartyBoardSurface({ connection, language, onLanguage, t, onExit }: Omit<PartyBoardExperienceProps, 'serverUrl' | 'fixture'> & { connection: PartyBoardConnection }) {
  const [fullscreen, setFullscreen] = useState(Boolean(document.fullscreenElement))
  const [soundEnabled, setSoundEnabled] = useState(readPartyBoardSoundPreference)
  const fullscreenSupported = Boolean(document.fullscreenEnabled && document.documentElement.requestFullscreen)
  const wakeLock = usePartyWakeLock(Boolean(connection.view))
  const visibleReaction = connection.reaction && connection.view?.players.some((player) => player.id === connection.reaction?.playerId)
    ? connection.reaction
    : null
  useBoardSounds(connection.view, visibleReaction, soundEnabled)

  useEffect(() => {
    const update = () => setFullscreen(Boolean(document.fullscreenElement))
    document.addEventListener('fullscreenchange', update)
    return () => document.removeEventListener('fullscreenchange', update)
  }, [])

  function exit() {
    connection.forget()
    clearBoardCodeFromUrl()
    onExit()
  }
  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen()
      else if (fullscreenSupported) await document.documentElement.requestFullscreen()
    } catch {
      // Fullscreen is progressive enhancement and can be blocked by the display/browser.
    }
  }
  function toggleSound() {
    const next = !soundEnabled
    setSoundEnabled(next)
    savePartyBoardSoundPreference(next)
    if (next) playBoardTone('enabled')
  }

  const waiting = !connection.view && ['connecting', 'creating', 'reconnecting'].includes(connection.status)
  const wakeText = wakeLock.active ? t('boardScreenAwake') : wakeLock.supported ? t('boardWakePending') : t('boardWakeUnavailable')
  return <div className={`party-board party-board--${connection.view?.status ?? 'loading'} ${visibleReaction ? 'has-reaction' : ''}`} data-connection={connection.status} data-wake-lock={wakeLock.active ? 'active' : wakeLock.supported ? 'pending' : 'unsupported'}>
    <header className="party-board__header"><BoardLogo/><div className="party-board__header-center">{visibleReaction ? <div className="party-board__reaction" role="status" aria-live="polite" aria-atomic="true" aria-label={t('boardReaction', { name: visibleReaction.playerName, reaction: reactionLabel(visibleReaction.reaction, t) })}><b><bdi dir="auto">{visibleReaction.playerName}</bdi></b><span>{reactionLabel(visibleReaction.reaction, t)}</span></div> : connection.view ? <div className="party-board__code" aria-label={`${t('roomCode')}: ${connection.view.code}`}><span>{t('room')}</span><b dir="ltr">{connection.view.code}</b></div> : null}</div><div className="party-board__tools"><span className={`party-board__connection ${connection.connected ? 'is-live' : ''}`} title={wakeText}><span className="live-dot"/><span>{connection.connected ? t('boardConnected') : t('boardReconnecting')}</span><span className="sr-only">{wakeText}</span></span><BoardLanguage language={language} onLanguage={onLanguage} t={t}/><button className="party-board__sound" type="button" aria-pressed={soundEnabled} aria-label={soundEnabled ? t('turnBoardSoundOff') : t('turnBoardSoundOn')} title={soundEnabled ? t('turnBoardSoundOff') : t('turnBoardSoundOn')} onClick={toggleSound}>{soundEnabled ? <Volume2 size={22}/> : <VolumeX size={22}/>}</button>{fullscreenSupported ? <button className="party-board__fullscreen" type="button" aria-label={fullscreen ? t('exitFullscreen') : t('fullscreen')} title={fullscreen ? t('exitFullscreen') : t('fullscreen')} onClick={() => void toggleFullscreen()}><Expand size={22}/></button> : null}<button type="button" aria-label={t('leaveBoard')} title={t('leaveBoard')} onClick={exit}><ArrowLeft size={22}/></button></div></header>
    {waiting ? <main className="party-board__empty"><div className="party-board__empty-card"><span className="spinner spinner--large"/><span className="party-board__eyebrow">{t('partyMode')}</span><h1>{connection.status === 'reconnecting' ? t('restoringPartyBoard') : t('openingPartyBoard')}</h1><p>{t('openingPartyBoardBody')}</p></div></main> : null}
    {!connection.view && !waiting ? <BoardUnavailable status={connection.status} error={connection.error} t={t} onRetry={connection.retry} onNew={connection.createNew} onBack={exit}/> : null}
    {connection.view?.status === 'lobby' ? <BoardLobby view={connection.view} t={t}/> : null}
    {connection.view?.status === 'playing' ? <BoardGame view={connection.view} t={t}/> : null}
    {connection.view?.status === 'finished' ? <BoardResults view={connection.view} t={t}/> : null}
    {connection.view && !connection.connected ? <div className="party-board__offline" role="status"><WifiOff size={28}/><div><b>{t('boardConnectionLost')}</b><span>{t('playersContinue')}</span></div><button type="button" onClick={connection.retry}><Refresh size={20}/> {t('tryAgain')}</button></div> : null}
  </div>
}

function LivePartyBoardExperience(props: PartyBoardExperienceProps) {
  const connection = usePartyBoard(props.serverUrl)
  return <PartyBoardSurface {...props} connection={connection}/>
}

export function PartyBoardExperience(props: PartyBoardExperienceProps) {
  if (props.fixture) {
    const connection: PartyBoardConnection = {
      status: props.fixture.status,
      connected: props.fixture.connected,
      view: props.fixture.view,
      error: props.fixture.error ?? '',
      availability: 'public',
      reaction: props.fixture.reaction ?? null,
      retry: () => undefined,
      createNew: () => undefined,
      forget: () => undefined,
    }
    return <PartyBoardSurface {...props} connection={connection}/>
  }
  return <LivePartyBoardExperience {...props}/>
}
