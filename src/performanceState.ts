import { useState, useEffect, useMemo } from 'react'
import type { SongItem } from './songState'
import { getAvailableLanguages } from './songState'

/** Performance flow: setup → ready → armed → performing */
export type PerformanceState = 'setup' | 'ready' | 'armed' | 'performing'

export interface PerformanceChecks {
  projectionOpen: boolean
  translationAvailable: boolean
  phraseListLoaded: boolean
  /** True when all three checks pass */
  allPass: boolean
}

const KEY_ARMED = 'liveLyricPerformanceArmed'
// Written to localStorage (fires cross-window storage events) so the projection view can detect arm transitions.
export const KEY_ARMED_BROADCAST = 'liveLyricArmedBroadcast'

export function getPerformanceChecks(
  projectionOpen: boolean,
  lines: SongItem[],
  effectiveLang: string
): PerformanceChecks {
  const available = getAvailableLanguages(lines)
  const translationAvailable = effectiveLang.length > 0 && available.includes(effectiveLang)
  const phraseListLoaded = lines.length > 0
  const allPass = projectionOpen && translationAvailable && phraseListLoaded
  return {
    projectionOpen,
    translationAvailable,
    phraseListLoaded,
    allPass,
  }
}

function getArmedFromStorage(): boolean {
  if (typeof sessionStorage === 'undefined') return false
  return sessionStorage.getItem(KEY_ARMED) === '1'
}

// Monotonic tie-breaker appended to the broadcast nonce so two arms firing within the same
// millisecond (e.g. in tests, or a very fast re-arm) still produce distinct values.
let armedBroadcastCounter = 0

function setArmedInStorage(armed: boolean): void {
  if (typeof sessionStorage === 'undefined') return
  if (armed) {
    sessionStorage.setItem(KEY_ARMED, '1')
    if (typeof localStorage !== 'undefined') {
      // KEY_ARMED_BROADCAST must CHANGE on every arm, not just be truthy: it lives in
      // localStorage, which persists across app launches, while KEY_ARMED lives in
      // sessionStorage and is fresh every launch. A cross-window 'storage' event only fires
      // when a key's value actually changes, so writing a constant ('1') would silently fail
      // to notify the Projection window if a previous session left the broadcast key already
      // set to '1' (e.g. the app quit while armed) — the projection would then stay stuck on
      // the logo through the first arm of the new session. Write a changing nonce instead.
      armedBroadcastCounter += 1
      localStorage.setItem(KEY_ARMED_BROADCAST, `${Date.now()}-${armedBroadcastCounter}`)
    }
  } else {
    sessionStorage.removeItem(KEY_ARMED)
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(KEY_ARMED_BROADCAST)
    }
  }
}

/**
 * Derives current performance state from checks, phrase index, and armed flag.
 * - index >= 0 and armed → performing (first line already revealed, still armed)
 * - index >= 0 and !armed → ready or setup (user unarmed during performance)
 * - index === -1 and armed and all checks pass → armed (waiting for first Next)
 * - index === -1 and all checks pass → ready
 * - else → setup
 */
export function getPerformanceState(
  checks: PerformanceChecks,
  index: number,
  armed: boolean
): PerformanceState {
  if (index >= 0 && armed) return 'performing'
  if (index >= 0 && !armed) return checks.allPass ? 'ready' : 'setup'
  if (checks.allPass && armed) return 'armed'
  if (checks.allPass) return 'ready'
  return 'setup'
}

export function getStoredArmed(): boolean {
  return getArmedFromStorage()
}

export function setStoredArmed(armed: boolean): void {
  setArmedInStorage(armed)
}

/** Clear armed flag when entering performing (first Next from armed). */
export function clearArmed(): void {
  setArmedInStorage(false)
}

// --- React hook ---

export function usePerformanceState(
  projectionOpen: boolean,
  lines: SongItem[],
  effectiveLang: string,
  index: number
): {
  state: PerformanceState
  checks: PerformanceChecks
  arm: () => void
  unarm: () => void
} {
  const [armed, setArmed] = useState(getArmedFromStorage)

  useEffect(() => {
    const onStorage = () => setArmed(getArmedFromStorage())
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const arm = () => {
    setArmedInStorage(true)
    setArmed(true)
  }

  const unarm = () => {
    setArmedInStorage(false)
    setArmed(false)
  }

  const checks = useMemo(
    () => getPerformanceChecks(projectionOpen, lines, effectiveLang),
    [projectionOpen, lines, effectiveLang]
  )

  const state = useMemo(
    () => getPerformanceState(checks, index, armed),
    [checks, index, armed]
  )

  return { state, checks, arm, unarm }
}
