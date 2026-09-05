/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useBeatClock } from './useBeatClock'
import type { SongTempo } from './beatScheduler'

const TEMPO: SongTempo = { bpm: 120, numerator: 4, denominator: 4, countInBars: 1 }
// 120 bpm → 500ms/beat, 4 beats count-in → begin at 2000ms

/**
 * The loaded song, whose identity is the clock's third argument. **A change to it is a load, and
 * a load starts the beat** — one rule covering both of Jorge's triggers, arming and `next`. The
 * tests that are not about loading hold it fixed, which is what a single armed song does.
 */
const SONG = 'duelo'

describe('useBeatClock', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns null phase and idle playState when not armed', () => {
    const { result } = renderHook(() => useBeatClock(undefined, false, SONG))
    expect(result.current.phase).toBeNull()
    expect(result.current.beginFiredOnce).toBe(false)
    expect(result.current.playState).toBe('idle')
  })

  // AMENDED BY P5 (2026-08-14). The original form of this test also asserted
  // `phase === null` after arming. P5 deliberately overturns that half: the pulse is a click
  // track the performer plays to, so it must free-run from Arm. What A2.1 was actually
  // protecting — that arming does not start the TRANSPORT (no count-in, no song time) — is
  // unchanged and asserted here more explicitly than before.
  it('does not start the transport just from being armed — the pulse runs, but playState stays idle until start() (A2.1, amended by P5)', () => {
    const { result } = renderHook(() => useBeatClock(TEMPO, true, SONG))
    act(() => { vi.advanceTimersByTime(5000) })
    expect(result.current.playState).toBe('idle')
    expect(result.current.songElapsedMs).toBe(0)
    expect(result.current.beginFiredOnce).toBe(false)
    // P5: the pulse itself IS running.
    expect(result.current.phase).not.toBeNull()
  })

  it('start() begins the count-in when tempo has countInBars > 0', () => {
    const { result } = renderHook(() => useBeatClock(TEMPO, true, SONG))
    act(() => { result.current.start() })
    expect(result.current.playState).toBe('count-in')
    expect(result.current.phase).not.toBeNull()
    expect(result.current.phase?.inCountIn).toBe(true)
    expect(result.current.phase?.beatInBar).toBe(1)
  })

  it('advances beat as time progresses after start()', () => {
    const { result } = renderHook(() => useBeatClock(TEMPO, true, SONG))
    act(() => { result.current.start() })
    act(() => { vi.advanceTimersByTime(500) })
    expect(result.current.phase?.beatInBar).toBe(2)
  })

  it('transitions playState from count-in to playing once beginFired, and beginFiredOnce becomes true', () => {
    const { result } = renderHook(() => useBeatClock(TEMPO, true, SONG))
    act(() => { result.current.start() })
    act(() => { vi.advanceTimersByTime(1999) })
    expect(result.current.beginFiredOnce).toBe(false)
    expect(result.current.playState).toBe('count-in')
    act(() => { vi.advanceTimersByTime(1) })
    expect(result.current.beginFiredOnce).toBe(true)
    expect(result.current.playState).toBe('playing')
  })

  it('does NOT auto-advance any external index — beginFiredOnce is just a flag callers may react to', () => {
    const { result } = renderHook(() => useBeatClock(TEMPO, true, SONG))
    act(() => { result.current.start() })
    act(() => { vi.advanceTimersByTime(2000) })
    expect(result.current.beginFiredOnce).toBe(true)
    // No further assertions needed here beyond the hook's own state — App.tsx no longer
    // auto-fires handleNext on this flag (see ControlView.test.tsx A2.1 coverage).
  })

  it('pause() halts the clock and freezes the phase', () => {
    const { result } = renderHook(() => useBeatClock(TEMPO, true, SONG))
    act(() => { result.current.start() })
    act(() => { vi.advanceTimersByTime(500) })
    const frozenPhase = result.current.phase
    act(() => { result.current.pause() })
    expect(result.current.playState).toBe('paused')
    act(() => { vi.advanceTimersByTime(2000) })
    expect(result.current.phase).toEqual(frozenPhase)
  })

  it('start() after pause() resumes the clock from where it left off', () => {
    const { result } = renderHook(() => useBeatClock(TEMPO, true, SONG))
    act(() => { result.current.start() })
    act(() => { vi.advanceTimersByTime(500) })
    act(() => { result.current.pause() })
    act(() => { vi.advanceTimersByTime(5000) }) // time passes while paused — must not count
    act(() => { result.current.start() })
    expect(result.current.playState).toBe('count-in')
    act(() => { vi.advanceTimersByTime(1) })
    // Only ~501ms of "real" elapsed time should have passed for the beat clock, so still beat 2.
    expect(result.current.phase?.beatInBar).toBe(2)
  })

  it('restart() resets phase/beginFiredOnce and immediately begins a fresh count-in', () => {
    const { result } = renderHook(() => useBeatClock(TEMPO, true, SONG))
    act(() => { result.current.start() })
    act(() => { vi.advanceTimersByTime(3000) })
    expect(result.current.beginFiredOnce).toBe(true)
    expect(result.current.playState).toBe('playing')

    act(() => { result.current.restart() })
    expect(result.current.playState).toBe('count-in')
    expect(result.current.beginFiredOnce).toBe(false)
    expect(result.current.phase?.inCountIn).toBe(true)
    expect(result.current.phase?.beatInBar).toBe(1)
  })

  it('resets phase/playState to idle when de-armed', () => {
    const { result, rerender } = renderHook(
      ({ active }: { active: boolean }) => useBeatClock(TEMPO, active, SONG),
      { initialProps: { active: true } }
    )
    act(() => { result.current.start() })
    act(() => { vi.advanceTimersByTime(3000) })
    expect(result.current.beginFiredOnce).toBe(true)

    rerender({ active: false })
    act(() => { vi.advanceTimersByTime(100) })
    expect(result.current.phase).toBeNull()
    expect(result.current.beginFiredOnce).toBe(false)
    expect(result.current.playState).toBe('idle')
  })

  // AMENDED BY P5 (2026-08-14), same reason as the A2.1 test above: re-arming restarts the
  // free-running pulse, so `phase` is no longer null afterwards. The transport must still be
  // idle — that is what "does not auto-start" meant and it still holds.
  it('returns the transport to idle when reactivated after de-arming (does not auto-start), and the pulse runs again', () => {
    const { result, rerender } = renderHook(
      ({ active }: { active: boolean }) => useBeatClock(TEMPO, active, SONG),
      { initialProps: { active: true } }
    )
    act(() => { result.current.start() })
    act(() => { vi.advanceTimersByTime(3000) })
    expect(result.current.beginFiredOnce).toBe(true)

    rerender({ active: false })
    act(() => { vi.advanceTimersByTime(100) })
    expect(result.current.phase).toBeNull()

    rerender({ active: true })
    act(() => { vi.advanceTimersByTime(100) })
    expect(result.current.playState).toBe('idle')
    expect(result.current.beginFiredOnce).toBe(false)
    expect(result.current.songElapsedMs).toBe(0)
    // P5: a fresh arm starts a fresh pulse.
    expect(result.current.phase).not.toBeNull()
  })

  it('reset() function clears phase, beginFiredOnce, and playState mid-run', () => {
    const { result } = renderHook(() => useBeatClock(TEMPO, true, SONG))
    act(() => { result.current.start() })
    act(() => { vi.advanceTimersByTime(3000) })
    expect(result.current.beginFiredOnce).toBe(true)

    act(() => { result.current.reset() })
    expect(result.current.phase).toBeNull()
    expect(result.current.beginFiredOnce).toBe(false)
    expect(result.current.playState).toBe('idle')
  })

  it('re-render with a new-but-equal tempo object does not restart the interval', () => {
    // vi.useFakeTimers() fakes Date.now() so elapsed time advances with advanceTimersByTime.
    // 120bpm → 500ms/beat: beat 1 @ 0ms, beat 2 @ 500ms, beat 3 @ 1000ms, beat 4 @ 1500ms.
    const { result, rerender } = renderHook(
      ({ tempo }: { tempo: SongTempo }) => useBeatClock(tempo, true, SONG),
      { initialProps: { tempo: TEMPO } }
    )
    act(() => { result.current.start() })
    act(() => { vi.advanceTimersByTime(1000) })
    expect(result.current.phase?.beatInBar).toBe(3)

    // Structurally equal but new object reference (simulates getLibrarySongById re-returning).
    rerender({ tempo: { ...TEMPO } })

    act(() => { vi.advanceTimersByTime(500) })
    // If the interval had been reset, startMs would restart from 1000ms fake-time,
    // giving elapsed=500ms → beat 2. Correct behaviour continues to beat 4.
    expect(result.current.phase?.beatInBar).toBe(4)
  })

  it('start() with no count-in (countInBars 0) goes straight to playing', () => {
    const noCountIn: SongTempo = { bpm: 120, numerator: 4, denominator: 4, countInBars: 0 }
    const { result } = renderHook(() => useBeatClock(noCountIn, true, SONG))
    act(() => { result.current.start() })
    expect(result.current.playState).toBe('playing')
    expect(result.current.beginFiredOnce).toBe(true)
  })

  describe('songElapsedMs — elapsed time since begin fired (for Auto lyric-advance drive)', () => {
    it('is 0 when idle', () => {
      const { result } = renderHook(() => useBeatClock(TEMPO, true, SONG))
      expect(result.current.songElapsedMs).toBe(0)
    })

    it('stays 0 during the count-in (song has not begun yet)', () => {
      const { result } = renderHook(() => useBeatClock(TEMPO, true, SONG))
      act(() => { result.current.start() })
      act(() => { vi.advanceTimersByTime(1999) })
      expect(result.current.songElapsedMs).toBe(0)
    })

    it('starts counting from 0 the moment begin fires, not from count-in start', () => {
      const { result } = renderHook(() => useBeatClock(TEMPO, true, SONG))
      act(() => { result.current.start() })
      act(() => { vi.advanceTimersByTime(2000) }) // begin fires exactly at 2000ms
      expect(result.current.beginFiredOnce).toBe(true)
      expect(result.current.songElapsedMs).toBe(0)
      act(() => { vi.advanceTimersByTime(750) })
      expect(result.current.songElapsedMs).toBe(750)
    })

    it('freezes songElapsedMs while paused and resumes correctly', () => {
      const { result } = renderHook(() => useBeatClock(TEMPO, true, SONG))
      act(() => { result.current.start() })
      act(() => { vi.advanceTimersByTime(2500) }) // 500ms into the song
      expect(result.current.songElapsedMs).toBe(500)
      act(() => { result.current.pause() })
      act(() => { vi.advanceTimersByTime(3000) }) // time passes while paused — must not count
      expect(result.current.songElapsedMs).toBe(500)
      act(() => { result.current.start() })
      act(() => { vi.advanceTimersByTime(200) })
      expect(result.current.songElapsedMs).toBe(700)
    })

    it('resets songElapsedMs to 0 on restart()', () => {
      const { result } = renderHook(() => useBeatClock(TEMPO, true, SONG))
      act(() => { result.current.start() })
      act(() => { vi.advanceTimersByTime(3000) })
      expect(result.current.songElapsedMs).toBe(1000)
      act(() => { result.current.restart() })
      expect(result.current.songElapsedMs).toBe(0)
    })

    it('resets songElapsedMs to 0 on reset() and when de-armed', () => {
      const { result, rerender } = renderHook(
        ({ active }: { active: boolean }) => useBeatClock(TEMPO, active, SONG),
        { initialProps: { active: true } }
      )
      act(() => { result.current.start() })
      act(() => { vi.advanceTimersByTime(3000) })
      expect(result.current.songElapsedMs).toBeGreaterThan(0)

      act(() => { result.current.reset() })
      expect(result.current.songElapsedMs).toBe(0)

      act(() => { result.current.start() })
      act(() => { vi.advanceTimersByTime(3000) })
      expect(result.current.songElapsedMs).toBeGreaterThan(0)

      rerender({ active: false })
      expect(result.current.songElapsedMs).toBe(0)
    })

    it('goes straight to counting elapsed time when there is no count-in', () => {
      const noCountIn: SongTempo = { bpm: 120, numerator: 4, denominator: 4, countInBars: 0 }
      const { result } = renderHook(() => useBeatClock(noCountIn, true, SONG))
      act(() => { result.current.start() })
      expect(result.current.songElapsedMs).toBe(0)
      act(() => { vi.advanceTimersByTime(400) })
      expect(result.current.songElapsedMs).toBe(400)
    })
  })

  describe('startAtCue — P1: begins the clock immediately, bypassing any count-in', () => {
    it('goes straight to playing even when tempo has countInBars > 0 (no count-in runs)', () => {
      const { result } = renderHook(() => useBeatClock(TEMPO, true, SONG))
      act(() => { result.current.startAtCue() })
      expect(result.current.playState).toBe('playing')
      expect(result.current.beginFiredOnce).toBe(true)
      expect(result.current.songElapsedMs).toBe(0)
    })

    it('works with no tempo at all', () => {
      const { result } = renderHook(() => useBeatClock(undefined, true, SONG))
      act(() => { result.current.startAtCue() })
      expect(result.current.playState).toBe('playing')
      expect(result.current.beginFiredOnce).toBe(true)
      expect(result.current.phase).toBeNull()
      expect(result.current.songElapsedMs).toBe(0)
    })

    it('songElapsedMs keeps ticking over time with no tempo at all — the realistic case for a v2 timeline with no BPM metadata (the golden Libertad fixture has none)', () => {
      const { result } = renderHook(() => useBeatClock(undefined, true, SONG))
      act(() => { result.current.startAtCue() })
      act(() => { vi.advanceTimersByTime(5850) })
      expect(result.current.songElapsedMs).toBe(5850)
      expect(result.current.phase).toBeNull()
    })

    it('songElapsedMs counts up immediately with no further input', () => {
      // 5850ms is a tick boundary (TICK_MS=50) so the assertion isn't sensitive to interval
      // quantization; the ControlView-level test for the 5.84s Libertad-shaped acceptance
      // criterion advances past the boundary with slack for the same reason.
      const { result } = renderHook(() => useBeatClock(TEMPO, true, SONG))
      act(() => { result.current.startAtCue() })
      act(() => { vi.advanceTimersByTime(5850) })
      expect(result.current.songElapsedMs).toBe(5850)
    })

    it('is a no-op when not armed', () => {
      const { result } = renderHook(() => useBeatClock(TEMPO, false, SONG))
      act(() => { result.current.startAtCue() })
      expect(result.current.playState).toBe('idle')
      expect(result.current.songElapsedMs).toBe(0)
    })

    it('does not restart the clock once already running (idempotent guard)', () => {
      const { result } = renderHook(() => useBeatClock(TEMPO, true, SONG))
      act(() => { result.current.startAtCue() })
      act(() => { vi.advanceTimersByTime(1000) })
      expect(result.current.songElapsedMs).toBe(1000)
      // A second cue-trigger (e.g. a manual Next press after the cue) must not reset the clock.
      act(() => { result.current.startAtCue() })
      act(() => { vi.advanceTimersByTime(500) })
      expect(result.current.songElapsedMs).toBe(1500)
    })

    it('pause() and restart() work normally after a cue-start', () => {
      const { result } = renderHook(() => useBeatClock(TEMPO, true, SONG))
      act(() => { result.current.startAtCue() })
      act(() => { vi.advanceTimersByTime(1000) })
      act(() => { result.current.pause() })
      expect(result.current.playState).toBe('paused')
      act(() => { vi.advanceTimersByTime(2000) })
      expect(result.current.songElapsedMs).toBe(1000)

      act(() => { result.current.restart() })
      // restart() re-applies the song's normal count-in behavior (used by the "Restart" button,
      // which returns a cue-start song to its pre-cue waiting state — see App.tsx's
      // handleAutoRestart, which calls reset() rather than restart() for this reason).
      expect(result.current.songElapsedMs).toBe(0)
    })
  })

  /**
   * P5 — the pulse is a CLICK TRACK the performer plays to, not a drift reference.
   *
   * The live scenario: Jorge talks to the audience while arming. The pulse starts. He picks
   * the tempo up on guitar and plays a 2-bar intro TO the pulse, then cues the lyrics with the
   * pedal once he is settled. The lyrics do not always start on the first pulse of a bar — the
   * performer owns the relationship between beat and first word, not the app.
   *
   * So there are two independent clocks: the pulse (epoch = Arm) and the song timeline
   * (epoch = the cue). A constant offset between them is correct and expected.
   */
  describe('P5 — the pulse free-runs from Arm and the cue must not re-phase it', () => {
    it('runs the pulse while armed and idle, before any cue', () => {
      const { result } = renderHook(() => useBeatClock(TEMPO, true, SONG))
      act(() => { vi.advanceTimersByTime(50) })
      expect(result.current.phase).not.toBeNull()
      expect(result.current.phase?.beatInBar).toBe(1)
      expect(result.current.playState).toBe('idle')

      act(() => { vi.advanceTimersByTime(950) }) // 1000ms total → beat 3 at 120bpm
      expect(result.current.phase?.beatInBar).toBe(3)
      expect(result.current.playState).toBe('idle')
      expect(result.current.songElapsedMs).toBe(0)
    })

    it('the idle pulse is a plain click, not a count-in — nothing is counting in yet', () => {
      const { result } = renderHook(() => useBeatClock(TEMPO, true, SONG))
      act(() => { vi.advanceTimersByTime(50) })
      expect(result.current.phase?.inCountIn).toBe(false)
      expect(result.current.phase?.barInCountIn).toBe(0)
    })

    it('no tempo means no pulse, even when armed (a song with no tempo block gets no pulse)', () => {
      const { result } = renderHook(() => useBeatClock(undefined, true, SONG))
      act(() => { vi.advanceTimersByTime(2000) })
      expect(result.current.phase).toBeNull()
    })

    it('THE P5 BUG: cueing mid-bar leaves the click exactly where it was — no jump under the fingers', () => {
      const { result } = renderHook(() => useBeatClock(TEMPO, true, SONG))
      // Let the pulse free-run to a deliberately non-bar-aligned point: 1700ms at 120bpm is
      // beat 4 of the bar (absoluteBeat 3), 200ms into that beat.
      act(() => { vi.advanceTimersByTime(1700) })
      expect(result.current.phase?.absoluteBeat).toBe(3)
      expect(result.current.phase?.beatInBar).toBe(4)

      // The pedal press. Before the fix this called setPhase(getBeatPhase(tempo, 0)) and the
      // click snapped to beat 1 at the exact moment the performer started singing.
      act(() => { result.current.startAtCue() })
      expect(result.current.phase?.absoluteBeat).toBe(3)
      expect(result.current.phase?.beatInBar).toBe(4)
      // The cue starts the song clock and nothing else.
      expect(result.current.songElapsedMs).toBe(0)
      expect(result.current.playState).toBe('playing')

      // And the pulse carries on from where it was, not from the cue.
      act(() => { vi.advanceTimersByTime(800) }) // pulse at 2500ms, song at 800ms
      expect(result.current.phase?.absoluteBeat).toBe(5)
      expect(result.current.phase?.beatInBar).toBe(2)
      expect(result.current.songElapsedMs).toBe(800)
    })

    it('holds a constant offset between the two clocks across a long song (rate matches, phase does not re-anchor)', () => {
      const { result } = renderHook(() => useBeatClock(TEMPO, true, SONG))
      act(() => { vi.advanceTimersByTime(1700) })
      act(() => { result.current.startAtCue() })
      act(() => { vi.advanceTimersByTime(180_000) }) // three minutes of song

      // Pulse elapsed is song elapsed + the 1700ms offset taken at the cue, forever.
      expect(result.current.songElapsedMs).toBe(180_000)
      expect(result.current.phase?.absoluteBeat).toBe(Math.floor(181_700 / 500))
    })

    it('a cue that happens to land on a downbeat is not a special case — it just does not re-phase either', () => {
      const { result } = renderHook(() => useBeatClock(TEMPO, true, SONG))
      act(() => { vi.advanceTimersByTime(2000) }) // exactly a bar line
      expect(result.current.phase?.beatInBar).toBe(1)
      act(() => { result.current.startAtCue() })
      expect(result.current.phase?.absoluteBeat).toBe(4)
      expect(result.current.phase?.beatInBar).toBe(1)
      expect(result.current.songElapsedMs).toBe(0)
    })

    it('start() DOES re-anchor the phase — a count-in exists to establish the downbeat (R2 / legacy Auto unchanged)', () => {
      const { result } = renderHook(() => useBeatClock(TEMPO, true, SONG))
      act(() => { vi.advanceTimersByTime(1700) })
      expect(result.current.phase?.beatInBar).toBe(4)

      act(() => { result.current.start() })
      expect(result.current.playState).toBe('count-in')
      expect(result.current.phase?.beatInBar).toBe(1)
      expect(result.current.phase?.inCountIn).toBe(true)

      act(() => { vi.advanceTimersByTime(2000) })
      expect(result.current.beginFiredOnce).toBe(true)
      expect(result.current.playState).toBe('playing')
      expect(result.current.songElapsedMs).toBe(0)
    })

    it('pause() still freezes the pulse, and resuming continues it rather than re-anchoring', () => {
      const { result } = renderHook(() => useBeatClock(TEMPO, true, SONG))
      act(() => { vi.advanceTimersByTime(1700) })
      act(() => { result.current.startAtCue() })
      const frozen = result.current.phase
      act(() => { result.current.pause() })
      act(() => { vi.advanceTimersByTime(5000) })
      expect(result.current.phase).toEqual(frozen)

      act(() => { result.current.start() })
      act(() => { vi.advanceTimersByTime(300) }) // pulse resumes at 1700 + 300
      expect(result.current.phase?.absoluteBeat).toBe(4)
    })
  })

  /**
   * **THE BEAT STARTS WHEN A SONG LOADS. ONE RULE, TWO TRIGGERS** (Jorge, 2026-09-05).
   *
   * Arming loads the first song and `next` loads every other, so they are one event with two
   * triggers. **Written as one rule so two behaviours cannot be built that later drift apart** —
   * which is what a separate `next` path in the view would have become.
   */
  describe('a song loading', () => {
    it('re-anchors the pulse, so the next song starts on its own downbeat', () => {
      const { result, rerender } = renderHook(
        ({ song }: { song: string }) => useBeatClock(TEMPO, true, song),
        { initialProps: { song: 'duelo' } }
      )
      // 1700ms at 120bpm is beat 4 of the bar, 200ms in — deliberately not bar-aligned.
      act(() => { vi.advanceTimersByTime(1700) })
      expect(result.current.phase?.absoluteBeat).toBe(3)

      rerender({ song: 'libertad' })
      // The pulse epoch is now, so the first tick after it reads 50ms into beat 1 of the bar.
      act(() => { vi.advanceTimersByTime(50) })
      expect(result.current.phase?.absoluteBeat).toBe(0)
      expect(result.current.phase?.beatInBar).toBe(1)
    })

    it('takes the transport back to idle, so the new song is not driven from the old one', () => {
      // **The gap this closes**: before it, `next` kept the clock running on the previous song's
      // transport epoch — the song id changed and `songElapsedMs` did not — so an Auto song
      // reached by `next` would have been driven from a stale elapsed time.
      const { result, rerender } = renderHook(
        ({ song }: { song: string }) => useBeatClock(TEMPO, true, song),
        { initialProps: { song: 'duelo' } }
      )
      act(() => { result.current.start() })
      act(() => { vi.advanceTimersByTime(5000) })
      expect(result.current.playState).toBe('playing')
      expect(result.current.songElapsedMs).toBeGreaterThan(0)

      rerender({ song: 'libertad' })
      act(() => { vi.advanceTimersByTime(0) })
      expect(result.current.playState).toBe('idle')
      expect(result.current.songElapsedMs).toBe(0)
      expect(result.current.beginFiredOnce).toBe(false)
    })

    it('does not re-anchor when the same song stays loaded', () => {
      const { result, rerender } = renderHook(
        ({ song }: { song: string }) => useBeatClock(TEMPO, true, song),
        { initialProps: { song: 'duelo' } }
      )
      act(() => { vi.advanceTimersByTime(1700) })
      expect(result.current.phase?.absoluteBeat).toBe(3)
      rerender({ song: 'duelo' })
      act(() => { vi.advanceTimersByTime(50) })
      // 1750ms at 120bpm is still beat 4 of the first bar — the epoch did not move.
      expect(result.current.phase?.absoluteBeat).toBe(3)
    })
  })

})
