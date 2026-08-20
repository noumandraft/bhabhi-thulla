import type { PartyBoardCreateRequest, PartyBoardCredentials } from '../../../shared/game'

const PENDING_KEY = 'thulla:party-board:pending'
const LAST_BOARD_KEY = 'thulla:party-board:last'
const BOARD_KEY_PREFIX = 'thulla:party-board:'
const SOUND_KEY = 'thulla:party-board:sound'
const ROOM_CODE_PATTERN = /^[A-HJ-NP-Z2-9]{5}$/
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function parseJson(value: string | null): unknown {
  if (!value) return null
  try { return JSON.parse(value) }
  catch { return null }
}

function randomBoardToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

export function createPendingBoardRequest(): PartyBoardCreateRequest {
  return { requestId: crypto.randomUUID().toLowerCase(), boardToken: randomBoardToken() }
}

export function isPartyBoardCreateRequest(value: unknown): value is PartyBoardCreateRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const candidate = value as Partial<PartyBoardCreateRequest>
  return Object.keys(candidate).every((key) => key === 'requestId' || key === 'boardToken')
    && typeof candidate.requestId === 'string' && UUID_PATTERN.test(candidate.requestId)
    && typeof candidate.boardToken === 'string' && TOKEN_PATTERN.test(candidate.boardToken)
}

export function isPartyBoardCredentials(value: unknown): value is PartyBoardCredentials {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const candidate = value as Partial<PartyBoardCredentials>
  return Object.keys(candidate).every((key) => key === 'code' || key === 'boardToken')
    && typeof candidate.code === 'string' && ROOM_CODE_PATTERN.test(candidate.code)
    && typeof candidate.boardToken === 'string' && TOKEN_PATTERN.test(candidate.boardToken)
}

export function readPendingBoardRequest(): PartyBoardCreateRequest | null {
  const value = parseJson(localStorage.getItem(PENDING_KEY))
  return isPartyBoardCreateRequest(value) ? value : null
}

export function savePendingBoardRequest(request: PartyBoardCreateRequest): void {
  localStorage.setItem(PENDING_KEY, JSON.stringify(request))
}

export function clearPendingBoardRequest(): void {
  localStorage.removeItem(PENDING_KEY)
}

export function readPartyBoardCredentials(code?: string): PartyBoardCredentials | null {
  const normalizedCode = code?.trim().toUpperCase()
    || localStorage.getItem(LAST_BOARD_KEY)?.trim().toUpperCase()
    || ''
  if (!ROOM_CODE_PATTERN.test(normalizedCode)) return null
  const value = parseJson(localStorage.getItem(`${BOARD_KEY_PREFIX}${normalizedCode}`))
  return isPartyBoardCredentials(value) ? value : null
}

export function savePartyBoardCredentials(credentials: PartyBoardCredentials): void {
  localStorage.setItem(`${BOARD_KEY_PREFIX}${credentials.code}`, JSON.stringify(credentials))
  localStorage.setItem(LAST_BOARD_KEY, credentials.code)
  clearPendingBoardRequest()
}

export function clearPartyBoardCredentials(code?: string): void {
  const normalizedCode = code?.trim().toUpperCase()
    || localStorage.getItem(LAST_BOARD_KEY)?.trim().toUpperCase()
    || ''
  if (ROOM_CODE_PATTERN.test(normalizedCode)) localStorage.removeItem(`${BOARD_KEY_PREFIX}${normalizedCode}`)
  if (!code || localStorage.getItem(LAST_BOARD_KEY) === normalizedCode) localStorage.removeItem(LAST_BOARD_KEY)
  clearPendingBoardRequest()
}

export function readPartyBoardSoundPreference(): boolean {
  return localStorage.getItem(SOUND_KEY) === 'on'
}

export function savePartyBoardSoundPreference(enabled: boolean): void {
  localStorage.setItem(SOUND_KEY, enabled ? 'on' : 'off')
}

export function boardCodeFromUrl(): string {
  const value = new URLSearchParams(window.location.search).get('board')?.trim().toUpperCase() ?? ''
  return ROOM_CODE_PATTERN.test(value) ? value : ''
}

export function putBoardCodeInUrl(code: string): void {
  const url = new URL(window.location.href)
  url.searchParams.delete('room')
  url.searchParams.delete('mode')
  url.searchParams.set('board', code)
  window.history.replaceState({}, '', `${url.pathname}?${url.searchParams.toString()}${url.hash}`)
}

export function clearBoardCodeFromUrl(): void {
  const url = new URL(window.location.href)
  url.searchParams.delete('board')
  const query = url.searchParams.toString()
  window.history.replaceState({}, '', `${url.pathname}${query ? `?${query}` : ''}${url.hash}`)
}
