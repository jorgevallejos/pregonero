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
  /**
   * Milliseconds elapsed since `begin` fired (i.e. since the song itself started, not the
   * count-in). 0 while idle, during the count-in, or before the first begin. Freezes while
   * paused; resets to 0 on restart()/reset()/de-arm. Intended for driving Auto lyric-advance
   * off the song timeline (see `computeAutoAdvanceIndex` in `autoAdvanceState.ts`).
   */
  songElapsedMs: number
  /** Begins the clock: count-in first (if tempo has countInBars > 0), otherwise straight to playing. */
  start: () => void
  /**
   * Begins the clock straight into 'playing' at songElapsedMs 0, unconditionally skipping any
   * count-in regardless of tempo.countInBars — for when an external event (not a Play button)
   * is the start cue, e.g. the performer's first pedal press for a v2-timeline Auto song with
   * no video (see `isCueStartMode` in autoAdvanceState.ts). Only fires from idle; a no-op once
   * the clock is already running/paused, so a later cue-eligible call (e.g. a manual Next press
   * after the cue) can't reset an in-progress run.
   */
  startAtCue: () => void
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
  const [songElapsedMs, setSongElapsedMs] = useState(0)

  // startMsRef holds the adjusted epoch so elapsed = Date.now() - startMsRef is correct
  // even after a pause/resume cycle.
  const startMsRef = useRef<number>(0)
  // How much time had elapsed when the clock was last paused.
  const pausedElapsedRef = useRef<number>(0)
  // The `elapsed` value (relative to startMsRef) at the moment begin fired — i.e. the
  // count-in's duration. null until begin has fired for the current run. Used to derive
  // songElapsedMs = elapsed - beginElapsedMsRef.current, which is 0 right at the handoff
  // and counts up from there, frozen during pause.
  const beginElapsedMsRef = useRef<number | null>(null)

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
    beginElapsedMsRef.current = null
    setPhase(null)
    setBeginFiredOnce(false)
    setPlayState('idle')
    setSongElapsedMs(0)
  }, [])

  // De-arming resets everything to idle.
  useEffect(() => {
    if (!isArmed) reset()
  }, [isArmed, reset])

  const isClockRunning = playState === 'count-in' || playState === 'playing'

  useEffect(() => {
    if (!isClockRunning) return

    const tick = () => {
      const elapsed = Date.now() - startMsRef.current
      const tempoNow = tempoRef.current
      const p = tempoNow ? getBeatPhase(tempoNow, elapsed) : null
      setPhase(p)
      // "Begin" has fired this tick either because the tempo's own count-in math says so (the
      // normal count-in path), or because beginElapsedMsRef was already pinned at start time —
      // the two "already playing from t=0" paths: start()'s no-count-in branch, and
      // startAtCue() (P1), which bypasses tempo.countInBars entirely regardless of whether a
      // tempo is even present. Without this OR, a tempo-less cue-start song (a v2 timeline with
      // no BPM metadata — the realistic case, per the golden fixture) would never tick past 0:
      // the old code required bpm/numerator/denominator to run the interval at all.
      const beginAlreadyPinned = beginElapsedMsRef.current !== null
      if (beginAlreadyPinned || p?.beginFired) {
        if (beginElapsedMsRef.current === null) beginElapsedMsRef.current = elapsed
        setBeginFiredOnce(true)
        setPlayState((prev) => (prev === 'count-in' ? 'playing' : prev))
        setSongElapsedMs(elapsed - beginElapsedMsRef.current)
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
      beginElapsedMsRef.current = 0
      setPlayState('playing')
      setBeginFiredOnce(true)
      setPhase(tempoRef.current ? getBeatPhase(tempoRef.current, 0) : null)
      setSongElapsedMs(0)
    } else {
      beginElapsedMsRef.current = null
      setPlayState('count-in')
    }
  }, [isArmed, playState, beginFiredOnce])

  const startAtCue = useCallback(() => {
    if (!isArmed) return
    if (playState !== 'idle') return
    startMsRef.current = Date.now()
    pausedElapsedRef.current = 0
    beginElapsedMsRef.current = 0
    setPlayState('playing')
    setBeginFiredOnce(true)
    setPhase(tempoRef.current ? getBeatPhase(tempoRef.current, 0) : null)
    setSongElapsedMs(0)
  }, [isArmed, playState])

  const pause = useCallback(() => {
    if (playState !== 'count-in' && playState !== 'playing') return
    pausedElapsedRef.current = Date.now() - startMsRef.current
    setPlayState('paused')
  }, [playState])

  const restart = useCallback(() => {
    startMsRef.current = Date.now()
    pausedElapsedRef.current = 0
    setBeginFiredOnce(false)
    setSongElapsedMs(0)
    if (!hasCountIn(tempoRef.current)) {
      beginElapsedMsRef.current = 0
      setPlayState('playing')
      setBeginFiredOnce(true)
      setPhase(tempoRef.current ? getBeatPhase(tempoRef.current, 0) : null)
    } else {
      beginElapsedMsRef.current = null
      setPlayState('count-in')
      setPhase(tempoRef.current ? getBeatPhase(tempoRef.current, 0) : null)
    }
  }, [])

  return { phase, beginFiredOnce, playState, songElapsedMs, start, startAtCue, pause, restart, reset }
}
