import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode, type SVGProps } from 'react'
import type { Socket } from 'socket.io-client'
import {
  sortCards,
  suitLabel,
  suitSymbol,
  type ActivityItem,
  type Card as CardType,
  type RoomView,
} from '../../shared/game'
import { emitWithAck } from '../socket'

type IconProps = SVGProps<SVGSVGElement> & { size?: number }
type Player = RoomView['players'][number]

function Icon({ size = 24, children, ...props }: IconProps & { children: ReactNode }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden={props['aria-label'] ? undefined : true} {...props}>{children}</svg>
}

const BookOpen = (props: IconProps) => <Icon {...props}><path d="M2 4h6a4 4 0 0 1 4 4v12a4 4 0 0 0-4-4H2z"/><path d="M22 4h-6a4 4 0 0 0-4 4v12a4 4 0 0 1 4-4h6z"/></Icon>
const Check = (props: IconProps) => <Icon {...props}><path d="m5 12 4 4L19 6"/></Icon>
const Clock3 = (props: IconProps) => <Icon {...props}><circle cx="12" cy="12" r="9"/><path d="M12 7v5h4"/></Icon>
const Copy = (props: IconProps) => <Icon {...props}><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></Icon>
const Crown = (props: IconProps) => <Icon {...props}><path d="m3 6 4 5 5-7 5 7 4-5-2 12H5z"/><path d="M5 21h14"/></Icon>
const HandCards = (props: IconProps) => <Icon {...props}><rect x="4" y="4" width="11" height="15" rx="2"/><path d="m9 8 2 2 2-2M15 8l3-1a2 2 0 0 1 2.5 1.4l1.4 5.3a2 2 0 0 1-1.4 2.5L15 17.7"/></Icon>
const History = (props: IconProps) => <Icon {...props}><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/></Icon>
const LogOut = (props: IconProps) => <Icon {...props}><path d="M10 17l5-5-5-5"/><path d="M15 12H3"/><path d="M15 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4"/></Icon>
const Play = (props: IconProps) => <Icon {...props}><path d="m7 4 13 8L7 20z"/></Icon>
const RotateCcw = (props: IconProps) => <Icon {...props}><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></Icon>
const Wifi = (props: IconProps) => <Icon {...props}><path d="M5 12.6a10 10 0 0 1 14 0M2 9.3a15 15 0 0 1 20 0M8.5 16a5 5 0 0 1 7 0"/><circle cx="12" cy="20" r="1" fill="currentColor" stroke="none"/></Icon>
const WifiOff = (props: IconProps) => <Icon {...props}><path d="m2 2 20 20M8.5 16a5 5 0 0 1 5.7-.9M5 12.6a10 10 0 0 1 4-2M2 9.3A15 15 0 0 1 6 7M14 7a15 15 0 0 1 8 2.3"/><circle cx="12" cy="20" r="1" fill="currentColor" stroke="none"/></Icon>
const X = (props: IconProps) => <Icon {...props}><path d="M18 6 6 18M6 6l12 12"/></Icon>

function IconButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return <button className="game-v2-icon-button" type="button" aria-label={label} title={label} onClick={onClick}>{children}</button>
}

function GameLogo() {
  return (
    <div className="game-v2-logo" aria-label="Bhabhi Thulla">
      <span className="game-v2-logo__cards" aria-hidden="true"><i>♠</i><i>♥</i></span>
      <span><b>Bhabhi</b><strong>THULLA</strong></span>
    </div>
  )
}

function PlayingCard({ card, selectable = false, selected = false, disabled = false, onClick, small = false }: {
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
      className={`game-card ${red ? 'game-card--red' : ''} ${selectable ? 'game-card--selectable' : ''} ${selected ? 'is-selected' : ''} ${small ? 'game-card--small' : ''}`}
      disabled={disabled}
      onClick={onClick}
      aria-label={`${card.rank} of ${suitLabel[card.suit]}${selected ? ', selected' : ''}`}
      aria-pressed={selectable ? selected : undefined}
    >
      <span className="game-card__corner"><b>{card.rank}</b><i>{suitSymbol[card.suit]}</i></span>
      <span className="game-card__suit" aria-hidden="true">{suitSymbol[card.suit]}</span>
      <span className="game-card__corner game-card__corner--bottom" aria-hidden="true"><b>{card.rank}</b><i>{suitSymbol[card.suit]}</i></span>
    </button>
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
  return <span className={`game-v2-clock ${seconds <= 8 ? 'is-low' : ''}`} aria-label={`${seconds} seconds remaining`}><Clock3 size={16} /> {seconds}s</span>
}

function orderedOpponents(players: Player[], playerId: string): Player[] {
  const start = players.findIndex((player) => player.id === playerId)
  if (start < 0) return players.filter((player) => player.id !== playerId)
  const ordered: Player[] = []
  for (let offset = 1; offset < players.length; offset += 1) {
    ordered.push(players[(start - offset + players.length) % players.length])
  }
  return ordered
}

function seatPlacement(index: number, total: number): { className: string; style?: CSSProperties } {
  if (total === 1) return { className: 'is-top', style: { left: '50%' } }
  if (total === 2) return { className: index === 0 ? 'is-right' : 'is-left' }
  if (index === 0) return { className: 'is-right' }
  if (index === total - 1) return { className: 'is-left' }
  const middleCount = total - 2
  const middleIndex = index - 1
  const left = middleCount === 1 ? 50 : 28 + (middleIndex / (middleCount - 1)) * 44
  return { className: 'is-top', style: { left: `${left}%` } }
}

function OpponentSeat({ player, isTurn, isRight, placement }: {
  player: Player
  isTurn: boolean
  isRight: boolean
  placement: ReturnType<typeof seatPlacement>
}) {
  const initials = player.name.split(' ').map((part) => part[0]).join('').slice(0, 2).toUpperCase()
  const status = player.escaped ? 'Safe' : !player.connected ? 'Reconnecting' : `${player.cardCount} card${player.cardCount === 1 ? '' : 's'}`
  return (
    <article
      className={`game-v2-seat ${placement.className} ${isTurn ? 'is-turn' : ''} ${isRight ? 'is-right-player' : ''} ${player.escaped ? 'is-escaped' : ''} ${!player.connected ? 'is-offline' : ''}`}
      style={placement.style}
      aria-label={`${player.name}, ${status}${isRight ? ', next active player on your right' : ''}${isTurn ? ', current turn' : ''}`}
    >
      <div className="game-v2-seat__avatar" aria-hidden="true">{player.escaped ? <Check size={20} strokeWidth={3} /> : initials}</div>
      <div className="game-v2-seat__cards" aria-hidden="true"><i /><i /><i /></div>
      <div className="game-v2-seat__copy">
        <b>{player.name}</b>
        <span>{status}</span>
      </div>
      {player.isHost ? <Crown className="game-v2-seat__host" size={15} aria-label="Room host" /> : null}
      {isTurn ? <span className="game-v2-seat__turn">TURN</span> : null}
      {isRight && !player.escaped ? <span className="game-v2-seat__right">RIGHT · NEXT</span> : null}
    </article>
  )
}

function EventBanner({ event }: { event: ActivityItem }) {
  return (
    <div className="game-v2-event" role="status" aria-live="polite">
      <b>THULLA!</b>
      <span>{event.text.replace(/^[^!]*THULLA!\s*/i, '')}</span>
    </div>
  )
}

function MatchActivity({ items, open, onToggle }: { items: ActivityItem[]; open: boolean; onToggle: () => void }) {
  return (
    <>
      <button className="game-v2-log-toggle" type="button" onClick={onToggle} aria-expanded={open} aria-controls="match-activity"><History size={17} /> Match log</button>
      <aside id="match-activity" className={`game-v2-activity ${open ? 'is-open' : ''}`} aria-label="Match activity">
        <div><b>Match log</b><button type="button" onClick={onToggle} aria-label="Close match log"><X size={17} /></button></div>
        {items.length ? items.map((item) => <p key={item.id} data-tone={item.tone}>{item.text}</p>) : <p>No moves yet.</p>}
      </aside>
    </>
  )
}

function TakeHandDialog({ target, taking, activeCount, onCancel, onConfirm }: {
  target: Player
  taking: boolean
  activeCount: number
  onCancel: () => void
  onConfirm: () => void
}) {
  const dialogRef = useRef<HTMLElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null
    cancelRef.current?.focus()
    return () => previousFocus?.focus()
  }, [])

  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === 'Escape') {
      event.preventDefault()
      onCancel()
      return
    }
    if (event.key !== 'Tab') return
    const focusable = dialogRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')
    if (!focusable?.length) return
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  return (
    <div className="game-v2-scrim" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onCancel()}>
      <section ref={dialogRef} className="game-v2-take-sheet" role="dialog" aria-modal="true" aria-labelledby="take-v2-title" onKeyDown={handleKeyDown}>
        <span className="game-v2-take-sheet__handle" aria-hidden="true" />
        <span className="game-v2-take-sheet__icon"><HandCards size={29} /></span>
        <span className="game-v2-eyebrow">Right-hand rule</span>
        <h2 id="take-v2-title">Take {target.name}’s {target.cardCount} card{target.cardCount === 1 ? '' : 's'}?</h2>
        <p>{target.name} will get away safely. Their whole hand moves to yours, and you will still lead the next trick.</p>
        {activeCount === 2 ? <p className="game-v2-take-sheet__warning">Only two players remain. Taking this hand will make you the Bhabhi.</p> : null}
        <div className="game-v2-take-sheet__actions">
          <button ref={cancelRef} className="game-v2-button game-v2-button--secondary" type="button" disabled={taking} onClick={onCancel}>Cancel</button>
          <button className="game-v2-button game-v2-button--danger" type="button" disabled={taking} onClick={onConfirm}>{taking ? <span className="spinner" /> : <HandCards size={19} />} Take the hand</button>
        </div>
      </section>
    </div>
  )
}

function RoundResult({ loser, me, onRestart }: { loser?: Player; me: Player; onRestart: () => void }) {
  return (
    <div className="game-v2-result">
      <div className="game-v2-result__card">
        <span className="game-v2-result__mark" aria-hidden="true">B</span>
        <span className="game-v2-eyebrow">Round over</span>
        <h2>{loser?.isYou ? 'Aaj aap Bhabhi hain!' : `${loser?.name ?? 'A player'} is the Bhabhi!`}</h2>
        <p>{loser?.isYou ? 'Next round, watch the suits on your right and use the takeover carefully.' : 'You got away safely. Ready for another deal?'}</p>
        {me.isHost ? <button className="game-v2-button game-v2-button--primary game-v2-button--wide" type="button" onClick={onRestart}><RotateCcw size={19} /> Play another round</button> : <p className="game-v2-result__wait">Waiting for the host to restart…</p>}
      </div>
    </div>
  )
}

export default function GameTable({ room, socket, connected, onOpenRules, onLeave, onToast }: {
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
  const opponents = useMemo(() => orderedOpponents(room.players, me.id), [room.players, me.id])
  const rightPlayer = opponents.find((player) => !player.escaped)
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null)
  const [playing, setPlaying] = useState(false)
  const [taking, setTaking] = useState(false)
  const [takeConfirmOpen, setTakeConfirmOpen] = useState(false)
  const [activityOpen, setActivityOpen] = useState(false)
  const [eventBanner, setEventBanner] = useState<ActivityItem | null>(null)
  const legalIds = useMemo(() => new Set(game.legalCardIds), [game.legalCardIds])
  const isMyTurn = game.currentTurnId === me.id
  const selectedCard = game.hand.find((card) => card.id === selectedCardId)
  const visibleTrick = game.resolvedTrick?.cards ?? game.trick
  const resolvedWinner = room.players.find((player) => player.id === game.resolvedTrick?.winnerId)
  const resolvedLastPlayer = room.players.find((player) => player.id === game.resolvedTrick?.lastPlayerId)

  useEffect(() => {
    if (selectedCardId && (!game.hand.some((card) => card.id === selectedCardId) || !legalIds.has(selectedCardId))) setSelectedCardId(null)
  }, [game.hand, legalIds, selectedCardId])

  useEffect(() => {
    if (!game.canTakeRightHand) setTakeConfirmOpen(false)
  }, [game.canTakeRightHand])

  const latestThulla = game.resolvedTrick?.kind === 'thulla'
    ? game.activity.find((item) => item.kind === 'thulla')
    : undefined
  useEffect(() => {
    if (!latestThulla) return
    setEventBanner(latestThulla)
    const timeout = window.setTimeout(() => setEventBanner(null), 2600)
    return () => window.clearTimeout(timeout)
  }, [latestThulla?.id])

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

  async function copyRoomCode() {
    try {
      await navigator.clipboard.writeText(room.code)
      onToast('Room code copied')
    } catch {
      onToast(`Room code: ${room.code}`)
    }
  }

  let tableMessage: string
  if (room.status === 'finished') tableMessage = `${loser?.name ?? 'A player'} is the Bhabhi`
  else if (game.resolvedTrick?.kind === 'thulla') tableMessage = `${resolvedLastPlayer?.name ?? 'Player'} played THULLA — ${resolvedWinner?.name ?? 'the winner'} picks up`
  else if (game.resolvedTrick?.kind === 'opening') tableMessage = `Opening trick cleared — ${resolvedWinner?.name ?? 'the winner'} has power`
  else if (game.resolvedTrick?.kind === 'clean') tableMessage = `${resolvedWinner?.name ?? 'The winner'} won the trick and has power`
  else if (game.firstTrick) tableMessage = game.trick.length === 0 ? 'Ace of Spades opens' : 'Opening trick — everyone plays'
  else if (isMyTurn) tableMessage = game.canTakeRightHand ? 'Lead a card or take the right hand' : 'Choose a legal card'
  else tableMessage = `${currentPlayer?.name ?? 'Player'} is thinking…`

  return (
    <main className="game-v2-shell">
      <a className="game-v2-skip" href="#game-v2-hand">Skip to your hand</a>
      <header className="game-v2-header">
        <GameLogo />
        <button className="game-v2-room" type="button" onClick={copyRoomCode} aria-label={`Copy room code ${room.code}`}><span>Room</span><b>{room.code}</b><Copy size={16} /></button>
        <div className="game-v2-header__actions">
          <span className={`game-v2-connection ${connected ? 'is-online' : ''}`} aria-label={connected ? 'Connected to game server' : 'Reconnecting to game server'}>{connected ? <Wifi size={17} /> : <WifiOff size={17} />}<span>{connected ? 'Live' : 'Reconnecting'}</span></span>
          <IconButton label="How to play" onClick={onOpenRules}><BookOpen size={21} /></IconButton>
          <IconButton label="Leave table" onClick={onLeave}><LogOut size={21} /></IconButton>
        </div>
      </header>

      <div className="game-v2-layout">
        <section className={`game-v2-table ${game.resolvedTrick ? 'has-resolved' : ''}`} aria-label="Card table">
          <div className="game-v2-opponents" data-count={opponents.length} aria-label="Other players">
            {opponents.map((player, index) => (
              <OpponentSeat
                key={player.id}
                player={player}
                isTurn={player.id === game.currentTurnId}
                isRight={player.id === rightPlayer?.id}
                placement={seatPlacement(index, opponents.length)}
              />
            ))}
          </div>

          <div className="game-v2-direction" aria-label="Play moves anticlockwise to the right"><span>ANTICLOCKWISE</span><i aria-hidden="true">→</i><b>RIGHT</b></div>

          <div className="game-v2-center">
            {eventBanner ? <EventBanner event={eventBanner} /> : null}
            <div className="game-v2-piles">
              <div className="game-v2-waste" aria-label={`${game.wasteCount} cards in the waste pile`}><div className="game-v2-card-back" /><b>{game.wasteCount}<span>waste</span></b></div>
              <div className={`game-v2-trick ${game.resolvedTrick ? 'is-resolved' : ''}`} aria-label={game.resolvedTrick ? 'Last completed trick' : 'Current trick'}>
                {visibleTrick.length === 0 ? (
                  <div className="game-v2-empty-trick"><span aria-hidden="true">♠</span><p>{game.firstTrick ? 'Ace opens' : 'Lead any suit'}</p></div>
                ) : visibleTrick.map((entry, index) => (
                  <div className={`game-v2-trick-card ${game.resolvedTrick?.lastPlayerId === entry.playerId ? 'is-last-played' : ''}`} key={`${entry.playerId}-${entry.card.id}`} style={{ '--trick-index': index } as CSSProperties}>
                    <PlayingCard card={entry.card} small />
                    <span>{entry.playerId === me.id ? 'You' : entry.playerName}</span>
                  </div>
                ))}
                {game.resolvedTrick ? (
                  <div className={`game-v2-resolution game-v2-resolution--${game.resolvedTrick.kind}`} role="status">
                    <span>{game.resolvedTrick.kind === 'thulla' ? 'THULLA' : game.resolvedTrick.kind === 'opening' ? 'OPENING CLEARED' : 'TRICK COMPLETE'}</span>
                    <b>Last card: {resolvedLastPlayer?.isYou ? 'You' : resolvedLastPlayer?.name ?? 'Player'}</b>
                  </div>
                ) : null}
              </div>
            </div>

            <div className={`game-v2-status ${isMyTurn ? 'is-mine' : ''}`} aria-live="polite">
              <div><span>{isMyTurn ? 'YOUR POWER' : game.firstTrick ? 'OPENING TRICK' : 'CURRENT TURN'}</span><b>{tableMessage}</b></div>
              {room.status === 'playing' ? <TurnClock endsAt={game.turnEndsAt} /> : null}
            </div>
          </div>

          {game.leadSuit ? <div className={`game-v2-lead game-v2-lead--${game.leadSuit}`}><span>{suitSymbol[game.leadSuit]}</span><b>Follow {suitLabel[game.leadSuit]}</b></div> : null}
          <MatchActivity items={game.activity} open={activityOpen} onToggle={() => setActivityOpen((value) => !value)} />
          {room.status === 'finished' ? <RoundResult loser={loser} me={me} onRestart={restart} /> : null}
        </section>

        <section id="game-v2-hand" className="game-v2-hand" aria-label="Your hand" tabIndex={-1}>
          <div className="game-v2-hand__meta">
            <div><span>YOUR HAND</span><b>{game.hand.length} CARD{game.hand.length === 1 ? '' : 'S'}</b></div>
            {me.escaped ? <span className="game-v2-safe"><Check size={17} /> You got away</span> : isMyTurn ? <span className="game-v2-your-turn">Your turn</span> : null}
          </div>
          <div className="game-v2-hand__scroller">
            <div className="game-v2-hand__cards">
              {sortCards(game.hand).map((card) => {
                const legal = legalIds.has(card.id)
                return (
                  <PlayingCard
                    key={card.id}
                    card={card}
                    selectable={isMyTurn && legal}
                    selected={selectedCardId === card.id}
                    disabled={!isMyTurn || !legal || room.status !== 'playing'}
                    onClick={() => setSelectedCardId(card.id === selectedCardId ? null : card.id)}
                  />
                )
              })}
              {game.hand.length === 0 ? <div className="game-v2-empty-hand"><Check size={25} /><p>{me.escaped ? 'You got away!' : 'Power card is on the table'}</p></div> : null}
            </div>
          </div>
          <div className={`game-v2-action-bar ${game.canTakeRightHand ? 'has-take' : ''}`}>
            <p>{isMyTurn ? selectedCard ? `${selectedCard.rank} of ${suitLabel[selectedCard.suit]} selected` : game.canTakeRightHand ? `Lead a card, or take ${takeTarget?.name ?? 'the right player'}’s hand.` : 'Select one of the available cards.' : `Waiting for ${currentPlayer?.name ?? 'the next round'}…`}</p>
            <div className="game-v2-actions">
              {game.canTakeRightHand && takeTarget ? <button className="game-v2-button game-v2-button--take" type="button" disabled={taking || playing} onClick={() => setTakeConfirmOpen(true)}><HandCards size={19} /> Take {takeTarget.name}’s {takeTarget.cardCount}</button> : null}
              <button className="game-v2-button game-v2-button--primary" type="button" disabled={!selectedCard || !isMyTurn || playing || taking} onClick={playSelected}>{playing ? <span className="spinner" /> : <Play size={19} fill="currentColor" />} {selectedCard ? <>Play {selectedCard.rank}{suitSymbol[selectedCard.suit]}</> : 'Select a card'}</button>
            </div>
          </div>
        </section>
      </div>

      {takeConfirmOpen && takeTarget ? <TakeHandDialog target={takeTarget} taking={taking} activeCount={room.players.filter((player) => !player.escaped).length} onCancel={() => setTakeConfirmOpen(false)} onConfirm={takeRightHand} /> : null}
    </main>
  )
}
