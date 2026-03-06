/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useProjectionOpenState, type ProjectionAPI } from './useProjectionOpenState'

function createMockAPI(overrides: Partial<ProjectionAPI> = {}): ProjectionAPI {
  return {
    isProjectionOpen: vi.fn().mockResolvedValue(false),
    onProjectionOpened: vi.fn(() => vi.fn()),
    onProjectionClosed: vi.fn(() => vi.fn()),
    openProjection: vi.fn().mockResolvedValue(undefined),
    closeProjection: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

describe('useProjectionOpenState', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('1. Opening projection marks projection as open', () => {
    it('openProjection() sets projectionOpen to true and calls api.openProjection', async () => {
      const api = createMockAPI()
      const { result } = renderHook(() => useProjectionOpenState(api))

      expect(result.current.projectionOpen).toBe(false)
      await waitFor(() => expect(api.isProjectionOpen).toHaveBeenCalled())

      await act(async () => {
        result.current.openProjection()
      })

      expect(api.openProjection).toHaveBeenCalledTimes(1)
      expect(result.current.projectionOpen).toBe(true)
    })

    it('when onProjectionOpened fires, projectionOpen becomes true', async () => {
      const api = createMockAPI()
      let openedCb: (() => void) | null = null
      api.onProjectionOpened = vi.fn((cb) => {
        openedCb = cb
        return vi.fn()
      })

      const { result } = renderHook(() => useProjectionOpenState(api))

      await waitFor(() => expect(api.onProjectionOpened).toHaveBeenCalled())
      expect(result.current.projectionOpen).toBe(false)

      await act(async () => {
        openedCb!()
      })

      expect(result.current.projectionOpen).toBe(true)
    })
  })

  describe('4. Closing projection updates projectionOpen state consistently', () => {
    it('closeProjection() sets projectionOpen to false and calls api.closeProjection', async () => {
      const api = createMockAPI({ isProjectionOpen: vi.fn().mockResolvedValue(true) })
      const { result } = renderHook(() => useProjectionOpenState(api))

      await waitFor(() => {
        expect(result.current.projectionOpen).toBe(true)
      })

      await act(async () => {
        result.current.closeProjection()
      })

      expect(api.closeProjection).toHaveBeenCalledTimes(1)
      expect(result.current.projectionOpen).toBe(false)
    })

    it('when onProjectionClosed fires, projectionOpen becomes false', async () => {
      const api = createMockAPI({ isProjectionOpen: vi.fn().mockResolvedValue(true) })
      let closedCb: (() => void) | null = null
      api.onProjectionClosed = vi.fn((cb) => {
        closedCb = cb
        return vi.fn()
      })

      const { result } = renderHook(() => useProjectionOpenState(api))

      await waitFor(() => {
        expect(result.current.projectionOpen).toBe(true)
      })

      await act(async () => {
        closedCb!()
      })

      expect(result.current.projectionOpen).toBe(false)
    })
  })

  describe('initial state and no-ops when api missing', () => {
    it('when api is undefined, projectionOpen is false and open/close do not throw', () => {
      const { result } = renderHook(() => useProjectionOpenState(undefined))

      expect(result.current.projectionOpen).toBe(false)

      expect(() => {
        result.current.openProjection()
        result.current.closeProjection()
      }).not.toThrow()
      expect(result.current.projectionOpen).toBe(false)
    })

    it('initial state comes from isProjectionOpen()', async () => {
      const api = createMockAPI({ isProjectionOpen: vi.fn().mockResolvedValue(true) })
      const { result } = renderHook(() => useProjectionOpenState(api))

      expect(result.current.projectionOpen).toBe(false)

      await waitFor(() => {
        expect(result.current.projectionOpen).toBe(true)
      })

      expect(api.isProjectionOpen).toHaveBeenCalledTimes(1)
    })
  })
})
