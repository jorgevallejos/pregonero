/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useBeatClock } from './useBeatClock'
import type { SongTempo } from './beatScheduler'

const TEMPO: SongTempo = { bpm: 120, meter: 4, countInBars: 1 }
// 120 bpm → 500ms/beat, 4 beats count-in → begin at 2000ms

describe('useBeatClock', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns null phase when not active', () => {
    const { result } = renderHook(() => useBeatClock(undefined, false))
    expect(result.current.phase).toBeNull()
    expect(result.current.beginFiredOnce).toBe(false)
  })

  it('returns null phase when active but tempo is undefined', () => {
    const { result } = renderHook(() => useBeatClock(undefined, true))
    act(() => { vi.advanceTimersByTime(100) })
    expect(result.current.phase).toBeNull()
    expect(result.current.beginFiredOnce).toBe(false)
  })

  it('returns a phase immediately on activation', () => {
    const { result } = renderHook(() => useBeatClock(TEMPO, true))
    act(() => { vi.advanceTimersByTime(0) })
    expect(result.current.phase).not.toBeNull()
    expect(result.current.phase?.inCountIn).toBe(true)
    expect(result.current.phase?.beatInBar).toBe(1)
  })

  it('advances beat as time progresses', () => {
    const { result } = renderHook(() => useBeatClock(TEMPO, true))
    act(() => { vi.advanceTimersByTime(500) })
    expect(result.current.phase?.beatInBar).toBe(2)
  })

  it('beginFiredOnce becomes true after count-in completes', () => {
    const { result } = renderHook(() => useBeatClock(TEMPO, true))
    act(() => { vi.advanceTimersByTime(1999) })
    expect(result.current.beginFiredOnce).toBe(false)
    act(() => { vi.advanceTimersByTime(1) })
    expect(result.current.beginFiredOnce).toBe(true)
  })

  it('beginFiredOnce stays true once set (does not toggle)', () => {
    const { result } = renderHook(() => useBeatClock(TEMPO, true))
    act(() => { vi.advanceTimersByTime(3000) })
    expect(result.current.beginFiredOnce).toBe(true)
    act(() => { vi.advanceTimersByTime(2000) })
    expect(result.current.beginFiredOnce).toBe(true)
  })

  it('phase shows inCountIn=false after count-in', () => {
    const { result } = renderHook(() => useBeatClock(TEMPO, true))
    act(() => { vi.advanceTimersByTime(2000) })
    expect(result.current.phase?.inCountIn).toBe(false)
    expect(result.current.phase?.beginFired).toBe(true)
  })

  it('resets phase and beginFiredOnce when deactivated', () => {
    const { result, rerender } = renderHook(
      ({ active }: { active: boolean }) => useBeatClock(TEMPO, active),
      { initialProps: { active: true } }
    )
    act(() => { vi.advanceTimersByTime(3000) })
    expect(result.current.beginFiredOnce).toBe(true)

    rerender({ active: false })
    act(() => { vi.advanceTimersByTime(100) })
    expect(result.current.phase).toBeNull()
    expect(result.current.beginFiredOnce).toBe(false)
  })

  it('resets and restarts when reactivated after deactivation', () => {
    const { result, rerender } = renderHook(
      ({ active }: { active: boolean }) => useBeatClock(TEMPO, active),
      { initialProps: { active: true } }
    )
    act(() => { vi.advanceTimersByTime(3000) })
    expect(result.current.beginFiredOnce).toBe(true)

    rerender({ active: false })
    act(() => { vi.advanceTimersByTime(100) })

    rerender({ active: true })
    act(() => { vi.advanceTimersByTime(0) })
    expect(result.current.phase?.inCountIn).toBe(true)
    expect(result.current.beginFiredOnce).toBe(false)
  })

  it('reset() function clears phase and beginFiredOnce mid-run', () => {
    const { result } = renderHook(() => useBeatClock(TEMPO, true))
    act(() => { vi.advanceTimersByTime(3000) })
    expect(result.current.beginFiredOnce).toBe(true)

    act(() => { result.current.reset() })
    expect(result.current.phase).toBeNull()
    expect(result.current.beginFiredOnce).toBe(false)
  })
})
