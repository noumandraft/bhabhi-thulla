import { useCallback, useEffect, useRef, useState } from 'react'
import { io, type Socket } from 'socket.io-client'
import {
  PROTOCOL_VERSION,
  REACTIONS,
  type PartyAvailability,
  type PartyBoardCredentials,
  type PartyBoardView,
  type ReactionEvent,
  type ServerHello,
} from '../../../shared/game'
import { emitWithAck } from '../../socket'
import {
  boardCodeFromUrl,
  clearPartyBoardCredentials,
  createPendingBoardRequest,
  putBoardCodeInUrl,
  readPartyBoardCredentials,
  readPendingBoardRequest,
  savePartyBoardCredentials,
  savePendingBoardRequest,
} from './partyStorage'

export type PartyBoardConnectionStatus = 'connecting' | 'creating' | 'reconnecting' | 'ready' | 'offline' | 'unsupported' | 'error' | 'expired' | 'replaced'

export interface PartyBoardConnection {
  status: PartyBoardConnectionStatus
  connected: boolean
  view: PartyBoardView | null
  error: string
  availability: PartyAvailability
  reaction: ReactionEvent | null
  retry: () => void
  createNew: () => void
  forget: () => void
}

function normalizeReaction(value: unknown): ReactionEvent | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const candidate = value as Partial<ReactionEvent>
  if (typeof candidate.id !== 'string' || candidate.id.length > 80) return null
  if (typeof candidate.playerId !== 'string' || candidate.playerId.length > 80) return null
  if (typeof candidate.playerName !== 'string' || !candidate.playerName.trim() || candidate.playerName.length > 32) return null
  if (!REACTIONS.includes(candidate.reaction as ReactionEvent['reaction'])) return null
  if (!Number.isFinite(candidate.createdAt)) return null
  return {
    id: candidate.id,
    playerId: candidate.playerId,
    playerName: candidate.playerName,
    reaction: candidate.reaction as ReactionEvent['reaction'],
    createdAt: candidate.createdAt as number,
  }
}

function normalizeBoardView(value: PartyBoardView): PartyBoardView | null {
  if (!value || value.protocolVersion !== PROTOCOL_VERSION || value.mode !== 'party') return null
  if (!Number.isSafeInteger(value.revision) || value.revision < 0) return null
  return {
    ...value,
    serverNow: Number.isFinite(value.serverNow) ? value.serverNow : Date.now(),
  }
}

export function usePartyBoard(serverUrl: string): PartyBoardConnection {
  const [socket] = useState<Socket>(() => io(serverUrl, {
    autoConnect: false,
    reconnection: true,
    reconnectionDelayMax: 5_000,
    auth: { protocolVersion: PROTOCOL_VERSION },
  }))
  const [status, setStatus] = useState<PartyBoardConnectionStatus>('connecting')
  const [connected, setConnected] = useState(false)
  const [view, setView] = useState<PartyBoardView | null>(null)
  const [error, setError] = useState('')
  const [availability, setAvailability] = useState<PartyAvailability>('off')
  const [reaction, setReaction] = useState<ReactionEvent | null>(null)
  const generationRef = useRef(0)
  const attemptedConnectionRef = useRef<string | null>(null)
  const latestRevisionRef = useRef(-1)
  const viewCodeRef = useRef('')
  const forceFreshOnConnectRef = useRef(false)
  const reactionTimerRef = useRef<number | null>(null)
  viewCodeRef.current = view?.code ?? ''

  const connectBoard = useCallback(async (forceFresh = false) => {
    const generation = ++generationRef.current
    setError('')

    if (forceFresh) {
      const existingCode = viewCodeRef.current || boardCodeFromUrl()
      clearPartyBoardCredentials(existingCode || undefined)
      setView(null)
      latestRevisionRef.current = -1
    }

    const routeCode = forceFresh ? '' : boardCodeFromUrl()
    const credentials = forceFresh ? null : readPartyBoardCredentials(routeCode || undefined)
    if (routeCode && !credentials) {
      setStatus('expired')
      setError('That saved board is not available on this device.')
      return
    }

    if (credentials) {
      setStatus('reconnecting')
      const response = await emitWithAck<PartyBoardCredentials>(socket, 'party:board:reconnect', credentials)
      if (generation !== generationRef.current) return
      if (!response.ok || !response.data) {
        clearPartyBoardCredentials(credentials.code)
        setStatus('expired')
        setError(response.error ?? 'That saved board is no longer available.')
        return
      }
      savePartyBoardCredentials(response.data)
      putBoardCodeInUrl(response.data.code)
      return
    }

    const pending = readPendingBoardRequest() ?? createPendingBoardRequest()
    savePendingBoardRequest(pending)
    setStatus('creating')
    const response = await emitWithAck<PartyBoardCredentials>(socket, 'party:board:create', pending)
    if (generation !== generationRef.current) return
    if (!response.ok || !response.data) {
      setStatus('error')
      setError(response.error ?? 'Could not open the Party board.')
      return
    }
    savePartyBoardCredentials(response.data)
    putBoardCodeInUrl(response.data.code)
  }, [socket])

  useEffect(() => {
    function onConnect() {
      setConnected(true)
      const connectionId = socket.id ?? crypto.randomUUID()
      if (attemptedConnectionRef.current === connectionId) return
      attemptedConnectionRef.current = connectionId
      const forceFresh = forceFreshOnConnectRef.current
      forceFreshOnConnectRef.current = false
      void connectBoard(forceFresh)
    }
    function onDisconnect() {
      attemptedConnectionRef.current = null
      setConnected(false)
      setStatus((current) => current === 'expired' || current === 'replaced' || current === 'unsupported' ? current : 'offline')
    }
    function onHello(hello?: Partial<ServerHello>) {
      if (hello?.protocolVersion && hello.protocolVersion !== PROTOCOL_VERSION) {
        setStatus('unsupported')
        setError('The game server is updating. Refresh this screen in a moment.')
        return
      }
      const nextAvailability = hello?.partyMode === 'beta' || hello?.partyMode === 'public' ? hello.partyMode : 'off'
      setAvailability(nextAvailability)
      if (!(hello?.capabilities ?? []).includes('party-v1')) {
        setStatus('unsupported')
        setError('This server does not support Party Mode yet.')
      }
    }
    function onState(nextValue: PartyBoardView) {
      const next = normalizeBoardView(nextValue)
      if (!next || next.revision < latestRevisionRef.current) return
      latestRevisionRef.current = next.revision
      viewCodeRef.current = next.code
      setView(next)
      setError('')
      setStatus('ready')
    }
    function onReplaced() {
      setConnected(false)
      setStatus('replaced')
      setError('This board was opened on another screen.')
      socket.disconnect()
    }
    function onExpired({ code }: { code?: string } = {}) {
      clearPartyBoardCredentials(code)
      setConnected(false)
      setStatus('expired')
      setError('This Party room expired after being inactive.')
      socket.disconnect()
    }
    function onReaction(value: unknown) {
      const next = normalizeReaction(value)
      if (!next) return
      setReaction(next)
      if (reactionTimerRef.current !== null) window.clearTimeout(reactionTimerRef.current)
      reactionTimerRef.current = window.setTimeout(() => {
        reactionTimerRef.current = null
        setReaction(null)
      }, 2_800)
    }

    socket.on('connect', onConnect)
    socket.on('disconnect', onDisconnect)
    socket.on('server:hello', onHello)
    socket.on('party:board:state', onState)
    socket.on('party:board:replaced', onReplaced)
    socket.on('party:board:expired', onExpired)
    socket.on('room:reaction', onReaction)
    socket.connect()
    return () => {
      generationRef.current += 1
      socket.off('connect', onConnect)
      socket.off('disconnect', onDisconnect)
      socket.off('server:hello', onHello)
      socket.off('party:board:state', onState)
      socket.off('party:board:replaced', onReplaced)
      socket.off('party:board:expired', onExpired)
      socket.off('room:reaction', onReaction)
      if (reactionTimerRef.current !== null) window.clearTimeout(reactionTimerRef.current)
      reactionTimerRef.current = null
      socket.disconnect()
    }
  }, [connectBoard, socket])

  const retry = useCallback(() => {
    setError('')
    attemptedConnectionRef.current = null
    if (socket.connected) void connectBoard(false)
    else {
      setStatus('connecting')
      socket.connect()
    }
  }, [connectBoard, socket])

  const createNew = useCallback(() => {
    setError('')
    attemptedConnectionRef.current = null
    forceFreshOnConnectRef.current = true
    clearPartyBoardCredentials(viewCodeRef.current || undefined)
    setView(null)
    setReaction(null)
    latestRevisionRef.current = -1
    setStatus('connecting')
    if (socket.connected) socket.disconnect()
    socket.connect()
  }, [socket])

  const forget = useCallback(() => {
    generationRef.current += 1
    clearPartyBoardCredentials(viewCodeRef.current || boardCodeFromUrl() || undefined)
    setView(null)
    setReaction(null)
    socket.disconnect()
  }, [socket])

  return { status, connected, view, error, availability, reaction, retry, createNew, forget }
}
