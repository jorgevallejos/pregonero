import { useState, useEffect, useRef, useCallback } from 'react'
import { getBeatPhase, type SongTempo, type BeatPhaseResult } from './beatScheduler'

export type BeatClockResult = {
  /** Current beat phase, or null when inactive. */
  phase: BeatPhaseResult | null
  /** True once the count-in has completed; resets to false when deactivated or reset(). */
  beginFiredOnce: boolean
  /** Manually reset the clock (phase → null, beginFiredOnce → false). */
  reset: () => void
}

const TICK_MS = 50

/**
 * Drives the visual beat clock for the performer view.
 * Starts when `isActive` is true and `tempo` is defined; stops and resets on deactivation.
 */
export function useBeatClock(
  tempo: SongTempo | undefined,
  isActive: boolean
): BeatClockResult {
  const [phase, setPhase] = useState<BeatPhaseResult | null>(null)
  const [beginFiredOnce, setBeginFiredOnce] = useState(false)
  const startMsRef = useRef<number | null>(null)

  const reset = useCallback(() => {
    startMsRef.current = null
    setPhase(null)
    setBeginFiredOnce(false)
  }, [])

  useEffect(() => {
    if (!isActive || !tempo) {
      reset()
      return
    }

    startMsRef.current = Date.now()

    const tick = () => {
      if (startMsRef.current === null) return
      const elapsed = Date.now() - startMsRef.current
      const p = getBeatPhase(tempo, elapsed)
      setPhase(p)
      if (p.beginFired) {
        setBeginFiredOnce(true)
      }
    }

    tick()
    const id = setInterval(tick, TICK_MS)
    return () => clearInterval(id)
  }, [isActive, tempo, reset])

  return { phase, beginFiredOnce, reset }
}
