import { useState, useEffect, useRef, useCallback } from 'react'
import { getBeatPhase, type SongTempo, type BeatPhaseResult } from './beatScheduler'

export type BeatClockPlayState = 'idle' | 'count-in' | 'playing' | 'paused'

export type BeatClockResult = {
  /** Current beat phase, or null when idle. */
  phase: BeatPhaseResult | null
  /** True once the count-in has completed; resets to false on restart/reset or when de-armed. */
  beginFiredOnce: boolean
  /** idle (not started) | count-in | playing (count-in complete) | paused. */
  playState: BeatClockPlayState
  /** Begins the clock: count-in first (if tempo has countInBars > 0), otherwise straight to playing. */
  start: () => void
  /** Halts the clock and freezes the current phase. */
  pause: () => void
  /** Resets phase/beginFiredOnce and immediately begins a fresh count-in (or playing, if no count-in). */
  restart: () => void
  /** Manually reset the clock to idle (phase → null, beginFiredOnce → false). */
  reset: () => void
}

const TICK_MS = 50

function hasCountIn(tempo: SongTempo | undefined): boolean {
  if (!tempo) return false
  return (tempo.countInBars ?? 0) > 0
}

/**
 * Drives the visual beat clock for the performer view (non-video songs).
 *
 * Unlike earlier behavior, the clock does NOT auto-start just because `isArmed` is true —
 * it stays idle until the caller invokes `start()`. This mirrors the video performer panel's
 * explicit Play/Pause/Restart transport, decoupled from the lyric-advance ("Next") action.
 *
 * De-arming (isArmed → false) resets everything to idle, mirroring unarm behavior.
 *
 * Effect/callback deps use primitive tempo fields (bpm/numerator/denominator/countInBars)
 * rather than the tempo object so that callers returning a new-but-equal object every render
 * (e.g. getLibrarySongById) do not tear down and recreate the interval on every tick.
 */
export function useBeatClock(
  tempo: SongTempo | undefined,
  isArmed: boolean
): BeatClockResult {
  const [phase, setPhase] = useState<BeatPhaseResult | null>(null)
  const [beginFiredOnce, setBeginFiredOnce] = useState(false)
  const [playState, setPlayState] = useState<BeatClockPlayState>('idle')

  // startMsRef holds the adjusted epoch so elapsed = Date.now() - startMsRef is correct
  // even after a pause/resume cycle.
  const startMsRef = useRef<number>(0)
  // How much time had elapsed when the clock was last paused.
  const pausedElapsedRef = useRef<number>(0)

  // Always reflects the latest tempo without being listed in effect/callback deps.
  const tempoRef = useRef<SongTempo | undefined>(tempo)
  tempoRef.current = tempo

  // Destructure to primitives so object identity changes don't retrigger effects/callbacks.
  const bpm = tempo?.bpm
  const numerator = tempo?.numerator
  const denominator = tempo?.denominator
  const countInBars = tempo?.countInBars

  const reset = useCallback(() => {
    startMsRef.current = 0
    pausedElapsedRef.current = 0
    setPhase(null)
    setBeginFiredOnce(false)
    setPlayState('idle')
  }, [])

  // De-arming resets everything to idle.
  useEffect(() => {
    if (!isArmed) reset()
  }, [isArmed, reset])

  const isClockRunning = playState === 'count-in' || playState === 'playing'

  useEffect(() => {
    if (!isClockRunning || bpm === undefined || numerator === undefined || denominator === undefined) return

    const tick = () => {
      if (!tempoRef.current) return
      const elapsed = Date.now() - startMsRef.current
      const p = getBeatPhase(tempoRef.current, elapsed)
      setPhase(p)
      if (p.beginFired) {
        setBeginFiredOnce(true)
        setPlayState((prev) => (prev === 'count-in' ? 'playing' : prev))
      }
    }

    tick()
    const id = setInterval(tick, TICK_MS)
    return () => clearInterval(id)
  }, [isClockRunning, bpm, numerator, denominator, countInBars])

  const start = useCallback(() => {
    if (!isArmed) return
    if (playState === 'paused') {
      // Resume: adjust start epoch so elapsed continues from where it was.
      startMsRef.current = Date.now() - pausedElapsedRef.current
      setPlayState(beginFiredOnce ? 'playing' : 'count-in')
      return
    }
    if (playState !== 'idle') return

    startMsRef.current = Date.now()
    pausedElapsedRef.current = 0
    if (!hasCountIn(tempoRef.current)) {
      setPlayState('playing')
      setBeginFiredOnce(true)
      setPhase(tempoRef.current ? getBeatPhase(tempoRef.current, 0) : null)
    } else {
      setPlayState('count-in')
    }
  }, [isArmed, playState, beginFiredOnce])

  const pause = useCallback(() => {
    if (playState !== 'count-in' && playState !== 'playing') return
    pausedElapsedRef.current = Date.now() - startMsRef.current
    setPlayState('paused')
  }, [playState])

  const restart = useCallback(() => {
    startMsRef.current = Date.now()
    pausedElapsedRef.current = 0
    setBeginFiredOnce(false)
    if (!hasCountIn(tempoRef.current)) {
      setPlayState('playing')
      setBeginFiredOnce(true)
      setPhase(tempoRef.current ? getBeatPhase(tempoRef.current, 0) : null)
    } else {
      setPlayState('count-in')
      setPhase(tempoRef.current ? getBeatPhase(tempoRef.current, 0) : null)
    }
  }, [])

  return { phase, beginFiredOnce, playState, start, pause, restart, reset }
}
