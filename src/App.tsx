import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode, type SVGProps } from 'react'
import { io, type Socket } from 'socket.io-client'
import { PROTOCOL_VERSION, type RoomCredentials, type ServerHello } from '../shared/game'
import GameTable from './components/GameTable'
import { AccessibleDialog } from './components/AccessibleDialog'
import { Tutorial } from './components/Tutorial'
import { languageDirection, translate, type Language, type TFunction } from './i18n'
import { usePreferences } from './preferences'
import { DEFAULT_ROOM_SETTINGS, roomSettings, type ClientPlayerView, type ClientRoomView, type TableReaction } from './protocol'
import { makeQaRoom } from './qaFixtures'
import { emitWithAck } from './socket'

type IconProps = SVGProps<SVGSVGElement> & { size?: number }

function Icon({ size = 24, children, ...props }: IconProps & { children: ReactNode }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden={props['aria-label'] ? undefined : true} {...props}>{children}</svg>
}

const BookOpen = (props: IconProps) => <Icon {...props}><path d="M2 4h6a4 4 0 0 1 4 4v12a4 4 0 0 0-4-4H2z"/><path d="M22 4h-6a4 4 0 0 0-4 4v12a4 4 0 0 1 4-4h6z"/></Icon>
const Bot = (props: IconProps) => <Icon {...props}><rect x="4" y="7" width="16" height="13" rx="3"/><path d="M12 3v4M8 12h.01M16 12h.01M8 16h8"/></Icon>
const Check = (props: IconProps) => <Icon {...props}><path d="m5 12 4 4L19 6"/></Icon>
const ChevronRight = (props: IconProps) => <Icon {...props}><path d="m9 18 6-6-6-6"/></Icon>
const Clock3 = (props: IconProps) => <Icon {...props}><circle cx="12" cy="12" r="9"/><path d="M12 7v5h4"/></Icon>
const Copy = (props: IconProps) => <Icon {...props}><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></Icon>
const Crown = (props: IconProps) => <Icon {...props}><path d="m3 6 4 5 5-7 5 7 4-5-2 12H5z"/><path d="M5 21h14"/></Icon>
const LogOut = (props: IconProps) => <Icon {...props}><path d="M10 17l5-5-5-5"/><path d="M15 12H3"/><path d="M15 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4"/></Icon>
const Play = (props: IconProps) => <Icon {...props}><path d="m7 4 13 8L7 20z"/></Icon>
const Share2 = (props: IconProps) => <Icon {...props}><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 10.5 6.8-4M8.6 13.5l6.8 4"/></Icon>
const ShieldCheck = (props: IconProps) => <Icon {...props}><path d="M12 3 4 6v5c0 5 3.4 8.5 8 10 4.6-1.5 8-5 8-10V6z"/><path d="m8.5 12 2.2 2.2 4.8-5"/></Icon>
const Trash = (props: IconProps) => <Icon {...props}><path d="M3 6h18M8 6V4h8v2M6 6l1 15h10l1-15M10 11v5M14 11v5"/></Icon>
const Users = (props: IconProps) => <Icon {...props}><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/></Icon>
const Wifi = (props: IconProps) => <Icon {...props}><path d="M5 12.6a10 10 0 0 1 14 0M2 9.3a15 15 0 0 1 20 0M8.5 16a5 5 0 0 1 7 0"/><circle cx="12" cy="20" r="1" fill="currentColor" stroke="none"/></Icon>
const WifiOff = (props: IconProps) => <Icon {...props}><path d="m2 2 20 20M8.5 16a5 5 0 0 1 5.7-.9M5 12.6a10 10 0 0 1 4-2M2 9.3A15 15 0 0 1 6 7M14 7a15 15 0 0 1 8 2.3"/><circle cx="12" cy="20" r="1" fill="currentColor" stroke="none"/></Icon>
const X = (props: IconProps) => <Icon {...props}><path d="M18 6 6 18M6 6l12 12"/></Icon>

const DEFAULT_SERVER = window.location.hostname === 'localhost' ? 'http://localhost:3001' : 'https://bhabhi-thulla-server.onrender.com'
const SERVER_URL = import.meta.env.VITE_SERVER_URL || DEFAULT_SERVER
const QA_FIXTURES_ENABLED = import.meta.env.DEV || import.meta.env.VITE_ENABLE_QA_FIXTURES === 'true'
const LANGUAGES: Language[] = ['en', 'roman', 'ur']

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
  window.history.replaceState({}, '', `${window.location.pathname}?room=${credentials.code}`)
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

function Landing({ socket, connected, inviteCode, t, language, onLanguage, onEntered, onOpenRules, onOpenTutorial, onToast }: {
  socket: Socket; connected: boolean; inviteCode: string; t: TFunction; language: Language; onLanguage: (language: Language) => void
  onEntered: (credentials: RoomCredentials) => void; onOpenRules: () => void; onOpenTutorial: () => void; onToast: (message: string) => void
}) {
  const [mode, setMode] = useState<'create' | 'join'>(inviteCode ? 'join' : 'create')
  const [name, setName] = useState(() => localStorage.getItem('thulla:name') ?? '')
  const [code, setCode] = useState(inviteCode)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function enterRoom(createPractice = false) {
    setError('')
    if (!connected) { setError(t('connectionWait')); return }
    setLoading(true)
    const cleanName = name.trim() || (createPractice ? t('player') : '')
    localStorage.setItem('thulla:name', cleanName)
    const response = mode === 'create' || createPractice
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
        if (!start.ok) onToast(start.error ?? t('practiceCreated'))
      } else onToast(first.error ?? second.error ?? t('roomCreatedBots'))
    }
    setLoading(false)
  }

  async function submit(event: FormEvent) { event.preventDefault(); await enterRoom(false) }

  return <main className="landing-shell">
    <nav className="landing-nav"><Logo compact/><div className="landing-nav__actions"><LanguageSelect language={language} onChange={onLanguage} t={t}/><button className="text-button" type="button" onClick={onOpenRules}><BookOpen size={18}/> {t('howToPlay')}</button></div></nav>
    <div className="landing-grid">
      <section className="mobile-hero-intro">
        <div className="hero-kicker"><span className="live-dot"/> {t('privateRooms')}</div>
        <h1>{t('heroLineOne')}<br/><em>{t('heroLineTwo').split(' ')[0]}</em> {t('heroLineTwo').split(' ').slice(1).join(' ')}</h1>
        <p>{t('heroDescription')}</p>
      </section>
      <section className="hero-copy">
        <div className="hero-kicker"><span className="live-dot"/> {t('privateRooms')}</div>
        <h1>{t('heroLineOne')}<br/><em>{t('heroLineTwo').split(' ')[0]}</em> {t('heroLineTwo').split(' ').slice(1).join(' ')}</h1>
        <p>{t('heroDescription')}</p>
        <div className="hero-cards" aria-hidden="true"><div className="hero-card hero-card--one"><span>A</span><i>♠</i></div><div className="hero-card hero-card--two"><span>K</span><i>♥</i></div><div className="hero-card hero-card--three"><span>7</span><i>♦</i></div></div>
        <div className="trust-row"><span><ShieldCheck size={18}/> {t('serverChecked')}</span><span><Users size={18}/> {t('playerCount')}</span><span><Clock3 size={18}/> {t('roundLength')}</span></div>
      </section>
      <section className="join-card" aria-labelledby="join-heading">
        <div className="connection-label" data-connected={connected}>{connected ? <Wifi size={16}/> : <WifiOff size={16}/>} {connected ? t('serverReady') : t('wakingServer')}</div>
        <span className="eyebrow">{t('pullUpChair')}</span><h2 id="join-heading">{mode === 'create' ? t('startPrivate') : t('joinFriends')}</h2>
        <div className="mode-tabs" aria-label={t('chooseRoomAction')}><button type="button" aria-pressed={mode === 'create'} onClick={() => { setMode('create'); setError('') }}>{t('createRoom')}</button><button type="button" aria-pressed={mode === 'join'} onClick={() => { setMode('join'); setError('') }}>{t('joinRoom')}</button></div>
        <form onSubmit={submit}>
          <label htmlFor="player-name">{t('yourName')}</label><input id="player-name" value={name} onChange={(event) => setName(event.target.value)} maxLength={20} minLength={2} autoComplete="nickname" placeholder="e.g. Hamza" required/>
          {mode === 'join' ? <><label htmlFor="room-code">{t('roomCode')}</label><input id="room-code" className="code-input" value={code} onChange={(event) => setCode(event.target.value.replace(/[^a-z0-9]/gi, '').toUpperCase().slice(0, 5))} maxLength={5} placeholder="ABCDE" autoCapitalize="characters" required/></> : null}
          {error ? <p className="form-error" role="alert">{error}</p> : null}
          <button className="button button--primary button--wide" type="submit" disabled={loading || !connected}>{loading ? <><span className="spinner"/> {t('takingSeat')}</> : <>{mode === 'create' ? t('createPrivateRoom') : t('joinTable')} <ChevronRight size={20}/></>}</button>
        </form>
        <div className="practice-actions"><button className="button button--secondary button--wide" type="button" disabled={loading || !connected} onClick={() => void enterRoom(true)}><Bot size={20}/> {t('practiceBots')}</button><button className="text-button" type="button" onClick={onOpenTutorial}><BookOpen size={18}/> {t('interactiveTutorial')}</button></div>
        <p className="privacy-note">{t('privacy')}</p>
      </section>
    </div>
  </main>
}

function PlayerSeat({ player, host, busy, t, onKick, onRemoveBot }: { player: ClientPlayerView; host: boolean; busy: boolean; t: TFunction; onKick: (id: string) => void; onRemoveBot: (id: string) => void }) {
  const initials = player.name.split(' ').map((part) => part[0]).join('').slice(0, 2).toUpperCase()
  const status = player.ready ? t('playerReady') : player.reconnecting || !player.connected ? t('reconnecting') : t('notReady')
  return <div className={`player-seat ${player.ready ? 'is-ready' : ''} ${!player.connected ? 'is-offline' : ''}`}>
    <div className="player-seat__avatar">{player.isBot ? <Bot size={19}/> : initials}</div><div className="player-seat__copy"><b>{player.name}{player.isYou ? ` (${t('you')})` : ''}</b><span>{player.isBot ? `${t('bot')} · ${status}` : status}</span></div>
    {player.isHost ? <Crown className="host-crown" size={16} aria-label={t('host')}/> : null}
    {player.ready ? <Check className="ready-check" size={18} aria-label={t('playerReady')}/> : null}
    {host && !player.isYou && !player.isHost ? <button className="seat-remove" type="button" disabled={busy} aria-label={`${player.isBot ? t('removeBot') : t('removePlayer')}: ${player.name}`} onClick={() => player.isBot ? onRemoveBot(player.id) : onKick(player.id)}><Trash size={17}/></button> : null}
  </div>
}

function Lobby({ room, socket, t, language, onLanguage, onOpenRules, onLeave, onToast }: { room: ClientRoomView; socket: Socket; t: TFunction; language: Language; onLanguage: (language: Language) => void; onOpenRules: () => void; onLeave: () => void; onToast: (message: string) => void }) {
  const [busy, setBusy] = useState(false)
  const me = room.players.find((player) => player.isYou)!
  const settings = roomSettings(room)
  const connectedCount = room.players.filter((player) => player.connected || player.isBot).length
  const inviteUrl = `${window.location.origin}${window.location.pathname}?room=${room.code}`
  const scores = room.session?.scores ?? []

  async function act(event: string, payload: unknown, fallback: string) {
    setBusy(true); const response = await emitWithAck(socket, event, payload); setBusy(false); if (!response.ok) onToast(response.error ?? fallback)
  }
  async function copyInvite() {
    const message = t('inviteMessage', { url: inviteUrl })
    try { if (navigator.share) await navigator.share({ title: 'Bhabhi Thulla', text: message, url: inviteUrl }); else await navigator.clipboard.writeText(message); onToast(t('inviteCopied')) }
    catch { try { await navigator.clipboard.writeText(message); onToast(t('inviteCopied')) } catch { onToast(room.code) } }
  }
  const participants = room.players.filter((player) => player.isBot || player.connected)
  const allReady = participants.length >= room.minPlayers && participants.every((player) => player.isBot || player.ready)

  return <main className="lobby-shell">
    <header className="app-header"><Logo compact/><div className="header-actions"><LanguageSelect language={language} onChange={onLanguage} t={t}/><IconButton label={t('howToPlay')} onClick={onOpenRules}><BookOpen size={20}/></IconButton><IconButton label={t('leaveTable')} onClick={onLeave}><LogOut size={20}/></IconButton></div></header>
    <section className="lobby-card lobby-card--expanded">
      <div className="lobby-card__intro"><span className="eyebrow">{t('pullUpChair')}</span><h1>{t('waitingGang')}</h1><p>{t('lobbyDescription')}</p></div>
      <button className="room-code" type="button" onClick={() => void copyInvite()} aria-label={t('copyInviteRoom', { code: room.code })}><span>{t('roomCode')}</span><b>{room.code}</b><Copy size={19}/></button>
      <div className="seat-progress" aria-label={t('seatsFilled', { count: connectedCount, total: room.maxPlayers })}>{Array.from({ length: room.maxPlayers }, (_, index) => <i key={index} className={index < connectedCount ? 'is-filled' : ''}/>)}</div>
      <div className="lobby-content-grid">
        <div>
          <div className="lobby-players">{room.players.map((player) => <PlayerSeat key={player.id} player={player} host={me.isHost} busy={busy} t={t} onKick={(playerId) => void act('room:kick', { playerId }, t('removePlayerFailed'))} onRemoveBot={(playerId) => void act('room:remove-bot', { playerId }, t('removeBotFailed'))}/>)}{Array.from({ length: Math.max(0, 3 - room.players.length) }, (_, index) => <div className="empty-seat" key={index}><span>+</span><p>{t('waitingPlayer')}</p></div>)}</div>
          {me.isHost && settings.allowBots && room.players.length < room.maxPlayers ? <button className="button button--secondary lobby-add-bot" type="button" disabled={busy} onClick={() => void act('room:add-bot', {}, t('addBotFailed'))}><Bot size={19}/> {t('addBot')}</button> : null}
        </div>
        <fieldset className="lobby-settings" disabled={!me.isHost || busy}><legend>{t('tableSettings')}</legend>
          <label><span>{t('turnTimer')}</span><select value={settings.turnSeconds} onChange={(event) => void act('room:settings', { turnSeconds: Number(event.target.value) }, t('settingsUpdateFailed'))}><option value="20">20s</option><option value="35">35s</option><option value="60">60s</option></select></label>
          <label className="switch-row"><span>{t('allowBots')}</span><input type="checkbox" checked={settings.allowBots} onChange={(event) => void act('room:settings', { allowBots: event.target.checked }, t('settingsUpdateFailed'))}/></label>
          <label className="switch-row"><span>{t('reactions')}</span><input type="checkbox" checked={settings.reactionsEnabled} onChange={(event) => void act('room:settings', { reactionsEnabled: event.target.checked }, t('settingsUpdateFailed'))}/></label>
          <label className="switch-row"><span>{t('tutorialHints')}</span><input type="checkbox" checked={settings.tutorialHints} onChange={(event) => void act('room:settings', { tutorialHints: event.target.checked }, t('settingsUpdateFailed'))}/></label>
          {!me.isHost ? <small>{t('onlyHostSettings')}</small> : null}
        </fieldset>
      </div>
      {scores.length ? <div className="lobby-score-preview"><b>{t('sessionScore')}</b><span>{t('round', { count: room.session?.roundNumber ?? 1 })}</span>{scores.slice(0, 3).map((score) => <p key={score.playerId}><span>{score.playerName}</span><b>{score.escapes} {t('gotAway')} · {score.bhabhiCount} {t('bhabhi')}</b></p>)}</div> : null}
      <div className="lobby-actions"><button className="button button--secondary" type="button" onClick={() => void copyInvite()}><Share2 size={19}/> {t('copyInvite')}</button><button className={`button ${me.ready ? 'button--secondary' : 'button--primary'}`} type="button" disabled={busy} onClick={() => void act('room:ready', { ready: !me.ready }, t('readyUpdateFailed'))}><Check size={19}/> {me.ready ? t('notReady') : t('playerReady')}</button>{me.isHost ? <button className="button button--primary" type="button" disabled={!room.canStart || !allReady || busy} onClick={() => void act('game:start', {}, t('startFailed'))}><Play size={19} fill="currentColor"/> {busy ? t('shuffling') : t('dealCards')}</button> : <p className="host-wait">{t('waitingHost')}</p>}</div>
      <p className="lobby-hint"><Users size={17}/>{connectedCount < 3 ? t('needPlayers', { count: 3 - connectedCount }) : allReady ? t('readyToDeal') : t('needReady')}</p>
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
  const [connected, setConnected] = useState(false)
  const [reconnecting, setReconnecting] = useState(Boolean(initialCredentials))
  const [entryError, setEntryError] = useState('')
  const [rulesOpen, setRulesOpen] = useState(false)
  const [tutorialOpen, setTutorialOpen] = useState(false)
  const [toast, setToast] = useState('')
  const [reaction, setReaction] = useState<TableReaction | null>(null)
  const [language, setLanguage] = useState<Language>(getSavedLanguage)
  const languageRef = useRef(language)
  const { preferences, updatePreference } = usePreferences()
  const t = useMemo<TFunction>(() => (key, values) => translate(language, key, values), [language])
  const clearSeat = useCallback((code: string | undefined, message = '') => {
    if (code) localStorage.removeItem(`thulla:seat:${code}`)
    credentialsRef.current = null
    setCredentials(null)
    setRoom(null)
    setReconnecting(false)
    setEntryError(message)
    clearRoomFromUrl()
  }, [])

  useEffect(() => { languageRef.current = language; localStorage.setItem('thulla:language', language); document.documentElement.lang = language === 'ur' ? 'ur' : 'en'; document.documentElement.dir = languageDirection(language) }, [language])
  useEffect(() => { credentialsRef.current = credentials }, [credentials])
  useEffect(() => {
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
      if (hello?.protocolVersion && String(hello.protocolVersion) !== PROTOCOL_VERSION) rejectProtocol()
    }
    const onState = (state: ClientRoomView) => {
      if (String(state.protocolVersion) !== PROTOCOL_VERSION) { rejectProtocol(state.code); return }
      setRoom({ ...state, settings: state.settings ?? DEFAULT_ROOM_SETTINGS })
    }
    const onReaction = (next: TableReaction) => setReaction(next)
    const onKicked = ({ code }: { code?: string }) => {
      clearSeat(code ?? credentialsRef.current?.code, 'The host removed you from that room. You can join another table.')
    }
    socket.on('connect', restoreSeat); socket.on('disconnect', onDisconnect); socket.on('server:hello', onHello); socket.on('room:state', onState); socket.on('room:reaction', onReaction); socket.on('room:kicked', onKicked)
    if (socket.connected) void restoreSeat(); else socket.connect()
    return () => { socket.off('connect', restoreSeat); socket.off('disconnect', onDisconnect); socket.off('server:hello', onHello); socket.off('room:state', onState); socket.off('room:reaction', onReaction); socket.off('room:kicked', onKicked); socket.disconnect() }
  }, [clearSeat, socket])
  useEffect(() => { if (!toast) return; const timeout = window.setTimeout(() => setToast(''), 3500); return () => window.clearTimeout(timeout) }, [toast])
  useEffect(() => { if (!reaction) return; const timeout = window.setTimeout(() => setReaction(null), 2800); return () => window.clearTimeout(timeout) }, [reaction?.id])

  function entered(next: RoomCredentials) { saveCredentials(next); setCredentials(next); credentialsRef.current = next; setEntryError('') }
  async function leaveRoom() {
    const saved = credentialsRef.current
    if (socket.connected && saved) {
      await Promise.race([
        emitWithAck(socket, 'room:leave', {}),
        new Promise((resolve) => window.setTimeout(resolve, 1_500)),
      ])
    }
    clearSeat(saved?.code)
  }

  const displayedRoom = qaRoom ?? room
  if (reconnecting && !displayedRoom) return <main className="loading-screen"><Logo/><span className="spinner spinner--large"/><p>{t('findingSeat')}</p></main>

  return <>
    {!displayedRoom ? <><Landing socket={socket} connected={connected} inviteCode={inviteCode} t={t} language={language} onLanguage={setLanguage} onEntered={entered} onOpenRules={() => setRulesOpen(true)} onOpenTutorial={() => setTutorialOpen(true)} onToast={setToast}/>{entryError ? <div className="entry-banner" role="alert">{entryError}</div> : null}</> : displayedRoom.status === 'lobby' ? <Lobby room={displayedRoom} socket={socket} t={t} language={language} onLanguage={setLanguage} onOpenRules={() => setRulesOpen(true)} onLeave={leaveRoom} onToast={setToast}/> : <GameTable room={displayedRoom} socket={socket} connected={connected} t={t} language={language} onLanguage={setLanguage} preferences={preferences} onPreference={updatePreference} liveReaction={reaction} onOpenRules={() => setRulesOpen(true)} onLeave={leaveRoom} onToast={setToast}/>}
    {rulesOpen ? <RulesModal t={t} onClose={() => setRulesOpen(false)}/> : null}
    {tutorialOpen ? <Tutorial t={t} onClose={() => setTutorialOpen(false)} onComplete={() => updatePreference('tutorialComplete', true)}/> : null}
    {toast ? <div className="toast" role="status" aria-live="polite"><Check size={18}/> {toast}</div> : null}
  </>
}
