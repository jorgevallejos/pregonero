/** @vitest-environment jsdom */
/**
 * ControlView performer state flow: smallest practical UI/integration-style tests.
 * Renders App with hash #/ so ControlView is shown; drives state via storage and DOM.
 */
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest'
import { render, screen, act, waitFor, within, cleanup } from '@testing-library/react'
import { fireEvent } from '@testing-library/react'
import App from './App'
import {
  setSongLines,
  setSongIndex,
  setBlank,
  setCurrentSongId,
  setProjectionLanguage,
  getSongIndex,
  getBlank,
} from './songState'
import { HOLD_CONFIRM_MS } from './useHoldToConfirm'
import type { SongItem } from './songState'

function createStorage(): Storage {
  const store = new Map<string, string>()
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value) },
    removeItem: (key: string) => { store.delete(key) },
    clear: () => { store.clear() },
    key: (i: number) => [...store.keys()][i] ?? null,
    get length() { return store.size },
  }
}

beforeAll(() => {
  if (typeof globalThis.localStorage === 'undefined' || typeof globalThis.localStorage.setItem !== 'function') {
    vi.stubGlobal('localStorage', createStorage())
  }
  if (typeof globalThis.sessionStorage === 'undefined' || typeof globalThis.sessionStorage.setItem !== 'function') {
    vi.stubGlobal('sessionStorage', createStorage())
  }
  vi.stubGlobal('WebSocket', vi.fn().mockImplementation(() => ({
    readyState: 1,
    send: vi.fn(),
    close: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })))
})

const VALID_LINES: SongItem[] = [
  { es: 'Hola', translations: { en: 'Hello' } },
  { es: 'Mundo', translations: { en: 'World' } },
]

/** Lines for a different "song" and with a second language for language-change tests */
const OTHER_LINES: SongItem[] = [
  { es: 'Uno', translations: { en: 'One', fr: 'Un' } },
  { es: 'Dos', translations: { en: 'Two', fr: 'Deux' } },
]

const WAIT_TIMEOUT = 3000

function getArmButton() {
  const main = screen.getByRole('main')
  return within(main).getByRole('button', { name: 'Arm' })
}

function setupControlViewWithReadinessPassing() {
  sessionStorage.setItem('liveLyricLaunched', '1')
  sessionStorage.removeItem('liveLyricPerformanceArmed')
  setSongLines(VALID_LINES)
  setSongIndex(-1)
  setBlank(true)
  setCurrentSongId('duelo')
  setProjectionLanguage('en')
  window.location.hash = '#/'
  const mockApi = {
    isProjectionOpen: vi.fn().mockResolvedValue(true),
    onProjectionOpened: vi.fn(() => vi.fn()),
    onProjectionClosed: vi.fn(() => vi.fn()),
    openProjection: vi.fn().mockResolvedValue(undefined),
    closeProjection: vi.fn().mockResolvedValue(undefined),
  }
  ;(window as unknown as { electronAPI?: unknown }).electronAPI = mockApi
  return mockApi
}

function setupControlViewWithReadinessFailing() {
  sessionStorage.setItem('liveLyricLaunched', '1')
  sessionStorage.removeItem('liveLyricPerformanceArmed')
  setSongLines(VALID_LINES)
  setSongIndex(-1)
  setBlank(true)
  setCurrentSongId('duelo')
  setProjectionLanguage('en')
  window.location.hash = '#/'
  const mockApi = {
    isProjectionOpen: vi.fn().mockResolvedValue(false),
    onProjectionOpened: vi.fn(() => vi.fn()),
    onProjectionClosed: vi.fn(() => vi.fn()),
    openProjection: vi.fn().mockResolvedValue(undefined),
    closeProjection: vi.fn().mockResolvedValue(undefined),
  }
  ;(window as unknown as { electronAPI?: unknown }).electronAPI = mockApi
  return mockApi
}

function clearStorage() {
  sessionStorage.clear()
  localStorage.clear()
}

/** Trigger storage listeners so hooks re-read from localStorage (simulates another tab changing config). */
function dispatchStorageEvent() {
  window.dispatchEvent(new StorageEvent('storage', { key: null, newValue: null }))
}

describe('ControlView performer state flow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearStorage()
  })

  afterEach(() => {
    vi.useRealTimers()
    cleanup()
    delete (window as unknown as { electronAPI?: unknown }).electronAPI
  })

  it('1. when readiness checks pass, the UI shows Ready to Arm', async () => {
    setupControlViewWithReadinessPassing()
    render(<App />)

    await waitFor(() => {
      expect(screen.getAllByText('Ready to Arm').length).toBeGreaterThan(0)
    }, { timeout: WAIT_TIMEOUT })
  })

  it('2. pressing Arm changes the UI to Ready to Perform', async () => {
    setupControlViewWithReadinessPassing()
    render(<App />)

    await waitFor(() => {
      expect(screen.getAllByText('Ready to Arm').length).toBeGreaterThan(0)
    })

    await act(async () => {
      fireEvent.click(getArmButton())
    })

    expect(screen.getAllByText('Ready to Perform').length).toBeGreaterThan(0)
  })

  it('3. pressing Next from Ready to Perform reveals the first line and enters Performing', async () => {
    setupControlViewWithReadinessPassing()
    render(<App />)

    await waitFor(() => {
      expect(screen.getAllByText('Ready to Arm').length).toBeGreaterThan(0)
    })
    await act(async () => {
      fireEvent.click(getArmButton())
    })
    await waitFor(() => {
      expect(screen.getAllByText('Ready to Perform').length).toBeGreaterThan(0)
    })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /next/i }))
    })

    expect(screen.getAllByText('Performing').length).toBeGreaterThan(0)
    expect(screen.getByText('Hola')).toBeTruthy()
  })

  it('4. Restart returns the UI to Ready to Arm', async () => {
    setupControlViewWithReadinessPassing()
    render(<App />)

    await waitFor(() => {
      expect(screen.getAllByText('Ready to Arm').length).toBeGreaterThan(0)
    }, { timeout: WAIT_TIMEOUT })
    await act(async () => {
      fireEvent.click(getArmButton())
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /next/i }))
    })
    await waitFor(() => {
      expect(screen.getAllByText('Performing').length).toBeGreaterThan(0)
    }, { timeout: WAIT_TIMEOUT })

    vi.useFakeTimers()
    const restartBtn = screen.getByRole('button', { name: /restart/i })
    await act(async () => {
      fireEvent.pointerDown(restartBtn)
    })
    act(() => {
      vi.advanceTimersByTime(HOLD_CONFIRM_MS)
    })
    vi.useRealTimers()

    await waitFor(() => {
      expect(screen.getAllByText('Ready to Arm').length).toBeGreaterThan(0)
    })
  }, 10000)

  it('5. Next is disabled when the app is not armed', async () => {
    setupControlViewWithReadinessPassing()
    render(<App />)

    await waitFor(() => {
      expect(screen.getAllByText('Ready to Arm').length).toBeGreaterThan(0)
    }, { timeout: WAIT_TIMEOUT })

    const nextBtn = screen.getByRole('button', { name: /next/i })
    expect((nextBtn as HTMLButtonElement).disabled).toBe(true)
  }, 10000)

  it('6. Arm is unavailable when readiness checks fail', async () => {
    setupControlViewWithReadinessFailing()
    render(<App />)

    await waitFor(() => {
      expect(screen.getAllByText('Setup').length).toBeGreaterThan(0)
    }, { timeout: WAIT_TIMEOUT })

    const main = screen.getByRole('main')
    expect(within(main).queryByRole('button', { name: 'Arm' })).toBeNull()
  }, 10000)

  describe('reset behavior when configuration changes during a session', () => {
    it('1. changing song while armed resets the session', async () => {
      setupControlViewWithReadinessPassing()
      render(<App />)

      await waitFor(() => {
        expect(screen.getAllByText('Ready to Arm').length).toBeGreaterThan(0)
      })
      await act(async () => {
        fireEvent.click(getArmButton())
      })
      await waitFor(() => {
        expect(screen.getAllByText('Ready to Perform').length).toBeGreaterThan(0)
      })

      setCurrentSongId('other')
      setSongLines(OTHER_LINES)
      setSongIndex(-1)
      setBlank(true)
      dispatchStorageEvent()

      await waitFor(() => {
        expect(screen.getAllByText('Ready to Arm').length).toBeGreaterThan(0)
      })
      expect(screen.queryByText('Ready to Perform')).toBeNull()
    })

    it('2. changing song while performing resets the session', async () => {
      setupControlViewWithReadinessPassing()
      render(<App />)

      await waitFor(() => {
        expect(screen.getAllByText('Ready to Arm').length).toBeGreaterThan(0)
      })
      await act(async () => {
        fireEvent.click(getArmButton())
      })
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /next/i }))
      })
      await waitFor(() => {
        expect(screen.getAllByText('Performing').length).toBeGreaterThan(0)
      })

      setCurrentSongId('other')
      setSongLines(OTHER_LINES)
      setSongIndex(-1)
      setBlank(true)
      dispatchStorageEvent()

      await waitFor(() => {
        expect(screen.getAllByText('Ready to Arm').length).toBeGreaterThan(0)
      })
      expect(screen.queryByText('Performing')).toBeNull()
    })

    it('3. changing language while armed resets the session', async () => {
      setSongLines(OTHER_LINES)
      setSongIndex(-1)
      setBlank(true)
      setCurrentSongId('duelo')
      setProjectionLanguage('en')
      sessionStorage.setItem('liveLyricLaunched', '1')
      sessionStorage.removeItem('liveLyricPerformanceArmed')
      window.location.hash = '#/'
      const mockApi = {
        isProjectionOpen: vi.fn().mockResolvedValue(true),
        onProjectionOpened: vi.fn(() => vi.fn()),
        onProjectionClosed: vi.fn(() => vi.fn()),
        openProjection: vi.fn().mockResolvedValue(undefined),
        closeProjection: vi.fn().mockResolvedValue(undefined),
      }
      ;(window as unknown as { electronAPI?: unknown }).electronAPI = mockApi

      render(<App />)

      await waitFor(() => {
        expect(screen.getAllByText('Ready to Arm').length).toBeGreaterThan(0)
      })
      await act(async () => {
        fireEvent.click(getArmButton())
      })
      await waitFor(() => {
        expect(screen.getAllByText('Ready to Perform').length).toBeGreaterThan(0)
      })

      setProjectionLanguage('fr')
      dispatchStorageEvent()

      await waitFor(() => {
        expect(screen.getAllByText('Ready to Arm').length).toBeGreaterThan(0)
      })
      expect(screen.queryByText('Ready to Perform')).toBeNull()
    })

    it('4. changing language while performing resets the session', async () => {
      setSongLines(OTHER_LINES)
      setSongIndex(-1)
      setBlank(true)
      setCurrentSongId('duelo')
      setProjectionLanguage('en')
      sessionStorage.setItem('liveLyricLaunched', '1')
      sessionStorage.removeItem('liveLyricPerformanceArmed')
      window.location.hash = '#/'
      const mockApi = {
        isProjectionOpen: vi.fn().mockResolvedValue(true),
        onProjectionOpened: vi.fn(() => vi.fn()),
        onProjectionClosed: vi.fn(() => vi.fn()),
        openProjection: vi.fn().mockResolvedValue(undefined),
        closeProjection: vi.fn().mockResolvedValue(undefined),
      }
      ;(window as unknown as { electronAPI?: unknown }).electronAPI = mockApi

      render(<App />)

      await waitFor(() => {
        expect(screen.getAllByText('Ready to Arm').length).toBeGreaterThan(0)
      })
      await act(async () => {
        fireEvent.click(getArmButton())
      })
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /next/i }))
      })
      await waitFor(() => {
        expect(screen.getAllByText('Performing').length).toBeGreaterThan(0)
      })

      setProjectionLanguage('fr')
      dispatchStorageEvent()

      await waitFor(() => {
        expect(screen.getAllByText('Ready to Arm').length).toBeGreaterThan(0)
      })
      expect(screen.queryByText('Performing')).toBeNull()
    })

    it('5. closing projection while armed causes readiness to fail', async () => {
      const closeCallbacks: Array<() => void> = []
      setupControlViewWithReadinessPassing()
      const mockApi = {
        isProjectionOpen: vi.fn().mockResolvedValue(true),
        onProjectionOpened: vi.fn(() => vi.fn()),
        onProjectionClosed: vi.fn((cb: () => void) => {
          closeCallbacks.push(cb)
          return vi.fn()
        }),
        openProjection: vi.fn().mockResolvedValue(undefined),
        closeProjection: vi.fn().mockResolvedValue(undefined),
      }
      ;(window as unknown as { electronAPI?: unknown }).electronAPI = mockApi

      render(<App />)

      await waitFor(() => {
        expect(screen.getAllByText('Ready to Arm').length).toBeGreaterThan(0)
      })
      await act(async () => {
        fireEvent.click(getArmButton())
      })
      await waitFor(() => {
        expect(screen.getAllByText('Ready to Perform').length).toBeGreaterThan(0)
      })

      await act(async () => {
        closeCallbacks[0]()
      })

      await waitFor(() => {
        expect(screen.getAllByText('Setup').length).toBeGreaterThan(0)
      })
      const main = screen.getByRole('main')
      expect(within(main).queryByRole('button', { name: 'Arm' })).toBeNull()
    })

    it('6. closing projection while performing causes readiness to fail', async () => {
      const closeCallbacks: Array<() => void> = []
      setupControlViewWithReadinessPassing()
      const mockApi = {
        isProjectionOpen: vi.fn().mockResolvedValue(true),
        onProjectionOpened: vi.fn(() => vi.fn()),
        onProjectionClosed: vi.fn((cb: () => void) => {
          closeCallbacks.push(cb)
          return vi.fn()
        }),
        openProjection: vi.fn().mockResolvedValue(undefined),
        closeProjection: vi.fn().mockResolvedValue(undefined),
      }
      ;(window as unknown as { electronAPI?: unknown }).electronAPI = mockApi

      render(<App />)

      await waitFor(() => {
        expect(screen.getAllByText('Ready to Arm').length).toBeGreaterThan(0)
      })
      await act(async () => {
        fireEvent.click(getArmButton())
      })
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /next/i }))
      })
      await waitFor(() => {
        expect(screen.getAllByText('Performing').length).toBeGreaterThan(0)
      })

      await act(async () => {
        closeCallbacks[0]()
      })

      await waitFor(() => {
        expect(screen.getAllByText('Setup').length).toBeGreaterThan(0)
      })
      const main = screen.getByRole('main')
      expect(within(main).queryByRole('button', { name: 'Arm' })).toBeNull()
    })
  })

  describe('projection synchronization (control state → projection payload)', () => {
    let sendSpy: ReturnType<typeof vi.fn>
    let WsConstructor: ReturnType<typeof vi.fn>

    beforeEach(() => {
      sendSpy = vi.fn()
      WsConstructor = vi.fn().mockImplementation(function (this: Record<string, unknown>) {
        const instance = {
          readyState: 1,
          send: sendSpy,
          close: vi.fn(),
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
        }
        return instance
      })
      const StubWS = Object.assign(WsConstructor, { OPEN: 1 })
      vi.stubGlobal('WebSocket', StubWS)
    })

    function getLastCommandPayload(): { type: string; action: string; currentIndex?: number; blank?: boolean; value?: number } | null {
      const calls = sendSpy.mock.calls
      for (let i = calls.length - 1; i >= 0; i--) {
        try {
          const msg = JSON.parse(calls[i][0]) as { type: string; action?: string; currentIndex?: number; blank?: boolean; value?: number }
          if (msg.type === 'command') return msg
        } catch {
          // ignore
        }
      }
      return null
    }

    it('1. advancing to next line sends command with currentIndex and blank matching control state after goNext', async () => {
      setupControlViewWithReadinessPassing()
      render(<App />)

      await waitFor(() => {
        expect(screen.getAllByText('Ready to Arm').length).toBeGreaterThan(0)
      })
      await act(async () => {
        fireEvent.click(getArmButton())
      })
      await waitFor(() => {
        expect(screen.getAllByText('Ready to Perform').length).toBeGreaterThan(0)
      })

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /next/i }))
      })

      const cmd = getLastCommandPayload()
      expect(cmd).not.toBeNull()
      expect(cmd?.action).toBe('next')
      expect(cmd?.currentIndex).toBe(0)
      expect(cmd?.blank).toBe(false)
      expect(getSongIndex()).toBe(0)
      expect(getBlank()).toBe(false)
    })

    it('2. restart sends setIndex with currentIndex -1 and blank true', async () => {
      setupControlViewWithReadinessPassing()
      render(<App />)

      await waitFor(() => {
        expect(screen.getAllByText('Ready to Arm').length).toBeGreaterThan(0)
      })
      await act(async () => {
        fireEvent.click(getArmButton())
      })
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /next/i }))
      })
      await waitFor(() => {
        expect(screen.getAllByText('Performing').length).toBeGreaterThan(0)
      })

      vi.useFakeTimers()
      const restartBtn = screen.getByRole('button', { name: /restart/i })
      await act(async () => {
        fireEvent.pointerDown(restartBtn)
      })
      act(() => {
        vi.advanceTimersByTime(HOLD_CONFIRM_MS)
      })
      vi.useRealTimers()

      const cmd = getLastCommandPayload()
      expect(cmd).not.toBeNull()
      expect(cmd?.action).toBe('setIndex')
      expect(cmd?.value).toBe(-1)
      expect(cmd?.currentIndex).toBe(-1)
      expect(cmd?.blank).toBe(true)
      expect(getSongIndex()).toBe(-1)
      expect(getBlank()).toBe(true)
    })

    it('3. setIndex (restart path) sends payload consistent with control state', async () => {
      setupControlViewWithReadinessPassing()
      render(<App />)

      await waitFor(() => {
        expect(screen.getAllByText('Ready to Arm').length).toBeGreaterThan(0)
      })
      await act(async () => {
        fireEvent.click(getArmButton())
      })
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /next/i }))
      })
      vi.useFakeTimers()
      await act(async () => {
        fireEvent.pointerDown(screen.getByRole('button', { name: /restart/i }))
      })
      act(() => {
        vi.advanceTimersByTime(HOLD_CONFIRM_MS)
      })
      vi.useRealTimers()

      const cmd = getLastCommandPayload()
      expect(cmd?.currentIndex).toBe(getSongIndex())
      expect(cmd?.blank).toBe(getBlank())
    })

    it('4. blank/index state sent to projection matches control state (prev and blankToggle)', async () => {
      setupControlViewWithReadinessPassing()
      render(<App />)

      await waitFor(() => {
        expect(screen.getAllByText('Ready to Arm').length).toBeGreaterThan(0)
      })
      await act(async () => {
        fireEvent.click(getArmButton())
      })
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /next/i }))
      })
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /next/i }))
      })
      await waitFor(() => {
        expect(screen.getByText('Mundo')).toBeTruthy()
      })

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /previous/i }))
      })

      const prevCmd = getLastCommandPayload()
      expect(prevCmd?.action).toBe('prev')
      expect(prevCmd?.currentIndex).toBe(getSongIndex())
      expect(prevCmd?.blank).toBe(getBlank())

      await act(async () => {
        fireEvent.keyDown(window, { key: 'b' })
      })
      const blankCmd = getLastCommandPayload()
      expect(blankCmd?.action).toBe('blankToggle')
      expect(blankCmd?.currentIndex).toBe(getSongIndex())
      expect(blankCmd?.blank).toBe(getBlank())
    })
  })

  describe('keyboard shortcut behavior', () => {
    it('1. Next shortcut triggers navigation when allowed (armed)', async () => {
      setupControlViewWithReadinessPassing()
      render(<App />)

      await waitFor(() => {
        expect(screen.getAllByText('Ready to Arm').length).toBeGreaterThan(0)
      })
      await act(async () => {
        fireEvent.click(getArmButton())
      })
      await waitFor(() => {
        expect(screen.getAllByText('Ready to Perform').length).toBeGreaterThan(0)
      })

      await act(async () => {
        fireEvent.keyDown(window, { key: 'ArrowRight' })
      })

      expect(getSongIndex()).toBe(0)
      expect(screen.getAllByText('Performing').length).toBeGreaterThan(0)
    })

    it('2. Restart shortcut triggers restart when allowed (after hold)', async () => {
      setupControlViewWithReadinessPassing()
      render(<App />)

      await waitFor(() => {
        expect(screen.getAllByText('Ready to Arm').length).toBeGreaterThan(0)
      })
      await act(async () => {
        fireEvent.click(getArmButton())
      })
      await act(async () => {
        fireEvent.keyDown(window, { key: 'ArrowRight' })
      })
      await waitFor(() => {
        expect(screen.getAllByText('Performing').length).toBeGreaterThan(0)
      })
      expect(getSongIndex()).toBe(0)

      vi.useFakeTimers()
      await act(async () => {
        fireEvent.keyDown(window, { key: 'r' })
      })
      act(() => {
        vi.advanceTimersByTime(HOLD_CONFIRM_MS)
      })
      await act(async () => {
        fireEvent.keyUp(window, { key: 'r' })
      })
      vi.useRealTimers()

      await waitFor(() => {
        expect(screen.getAllByText('Ready to Arm').length).toBeGreaterThan(0)
      })
      expect(getSongIndex()).toBe(-1)
      expect(getBlank()).toBe(true)
    })

    it('3. Arm shortcut changes state when allowed (ready)', async () => {
      setupControlViewWithReadinessPassing()
      render(<App />)

      await waitFor(() => {
        expect(screen.getAllByText('Ready to Arm').length).toBeGreaterThan(0)
      })

      await act(async () => {
        fireEvent.keyDown(window, { key: 'a' })
      })

      expect(screen.getAllByText('Ready to Perform').length).toBeGreaterThan(0)
    })

    it('4. Unarm shortcut changes state when allowed (armed)', async () => {
      setupControlViewWithReadinessPassing()
      render(<App />)

      await waitFor(() => {
        expect(screen.getAllByText('Ready to Arm').length).toBeGreaterThan(0)
      })
      await act(async () => {
        fireEvent.keyDown(window, { key: 'a' })
      })
      await waitFor(() => {
        expect(screen.getAllByText('Ready to Perform').length).toBeGreaterThan(0)
      })

      await act(async () => {
        fireEvent.keyDown(window, { key: 'a' })
      })

      expect(screen.getAllByText('Ready to Arm').length).toBeGreaterThan(0)
      expect(screen.queryByText('Ready to Perform')).toBeNull()
    })

    it('5. Next shortcut does nothing when not allowed (ready, not armed)', async () => {
      setupControlViewWithReadinessPassing()
      render(<App />)

      await waitFor(() => {
        expect(screen.getAllByText('Ready to Arm').length).toBeGreaterThan(0)
      })
      expect(getSongIndex()).toBe(-1)

      await act(async () => {
        fireEvent.keyDown(window, { key: 'ArrowRight' })
      })

      expect(getSongIndex()).toBe(-1)
    })

    it('6. Next shortcut does nothing when at last line (performing)', async () => {
      setupControlViewWithReadinessPassing()
      render(<App />)

      await waitFor(() => {
        expect(screen.getAllByText('Ready to Arm').length).toBeGreaterThan(0)
      })
      await act(async () => {
        fireEvent.click(getArmButton())
      })
      await act(async () => {
        fireEvent.keyDown(window, { key: 'ArrowRight' })
      })
      await act(async () => {
        fireEvent.keyDown(window, { key: 'ArrowRight' })
      })
      await waitFor(() => {
        expect(screen.getByText('Mundo')).toBeTruthy()
      })
      expect(getSongIndex()).toBe(1)
      expect(VALID_LINES.length).toBe(2)

      await act(async () => {
        fireEvent.keyDown(window, { key: 'ArrowRight' })
      })

      expect(getSongIndex()).toBe(1)
    })

    it('7. Restart shortcut does nothing without hold (does not bypass safety)', async () => {
      setupControlViewWithReadinessPassing()
      render(<App />)

      await waitFor(() => {
        expect(screen.getAllByText('Ready to Arm').length).toBeGreaterThan(0)
      })
      await act(async () => {
        fireEvent.click(getArmButton())
      })
      await act(async () => {
        fireEvent.keyDown(window, { key: 'ArrowRight' })
      })
      await waitFor(() => {
        expect(screen.getAllByText('Performing').length).toBeGreaterThan(0)
      })

      await act(async () => {
        fireEvent.keyDown(window, { key: 'r' })
      })
      await act(async () => {
        fireEvent.keyUp(window, { key: 'r' })
      })

      expect(getSongIndex()).toBe(0)
      expect(screen.getAllByText('Performing').length).toBeGreaterThan(0)
    })

    it('8. Arm shortcut does nothing when not allowed (setup)', async () => {
      setupControlViewWithReadinessFailing()
      render(<App />)

      await waitFor(() => {
        expect(screen.getAllByText('Setup').length).toBeGreaterThan(0)
      })

      await act(async () => {
        fireEvent.keyDown(window, { key: 'a' })
      })

      expect(screen.queryByText('Ready to Perform')).toBeNull()
      const main = screen.getByRole('main')
      expect(within(main).queryByRole('button', { name: 'Arm' })).toBeNull()
    })
  })

  describe('Performer journey (full integration)', () => {
    const SONG_JSON = JSON.stringify([
      { es: 'Hola', translations: { en: 'Hello' } },
      { es: 'Mundo', translations: { en: 'World' } },
    ])

    /** Helper: hold a button for HOLD_CONFIRM_MS so the confirm action runs (Restart / Close Projection). */
    async function holdConfirm(button: HTMLElement) {
      vi.useFakeTimers()
      await act(async () => {
        fireEvent.pointerDown(button)
      })
      act(() => {
        vi.advanceTimersByTime(HOLD_CONFIRM_MS)
      })
      await act(async () => {
        fireEvent.pointerUp(button)
      })
      vi.useRealTimers()
    }

    it('full flow: load song → open projection → choose language → Ready to Arm → Arm → Next → Performing → restart → close projection', async () => {
      // Steps: 1 load song, 2 open projection, 3 choose language, 4 reach Ready to Arm,
      // 5 Arm, 6 Next, 7 Performing, 8 restart, 9 close projection.
      clearStorage()
      window.location.hash = '#/'
      const fetchMock = vi.fn().mockImplementation((url: string) => {
        if (url === '/duelo.json') {
          return Promise.resolve({ ok: true, text: () => Promise.resolve(SONG_JSON) })
        }
        return Promise.reject(new Error('Unexpected fetch'))
      })
      vi.stubGlobal('fetch', fetchMock)

      const mockApi = {
        isProjectionOpen: vi.fn().mockResolvedValue(false),
        onProjectionOpened: vi.fn(() => vi.fn()),
        onProjectionClosed: vi.fn(() => vi.fn()),
        openProjection: vi.fn().mockResolvedValue(undefined),
        closeProjection: vi.fn().mockResolvedValue(undefined),
      }
      ;(window as unknown as { electronAPI?: unknown }).electronAPI = mockApi

      render(<App />)

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Songs' })).toBeTruthy()
      })

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Songs' }))
      })
      window.dispatchEvent(new HashChangeEvent('hashchange', { newURL: window.location.href, oldURL: window.location.href }))

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Duelo' })).toBeTruthy()
      })
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Duelo' }))
      })

      await waitFor(() => {
        expect(screen.getByText('Duelo')).toBeTruthy()
      }, { timeout: WAIT_TIMEOUT })

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Languages' }))
      })
      window.dispatchEvent(new HashChangeEvent('hashchange', { newURL: window.location.href, oldURL: window.location.href }))

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'EN' })).toBeTruthy()
      })
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'EN' }))
      })

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Open Projection' })).toBeTruthy()
      })
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Open Projection' }))
      })

      await waitFor(() => {
        expect(screen.getAllByText('Ready to Arm').length).toBeGreaterThan(0)
      }, { timeout: WAIT_TIMEOUT })

      await act(async () => {
        fireEvent.click(getArmButton())
      })
      await waitFor(() => {
        expect(screen.getAllByText('Ready to Perform').length).toBeGreaterThan(0)
      })

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /next/i }))
      })
      await waitFor(() => {
        expect(screen.getAllByText('Performing').length).toBeGreaterThan(0)
        expect(screen.getByText('Hola')).toBeTruthy()
      })

      await holdConfirm(screen.getByRole('button', { name: /restart/i }))

      await waitFor(() => {
        expect(screen.getAllByText('Ready to Arm').length).toBeGreaterThan(0)
      })

      await holdConfirm(screen.getByRole('button', { name: 'Close Projection' }))

      await waitFor(() => {
        expect(screen.getAllByText('Setup').length).toBeGreaterThan(0)
        expect(screen.getByRole('button', { name: 'Open Projection' })).toBeTruthy()
      }, { timeout: WAIT_TIMEOUT })
    }, 15000)
  })
})
