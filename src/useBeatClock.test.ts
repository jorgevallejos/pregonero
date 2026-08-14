/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useBeatClock } from './useBeatClock'
import type { SongTempo } from './beatScheduler'

const TEMPO: SongTempo = { bpm: 120, numerator: 4, denominator: 4, countInBars: 1 }
// 120 bpm → 500ms/beat, 4 beats count-in → begin at 2000ms

describe('useBeatClock', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns null phase and idle playState when not armed', () => {
    const { result } = renderHook(() => useBeatClock(undefined, false))
    expect(result.current.phase).toBeNull()
    expect(result.current.beginFiredOnce).toBe(false)
    expect(result.current.playState).toBe('idle')
  })

  it('does not tick just from being armed — stays idle until start() is called (A2.1 fix)', () => {
    const { result } = renderHook(() => useBeatClock(TEMPO, true))
    act(() => { vi.advanceTimersByTime(5000) })
    expect(result.current.playState).toBe('idle')
    expect(result.current.phase).toBeNull()
  })

  it('start() begins the count-in when tempo has countInBars > 0', () => {
    const { result } = renderHook(() => useBeatClock(TEMPO, true))
    act(() => { result.current.start() })
    expect(result.current.playState).toBe('count-in')
    expect(result.current.phase).not.toBeNull()
    expect(result.current.phase?.inCountIn).toBe(true)
    expect(result.current.phase?.beatInBar).toBe(1)
  })

  it('advances beat as time progresses after start()', () => {
    const { result } = renderHook(() => useBeatClock(TEMPO, true))
    act(() => { result.current.start() })
    act(() => { vi.advanceTimersByTime(500) })
    expect(result.current.phase?.beatInBar).toBe(2)
  })

  it('transitions playState from count-in to playing once beginFired, and beginFiredOnce becomes true', () => {
    const { result } = renderHook(() => useBeatClock(TEMPO, true))
    act(() => { result.current.start() })
    act(() => { vi.advanceTimersByTime(1999) })
    expect(result.current.beginFiredOnce).toBe(false)
    expect(result.current.playState).toBe('count-in')
    act(() => { vi.advanceTimersByTime(1) })
    expect(result.current.beginFiredOnce).toBe(true)
    expect(result.current.playState).toBe('playing')
  })

  it('does NOT auto-advance any external index — beginFiredOnce is just a flag callers may react to', () => {
    const { result } = renderHook(() => useBeatClock(TEMPO, true))
    act(() => { result.current.start() })
    act(() => { vi.advanceTimersByTime(2000) })
    expect(result.current.beginFiredOnce).toBe(true)
    // No further assertions needed here beyond the hook's own state — App.tsx no longer
    // auto-fires handleNext on this flag (see ControlView.test.tsx A2.1 coverage).
  })

  it('pause() halts the clock and freezes the phase', () => {
    const { result } = renderHook(() => useBeatClock(TEMPO, true))
    act(() => { result.current.start() })
    act(() => { vi.advanceTimersByTime(500) })
    const frozenPhase = result.current.phase
    act(() => { result.current.pause() })
    expect(result.current.playState).toBe('paused')
    act(() => { vi.advanceTimersByTime(2000) })
    expect(result.current.phase).toEqual(frozenPhase)
  })

  it('start() after pause() resumes the clock from where it left off', () => {
    const { result } = renderHook(() => useBeatClock(TEMPO, true))
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
    const { result } = renderHook(() => useBeatClock(TEMPO, true))
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
      ({ active }: { active: boolean }) => useBeatClock(TEMPO, active),
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

  it('resets to idle when reactivated after de-arming (does not auto-start)', () => {
    const { result, rerender } = renderHook(
      ({ active }: { active: boolean }) => useBeatClock(TEMPO, active),
      { initialProps: { active: true } }
    )
    act(() => { result.current.start() })
    act(() => { vi.advanceTimersByTime(3000) })
    expect(result.current.beginFiredOnce).toBe(true)

    rerender({ active: false })
    act(() => { vi.advanceTimersByTime(100) })

    rerender({ active: true })
    act(() => { vi.advanceTimersByTime(100) })
    expect(result.current.playState).toBe('idle')
    expect(result.current.phase).toBeNull()
    expect(result.current.beginFiredOnce).toBe(false)
  })

  it('reset() function clears phase, beginFiredOnce, and playState mid-run', () => {
    const { result } = renderHook(() => useBeatClock(TEMPO, true))
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
      ({ tempo }: { tempo: SongTempo }) => useBeatClock(tempo, true),
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
    const { result } = renderHook(() => useBeatClock(noCountIn, true))
    act(() => { result.current.start() })
    expect(result.current.playState).toBe('playing')
    expect(result.current.beginFiredOnce).toBe(true)
  })

  describe('songElapsedMs — elapsed time since begin fired (for Auto lyric-advance drive)', () => {
    it('is 0 when idle', () => {
      const { result } = renderHook(() => useBeatClock(TEMPO, true))
      expect(result.current.songElapsedMs).toBe(0)
    })

    it('stays 0 during the count-in (song has not begun yet)', () => {
      const { result } = renderHook(() => useBeatClock(TEMPO, true))
      act(() => { result.current.start() })
      act(() => { vi.advanceTimersByTime(1999) })
      expect(result.current.songElapsedMs).toBe(0)
    })

    it('starts counting from 0 the moment begin fires, not from count-in start', () => {
      const { result } = renderHook(() => useBeatClock(TEMPO, true))
      act(() => { result.current.start() })
      act(() => { vi.advanceTimersByTime(2000) }) // begin fires exactly at 2000ms
      expect(result.current.beginFiredOnce).toBe(true)
      expect(result.current.songElapsedMs).toBe(0)
      act(() => { vi.advanceTimersByTime(750) })
      expect(result.current.songElapsedMs).toBe(750)
    })

    it('freezes songElapsedMs while paused and resumes correctly', () => {
      const { result } = renderHook(() => useBeatClock(TEMPO, true))
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
      const { result } = renderHook(() => useBeatClock(TEMPO, true))
      act(() => { result.current.start() })
      act(() => { vi.advanceTimersByTime(3000) })
      expect(result.current.songElapsedMs).toBe(1000)
      act(() => { result.current.restart() })
      expect(result.current.songElapsedMs).toBe(0)
    })

    it('resets songElapsedMs to 0 on reset() and when de-armed', () => {
      const { result, rerender } = renderHook(
        ({ active }: { active: boolean }) => useBeatClock(TEMPO, active),
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
      const { result } = renderHook(() => useBeatClock(noCountIn, true))
      act(() => { result.current.start() })
      expect(result.current.songElapsedMs).toBe(0)
      act(() => { vi.advanceTimersByTime(400) })
      expect(result.current.songElapsedMs).toBe(400)
    })
  })

  describe('startAtCue — P1: begins the clock immediately, bypassing any count-in', () => {
    it('goes straight to playing even when tempo has countInBars > 0 (no count-in runs)', () => {
      const { result } = renderHook(() => useBeatClock(TEMPO, true))
      act(() => { result.current.startAtCue() })
      expect(result.current.playState).toBe('playing')
      expect(result.current.beginFiredOnce).toBe(true)
      expect(result.current.songElapsedMs).toBe(0)
    })

    it('works with no tempo at all', () => {
      const { result } = renderHook(() => useBeatClock(undefined, true))
      act(() => { result.current.startAtCue() })
      expect(result.current.playState).toBe('playing')
      expect(result.current.beginFiredOnce).toBe(true)
      expect(result.current.phase).toBeNull()
      expect(result.current.songElapsedMs).toBe(0)
    })

    it('songElapsedMs keeps ticking over time with no tempo at all — the realistic case for a v2 timeline with no BPM metadata (the golden Libertad fixture has none)', () => {
      const { result } = renderHook(() => useBeatClock(undefined, true))
      act(() => { result.current.startAtCue() })
      act(() => { vi.advanceTimersByTime(5850) })
      expect(result.current.songElapsedMs).toBe(5850)
      expect(result.current.phase).toBeNull()
    })

    it('songElapsedMs counts up immediately with no further input', () => {
      // 5850ms is a tick boundary (TICK_MS=50) so the assertion isn't sensitive to interval
      // quantization; the ControlView-level test for the 5.84s Libertad-shaped acceptance
      // criterion advances past the boundary with slack for the same reason.
      const { result } = renderHook(() => useBeatClock(TEMPO, true))
      act(() => { result.current.startAtCue() })
      act(() => { vi.advanceTimersByTime(5850) })
      expect(result.current.songElapsedMs).toBe(5850)
    })

    it('is a no-op when not armed', () => {
      const { result } = renderHook(() => useBeatClock(TEMPO, false))
      act(() => { result.current.startAtCue() })
      expect(result.current.playState).toBe('idle')
      expect(result.current.songElapsedMs).toBe(0)
    })

    it('does not restart the clock once already running (idempotent guard)', () => {
      const { result } = renderHook(() => useBeatClock(TEMPO, true))
      act(() => { result.current.startAtCue() })
      act(() => { vi.advanceTimersByTime(1000) })
      expect(result.current.songElapsedMs).toBe(1000)
      // A second cue-trigger (e.g. a manual Next press after the cue) must not reset the clock.
      act(() => { result.current.startAtCue() })
      act(() => { vi.advanceTimersByTime(500) })
      expect(result.current.songElapsedMs).toBe(1500)
    })

    it('pause() and restart() work normally after a cue-start', () => {
      const { result } = renderHook(() => useBeatClock(TEMPO, true))
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
})
