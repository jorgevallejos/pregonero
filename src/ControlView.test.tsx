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
})
