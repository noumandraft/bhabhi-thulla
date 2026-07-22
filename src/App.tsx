import { useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent, type ReactNode, type SVGProps } from 'react'
import { io, type Socket } from 'socket.io-client'
import {
  sortCards,
  suitLabel,
  suitSymbol,
  type Ack,
  type Card as CardType,
  type RoomCredentials,
  type RoomView,
} from '../shared/game'

type IconProps = SVGProps<SVGSVGElement> & { size?: number }

function Icon({ size = 24, children, ...props }: IconProps & { children: ReactNode }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden={props['aria-label'] ? undefined : true} {...props}>{children}</svg>
}

const BookOpen = (props: IconProps) => <Icon {...props}><path d="M2 4h6a4 4 0 0 1 4 4v12a4 4 0 0 0-4-4H2z"/><path d="M22 4h-6a4 4 0 0 0-4 4v12a4 4 0 0 1 4-4h6z"/></Icon>
const Check = (props: IconProps) => <Icon {...props}><path d="m5 12 4 4L19 6"/></Icon>
const ChevronRight = (props: IconProps) => <Icon {...props}><path d="m9 18 6-6-6-6"/></Icon>
const Clock3 = (props: IconProps) => <Icon {...props}><circle cx="12" cy="12" r="9"/><path d="M12 7v5h4"/></Icon>
const Copy = (props: IconProps) => <Icon {...props}><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></Icon>
const Crown = (props: IconProps) => <Icon {...props}><path d="m3 6 4 5 5-7 5 7 4-5-2 12H5z"/><path d="M5 21h14"/></Icon>
const HandCards = (props: IconProps) => <Icon {...props}><rect x="4" y="4" width="11" height="15" rx="2"/><path d="m9 8 2 2 2-2M15 8l3-1a2 2 0 0 1 2.5 1.4l1.4 5.3a2 2 0 0 1-1.4 2.5L15 17.7"/></Icon>
const LogOut = (props: IconProps) => <Icon {...props}><path d="M10 17l5-5-5-5"/><path d="M15 12H3"/><path d="M15 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4"/></Icon>
const Play = (props: IconProps) => <Icon {...props}><path d="m7 4 13 8L7 20z"/></Icon>
const RotateCcw = (props: IconProps) => <Icon {...props}><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></Icon>
const Share2 = (props: IconProps) => <Icon {...props}><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 10.5 6.8-4M8.6 13.5l6.8 4"/></Icon>
const ShieldCheck = (props: IconProps) => <Icon {...props}><path d="M12 3 4 6v5c0 5 3.4 8.5 8 10 4.6-1.5 8-5 8-10V6z"/><path d="m8.5 12 2.2 2.2 4.8-5"/></Icon>
const Users = (props: IconProps) => <Icon {...props}><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/></Icon>
const Wifi = (props: IconProps) => <Icon {...props}><path d="M5 12.6a10 10 0 0 1 14 0M2 9.3a15 15 0 0 1 20 0M8.5 16a5 5 0 0 1 7 0"/><circle cx="12" cy="20" r="1" fill="currentColor" stroke="none"/></Icon>
const WifiOff = (props: IconProps) => <Icon {...props}><path d="m2 2 20 20M8.5 16a5 5 0 0 1 5.7-.9M5 12.6a10 10 0 0 1 4-2M2 9.3A15 15 0 0 1 6 7M14 7a15 15 0 0 1 8 2.3"/><circle cx="12" cy="20" r="1" fill="currentColor" stroke="none"/></Icon>
const X = (props: IconProps) => <Icon {...props}><path d="M18 6 6 18M6 6l12 12"/></Icon>

const DEFAULT_SERVER = window.location.hostname === 'localhost'
  ? 'http://localhost:3001'
  : 'https://bhabhi-thulla-server.onrender.com'
const SERVER_URL = import.meta.env.VITE_SERVER_URL || DEFAULT_SERVER

function getInviteCode(): string {
  return new URLSearchParams(window.location.search).get('room')?.toUpperCase().slice(0, 5) ?? ''
}

function getSavedCredentials(code: string): RoomCredentials | null {
  if (!code) return null
  try {
    const value = localStorage.getItem(`thulla:seat:${code}`)
    return value ? (JSON.parse(value) as RoomCredentials) : null
  } catch {
    return null
  }
}

function saveCredentials(credentials: RoomCredentials): void {
  localStorage.setItem(`thulla:seat:${credentials.code}`, JSON.stringify(credentials))
  window.history.replaceState({}, '', `${window.location.pathname}?room=${credentials.code}`)
}

function emitWithAck<T>(socket: Socket, event: string, payload: unknown): Promise<Ack<T>> {
  return new Promise((resolve) => {
    const timeout = window.setTimeout(() => resolve({ ok: false, error: 'The server took too long to respond. Try again.' }), 12_000)
    socket.emit(event, payload, (response: Ack<T>) => {
      window.clearTimeout(timeout)
      resolve(response)
    })
  })
}

function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`logo ${compact ? 'logo--compact' : ''}`} aria-label="Bhabhi Thulla">
      <span className="logo__mark" aria-hidden="true"><i>♠</i><i>♥</i></span>
      <span className="logo__words"><b>Bhabhi</b><strong>THULLA</strong></span>
    </div>
  )
}

function IconButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return <button className="icon-button" type="button" aria-label={label} title={label} onClick={onClick}>{children}</button>
}

function Card({ card, selectable = false, selected = false, disabled = false, onClick, small = false }: {
  card: CardType
  selectable?: boolean
  selected?: boolean
  disabled?: boolean
  onClick?: () => void
  small?: boolean
}) {
  const red = card.suit === 'hearts' || card.suit === 'diamonds'
  return (
    <button
      type="button"
      className={`playing-card ${red ? 'playing-card--red' : ''} ${selectable ? 'playing-card--selectable' : ''} ${selected ? 'is-selected' : ''} ${small ? 'playing-card--small' : ''}`}
      disabled={disabled}
      onClick={onClick}
      aria-label={`${card.rank} of ${suitLabel[card.suit]}${selected ? ', selected' : ''}`}
      aria-pressed={selectable ? selected : undefined}
    >
      <span className="playing-card__corner"><b>{card.rank}</b><i>{suitSymbol[card.suit]}</i></span>
      <span className="playing-card__suit" aria-hidden="true">{suitSymbol[card.suit]}</span>
      <span className="playing-card__corner playing-card__corner--bottom" aria-hidden="true"><b>{card.rank}</b><i>{suitSymbol[card.suit]}</i></span>
    </button>
  )
}

function RulesModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="modal-scrim" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="rules-sheet" role="dialog" aria-modal="true" aria-labelledby="rules-title">
        <div className="sheet-header">
          <div><span className="eyebrow">Pakistani classic</span><h2 id="rules-title">How to play</h2></div>
          <IconButton label="Close rules" onClick={onClose}><X size={22} /></IconButton>
        </div>
        <ol className="rules-list">
          <li><span>1</span><div><b>Ace opens</b><p>The player holding the Ace of Spades must play it first. Everyone plays once; the opening trick is always discarded.</p></div></li>
          <li><span>2</span><div><b>Move to the right</b><p>Play moves anticlockwise. After each card, the next turn belongs to the active player sitting on the right.</p></div></li>
          <li><span>3</span><div><b>Throw a thulla</b><p>If you cannot follow suit, play any card. The trick ends immediately and the highest card of the led suit picks up the pile.</p></div></li>
          <li><span>4</span><div><b>Keep the power</b><p>The highest card of the led suit leads next. If your last card wins a clean trick, you must draw from the waste and lead it—you cannot escape while holding the power.</p></div></li>
          <li><span>5</span><div><b>Take the right hand</b><p>When you have the power, before leading a new trick, you may take every card from the next active player on your right. That player gets away safely.</p></div></li>
          <li><span>6</span><div><b>Get away</b><p>Empty your hand without holding the next lead and you are safe. The last player left with cards is the Bhabhi.</p></div></li>
        </ol>
        <button className="button button--primary button--wide" type="button" onClick={onClose}>Samajh gaya</button>
      </section>
    </div>
  )
}

function Landing({ socket, connected, inviteCode, onEntered, onOpenRules }: {
  socket: Socket
  connected: boolean
  inviteCode: string
  onEntered: (credentials: RoomCredentials) => void
  onOpenRules: () => void
}) {
  const [mode, setMode] = useState<'create' | 'join'>(inviteCode ? 'join' : 'create')
  const [name, setName] = useState(() => localStorage.getItem('thulla:name') ?? '')
  const [code, setCode] = useState(inviteCode)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function submit(event: FormEvent) {
    event.preventDefault()
    setError('')
    if (!connected) {
      setError('Connecting to the game server. Please wait a moment.')
      return
    }
    setLoading(true)
    localStorage.setItem('thulla:name', name.trim())
    const response = mode === 'create'
      ? await emitWithAck<RoomCredentials>(socket, 'room:create', { name })
      : await emitWithAck<RoomCredentials>(socket, 'room:join', { name, code })
    setLoading(false)
    if (!response.ok || !response.data) {
      setError(response.error ?? 'Could not enter the room.')
      return
    }
    onEntered(response.data)
  }

  return (
    <main className="landing-shell">
      <nav className="landing-nav">
        <Logo compact />
        <button className="text-button" type="button" onClick={onOpenRules}><BookOpen size={18} /> How to play</button>
      </nav>
      <div className="landing-grid">
        <section className="hero-copy">
          <div className="hero-kicker"><span className="live-dot" /> Private rooms · No signup</div>
          <h1>Bach ke nikal.<br /><em>Bhabhi</em> na banna.</h1>
          <p>The Pakistani card-table classic, made for cousins, friends, and one more round after chai.</p>
          <div className="hero-cards" aria-hidden="true">
            <div className="hero-card hero-card--one"><span>A</span><i>♠</i></div>
            <div className="hero-card hero-card--two"><span>K</span><i>♥</i></div>
            <div className="hero-card hero-card--three"><span>7</span><i>♦</i></div>
          </div>
          <div className="trust-row">
            <span><ShieldCheck size={18} /> Server-checked moves</span>
            <span><Users size={18} /> 3–8 players</span>
            <span><Clock3 size={18} /> 5–15 min rounds</span>
          </div>
        </section>

        <section className="join-card" aria-labelledby="join-heading">
          <div className="connection-label" data-connected={connected}>
            {connected ? <Wifi size={16} /> : <WifiOff size={16} />}
            {connected ? 'Server ready' : 'Waking up server…'}
          </div>
          <span className="eyebrow">Pull up a chair</span>
          <h2 id="join-heading">{mode === 'create' ? 'Start a private table' : 'Join your friends'}</h2>
          <div className="mode-tabs" role="tablist" aria-label="Room action">
            <button type="button" role="tab" aria-selected={mode === 'create'} onClick={() => { setMode('create'); setError('') }}>Create room</button>
            <button type="button" role="tab" aria-selected={mode === 'join'} onClick={() => { setMode('join'); setError('') }}>Join room</button>
          </div>
          <form onSubmit={submit}>
            <label htmlFor="player-name">Your name</label>
            <input id="player-name" value={name} onChange={(event) => setName(event.target.value)} maxLength={20} minLength={2} autoComplete="nickname" placeholder="e.g. Hamza" required />
            {mode === 'join' && <>
              <label htmlFor="room-code">Room code</label>
              <input id="room-code" className="code-input" value={code} onChange={(event) => setCode(event.target.value.replace(/[^a-z0-9]/gi, '').toUpperCase().slice(0, 5))} maxLength={5} placeholder="ABCDE" autoCapitalize="characters" required />
            </>}
            {error && <p className="form-error" role="alert">{error}</p>}
            <button className="button button--primary button--wide" type="submit" disabled={loading || !connected}>
              {loading ? <><span className="spinner" /> Taking your seat…</> : <>{mode === 'create' ? 'Create private room' : 'Join the table'} <ChevronRight size={20} /></>}
            </button>
          </form>
          <p className="privacy-note">No account, ads, or public chat. Share the code only with people you know.</p>
        </section>
      </div>
    </main>
  )
}

function PlayerSeat({ player, isTurn }: { player: RoomView['players'][number]; isTurn: boolean }) {
  const initials = player.name.split(' ').map((part) => part[0]).join('').slice(0, 2).toUpperCase()
  return (
    <div className={`player-seat ${isTurn ? 'is-turn' : ''} ${player.escaped ? 'is-escaped' : ''} ${!player.connected ? 'is-offline' : ''}`}>
      <div className="player-seat__avatar">{player.escaped ? <Check size={19} strokeWidth={3} /> : initials}</div>
      <div className="player-seat__copy">
        <b>{player.name}{player.isYou ? ' (You)' : ''}</b>
        <span>{player.escaped ? 'Safe' : !player.connected ? 'Reconnecting…' : `${player.cardCount} card${player.cardCount === 1 ? '' : 's'}`}</span>
      </div>
      {player.isHost && <Crown className="host-crown" size={16} aria-label="Room host" />}
      {isTurn && <span className="turn-pulse" aria-label="Current turn" />}
    </div>
  )
}

function Lobby({ room, socket, onOpenRules, onLeave, onToast }: {
  room: RoomView
  socket: Socket
  onOpenRules: () => void
  onLeave: () => void
  onToast: (message: string) => void
}) {
  const [starting, setStarting] = useState(false)
  const connectedCount = room.players.filter((player) => player.connected).length
  const inviteUrl = `${window.location.origin}${window.location.pathname}?room=${room.code}`

  async function copyInvite() {
    try {
      await navigator.clipboard.writeText(`Join my Bhabhi Thulla room: ${inviteUrl}`)
      onToast('Invite link copied')
    } catch {
      await navigator.clipboard.writeText(room.code)
      onToast('Room code copied')
    }
  }

  async function start() {
    setStarting(true)
    const response = await emitWithAck(socket, 'game:start', {})
    setStarting(false)
    if (!response.ok) onToast(response.error ?? 'Could not start the match.')
  }

  return (
    <main className="lobby-shell">
      <header className="app-header">
        <Logo compact />
        <div className="header-actions">
          <IconButton label="How to play" onClick={onOpenRules}><BookOpen size={20} /></IconButton>
          <IconButton label="Leave room" onClick={onLeave}><LogOut size={20} /></IconButton>
        </div>
      </header>
      <section className="lobby-card">
        <div className="lobby-card__intro">
          <span className="eyebrow">Private table</span>
          <h1>Waiting for the gang</h1>
          <p>Share the code. The host can deal when at least three players are seated.</p>
        </div>
        <button className="room-code" type="button" onClick={copyInvite} aria-label={`Copy invite for room ${room.code}`}>
          <span>Room code</span><b>{room.code}</b><Copy size={19} />
        </button>
        <div className="seat-progress" aria-label={`${connectedCount} of ${room.maxPlayers} seats filled`}>
          {Array.from({ length: room.maxPlayers }, (_, index) => <i key={index} className={index < connectedCount ? 'is-filled' : ''} />)}
        </div>
        <div className="lobby-players">
          {room.players.map((player) => <PlayerSeat key={player.id} player={player} isTurn={false} />)}
          {Array.from({ length: Math.max(0, 3 - room.players.length) }, (_, index) => (
            <div className="empty-seat" key={index}><span>+</span><p>Waiting for player</p></div>
          ))}
        </div>
        <div className="lobby-actions">
          <button className="button button--secondary" type="button" onClick={copyInvite}><Share2 size={19} /> Copy invite</button>
          {room.players.find((player) => player.isYou)?.isHost ? (
            <button className="button button--primary" type="button" onClick={start} disabled={!room.canStart || starting}>
              {starting ? <><span className="spinner" /> Shuffling…</> : <><Play size={19} fill="currentColor" /> Deal the cards</>}
            </button>
          ) : <p className="host-wait">Waiting for the host to deal…</p>}
        </div>
        {connectedCount < 3 && <p className="lobby-hint"><Users size={17} /> Invite {3 - connectedCount} more player{3 - connectedCount === 1 ? '' : 's'} to begin.</p>}
      </section>
    </main>
  )
}

function TurnClock({ endsAt }: { endsAt: number | null }) {
  const [seconds, setSeconds] = useState(35)
  useEffect(() => {
    const update = () => setSeconds(Math.max(0, Math.ceil(((endsAt ?? Date.now()) - Date.now()) / 1000)))
    update()
    const interval = window.setInterval(update, 250)
    return () => window.clearInterval(interval)
  }, [endsAt])
  return <span className={`turn-clock ${seconds <= 8 ? 'is-low' : ''}`}><Clock3 size={15} /> {seconds}s</span>
}

function GameTable({ room, socket, connected, onOpenRules, onLeave, onToast }: {
  room: RoomView
  socket: Socket
  connected: boolean
  onOpenRules: () => void
  onLeave: () => void
  onToast: (message: string) => void
}) {
  const game = room.game!
  const me = room.players.find((player) => player.isYou)!
  const currentPlayer = room.players.find((player) => player.id === game.currentTurnId)
  const loser = room.players.find((player) => player.id === game.loserId)
  const takeTarget = room.players.find((player) => player.id === game.takeTargetId)
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null)
  const [playing, setPlaying] = useState(false)
  const [taking, setTaking] = useState(false)
  const [takeConfirmOpen, setTakeConfirmOpen] = useState(false)
  const [activityOpen, setActivityOpen] = useState(false)
  const legalIds = new Set(game.legalCardIds)
  const isMyTurn = game.currentTurnId === me.id

  useEffect(() => {
    if (selectedCardId && (!game.hand.some((card) => card.id === selectedCardId) || !legalIds.has(selectedCardId))) setSelectedCardId(null)
  }, [game.hand, game.legalCardIds, selectedCardId])

  useEffect(() => {
    if (!game.canTakeRightHand) setTakeConfirmOpen(false)
  }, [game.canTakeRightHand])

  async function playSelected() {
    if (!selectedCardId || !isMyTurn) return
    setPlaying(true)
    const response = await emitWithAck(socket, 'game:play', { cardId: selectedCardId })
    setPlaying(false)
    if (!response.ok) onToast(response.error ?? 'That card could not be played.')
    else setSelectedCardId(null)
  }

  async function restart() {
    const response = await emitWithAck(socket, 'game:start', {})
    if (!response.ok) onToast(response.error ?? 'Could not start another round.')
  }

  async function takeRightHand() {
    if (!game.canTakeRightHand || !takeTarget) return
    setTaking(true)
    const response = await emitWithAck(socket, 'game:take-right', {})
    setTaking(false)
    setTakeConfirmOpen(false)
    if (!response.ok) onToast(response.error ?? 'Could not take the right-hand player’s cards.')
    else onToast(`${takeTarget.name} got away. Their cards are now in your hand.`)
  }

  const tableMessage = room.status === 'finished'
    ? `${loser?.name ?? 'A player'} is the Bhabhi`
    : game.firstTrick
      ? game.trick.length === 0 ? 'Ace of Spades opens' : 'Opening trick — everyone plays'
      : isMyTurn ? game.canTakeRightHand ? 'Your turn — lead or take the right hand' : 'Your turn — choose a card' : `${currentPlayer?.name ?? 'Player'} is thinking…`

  return (
    <main className="game-shell">
      <header className="game-header">
        <Logo compact />
        <button className="game-room-code" type="button" onClick={() => navigator.clipboard.writeText(room.code)}><span>Room</span> {room.code}</button>
        <div className="game-header__right">
          <span className={`socket-status ${connected ? 'is-online' : ''}`} title={connected ? 'Connected' : 'Reconnecting'}>{connected ? <Wifi size={17} /> : <WifiOff size={17} />}</span>
          <IconButton label="How to play" onClick={onOpenRules}><BookOpen size={20} /></IconButton>
          <IconButton label="Leave table" onClick={onLeave}><LogOut size={20} /></IconButton>
        </div>
      </header>

      <section className="opponent-rail" aria-label="Players">
        {room.players.filter((player) => !player.isYou).map((player) => (
          <PlayerSeat key={player.id} player={player} isTurn={player.id === game.currentTurnId} />
        ))}
      </section>

      <div className="table-layout">
        <section className="felt-table" aria-label="Card table">
          <div className="table-status" aria-live="polite">
            <span>{tableMessage}</span>
            {room.status === 'playing' && <TurnClock endsAt={game.turnEndsAt} />}
          </div>

          <div className="pile-zone">
            <div className="waste-stack" aria-label={`${game.wasteCount} cards in the waste pile`}>
              <div className="card-back" /><span>{game.wasteCount}<small>waste</small></span>
            </div>
            <div className="current-trick" aria-label="Current trick">
              {game.trick.length === 0 ? (
                <div className="empty-trick"><span>♠</span><p>Lead any suit</p></div>
              ) : game.trick.map((entry, index) => (
                <div className="trick-entry" key={`${entry.playerId}-${entry.card.id}`} style={{ '--offset': index } as CSSProperties}>
                  <Card card={entry.card} small />
                  <span>{entry.playerId === me.id ? 'You' : entry.playerName}</span>
                </div>
              ))}
            </div>
          </div>

          {game.leadSuit && <div className={`lead-suit lead-suit--${game.leadSuit}`}><span>{suitSymbol[game.leadSuit]}</span> Follow {suitLabel[game.leadSuit]}</div>}

          <button className="activity-toggle" type="button" onClick={() => setActivityOpen((open) => !open)} aria-expanded={activityOpen}>
            <Clock3 size={17} /> Match log
          </button>
          <aside className={`activity-panel ${activityOpen ? 'is-open' : ''}`} aria-label="Match activity">
            <b>Match log</b>
            {game.activity.map((item) => <p key={item.id} data-tone={item.tone}>{item.text}</p>)}
          </aside>

          {room.status === 'finished' && (
            <div className="result-overlay">
              <div className="result-card">
                <span className="result-card__symbol">♣</span>
                <span className="eyebrow">Round over</span>
                <h2>{loser?.isYou ? 'Aaj aap Bhabhi hain!' : `${loser?.name} is the Bhabhi!`}</h2>
                <p>{loser?.isYou ? 'Next round, dump the high cards before someone throws a thulla.' : 'You got away safely. Ready to deal again?'}</p>
                {me.isHost ? <button className="button button--primary button--wide" type="button" onClick={restart}><RotateCcw size={19} /> Play another round</button> : <p className="host-wait">Waiting for the host to restart…</p>}
              </div>
            </div>
          )}
        </section>

        <section className="hand-dock" aria-label="Your hand">
          <div className="hand-meta">
            <div><b>Your hand</b><span>{game.hand.length} card{game.hand.length === 1 ? '' : 's'}</span></div>
            {me.escaped && <span className="safe-badge"><Check size={17} /> You got away</span>}
          </div>
          <div className="hand-scroll">
            <div className="hand-cards">
              {sortCards(game.hand).map((card) => {
                const legal = legalIds.has(card.id)
                return (
                  <Card
                    key={card.id}
                    card={card}
                    selectable={isMyTurn && legal}
                    selected={selectedCardId === card.id}
                    disabled={!isMyTurn || !legal || room.status !== 'playing'}
                    onClick={() => setSelectedCardId(card.id === selectedCardId ? null : card.id)}
                  />
                )
              })}
              {game.hand.length === 0 && <div className="empty-hand"><Check size={24} /><p>{me.escaped ? 'You got away!' : 'Power card is on the table'}</p></div>}
            </div>
          </div>
          <div className={`play-bar ${game.canTakeRightHand ? 'has-take' : ''}`}>
            <p>{isMyTurn ? selectedCardId ? 'Card selected — play when ready.' : game.canTakeRightHand ? 'Lead a card, or take the next player’s whole hand.' : 'Select one of the raised cards.' : `Waiting for ${currentPlayer?.name ?? 'the next round'}…`}</p>
            <div className="play-actions">
              {game.canTakeRightHand && takeTarget && (
                <button className="button button--take" type="button" disabled={taking || playing} onClick={() => setTakeConfirmOpen(true)}>
                  <HandCards size={18} /> Take {takeTarget.name}’s hand
                </button>
              )}
              <button className="button button--accent" type="button" disabled={!selectedCardId || !isMyTurn || playing || taking} onClick={playSelected}>
                {playing ? <span className="spinner" /> : <Play size={18} fill="currentColor" />} Play card
              </button>
            </div>
          </div>
        </section>
      </div>

      {takeConfirmOpen && takeTarget && (
        <div className="modal-scrim" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setTakeConfirmOpen(false)}>
          <section className="take-sheet" role="dialog" aria-modal="true" aria-labelledby="take-title">
            <span className="take-sheet__icon"><HandCards size={28} /></span>
            <span className="eyebrow">Right-hand rule</span>
            <h2 id="take-title">Take {takeTarget.name}’s {takeTarget.cardCount} card{takeTarget.cardCount === 1 ? '' : 's'}?</h2>
            <p>{takeTarget.name} will get away safely. Every card in their hand will move to yours, and you will still lead the next trick.</p>
            {room.players.filter((player) => !player.escaped).length === 2 && <p className="take-sheet__warning">Only two players remain, so taking this hand will make you the Bhabhi.</p>}
            <div className="take-sheet__actions">
              <button className="button button--secondary" type="button" disabled={taking} onClick={() => setTakeConfirmOpen(false)}>Cancel</button>
              <button className="button button--accent" type="button" disabled={taking} onClick={takeRightHand}>
                {taking ? <span className="spinner" /> : <HandCards size={18} />} Take the hand
              </button>
            </div>
          </section>
        </div>
      )}
    </main>
  )
}

export default function App() {
  const socket = useMemo(() => io(SERVER_URL, { autoConnect: true, reconnection: true, reconnectionDelayMax: 5000 }), [])
  const inviteCode = useMemo(getInviteCode, [])
  const initialCredentials = useMemo(() => getSavedCredentials(inviteCode), [inviteCode])
  const [credentials, setCredentials] = useState<RoomCredentials | null>(initialCredentials)
  const credentialsRef = useRef(credentials)
  const [room, setRoom] = useState<RoomView | null>(null)
  const [connected, setConnected] = useState(socket.connected)
  const [reconnecting, setReconnecting] = useState(Boolean(initialCredentials))
  const [entryError, setEntryError] = useState('')
  const [rulesOpen, setRulesOpen] = useState(false)
  const [toast, setToast] = useState('')

  useEffect(() => { credentialsRef.current = credentials }, [credentials])
  useEffect(() => {
    let hasAttemptedRestore = false
    async function restoreSeat() {
      setConnected(true)
      const saved = credentialsRef.current
      if (!saved || hasAttemptedRestore) return
      hasAttemptedRestore = true
      setReconnecting(true)
      const response = await emitWithAck<RoomCredentials>(socket, 'room:reconnect', { code: saved.code, token: saved.token })
      setReconnecting(false)
      if (!response.ok) {
        setCredentials(null)
        credentialsRef.current = null
        setEntryError(response.error ?? 'Could not restore your seat.')
      }
    }
    const onDisconnect = () => setConnected(false)
    const onState = (state: RoomView) => setRoom(state)
    socket.on('connect', restoreSeat)
    socket.on('disconnect', onDisconnect)
    socket.on('room:state', onState)
    if (socket.connected) void restoreSeat()
    else socket.connect()
    return () => {
      socket.off('connect', restoreSeat)
      socket.off('disconnect', onDisconnect)
      socket.off('room:state', onState)
      socket.disconnect()
    }
  }, [socket])

  useEffect(() => {
    if (!toast) return
    const timeout = window.setTimeout(() => setToast(''), 3500)
    return () => window.clearTimeout(timeout)
  }, [toast])

  function entered(nextCredentials: RoomCredentials) {
    saveCredentials(nextCredentials)
    setCredentials(nextCredentials)
    credentialsRef.current = nextCredentials
    setEntryError('')
  }

  function leaveRoom() {
    if (credentials) localStorage.removeItem(`thulla:seat:${credentials.code}`)
    credentialsRef.current = null
    setCredentials(null)
    setRoom(null)
    window.history.replaceState({}, '', window.location.pathname)
    socket.disconnect()
    socket.connect()
  }

  if (reconnecting && !room) {
    return <main className="loading-screen"><Logo /><span className="spinner spinner--large" /><p>Finding your seat…</p></main>
  }

  return (
    <>
      {!room ? (
        <>
          <Landing socket={socket} connected={connected} inviteCode={inviteCode} onEntered={entered} onOpenRules={() => setRulesOpen(true)} />
          {entryError && <div className="entry-banner" role="alert">{entryError}</div>}
        </>
      ) : room.status === 'lobby' ? (
        <Lobby room={room} socket={socket} onOpenRules={() => setRulesOpen(true)} onLeave={leaveRoom} onToast={setToast} />
      ) : (
        <GameTable room={room} socket={socket} connected={connected} onOpenRules={() => setRulesOpen(true)} onLeave={leaveRoom} onToast={setToast} />
      )}
      {rulesOpen && <RulesModal onClose={() => setRulesOpen(false)} />}
      {toast && <div className="toast" role="status" aria-live="polite"><Check size={18} /> {toast}</div>}
    </>
  )
}
