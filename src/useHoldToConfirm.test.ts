/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useHoldToConfirm, HOLD_CONFIRM_MS } from './useHoldToConfirm'

describe('useHoldToConfirm', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('Restart button behavior', () => {
    it('1. short hold on Restart does nothing', () => {
      const onConfirm = vi.fn()
      const { result } = renderHook(() => useHoldToConfirm(onConfirm))

      act(() => {
        result.current.onPointerDown()
      })
      act(() => {
        vi.advanceTimersByTime(HOLD_CONFIRM_MS - 1)
      })
      act(() => {
        result.current.onPointerUp()
      })

      expect(onConfirm).not.toHaveBeenCalled()
    })

    it('2. hold on Restart for the full threshold triggers restart', () => {
      const onConfirm = vi.fn()
      const { result } = renderHook(() => useHoldToConfirm(onConfirm))

      act(() => {
        result.current.onPointerDown()
      })
      act(() => {
        vi.advanceTimersByTime(HOLD_CONFIRM_MS)
      })

      expect(onConfirm).toHaveBeenCalledTimes(1)
    })

    it('3. releasing Restart early cancels the action', () => {
      const onConfirm = vi.fn()
      const { result } = renderHook(() => useHoldToConfirm(onConfirm))

      act(() => {
        result.current.onPointerDown()
      })
      act(() => {
        vi.advanceTimersByTime(100)
      })
      act(() => {
        result.current.onPointerUp()
      })
      act(() => {
        vi.advanceTimersByTime(HOLD_CONFIRM_MS)
      })

      expect(onConfirm).not.toHaveBeenCalled()
    })
  })

  describe('Close Projection button behavior', () => {
    it('4. short hold on Close Projection does nothing', () => {
      const onConfirm = vi.fn()
      const { result } = renderHook(() => useHoldToConfirm(onConfirm))

      act(() => {
        result.current.onPointerDown()
      })
      act(() => {
        vi.advanceTimersByTime(HOLD_CONFIRM_MS - 1)
      })
      act(() => {
        result.current.onPointerUp()
      })

      expect(onConfirm).not.toHaveBeenCalled()
    })

    it('5. hold on Close Projection for the full threshold triggers close', () => {
      const onConfirm = vi.fn()
      const { result } = renderHook(() => useHoldToConfirm(onConfirm))

      act(() => {
        result.current.onPointerDown()
      })
      act(() => {
        vi.advanceTimersByTime(HOLD_CONFIRM_MS)
      })

      expect(onConfirm).toHaveBeenCalledTimes(1)
    })

    it('6. leaving the button area cancels the hold', () => {
      const onConfirm = vi.fn()
      const { result } = renderHook(() => useHoldToConfirm(onConfirm))

      act(() => {
        result.current.onPointerDown()
      })
      act(() => {
        result.current.onPointerLeave()
      })
      act(() => {
        vi.advanceTimersByTime(HOLD_CONFIRM_MS)
      })

      expect(onConfirm).not.toHaveBeenCalled()
    })
  })
})
