import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setAutoBlackout, getAutoBlackout, AUTO_BLACKOUT_KEY } from './autoBlackout'

describe('autoBlackout channel', () => {
  beforeEach(() => {
    // The default node localStorage in this env is a partial stub (no clear/removeItem);
    // install a full in-memory mock like the other storage-module tests.
    const map = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => { map.set(k, v) },
      removeItem: (k: string) => { map.delete(k) },
      clear: () => { map.clear() },
      key: (i: number) => [...map.keys()][i] ?? null,
      get length() { return map.size },
    })
  })

  it('defaults to false when unset', () => {
    expect(getAutoBlackout()).toBe(false)
  })

  it('round-trips an active blackout', () => {
    setAutoBlackout(true)
    expect(getAutoBlackout()).toBe(true)
  })

  it('round-trips a cleared blackout', () => {
    setAutoBlackout(true)
    setAutoBlackout(false)
    expect(getAutoBlackout()).toBe(false)
  })

  it('writes under the shared key with a nonce so repeated same-value writes still fire storage events', () => {
    setAutoBlackout(true)
    const first = localStorage.getItem(AUTO_BLACKOUT_KEY)
    expect(first).toBeTruthy()
    const parsed = JSON.parse(first!)
    expect(parsed.active).toBe(true)
    expect(typeof parsed.nonce).toBe('number')
  })

  it('returns false on malformed payloads', () => {
    localStorage.setItem(AUTO_BLACKOUT_KEY, 'not json')
    expect(getAutoBlackout()).toBe(false)
  })
})
