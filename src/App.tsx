import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type ReactNode, type SVGProps } from 'react'
import { io, type Socket } from 'socket.io-client'
import {
  PROTOCOL_VERSION,
  REACTIONS,
  type ChatHistory,
  type ChatMessage,
  type ChatMode,
  type PartyAvailability,
  type Reaction,
  type RoomCredentials,
  type ServerCapability,
  type ServerHello,
} from '../shared/game'
import GameTable from './components/GameTable'
import { AccessibleDialog } from './components/AccessibleDialog'
import { LandingSeoContent } from './components/LandingSeoContent'
import { TableTalk, type TableTalkLabels } from './components/TableTalk'
import { Tutorial } from './components/Tutorial'
import { chatAttemptFor, countUnreadChatMessages, mergeChatMessages, reconcileChatHistory, type PendingChatAttempt } from './chatModel'
import { languageDirection, translate, type Language, type TFunction } from './i18n'
import { usePreferences } from './preferences'
import { DEFAULT_ROOM_SETTINGS, roomSettings, type ClientPlayerView, type ClientRoomView, type TableReaction } from './protocol'
import { makePartyBoardQaFixture } from './partyQaFixtures'
import { makeQaRoom } from './qaFixtures'
import { emitWithAck } from './socket'

type IconProps = SVGProps<SVGSVGElement> & { size?: number }

function Icon({ size = 24, children, ...props }: IconProps & { children: ReactNode }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden={props['aria-label'] ? undefined : true} {...props}>{children}</svg>
}

const BookOpen = (props: IconProps) => <Icon {...props}><path d="M2 4h6a4 4 0 0 1 4 4v12a4 4 0 0 0-4-4H2z"/><path d="M22 4h-6a4 4 0 0 0-4 4v12a4 4 0 0 1 4-4h6z"/></Icon>
const Bot = (props: IconProps) => <Icon {...props}><rect x="4" y="7" width="16" height="13" rx="3"/><path d="M12 3v4M8 12h.01M16 12h.01M8 16h8"/></Icon>
const CircleAlert = (props: IconProps) => <Icon {...props}><circle cx="12" cy="12" r="9"/><path d="M12 7v6M12 17h.01"/></Icon>
const Check = (props: IconProps) => <Icon {...props}><path d="m5 12 4 4L19 6"/></Icon>
const ChevronRight = (props: IconProps) => <Icon {...props}><path d="m9 18 6-6-6-6"/></Icon>
const Clock3 = (props: IconProps) => <Icon {...props}><circle cx="12" cy="12" r="9"/><path d="M12 7v5h4"/></Icon>
const Copy = (props: IconProps) => <Icon {...props}><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></Icon>
const Crown = (props: IconProps) => <Icon {...props}><path d="m3 6 4 5 5-7 5 7 4-5-2 12H5z"/><path d="M5 21h14"/></Icon>
const LogOut = (props: IconProps) => <Icon {...props}><path d="M10 17l5-5-5-5"/><path d="M15 12H3"/><path d="M15 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4"/></Icon>
const Monitor = (props: IconProps) => <Icon {...props}><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></Icon>
const MoreHorizontal = (props: IconProps) => <Icon {...props}><circle cx="5" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1" fill="currentColor" stroke="none"/></Icon>
const Info = (props: IconProps) => <Icon {...props}><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/></Icon>
const Play = (props: IconProps) => <Icon {...props}><path d="m7 4 13 8L7 20z"/></Icon>
const Share2 = (props: IconProps) => <Icon {...props}><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 10.5 6.8-4M8.6 13.5l6.8 4"/></Icon>
const ShieldCheck = (props: IconProps) => <Icon {...props}><path d="M12 3 4 6v5c0 5 3.4 8.5 8 10 4.6-1.5 8-5 8-10V6z"/><path d="m8.5 12 2.2 2.2 4.8-5"/></Icon>
const Smartphone = (props: IconProps) => <Icon {...props}><rect x="5" y="2" width="14" height="20" rx="2"/><path d="M12 18h.01"/></Icon>
const Trash = (props: IconProps) => <Icon {...props}><path d="M3 6h18M8 6V4h8v2M6 6l1 15h10l1-15M10 11v5M14 11v5"/></Icon>
const Users = (props: IconProps) => <Icon {...props}><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/></Icon>
const Wifi = (props: IconProps) => <Icon {...props}><path d="M5 12.6a10 10 0 0 1 14 0M2 9.3a15 15 0 0 1 20 0M8.5 16a5 5 0 0 1 7 0"/><circle cx="12" cy="20" r="1" fill="currentColor" stroke="none"/></Icon>
const WifiOff = (props: IconProps) => <Icon {...props}><path d="m2 2 20 20M8.5 16a5 5 0 0 1 5.7-.9M5 12.6a10 10 0 0 1 4-2M2 9.3A15 15 0 0 1 6 7M14 7a15 15 0 0 1 8 2.3"/><circle cx="12" cy="20" r="1" fill="currentColor" stroke="none"/></Icon>
const X = (props: IconProps) => <Icon {...props}><path d="M18 6 6 18M6 6l12 12"/></Icon>

const DEFAULT_SERVER = window.location.hostname === 'localhost' ? 'http://localhost:3001' : 'https://bhabhi-thulla-server.onrender.com'
const SERVER_URL = import.meta.env.VITE_SERVER_URL || DEFAULT_SERVER
const QA_FIXTURES_ENABLED = import.meta.env.DEV || import.meta.env.VITE_ENABLE_QA_FIXTURES === 'true'
const PartyBoardExperience = lazy(() => import('./components/party/PartyBoard').then((module) => ({ default: module.PartyBoardExperience })))
const LANGUAGES: Language[] = ['en', 'roman', 'ur']
export type ToastTone = 'success' | 'error' | 'info'
type ToastNotice = { message: string; tone: ToastTone }
type ShowToast = (message: string, tone?: ToastTone) => void

function isShareCancelled(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

function reactionLabel(reaction: Reaction, t: TFunction): string {
  if (reaction === 'thulla') return t('reactionThulla')
  if (reaction === 'wah') return t('reactionWah')
  if (reaction === 'oye') return t('reactionOye')
  if (reaction === 'chalo') return t('reactionChalo')
  if (reaction === 'bach-gaya') return t('reactionBachGaya')
  return t('reactionGoodMove')
}

function readMutedChatPlayers(code: string): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(`thulla:chat-mutes:${code}`) ?? '[]')
    return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []
  } catch {
    return []
  }
}

function getInviteCode(): string {
  return new URLSearchParams(window.location.search).get('room')?.toUpperCase().slice(0, 5) ?? ''
}

function getSavedCredentials(code: string): RoomCredentials | null {
  if (!code) return null
  try {
    const value = localStorage.getItem(`thulla:seat:${code}`)
    return value ? JSON.parse(value) as RoomCredentials : null
  } catch { return null }
}

function saveCredentials(credentials: RoomCredentials): void {
  localStorage.setItem(`thulla:seat:${credentials.code}`, JSON.stringify(credentials))
  const url = new URL(window.location.href)
  url.searchParams.delete('board')
  url.searchParams.set('room', credentials.code)
  if (url.searchParams.get('mode') !== 'party') url.searchParams.delete('mode')
  window.history.replaceState({}, '', `${url.pathname}?${url.searchParams.toString()}${url.hash}`)
}

function getSavedLanguage(): Language {
  const saved = localStorage.getItem('thulla:language')
  return LANGUAGES.includes(saved as Language) ? saved as Language : 'en'
}

function clearRoomFromUrl(): void {
  const url = new URL(window.location.href)
  url.searchParams.delete('room')
  const query = url.searchParams.toString()
  window.history.replaceState({}, '', `${url.pathname}${query ? `?${query}` : ''}${url.hash}`)
}

function Logo({ compact = false }: { compact?: boolean }) {
  return <div className={`logo ${compact ? 'logo--compact' : ''}`} aria-label="Bhabhi Thulla"><span className="logo__mark" aria-hidden="true"><i>♠</i><i>♥</i></span><span className="logo__words"><b>Bhabhi</b><strong>THULLA</strong></span></div>
}

function IconButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return <button className="icon-button" type="button" aria-label={label} title={label} onClick={onClick}>{children}</button>
}

function LanguageSelect({ language, onChange, t }: { language: Language; onChange: (language: Language) => void; t: TFunction }) {
  return <label className="language-select"><span className="sr-only">{t('language')}</span><select value={language} onChange={(event) => onChange(event.target.value as Language)} aria-label={t('language')}><option value="en">{t('english')}</option><option value="roman">{t('romanUrdu')}</option><option value="ur">{t('urdu')}</option></select></label>
}

function HeaderOverflow({ t, onOpenRules, onLeave }: { t: TFunction; onOpenRules: () => void; onLeave: () => void }) {
  const detailsRef = useRef<HTMLDetailsElement>(null)
  const label = t('moreOptions')

  useEffect(() => {
    function closeOutside(event: PointerEvent) {
      if (detailsRef.current?.open && !detailsRef.current.contains(event.target as Node)) detailsRef.current.open = false
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key !== 'Escape' || !detailsRef.current?.open) return
      event.preventDefault()
      detailsRef.current.open = false
      detailsRef.current.querySelector<HTMLElement>('summary')?.focus()
    }
    document.addEventListener('pointerdown', closeOutside)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOutside)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [])

  function choose(action: () => void) {
    if (detailsRef.current) detailsRef.current.open = false
    action()
  }

  return <details ref={detailsRef} className="header-overflow">
    <summary className="icon-button" aria-label={label} title={label}><MoreHorizontal size={21}/></summary>
    <div className="header-overflow__menu">
      <button type="button" onClick={() => choose(onOpenRules)}><BookOpen size={19}/><span>{t('howToPlay')}</span></button>
      <button type="button" onClick={() => choose(onLeave)}><LogOut size={19}/><span>{t('leaveTable')}</span></button>
    </div>
  </details>
}

function RulesModal({ t, onClose }: { t: TFunction; onClose: () => void }) {
  const rules = [
    ['ruleAceTitle', 'ruleAceBody'], ['ruleRightTitle', 'ruleRightBody'], ['ruleThullaTitle', 'ruleThullaBody'],
    ['rulePowerTitle', 'rulePowerBody'], ['ruleTakeTitle', 'ruleTakeBody'], ['ruleEscapeTitle', 'ruleEscapeBody'],
  ] as const
  return <AccessibleDialog labelId="rules-title" className="rules-sheet" onClose={onClose}>
    <div className="sheet-header"><div><span className="eyebrow">{t('rulesPakistani')}</span><h2 id="rules-title">{t('howToPlay')}</h2></div><IconButton label={t('close')} onClick={onClose}><X size={22}/></IconButton></div>
    <ol className="rules-list">{rules.map(([title, body], index) => <li key={title}><span>{index + 1}</span><div><b>{t(title)}</b><p>{t(body)}</p></div></li>)}</ol>
    <button className="button button--primary button--wide" type="button" onClick={onClose}>{t('understood')}</button>
  </AccessibleDialog>
}

type LandingExperience = 'choose' | 'online' | 'party-entry' | 'party-phone'

function Landing({ socket, connected, inviteCode, partySupported, partyDiscoverable, t, language, onLanguage, onEntered, onOpenPartyBoard, onOpenRules, onOpenTutorial, onToast }: {
  socket: Socket; connected: boolean; inviteCode: string; t: TFunction; language: Language; onLanguage: (language: Language) => void
  partySupported: boolean; partyDiscoverable: boolean; onEntered: (credentials: RoomCredentials) => void; onOpenPartyBoard: () => void; onOpenRules: () => void; onOpenTutorial: () => void; onToast: ShowToast
}) {
  const requestedParty = useMemo(() => new URLSearchParams(window.location.search).get('mode') === 'party', [])
  const [experience, setExperience] = useState<LandingExperience>(() => inviteCode ? requestedParty ? 'party-phone' : 'online' : 'online')
  const [mode, setMode] = useState<'create' | 'join'>(inviteCode ? 'join' : 'create')
  const [name, setName] = useState(() => localStorage.getItem('thulla:name') ?? '')
  const [code, setCode] = useState(inviteCode)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [wakeElapsed, setWakeElapsed] = useState(0)
  const discoveryAppliedRef = useRef(Boolean(inviteCode) || partyDiscoverable)

  useEffect(() => {
    if (discoveryAppliedRef.current || inviteCode || !partyDiscoverable) return
    discoveryAppliedRef.current = true
    setExperience('choose')
  }, [inviteCode, partyDiscoverable])

  useEffect(() => {
    if (connected) { setWakeElapsed(0); return }
    const startedAt = Date.now()
    setWakeElapsed(0)
    const interval = window.setInterval(() => setWakeElapsed(Math.floor((Date.now() - startedAt) / 1000)), 1_000)
    return () => window.clearInterval(interval)
  }, [connected])

  async function enterRoom(createPractice = false) {
    setError('')
    if (!connected) { setError(t('connectionWait')); return }
    setLoading(true)
    const cleanName = name.trim() || (createPractice ? t('player') : '')
    localStorage.setItem('thulla:name', cleanName)
    const shouldCreate = createPractice || (experience === 'online' && mode === 'create')
    const response = shouldCreate
      ? await emitWithAck<RoomCredentials>(socket, 'room:create', { name: cleanName })
      : await emitWithAck<RoomCredentials>(socket, 'room:join', { name: cleanName, code })
    if (!response.ok || !response.data) {
      setLoading(false); setError(response.error ?? t('enterRoomFailed')); return
    }
    onEntered(response.data)
    if (createPractice) {
      const first = await emitWithAck(socket, 'room:add-bot', { name: 'Ayesha' })
      const second = first.ok ? await emitWithAck(socket, 'room:add-bot', { name: 'Bilal' }) : first
      if (first.ok && second.ok) {
        await emitWithAck(socket, 'room:ready', { ready: true })
        const start = await emitWithAck(socket, 'game:start', {})
        if (!start.ok) onToast(start.error ?? t('startFailed'), 'error')
      } else onToast(first.error ?? second.error ?? t('practiceSetupFailed'), 'error')
    }
    setLoading(false)
  }

  async function submit(event: FormEvent) { event.preventDefault(); await enterRoom(false) }

  function focusCreateRoom() {
    setExperience('online')
    setMode('create')
    setError('')
    window.requestAnimationFrame(() => {
      const joinCard = document.getElementById('play-bhabhi-thulla')
      const nameInput = document.getElementById('player-name') as HTMLInputElement | null
      joinCard?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' })
      nameInput?.focus({ preventScroll: true })
    })
  }

  function chooseExperience(next: LandingExperience) {
    setExperience(next)
    setError('')
    if (next === 'party-phone') setMode('join')
    window.requestAnimationFrame(() => document.getElementById('play-bhabhi-thulla')?.scrollIntoView({ behavior: 'smooth', block: 'center' }))
  }

  return <>
    <main className={`landing-shell ${experience === 'party-entry' || experience === 'party-phone' ? 'landing-shell--party-entry' : ''}`}>
      <nav className="landing-nav"><Logo compact/><div className="landing-nav__actions"><LanguageSelect language={language} onChange={onLanguage} t={t}/><button className="text-button" type="button" onClick={onOpenRules}><BookOpen size={18}/> {t('howToPlay')}</button></div></nav>
      <div className="landing-grid">
      <section className="hero-copy">
        <div className="hero-copy__intro">
          <div className="hero-kicker"><span className="live-dot"/> {t('privateRooms')}</div>
          <h1>{t('heroLineOne')}<br/><em>{t('heroLineTwo').split(' ')[0]}</em> {t('heroLineTwo').split(' ').slice(1).join(' ')}</h1>
          <p>{t('heroDescription')}</p>
          <button
            className="button button--primary landing-play-cta"
            data-action="focus-create-room"
            type="button"
            aria-controls="play-bhabhi-thulla"
            onClick={focusCreateRoom}
          >
            <Play size={19} fill="currentColor"/> {t('startPrivate')}
          </button>
        </div>
        <div className="hero-copy__visuals">
          <div className="hero-cards" aria-hidden="true"><div className="hero-card hero-card--one"><span>A</span><i>♠</i></div><div className="hero-card hero-card--two"><span>K</span><i>♥</i></div><div className="hero-card hero-card--three"><span>7</span><i>♦</i></div></div>
          <div className="trust-row"><span><ShieldCheck size={18}/> {t('serverChecked')}</span><span><Users size={18}/> {t('playerCount')}</span><span><Clock3 size={18}/> {t('roundLength')}</span></div>
        </div>
      </section>
      <section className="join-card" id="play-bhabhi-thulla" aria-labelledby="join-heading">
        <div className="connection-label" data-connected={connected}><span>{connected ? <Wifi size={16}/> : <WifiOff size={16}/>} {connected ? t('serverReady') : wakeElapsed >= 8 ? t('wakingServerElapsed', { count: wakeElapsed }) : t('wakingServer')}</span>{!connected && wakeElapsed >= 8 ? <button type="button" onClick={() => { socket.disconnect(); socket.connect(); setWakeElapsed(0) }}>{t('retryConnection')}</button> : null}</div>
        {experience === 'choose' ? <div className="play-mode-panel">
          <span className="eyebrow">{t('pullUpChair')}</span><h2 id="join-heading">{t('choosePlayMode')}</h2><p className="play-mode-panel__intro">{t('choosePlayModeBody')}</p>
          <div className="play-mode-options">
            <button type="button" onClick={() => chooseExperience('online')}><span className="play-mode-options__icon"><Users size={25}/></span><span><b>{t('onlineMode')}</b><small>{t('onlineModeBody')}</small></span><ChevronRight size={21}/></button>
            <button className="is-party" type="button" onClick={() => chooseExperience('party-entry')}><i>{t('newFeature')}</i><span className="play-mode-options__icon"><Monitor size={25}/></span><span><b>{t('partyMode')}</b><small>{t('partyModeBody')}</small></span><ChevronRight size={21}/></button>
          </div>
          <button className="text-button play-mode-panel__tutorial" type="button" onClick={onOpenTutorial}><BookOpen size={18}/> {t('interactiveTutorial')}</button>
        </div> : null}
        {experience === 'party-entry' ? <div className="play-mode-panel party-entry-panel">
          <button className="join-card__back" type="button" onClick={() => chooseExperience('choose')}><ChevronRight size={18}/> {t('backToModes')}</button>
          <span className="eyebrow">{t('partyMode')}</span><h2 id="join-heading">{t('partySetup')}</h2><p className="play-mode-panel__intro">{t('partySetupBody')}</p>
          <div className="party-role-options">
            <button type="button" disabled={!partySupported} onClick={onOpenPartyBoard}><Monitor size={28}/><span><b>{t('openSharedBoard')}</b><small>{t('openSharedBoardBody')}</small></span><ChevronRight size={21}/></button>
            <button type="button" onClick={() => chooseExperience('party-phone')}><Smartphone size={28}/><span><b>{t('joinOnPhone')}</b><small>{t('joinOnPhoneBody')}</small></span><ChevronRight size={21}/></button>
          </div>
        </div> : null}
        {experience === 'online' || experience === 'party-phone' ? <>
          {partyDiscoverable || experience === 'party-phone' ? <button className="join-card__back" type="button" onClick={() => chooseExperience(experience === 'party-phone' ? 'party-entry' : 'choose')}><ChevronRight size={18}/> {t('backToModes')}</button> : null}
          <span className="eyebrow">{experience === 'party-phone' ? t('partyController') : t('pullUpChair')}</span><h2 id="join-heading">{experience === 'party-phone' ? t('partyJoinTitle') : mode === 'create' ? t('startPrivate') : t('joinFriends')}</h2>
          {experience === 'party-phone' ? <p className="play-mode-panel__intro">{t('partyJoinBody')}</p> : <div className="mode-tabs" aria-label={t('chooseRoomAction')}><button type="button" aria-pressed={mode === 'create'} onClick={() => { setMode('create'); setError('') }}>{t('createRoom')}</button><button type="button" aria-pressed={mode === 'join'} onClick={() => { setMode('join'); setError('') }}>{t('joinRoom')}</button></div>}
          <form onSubmit={submit}>
            <label htmlFor="player-name">{t('yourName')}</label><input id="player-name" value={name} onChange={(event) => setName(event.target.value)} maxLength={20} minLength={2} autoComplete="nickname" dir="auto" placeholder="e.g. Hamza" required/>
            {mode === 'join' || experience === 'party-phone' ? <><label htmlFor="room-code">{t('roomCode')}</label><input id="room-code" className="code-input" value={code} onChange={(event) => setCode(event.target.value.replace(/[^a-z0-9]/gi, '').toUpperCase().slice(0, 5))} maxLength={5} placeholder="ABCDE" autoCapitalize="characters" autoComplete="off" autoCorrect="off" spellCheck={false} enterKeyHint="go" inputMode="text" dir="ltr" required/></> : null}
            {error ? <p className="form-error" role="alert">{error}</p> : null}
            <button className="button button--primary button--wide" type="submit" disabled={loading || !connected}>{loading ? <><span className="spinner"/> {t('takingSeat')}</> : <>{experience === 'party-phone' ? t('joinOnPhone') : mode === 'create' ? t('createPrivateRoom') : t('joinTable')} <ChevronRight size={20}/></>}</button>
          </form>
          {experience === 'party-phone' ? <p className="party-phone-privacy"><ShieldCheck size={18}/>{t('partyPhonePrivacy')}</p> : <><div className="practice-actions"><button className="button button--secondary button--wide" type="button" disabled={loading || !connected} onClick={() => void enterRoom(true)}><Bot size={20}/> {t('practiceBots')}</button><button className="text-button" type="button" onClick={onOpenTutorial}><BookOpen size={18}/> {t('interactiveTutorial')}</button></div><p className="privacy-note">{t('privacy')}</p></>}
        </> : null}
      </section>
      </div>
      <LandingSeoContent onCreateRoom={focusCreateRoom} onPractice={() => void enterRoom(true)} onOpenRules={onOpenRules} onOpenTutorial={onOpenTutorial}/>
    </main>
    <footer className="landing-footer" lang="en-PK" dir="ltr">
      <div><Logo compact/><p>Play Pakistan's Bhabhi Thulla card game online with friends.</p></div>
      <nav aria-label="Bhabhi Thulla information"><a href="#play-bhabhi-thulla">Play now</a><a href="#bhabhi-thulla-rules">Pakistani rules</a><button type="button" onClick={onOpenTutorial}>Interactive tutorial</button></nav>
      <small>Free private multiplayer. No signup or public chat.</small>
    </footer>
  </>
}

function PlayerSeat({ player, host, busy, t, onKick, onRemoveBot }: { player: ClientPlayerView; host: boolean; busy: boolean; t: TFunction; onKick: (id: string) => void; onRemoveBot: (id: string) => void }) {
  const initials = player.name.split(' ').map((part) => part[0]).join('').slice(0, 2).toUpperCase()
  const status = player.ready ? t('playerReady') : player.reconnecting || !player.connected ? t('reconnecting') : t('notReady')
  return <div className={`player-seat ${player.ready ? 'is-ready' : ''} ${!player.connected ? 'is-offline' : ''}`}>
    <div className="player-seat__avatar">{player.isBot ? <Bot size={19}/> : initials}</div><div className="player-seat__copy"><b><bdi dir="auto">{player.name}</bdi>{player.isYou ? ` (${t('you')})` : ''}</b><span>{player.isBot ? `${t('bot')} · ${status}` : status}</span></div>
    {player.isHost ? <Crown className="host-crown" size={16} aria-label={t('host')}/> : null}
    {player.ready ? <Check className="ready-check" size={18} aria-label={t('playerReady')}/> : null}
    {host && !player.isYou && !player.isHost ? <button className="seat-remove" type="button" disabled={busy} aria-label={`${player.isBot ? t('removeBot') : t('removePlayer')}: ${player.name}`} onClick={() => {
      const confirmed = window.confirm(player.isBot ? t('removeBotConfirm', { name: player.name }) : t('removePlayerConfirm', { name: player.name }))
      if (!confirmed) return
      if (player.isBot) onRemoveBot(player.id)
      else onKick(player.id)
    }}><Trash size={17}/></button> : null}
  </div>
}

function Lobby({ room, socket, t, language, chatSupported, tableTalkControl, onLanguage, onOpenRules, onLeave, onToast }: { room: ClientRoomView; socket: Socket; t: TFunction; language: Language; chatSupported: boolean; tableTalkControl?: ReactNode; onLanguage: (language: Language) => void; onOpenRules: () => void; onLeave: () => void; onToast: ShowToast }) {
  const [busy, setBusy] = useState(false)
  const me = room.players.find((player) => player.isYou)!
  const settings = roomSettings(room)
  const connectedCount = room.players.filter((player) => player.connected || player.isBot).length
  const inviteUrl = `${window.location.origin}${window.location.pathname}?room=${room.code}${room.mode === 'party' ? '&mode=party' : ''}`
  const scores = room.session?.scores ?? []

  async function act(event: string, payload: unknown, fallback: string) {
    setBusy(true); const response = await emitWithAck(socket, event, payload); setBusy(false); if (!response.ok) onToast(response.error ?? fallback, 'error')
  }
  async function copyInvite() {
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
  const participants = room.players.filter((player) => player.isBot || player.connected)
  const allReady = participants.length >= room.minPlayers && participants.every((player) => player.isBot || player.ready)

  return <main className={`lobby-shell ${room.mode === 'party' ? 'lobby-shell--party-controller' : ''}`}>
    <header className="app-header"><Logo compact/><div className="header-actions"><LanguageSelect language={language} onChange={onLanguage} t={t}/>{tableTalkControl ? <div className="app-header__table-talk">{tableTalkControl}</div> : null}<div className="header-actions__secondary"><IconButton label={t('howToPlay')} onClick={onOpenRules}><BookOpen size={20}/></IconButton><IconButton label={t('leaveTable')} onClick={onLeave}><LogOut size={20}/></IconButton></div><HeaderOverflow t={t} onOpenRules={onOpenRules} onLeave={onLeave}/></div></header>
    <section className="lobby-card lobby-card--expanded">
      <div className="lobby-card__intro"><span className="eyebrow">{t('pullUpChair')}</span><h1>{t('waitingGang')}</h1><p>{t('lobbyDescription')}</p></div>
      <button className="room-code" type="button" onClick={() => void copyInvite()} aria-label={t('copyInviteRoom', { code: room.code })}><span>{t('roomCode')}</span><b dir="ltr">{room.code}</b><Copy size={19}/></button>
      {room.mode === 'party' ? <div className={`party-controller-notice ${room.partyBoardConnected ? 'is-connected' : 'is-disconnected'}`} role="status"><Monitor size={21}/><div><b>{t('partyController')}</b><span>{room.partyBoardConnected ? t('sharedScreenConnected') : t('sharedScreenDisconnected')}</span></div></div> : null}
      <div className="seat-progress" role="progressbar" aria-label={t('seatsFilled', { count: connectedCount, total: room.maxPlayers })} aria-valuemin={0} aria-valuemax={room.maxPlayers} aria-valuenow={connectedCount} aria-valuetext={t('seatsFilled', { count: connectedCount, total: room.maxPlayers })}>{Array.from({ length: room.maxPlayers }, (_, index) => <i key={index} className={index < connectedCount ? 'is-filled' : ''}/>)}</div>
      <p className="lobby-hint"><Users size={17}/>{connectedCount < 3 ? t('needPlayers', { count: 3 - connectedCount }) : allReady ? t('readyToDeal') : t('needReady')}</p>
      <div className="lobby-actions">
        <div className="lobby-actions__primary" data-action-group="primary">
          {me.isHost ? <button className="button button--primary lobby-actions__deal" type="button" disabled={!room.canStart || !allReady || busy} onClick={() => void act('game:start', {}, t('startFailed'))}><Play size={19} fill="currentColor"/> {busy ? t('shuffling') : t('dealCards')}</button> : <p className="host-wait">{t('waitingHost')}</p>}
        </div>
        <div className="lobby-actions__secondary" data-action-group="secondary">
          <button className="button button--secondary lobby-actions__copy" type="button" onClick={() => void copyInvite()}><Share2 size={19}/> {t('copyInvite')}</button>
          <button className="button button--secondary lobby-actions__readiness" type="button" disabled={busy} aria-pressed={me.ready} onClick={() => void act('room:ready', { ready: !me.ready }, t('readyUpdateFailed'))}><Check size={19}/> {me.ready ? t('cancelReadiness') : t('playerReady')}</button>
        </div>
      </div>
      <div className="lobby-content-grid">
        <div>
          <div className="lobby-players">{room.players.map((player) => <PlayerSeat key={player.id} player={player} host={me.isHost} busy={busy} t={t} onKick={(playerId) => void act('room:kick', { playerId }, t('removePlayerFailed'))} onRemoveBot={(playerId) => void act('room:remove-bot', { playerId }, t('removeBotFailed'))}/>)}{Array.from({ length: Math.max(0, 3 - room.players.length) }, (_, index) => <div className="empty-seat" key={index}><span>+</span><p>{t('waitingPlayer')}</p></div>)}</div>
          {me.isHost && settings.allowBots && room.players.length < room.maxPlayers ? <button className="button button--secondary lobby-add-bot" type="button" disabled={busy} onClick={() => void act('room:add-bot', {}, t('addBotFailed'))}><Bot size={19}/> {t('addBot')}</button> : null}
        </div>
        <fieldset className="lobby-settings" disabled={!me.isHost || busy}><legend>{t('tableSettings')}</legend>
          <label><span>{t('turnTimer')}</span><select value={settings.turnSeconds} onChange={(event) => void act('room:settings', { turnSeconds: Number(event.target.value) }, t('settingsUpdateFailed'))}><option value="20">20s</option><option value="35">35s</option><option value="60">60s</option></select></label>
          <label className="switch-row"><span>{t('allowBots')}</span><input type="checkbox" checked={settings.allowBots} onChange={(event) => void act('room:settings', { allowBots: event.target.checked }, t('settingsUpdateFailed'))}/></label>
          {chatSupported ? <label><span>{t('chatMode')}</span><select value={settings.chatMode} onChange={(event) => { const chatMode = event.target.value as ChatMode; void act('room:settings', chatMode === 'off' ? { chatMode } : { chatMode, reactionsEnabled: true }, t('chatModeUpdateFailed')) }}><option value="text">{t('chatTextAndQuick')}</option><option value="quick">{t('chatQuickOnly')}</option><option value="off">{t('chatOff')}</option></select></label> : <label className="switch-row"><span>{t('reactions')}</span><input type="checkbox" checked={settings.reactionsEnabled} onChange={(event) => void act('room:settings', { reactionsEnabled: event.target.checked }, t('settingsUpdateFailed'))}/></label>}
          <label className="switch-row"><span>{t('tutorialHints')}</span><input type="checkbox" checked={settings.tutorialHints} onChange={(event) => void act('room:settings', { tutorialHints: event.target.checked }, t('settingsUpdateFailed'))}/></label>
          {!me.isHost ? <small>{t('onlyHostSettings')}</small> : null}
        </fieldset>
      </div>
      {scores.length ? <div className="lobby-score-preview"><b>{t('sessionScore')}</b><span>{t('round', { count: room.session?.roundNumber ?? 1 })}</span>{scores.slice(0, 3).map((score) => <p key={score.playerId}><span><bdi dir="auto">{score.playerName}</bdi></span><b>{score.escapes} {t('gotAway')} · {score.bhabhiCount} {t('bhabhi')}</b></p>)}</div> : null}
    </section>
  </main>
}

export default function App() {
  const [socket] = useState(() => io(SERVER_URL, { autoConnect: false, reconnection: true, reconnectionDelayMax: 5000, auth: { protocolVersion: PROTOCOL_VERSION } }))
  const inviteCode = useMemo(getInviteCode, [])
  const initialCredentials = useMemo(() => getSavedCredentials(inviteCode), [inviteCode])
  const [credentials, setCredentials] = useState<RoomCredentials | null>(initialCredentials)
  const credentialsRef = useRef(credentials)
  const [room, setRoom] = useState<ClientRoomView | null>(null)
  const qaRoom = useMemo(() => QA_FIXTURES_ENABLED ? makeQaRoom(new URLSearchParams(window.location.search).get('qa')) : null, [])
  const partyQaFixture = useMemo(() => QA_FIXTURES_ENABLED ? makePartyBoardQaFixture(new URLSearchParams(window.location.search).get('partyQa')) : null, [])
  const [connected, setConnected] = useState(false)
  const [reconnecting, setReconnecting] = useState(Boolean(initialCredentials))
  const [restoreElapsed, setRestoreElapsed] = useState(0)
  const [entryError, setEntryError] = useState('')
  const [rulesOpen, setRulesOpen] = useState(false)
  const [tutorialOpen, setTutorialOpen] = useState(false)
  const [toast, setToast] = useState<ToastNotice | null>(null)
  const [reaction, setReaction] = useState<TableReaction | null>(null)
  const [serverCapabilities, setServerCapabilities] = useState<ServerCapability[]>([])
  const [partyAvailability, setPartyAvailability] = useState<PartyAvailability>('off')
  const [partyBoardOpen, setPartyBoardOpen] = useState(() => Boolean(new URLSearchParams(window.location.search).get('board')) || Boolean(partyQaFixture))
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])
  const chatMessagesRef = useRef<ChatMessage[]>([])
  const chatEpochRef = useRef<string | null>(null)
  const [lastReadChatSequence, setLastReadChatSequence] = useState(0)
  const [tableTalkOpen, setTableTalkOpen] = useState(false)
  const [chatDraft, setChatDraft] = useState('')
  const [chatSendError, setChatSendError] = useState('')
  const [mutedChatPlayerIds, setMutedChatPlayerIds] = useState<string[]>([])
  const pendingChatAttemptRef = useRef<PendingChatAttempt | null>(null)
  const historyInitializedCodeRef = useRef<string | null>(null)
  const previousRoomCodeRef = useRef<string | null>(null)
  const previousRoomStatusRef = useRef<ClientRoomView['status'] | null>(null)
  const [language, setLanguage] = useState<Language>(getSavedLanguage)
  const languageRef = useRef(language)
  const { preferences, updatePreference } = usePreferences()
  const t = useMemo<TFunction>(() => (key, values) => translate(language, key, values), [language])
  const showToast = useCallback<ShowToast>((message, tone = 'info') => setToast({ message, tone }), [])
  const displayedRoom = qaRoom ?? room
  const auxiliaryOverlaysBlocked = displayedRoom?.status === 'finished' || displayedRoom?.game?.phase === 'resolving'
  const auxiliaryOverlaysBlockedRef = useRef(auxiliaryOverlaysBlocked)
  auxiliaryOverlaysBlockedRef.current = auxiliaryOverlaysBlocked
  const chatSupported = Boolean(qaRoom) || serverCapabilities.includes('chat-v1')
  const clearSeat = useCallback((code: string | undefined, message = '') => {
    if (code) localStorage.removeItem(`thulla:seat:${code}`)
    credentialsRef.current = null
    setCredentials(null)
    setRoom(null)
    setChatMessages([])
    chatMessagesRef.current = []
    chatEpochRef.current = null
    setLastReadChatSequence(0)
    setTableTalkOpen(false)
    setChatDraft('')
    setChatSendError('')
    pendingChatAttemptRef.current = null
    historyInitializedCodeRef.current = null
    setReconnecting(false)
    setEntryError(message)
    clearRoomFromUrl()
  }, [])

  useEffect(() => { languageRef.current = language; localStorage.setItem('thulla:language', language); document.documentElement.lang = language === 'ur' ? 'ur-PK' : language === 'roman' ? 'ur-Latn-PK' : 'en'; document.documentElement.dir = languageDirection(language) }, [language])
  useEffect(() => { credentialsRef.current = credentials }, [credentials])
  useEffect(() => {
    if (!reconnecting || displayedRoom) { setRestoreElapsed(0); return }
    const startedAt = Date.now()
    const timer = window.setInterval(() => setRestoreElapsed(Math.floor((Date.now() - startedAt) / 1_000)), 1_000)
    return () => window.clearInterval(timer)
  }, [displayedRoom, reconnecting])
  useEffect(() => {
    if (qaRoom || partyQaFixture) {
      // Deterministic visual fixtures do not need a live Socket.IO connection.
      // Avoid opening a fresh connection on every QA viewport navigation.
      setConnected(true)
      return () => setConnected(false)
    }
    let attemptedForConnection = false
    async function restoreSeat() {
      setConnected(true); const saved = credentialsRef.current
      if (!saved || attemptedForConnection) return
      attemptedForConnection = true; setReconnecting(true)
      const response = await emitWithAck<RoomCredentials>(socket, 'room:reconnect', { code: saved.code, token: saved.token })
      setReconnecting(false)
      if (!response.ok) clearSeat(saved.code, response.error ?? 'Could not restore your seat. Please join the room again.')
    }
    const onDisconnect = () => { attemptedForConnection = false; setConnected(false) }
    const rejectProtocol = (code?: string) => {
      const message = translate(languageRef.current, 'serverUpdating')
      const saved = credentialsRef.current
      if (saved || code) clearSeat(code ?? saved?.code, message)
      else { setRoom(null); setEntryError(message); clearRoomFromUrl() }
    }
    const onHello = (hello?: Partial<ServerHello>) => {
      if (hello?.protocolVersion && String(hello.protocolVersion) !== PROTOCOL_VERSION) {
        rejectProtocol()
        return
      }
      setServerCapabilities((hello?.capabilities ?? []).filter(
        (capability): capability is ServerCapability => capability === 'chat-v1' || capability === 'party-v1',
      ))
      setPartyAvailability(hello?.partyMode === 'beta' || hello?.partyMode === 'public' ? hello.partyMode : 'off')
    }
    const onState = (state: ClientRoomView) => {
      if (String(state.protocolVersion) !== PROTOCOL_VERSION) { rejectProtocol(state.code); return }
      setRoom({
        ...state,
        revision: Number.isSafeInteger(state.revision) && state.revision >= 0 ? state.revision : 0,
        serverNow: Number.isFinite(state.serverNow) ? state.serverNow : Date.now(),
        mode: state.mode === 'party' ? 'party' : 'online',
        partyBoardConnected: state.partyBoardConnected === true,
        settings: { ...DEFAULT_ROOM_SETTINGS, ...state.settings },
      })
    }
    const onReaction = (next: TableReaction) => setReaction(next)
    const onChatMessage = (message: ChatMessage) => {
      if (pendingChatAttemptRef.current?.clientMessageId === message.clientMessageId) {
        pendingChatAttemptRef.current = null
        setChatSendError('')
      }
      const epochChanged = chatEpochRef.current !== null && chatEpochRef.current !== message.epoch
      chatEpochRef.current = message.epoch
      if (epochChanged) {
        chatMessagesRef.current = [message]
        setChatMessages([message])
        setLastReadChatSequence(0)
        pendingChatAttemptRef.current = null
        return
      }
      setChatMessages((current) => {
        const next = mergeChatMessages(current, [message])
        chatMessagesRef.current = next
        return next
      })
    }
    const onKicked = ({ code }: { code?: string }) => {
      clearSeat(code ?? credentialsRef.current?.code, 'The host removed you from that room. You can join another table.')
    }
    socket.on('connect', restoreSeat); socket.on('disconnect', onDisconnect); socket.on('server:hello', onHello); socket.on('room:state', onState); socket.on('room:reaction', onReaction); socket.on('room:chat:message', onChatMessage); socket.on('room:kicked', onKicked)
    if (socket.connected) void restoreSeat(); else socket.connect()
    return () => { socket.off('connect', restoreSeat); socket.off('disconnect', onDisconnect); socket.off('server:hello', onHello); socket.off('room:state', onState); socket.off('room:reaction', onReaction); socket.off('room:chat:message', onChatMessage); socket.off('room:kicked', onKicked); socket.disconnect() }
  }, [clearSeat, partyQaFixture, qaRoom, socket])
  useEffect(() => { chatMessagesRef.current = chatMessages }, [chatMessages])
  useEffect(() => {
    const code = displayedRoom?.code ?? null
    if (previousRoomCodeRef.current !== code) {
      previousRoomCodeRef.current = code
      historyInitializedCodeRef.current = null
      pendingChatAttemptRef.current = null
      setChatMessages([])
      chatMessagesRef.current = []
      chatEpochRef.current = null
      setLastReadChatSequence(0)
      setTableTalkOpen(false)
      setChatDraft('')
      setChatSendError('')
      setMutedChatPlayerIds(code ? readMutedChatPlayers(code) : [])
    }
    const status = displayedRoom?.status ?? null
    if (previousRoomStatusRef.current !== null && previousRoomStatusRef.current !== status) {
      setTableTalkOpen(false)
      if (status === 'playing' || status === 'finished') {
        setRulesOpen(false)
        setTutorialOpen(false)
      }
    }
    previousRoomStatusRef.current = status
  }, [displayedRoom?.code, displayedRoom?.status])
  useEffect(() => {
    const code = room?.code
    if (!code || !connected || !chatSupported || qaRoom) return
    const roomCode = code
    let cancelled = false
    async function loadHistory() {
      const response = await emitWithAck<ChatHistory>(socket, 'room:chat:history', {})
      if (cancelled || !response.ok || !response.data) return
      const firstLoadForRoom = historyInitializedCodeRef.current !== roomCode
      historyInitializedCodeRef.current = roomCode
      const reconciled = reconcileChatHistory(chatMessagesRef.current, chatEpochRef.current, response.data)
      chatEpochRef.current = response.data.epoch
      const next = reconciled.messages
      chatMessagesRef.current = next
      setChatMessages(next)
      if (firstLoadForRoom) {
        const latestHistorySequence = response.data.messages.reduce((latest, message) => Math.max(latest, message.sequence), 0)
        setLastReadChatSequence(latestHistorySequence)
      } else if (reconciled.epochChanged) {
        setLastReadChatSequence(0)
        pendingChatAttemptRef.current = null
      }
    }
    void loadHistory()
    return () => { cancelled = true }
  }, [chatSupported, connected, qaRoom, room?.code, socket])
  useEffect(() => { if (!toast) return; const timeout = window.setTimeout(() => setToast(null), 3500); return () => window.clearTimeout(timeout) }, [toast])
  useEffect(() => { if (!reaction) return; const timeout = window.setTimeout(() => setReaction(null), 2800); return () => window.clearTimeout(timeout) }, [reaction?.id])

  const activeRoomSettings = displayedRoom ? roomSettings(displayedRoom) : DEFAULT_ROOM_SETTINGS
  const tableTalkAvailable = Boolean(displayedRoom) && !auxiliaryOverlaysBlocked
  const quickTalkEnabled = Boolean(displayedRoom) && activeRoomSettings.reactionsEnabled && (!chatSupported || activeRoomSettings.chatMode !== 'off')
  const textTalkEnabled = Boolean(displayedRoom) && chatSupported && activeRoomSettings.chatMode === 'text'
  const gameChatOpen = Boolean(tableTalkOpen && tableTalkAvailable && displayedRoom?.status === 'playing')
  const visibleReaction = reaction && !mutedChatPlayerIds.includes(reaction.playerId) ? reaction : null
  const isMyTurn = Boolean(displayedRoom?.game?.phase === 'turn' && displayedRoom.game.currentTurnId === displayedRoom.yourPlayerId)
  const tableTalkParticipants = useMemo(() => displayedRoom?.players.map((player) => ({ id: player.id, name: player.name, canMute: !player.isBot })) ?? [], [displayedRoom?.players])
  const tableTalkReactions = useMemo(() => REACTIONS.map((reaction) => ({ id: reaction, label: reactionLabel(reaction, t) })), [t])
  const unreadChatCount = useMemo(() => {
    if (!displayedRoom || preferences.chatNotificationsMuted || !textTalkEnabled) return 0
    return countUnreadChatMessages(chatMessages, lastReadChatSequence, displayedRoom.yourPlayerId, mutedChatPlayerIds)
  }, [chatMessages, displayedRoom, lastReadChatSequence, mutedChatPlayerIds, preferences.chatNotificationsMuted, textTalkEnabled])
  const tableTalkLabels = useMemo<Partial<TableTalkLabels>>(() => ({
    title: t('tableTalk'),
    open: t('openTableTalk'),
    openWithUnread: (count) => t('openTableTalkUnread', { count }),
    close: t('closeTableTalk'),
    quickTab: t('quickReactions'),
    chatTab: t('textChat'),
    quickHint: t('quickReactionHint'),
    noMessages: t('noChatMessages'),
    messageList: t('chatMessageList'),
    newMessages: t('newMessages'),
    yourTurn: t('yourTurn'),
    returnToCards: t('returnToCards'),
    messageLabel: t('chatMessageLabel'),
    messagePlaceholder: t('chatPlaceholder'),
    send: t('sendMessage'),
    sending: t('sendingMessage'),
    sendFailed: t('chatSendFailed'),
    quickSendFailed: t('reactionFailed'),
    charactersRemaining: (count) => t('charactersRemaining', { count }),
    privacyHint: t('chatPrivacy'),
    playerControls: t('chatPlayerControls'),
    mute: t('mute'),
    unmute: t('unmute'),
    mutePlayer: (name) => t('mutePlayer', { name }),
    unmutePlayer: (name) => t('unmutePlayer', { name }),
    mutedCount: (count) => t('mutedCount', { count }),
  }), [t])
  const formatChatTime = useMemo(() => {
    const formatter = new Intl.DateTimeFormat(language === 'ur' ? 'ur-PK' : language === 'roman' ? 'ur-Latn-PK' : 'en-PK', { hour: 'numeric', minute: '2-digit' })
    return (createdAt: number) => formatter.format(new Date(createdAt))
  }, [language])

  useLayoutEffect(() => {
    document.body.classList.toggle('has-game-chat-open', gameChatOpen)
    return () => document.body.classList.remove('has-game-chat-open')
  }, [gameChatOpen])

  useEffect(() => {
    if (!tableTalkAvailable || (!quickTalkEnabled && !textTalkEnabled)) setTableTalkOpen(false)
  }, [quickTalkEnabled, tableTalkAvailable, textTalkEnabled])

  useEffect(() => {
    if (!isMyTurn) return
    setRulesOpen(false)
    setTutorialOpen(false)
  }, [isMyTurn])
  useEffect(() => {
    if (!auxiliaryOverlaysBlocked) return
    const hadOpenOverlay = rulesOpen || tutorialOpen || tableTalkOpen
    setRulesOpen(false)
    setTutorialOpen(false)
    setTableTalkOpen(false)
    if (!hadOpenOverlay) return
    let secondFrame = 0
    const firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        const selector = displayedRoom?.status === 'finished'
          ? '#round-result-title'
          : '#game-v2-hand, #game-v2-waiting-player'
        const target = document.querySelector<HTMLElement>(selector)
        if (target?.isConnected && !target.closest('[inert], [aria-hidden="true"]')) target.focus({ preventScroll: true })
      })
    })
    return () => {
      window.cancelAnimationFrame(firstFrame)
      if (secondFrame) window.cancelAnimationFrame(secondFrame)
    }
  }, [auxiliaryOverlaysBlocked])

  function openRules() {
    if (auxiliaryOverlaysBlocked) return
    setTutorialOpen(false)
    if (!tableTalkOpen) {
      setRulesOpen(true)
      return
    }
    setTableTalkOpen(false)
    // Let Table Talk restore its trigger before the modal takes ownership of
    // focus; otherwise its deferred cleanup could pull focus out of the rules.
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
      if (!auxiliaryOverlaysBlockedRef.current) setRulesOpen(true)
    }))
  }

  function openTutorial() {
    if (auxiliaryOverlaysBlocked) return
    setRulesOpen(false)
    setTableTalkOpen(false)
    setTutorialOpen(true)
  }

  function openTableTalk() {
    if (!tableTalkAvailable) return
    setRulesOpen(false)
    setTutorialOpen(false)
    setTableTalkOpen(true)
  }

  function entered(next: RoomCredentials) { saveCredentials(next); setCredentials(next); credentialsRef.current = next; setEntryError('') }
  async function leaveRoom() {
    const saved = credentialsRef.current
    if (displayedRoom?.status === 'playing' && !window.confirm(t('leaveActiveConfirm'))) return
    if (socket.connected && saved) {
      await Promise.race([
        emitWithAck(socket, 'room:leave', {}),
        new Promise((resolve) => window.setTimeout(resolve, 1_500)),
      ])
    }
    clearSeat(saved?.code)
  }

  function changeChatDraft(nextDraft: string) {
    if (pendingChatAttemptRef.current?.text !== nextDraft.trim()) pendingChatAttemptRef.current = null
    setChatDraft(nextDraft)
    setChatSendError('')
  }

  function toggleChatPlayerMute(playerId: string, muted: boolean) {
    if (!displayedRoom) return
    setMutedChatPlayerIds((current) => {
      const next = muted ? [...new Set([...current, playerId])] : current.filter((id) => id !== playerId)
      localStorage.setItem(`thulla:chat-mutes:${displayedRoom.code}`, JSON.stringify(next))
      return next
    })
  }

  async function sendChatMessage(text: string) {
    if (!connected || !room) {
      setChatSendError(t('offlineChat'))
      throw new Error('Not connected')
    }
    const cleanText = text.trim()
    const attempt = chatAttemptFor(cleanText, pendingChatAttemptRef.current, () => crypto.randomUUID())
    pendingChatAttemptRef.current = attempt
    const response = await emitWithAck<ChatMessage>(socket, 'room:chat:send', attempt)
    if (!response.ok || !response.data) {
      const delivered = chatMessagesRef.current.some((message) => message.clientMessageId === attempt.clientMessageId)
      if (delivered) {
        pendingChatAttemptRef.current = null
        setChatSendError('')
        return
      }
      setChatSendError(response.error ?? t('chatSendFailed'))
      throw new Error(response.error ?? 'Chat send failed')
    }
    const next = mergeChatMessages(chatMessagesRef.current, [response.data])
    chatMessagesRef.current = next
    setChatMessages(next)
    pendingChatAttemptRef.current = null
    setChatSendError('')
  }

  async function sendTableReaction(reactionId: string) {
    if (!REACTIONS.includes(reactionId as Reaction)) throw new Error('Unknown reaction')
    const response = await emitWithAck(socket, 'room:react', { reaction: reactionId })
    if (!response.ok) throw new Error(response.error ?? 'Reaction send failed')
  }

  const tableTalkControl = displayedRoom && tableTalkAvailable && (quickTalkEnabled || textTalkEnabled) ? <TableTalk
    className={`table-talk--${displayedRoom.status === 'lobby' ? 'lobby table-talk--in-header' : 'game'}`}
    open={tableTalkOpen}
    unreadCount={unreadChatCount}
    messages={chatMessages}
    participants={tableTalkParticipants}
    myPlayerId={displayedRoom.yourPlayerId}
    quickReactions={tableTalkReactions}
    mutedPlayerIds={mutedChatPlayerIds}
    isMyTurn={isMyTurn}
    quickEnabled={quickTalkEnabled}
    chatEnabled={textTalkEnabled}
    sendDisabled={!connected || Boolean(qaRoom)}
    initialTab={textTalkEnabled ? 'chat' : 'quick'}
    labels={tableTalkLabels}
    formatTime={formatChatTime}
    draft={chatDraft}
    sendError={!qaRoom && !connected ? t('offlineChat') : chatSendError || null}
    onOpen={openTableTalk}
    onClose={() => setTableTalkOpen(false)}
    onReturnToCards={() => window.requestAnimationFrame(() => document.getElementById('game-v2-hand')?.focus())}
    onDraftChange={changeChatDraft}
    onClearSendError={() => setChatSendError('')}
    onSendMessage={sendChatMessage}
    onSendQuickReaction={sendTableReaction}
    onTogglePlayerMute={toggleChatPlayerMute}
    onMessagesRead={(sequence) => setLastReadChatSequence((current) => Math.max(current, sequence))}
  /> : null

  const partySupported = serverCapabilities.includes('party-v1')
  const partyBetaRequested = new URLSearchParams(window.location.search).get('partyBeta') === '1'
  const partyDiscoverable = partySupported && (partyAvailability === 'public' || partyAvailability === 'beta' && partyBetaRequested)

  if (partyBoardOpen) return <Suspense fallback={<main className="loading-screen"><Logo/><span className="spinner spinner--large"/><p>{t('openingPartyBoard')}</p></main>}><PartyBoardExperience serverUrl={SERVER_URL} language={language} onLanguage={setLanguage} t={t} fixture={partyQaFixture} onExit={() => setPartyBoardOpen(false)}/></Suspense>

  if (reconnecting && !displayedRoom) return <main className="loading-screen"><Logo/><span className="spinner spinner--large"/><div className="loading-screen__copy"><p>{t('findingSeat')}</p>{restoreElapsed >= 8 ? <small>{t('findingSeatElapsed', { count: restoreElapsed })}</small> : null}</div>{restoreElapsed >= 12 ? <div className="loading-screen__actions"><button className="button button--primary" type="button" onClick={() => { socket.disconnect(); socket.connect(); setRestoreElapsed(0) }}>{t('retryConnection')}</button><button className="button button--secondary" type="button" onClick={() => clearSeat(credentials?.code, t('seatRestoreAbandoned'))}>{t('forgetSavedSeat')}</button></div> : null}</main>

  return <>
    {!displayedRoom ? <><Landing socket={socket} connected={connected} inviteCode={inviteCode} partySupported={partySupported} partyDiscoverable={partyDiscoverable} t={t} language={language} onLanguage={setLanguage} onEntered={entered} onOpenPartyBoard={() => setPartyBoardOpen(true)} onOpenRules={openRules} onOpenTutorial={openTutorial} onToast={showToast}/>{entryError ? <div className="entry-banner" role="alert">{entryError}</div> : null}</> : displayedRoom.status === 'lobby' ? <Lobby room={displayedRoom} socket={socket} t={t} language={language} chatSupported={chatSupported} tableTalkControl={tableTalkControl} onLanguage={setLanguage} onOpenRules={openRules} onLeave={leaveRoom} onToast={showToast}/> : <GameTable room={displayedRoom} socket={socket} connected={connected} t={t} language={language} chatSupported={chatSupported} onLanguage={setLanguage} preferences={preferences} onPreference={updatePreference} liveReaction={visibleReaction} onOpenRules={openRules} onLeave={leaveRoom} onToast={showToast}/>}
    {displayedRoom?.status === 'lobby' && visibleReaction && !preferences.reactionsMuted ? <div className={`table-talk__lobby-reaction ${tableTalkOpen ? 'is-drawer-open' : ''}`} role="status" aria-live="polite"><b><bdi dir="auto">{visibleReaction.playerId === displayedRoom.yourPlayerId ? t('you') : visibleReaction.playerName}</bdi></b><span>{reactionLabel(visibleReaction.reaction, t)}</span></div> : null}
    {displayedRoom?.status !== 'lobby' ? tableTalkControl : null}
    {!auxiliaryOverlaysBlocked && rulesOpen ? <RulesModal t={t} onClose={() => setRulesOpen(false)}/> : null}
    {!auxiliaryOverlaysBlocked && tutorialOpen ? <Tutorial t={t} onClose={() => setTutorialOpen(false)} onComplete={() => updatePreference('tutorialComplete', true)}/> : null}
    {toast ? <div className={`toast toast--${toast.tone}`} data-tone={toast.tone} role={toast.tone === 'error' ? 'alert' : 'status'} aria-live={toast.tone === 'error' ? 'assertive' : 'polite'}>{toast.tone === 'success' ? <Check size={18}/> : toast.tone === 'error' ? <CircleAlert size={18}/> : <Info size={18}/>} {toast.message}</div> : null}
  </>
}
