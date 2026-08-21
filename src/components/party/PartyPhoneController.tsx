import { useEffect, useMemo, useRef, useState, type ReactNode, type SVGProps } from 'react'
import type { Socket } from 'socket.io-client'
import { sortCards, suitSymbol, type ChatMode, type Reaction } from '../../../shared/game'
import type { Language, TFunction } from '../../i18n'
import type { Preferences } from '../../preferences'
import type { ClientRoomView, TableReaction } from '../../protocol'
import { emitWithAck } from '../../socket'
import {
  GameLogo,
  IconButton,
  PreferenceDialog,
  RoundResult,
  TakeHandDialog,
  TurnClock,
  playAttentionTone,
  type ResultBusyAction,
} from '../GameTable'
import { GameCard, localizedSuit } from '../game/GameCard'

type IconProps = SVGProps<SVGSVGElement> & { size?: number }

function Icon({ size = 24, children, ...props }: IconProps & { children: ReactNode }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden={props['aria-label'] ? undefined : true} {...props}>{children}</svg>
}

const BookOpen = (props: IconProps) => <Icon {...props}><path d="M2 4h6a4 4 0 0 1 4 4v12a4 4 0 0 0-4-4H2z"/><path d="M22 4h-6a4 4 0 0 0-4 4v12a4 4 0 0 1 4-4h6z"/></Icon>
const Check = (props: IconProps) => <Icon {...props}><path d="m5 12 4 4L19 6"/></Icon>
const Clock3 = (props: IconProps) => <Icon {...props}><circle cx="12" cy="12" r="9"/><path d="M12 7v5h4"/></Icon>
const Copy = (props: IconProps) => <Icon {...props}><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></Icon>
const HandCards = (props: IconProps) => <Icon {...props}><rect x="4" y="4" width="11" height="15" rx="2"/><path d="m9 8 2 2 2-2M15 8l3-1a2 2 0 0 1 2.5 1.4l1.4 5.3a2 2 0 0 1-1.4 2.5L15 17.7"/></Icon>
const LogOut = (props: IconProps) => <Icon {...props}><path d="M10 17l5-5-5-5"/><path d="M15 12H3"/><path d="M15 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4"/></Icon>
const Monitor = (props: IconProps) => <Icon {...props}><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></Icon>
const Play = (props: IconProps) => <Icon {...props}><path d="m7 4 13 8L7 20z"/></Icon>
const Settings = (props: IconProps) => <Icon {...props}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6 1.7 1.7 0 0 0 10 3v-.2h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1z"/></Icon>
const Wifi = (props: IconProps) => <Icon {...props}><path d="M5 12.6a10 10 0 0 1 14 0M2 9.3a15 15 0 0 1 20 0M8.5 16a5 5 0 0 1 7 0"/><circle cx="12" cy="20" r="1" fill="currentColor" stroke="none"/></Icon>
const WifiOff = (props: IconProps) => <Icon {...props}><path d="m2 2 20 20M8.5 16a5 5 0 0 1 5.7-.9M5 12.6a10 10 0 0 1 4-2M2 9.3A15 15 0 0 1 6 7M14 7a15 15 0 0 1 8 2.3"/><circle cx="12" cy="20" r="1" fill="currentColor" stroke="none"/></Icon>

function reactionLabel(reaction: Reaction, t: TFunction): string {
  if (reaction === 'thulla') return t('reactionThulla')
  if (reaction === 'wah') return t('reactionWah')
  if (reaction === 'oye') return t('reactionOye')
  if (reaction === 'chalo') return t('reactionChalo')
  if (reaction === 'bach-gaya') return t('reactionBachGaya')
  return t('reactionGoodMove')
}

export default function PartyPhoneController({ room, socket, connected, t, language, chatSupported, tableTalkControl, onLanguage, preferences, onPreference, liveReaction, onOpenRules, onLeave, onToast }: {
  room: ClientRoomView
  socket: Socket
  connected: boolean
  t: TFunction
  language: Language
  chatSupported: boolean
  tableTalkControl: ReactNode
  onLanguage: (language: Language) => void
  preferences: Preferences
  onPreference: <K extends keyof Preferences>(key: K, value: Preferences[K]) => void
  liveReaction: TableReaction | null
  onOpenRules: () => void
  onLeave: () => void
  onToast: (message: string, tone?: 'success' | 'error' | 'info') => void
}) {
  const game = room.game!
  const me = room.players.find((player) => player.isYou)!
  const currentPlayer = room.players.find((player) => player.id === game.currentTurnId)
  const reconnectPlayer = room.players.find((player) => player.id === game.reconnectPlayerId)
  const loser = room.players.find((player) => player.id === game.loserId)
  const takeTarget = room.players.find((player) => player.id === game.takeTargetId)
  const activePlayers = useMemo(() => room.players.filter((player) => !player.waitingForNextRound), [room.players])
  const legalIds = useMemo(() => new Set(game.legalCardIds), [game.legalCardIds])
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null)
  const [playing, setPlaying] = useState(false)
  const [taking, setTaking] = useState(false)
  const [takeConfirmOpen, setTakeConfirmOpen] = useState(false)
  const [preferenceOpen, setPreferenceOpen] = useState(false)
  const [chatModeBusy, setChatModeBusy] = useState(false)
  const [readyBusy, setReadyBusy] = useState(false)
  const [replaceBusy, setReplaceBusy] = useState(false)
  const [resultBusyAction, setResultBusyAction] = useState<ResultBusyAction>(null)
  const resultBusyRef = useRef(false)
  const handRef = useRef<HTMLDivElement>(null)
  const previousMyTurn = useRef(false)

  const isResolving = game.phase === 'resolving'
  const isReconnectPause = game.phase === 'waiting_for_reconnect'
  const isFinished = room.status === 'finished'
  const isMyTurn = game.phase === 'turn' && game.currentTurnId === me.id && !me.waitingForNextRound
  const canAct = connected && room.status === 'playing' && isMyTurn && !isResolving && !isReconnectPause
  const selectedCard = game.hand.find((card) => card.id === selectedCardId)
  const preferencesBlocked = isMyTurn || isResolving || isFinished

  useEffect(() => {
    if (selectedCardId && (!game.hand.some((card) => card.id === selectedCardId) || !legalIds.has(selectedCardId) || !canAct)) setSelectedCardId(null)
  }, [canAct, game.hand, legalIds, selectedCardId])
  useEffect(() => { if (!game.canTakeRightHand || !canAct) setTakeConfirmOpen(false) }, [canAct, game.canTakeRightHand])
  useEffect(() => {
    const becameMyTurn = isMyTurn && !previousMyTurn.current
    previousMyTurn.current = isMyTurn
    if (!becameMyTurn) return
    if (preferences.sound) playAttentionTone()
    if (preferences.haptics && navigator.vibrate) navigator.vibrate(90)
    window.requestAnimationFrame(() => handRef.current?.focus({ preventScroll: true }))
  }, [isMyTurn, preferences.haptics, preferences.sound])
  useEffect(() => {
    const defaultTitle = t('documentTitle')
    function updateTitle() { document.title = isMyTurn && document.hidden ? `${t('yourTurn')} — Bhabhi Thulla` : defaultTitle }
    updateTitle()
    document.addEventListener('visibilitychange', updateTitle)
    return () => { document.removeEventListener('visibilitychange', updateTitle); document.title = defaultTitle }
  }, [isMyTurn, t])
  useEffect(() => { if (preferencesBlocked) setPreferenceOpen(false) }, [preferencesBlocked])

  async function playSelected() {
    if (!selectedCardId || !canAct) return
    setPlaying(true)
    const response = await emitWithAck(socket, 'game:play', { cardId: selectedCardId })
    setPlaying(false)
    if (!response.ok) onToast(response.error ?? t('cardPlayFailed'), 'error')
    else setSelectedCardId(null)
  }

  async function takeRightHand() {
    if (!game.canTakeRightHand || !takeTarget || !canAct) return
    setTaking(true)
    const response = await emitWithAck(socket, 'game:take-right', {})
    setTaking(false)
    setTakeConfirmOpen(false)
    if (!response.ok) onToast(response.error ?? t('takeFailed'), 'error')
    else onToast(t('takeSuccess', { name: takeTarget.name }), 'success')
  }

  async function toggleReady() {
    if (!connected || readyBusy) return
    setReadyBusy(true)
    const response = await emitWithAck(socket, 'game:rematch-ready', { ready: !me.rematchReady })
    setReadyBusy(false)
    if (!response.ok) onToast(response.error ?? t('readyUpdateFailed'), 'error')
  }

  async function replaceWithBot() {
    if (!connected || !me.isHost || !reconnectPlayer || replaceBusy) return
    if (!window.confirm(t('replaceBotConfirm', { name: reconnectPlayer.name }))) return
    setReplaceBusy(true)
    const response = await emitWithAck(socket, 'game:replace-with-bot', { playerId: reconnectPlayer.id })
    setReplaceBusy(false)
    if (!response.ok) onToast(response.error ?? t('roundUpdateFailed'), 'error')
  }

  async function updateChatMode(chatMode: ChatMode) {
    if (!connected) return
    setChatModeBusy(true)
    const response = await emitWithAck(socket, 'room:settings', { chatMode })
    setChatModeBusy(false)
    if (!response.ok) onToast(response.error ?? t('chatModeUpdateFailed'), 'error')
  }

  async function copyRoomCode() {
    try { await navigator.clipboard.writeText(room.code); onToast(t('roomCodeCopied'), 'success') }
    catch { onToast(`${t('roomCode')}: ${room.code}`, 'info') }
  }

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

  async function shareInvite() {
    const inviteUrl = `${window.location.origin}${window.location.pathname}?room=${room.code}&mode=party`
    const message = t('inviteMessage', { url: inviteUrl })
    try {
      if (navigator.share) await navigator.share({ title: 'Bhabhi Thulla', text: message, url: inviteUrl })
      else await navigator.clipboard.writeText(message)
      onToast(t('inviteCopied'), 'success')
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return
      try { await navigator.clipboard.writeText(message); onToast(t('inviteCopied'), 'success') }
      catch { onToast(t('copyInviteFailed', { code: room.code }), 'error') }
    }
  }

  function resetSession() {
    if (window.confirm(t('resetConfirm'))) void resultAction('reset', 'game:reset-session')
  }

  function removeWaiting(player: ClientRoomView['players'][number]) {
    if (window.confirm(t('removeWaitingConfirm', { name: player.name }))) void resultAction('remove-waiting', 'room:kick', { playerId: player.id })
  }

  const statusTitle = isReconnectPause
    ? t('activityReconnectWait', { player: reconnectPlayer?.name ?? t('player') })
    : isResolving
      ? t('nextTrick')
      : me.escaped
        ? t('youGotAway')
        : isMyTurn
          ? t('yourTurn')
          : t('currentTurn')
  const statusMessage = isReconnectPause
    ? t('reconnectPaused')
    : isResolving
      ? t('watchingTable')
      : me.escaped
        ? t('watchingTable')
        : isMyTurn
          ? game.canTakeRightHand ? t('leadOrTakePlayer', { name: takeTarget?.name ?? t('player') }) : t('chooseLegalCard')
          : t('waitingForPlayer', { name: currentPlayer?.name ?? t('player') })

  if (isFinished) return <main className="party-controller is-finished" data-party-private-controller="true"><RoundResult room={room} me={me} loser={loser} connected={connected} busyAction={resultBusyAction} t={t} onReady={() => void resultAction('ready', 'game:rematch-ready', { ready: !me.rematchReady }, t('readyUpdateFailed'))} onRestart={() => void resultAction('restart', 'game:start', {}, t('startFailed'))} onReset={resetSession} onRemoveWaiting={removeWaiting} onAddBot={() => void resultAction('add-bot', 'room:add-bot', {}, t('addBotFailed'))} onInvite={shareInvite} onLeave={onLeave}/></main>

  return <main className={`party-controller ${isMyTurn ? 'is-my-turn' : ''} ${isResolving ? 'is-resolving' : ''} ${isReconnectPause ? 'is-reconnecting' : ''} ${me.waitingForNextRound ? 'is-waiting' : ''}`} data-party-private-controller="true">
    <a className="game-v2-skip" href={me.waitingForNextRound ? '#party-controller-waiting' : '#game-v2-hand'}>{me.waitingForNextRound ? t('watchingTable') : t('skipToHand')}</a>
    <header className="party-controller__header">
      <GameLogo/>
      <button className="party-controller__room" type="button" onClick={() => void copyRoomCode()} aria-label={t('copyRoomCode', { code: room.code })}><span>{t('room')}</span><b dir="ltr">{room.code}</b><Copy size={16}/></button>
      <div className="party-controller__header-actions">
        <span className={`party-controller__connection ${connected ? 'is-online' : ''}`} role="status" aria-label={connected ? t('connectedServer') : t('reconnectingServer')}>{connected ? <Wifi size={18}/> : <WifiOff size={18}/>}</span>
        <IconButton label={preferencesBlocked ? t('settingsUnavailable') : t('settings')} disabled={preferencesBlocked} onClick={() => setPreferenceOpen(true)}><Settings size={20}/></IconButton>
        <IconButton label={t('howToPlay')} onClick={onOpenRules}><BookOpen size={20}/></IconButton>
        <IconButton className="game-v2-icon-button--danger" label={t('leaveTable')} onClick={onLeave}><LogOut size={20}/></IconButton>
      </div>
    </header>

    <div className="party-controller__identity"><span><Monitor size={17}/>{t('partyController')}</span><b><bdi dir="auto">{me.name}</bdi></b></div>
    <div className={`party-controller__board-status ${room.partyBoardConnected ? 'is-online' : ''}`} role="status"><Monitor size={18}/><span>{room.partyBoardConnected ? t('sharedScreenConnected') : t('sharedScreenDisconnected')}</span></div>
    <div className="party-controller__utility"><p className="party-controller__privacy"><Monitor size={17}/><span>{t('partyPhonePrivacy')}</span></p>{tableTalkControl}</div>

    {me.waitingForNextRound ? <section id="party-controller-waiting" className="party-controller__waiting" tabIndex={-1} aria-labelledby="party-controller-waiting-title">
      <Clock3 size={30}/><span className="game-v2-eyebrow">{t('gameInProgress')}</span><h1 id="party-controller-waiting-title">{t('joinNextRoundTitle')}</h1><p>{t('joinNextRoundBody', { count: me.joinedInRound, round: me.joinedInRound })}</p>
      <div className="party-controller__ready-state">{me.rematchReady ? <Check size={18}/> : <Clock3 size={18}/>}<span>{me.rematchReady ? t('youAreReady') : t('youAreNotReady')}</span></div>
      <button className={`game-v2-button ${me.rematchReady ? 'game-v2-button--secondary' : 'game-v2-button--primary'} game-v2-button--wide`} type="button" aria-pressed={me.rematchReady} disabled={!connected || readyBusy} onClick={() => void toggleReady()}>{readyBusy ? <span className="spinner"/> : null}{me.rematchReady ? t('cancelReadiness') : t('markReadyForNextRound')}</button>
    </section> : <>
      <section className="party-controller__status" aria-labelledby="party-controller-status-title">
        <div className="party-controller__status-copy"><span>{isMyTurn ? t('yourTurn') : t('partyController')}</span><h1 id="party-controller-status-title">{statusTitle}</h1><p>{statusMessage}</p></div>
        {game.phase === 'turn' && game.turnEndsAt !== null ? <TurnClock endsAt={game.turnEndsAt} duration={room.settings.turnSeconds * 1_000} t={t} alertForYou={isMyTurn} sound={preferences.sound} haptics={preferences.haptics}/> : null}
        {isReconnectPause && me.isHost && reconnectPlayer ? <button className="game-v2-button game-v2-button--secondary" type="button" disabled={!connected || replaceBusy} onClick={() => void replaceWithBot()}>{replaceBusy ? <span className="spinner"/> : null}{t('replaceBot')}</button> : null}
      </section>

      {game.leadSuit && !isResolving ? <div className={`party-controller__follow game-v2-lead--${game.leadSuit}`}><span aria-hidden="true">{suitSymbol[game.leadSuit]}</span><b>{t('follow', { suit: localizedSuit(t, game.leadSuit) })}</b></div> : null}

      <section id="game-v2-hand" ref={handRef} className="party-controller__hand" aria-label={t('yourHand')} tabIndex={-1}>
        <div className="party-controller__hand-meta"><h2>{t('yourHand')}</h2><span>{t(game.hand.length === 1 ? 'card' : 'cards', { count: game.hand.length })}</span></div>
        <div className="party-controller__hand-scroll" data-scroll-owner="private-hand"><div className="party-controller__cards">{sortCards(game.hand).map((card) => {
          const legal = legalIds.has(card.id)
          return <GameCard key={card.id} card={card} t={t} interactive selectable={canAct && legal} selected={selectedCardId === card.id} unavailable={isMyTurn && connected && !legal} disabled={!canAct || !legal} onClick={() => setSelectedCardId(card.id === selectedCardId ? null : card.id)}/>
        })}{game.hand.length === 0 ? <div className="party-controller__empty-hand"><Check size={28}/><p>{me.escaped ? t('youGotAway') : t('powerOnTable')}</p></div> : null}</div></div>
      </section>

      {!isResolving && !isReconnectPause ? <div className="party-controller__action-dock" data-controller-actions="true"><p>{!connected ? t('reconnectingServer') : isMyTurn ? selectedCard ? t('cardSelected', { rank: selectedCard.rank, suit: localizedSuit(t, selectedCard.suit) }) : game.canTakeRightHand ? t('leadOrTakePlayer', { name: takeTarget?.name ?? t('player') }) : t('chooseLegalCard') : t('waitingForPlayer', { name: currentPlayer?.name ?? t('player') })}</p><div>{game.canTakeRightHand && takeTarget && canAct ? <button className="game-v2-button game-v2-button--take" type="button" disabled={taking || playing} onClick={() => setTakeConfirmOpen(true)}><HandCards size={19}/>{t('takeHand', { name: takeTarget.name, count: takeTarget.cardCount })}</button> : null}<button className="game-v2-button game-v2-button--primary" type="button" disabled={!selectedCard || !canAct || playing || taking} onClick={() => void playSelected()}>{playing ? <span className="spinner"/> : <Play size={19} fill="currentColor"/>}{selectedCard ? t('playNamedCard', { card: `${selectedCard.rank}${suitSymbol[selectedCard.suit]}` }) : t('chooseLegalCard')}</button></div></div> : null}
    </>}

    {liveReaction && !isResolving && !preferences.reactionsMuted ? <div className="party-controller__reaction" role="status"><b><bdi dir="auto">{liveReaction.playerId === me.id ? t('you') : liveReaction.playerName}</bdi></b><span>{reactionLabel(liveReaction.reaction, t)}</span></div> : null}
    {takeConfirmOpen && takeTarget ? <TakeHandDialog target={takeTarget} taking={taking} activeCount={activePlayers.filter((player) => !player.escaped).length} t={t} onCancel={() => setTakeConfirmOpen(false)} onConfirm={() => void takeRightHand()}/> : null}
    {preferenceOpen && !preferencesBlocked ? <PreferenceDialog language={language} t={t} preferences={preferences} isHost={me.isHost} chatSupported={chatSupported} chatMode={room.settings.chatMode} chatModeBusy={chatModeBusy} onLanguage={onLanguage} onPreference={onPreference} onChatMode={(chatMode) => void updateChatMode(chatMode)} onClose={() => setPreferenceOpen(false)}/> : null}
  </main>
}
