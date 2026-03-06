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

function setArmedInStorage(armed: boolean): void {
  if (typeof sessionStorage === 'undefined') return
  if (armed) {
    sessionStorage.setItem(KEY_ARMED, '1')
  } else {
    sessionStorage.removeItem(KEY_ARMED)
  }
}

/**
 * Derives current performance state from checks, phrase index, and armed flag.
 * - index >= 0 → performing (first line already revealed)
 * - index === -1 and armed → armed (waiting for first Next)
 * - index === -1 and all checks pass → ready
 * - else → setup
 */
export function getPerformanceState(
  checks: PerformanceChecks,
  index: number,
  armed: boolean
): PerformanceState {
  if (index >= 0) return 'performing'
  if (armed) return 'armed'
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
