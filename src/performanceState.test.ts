import { describe, it, expect, beforeEach, beforeAll, vi } from 'vitest'
import type { SongItem } from './songState'
import {
  getPerformanceChecks,
  getPerformanceState,
  setStoredArmed,
  KEY_ARMED_BROADCAST,
  type PerformanceChecks,
} from './performanceState'

// jsdom's built-in localStorage/sessionStorage is unreliable in this environment (see the same
// polyfill in setlistStore.test.ts / ProjectionView.test.tsx), so self-provide an in-memory
// Storage implementation when the global one isn't fully functional.
function createStorage(): Storage {
  const store = new Map<string, string>()
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value) },
    removeItem: (key: string) => { store.delete(key) },
    clear: () => { store.clear() },
    key: (i: number) => [...store.keys()][i] ?? null,
    get length() { return store.size },
  }
}

const validLines: SongItem[] = [
  { languages: { es: 'Hola', en: 'Hello' } },
]

describe('getPerformanceChecks', () => {
  it('projectionOpen = false, valid lines, valid language → projectionOpen false, translationAvailable true, phraseListLoaded true, allPass false', () => {
    const checks = getPerformanceChecks(false, validLines, 'en')
    expect(checks.projectionOpen).toBe(false)
    expect(checks.translationAvailable).toBe(true)
    expect(checks.phraseListLoaded).toBe(true)
    expect(checks.allPass).toBe(false)
  })

  it('projectionOpen = true, empty lines, valid language → phraseListLoaded false, allPass false', () => {
    const checks = getPerformanceChecks(true, [], 'en')
    expect(checks.phraseListLoaded).toBe(false)
    expect(checks.allPass).toBe(false)
  })

  it('projectionOpen = true, valid lines, missing/invalid language → translationAvailable false, allPass false', () => {
    const checks = getPerformanceChecks(true, validLines, '')
    expect(checks.translationAvailable).toBe(false)
    expect(checks.allPass).toBe(false)
  })

  it('projectionOpen = true, valid lines, valid language → all individual checks true and allPass true', () => {
    const checks = getPerformanceChecks(true, validLines, 'en')
    expect(checks.projectionOpen).toBe(true)
    expect(checks.translationAvailable).toBe(true)
    expect(checks.phraseListLoaded).toBe(true)
    expect(checks.allPass).toBe(true)
  })
})

describe('getPerformanceState', () => {
  const allPassChecks: PerformanceChecks = {
    projectionOpen: true,
    translationAvailable: true,
    phraseListLoaded: true,
    allPass: true,
  }

  const notAllPassChecks: PerformanceChecks = {
    projectionOpen: true,
    translationAvailable: false,
    phraseListLoaded: true,
    allPass: false,
  }

  it('if index >= 0 and armed → state is "performing"; if index >= 0 and !armed → "ready" or "setup"', () => {
    expect(getPerformanceState(allPassChecks, 0, true)).toBe('performing')
    expect(getPerformanceState(allPassChecks, 1, true)).toBe('performing')
    expect(getPerformanceState(allPassChecks, 0, false)).toBe('ready')
    expect(getPerformanceState(allPassChecks, 5, false)).toBe('ready')
    expect(getPerformanceState(notAllPassChecks, 0, false)).toBe('setup')
  })

  it('if index = -1, allPass = true, armed = true → state is "armed"', () => {
    expect(getPerformanceState(allPassChecks, -1, true)).toBe('armed')
  })

  it('if index = -1, allPass = true, armed = false → state is "ready"', () => {
    expect(getPerformanceState(allPassChecks, -1, false)).toBe('ready')
  })

  it('if checks do not all pass and index = -1 → state is "setup"', () => {
    expect(getPerformanceState(notAllPassChecks, -1, false)).toBe('setup')
    expect(getPerformanceState(notAllPassChecks, -1, true)).toBe('setup')
  })
})

describe('setStoredArmed broadcast reliability (stuck-logo-on-first-launch bug)', () => {
  beforeAll(() => {
    if (
      typeof globalThis.localStorage === 'undefined' ||
      typeof globalThis.localStorage.setItem !== 'function'
    ) {
      vi.stubGlobal('localStorage', createStorage())
    }
    if (
      typeof globalThis.sessionStorage === 'undefined' ||
      typeof globalThis.sessionStorage.setItem !== 'function'
    ) {
      vi.stubGlobal('sessionStorage', createStorage())
    }
  })

  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
  })

  // KEY_ARMED_BROADCAST lives in localStorage, which survives across app launches, while
  // KEY_ARMED lives in sessionStorage and is fresh every launch. If a previous session left
  // the broadcast key holding its "armed" value (e.g. the app quit while armed, or was force
  // quit), the very first arm() of a new session must still produce a value that DIFFERS from
  // what's already there — otherwise a real cross-window 'storage' event never fires (browsers
  // only dispatch 'storage' when the value actually changes), and the Projection window stays
  // stuck on the logo until an unarm/re-arm cycle.
  it('writes a broadcast value that differs from a stale value already left over from a previous session', () => {
    localStorage.setItem(KEY_ARMED_BROADCAST, '1') // stale leftover from a prior launch

    const staleValue = localStorage.getItem(KEY_ARMED_BROADCAST)
    setStoredArmed(true)
    const freshValue = localStorage.getItem(KEY_ARMED_BROADCAST)

    expect(freshValue).not.toBeNull()
    expect(freshValue).not.toBe(staleValue)
  })

  it('writes a broadcast value that differs across two separate arms in the same session', () => {
    setStoredArmed(true)
    const firstValue = localStorage.getItem(KEY_ARMED_BROADCAST)
    setStoredArmed(false)
    setStoredArmed(true)
    const secondValue = localStorage.getItem(KEY_ARMED_BROADCAST)

    expect(secondValue).not.toBeNull()
    expect(secondValue).not.toBe(firstValue)
  })
})
