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
   *
   * P5: this starts the SONG clock and nothing else. It must never touch the pulse phase —
   * see the two-clock note on the hook itself.
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
 * ── P5: two independent clocks ──────────────────────────────────────────────────────────
 * The pulse is a CLICK TRACK the performer plays to, not a drift reference. It therefore runs
 * on its own epoch, set at Arm, and free-runs from there:
 *
 *   pulseStartMsRef — the pulse epoch. Set on Arm. The visible/audible beat phase derives
 *                     from this and ONLY this.
 *   startMsRef      — the transport epoch. Set by start() / startAtCue(). Drives the count-in
 *                     and songElapsedMs.
 *
 * A constant offset between the two is correct and expected: the performer plays an intro to
 * the pulse and cues the lyrics when settled, and the lyrics need not start on the first pulse
 * of a bar. The performer owns that relationship.
 *
 * `startAtCue()` (the pedal press) therefore starts the song clock and touches nothing else —
 * re-phasing there makes the click jump under the performer's fingers at the exact moment they
 * start singing, which is the bug P5 fixes.
 *
 * `start()` (the Play/Start button) DOES re-anchor the pulse, deliberately: a count-in exists
 * precisely to establish the downbeat, so it must define the phase. This keeps R2's Manual
 * Start step and legacy Auto byte-identical to their pre-P5 behavior.
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

  // P5: the pulse's own epoch, independent of the transport's. Set at Arm; re-anchored only by
  // the explicit transport actions that are entitled to define the downbeat (start/restart/
  // reset), never by the cue.
  const pulseStartMsRef = useRef<number>(0)
  // Pulse elapsed at the moment of the last pause, so resuming continues the click rather than
  // re-anchoring it.
  const pausedPulseElapsedRef = useRef<number>(0)

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
    // Restart/reset is an explicit "start over" transport action, so the pulse re-anchors with
    // it (same entitlement as start(); see the two-clock note above).
    pulseStartMsRef.current = Date.now()
    pausedPulseElapsedRef.current = 0
    setPhase(null)
    setBeginFiredOnce(false)
    setPlayState('idle')
    setSongElapsedMs(0)
  }, [])

  // De-arming resets everything to idle; arming starts the free-running pulse (P5).
  // NOTE: this effect must stay declared BEFORE the ticking effect below, so the pulse epoch is
  // set before the first tick can read it.
  useEffect(() => {
    if (!isArmed) {
      reset()
      return
    }
    pulseStartMsRef.current = Date.now()
    pausedPulseElapsedRef.current = 0
  }, [isArmed, reset])

  const isClockRunning = playState === 'count-in' || playState === 'playing'
  // P5: the pulse runs whenever the song is armed and has a tempo — including while the
  // transport is idle, which is the whole point (the performer plays an intro to it before
  // cueing). Pausing freezes the click along with everything else.
  const isPulseRunning = isArmed && bpm !== undefined && playState !== 'paused'
  const shouldTick = isClockRunning || isPulseRunning

  // Read inside tick() without being effect deps, so a count-in → playing transition doesn't
  // tear down and recreate the interval mid-bar.
  const isClockRunningRef = useRef(isClockRunning)
  isClockRunningRef.current = isClockRunning
  const isCountingInRef = useRef(false)
  isCountingInRef.current = playState === 'count-in'

  useEffect(() => {
    if (!shouldTick) return

    const tick = () => {
      const now = Date.now()
      const tempoNow = tempoRef.current

      // ── The pulse, on its own epoch (P5) ──
      // The count-in concept is suppressed unless a count-in is actually running: a
      // free-running idle pulse is a plain click, not a phantom count-in the performer would
      // read as meaning something. During a real count-in the transport and pulse epochs are
      // the same (start() re-anchors both), so this is byte-identical to pre-P5 behavior; once
      // playing, elapsed is past the count-in window and the two agree anyway.
      if (tempoNow) {
        const pulseTempo = isCountingInRef.current ? tempoNow : { ...tempoNow, countInBars: 0 }
        setPhase(getBeatPhase(pulseTempo, now - pulseStartMsRef.current))
      } else {
        setPhase(null)
      }

      // ── The song clock, on the transport epoch ──
      if (!isClockRunningRef.current) return

      const elapsed = now - startMsRef.current
      // "Begin" has fired this tick either because the tempo's own count-in math says so (the
      // normal count-in path), or because beginElapsedMsRef was already pinned at start time —
      // the two "already playing from t=0" paths: start()'s no-count-in branch, and
      // startAtCue() (P1), which bypasses tempo.countInBars entirely regardless of whether a
      // tempo is even present. Without this OR, a tempo-less cue-start song (a v2 timeline with
      // no BPM metadata — the realistic case, per the golden fixture) would never tick past 0:
      // the old code required bpm/numerator/denominator to run the interval at all.
      const beginAlreadyPinned = beginElapsedMsRef.current !== null
      const transportPhase = tempoNow ? getBeatPhase(tempoNow, elapsed) : null
      if (beginAlreadyPinned || transportPhase?.beginFired) {
        if (beginElapsedMsRef.current === null) beginElapsedMsRef.current = elapsed
        setBeginFiredOnce(true)
        setPlayState((prev) => (prev === 'count-in' ? 'playing' : prev))
        setSongElapsedMs(elapsed - beginElapsedMsRef.current)
      }
    }

    tick()
    const id = setInterval(tick, TICK_MS)
    return () => clearInterval(id)
  }, [shouldTick, bpm, numerator, denominator, countInBars])

  const start = useCallback(() => {
    if (!isArmed) return
    if (playState === 'paused') {
      // Resume: adjust both epochs so each continues from where it was — the pulse resumes the
      // click rather than re-anchoring it.
      const now = Date.now()
      startMsRef.current = now - pausedElapsedRef.current
      pulseStartMsRef.current = now - pausedPulseElapsedRef.current
      setPlayState(beginFiredOnce ? 'playing' : 'count-in')
      return
    }
    if (playState !== 'idle') return

    startMsRef.current = Date.now()
    pausedElapsedRef.current = 0
    // A count-in's job is to establish the downbeat, so Start defines the phase (P5).
    pulseStartMsRef.current = startMsRef.current
    pausedPulseElapsedRef.current = 0
    if (!hasCountIn(tempoRef.current)) {
      beginElapsedMsRef.current = 0
      setPlayState('playing')
      setBeginFiredOnce(true)
      setPhase(tempoRef.current ? getBeatPhase(tempoRef.current, 0) : null)
      setSongElapsedMs(0)
    } else {
      beginElapsedMsRef.current = null
      setPlayState('count-in')
      // Paint the downbeat immediately rather than waiting for the next tick. Pre-P5 this came
      // free from the interval effect re-running on idle → count-in; now that the pulse keeps
      // that interval alive across the transition, Start has to state it — the same way
      // restart() and the no-count-in branch above always have.
      setPhase(tempoRef.current ? getBeatPhase(tempoRef.current, 0) : null)
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
    // P5: the cue starts songElapsedMs and NOTHING else. There is deliberately no setPhase call
    // here — the pulse keeps free-running on its Arm epoch. Do not "improve" this by
    // re-phasing smartly: the performer owns the relationship between beat and first word.
    setSongElapsedMs(0)
  }, [isArmed, playState])

  const pause = useCallback(() => {
    if (playState !== 'count-in' && playState !== 'playing') return
    const now = Date.now()
    pausedElapsedRef.current = now - startMsRef.current
    pausedPulseElapsedRef.current = now - pulseStartMsRef.current
    setPlayState('paused')
  }, [playState])

  const restart = useCallback(() => {
    startMsRef.current = Date.now()
    pausedElapsedRef.current = 0
    // Restart re-runs the count-in, so it re-anchors the pulse with it (see start()).
    pulseStartMsRef.current = startMsRef.current
    pausedPulseElapsedRef.current = 0
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
