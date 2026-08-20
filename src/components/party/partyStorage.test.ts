import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearPartyBoardCredentials,
  createPendingBoardRequest,
  isPartyBoardCreateRequest,
  isPartyBoardCredentials,
  readPartyBoardCredentials,
  readPartyBoardSoundPreference,
  readPendingBoardRequest,
  savePartyBoardCredentials,
  savePartyBoardSoundPreference,
  savePendingBoardRequest,
} from './partyStorage'

function memoryStorage(): Storage {
  const values = new Map<string, string>()
  return {
    get length() { return values.size },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { values.delete(key) },
    setItem: (key, value) => { values.set(key, String(value)) },
  }
}

describe('Party board browser storage', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', memoryStorage())
    vi.stubGlobal('crypto', {
      randomUUID: () => '3b36fd2f-a845-4d37-9be0-a95d5fe815a6',
      getRandomValues: (bytes: Uint8Array) => { bytes.fill(7); return bytes },
    })
    vi.stubGlobal('btoa', (value: string) => Buffer.from(value, 'binary').toString('base64'))
  })

  it('creates and restores an allowlisted pending request', () => {
    const request = createPendingBoardRequest()
    expect(isPartyBoardCreateRequest(request)).toBe(true)
    expect(request.boardToken).toHaveLength(43)
    savePendingBoardRequest(request)
    expect(readPendingBoardRequest()).toEqual(request)
  })

  it('stores a board token under its room code and clears it explicitly', () => {
    const credentials = { code: 'TNK7M', boardToken: 'A'.repeat(43) }
    savePartyBoardCredentials(credentials)
    expect(readPartyBoardCredentials()).toEqual(credentials)
    expect(readPendingBoardRequest()).toBeNull()
    clearPartyBoardCredentials(credentials.code)
    expect(readPartyBoardCredentials(credentials.code)).toBeNull()
  })

  it('rejects malformed or over-broad stored values', () => {
    expect(isPartyBoardCredentials({ code: 'BAD01', boardToken: 'A'.repeat(43) })).toBe(false)
    expect(isPartyBoardCredentials({ code: 'TNK7M', boardToken: 'short', playerToken: 'leak' })).toBe(false)
    expect(isPartyBoardCreateRequest({ requestId: 'not-a-uuid', boardToken: 'A'.repeat(43) })).toBe(false)
  })

  it('keeps Party board sound opt-in and remembers the local choice', () => {
    expect(readPartyBoardSoundPreference()).toBe(false)
    savePartyBoardSoundPreference(true)
    expect(readPartyBoardSoundPreference()).toBe(true)
    savePartyBoardSoundPreference(false)
    expect(readPartyBoardSoundPreference()).toBe(false)
  })
})
