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
  setSingingLanguage,
  getSingingLanguage,
  getSongIndex,
  getBlank,
  getCurrentSongId,
} from './songState'
import { HOLD_CONFIRM_MS } from './useHoldToConfirm'
import { getPlayedSongIds, addPlayedSong } from './playedSongsState'
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
  { languages: { es: 'Hola', en: 'Hello' } },
  { languages: { es: 'Mundo', en: 'World' } },
]

/** Lines for a different "song" and with a second language for language-change tests */
const OTHER_LINES: SongItem[] = [
  { languages: { es: 'Uno', en: 'One', fr: 'Un' } },
  { languages: { es: 'Dos', en: 'Two', fr: 'Deux' } },
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
  setSingingLanguage('es')
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
  setSingingLanguage('es')
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

/** Helpers for v0.5 state machine integration tests: no song, no lang, projection closed, not armed */
function setupControlViewInitial() {
  sessionStorage.setItem('liveLyricLaunched', '1')
  sessionStorage.removeItem('liveLyricPerformanceArmed')
  setSongLines([])
  setSongIndex(-1)
  setBlank(true)
  setCurrentSongId('')
  setProjectionLanguage('')
  setSingingLanguage('')
  window.location.hash = '#/'
  if (typeof window.history?.replaceState === 'function') {
    window.history.replaceState(null, '', window.location.pathname + window.location.search + '#/')
  }
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

describe('v0.5 control screen state machine integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearStorage()
  })

  afterEach(() => {
    vi.useRealTimers()
    cleanup()
    delete (window as unknown as { electronAPI?: unknown }).electronAPI
  })

  it('1. Initial screen is Performance: Setup', async () => {
    setupControlViewInitial()
    render(<App initialHash="#/" />)

    await waitFor(
      () => {
        const labelEl = screen.getByTestId('performance-state-label')
        expect(labelEl.textContent).toBe('Performance: Setup')
      },
      { timeout: WAIT_TIMEOUT }
    )
  })

  it('2. In Setup state, the sections appear in this exact order: Song, LANGUAGE DISPLAY, Projection, Arm', async () => {
    setupControlViewInitial()
    setSongLines(VALID_LINES)
    setCurrentSongId('duelo')
    setProjectionLanguage('en')
    const api = window as unknown as { electronAPI?: { isProjectionOpen: () => Promise<boolean> } }
    api.electronAPI = {
      ...api.electronAPI!,
      isProjectionOpen: vi.fn().mockResolvedValue(false),
    } as unknown as typeof api.electronAPI
    render(<App initialHash="#/" />)

    await waitFor(
      () => {
        expect(screen.getByTestId('performance-state-label').textContent).toBe('Performance: Setup')
      },
      { timeout: WAIT_TIMEOUT }
    )

    const main = screen.getByRole('main')
    const sections = main.querySelectorAll('.control-setup-section')
    expect(sections.length).toBeGreaterThanOrEqual(4)
    const firstLabels = Array.from(sections).map((s) => s.querySelector('.control-setup-label')?.textContent)
    expect(firstLabels[0]).toBe('Song')
    expect(firstLabels[1]).toBe('LANGUAGE DISPLAY')
    expect(firstLabels[2]).toBe('Projection')
    expect(firstLabels[3]).toBe('Arm')
  })

  it('2b. In Setup state, old top navigation shell is not rendered (no top bar, no bottom transport)', async () => {
    setupControlViewInitial()
    setSongLines(VALID_LINES)
    setCurrentSongId('duelo')
    setProjectionLanguage('en')
    render(<App initialHash="#/" />)

    await waitFor(
      () => {
        expect(screen.getByTestId('performance-state-label').textContent).toBe('Performance: Setup')
      },
      { timeout: WAIT_TIMEOUT }
    )

    expect(screen.queryByRole('banner')).toBeNull()
    expect(screen.queryByRole('button', { name: /previous/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /next/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /restart/i })).toBeNull()
  })

  it('2c. In Ready to Arm state, old top navigation shell and bottom transport are not rendered', async () => {
    setupControlViewWithReadinessPassing()
    render(<App initialHash="#/" />)

    await waitFor(
      () => {
        expect(screen.getByTestId('performance-state-label').textContent).toBe('Performance: Ready to Arm')
      },
      { timeout: WAIT_TIMEOUT }
    )

    expect(screen.queryByRole('banner')).toBeNull()
    expect(screen.queryByRole('button', { name: /previous/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /next/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /restart/i })).toBeNull()
  })

  it('2d. In Setup state, LANGUAGE DISPLAY column has a single "Languages" button (not Singing/Translation)', async () => {
    setupControlViewInitial()
    setSongLines(VALID_LINES)
    setCurrentSongId('duelo')
    setProjectionLanguage('en')
    render(<App initialHash="#/" />)

    await waitFor(
      () => {
        expect(screen.getByTestId('performance-state-label').textContent).toBe('Performance: Setup')
      },
      { timeout: WAIT_TIMEOUT }
    )

    expect(screen.getByRole('button', { name: 'Languages' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Singing' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Translation' })).toBeNull()
  })

  it('2e. Languages screen: two columns (Singing, Projection), Confirm button; only Confirm returns to control', async () => {
    setSongLines(VALID_LINES)
    setCurrentSongId('duelo')
    setSingingLanguage('')
    setProjectionLanguage('')
    window.location.hash = '#/languages'
    render(<App initialHash="#/languages" />)

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Languages' })).toBeTruthy()
    })

    expect(screen.getByRole('region', { name: 'Singing' })).toBeTruthy()
    expect(screen.getByRole('region', { name: 'Projection' })).toBeTruthy()
    const confirmBtn = screen.getByRole('button', { name: 'Confirm' })
    expect(confirmBtn).toBeTruthy()

    await act(async () => {
      fireEvent.click(within(screen.getByRole('region', { name: 'Singing' })).getByRole('button', { name: 'ES' }))
    })
    expect(window.location.hash).toBe('#/languages')

    await act(async () => {
      fireEvent.click(within(screen.getByRole('region', { name: 'Projection' })).getByRole('button', { name: 'EN' }))
    })
    expect(window.location.hash).toBe('#/languages')

    await act(async () => {
      fireEvent.click(confirmBtn)
    })
    expect(window.location.hash).toBe('#/')
  })

  it('3. Arm is disabled until all prerequisites are satisfied', async () => {
    setupControlViewInitial()
    setSongLines(VALID_LINES)
    setCurrentSongId('duelo')
    setProjectionLanguage('en')
    render(<App initialHash="#/" />)

    await waitFor(
      () => {
        expect(screen.getByTestId('performance-state-label').textContent).toBe('Performance: Setup')
      },
      { timeout: WAIT_TIMEOUT }
    )

    const main = screen.getByRole('main')
    const armBtn = within(main).queryByRole('button', { name: 'Arm' })
    expect(armBtn === null || (armBtn as HTMLButtonElement).disabled).toBe(true)
  })

  it('4. When all prerequisites are satisfied, status becomes READY_TO_ARM and Arm is enabled', async () => {
    setupControlViewWithReadinessPassing()
    render(<App initialHash="#/" />)

    await waitFor(
      () => {
        expect(screen.getByTestId('performance-state-label').textContent).toBe('Performance: Ready to Arm')
      },
      { timeout: WAIT_TIMEOUT }
    )

    const armBtn = getArmButton()
    expect((armBtn as HTMLButtonElement).disabled).toBe(false)
  })

  it('4b. When song and translation are set but singing language is not selected, state remains SETUP', async () => {
    sessionStorage.setItem('liveLyricLaunched', '1')
    sessionStorage.removeItem('liveLyricPerformanceArmed')
    setSongLines(VALID_LINES)
    setSongIndex(-1)
    setBlank(true)
    setCurrentSongId('duelo')
    setProjectionLanguage('en')
    setSingingLanguage('')
    window.location.hash = '#/'
    const mockApi = {
      isProjectionOpen: vi.fn().mockResolvedValue(true),
      onProjectionOpened: vi.fn(() => vi.fn()),
      onProjectionClosed: vi.fn(() => vi.fn()),
      openProjection: vi.fn().mockResolvedValue(undefined),
      closeProjection: vi.fn().mockResolvedValue(undefined),
    }
    ;(window as unknown as { electronAPI?: unknown }).electronAPI = mockApi

    render(<App initialHash="#/" />)

    await waitFor(
      () => {
        expect(screen.getByTestId('performance-state-label').textContent).toBe('Performance: Setup')
      },
      { timeout: WAIT_TIMEOUT }
    )

    const armBtn = getArmButton()
    expect((armBtn as HTMLButtonElement).disabled).toBe(true)
  })

  it('4c. Setup/ready screen displays language pair as singing → translation (ES → EN)', async () => {
    setupControlViewWithReadinessPassing()
    render(<App initialHash="#/" />)

    await waitFor(
      () => {
        expect(screen.getByTestId('performance-state-label').textContent).toBe('Performance: Ready to Arm')
      },
      { timeout: WAIT_TIMEOUT }
    )

    const main = screen.getByRole('main')
    expect(main.textContent).toMatch(/ES → EN/)
  })

  it('5. Pressing Arm switches the UI to ARMED state', async () => {
    setupControlViewWithReadinessPassing()
    render(<App initialHash="#/" />)

    await waitFor(
      () => {
        expect(screen.getByTestId('performance-state-label').textContent).toBe('Performance: Ready to Arm')
      },
      { timeout: WAIT_TIMEOUT }
    )
    await act(async () => {
      fireEvent.click(getArmButton())
    })

    expect(screen.getByTestId('performance-state-label').textContent).toBe('Performance: Armed')
  })

  it('6. In ARMED state, show Previous, Next, Restart, Unarm', async () => {
    setupControlViewWithReadinessPassing()
    render(<App initialHash="#/" />)

    await waitFor(
      () => {
        expect(screen.getByTestId('performance-state-label').textContent).toBe('Performance: Ready to Arm')
      },
      { timeout: WAIT_TIMEOUT }
    )
    await act(async () => {
      fireEvent.click(getArmButton())
    })

    expect(screen.getByTestId('performance-state-label').textContent).toBe('Performance: Armed')
    expect(screen.getByRole('button', { name: /previous/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /next/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /restart/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /^Unarm/ })).toBeTruthy()
  })

  it('7. In ARMED state, show header summary with Song, Languages, Projection state', async () => {
    setupControlViewWithReadinessPassing()
    render(<App initialHash="#/" />)

    await waitFor(
      () => {
        expect(screen.getByTestId('performance-state-label').textContent).toBe('Performance: Ready to Arm')
      },
      { timeout: WAIT_TIMEOUT }
    )
    await act(async () => {
      fireEvent.click(getArmButton())
    })

    expect(screen.getByTestId('performance-state-label').textContent).toBe('Performance: Armed')
    const header = screen.getByRole('banner')
    expect(header.textContent).toMatch(/Duelo/)
    expect(header.textContent).toMatch(/EN|language/i)
    expect(header.textContent).toMatch(/projection|open/i)
  })

  it('8. Pressing Unarm returns to READY_TO_ARM', async () => {
    setupControlViewWithReadinessPassing()
    render(<App initialHash="#/" />)

    await waitFor(
      () => {
        expect(screen.getByTestId('performance-state-label').textContent).toBe('Performance: Ready to Arm')
      },
      { timeout: WAIT_TIMEOUT }
    )
    await act(async () => {
      fireEvent.click(getArmButton())
    })
    expect(screen.getByTestId('performance-state-label').textContent).toBe('Performance: Armed')

    vi.useFakeTimers()
    const unarmBtn = screen.getByRole('button', { name: /^Unarm/ })
    await act(async () => {
      fireEvent.pointerDown(unarmBtn)
    })
    act(() => {
      vi.advanceTimersByTime(HOLD_CONFIRM_MS)
    })
    vi.useRealTimers()

    expect(screen.getByTestId('performance-state-label').textContent).toBe('Performance: Ready to Arm')
  })

  it('8a. Unarm button requires hold-to-confirm (single click does not unarm)', async () => {
    setupControlViewWithReadinessPassing()
    render(<App initialHash="#/" />)

    await waitFor(
      () => {
        expect(screen.getByTestId('performance-state-label').textContent).toBe('Performance: Ready to Arm')
      },
      { timeout: WAIT_TIMEOUT }
    )
    await act(async () => {
      fireEvent.click(getArmButton())
    })
    expect(screen.getByTestId('performance-state-label').textContent).toBe('Performance: Armed')

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^Unarm/ }))
    })

    expect(screen.getByTestId('performance-state-label').textContent).toBe('Performance: Armed')
  })

  it('8b. Unarm does not clear setup values: song, languages, projection remain', async () => {
    setupControlViewWithReadinessPassing()
    render(<App initialHash="#/" />)

    await waitFor(
      () => {
        expect(screen.getByTestId('performance-state-label').textContent).toBe('Performance: Ready to Arm')
      },
      { timeout: WAIT_TIMEOUT }
    )
    await act(async () => {
      fireEvent.click(getArmButton())
    })
    expect(screen.getByTestId('performance-state-label').textContent).toBe('Performance: Armed')

    vi.useFakeTimers()
    const unarmBtn = screen.getByRole('button', { name: /^Unarm/ })
    await act(async () => {
      fireEvent.pointerDown(unarmBtn)
    })
    act(() => {
      vi.advanceTimersByTime(HOLD_CONFIRM_MS)
    })
    vi.useRealTimers()

    expect(screen.getByTestId('performance-state-label').textContent).toBe('Performance: Ready to Arm')
    const main = screen.getByRole('main')
    expect(main.textContent).toMatch(/Duelo|Song selected/)
    expect(main.textContent).toMatch(/ES → EN|Languages selected/)
    expect(main.textContent).toMatch(/Open|Projection/)
    expect(getSongIndex()).toBe(-1)
    expect(getCurrentSongId()).toBe('duelo')
    expect(getSingingLanguage()).toBe('es')
  })

  it('8c. Unarm when a prerequisite is no longer satisfied returns to SETUP', async () => {
    let onProjectionClosed: (() => void) | null = null
    const mockApi = {
      isProjectionOpen: vi.fn().mockResolvedValue(true),
      onProjectionOpened: vi.fn(() => vi.fn()),
      onProjectionClosed: vi.fn((cb: () => void) => {
        onProjectionClosed = cb
        return vi.fn()
      }),
      openProjection: vi.fn().mockResolvedValue(undefined),
      closeProjection: vi.fn().mockResolvedValue(undefined),
    }
    sessionStorage.setItem('liveLyricLaunched', '1')
    sessionStorage.removeItem('liveLyricPerformanceArmed')
    setSongLines(VALID_LINES)
    setSongIndex(-1)
    setBlank(true)
    setCurrentSongId('duelo')
    setProjectionLanguage('en')
    setSingingLanguage('es')
    window.location.hash = '#/'
    ;(window as unknown as { electronAPI?: unknown }).electronAPI = mockApi

    render(<App initialHash="#/" />)

    await waitFor(
      () => {
        expect(screen.getByTestId('performance-state-label').textContent).toBe('Performance: Ready to Arm')
      },
      { timeout: WAIT_TIMEOUT }
    )
    await act(async () => {
      fireEvent.click(getArmButton())
    })
    expect(screen.getByTestId('performance-state-label').textContent).toBe('Performance: Armed')

    await act(async () => {
      onProjectionClosed?.()
    })

    await waitFor(
      () => {
        expect(screen.getByTestId('performance-state-label').textContent).toBe('Performance: Setup')
      },
      { timeout: WAIT_TIMEOUT }
    )
  })

  it('8d. Close: single click closes projection (no hold required)', async () => {
    setupControlViewWithReadinessPassing()
    render(<App initialHash="#/" />)

    await waitFor(
      () => {
        expect(screen.getByTestId('performance-state-label').textContent).toBe('Performance: Ready to Arm')
      },
      { timeout: WAIT_TIMEOUT }
    )

    expect(screen.getByRole('button', { name: 'Close' })).toBeTruthy()
    const closeProjection = (window as unknown as { electronAPI?: { closeProjection: () => unknown } }).electronAPI!.closeProjection

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    })

    await waitFor(
      () => {
        expect(screen.getByRole('button', { name: 'Open' })).toBeTruthy()
      },
      { timeout: WAIT_TIMEOUT }
    )
    expect(closeProjection).toHaveBeenCalledTimes(1)
  })

  it('9. Navigation controls are only available in ARMED state', async () => {
    setupControlViewWithReadinessPassing()
    render(<App initialHash="#/" />)

    await waitFor(
      () => {
        expect(screen.getByTestId('performance-state-label').textContent).toBe('Performance: Ready to Arm')
      },
      { timeout: WAIT_TIMEOUT }
    )

    expect(screen.queryByRole('button', { name: /next/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /previous/i })).toBeNull()

    await act(async () => {
      fireEvent.click(getArmButton())
    })

    expect(screen.getByTestId('performance-state-label').textContent).toBe('Performance: Armed')
    expect(screen.getByRole('button', { name: /next/i })).toBeTruthy()
    expect((screen.getByRole('button', { name: /next/i }) as HTMLButtonElement).disabled).toBe(false)
  })

  describe('End-of-song behaviour', () => {
    it('when armed and current phrase is the last lyric phrase, Unarm button uses same green style as Arm (ctrl-arm)', async () => {
      setupControlViewWithReadinessPassing()
      setSongIndex(1)
      render(<App initialHash="#/" />)

      await waitFor(() => {
        expect(screen.getByTestId('performance-state-label').textContent).toBe('Performance: Ready to Arm')
      }, { timeout: WAIT_TIMEOUT })
      await act(async () => {
        fireEvent.click(getArmButton())
      })
      await waitFor(() => {
        expect(screen.getByTestId('performance-state-label').textContent).toBe('Performance: Armed')
      })

      const unarmBtn = screen.getByRole('button', { name: /^Unarm/ })
      expect(unarmBtn.classList.contains('ctrl-arm')).toBe(true)
      expect(unarmBtn.classList.contains('ctrl-unarm')).toBe(false)
    })

    it('when armed and at last lyric phrase, single click on Unarm unarms immediately (no hold required)', async () => {
      setupControlViewWithReadinessPassing()
      setSongIndex(1)
      render(<App initialHash="#/" />)

      await waitFor(() => {
        expect(screen.getByTestId('performance-state-label').textContent).toBe('Performance: Ready to Arm')
      }, { timeout: WAIT_TIMEOUT })
      await act(async () => {
        fireEvent.click(getArmButton())
      })
      await waitFor(() => {
        expect(screen.getByTestId('performance-state-label').textContent).toBe('Performance: Armed')
      })
      expect(screen.getByText('Mundo')).toBeTruthy()

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /^Unarm/ }))
      })

      expect(screen.getByTestId('performance-state-label').textContent).toBe('Performance: Ready to Arm')
    })

    it('when armed and not at last lyric phrase, Unarm keeps normal style and requires hold-to-confirm', async () => {
      setupControlViewWithReadinessPassing()
      setSongIndex(0)
      render(<App initialHash="#/" />)

      await waitFor(() => {
        expect(screen.getByTestId('performance-state-label').textContent).toBe('Performance: Ready to Arm')
      }, { timeout: WAIT_TIMEOUT })
      await act(async () => {
        fireEvent.click(getArmButton())
      })
      await waitFor(() => {
        expect(screen.getByTestId('performance-state-label').textContent).toBe('Performance: Armed')
      })

      const unarmBtn = screen.getByRole('button', { name: /^Unarm/ })
      expect(unarmBtn.classList.contains('ctrl-unarm')).toBe(true)
      expect(unarmBtn.classList.contains('ctrl-arm')).toBe(false)

      await act(async () => {
        fireEvent.click(unarmBtn)
      })
      expect(screen.getByTestId('performance-state-label').textContent).toBe('Performance: Armed')
    })

    it('when armed at last phrase then user restarts, Unarm returns to normal style and hold-to-confirm', async () => {
      setupControlViewWithReadinessPassing()
      setSongIndex(1)
      render(<App initialHash="#/" />)

      await waitFor(() => {
        expect(screen.getByTestId('performance-state-label').textContent).toBe('Performance: Ready to Arm')
      }, { timeout: WAIT_TIMEOUT })
      await act(async () => {
        fireEvent.click(getArmButton())
      })
      await waitFor(() => {
        expect(screen.getByTestId('performance-state-label').textContent).toBe('Performance: Armed')
      })
      const unarmAtEnd = screen.getByRole('button', { name: /^Unarm/ })
      expect(unarmAtEnd.classList.contains('ctrl-arm')).toBe(true)

      vi.useFakeTimers()
      await act(async () => {
        fireEvent.pointerDown(screen.getByRole('button', { name: /restart/i }))
      })
      act(() => {
        vi.advanceTimersByTime(HOLD_CONFIRM_MS)
      })
      vi.useRealTimers()

      await waitFor(() => {
        expect(screen.getByText(/Press Next to reveal the first line/)).toBeTruthy()
      })
      const unarmAfterRestart = screen.getByRole('button', { name: /^Unarm/ })
      expect(unarmAfterRestart.classList.contains('ctrl-unarm')).toBe(true)
      expect(unarmAfterRestart.classList.contains('ctrl-arm')).toBe(false)

      await act(async () => {
        fireEvent.click(unarmAfterRestart)
      })
      expect(screen.getByTestId('performance-state-label').textContent).toBe('Performance: Armed')
    })

    it('when armed at last phrase then user goes Previous, Unarm returns to normal style and hold-to-confirm', async () => {
      setupControlViewWithReadinessPassing()
      setSongIndex(1)
      render(<App initialHash="#/" />)

      await waitFor(() => {
        expect(screen.getByTestId('performance-state-label').textContent).toBe('Performance: Ready to Arm')
      }, { timeout: WAIT_TIMEOUT })
      await act(async () => {
        fireEvent.click(getArmButton())
      })
      await waitFor(() => {
        expect(screen.getByTestId('performance-state-label').textContent).toBe('Performance: Armed')
      })
      expect(screen.getByRole('button', { name: /^Unarm/ }).classList.contains('ctrl-arm')).toBe(true)

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /previous/i }))
      })
      await waitFor(() => {
        expect(screen.getByText('Hola')).toBeTruthy()
      })

      const unarmBtn = screen.getByRole('button', { name: /^Unarm/ })
      expect(unarmBtn.classList.contains('ctrl-unarm')).toBe(true)
      expect(unarmBtn.classList.contains('ctrl-arm')).toBe(false)
      await act(async () => {
        fireEvent.click(unarmBtn)
      })
      expect(screen.getByTestId('performance-state-label').textContent).toBe('Performance: Armed')
    })
  })
})

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
    render(<App initialHash="#/" />)

    await waitFor(() => {
      expect(screen.getAllByText(/Ready to Arm/).length).toBeGreaterThan(0)
    }, { timeout: WAIT_TIMEOUT })
  })

  it('2. pressing Arm changes the UI to Ready to Perform', async () => {
    setupControlViewWithReadinessPassing()
    render(<App initialHash="#/" />)

    await waitFor(() => {
      expect(screen.getAllByText(/Ready to Arm/).length).toBeGreaterThan(0)
    })

    await act(async () => {
      fireEvent.click(getArmButton())
    })

    expect(screen.getAllByText(/Armed/).length).toBeGreaterThan(0)
  })

  it('3. pressing Next from Ready to Perform reveals the first line and enters Performing', async () => {
    setupControlViewWithReadinessPassing()
    render(<App initialHash="#/" />)

    await waitFor(() => {
      expect(screen.getAllByText(/Ready to Arm/).length).toBeGreaterThan(0)
    })
    await act(async () => {
      fireEvent.click(getArmButton())
    })
    await waitFor(() => {
      expect(screen.getAllByText(/Armed/).length).toBeGreaterThan(0)
    })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /next/i }))
    })

    expect(screen.getByTestId('performance-state-label').textContent).toBe('Performance: Armed')
    expect(screen.getByText('Hola')).toBeTruthy()
  })

  it('4. Restart from ARMED keeps state ARMED and resets only song position', async () => {
    setupControlViewWithReadinessPassing()
    render(<App initialHash="#/" />)

    await waitFor(() => {
      expect(screen.getAllByText(/Ready to Arm/).length).toBeGreaterThan(0)
    }, { timeout: WAIT_TIMEOUT })
    await act(async () => {
      fireEvent.click(getArmButton())
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /next/i }))
    })
    await waitFor(() => {
      expect(screen.getByTestId('performance-state-label').textContent).toBe('Performance: Armed')
    }, { timeout: WAIT_TIMEOUT })
    expect(screen.getByText('Hola')).toBeTruthy()

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
      expect(screen.getByTestId('performance-state-label').textContent).toBe('Performance: Armed')
    })
    expect(screen.getByText(/Press Next to reveal the first line/)).toBeTruthy()
    expect(getSongIndex()).toBe(-1)
  }, 10000)

  it('4b. Unarm from ARMED returns to READY_TO_ARM without clearing setup values', async () => {
    setupControlViewWithReadinessPassing()
    render(<App initialHash="#/" />)

    await waitFor(() => {
      expect(screen.getByTestId('performance-state-label').textContent).toBe('Performance: Ready to Arm')
    }, { timeout: WAIT_TIMEOUT })
    await act(async () => {
      fireEvent.click(getArmButton())
    })
    expect(screen.getByTestId('performance-state-label').textContent).toBe('Performance: Armed')

    vi.useFakeTimers()
    const unarmBtn = screen.getByRole('button', { name: /^Unarm/ })
    await act(async () => {
      fireEvent.pointerDown(unarmBtn)
    })
    act(() => {
      vi.advanceTimersByTime(HOLD_CONFIRM_MS)
    })
    vi.useRealTimers()

    expect(screen.getByTestId('performance-state-label').textContent).toBe('Performance: Ready to Arm')
    expect(getCurrentSongId()).toBe('duelo')
    expect(getSongIndex()).toBe(-1)
  })

  it('5. Next is not shown when the app is not armed (transport only in Armed state)', async () => {
    setupControlViewWithReadinessPassing()
    render(<App initialHash="#/" />)

    await waitFor(() => {
      expect(screen.getAllByText(/Ready to Arm/).length).toBeGreaterThan(0)
    }, { timeout: WAIT_TIMEOUT })

    expect(screen.queryByRole('button', { name: /next/i })).toBeNull()
  }, 10000)

  it('6. Arm is unavailable when readiness checks fail', async () => {
    setupControlViewWithReadinessFailing()
    render(<App initialHash="#/" />)

    await waitFor(() => {
      expect(screen.getAllByText(/Setup/).length).toBeGreaterThan(0)
    }, { timeout: WAIT_TIMEOUT })

    const main = screen.getByRole('main')
    const armBtn = within(main).queryByRole('button', { name: 'Arm' })
    expect(armBtn).not.toBeNull()
    expect((armBtn as HTMLButtonElement).disabled).toBe(true)
  }, 10000)

  describe('reset behavior when configuration changes during a session', () => {
    it('1. changing song while armed resets the session', async () => {
      setupControlViewWithReadinessPassing()
      render(<App initialHash="#/" />)

      await waitFor(() => {
        expect(screen.getAllByText(/Ready to Arm/).length).toBeGreaterThan(0)
      })
      await act(async () => {
        fireEvent.click(getArmButton())
      })
      await waitFor(() => {
        expect(screen.getAllByText(/Armed/).length).toBeGreaterThan(0)
      })

      setCurrentSongId('other')
      setSongLines(OTHER_LINES)
      setSongIndex(-1)
      setBlank(true)
      dispatchStorageEvent()

      await waitFor(() => {
        expect(screen.getAllByText(/Ready to Arm/).length).toBeGreaterThan(0)
      })
      expect(screen.queryByText(/Armed/)).toBeNull()
    })

    it('2. changing song while performing resets the session', async () => {
      setupControlViewWithReadinessPassing()
      render(<App initialHash="#/" />)

      await waitFor(() => {
        expect(screen.getAllByText(/Ready to Arm/).length).toBeGreaterThan(0)
      })
      await act(async () => {
        fireEvent.click(getArmButton())
      })
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /next/i }))
      })
      await waitFor(() => {
        expect(screen.getByTestId('performance-state-label').textContent).toBe('Performance: Armed')
      })

      setCurrentSongId('other')
      setSongLines(OTHER_LINES)
      setSongIndex(-1)
      setBlank(true)
      dispatchStorageEvent()

      await waitFor(() => {
        expect(screen.getAllByText(/Ready to Arm/).length).toBeGreaterThan(0)
      })
      expect(screen.getByTestId('performance-state-label').textContent).toBe('Performance: Ready to Arm')
    })

    it('3. changing language while armed resets the session', async () => {
      setSongLines(OTHER_LINES)
      setSongIndex(-1)
      setBlank(true)
      setCurrentSongId('duelo')
      setProjectionLanguage('en')
      setSingingLanguage('es')
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

      render(<App initialHash="#/" />)

      await waitFor(() => {
        expect(screen.getAllByText(/Ready to Arm/).length).toBeGreaterThan(0)
      })
      await act(async () => {
        fireEvent.click(getArmButton())
      })
      await waitFor(() => {
        expect(screen.getAllByText(/Armed/).length).toBeGreaterThan(0)
      })

      setProjectionLanguage('fr')
      dispatchStorageEvent()

      await waitFor(() => {
        expect(screen.getAllByText(/Ready to Arm/).length).toBeGreaterThan(0)
      })
      expect(screen.queryByText(/Armed/)).toBeNull()
    })

    it('4. changing language while performing resets the session', async () => {
      setSongLines(OTHER_LINES)
      setSongIndex(-1)
      setBlank(true)
      setCurrentSongId('duelo')
      setProjectionLanguage('en')
      setSingingLanguage('es')
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

      render(<App initialHash="#/" />)

      await waitFor(() => {
        expect(screen.getAllByText(/Ready to Arm/).length).toBeGreaterThan(0)
      })
      await act(async () => {
        fireEvent.click(getArmButton())
      })
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /next/i }))
      })
      await waitFor(() => {
        expect(screen.getByTestId('performance-state-label').textContent).toBe('Performance: Armed')
      })

      setProjectionLanguage('fr')
      dispatchStorageEvent()

      await waitFor(() => {
        expect(screen.getAllByText(/Ready to Arm/).length).toBeGreaterThan(0)
      })
      expect(screen.getByTestId('performance-state-label').textContent).toBe('Performance: Ready to Arm')
    })

    it('5. after unarm mid-performance, changing projection language resets lyrics and sends setIndex to projection', async () => {
      const sendSpy = vi.fn()
      const WsConstructor = vi.fn().mockImplementation(function (this: Record<string, unknown>) {
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

      sessionStorage.setItem('liveLyricLaunched', '1')
      sessionStorage.removeItem('liveLyricPerformanceArmed')
      setSongLines(OTHER_LINES)
      setSongIndex(-1)
      setBlank(true)
      setCurrentSongId('duelo')
      setProjectionLanguage('en')
      setSingingLanguage('es')
      window.location.hash = '#/'
      const mockApi = {
        isProjectionOpen: vi.fn().mockResolvedValue(true),
        onProjectionOpened: vi.fn(() => vi.fn()),
        onProjectionClosed: vi.fn(() => vi.fn()),
        openProjection: vi.fn().mockResolvedValue(undefined),
        closeProjection: vi.fn().mockResolvedValue(undefined),
      }
      ;(window as unknown as { electronAPI?: unknown }).electronAPI = mockApi

      render(<App initialHash="#/" />)

      await waitFor(() => {
        expect(screen.getAllByText(/Ready to Arm/).length).toBeGreaterThan(0)
      })
      await act(async () => {
        fireEvent.click(getArmButton())
      })
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /next/i }))
      })
      await waitFor(() => {
        expect(getSongIndex()).toBe(0)
      })

      vi.useFakeTimers()
      const unarmBtn = screen.getByRole('button', { name: /^Unarm/ })
      await act(async () => {
        fireEvent.pointerDown(unarmBtn)
      })
      act(() => {
        vi.advanceTimersByTime(HOLD_CONFIRM_MS)
      })
      vi.useRealTimers()

      expect(screen.getByTestId('performance-state-label').textContent).toBe('Performance: Ready to Arm')
      expect(getSongIndex()).toBe(0)

      setProjectionLanguage('fr')
      dispatchStorageEvent()

      await waitFor(() => {
        expect(getSongIndex()).toBe(-1)
        expect(getBlank()).toBe(true)
      })

      let lastCmd: {
        type?: string
        action?: string
        value?: number
        currentIndex?: number
        blank?: boolean
      } | null = null
      for (let i = sendSpy.mock.calls.length - 1; i >= 0; i--) {
        const msg = JSON.parse(sendSpy.mock.calls[i][0] as string) as typeof lastCmd & { type: string }
        if (msg.type === 'command') {
          lastCmd = msg
          break
        }
      }
      expect(lastCmd).not.toBeNull()
      expect(lastCmd?.action).toBe('setIndex')
      expect(lastCmd?.value).toBe(-1)
      expect(lastCmd?.currentIndex).toBe(-1)
      expect(lastCmd?.blank).toBe(true)
    })

    it('6. after unarm mid-performance, changing singing language resets lyrics', async () => {
      sessionStorage.setItem('liveLyricLaunched', '1')
      sessionStorage.removeItem('liveLyricPerformanceArmed')
      setSongLines(OTHER_LINES)
      setSongIndex(-1)
      setBlank(true)
      setCurrentSongId('duelo')
      setProjectionLanguage('en')
      setSingingLanguage('es')
      window.location.hash = '#/'
      const mockApi = {
        isProjectionOpen: vi.fn().mockResolvedValue(true),
        onProjectionOpened: vi.fn(() => vi.fn()),
        onProjectionClosed: vi.fn(() => vi.fn()),
        openProjection: vi.fn().mockResolvedValue(undefined),
        closeProjection: vi.fn().mockResolvedValue(undefined),
      }
      ;(window as unknown as { electronAPI?: unknown }).electronAPI = mockApi

      render(<App initialHash="#/" />)

      await waitFor(() => {
        expect(screen.getAllByText(/Ready to Arm/).length).toBeGreaterThan(0)
      })
      await act(async () => {
        fireEvent.click(getArmButton())
      })
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /next/i }))
      })
      await waitFor(() => {
        expect(getSongIndex()).toBe(0)
      })

      vi.useFakeTimers()
      const unarmBtn = screen.getByRole('button', { name: /^Unarm/ })
      await act(async () => {
        fireEvent.pointerDown(unarmBtn)
      })
      act(() => {
        vi.advanceTimersByTime(HOLD_CONFIRM_MS)
      })
      vi.useRealTimers()

      expect(getSongIndex()).toBe(0)

      setSingingLanguage('fr')
      dispatchStorageEvent()

      await waitFor(() => {
        expect(getSongIndex()).toBe(-1)
        expect(getBlank()).toBe(true)
      })
    })

    it('7. after unarm mid-performance, changing song resets progression when the new song still has a valid prior index', async () => {
      sessionStorage.setItem('liveLyricLaunched', '1')
      sessionStorage.removeItem('liveLyricPerformanceArmed')
      setSongLines(VALID_LINES)
      setSongIndex(-1)
      setBlank(true)
      setCurrentSongId('duelo')
      setProjectionLanguage('en')
      setSingingLanguage('es')
      window.location.hash = '#/'
      const mockApi = {
        isProjectionOpen: vi.fn().mockResolvedValue(true),
        onProjectionOpened: vi.fn(() => vi.fn()),
        onProjectionClosed: vi.fn(() => vi.fn()),
        openProjection: vi.fn().mockResolvedValue(undefined),
        closeProjection: vi.fn().mockResolvedValue(undefined),
      }
      ;(window as unknown as { electronAPI?: unknown }).electronAPI = mockApi

      render(<App initialHash="#/" />)

      await waitFor(() => {
        expect(screen.getAllByText(/Ready to Arm/).length).toBeGreaterThan(0)
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
        expect(getSongIndex()).toBe(1)
      })

      vi.useFakeTimers()
      const unarmBtn = screen.getByRole('button', { name: /^Unarm/ })
      await act(async () => {
        fireEvent.pointerDown(unarmBtn)
      })
      act(() => {
        vi.advanceTimersByTime(HOLD_CONFIRM_MS)
      })
      vi.useRealTimers()

      expect(getSongIndex()).toBe(1)

      setCurrentSongId('other')
      setSongLines(OTHER_LINES)
      setSongIndex(1)
      setBlank(false)
      dispatchStorageEvent()

      await waitFor(() => {
        expect(getSongIndex()).toBe(-1)
        expect(getBlank()).toBe(true)
      })
    })

    it('8. closing projection while armed causes readiness to fail', async () => {
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

      render(<App initialHash="#/" />)

      await waitFor(() => {
        expect(screen.getAllByText(/Ready to Arm/).length).toBeGreaterThan(0)
      })
      await act(async () => {
        fireEvent.click(getArmButton())
      })
      await waitFor(() => {
        expect(screen.getAllByText(/Armed/).length).toBeGreaterThan(0)
      })

      await act(async () => {
        closeCallbacks[0]()
      })

      await waitFor(() => {
        expect(screen.getAllByText(/Setup/).length).toBeGreaterThan(0)
      })
      const main = screen.getByRole('main')
      const armBtn = within(main).queryByRole('button', { name: 'Arm' })
      expect(armBtn).not.toBeNull()
      expect((armBtn as HTMLButtonElement).disabled).toBe(true)
    })

    it('9. closing projection while performing causes readiness to fail', async () => {
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

      render(<App initialHash="#/" />)

      await waitFor(() => {
        expect(screen.getAllByText(/Ready to Arm/).length).toBeGreaterThan(0)
      })
      await act(async () => {
        fireEvent.click(getArmButton())
      })
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /next/i }))
      })
      await waitFor(() => {
        expect(screen.getByTestId('performance-state-label').textContent).toBe('Performance: Armed')
      })

      await act(async () => {
        closeCallbacks[0]()
      })

      await waitFor(() => {
        expect(screen.getAllByText(/Setup/).length).toBeGreaterThan(0)
      })
      const main = screen.getByRole('main')
      const armBtn = within(main).queryByRole('button', { name: 'Arm' })
      expect(armBtn).not.toBeNull()
      expect((armBtn as HTMLButtonElement).disabled).toBe(true)
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
      render(<App initialHash="#/" />)

      await waitFor(() => {
        expect(screen.getAllByText(/Ready to Arm/).length).toBeGreaterThan(0)
      })
      await act(async () => {
        fireEvent.click(getArmButton())
      })
      await waitFor(() => {
        expect(screen.getAllByText(/Armed/).length).toBeGreaterThan(0)
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
      render(<App initialHash="#/" />)

      await waitFor(() => {
        expect(screen.getAllByText(/Ready to Arm/).length).toBeGreaterThan(0)
      })
      await act(async () => {
        fireEvent.click(getArmButton())
      })
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /next/i }))
      })
      await waitFor(() => {
        expect(screen.getByTestId('performance-state-label').textContent).toBe('Performance: Armed')
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
      render(<App initialHash="#/" />)

      await waitFor(() => {
        expect(screen.getAllByText(/Ready to Arm/).length).toBeGreaterThan(0)
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
      render(<App initialHash="#/" />)

      await waitFor(() => {
        expect(screen.getAllByText(/Ready to Arm/).length).toBeGreaterThan(0)
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
      render(<App initialHash="#/" />)

      await waitFor(() => {
        expect(screen.getAllByText(/Ready to Arm/).length).toBeGreaterThan(0)
      })
      await act(async () => {
        fireEvent.click(getArmButton())
      })
      await waitFor(() => {
        expect(screen.getAllByText(/Armed/).length).toBeGreaterThan(0)
      })

      await act(async () => {
        fireEvent.keyDown(window, { key: 'ArrowRight' })
      })

      expect(getSongIndex()).toBe(0)
      expect(screen.getByTestId('performance-state-label').textContent).toBe('Performance: Armed')
    })

    it('2. Restart shortcut triggers restart when allowed (after hold)', async () => {
      setupControlViewWithReadinessPassing()
      render(<App initialHash="#/" />)

      await waitFor(() => {
        expect(screen.getAllByText(/Ready to Arm/).length).toBeGreaterThan(0)
      })
      await act(async () => {
        fireEvent.click(getArmButton())
      })
      await act(async () => {
        fireEvent.keyDown(window, { key: 'ArrowRight' })
      })
      await waitFor(() => {
        expect(screen.getByTestId('performance-state-label').textContent).toBe('Performance: Armed')
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
        expect(screen.getByTestId('performance-state-label').textContent).toBe('Performance: Armed')
      })
      expect(getSongIndex()).toBe(-1)
      expect(getBlank()).toBe(true)
    })

    it('3. Arm shortcut changes state when allowed (ready)', async () => {
      setupControlViewWithReadinessPassing()
      render(<App initialHash="#/" />)

      await waitFor(() => {
        expect(screen.getAllByText(/Ready to Arm/).length).toBeGreaterThan(0)
      })

      await act(async () => {
        fireEvent.keyDown(window, { key: 'a' })
      })

      expect(screen.getAllByText(/Armed/).length).toBeGreaterThan(0)
    })

    it('4. Unarm shortcut changes state when allowed (armed)', async () => {
      setupControlViewWithReadinessPassing()
      render(<App initialHash="#/" />)

      await waitFor(() => {
        expect(screen.getAllByText(/Ready to Arm/).length).toBeGreaterThan(0)
      })
      await act(async () => {
        fireEvent.keyDown(window, { key: 'a' })
      })
      await waitFor(() => {
        expect(screen.getAllByText(/Armed/).length).toBeGreaterThan(0)
      })

      await act(async () => {
        fireEvent.keyDown(window, { key: 'a' })
      })

      expect(screen.getAllByText(/Ready to Arm/).length).toBeGreaterThan(0)
      expect(screen.queryByText(/Armed/)).toBeNull()
    })

    it('5. Next shortcut does nothing when not allowed (ready, not armed)', async () => {
      setupControlViewWithReadinessPassing()
      render(<App initialHash="#/" />)

      await waitFor(() => {
        expect(screen.getAllByText(/Ready to Arm/).length).toBeGreaterThan(0)
      })
      expect(getSongIndex()).toBe(-1)

      await act(async () => {
        fireEvent.keyDown(window, { key: 'ArrowRight' })
      })

      expect(getSongIndex()).toBe(-1)
    })

    it('6. Next shortcut does nothing when at last line (performing)', async () => {
      setupControlViewWithReadinessPassing()
      render(<App initialHash="#/" />)

      await waitFor(() => {
        expect(screen.getAllByText(/Ready to Arm/).length).toBeGreaterThan(0)
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
      render(<App initialHash="#/" />)

      await waitFor(() => {
        expect(screen.getAllByText(/Ready to Arm/).length).toBeGreaterThan(0)
      })
      await act(async () => {
        fireEvent.click(getArmButton())
      })
      await act(async () => {
        fireEvent.keyDown(window, { key: 'ArrowRight' })
      })
      await waitFor(() => {
        expect(screen.getByTestId('performance-state-label').textContent).toBe('Performance: Armed')
      })

      await act(async () => {
        fireEvent.keyDown(window, { key: 'r' })
      })
      await act(async () => {
        fireEvent.keyUp(window, { key: 'r' })
      })

      expect(getSongIndex()).toBe(0)
      expect(screen.getByTestId('performance-state-label').textContent).toBe('Performance: Armed')
    })

    it('8. Arm shortcut does nothing when not allowed (setup)', async () => {
      setupControlViewWithReadinessFailing()
      render(<App initialHash="#/" />)

      await waitFor(() => {
        expect(screen.getAllByText(/Setup/).length).toBeGreaterThan(0)
      })

      await act(async () => {
        fireEvent.keyDown(window, { key: 'a' })
      })

      expect(screen.queryByText(/Armed/)).toBeNull()
      const main = screen.getByRole('main')
      const armBtn = within(main).queryByRole('button', { name: 'Arm' })
      expect(armBtn).not.toBeNull()
      expect((armBtn as HTMLButtonElement).disabled).toBe(true)
    })
  })

  describe('Songs screen confirmation', () => {
    const SONG_JSON = JSON.stringify({
      title: 'Duelo',
      lyrics: [
        { es: 'Hola', en: 'Hello' },
        { es: 'Mundo', en: 'World' },
      ],
    })

    function openSongsScreen() {
      clearStorage()
      setCurrentSongId('duelo')
      setSongLines(VALID_LINES)
      setSongIndex(-1)
      setBlank(true)
      sessionStorage.setItem('liveLyricLaunched', '1')
      window.location.hash = '#/songs'
      const fetchMock = vi.fn().mockImplementation((url: string) => {
        if (url === 'duelo.json' || url.endsWith('/duelo.json')) {
          return Promise.resolve({ ok: true, text: () => Promise.resolve(SONG_JSON) })
        }
        return Promise.reject(new Error('Unexpected fetch'))
      })
      vi.stubGlobal('fetch', fetchMock)
      ;(window as unknown as { electronAPI?: unknown }).electronAPI = {
        isProjectionOpen: vi.fn().mockResolvedValue(true),
        onProjectionOpened: vi.fn(() => vi.fn()),
        onProjectionClosed: vi.fn(() => vi.fn()),
        openProjection: vi.fn().mockResolvedValue(undefined),
        closeProjection: vi.fn().mockResolvedValue(undefined),
      }
      render(<App />)
      return fetchMock
    }

    /** Opens Songs screen with no active song (selection not pre-filled). */
    function openSongsScreenWithNoActiveSong() {
      clearStorage()
      setCurrentSongId('')
      setSongLines([])
      setSongIndex(-1)
      setBlank(true)
      sessionStorage.setItem('liveLyricLaunched', '1')
      window.location.hash = '#/songs'
      const fetchMock = vi.fn().mockImplementation((url: string) => {
        if (url === 'duelo.json' || url.endsWith('/duelo.json')) {
          return Promise.resolve({ ok: true, text: () => Promise.resolve(SONG_JSON) })
        }
        return Promise.reject(new Error('Unexpected fetch'))
      })
      vi.stubGlobal('fetch', fetchMock)
      ;(window as unknown as { electronAPI?: unknown }).electronAPI = {
        isProjectionOpen: vi.fn().mockResolvedValue(true),
        onProjectionOpened: vi.fn(() => vi.fn()),
        onProjectionClosed: vi.fn(() => vi.fn()),
        openProjection: vi.fn().mockResolvedValue(undefined),
        closeProjection: vi.fn().mockResolvedValue(undefined),
      }
      render(<App />)
      return fetchMock
    }

    it('when entering Songs screen with an active song, that song is already selected and Confirm is enabled', async () => {
      openSongsScreen()
      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Duelo' })).toBeTruthy()
      })
      const dueloSongBtn = within(screen.getByRole('main')).getAllByRole('button', { name: /Duelo/ }).find((b) => b.classList.contains('songs-song-btn'))
      expect(dueloSongBtn).toBeTruthy()
      expect(dueloSongBtn!.classList.contains('ctrl-arm')).toBe(true)
      expect(dueloSongBtn!.getAttribute('aria-pressed')).toBe('true')
      const confirmBtn = screen.getByRole('button', { name: 'Confirm' })
      expect((confirmBtn as HTMLButtonElement).disabled).toBe(false)
    })

    it('selecting a song does not immediately change active song or navigate away', async () => {
      openSongsScreen()
      setCurrentSongId('pimiento')
      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Duelo' })).toBeTruthy()
      })
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Duelo' }))
      })
      expect(getCurrentSongId()).toBe('pimiento')
      expect(screen.getByRole('heading', { name: 'Setlist' })).toBeTruthy()
    })

    it('selecting a song shows selection state and a primary confirm action', async () => {
      openSongsScreenWithNoActiveSong()
      const confirmBtn = screen.getByRole('button', { name: 'Confirm' })
      expect(confirmBtn).toBeTruthy()
      expect((confirmBtn as HTMLButtonElement).disabled).toBe(true)

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Duelo' })).toBeTruthy()
      })
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Duelo' }))
      })
      const songButtons = within(screen.getByRole('main')).getAllByRole('button', { name: /Duelo/ })
      const dueloSongBtn = songButtons.find((b) => b.classList.contains('songs-song-btn'))
      expect(dueloSongBtn).toBeTruthy()
      expect(dueloSongBtn!.classList.contains('ctrl-arm')).toBe(true)
      expect(dueloSongBtn!.getAttribute('aria-pressed')).toBe('true')
      expect((confirmBtn as HTMLButtonElement).disabled).toBe(false)
    })

    it('confirming selection sets active song and returns to control view', async () => {
      openSongsScreen()
      setCurrentSongId('pimiento')
      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Duelo' })).toBeTruthy()
      })
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Duelo' }))
      })
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
      })
      await waitFor(() => {
        expect(getCurrentSongId()).toBe('duelo')
        expect(screen.getByRole('button', { name: 'Setlist' })).toBeTruthy()
      }, { timeout: WAIT_TIMEOUT })
    })

    it('exiting Songs screen without confirming leaves active song unchanged', async () => {
      openSongsScreen()
      setCurrentSongId('pimiento')
      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Duelo' })).toBeTruthy()
      })
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Duelo' }))
      })
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Back' }))
      })
      expect(getCurrentSongId()).toBe('pimiento')
    })
  })

  describe('Played song indicator', () => {
    it('when performer unarms at end-of-song, current song is marked as played', async () => {
      setupControlViewWithReadinessPassing()
      setSongIndex(1)
      render(<App initialHash="#/" />)

      await waitFor(() => {
        expect(screen.getByTestId('performance-state-label').textContent).toBe('Performance: Ready to Arm')
      }, { timeout: WAIT_TIMEOUT })
      await act(async () => {
        fireEvent.click(getArmButton())
      })
      await waitFor(() => {
        expect(screen.getByTestId('performance-state-label').textContent).toBe('Performance: Armed')
      })
      expect(getPlayedSongIds()).not.toContain('duelo')

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /^Unarm/ }))
      })

      expect(screen.getByTestId('performance-state-label').textContent).toBe('Performance: Ready to Arm')
      expect(getPlayedSongIds()).toContain('duelo')
    })

    it('when performer unarms before end-of-song (hold-to-confirm), song is NOT marked as played', async () => {
      setupControlViewWithReadinessPassing()
      setSongIndex(0)
      render(<App initialHash="#/" />)

      await waitFor(() => {
        expect(screen.getByTestId('performance-state-label').textContent).toBe('Performance: Ready to Arm')
      }, { timeout: WAIT_TIMEOUT })
      await act(async () => {
        fireEvent.click(getArmButton())
      })
      await waitFor(() => {
        expect(screen.getByTestId('performance-state-label').textContent).toBe('Performance: Armed')
      })
      expect(getPlayedSongIds()).not.toContain('duelo')

      const unarmBtn = screen.getByRole('button', { name: /^Unarm/ })
      vi.useFakeTimers()
      await act(async () => {
        fireEvent.pointerDown(unarmBtn)
      })
      act(() => {
        vi.advanceTimersByTime(HOLD_CONFIRM_MS)
      })
      await act(async () => {
        fireEvent.pointerUp(unarmBtn)
      })
      vi.useRealTimers()

      expect(screen.getByTestId('performance-state-label').textContent).toBe('Performance: Ready to Arm')
      expect(getPlayedSongIds()).not.toContain('duelo')
    })

    it('Setlist: played song is visually darkened (songs-song-btn-played) and shows checkmark', async () => {
      addPlayedSong('duelo')
      setCurrentSongId('luz-y-sal')
      setSongLines(VALID_LINES)
      setSongIndex(-1)
      setBlank(true)
      setProjectionLanguage('en')
      setSingingLanguage('es')
      sessionStorage.setItem('liveLyricLaunched', '1')
      sessionStorage.removeItem('liveLyricPerformanceArmed')
      window.location.hash = '#/songs'
      ;(window as unknown as { electronAPI?: unknown }).electronAPI = {
        isProjectionOpen: vi.fn().mockResolvedValue(true),
        onProjectionOpened: vi.fn(() => vi.fn()),
        onProjectionClosed: vi.fn(() => vi.fn()),
        openProjection: vi.fn().mockResolvedValue(undefined),
        closeProjection: vi.fn().mockResolvedValue(undefined),
      }
      render(<App initialHash="#/songs" />)

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Duelo/ })).toBeTruthy()
      })
      const dueloBtn = within(screen.getByRole('main')).getAllByRole('button', { name: /Duelo/ }).find((b) => b.classList.contains('songs-song-btn'))
      expect(dueloBtn).toBeTruthy()
      expect(dueloBtn!.classList.contains('songs-song-btn-played')).toBe(true)
      expect(dueloBtn!.querySelector('.song-played-icon')).toBeTruthy()
      expect(dueloBtn!.textContent).toContain('Duelo')
    })

    it('Setlist: selected played song has same selected style (ctrl-arm) as other selected songs', async () => {
      addPlayedSong('duelo')
      setCurrentSongId('duelo')
      setSongLines(VALID_LINES)
      setSongIndex(-1)
      setBlank(true)
      setProjectionLanguage('en')
      setSingingLanguage('es')
      sessionStorage.setItem('liveLyricLaunched', '1')
      sessionStorage.removeItem('liveLyricPerformanceArmed')
      window.location.hash = '#/songs'
      ;(window as unknown as { electronAPI?: unknown }).electronAPI = {
        isProjectionOpen: vi.fn().mockResolvedValue(true),
        onProjectionOpened: vi.fn(() => vi.fn()),
        onProjectionClosed: vi.fn(() => vi.fn()),
        openProjection: vi.fn().mockResolvedValue(undefined),
        closeProjection: vi.fn().mockResolvedValue(undefined),
      }
      render(<App initialHash="#/songs" />)

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Duelo/ })).toBeTruthy()
      })
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /Duelo/ }))
      })
      const dueloBtn = within(screen.getByRole('main')).getAllByRole('button', { name: /Duelo/ }).find((b) => b.classList.contains('songs-song-btn'))
      expect(dueloBtn).toBeTruthy()
      expect(dueloBtn!.classList.contains('songs-song-btn-played')).toBe(true)
      expect(dueloBtn!.classList.contains('ctrl-arm')).toBe(true)
    })

    it('Setlist: reopening after finishing a song shows played indicator but no selection, Confirm disabled', async () => {
      addPlayedSong('duelo')
      setCurrentSongId('duelo')
      setSongLines(VALID_LINES)
      setSongIndex(-1)
      setBlank(true)
      setProjectionLanguage('en')
      setSingingLanguage('es')
      sessionStorage.setItem('liveLyricLaunched', '1')
      sessionStorage.removeItem('liveLyricPerformanceArmed')
      window.location.hash = '#/songs'
      ;(window as unknown as { electronAPI?: unknown }).electronAPI = {
        isProjectionOpen: vi.fn().mockResolvedValue(true),
        onProjectionOpened: vi.fn(() => vi.fn()),
        onProjectionClosed: vi.fn(() => vi.fn()),
        openProjection: vi.fn().mockResolvedValue(undefined),
        closeProjection: vi.fn().mockResolvedValue(undefined),
      }
      render(<App initialHash="#/songs" />)

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Duelo/ })).toBeTruthy()
      })
      const dueloBtn = within(screen.getByRole('main')).getAllByRole('button', { name: /Duelo/ }).find((b) => b.classList.contains('songs-song-btn'))
      expect(dueloBtn).toBeTruthy()
      expect(dueloBtn!.classList.contains('songs-song-btn-played')).toBe(true)
      expect(dueloBtn!.classList.contains('ctrl-arm')).toBe(false)
      const confirmBtn = screen.getByRole('button', { name: 'Confirm' })
      expect((confirmBtn as HTMLButtonElement).disabled).toBe(true)
    })

    it('after finishing song A, selecting song B, confirming and arming: performer starts in initial state (no stale lyric)', async () => {
      const SONG_A_JSON = JSON.stringify({
        title: 'Duelo',
        lyrics: [
          { es: 'Hola', en: 'Hello' },
          { es: 'Mundo', en: 'World' },
        ],
      })
      const SONG_B_JSON = JSON.stringify({
        title: 'Luz y sal',
        lyrics: [
          { es: 'Primera', en: 'First' },
          { es: 'Segunda', en: 'Second' },
        ],
      })
      clearStorage()
      addPlayedSong('duelo')
      setCurrentSongId('duelo')
      setSongLines(VALID_LINES)
      setSongIndex(1)
      setBlank(false)
      setProjectionLanguage('en')
      setSingingLanguage('es')
      sessionStorage.setItem('liveLyricLaunched', '1')
      sessionStorage.removeItem('liveLyricPerformanceArmed')
      window.location.hash = '#/'
      const fetchMock = vi.fn().mockImplementation((url: string) => {
        if (url === 'duelo.json' || url.endsWith('/duelo.json')) return Promise.resolve({ ok: true, text: () => Promise.resolve(SONG_A_JSON) })
        if (url === 'luz-y-sal.json' || url.endsWith('/luz-y-sal.json')) return Promise.resolve({ ok: true, text: () => Promise.resolve(SONG_B_JSON) })
        return Promise.reject(new Error('Unexpected fetch'))
      })
      vi.stubGlobal('fetch', fetchMock)
      ;(window as unknown as { electronAPI?: unknown }).electronAPI = {
        isProjectionOpen: vi.fn().mockResolvedValue(true),
        onProjectionOpened: vi.fn(() => vi.fn()),
        onProjectionClosed: vi.fn(() => vi.fn()),
        openProjection: vi.fn().mockResolvedValue(undefined),
        closeProjection: vi.fn().mockResolvedValue(undefined),
      }
      render(<App />)
      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Setlist' })).toBeTruthy()
      })
      await act(async () => {
        fireEvent.click(getArmButton())
      })
      await waitFor(() => {
        expect(screen.getByTestId('performance-state-label').textContent).toMatch(/Armed/)
      })
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /^Unarm/ }))
      })
      await waitFor(() => {
        expect(screen.getByTestId('performance-state-label').textContent).toMatch(/Ready to Arm/)
      })
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Setlist' }))
      })
      window.location.hash = '#/songs'
      window.dispatchEvent(new HashChangeEvent('hashchange', { newURL: window.location.href, oldURL: window.location.href }))
      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Luz y sal' })).toBeTruthy()
      })
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Luz y sal' }))
      })
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
      })
      // Control view is back in Ready to Arm state (stable: Arm button present)
      await waitFor(() => {
        expect(getArmButton()).toBeTruthy()
      }, { timeout: WAIT_TIMEOUT })
      // Simulate stale lyric state (e.g. from previous song or projection window): index out of bounds for new song.
      setSongIndex(5)
      setBlank(false)
      window.location.hash = '#/songs'
      window.dispatchEvent(new HashChangeEvent('hashchange', { newURL: window.location.href, oldURL: window.location.href }))
      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Luz y sal' })).toBeTruthy()
      })
      window.location.hash = '#/'
      window.dispatchEvent(new HashChangeEvent('hashchange', { newURL: window.location.href, oldURL: window.location.href }))
      // Control view visible again (stable: Arm button present)
      await waitFor(() => {
        expect(getArmButton()).toBeTruthy()
      })
      await act(async () => {
        fireEvent.click(getArmButton())
      })
      await waitFor(() => {
        expect(screen.getByTestId('performance-state-label').textContent).toMatch(/Armed/)
      })
      // Performer in initial state: no lyric displayed, navigation controls visible
      const lyricEl = document.querySelector('.control-lyric')
      expect(lyricEl?.textContent?.trim()).toBe('')
      expect(screen.queryByText('Hola')).toBeNull()
      expect(screen.queryByText('Mundo')).toBeNull()
      expect(screen.getByText(/Luz y sal/)).toBeTruthy()
      expect(getControlNextPreview()).toBeNull()
      expect(screen.getByRole('button', { name: /next/i })).toBeTruthy()
      expect(screen.getByRole('button', { name: /restart/i })).toBeTruthy()
      expect(screen.getByRole('button', { name: /unarm/i })).toBeTruthy()
    })
  })

  describe('Performer journey (full integration)', () => {
    const SONG_JSON = JSON.stringify({
      title: 'Duelo',
      lyrics: [
        { es: 'Hola', en: 'Hello' },
        { es: 'Mundo', en: 'World' },
      ],
    })

    /** Helper: hold a button for HOLD_CONFIRM_MS so the confirm action runs (Restart / Close). */
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
        if (url === 'duelo.json' || url.endsWith('/duelo.json')) {
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
        expect(screen.getByRole('button', { name: 'Setlist' })).toBeTruthy()
      })

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Setlist' }))
      })
      window.location.hash = '#/songs'
      window.dispatchEvent(new HashChangeEvent('hashchange', { newURL: window.location.href, oldURL: window.location.href }))

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Duelo' })).toBeTruthy()
      })
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Duelo' }))
      })

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
      })
      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Languages' })).toBeTruthy()
      }, { timeout: WAIT_TIMEOUT })

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Languages' }))
      })
      window.location.hash = '#/languages'
      window.dispatchEvent(new HashChangeEvent('hashchange', { newURL: window.location.href, oldURL: window.location.href }))

      await waitFor(() => {
        const enButtons = screen.getAllByRole('button', { name: 'EN' })
        expect(enButtons.length).toBeGreaterThanOrEqual(2)
      })
      await act(async () => {
        fireEvent.click(within(screen.getByRole('region', { name: 'Singing' })).getByRole('button', { name: 'ES' }))
      })
      await act(async () => {
        fireEvent.click(within(screen.getByRole('region', { name: 'Projection' })).getByRole('button', { name: 'EN' }))
      })
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
      })

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Open' })).toBeTruthy()
      })
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Open' }))
      })

      await waitFor(() => {
        expect(screen.getAllByText(/Ready to Arm/).length).toBeGreaterThan(0)
      }, { timeout: WAIT_TIMEOUT })

      await act(async () => {
        fireEvent.click(getArmButton())
      })
      await waitFor(() => {
        expect(screen.getAllByText(/Armed/).length).toBeGreaterThan(0)
      })

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /next/i }))
      })
      await waitFor(() => {
        expect(screen.getByTestId('performance-state-label').textContent).toBe('Performance: Armed')
        expect(screen.getByText('Hola')).toBeTruthy()
      })

      await holdConfirm(screen.getByRole('button', { name: /restart/i }))

      await waitFor(() => {
        expect(screen.getByTestId('performance-state-label').textContent).toBe('Performance: Armed')
      })

      await holdConfirm(screen.getByRole('button', { name: /^Unarm/ }))
      await waitFor(() => {
        expect(screen.getByTestId('performance-state-label').textContent).toBe('Performance: Ready to Arm')
      })

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Close' }))
      })

      await waitFor(() => {
        expect(screen.getAllByText(/Setup/).length).toBeGreaterThan(0)
        expect(screen.getByRole('button', { name: 'Open' })).toBeTruthy()
      }, { timeout: WAIT_TIMEOUT })
    }, 15000)
  })
})

/** Lyric, section marker, lyric — next-line preview must skip section */
const LINES_WITH_SECTION: SongItem[] = [
  { languages: { es: 'Primero', en: 'First' } },
  { type: 'section', label: 'Chorus' },
  { languages: { es: 'Segundo', en: 'Second' } },
]

/** Three lyric lines for advance-update test */
const THREE_LINES: SongItem[] = [
  { languages: { es: 'Uno', en: 'One' } },
  { languages: { es: 'Dos', en: 'Two' } },
  { languages: { es: 'Tres', en: 'Three' } },
]

function getControlNextPreview() {
  return document.querySelector('[data-testid="control-next-preview"]')
}

describe('Control next-line preview', () => {
  beforeEach(() => {
    cleanup()
    localStorage.clear()
    sessionStorage.clear()
    window.location.hash = '#/'
    const mockApi = {
      isProjectionOpen: vi.fn().mockResolvedValue(true),
      onProjectionOpened: vi.fn(() => vi.fn()),
      onProjectionClosed: vi.fn(() => vi.fn()),
      openProjection: vi.fn().mockResolvedValue(undefined),
      closeProjection: vi.fn().mockResolvedValue(undefined),
    }
    ;(window as unknown as { electronAPI?: unknown }).electronAPI = mockApi
  })

  it('does not show preview before the first line is revealed (armed, not started)', async () => {
    sessionStorage.setItem('liveLyricLaunched', '1')
    sessionStorage.removeItem('liveLyricPerformanceArmed')
    setSongLines(VALID_LINES)
    setSongIndex(-1)
    setBlank(true)
    setCurrentSongId('duelo')
    setProjectionLanguage('en')
    setSingingLanguage('es')
    render(<App initialHash="#/" />)

    await waitFor(() => {
      expect(screen.getAllByText(/Ready to Arm/).length).toBeGreaterThan(0)
    })
    await act(async () => {
      fireEvent.click(getArmButton())
    })

    expect(screen.getByText(/Press Next to reveal the first line/)).toBeTruthy()
    const preview = getControlNextPreview()
    expect(preview).toBeNull()
  })

  it('shows next-line preview on performance control screen when there is a next lyric', async () => {
    sessionStorage.setItem('liveLyricLaunched', '1')
    sessionStorage.removeItem('liveLyricPerformanceArmed')
    setSongLines(VALID_LINES)
    setSongIndex(-1)
    setBlank(true)
    setCurrentSongId('duelo')
    setProjectionLanguage('en')
    setSingingLanguage('es')
    render(<App initialHash="#/" />)

    await waitFor(() => {
      expect(screen.getAllByText(/Ready to Arm/).length).toBeGreaterThan(0)
    })
    await act(async () => {
      fireEvent.click(getArmButton())
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /next/i }))
    })

    await waitFor(() => {
      expect(screen.getByText('Hola')).toBeTruthy()
    })
    const preview = getControlNextPreview()
    expect(preview).toBeTruthy()
    expect(preview?.textContent?.trim()).toBe('Mundo')
  })

  it('does not show preview when there is no next lyric line', async () => {
    sessionStorage.setItem('liveLyricLaunched', '1')
    sessionStorage.removeItem('liveLyricPerformanceArmed')
    setSongLines(VALID_LINES)
    setSongIndex(1)
    setBlank(false)
    setCurrentSongId('duelo')
    setProjectionLanguage('en')
    setSingingLanguage('es')
    render(<App initialHash="#/" />)

    await waitFor(() => {
      expect(screen.getAllByText(/Ready to Arm/).length).toBeGreaterThan(0)
    })
    await act(async () => {
      fireEvent.click(getArmButton())
    })

    await waitFor(() => {
      expect(screen.getByText('Mundo')).toBeTruthy()
    })
    const preview = getControlNextPreview()
    expect(preview).toBeTruthy()
    expect(preview?.textContent?.trim()).toBe('')
  })

  it('skips section markers when computing the next lyric for preview', async () => {
    sessionStorage.setItem('liveLyricLaunched', '1')
    sessionStorage.removeItem('liveLyricPerformanceArmed')
    setSongLines(LINES_WITH_SECTION)
    setSongIndex(-1)
    setBlank(true)
    setCurrentSongId('duelo')
    setProjectionLanguage('en')
    setSingingLanguage('es')
    render(<App initialHash="#/" />)

    await waitFor(() => {
      expect(screen.getAllByText(/Ready to Arm/).length).toBeGreaterThan(0)
    })
    await act(async () => {
      fireEvent.click(getArmButton())
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /next/i }))
    })

    await waitFor(() => {
      expect(screen.getByText('Primero')).toBeTruthy()
    })
    const preview = getControlNextPreview()
    expect(preview).toBeTruthy()
    expect(preview?.textContent?.trim()).toBe('Segundo')
    expect(preview?.textContent).not.toMatch(/Chorus/)
  })

  it('updates the preview when advancing to the next phrase', async () => {
    sessionStorage.setItem('liveLyricLaunched', '1')
    sessionStorage.removeItem('liveLyricPerformanceArmed')
    setSongLines(THREE_LINES)
    setSongIndex(-1)
    setBlank(true)
    setCurrentSongId('duelo')
    setProjectionLanguage('en')
    setSingingLanguage('es')
    render(<App initialHash="#/" />)

    await waitFor(() => {
      expect(screen.getAllByText(/Ready to Arm/).length).toBeGreaterThan(0)
    })
    await act(async () => {
      fireEvent.click(getArmButton())
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /next/i }))
    })

    await waitFor(() => {
      expect(screen.getByText('Uno')).toBeTruthy()
    })
    expect(getControlNextPreview()?.textContent?.trim()).toBe('Dos')

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /next/i }))
    })
    await waitFor(() => {
      expect(screen.getByText('Dos')).toBeTruthy()
    })
    expect(getControlNextPreview()?.textContent?.trim()).toBe('Tres')

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /next/i }))
    })
    await waitFor(() => {
      expect(screen.getByText('Tres')).toBeTruthy()
    })
    expect(getControlNextPreview()?.textContent?.trim()).toBe('')
  })
})
