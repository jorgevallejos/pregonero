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
 *
 * Effect deps use primitive fields (bpm/meter/countInBars) rather than the tempo object so
 * that callers returning a new-but-equal object every render (e.g. getLibrarySongById) do
 * not tear down and recreate the interval on every tick.
 */
export function useBeatClock(
  tempo: SongTempo | undefined,
  isActive: boolean
): BeatClockResult {
  const [phase, setPhase] = useState<BeatPhaseResult | null>(null)
  const [beginFiredOnce, setBeginFiredOnce] = useState(false)
  const startMsRef = useRef<number | null>(null)
  // Always reflects the latest tempo without being listed in effect deps.
  const tempoRef = useRef<SongTempo | undefined>(tempo)
  tempoRef.current = tempo

  // Destructure to primitives so object identity changes don't retrigger the effect.
  const bpm = tempo?.bpm
  const meter = tempo?.meter
  const countInBars = tempo?.countInBars

  const reset = useCallback(() => {
    startMsRef.current = null
    setPhase(null)
    setBeginFiredOnce(false)
  }, [])

  useEffect(() => {
    if (!isActive || bpm === undefined || meter === undefined) {
      reset()
      return
    }

    startMsRef.current = Date.now()

    const tick = () => {
      if (startMsRef.current === null || !tempoRef.current) return
      const elapsed = Date.now() - startMsRef.current
      const p = getBeatPhase(tempoRef.current, elapsed)
      setPhase(p)
      if (p.beginFired) {
        setBeginFiredOnce(true)
      }
    }

    tick()
    const id = setInterval(tick, TICK_MS)
    return () => clearInterval(id)
  }, [isActive, bpm, meter, countInBars, reset])

  return { phase, beginFiredOnce, reset }
}
