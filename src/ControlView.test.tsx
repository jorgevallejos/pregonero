/** @vitest-environment jsdom */
/**
 * ControlView performer state flow: smallest practical UI/integration-style tests.
 * Renders App with hash #/ so ControlView is shown; drives state via storage and DOM.
 */
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest'
import { StrictMode } from 'react'
import { render, screen, act, waitFor, within, cleanup } from '@testing-library/react'
import { fireEvent } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import App from './App'
import {
  setSongLines,
  setSongIndex,
  setBlank,
  setCurrentSongId,
  setCurrentSongTitle,
  setProjectionLanguage,
  setSingingLanguage,
  getSingingLanguage,
  getSongIndex,
  getBlank,
  getCurrentSongId,
  getSongLines,
  parseSongFile,
} from './songState'
import { HOLD_CONFIRM_MS } from './useHoldToConfirm'
import { KEY_END_CARD_VISIBLE, getEndCardVisible } from './endCardState'
import { getPlayedSongIds, addPlayedSong } from './playedSongsState'
import type { SongItem } from './songState'
import { SONGS } from './songs'
import {
  createInitialSnapshot,
  createEmptySetlist,
  DEFAULT_SETLIST_ID,
  ensureSongLibraryHydrated,
  getActiveSetlistId,
  loadSetlistStore,
  reorderSongsInSetlistInSnapshot,
  addSongToSetlistInSnapshot,
  saveSetlistStore,
  setActiveSetlistId,
  type SetlistStoreSnapshot,
} from './setlistStore'
import { MEDIA_PATH_STORE_KEY } from './mediaPathStore'

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
  vi.stubGlobal('WebSocket', vi.fn().mockImplementation(function () {
    return {
      readyState: 1,
      send: vi.fn(),
      close: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }
  }))
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

function queryArmedTransportNextButton() {
  return document.querySelector('button.ctrl-next')
}

/** Click Next twice to reach the last lyric of VALID_LINES (2-item song). */
async function navigateToLastLyric() {
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: /next/i })) })
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: /next/i })) })
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

/** Full v2 library with one line per bundled song id (matches `SONGS` catalog). */
function installProductionLikeLibrary(): void {
  const line: SongItem = { languages: { es: 't', en: 't' } }
  const songs = SONGS.map((s) => ({
    id: s.id,
    title: s.title,
    items: [line],
  }))
  saveSetlistStore(createInitialSnapshot(songs))
}

/** Installs a v2 library from inline JSON (same shape as public *.json files). */
function installLibraryFromJsonFiles(files: Record<string, string>): void {
  const songs = Object.entries(files).map(([path, json]) => {
    const parsed = parseSongFile(json)
    const id = path.replace(/\.json$/i, '')
    const title = parsed.title.trim() || id
    return {
      id,
      title,
      items: parsed.items,
      ...(parsed.notes !== undefined && parsed.notes.length > 0 ? { notes: parsed.notes } : {}),
    }
  })
  saveSetlistStore(createInitialSnapshot(songs))
}

/** Trigger storage listeners so hooks re-read from localStorage (simulates another tab changing config). */
function dispatchStorageEvent() {
  window.dispatchEvent(new StorageEvent('storage', { key: null, newValue: null }))
}

function setActiveSetlistSongIds(songIds: string[]) {
  const snapshot = loadSetlistStore()
  if (!snapshot) throw new Error('Expected setlist snapshot')
  const activeSetlistId = snapshot.activeSetlistId
  if (!activeSetlistId) throw new Error('Expected active setlist id')
  saveSetlistStore({
    ...snapshot,
    setlists: snapshot.setlists.map((setlist) =>
      setlist.id === activeSetlistId ? { ...setlist, songIds: [...songIds] } : setlist
    ),
  })
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

describe('First launch (empty persisted library)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearStorage()
    sessionStorage.clear()
  })

  afterEach(() => {
    vi.useRealTimers()
    cleanup()
    delete (window as unknown as { electronAPI?: unknown }).electronAPI
  })

  it('Setlist screen shows the setlist selection prompt after hydration', async () => {
    sessionStorage.setItem('liveLyricLaunched', '1')
    ;(window as unknown as { electronAPI?: unknown }).electronAPI = {
      isProjectionOpen: vi.fn().mockResolvedValue(false),
      onProjectionOpened: vi.fn(() => vi.fn()),
      onProjectionClosed: vi.fn(() => vi.fn()),
      openProjection: vi.fn().mockResolvedValue(undefined),
      closeProjection: vi.fn().mockResolvedValue(undefined),
    }
    window.location.hash = '#/songs'
    render(<App initialHash="#/songs" />)

    await waitFor(
      () => {
        expect(screen.getByTestId('setlist-selection-prompt')).toBeTruthy()
      },
      { timeout: WAIT_TIMEOUT }
    )
  })
})

describe('v0.5 control screen state machine integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearStorage()
    installProductionLikeLibrary()
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
    expect(queryArmedTransportNextButton()).toBeNull()
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
    expect(queryArmedTransportNextButton()).toBeNull()
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

  it('2f. Setup has no Next button for advancing setlist songs', async () => {
    setActiveSetlistSongIds(['soy-una-puerta', 'duelo'])
    setupControlViewWithReadinessPassing()
    setCurrentSongId('soy-una-puerta')
    setCurrentSongTitle('Soy una puerta')
    render(<App initialHash="#/" />)

    await waitFor(
      () => {
        expect(screen.getByTestId('performance-state-label').textContent).toBe('Performance: Ready to Arm')
      },
      { timeout: WAIT_TIMEOUT }
    )

    // "Next" in Setup was removed; setlist navigation is manual via the Setlist screen.
    expect(screen.queryByRole('button', { name: 'Next' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Setlist' })).toBeTruthy()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Setlist' }))
    })
    expect(window.location.hash).toBe('#/songs')
  })

  it('2g. Setup has no Next button even when no song is selected', async () => {
    setActiveSetlistSongIds(['pimiento', 'duelo'])
    setupControlViewInitial()
    render(<App initialHash="#/" />)

    await waitFor(
      () => {
        expect(screen.getByTestId('performance-state-label').textContent).toBe('Performance: Setup')
      },
      { timeout: WAIT_TIMEOUT }
    )

    expect(screen.queryByRole('button', { name: 'Next' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Setlist' })).toBeTruthy()
  })

  it('2h. Setup has no Next button even when selected song is last in active setlist', async () => {
    setActiveSetlistSongIds(['duelo', 'pimiento'])
    setupControlViewWithReadinessPassing()
    setCurrentSongId('pimiento')
    render(<App initialHash="#/" />)

    await waitFor(
      () => {
        expect(screen.getByTestId('performance-state-label').textContent).toBe('Performance: Ready to Arm')
      },
      { timeout: WAIT_TIMEOUT }
    )

    expect(screen.queryByRole('button', { name: 'Next' })).toBeNull()
  })

  it('2h2. Setup song section button row contains only Setlist', async () => {
    setActiveSetlistSongIds(['duelo', 'pimiento'])
    setupControlViewWithReadinessPassing()
    render(<App initialHash="#/" />)

    await waitFor(
      () => {
        expect(screen.getByRole('button', { name: 'Setlist' })).toBeTruthy()
      },
      { timeout: WAIT_TIMEOUT }
    )

    expect(screen.queryByRole('button', { name: 'Next' })).toBeNull()

    const songSectionButtons = screen.getByRole('button', { name: 'Setlist' }).parentElement
    if (!songSectionButtons) throw new Error('Expected song setup button container')
    expect(songSectionButtons.classList.contains('control-setup-button-row')).toBe(true)

    const buttonLabels = Array.from(songSectionButtons.querySelectorAll('button')).map((button) =>
      button.textContent?.trim()
    )
    expect(buttonLabels).toEqual(['Setlist'])
  })

  it('2i. Setup navigation to Setlist remains available', async () => {
    setActiveSetlistSongIds(['duelo', 'pimiento'])
    setupControlViewWithReadinessPassing()
    render(<App initialHash="#/" />)

    await waitFor(
      () => {
        expect(screen.getByRole('button', { name: 'Setlist' })).toBeTruthy()
      },
      { timeout: WAIT_TIMEOUT }
    )

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Setlist' }))
    })

    expect(window.location.hash).toBe('#/songs')
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

    expect(queryArmedTransportNextButton()).toBeNull()
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
      await navigateToLastLyric()

      const unarmBtn = screen.getByRole('button', { name: /^Unarm/ })
      expect(unarmBtn.classList.contains('ctrl-arm')).toBe(true)
      expect(unarmBtn.classList.contains('ctrl-unarm')).toBe(false)
    })

    it('when armed and at last lyric phrase, single click on Unarm unarms immediately (no hold required)', async () => {
      setupControlViewWithReadinessPassing()
      setActiveSetlistSongIds(['duelo'])
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
      await navigateToLastLyric()
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
      await navigateToLastLyric()
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

      await act(async () => {
        await Promise.resolve()
      })
      expect(screen.getByText(/Press Next to reveal the first line/)).toBeTruthy()
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
      await navigateToLastLyric()
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

    it('shows the last phrase immediately and disables Next at end-of-song', async () => {
      setActiveSetlistSongIds(['duelo', 'pimiento'])
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
      await navigateToLastLyric()

      expect(screen.getByText('Mundo')).toBeTruthy()
      expect((screen.getByRole('button', { name: 'Next' }) as HTMLButtonElement).disabled).toBe(true)
      expect(screen.queryByTestId('next-song-tile')).toBeNull()
      expect(screen.queryByText('Tap to continue')).toBeNull()
    })

    it('does not show next-song tile before 6 seconds, then auto-reveals it at 6 seconds', async () => {
      vi.useFakeTimers()
      setActiveSetlistSongIds(['duelo', 'pimiento'])
      setupControlViewWithReadinessPassing()
      render(<App initialHash="#/" />)

      await act(async () => {
        await Promise.resolve()
      })
      expect(screen.getByTestId('performance-state-label').textContent).toBe('Performance: Ready to Arm')

      await act(async () => {
        fireEvent.click(getArmButton())
      })
      await navigateToLastLyric()

      expect(screen.getByText('Mundo')).toBeTruthy()
      expect(screen.queryByTestId('next-song-tile')).toBeNull()

      act(() => {
        vi.advanceTimersByTime(5_999)
      })
      expect(screen.queryByTestId('next-song-tile')).toBeNull()

      act(() => {
        vi.advanceTimersByTime(1)
      })

      const tile = screen.getByTestId('next-song-tile')
      expect(tile.classList.contains('songs-song-btn')).toBe(true)
      expect(tile.classList.contains('ctrl-arm')).toBe(false)
      expect(tile.textContent).toContain('Pimiento')
      expect(tile.textContent).not.toContain('Tap to continue')
      expect(screen.getByText('Mundo')).toBeTruthy()

      const helper = screen.getByText('Tap to continue')
      expect(helper.classList.contains('performing-next-song-helper-label')).toBe(true)
      expect(helper.closest('button')).toBeNull()
      expect(helper.nextElementSibling).toBe(tile)
    })

    it('keeps phrase and next-song tile inside one centered middle-stage stack', async () => {
      vi.useFakeTimers()
      setActiveSetlistSongIds(['duelo', 'pimiento'])
      setupControlViewWithReadinessPassing()
      render(<App initialHash="#/" />)

      await act(async () => {
        await Promise.resolve()
      })
      expect(screen.getByTestId('performance-state-label').textContent).toBe('Performance: Ready to Arm')

      await act(async () => {
        fireEvent.click(getArmButton())
      })
      await navigateToLastLyric()

      const stage = screen.getByTestId('performing-content')
      expect(stage.classList.contains('control-performing-stage')).toBe(true)

      const lyric = screen.getByText('Mundo')
      expect(lyric.classList.contains('control-lyric')).toBe(true)
      const stageStack = lyric.closest('.control-performing-stage-stack')
      expect(stageStack).not.toBeNull()
      expect(stageStack?.contains(lyric)).toBe(true)

      act(() => {
        vi.advanceTimersByTime(6_000)
      })

      const tile = screen.getByTestId('next-song-tile')
      expect(stageStack?.contains(tile)).toBe(true)
      expect(screen.getByRole('button', { name: 'Previous' })).toBeTruthy()
      expect(screen.getByRole('button', { name: 'Next' })).toBeTruthy()
    })

    it('uses a 3-zone armed layout with centered middle stage and fixed bottom controls', () => {
      const css = readFileSync(resolve(__dirname, 'control.css'), 'utf8')

      const screenBlock = css.match(/\.control-screen\s*\{([^}]*)\}/)
      expect(screenBlock).toBeTruthy()
      expect(screenBlock![1]).toMatch(/display:\s*flex/)
      expect(screenBlock![1]).toMatch(/flex-direction:\s*column/)

      const centerBlock = css.match(/\.control-center\s*\{([^}]*)\}/)
      expect(centerBlock).toBeTruthy()
      expect(centerBlock![1]).toMatch(/flex:\s*1/)

      const stageBlock = css.match(/\.control-performing-stage\s*\{([^}]*)\}/)
      expect(stageBlock).toBeTruthy()
      expect(stageBlock![1]).toMatch(/display:\s*flex/)
      expect(stageBlock![1]).toMatch(/align-items:\s*center/)
      expect(stageBlock![1]).toMatch(/justify-content:\s*center/)

      const stackBlock = css.match(/\.control-performing-stage-stack\s*\{([^}]*)\}/)
      expect(stackBlock).toBeTruthy()
      expect(stackBlock![1]).toMatch(/display:\s*flex/)
      expect(stackBlock![1]).toMatch(/flex-direction:\s*column/)
      expect(stackBlock![1]).toMatch(/align-items:\s*center/)

      const bottomBlock = css.match(/\.control-bottom-bar\s*\{([^}]*)\}/)
      expect(bottomBlock).toBeTruthy()
      expect(bottomBlock![1]).toMatch(/flex-shrink:\s*0/)
    })

    it('next-song tile reuses Setlist song-tile visual classes', async () => {
      vi.useFakeTimers()
      setActiveSetlistSongIds(['duelo', 'pimiento'])
      setupControlViewWithReadinessPassing()
      render(<App initialHash="#/" />)

      await act(async () => {
        await Promise.resolve()
      })
      expect(screen.getByTestId('performance-state-label').textContent).toBe('Performance: Ready to Arm')

      await act(async () => {
        fireEvent.click(getArmButton())
      })
      await navigateToLastLyric()
      act(() => {
        vi.advanceTimersByTime(6_000)
      })

      const tile = screen.getByTestId('next-song-tile')
      expect(tile.className.trim()).toBe('songs-song-btn')
      expect(tile.querySelector('.songs-song-title')?.textContent).toBe('Pimiento')
    })

    it('tapping next-song tile starts next song directly (without unarm/setup)', async () => {
      vi.useFakeTimers()
      setActiveSetlistSongIds(['duelo', 'pimiento'])
      setupControlViewWithReadinessPassing()
      render(<App initialHash="#/" />)

      await act(async () => {
        await Promise.resolve()
      })
      expect(screen.getByTestId('performance-state-label').textContent).toBe('Performance: Ready to Arm')

      await act(async () => {
        fireEvent.click(getArmButton())
      })
      await navigateToLastLyric()
      act(() => {
        vi.advanceTimersByTime(6_000)
      })

      const tile = screen.getByTestId('next-song-tile')
      await act(async () => {
        fireEvent.click(tile)
      })

      expect(getCurrentSongId()).toBe('pimiento')
      expect(screen.getByTestId('performance-state-label').textContent).toBe('Performance: Armed')
      expect(screen.getByText(/Press Next to reveal the first line/)).toBeTruthy()
      expect(window.location.hash).toBe('#/')
    })

    it('keeps concert timer running when starting next song from tile', async () => {
      vi.useFakeTimers()
      setActiveSetlistSongIds(['duelo', 'pimiento'])
      setupControlViewWithReadinessPassing()
      render(<App initialHash="#/" />)

    await act(async () => {
      await Promise.resolve()
    })
    expect(screen.getByTestId('performance-state-label').textContent).toBe('Performance: Ready to Arm')

      await act(async () => {
        fireEvent.click(getArmButton())
      })
      await navigateToLastLyric()
      act(() => {
        vi.advanceTimersByTime(6_000)
      })

    await act(async () => {
      await Promise.resolve()
    })
    expect(screen.getByTestId('performance-state-label').textContent).toBe('Performance: Armed')

      expect(screen.getByTestId('performance-status-minutes').textContent).toBe("0'")

      act(() => {
        vi.advanceTimersByTime(60_000)
      })
      expect(screen.getByTestId('performance-status-minutes').textContent).toBe("1'")

      const tile = screen.getByTestId('next-song-tile')
      await act(async () => {
        fireEvent.click(tile)
      })

      // Next song starts from first lyric reveal, but the concert timer continues.
      expect(screen.getByTestId('performance-status-minutes').textContent).toBe("1'")
    })

    it('cancels delayed tile reveal when user navigates back from the last phrase', async () => {
      vi.useFakeTimers()
      setActiveSetlistSongIds(['duelo', 'pimiento'])
      setupControlViewWithReadinessPassing()
      render(<App initialHash="#/" />)

      await act(async () => {
        await Promise.resolve()
      })
      expect(screen.getByTestId('performance-state-label').textContent).toBe('Performance: Ready to Arm')
      await act(async () => {
        fireEvent.click(getArmButton())
      })
      await navigateToLastLyric()

      act(() => {
        vi.advanceTimersByTime(5_000)
      })
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /previous/i }))
      })
      expect(screen.getByText('Hola')).toBeTruthy()

      act(() => {
        vi.advanceTimersByTime(6_000)
      })
      expect(screen.queryByTestId('next-song-tile')).toBeNull()
    })

    it('cancels delayed tile reveal when user restarts from the last phrase', async () => {
      vi.useFakeTimers()
      setActiveSetlistSongIds(['duelo', 'pimiento'])
      setupControlViewWithReadinessPassing()
      setSongIndex(1)
      render(<App initialHash="#/" />)

      await act(async () => {
        await Promise.resolve()
      })
      expect(screen.getByTestId('performance-state-label').textContent).toBe('Performance: Ready to Arm')
      await act(async () => {
        fireEvent.click(getArmButton())
      })

      act(() => {
        vi.advanceTimersByTime(5_000)
      })
      await act(async () => {
        fireEvent.pointerDown(screen.getByRole('button', { name: /restart/i }))
      })
      act(() => {
        vi.advanceTimersByTime(HOLD_CONFIRM_MS)
      })
      await act(async () => {
        fireEvent.pointerUp(screen.getByRole('button', { name: /restart/i }))
      })

      await act(async () => {
        await Promise.resolve()
      })
      expect(screen.getByText(/Press Next to reveal the first line/)).toBeTruthy()
      act(() => {
        vi.advanceTimersByTime(6_000)
      })
      expect(screen.queryByTestId('next-song-tile')).toBeNull()
    })
  })
})

describe('ControlView performer state flow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearStorage()
    installProductionLikeLibrary()
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

    expect(queryArmedTransportNextButton()).toBeNull()
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
      setActiveSetlistSongIds(['duelo'])
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
      setActiveSetlistSongIds(['duelo'])
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
    function openSongsScreen() {
      clearStorage()
      installProductionLikeLibrary()
      setCurrentSongId('duelo')
      setSongLines(VALID_LINES)
      setSongIndex(-1)
      setBlank(true)
      sessionStorage.setItem('liveLyricLaunched', '1')
      window.location.hash = '#/songs'
      vi.stubGlobal(
        'fetch',
        vi.fn().mockImplementation(() => Promise.reject(new Error('Unexpected fetch')))
      )
      ;(window as unknown as { electronAPI?: unknown }).electronAPI = {
        isProjectionOpen: vi.fn().mockResolvedValue(true),
        onProjectionOpened: vi.fn(() => vi.fn()),
        onProjectionClosed: vi.fn(() => vi.fn()),
        openProjection: vi.fn().mockResolvedValue(undefined),
        closeProjection: vi.fn().mockResolvedValue(undefined),
      }
      render(<App />)
    }

    /** Opens Songs screen with no active song (selection not pre-filled). */
    function openSongsScreenWithNoActiveSong() {
      clearStorage()
      installProductionLikeLibrary()
      setCurrentSongId('')
      setSongLines([])
      setSongIndex(-1)
      setBlank(true)
      sessionStorage.setItem('liveLyricLaunched', '1')
      window.location.hash = '#/songs'
      vi.stubGlobal(
        'fetch',
        vi.fn().mockImplementation(() => Promise.reject(new Error('Unexpected fetch')))
      )
      ;(window as unknown as { electronAPI?: unknown }).electronAPI = {
        isProjectionOpen: vi.fn().mockResolvedValue(true),
        onProjectionOpened: vi.fn(() => vi.fn()),
        onProjectionClosed: vi.fn(() => vi.fn()),
        openProjection: vi.fn().mockResolvedValue(undefined),
        closeProjection: vi.fn().mockResolvedValue(undefined),
      }
      render(<App />)
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
      expect(screen.getByRole('heading', { name: 'Setlist: Default' })).toBeTruthy()
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

  describe('Setlist screen: active setlist label', () => {
    const TONIGHT_ID = 'tonight-setlist'

    function seedTwoSetlistsTonightActive() {
      installProductionLikeLibrary()
      const base = loadSetlistStore()!
      saveSetlistStore({
        ...base,
        setlists: [
          base.setlists.find((s) => s.id === DEFAULT_SETLIST_ID)!,
          { id: TONIGHT_ID, name: 'Tonight', songIds: ['duelo', 'pimiento'] },
        ],
        activeSetlistId: TONIGHT_ID,
      })
    }

    function renderSetlistScreen() {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockImplementation(() => Promise.reject(new Error('Unexpected fetch')))
      )
      ;(window as unknown as { electronAPI?: unknown }).electronAPI = {
        isProjectionOpen: vi.fn().mockResolvedValue(true),
        onProjectionOpened: vi.fn(() => vi.fn()),
        onProjectionClosed: vi.fn(() => vi.fn()),
        openProjection: vi.fn().mockResolvedValue(undefined),
        closeProjection: vi.fn().mockResolvedValue(undefined),
      }
      render(<App />)
    }

    it('shows only songs from the active setlist', async () => {
      clearStorage()
      seedTwoSetlistsTonightActive()
      sessionStorage.setItem('liveLyricLaunched', '1')
      window.location.hash = '#/songs'
      renderSetlistScreen()

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Duelo' })).toBeTruthy()
      })
      expect(screen.queryByRole('button', { name: 'Vidas' })).toBeNull()
      const songBtns = document.querySelectorAll('.songs-song-btn')
      expect(songBtns.length).toBe(2)
      expect(screen.getByRole('heading', { name: 'Setlist: Tonight' })).toBeTruthy()
      expect(screen.getByTestId('active-setlist-name').textContent).toBe('Tonight')
      expect(document.querySelector('.setlist-picker-bar')).toBeNull()
      expect(document.querySelectorAll('.setlist-name-btn').length).toBe(0)
    })

    it('when active setlist is missing, shows prompt instead of song grid', async () => {
      clearStorage()
      installProductionLikeLibrary()
      const base = loadSetlistStore()!
      saveSetlistStore({ ...base, activeSetlistId: '' })
      sessionStorage.setItem('liveLyricLaunched', '1')
      window.location.hash = '#/songs'
      renderSetlistScreen()

      await waitFor(() => {
        expect(screen.getByTestId('setlist-selection-prompt')).toBeTruthy()
      })
      expect(document.querySelectorAll('.songs-song-btn').length).toBe(0)
      expect(screen.getByRole('heading', { name: 'Setlist' })).toBeTruthy()
      expect(screen.queryByTestId('active-setlist-name')).toBeNull()
      expect(document.querySelector('.setlist-picker-bar')).toBeNull()
    })

    it('choosing a setlist from Manage setlists after prompt reveals the song grid', async () => {
      clearStorage()
      installProductionLikeLibrary()
      const base = loadSetlistStore()!
      saveSetlistStore({ ...base, activeSetlistId: '' })
      sessionStorage.setItem('liveLyricLaunched', '1')
      window.location.hash = '#/songs'
      renderSetlistScreen()

      await waitFor(() => {
        expect(screen.getByTestId('setlist-selection-prompt')).toBeTruthy()
      })
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Manage setlists' }))
      })
      await waitFor(() => {
        expect(screen.getByTestId('manage-setlists-screen')).toBeTruthy()
      })
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Select setlist Default' }))
      })
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
      })
      await waitFor(() => {
        expect(window.location.hash).toBe('#/songs')
        expect(screen.queryByTestId('setlist-selection-prompt')).toBeNull()
      })
      await waitFor(() => {
        expect(document.querySelectorAll('.songs-song-btn').length).toBeGreaterThan(0)
      })
      expect(screen.getByRole('heading', { name: 'Setlist: Default' })).toBeTruthy()
    })

    it('switching active setlist from Manage setlists auto-selects the new setlist first song', async () => {
      clearStorage()
      seedTwoSetlistsTonightActive()
      setCurrentSongId('duelo')
      setSongLines(VALID_LINES)
      setSongIndex(0)
      setBlank(false)
      sessionStorage.setItem('liveLyricLaunched', '1')
      window.location.hash = '#/songs'
      renderSetlistScreen()

      await waitFor(() => {
        expect(screen.getByRole('heading', { name: 'Setlist: Tonight' })).toBeTruthy()
      })
      const pimientoSong = within(screen.getByRole('main'))
        .getAllByRole('button', { name: /Pimiento/ })
        .find((b) => b.classList.contains('songs-song-btn'))
      expect(pimientoSong).toBeTruthy()
      await act(async () => {
        fireEvent.click(pimientoSong!)
      })
      expect(pimientoSong!.classList.contains('ctrl-arm')).toBe(true)

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Manage setlists' }))
      })
      await waitFor(() => {
        expect(screen.getByTestId('manage-setlists-screen')).toBeTruthy()
      })
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Select setlist Default' }))
      })
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
      })
      const expectedFirstDefaultSongId =
        loadSetlistStore()!.setlists.find((setlist) => setlist.id === DEFAULT_SETLIST_ID)?.songIds[0] ?? ''
      expect(expectedFirstDefaultSongId).not.toBe('')
      await waitFor(() => {
        expect(window.location.hash).toBe('#/songs')
        expect(getCurrentSongId()).toBe(expectedFirstDefaultSongId)
      })
      await waitFor(() => {
        expect(screen.getByRole('heading', { name: 'Setlist: Default' })).toBeTruthy()
      })
      const pimientoAfter = within(screen.getByRole('main'))
        .getAllByRole('button', { name: /Pimiento/ })
        .find((b) => b.classList.contains('songs-song-btn'))
      expect(pimientoAfter).toBeTruthy()
      expect(pimientoAfter!.classList.contains('ctrl-arm')).toBe(false)
    })

    it('choosing a setlist from Manage setlists after prompt auto-selects that setlist first song', async () => {
      clearStorage()
      installProductionLikeLibrary()
      const base = loadSetlistStore()!
      saveSetlistStore({ ...base, activeSetlistId: '' })
      sessionStorage.setItem('liveLyricLaunched', '1')
      window.location.hash = '#/songs'
      renderSetlistScreen()

      await waitFor(() => {
        expect(screen.getByTestId('setlist-selection-prompt')).toBeTruthy()
      })
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Manage setlists' }))
      })
      await waitFor(() => {
        expect(screen.getByTestId('manage-setlists-screen')).toBeTruthy()
      })
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Select setlist Default' }))
      })
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
      })
      const expectedFirstDefaultSongId =
        loadSetlistStore()!.setlists.find((setlist) => setlist.id === DEFAULT_SETLIST_ID)?.songIds[0] ?? ''
      expect(expectedFirstDefaultSongId).not.toBe('')
      await waitFor(() => {
        expect(window.location.hash).toBe('#/songs')
        expect(getCurrentSongId()).toBe(expectedFirstDefaultSongId)
      })
    })

    it('initial app load with active setlist auto-selects its first song in Setup', async () => {
      clearStorage()
      seedTwoSetlistsTonightActive()
      setCurrentSongId('')
      setCurrentSongTitle('')
      setSongLines([])
      setSongIndex(-1)
      setBlank(true)
      sessionStorage.removeItem('liveLyricLaunched')
      window.location.hash = '#/'
      renderSetlistScreen()

      await waitFor(() => {
        expect(screen.getByTestId('performance-state-label').textContent).toBe('Performance: Setup')
      })
      await waitFor(() => {
        expect(getCurrentSongId()).toBe('duelo')
      })
      expect(getSongLines().length).toBeGreaterThan(0)
      expect(getSongIndex()).toBe(-1)
      expect(getBlank()).toBe(true)
    })

    it('restored persisted state with active setlist auto-selects first song when current song is invalid', async () => {
      clearStorage()
      seedTwoSetlistsTonightActive()
      setCurrentSongId('vidas')
      setCurrentSongTitle('Vidas')
      setSongLines(VALID_LINES)
      setSongIndex(0)
      setBlank(false)
      sessionStorage.setItem('liveLyricLaunched', '1')
      window.location.hash = '#/'
      renderSetlistScreen()

      await waitFor(() => {
        expect(screen.getByTestId('performance-state-label').textContent).toBe('Performance: Setup')
      })
      await waitFor(() => {
        expect(getCurrentSongId()).toBe('duelo')
      })
      expect(getSongLines().length).toBeGreaterThan(0)
      expect(getSongIndex()).toBe(-1)
      expect(getBlank()).toBe(true)
    })

    it('initial load with empty active setlist keeps song unselected in Setup', async () => {
      clearStorage()
      installProductionLikeLibrary()
      const emptySetlist = createEmptySetlist()
      const snapshot = loadSetlistStore()!
      saveSetlistStore({ ...snapshot, activeSetlistId: emptySetlist.id })
      setCurrentSongId('duelo')
      setCurrentSongTitle('Duelo')
      setSongLines(VALID_LINES)
      setSongIndex(0)
      setBlank(false)
      sessionStorage.removeItem('liveLyricLaunched')
      window.location.hash = '#/'
      renderSetlistScreen()

      await waitFor(() => {
        expect(screen.getByTestId('performance-state-label').textContent).toBe('Performance: Setup')
      })
      await waitFor(() => {
        expect(getCurrentSongId()).toBe('')
      })
      expect(getSongLines()).toEqual([])
      expect(getSongIndex()).toBe(-1)
      expect(getBlank()).toBe(true)
    })

    it('choosing an empty setlist keeps song unselected', async () => {
      clearStorage()
      installProductionLikeLibrary()
      const emptySetlist = createEmptySetlist()
      const withEmpty = loadSetlistStore()!
      saveSetlistStore({
        ...withEmpty,
        activeSetlistId: '',
      })
      setCurrentSongId('duelo')
      setSongLines(VALID_LINES)
      setSongIndex(0)
      setBlank(false)
      sessionStorage.setItem('liveLyricLaunched', '1')
      window.location.hash = '#/songs'
      renderSetlistScreen()

      await waitFor(() => {
        expect(screen.getByTestId('setlist-selection-prompt')).toBeTruthy()
      })
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Manage setlists' }))
      })
      await waitFor(() => {
        expect(screen.getByTestId('manage-setlists-screen')).toBeTruthy()
      })
      const emptySetlistName =
        loadSetlistStore()!.setlists.find((setlist) => setlist.id === emptySetlist.id)?.name ?? 'New setlist'
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: `Select setlist ${emptySetlistName}` }))
      })
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
      })
      await waitFor(() => {
        expect(window.location.hash).toBe('#/songs')
      })
      expect(getCurrentSongId()).toBe('')
      expect(getSongLines()).toEqual([])
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Back' }))
      })
      await waitFor(() => {
        expect(window.location.hash).toBe('#/')
      })
      expect(getArmButton().hasAttribute('disabled')).toBe(true)
    })
  })

  describe('Manage setlists screen', () => {
    const TONIGHT_ID = 'tonight-setlist'

    function seedTwoSetlistsTonightActive() {
      installProductionLikeLibrary()
      const base = loadSetlistStore()!
      saveSetlistStore({
        ...base,
        setlists: [
          base.setlists.find((s) => s.id === DEFAULT_SETLIST_ID)!,
          { id: TONIGHT_ID, name: 'Tonight', songIds: ['duelo', 'pimiento'] },
        ],
        activeSetlistId: TONIGHT_ID,
      })
    }

    function stubFetchForSongsScreens() {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockImplementation(() => Promise.reject(new Error('Unexpected fetch')))
      )
      ;(window as unknown as { electronAPI?: unknown }).electronAPI = {
        isProjectionOpen: vi.fn().mockResolvedValue(true),
        onProjectionOpened: vi.fn(() => vi.fn()),
        onProjectionClosed: vi.fn(() => vi.fn()),
        openProjection: vi.fn().mockResolvedValue(undefined),
        closeProjection: vi.fn().mockResolvedValue(undefined),
      }
    }

    it('opens manage setlists screen from Setlist via button', async () => {
      clearStorage()
      seedTwoSetlistsTonightActive()
      sessionStorage.setItem('liveLyricLaunched', '1')
      window.location.hash = '#/songs'
      stubFetchForSongsScreens()
      render(<App />)

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Duelo' })).toBeTruthy()
      })
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Manage setlists' }))
      })
      await waitFor(() => {
        expect(window.location.hash).toBe('#/songs/manage-setlists')
        expect(screen.getByRole('heading', { name: 'Manage setlists' })).toBeTruthy()
      })
    })

    it('lists setlists and indicates which is active', async () => {
      clearStorage()
      seedTwoSetlistsTonightActive()
      sessionStorage.setItem('liveLyricLaunched', '1')
      window.location.hash = '#/songs/manage-setlists'
      stubFetchForSongsScreens()
      render(<App />)

      await waitFor(() => {
        expect(screen.getByTestId('manage-setlists-screen')).toBeTruthy()
      })
      expect(screen.getByRole('button', { name: 'Select setlist Default' })).toBeTruthy()
      const tonightNameBtn = screen.getByRole('button', { name: 'Active setlist Tonight' })
      expect(tonightNameBtn).toBeTruthy()
      expect(tonightNameBtn.classList.contains('ctrl-arm')).toBe(true)
      expect(window.getComputedStyle(tonightNameBtn).borderColor).not.toMatch(/rgb\(10,\s*132,\s*255\)/i)
    })

    it('each setlist uses one compact row (name + edit + delete icon actions)', async () => {
      clearStorage()
      seedTwoSetlistsTonightActive()
      sessionStorage.setItem('liveLyricLaunched', '1')
      window.location.hash = '#/songs/manage-setlists'
      stubFetchForSongsScreens()
      render(<App />)

      await waitFor(() => {
        expect(screen.getByTestId(`manage-setlists-setlist-row-${TONIGHT_ID}`)).toBeTruthy()
      })
      const row = screen.getByTestId(`manage-setlists-setlist-row-${TONIGHT_ID}`)
      const actions = within(row).getByRole('button', { name: /Edit songs in setlist Tonight/ })
        .parentElement
      expect(actions?.classList.contains('manage-setlists-actions')).toBe(true)
      expect(within(row).getByRole('button', { name: 'Delete setlist Tonight' })).toBeTruthy()
    })

    it('does not show a separate Rename text button on setlist rows', async () => {
      clearStorage()
      seedTwoSetlistsTonightActive()
      sessionStorage.setItem('liveLyricLaunched', '1')
      window.location.hash = '#/songs/manage-setlists'
      stubFetchForSongsScreens()
      render(<App />)

      await waitFor(() => {
        expect(screen.getByTestId('manage-setlists-screen')).toBeTruthy()
      })
      expect(screen.queryByRole('button', { name: /^Rename$/ })).toBeNull()
    })

    it('Escape cancels inline setlist rename', async () => {
      clearStorage()
      seedTwoSetlistsTonightActive()
      sessionStorage.setItem('liveLyricLaunched', '1')
      window.location.hash = '#/songs/manage-setlists'
      stubFetchForSongsScreens()
      render(<App />)

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Active setlist Tonight' })).toBeTruthy()
      })
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /Edit songs in setlist Tonight/ }))
      })
      const nameInput = screen.getByLabelText('Setlist name')
      await act(async () => {
        fireEvent.change(nameInput, { target: { value: 'Should Not Stick' } })
      })
      await act(async () => {
        fireEvent.keyDown(nameInput, { key: 'Escape', code: 'Escape' })
      })
      await waitFor(() => {
        expect(screen.queryByLabelText('Setlist name')).toBeNull()
        expect(screen.getByRole('button', { name: 'Active setlist Tonight' })).toBeTruthy()
      })
      expect(screen.getByTestId('manage-setlists-song-editor')).toBeTruthy()
      expect(loadSetlistStore()!.setlists.find((s) => s.id === TONIGHT_ID)?.name).toBe('Tonight')
    })

    it('clicking the active setlist name does not start rename', async () => {
      clearStorage()
      seedTwoSetlistsTonightActive()
      sessionStorage.setItem('liveLyricLaunched', '1')
      window.location.hash = '#/songs/manage-setlists'
      stubFetchForSongsScreens()
      render(<App />)

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Active setlist Tonight' })).toBeTruthy()
      })
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Active setlist Tonight' }))
      })
      expect(screen.queryByLabelText('Setlist name')).toBeNull()
      expect(screen.getByTestId('manage-setlists-song-editor')).toBeTruthy()
    })

    it('blurring the rename input does not commit the draft name', async () => {
      clearStorage()
      seedTwoSetlistsTonightActive()
      sessionStorage.setItem('liveLyricLaunched', '1')
      window.location.hash = '#/songs/manage-setlists'
      stubFetchForSongsScreens()
      render(<App />)

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Edit songs in setlist Tonight/ })).toBeTruthy()
      })
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /Edit songs in setlist Tonight/ }))
      })
      const nameInput = screen.getByLabelText('Setlist name')
      await act(async () => {
        fireEvent.change(nameInput, { target: { value: 'Blur Should Not Save' } })
      })
      await act(async () => {
        fireEvent.blur(nameInput)
      })
      expect(screen.getByLabelText('Setlist name')).toBeTruthy()
      expect((nameInput as HTMLInputElement).value).toBe('Blur Should Not Save')
      expect(loadSetlistStore()!.setlists.find((s) => s.id === TONIGHT_ID)?.name).toBe('Tonight')
    })

    it('pointer down outside the row closes edit mode and cancels an in-progress rename', async () => {
      clearStorage()
      seedTwoSetlistsTonightActive()
      sessionStorage.setItem('liveLyricLaunched', '1')
      window.location.hash = '#/songs/manage-setlists'
      stubFetchForSongsScreens()
      render(<App />)

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Edit songs in setlist Tonight/ })).toBeTruthy()
      })
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /Edit songs in setlist Tonight/ }))
      })
      await act(async () => {
        fireEvent.change(screen.getByLabelText('Setlist name'), {
          target: { value: 'Outside Click Cancel' },
        })
      })
      await act(async () => {
        fireEvent.pointerDown(screen.getByRole('heading', { name: 'Manage setlists' }))
      })
      await waitFor(() => {
        expect(screen.getByTestId('manage-setlists-song-editor')).toBeTruthy()
        expect(screen.queryByLabelText('Setlist name')).toBeNull()
      })
      expect(loadSetlistStore()!.setlists.find((s) => s.id === TONIGHT_ID)?.name).toBe('Tonight')
    })

    it('second pencil click on the same setlist closes edit mode and ends rename', async () => {
      clearStorage()
      seedTwoSetlistsTonightActive()
      sessionStorage.setItem('liveLyricLaunched', '1')
      window.location.hash = '#/songs/manage-setlists'
      stubFetchForSongsScreens()
      render(<App />)

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Edit songs in setlist Tonight/ })).toBeTruthy()
      })
      const pencil = screen.getByRole('button', { name: /Edit songs in setlist Tonight/ })
      await act(async () => {
        fireEvent.click(pencil)
      })
      await act(async () => {
        fireEvent.change(screen.getByLabelText('Setlist name'), {
          target: { value: 'Toggle Off Cancel' },
        })
      })
      await act(async () => {
        fireEvent.click(pencil)
      })
      await waitFor(() => {
        expect(screen.getByTestId('manage-setlists-song-editor')).toBeTruthy()
        expect(screen.queryByLabelText('Setlist name')).toBeNull()
      })
      expect(loadSetlistStore()!.setlists.find((s) => s.id === TONIGHT_ID)?.name).toBe('Tonight')
    })

    it('Confirm commits a pending inline rename without Enter', async () => {
      clearStorage()
      seedTwoSetlistsTonightActive()
      sessionStorage.setItem('liveLyricLaunched', '1')
      window.location.hash = '#/songs/manage-setlists'
      stubFetchForSongsScreens()
      render(<App />)

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Edit songs in setlist Tonight/ })).toBeTruthy()
      })
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /Edit songs in setlist Tonight/ }))
      })
      await act(async () => {
        fireEvent.change(screen.getByLabelText('Setlist name'), {
          target: { value: 'Saved On Confirm' },
        })
      })
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
      })
      await waitFor(() => {
        expect(loadSetlistStore()!.setlists.find((s) => s.id === TONIGHT_ID)?.name).toBe(
          'Saved On Confirm'
        )
      })
    })

    it('selecting another setlist ends an in-progress rename without committing', async () => {
      clearStorage()
      seedTwoSetlistsTonightActive()
      sessionStorage.setItem('liveLyricLaunched', '1')
      window.location.hash = '#/songs/manage-setlists'
      stubFetchForSongsScreens()
      render(<App />)

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Edit songs in setlist Tonight/ })).toBeTruthy()
      })
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /Edit songs in setlist Tonight/ }))
      })
      await act(async () => {
        fireEvent.change(screen.getByLabelText('Setlist name'), {
          target: { value: 'Switch Away Cancel' },
        })
      })
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Select setlist Default' }))
      })
      await waitFor(() => {
        expect(screen.queryByLabelText('Setlist name')).toBeNull()
        expect(screen.getByTestId('manage-setlists-song-editor')).toBeTruthy()
        expect(screen.getByRole('button', { name: 'Active setlist Default' })).toBeTruthy()
      })
      expect(loadSetlistStore()!.setlists.find((s) => s.id === TONIGHT_ID)?.name).toBe('Tonight')
      expect(getActiveSetlistId()).toBe(TONIGHT_ID)
    })

    it('shows New setlist in setlist column, New song in library column, and Confirm at bottom', async () => {
      clearStorage()
      seedTwoSetlistsTonightActive()
      sessionStorage.setItem('liveLyricLaunched', '1')
      window.location.hash = '#/songs/manage-setlists'
      stubFetchForSongsScreens()
      render(<App />)

      await waitFor(() => {
        expect(screen.getByTestId('manage-setlists-screen')).toBeTruthy()
      })
      expect(screen.getByRole('button', { name: 'New song' })).toBeTruthy()
      expect(screen.getByRole('button', { name: 'New setlist' })).toBeTruthy()
      const footer = document.querySelector('.manage-setlists-footer')
      expect(footer).toBeTruthy()
      expect(within(footer as HTMLElement).getByRole('button', { name: 'Confirm' })).toBeTruthy()
    })

    it('New song import adds the file to the library list', async () => {
      clearStorage()
      await act(async () => {
        await ensureSongLibraryHydrated()
      })
      createEmptySetlist()
      sessionStorage.setItem('liveLyricLaunched', '1')
      window.location.hash = '#/songs/manage-setlists'
      stubFetchForSongsScreens()
      const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {})
      render(<App />)

      await waitFor(() => {
        expect(screen.getByTestId('manage-setlists-screen')).toBeTruthy()
      })

      const json = JSON.stringify({
        id: 'ui-import',
        title: 'From File',
        lyrics: [{ es: 'a', en: 'b' }],
      })
      const file = new File([json], 'song.json', { type: 'application/json' })
      const input = screen.getByTestId('import-song-input')

      await act(async () => {
        fireEvent.change(input, { target: { files: [file] } })
      })

      await waitFor(() => {
        expect(alertSpy).toHaveBeenCalledWith('1 song imported.')
      })

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Add From File to setlist New setlist' })).toBeTruthy()
      })

      alertSpy.mockRestore()
    })

    it('importing a new song updates the draft but does not persist until Confirm', async () => {
      clearStorage()
      await act(async () => {
        await ensureSongLibraryHydrated()
      })
      createEmptySetlist()
      sessionStorage.setItem('liveLyricLaunched', '1')
      window.location.hash = '#/songs/manage-setlists'
      stubFetchForSongsScreens()
      const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {})
      render(<App />)

      await waitFor(() => {
        expect(screen.getByTestId('manage-setlists-screen')).toBeTruthy()
      })
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Edit songs in setlist New setlist' }))
      })

      const json = JSON.stringify({
        id: 'draft-import-only',
        title: 'Draft Only',
        lyrics: [{ es: 'a', en: 'b' }],
      })
      const file = new File([json], 'song.json', { type: 'application/json' })
      const input = screen.getByTestId('import-song-input')

      await act(async () => {
        fireEvent.change(input, { target: { files: [file] } })
      })
      await waitFor(() => {
        expect(alertSpy).toHaveBeenCalledWith('1 song imported.')
      })
      expect(loadSetlistStore()!.songLibrary.songs.some((s) => s.id === 'draft-import-only')).toBe(
        false
      )
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
      })
      await waitFor(() => {
        expect(loadSetlistStore()!.songLibrary.songs.some((s) => s.id === 'draft-import-only')).toBe(
          true
        )
      })
      alertSpy.mockRestore()
    })

    it('multi-file New song import adds each valid song to the draft and lists add controls', async () => {
      clearStorage()
      await act(async () => {
        await ensureSongLibraryHydrated()
      })
      createEmptySetlist()
      sessionStorage.setItem('liveLyricLaunched', '1')
      window.location.hash = '#/songs/manage-setlists'
      stubFetchForSongsScreens()
      const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {})
      render(<App />)

      await waitFor(() => {
        expect(screen.getByTestId('manage-setlists-screen')).toBeTruthy()
      })
      await act(async () => {
        fireEvent.click(
          screen.getByRole('button', { name: 'Edit songs in setlist New setlist' })
        )
      })

      const f1 = new File(
        [
          JSON.stringify({
            id: 'batch-a',
            title: 'Batch A',
            lyrics: [{ es: 'a', en: 'b' }],
          }),
        ],
        'a.json',
        { type: 'application/json' }
      )
      const f2 = new File(
        [
          JSON.stringify({
            id: 'batch-b',
            title: 'Batch B',
            lyrics: [{ es: 'c', en: 'd' }],
          }),
        ],
        'b.json',
        { type: 'application/json' }
      )
      await act(async () => {
        fireEvent.change(screen.getByTestId('import-song-input'), {
          target: { files: [f1, f2] },
        })
      })

      await waitFor(() => {
        expect(alertSpy).toHaveBeenCalledWith('2 songs imported.')
      })
      await waitFor(() => {
        expect(
          screen.getByRole('button', { name: 'Add Batch A to setlist New setlist' })
        ).toBeTruthy()
        expect(
          screen.getByRole('button', { name: 'Add Batch B to setlist New setlist' })
        ).toBeTruthy()
      })
      alertSpy.mockRestore()
    })

    it('multi-file import shows the result alert exactly once under Strict Mode', async () => {
      clearStorage()
      await act(async () => {
        await ensureSongLibraryHydrated()
      })
      createEmptySetlist()
      sessionStorage.setItem('liveLyricLaunched', '1')
      window.location.hash = '#/songs/manage-setlists'
      stubFetchForSongsScreens()
      const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {})
      render(
        <StrictMode>
          <App />
        </StrictMode>
      )

      await waitFor(() => {
        expect(screen.getByTestId('manage-setlists-screen')).toBeTruthy()
      })
      await act(async () => {
        fireEvent.click(
          screen.getByRole('button', { name: 'Edit songs in setlist New setlist' })
        )
      })

      const f1 = new File(
        [
          JSON.stringify({
            id: 'strict-a',
            title: 'Strict A',
            lyrics: [{ es: 'a', en: 'b' }],
          }),
        ],
        'a.json',
        { type: 'application/json' }
      )
      const f2 = new File(
        [
          JSON.stringify({
            id: 'strict-b',
            title: 'Strict B',
            lyrics: [{ es: 'c', en: 'd' }],
          }),
        ],
        'b.json',
        { type: 'application/json' }
      )
      await act(async () => {
        fireEvent.change(screen.getByTestId('import-song-input'), {
          target: { files: [f1, f2] },
        })
      })

      await waitFor(() => {
        expect(alertSpy).toHaveBeenCalledWith('2 songs imported.')
      })
      expect(alertSpy).toHaveBeenCalledTimes(1)
      alertSpy.mockRestore()
    })

    it('multi-file import skips duplicates and invalid JSON and summarizes counts', async () => {
      clearStorage()
      await act(async () => {
        await ensureSongLibraryHydrated()
      })
      createEmptySetlist()
      sessionStorage.setItem('liveLyricLaunched', '1')
      window.location.hash = '#/songs/manage-setlists'
      stubFetchForSongsScreens()
      const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {})
      render(<App />)

      await waitFor(() => {
        expect(screen.getByTestId('manage-setlists-screen')).toBeTruthy()
      })
      await act(async () => {
        fireEvent.click(
          screen.getByRole('button', { name: 'Edit songs in setlist New setlist' })
        )
      })

      const ok = new File(
        [JSON.stringify({ id: 'mix-ok', title: 'Mix Ok', lyrics: [{ es: 'a', en: 'b' }] })],
        'ok.json',
        { type: 'application/json' }
      )
      const dup = new File(
        [JSON.stringify({ id: 'mix-ok', title: 'Dup', lyrics: [{ es: 'x', en: 'y' }] })],
        'dup.json',
        { type: 'application/json' }
      )
      const bad = new File(['{'], 'bad.json', { type: 'application/json' })

      await act(async () => {
        fireEvent.change(screen.getByTestId('import-song-input'), {
          target: { files: [ok, dup, bad] },
        })
      })

      await waitFor(() => {
        expect(alertSpy).toHaveBeenCalledWith(
          '1 song imported.\n1 duplicate skipped.\n1 invalid file skipped.'
        )
      })
      alertSpy.mockRestore()
    })

    it('multi-file import skips invalid song-shape JSON alongside valid files', async () => {
      clearStorage()
      await act(async () => {
        await ensureSongLibraryHydrated()
      })
      createEmptySetlist()
      sessionStorage.setItem('liveLyricLaunched', '1')
      window.location.hash = '#/songs/manage-setlists'
      stubFetchForSongsScreens()
      const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {})
      render(<App />)

      await waitFor(() => {
        expect(screen.getByTestId('manage-setlists-screen')).toBeTruthy()
      })
      await act(async () => {
        fireEvent.click(
          screen.getByRole('button', { name: 'Edit songs in setlist New setlist' })
        )
      })

      const ok = new File(
        [JSON.stringify({ id: 'shape-ok', title: 'Shape Ok', lyrics: [{ es: 'a', en: 'b' }] })],
        'ok.json',
        { type: 'application/json' }
      )
      const badShape = new File(
        [JSON.stringify({ title: 'Missing lyrics' })],
        'bad.json',
        { type: 'application/json' }
      )

      await act(async () => {
        fireEvent.change(screen.getByTestId('import-song-input'), {
          target: { files: [ok, badShape] },
        })
      })

      await waitFor(() => {
        expect(alertSpy).toHaveBeenCalledWith('1 song imported.\n1 invalid file skipped.')
      })
      alertSpy.mockRestore()
    })

    it('Back after multi-file import discards drafts without persisting songs', async () => {
      clearStorage()
      await act(async () => {
        await ensureSongLibraryHydrated()
      })
      createEmptySetlist()
      sessionStorage.setItem('liveLyricLaunched', '1')
      window.location.hash = '#/songs/manage-setlists'
      stubFetchForSongsScreens()
      const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {})
      render(<App />)

      await waitFor(() => {
        expect(screen.getByTestId('manage-setlists-screen')).toBeTruthy()
      })
      await act(async () => {
        fireEvent.click(
          screen.getByRole('button', { name: 'Edit songs in setlist New setlist' })
        )
      })
      const f1 = new File(
        [
          JSON.stringify({
            id: 'discard-a',
            title: 'Discard A',
            lyrics: [{ es: 'a', en: 'b' }],
          }),
        ],
        'a.json',
        { type: 'application/json' }
      )
      const f2 = new File(
        [
          JSON.stringify({
            id: 'discard-b',
            title: 'Discard B',
            lyrics: [{ es: 'c', en: 'd' }],
          }),
        ],
        'b.json',
        { type: 'application/json' }
      )
      await act(async () => {
        fireEvent.change(screen.getByTestId('import-song-input'), {
          target: { files: [f1, f2] },
        })
      })
      await waitFor(() => {
        expect(alertSpy).toHaveBeenCalledWith('2 songs imported.')
      })
      expect(loadSetlistStore()!.songLibrary.songs.some((s) => s.id === 'discard-a')).toBe(false)

      const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Back' }))
      })
      confirmSpy.mockRestore()
      await waitFor(() => {
        expect(window.location.hash).toBe('#/songs')
      })
      expect(loadSetlistStore()!.songLibrary.songs.some((s) => s.id === 'discard-a')).toBe(false)
      expect(loadSetlistStore()!.songLibrary.songs.some((s) => s.id === 'discard-b')).toBe(false)

      window.location.hash = '#/songs/manage-setlists'
      await waitFor(() => {
        expect(screen.getByTestId('manage-setlists-screen')).toBeTruthy()
      })
      await act(async () => {
        fireEvent.click(
          screen.getByRole('button', { name: 'Edit songs in setlist New setlist' })
        )
      })
      expect(screen.queryByRole('button', { name: 'Add Discard A to setlist New setlist' })).toBeNull()
      expect(screen.queryByRole('button', { name: 'Add Discard B to setlist New setlist' })).toBeNull()

      alertSpy.mockRestore()
    })

    it('Confirm after multi-file import persists all imported songs', async () => {
      clearStorage()
      await act(async () => {
        await ensureSongLibraryHydrated()
      })
      createEmptySetlist()
      sessionStorage.setItem('liveLyricLaunched', '1')
      window.location.hash = '#/songs/manage-setlists'
      stubFetchForSongsScreens()
      const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {})
      render(<App />)

      await waitFor(() => {
        expect(screen.getByTestId('manage-setlists-screen')).toBeTruthy()
      })
      await act(async () => {
        fireEvent.click(
          screen.getByRole('button', { name: 'Edit songs in setlist New setlist' })
        )
      })
      await act(async () => {
        fireEvent.change(screen.getByTestId('import-song-input'), {
          target: {
            files: [
              new File(
                [
                  JSON.stringify({
                    id: 'persist-a',
                    title: 'Persist A',
                    lyrics: [{ es: 'a', en: 'b' }],
                  }),
                ],
                'a.json',
                { type: 'application/json' }
              ),
              new File(
                [
                  JSON.stringify({
                    id: 'persist-b',
                    title: 'Persist B',
                    lyrics: [{ es: 'c', en: 'd' }],
                  }),
                ],
                'b.json',
                { type: 'application/json' }
              ),
            ],
          },
        })
      })
      await waitFor(() => {
        expect(alertSpy).toHaveBeenCalledWith('2 songs imported.')
      })
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
      })
      await waitFor(() => {
        const lib = loadSetlistStore()!.songLibrary.songs
        expect(lib.some((s) => s.id === 'persist-a')).toBe(true)
        expect(lib.some((s) => s.id === 'persist-b')).toBe(true)
      })
      alertSpy.mockRestore()
    })

    it('Confirm navigates to the Setlist screen without changing active setlist', async () => {
      clearStorage()
      seedTwoSetlistsTonightActive()
      sessionStorage.setItem('liveLyricLaunched', '1')
      window.location.hash = '#/songs/manage-setlists'
      stubFetchForSongsScreens()
      render(<App />)

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Confirm' })).toBeTruthy()
      })
      expect(getActiveSetlistId()).toBe(TONIGHT_ID)
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
      })
      await waitFor(() => {
        expect(window.location.hash).toBe('#/songs')
        expect(getActiveSetlistId()).toBe(TONIGHT_ID)
        expect(screen.getByRole('heading', { name: 'Setlist: Tonight' })).toBeTruthy()
      })
    })

    it('selecting a setlist updates activeSetlistId and returns to Setlist with correct songs', async () => {
      clearStorage()
      seedTwoSetlistsTonightActive()
      sessionStorage.setItem('liveLyricLaunched', '1')
      window.location.hash = '#/songs/manage-setlists'
      stubFetchForSongsScreens()
      render(<App />)

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Select setlist Default' })).toBeTruthy()
      })
      expect(getActiveSetlistId()).toBe(TONIGHT_ID)
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Select setlist Default' }))
      })
      expect(window.location.hash).toBe('#/songs/manage-setlists')
      expect(getActiveSetlistId()).toBe(TONIGHT_ID)
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
      })
      await waitFor(() => {
        expect(window.location.hash).toBe('#/songs')
        expect(getActiveSetlistId()).toBe(DEFAULT_SETLIST_ID)
      })
      await waitFor(() => {
        expect(screen.getByRole('heading', { name: 'Setlist: Default' })).toBeTruthy()
      })
      expect(screen.getByRole('button', { name: 'Vidas' })).toBeTruthy()
      expect(document.querySelectorAll('.songs-song-btn').length).toBeGreaterThan(2)
    })

    it('creating a new setlist adds it, sets it active, and Setlist shows no songs', async () => {
      clearStorage()
      seedTwoSetlistsTonightActive()
      sessionStorage.setItem('liveLyricLaunched', '1')
      window.location.hash = '#/songs/manage-setlists'
      stubFetchForSongsScreens()
      render(<App />)

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'New setlist' })).toBeTruthy()
      })
      const countBefore = loadSetlistStore()!.setlists.length
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'New setlist' }))
      })
      expect(window.location.hash).toBe('#/songs/manage-setlists')
      expect(loadSetlistStore()!.setlists.length).toBe(countBefore)
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
      })
      await waitFor(() => {
        expect(window.location.hash).toBe('#/songs')
      })
      const snap = loadSetlistStore()!
      expect(snap.setlists).toHaveLength(countBefore + 1)
      const created = snap.setlists.find((s) => s.songIds.length === 0 && s.name === 'New setlist')
      expect(created).toBeDefined()
      expect(getActiveSetlistId()).toBe(created!.id)
      await waitFor(() => {
        expect(screen.getByRole('heading', { name: 'Setlist: New setlist' })).toBeTruthy()
      })
      expect(document.querySelectorAll('.songs-song-btn').length).toBe(0)
    })

    it('selecting a setlist from manage auto-selects the active setlist first song', async () => {
      clearStorage()
      seedTwoSetlistsTonightActive()
      setCurrentSongId('duelo')
      setSongLines(VALID_LINES)
      setSongIndex(0)
      setBlank(false)
      sessionStorage.setItem('liveLyricLaunched', '1')
      window.location.hash = '#/songs/manage-setlists'
      stubFetchForSongsScreens()
      render(<App />)

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Select setlist Default' })).toBeTruthy()
      })
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Select setlist Default' }))
      })
      expect(getCurrentSongId()).toBe('duelo')
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
      })
      const expectedFirstDefaultSongId =
        loadSetlistStore()!.setlists.find((setlist) => setlist.id === DEFAULT_SETLIST_ID)?.songIds[0] ?? ''
      expect(expectedFirstDefaultSongId).not.toBe('')
      await waitFor(() => {
        expect(getCurrentSongId()).toBe(expectedFirstDefaultSongId)
      })
    })

    it('deleting a non-active setlist removes it and keeps activeSetlistId unchanged', async () => {
      clearStorage()
      seedTwoSetlistsTonightActive()
      sessionStorage.setItem('liveLyricLaunched', '1')
      window.location.hash = '#/songs/manage-setlists'
      stubFetchForSongsScreens()
      const confirmSpy = vi.spyOn(window, 'confirm')
      render(<App />)

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Select setlist Default' })).toBeTruthy()
      })
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Delete setlist Default' }))
      })
      expect(confirmSpy).not.toHaveBeenCalled()
      expect(
        screen.queryByTestId(`manage-setlists-setlist-row-${DEFAULT_SETLIST_ID}`)
      ).toBeNull()
      expect(loadSetlistStore()!.setlists.some((s) => s.id === DEFAULT_SETLIST_ID)).toBe(true)
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
      })
      await waitFor(() => {
        expect(loadSetlistStore()!.setlists.some((s) => s.id === DEFAULT_SETLIST_ID)).toBe(false)
        expect(getActiveSetlistId()).toBe(TONIGHT_ID)
      })
      expect(screen.queryByRole('button', { name: 'Select setlist Default' })).toBeNull()
      confirmSpy.mockRestore()
    })

    it('deleting the active setlist clears activeSetlistId and shows the setlist-selection prompt on Setlist', async () => {
      clearStorage()
      seedTwoSetlistsTonightActive()
      sessionStorage.setItem('liveLyricLaunched', '1')
      window.location.hash = '#/songs/manage-setlists'
      stubFetchForSongsScreens()
      const confirmSpy = vi.spyOn(window, 'confirm')
      render(<App />)

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Active setlist Tonight' })).toBeTruthy()
      })
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Delete setlist Tonight' }))
      })
      expect(confirmSpy).not.toHaveBeenCalled()
      expect(screen.queryByTestId(`manage-setlists-setlist-row-${TONIGHT_ID}`)).toBeNull()
      expect(getActiveSetlistId()).toBe(TONIGHT_ID)
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
      })
      await waitFor(() => {
        expect(window.location.hash).toBe('#/songs')
        expect(getActiveSetlistId()).toBe('')
      })
      await waitFor(() => {
        expect(screen.getByTestId('setlist-selection-prompt')).toBeTruthy()
      })
      expect(document.querySelectorAll('.songs-song-btn').length).toBe(0)
      confirmSpy.mockRestore()
    })

    it('deleting a setlist while renaming keeps the setlist songs column mounted', async () => {
      clearStorage()
      seedTwoSetlistsTonightActive()
      sessionStorage.setItem('liveLyricLaunched', '1')
      window.location.hash = '#/songs/manage-setlists'
      stubFetchForSongsScreens()
      const confirmSpy = vi.spyOn(window, 'confirm')
      render(<App />)

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Edit songs in setlist Default/ })).toBeTruthy()
      })
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Select setlist Default' }))
      })
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /Edit songs in setlist Default/ }))
      })
      expect(screen.getByTestId('manage-setlists-song-editor')).toBeTruthy()
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Delete setlist Default' }))
      })
      expect(confirmSpy).not.toHaveBeenCalled()
      expect(screen.getByTestId('manage-setlists-song-editor')).toBeTruthy()
      expect(
        screen.queryByTestId(`manage-setlists-setlist-row-${DEFAULT_SETLIST_ID}`)
      ).toBeNull()
      confirmSpy.mockRestore()
    })

    it('Back after deleting a setlist discards the deletion when the user confirms discard', async () => {
      clearStorage()
      seedTwoSetlistsTonightActive()
      sessionStorage.setItem('liveLyricLaunched', '1')
      window.location.hash = '#/songs/manage-setlists'
      stubFetchForSongsScreens()
      render(<App />)

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Select setlist Default' })).toBeTruthy()
      })
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Delete setlist Default' }))
      })
      expect(
        screen.queryByTestId(`manage-setlists-setlist-row-${DEFAULT_SETLIST_ID}`)
      ).toBeNull()
      expect(loadSetlistStore()!.setlists.some((s) => s.id === DEFAULT_SETLIST_ID)).toBe(true)

      const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Back' }))
      })
      expect(confirmSpy).toHaveBeenCalledWith(
        'You have unconfirmed changes. If you go back now, they will be lost. Continue?'
      )
      confirmSpy.mockRestore()
      await waitFor(() => {
        expect(window.location.hash).toBe('#/songs')
      })
      expect(loadSetlistStore()!.setlists.some((s) => s.id === DEFAULT_SETLIST_ID)).toBe(true)

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Manage setlists' }))
      })
      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Select setlist Default' })).toBeTruthy()
      })
    })

    it('renaming the active setlist updates the label on the Setlist screen', async () => {
      clearStorage()
      seedTwoSetlistsTonightActive()
      sessionStorage.setItem('liveLyricLaunched', '1')
      window.location.hash = '#/songs/manage-setlists'
      stubFetchForSongsScreens()
      render(<App />)

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Active setlist Tonight' })).toBeTruthy()
      })
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /Edit songs in setlist Tonight/ }))
      })
      const nameInput = screen.getByLabelText('Setlist name')
      await act(async () => {
        fireEvent.change(nameInput, { target: { value: 'Late Show' } })
      })
      await act(async () => {
        fireEvent.keyDown(nameInput, { key: 'Enter', code: 'Enter' })
      })
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
      })
      await waitFor(() => {
        expect(screen.getByRole('heading', { name: 'Setlist: Late Show' })).toBeTruthy()
        expect(screen.getByTestId('active-setlist-name').textContent).toBe('Late Show')
        expect(loadSetlistStore()!.setlists.find((s) => s.id === TONIGHT_ID)?.name).toBe('Late Show')
      })
    })

    it('renaming a setlist via inline edit updates the store and the manage list', async () => {
      clearStorage()
      seedTwoSetlistsTonightActive()
      setActiveSetlistId(DEFAULT_SETLIST_ID)
      sessionStorage.setItem('liveLyricLaunched', '1')
      window.location.hash = '#/songs/manage-setlists'
      stubFetchForSongsScreens()
      render(<App />)

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Active setlist Default' })).toBeTruthy()
      })
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /Edit songs in setlist Default/ }))
      })
      const nameInput = screen.getByLabelText('Setlist name')
      await act(async () => {
        fireEvent.change(nameInput, { target: { value: 'Brunch Set' } })
      })
      await act(async () => {
        fireEvent.blur(nameInput)
      })
      await waitFor(() => {
        expect(screen.getByLabelText('Setlist name')).toBeTruthy()
        expect((screen.getByLabelText('Setlist name') as HTMLInputElement).value).toBe('Brunch Set')
        expect(getActiveSetlistId()).toBe(DEFAULT_SETLIST_ID)
        expect(loadSetlistStore()!.setlists.find((s) => s.id === DEFAULT_SETLIST_ID)?.name).toBe(
          'Default'
        )
      })
      await act(async () => {
        fireEvent.keyDown(nameInput, { key: 'Enter', code: 'Enter' })
      })
      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Active setlist Brunch Set' })).toBeTruthy()
      })
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
      })
      await waitFor(() => {
        expect(loadSetlistStore()!.setlists.find((s) => s.id === DEFAULT_SETLIST_ID)?.name).toBe(
          'Brunch Set'
        )
      })
    })

    it('renamed setlist name is still correct after remount (reread from store)', async () => {
      clearStorage()
      seedTwoSetlistsTonightActive()
      setActiveSetlistId(DEFAULT_SETLIST_ID)
      sessionStorage.setItem('liveLyricLaunched', '1')
      window.location.hash = '#/songs/manage-setlists'
      stubFetchForSongsScreens()
      const { unmount } = render(<App />)

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Active setlist Default' })).toBeTruthy()
      })
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /Edit songs in setlist Default/ }))
      })
      await act(async () => {
        fireEvent.change(screen.getByLabelText('Setlist name'), {
          target: { value: 'Persisted After Reload' },
        })
      })
      await act(async () => {
        fireEvent.keyDown(screen.getByLabelText('Setlist name'), { key: 'Enter', code: 'Enter' })
      })
      await waitFor(() => {
        expect(loadSetlistStore()!.setlists.find((s) => s.id === DEFAULT_SETLIST_ID)?.name).toBe(
          'Default'
        )
      })
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
      })
      await waitFor(() => {
        expect(loadSetlistStore()!.setlists.find((s) => s.id === DEFAULT_SETLIST_ID)?.name).toBe(
          'Persisted After Reload'
        )
      })
      unmount()
      window.location.hash = '#/songs/manage-setlists'
      render(<App />)
      await waitFor(() => {
        expect(
          screen.getByRole('button', { name: 'Active setlist Persisted After Reload' })
        ).toBeTruthy()
      })
    })

    it('shows three-column headers and selected setlist/library song controls', async () => {
      clearStorage()
      seedTwoSetlistsTonightActive()
      sessionStorage.setItem('liveLyricLaunched', '1')
      window.location.hash = '#/songs/manage-setlists'
      stubFetchForSongsScreens()
      render(<App />)

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Edit songs in setlist Tonight/ })).toBeTruthy()
      })
      const inList = screen.getByRole('list', { name: 'Songs in setlist' })
      expect(within(inList).getByText('Duelo')).toBeTruthy()
      expect(within(inList).getByText('Pimiento')).toBeTruthy()
      expect(screen.getByRole('heading', { name: 'SETLISTS' })).toBeTruthy()
      expect(screen.getByRole('list', { name: 'Library songs not in this setlist' })).toBeTruthy()
      expect(screen.getByRole('heading', { name: 'SETLIST SONGS' })).toBeTruthy()
      expect(screen.getByRole('heading', { name: 'SONG LIBRARY' })).toBeTruthy()
      expect(screen.getByRole('button', { name: /Add Vidas to setlist Tonight/ })).toBeTruthy()
      expect(screen.getByRole('button', { name: /Delete Vidas from library/ })).toBeTruthy()
      expect(screen.getByRole('button', { name: /Remove Duelo from setlist Tonight/ })).toBeTruthy()
    })

    it('renders setlists unframed while songs and library stay panel-framed with aligned headers', async () => {
      clearStorage()
      seedTwoSetlistsTonightActive()
      sessionStorage.setItem('liveLyricLaunched', '1')
      window.location.hash = '#/songs/manage-setlists'
      stubFetchForSongsScreens()
      render(<App />)

      await waitFor(() => {
        expect(screen.getByRole('heading', { name: 'SETLISTS' })).toBeTruthy()
      })

      expect(screen.queryByTestId('manage-setlists-setlists-panel')).toBeNull()
      expect(screen.getByTestId('manage-setlists-song-editor')).toBeTruthy()
      expect(screen.getByTestId('manage-setlists-library-panel')).toBeTruthy()
      expect(document.querySelectorAll('.manage-setlists-panel')).toHaveLength(2)
      expect(document.querySelectorAll('.manage-setlists-column-header')).toHaveLength(3)
    })

    it('no selected setlist shows an empty middle panel and full library list', async () => {
      clearStorage()
      seedTwoSetlistsTonightActive()
      sessionStorage.setItem('liveLyricLaunched', '1')
      window.location.hash = '#/songs/manage-setlists'
      stubFetchForSongsScreens()
      render(<App />)

      await waitFor(() => {
        expect(window.__patchManageSetlistsDraft).toBeDefined()
      })
      await act(async () => {
        window.__patchManageSetlistsDraft!((d: SetlistStoreSnapshot) => ({ ...d, activeSetlistId: '' }))
      })
      expect(screen.getByText('Select a setlist to edit songs.')).toBeTruthy()
      expect(screen.queryByRole('button', { name: /Remove Duelo from setlist/ })).toBeNull()
      expect(screen.getByRole('button', { name: /Add Duelo to selected setlist/ })).toBeTruthy()
      expect(screen.getByRole('button', { name: /Add Pimiento to selected setlist/ })).toBeTruthy()
    })

    it('library add button adds the song to selected setlist and removes it from visible library list', async () => {
      clearStorage()
      seedTwoSetlistsTonightActive()
      sessionStorage.setItem('liveLyricLaunched', '1')
      window.location.hash = '#/songs/manage-setlists'
      stubFetchForSongsScreens()
      render(<App />)

      const addButton = await screen.findByRole('button', { name: /Add Vidas to setlist Tonight/ })
      await act(async () => {
        fireEvent.click(addButton)
      })
      expect(screen.queryByRole('button', { name: /Add Vidas to setlist Tonight/ })).toBeNull()
      expect(screen.getByRole('button', { name: /Remove Vidas from setlist Tonight/ })).toBeTruthy()
    })

    it('setlist songs remain reorder-only and cannot be moved back through the library controls', async () => {
      clearStorage()
      seedTwoSetlistsTonightActive()
      sessionStorage.setItem('liveLyricLaunched', '1')
      window.location.hash = '#/songs/manage-setlists'
      stubFetchForSongsScreens()
      render(<App />)

      expect(screen.queryByRole('button', { name: /Add Duelo to setlist Tonight/ })).toBeNull()
      expect(screen.getByRole('button', { name: /Drag to reorder Duelo in setlist Tonight/ })).toBeTruthy()
      expect(screen.getByRole('button', { name: /Remove Duelo from setlist Tonight/ })).toBeTruthy()
    })

    it('inline rename input keeps stable width and row structure while editing', async () => {
      clearStorage()
      seedTwoSetlistsTonightActive()
      sessionStorage.setItem('liveLyricLaunched', '1')
      window.location.hash = '#/songs/manage-setlists'
      stubFetchForSongsScreens()
      render(<App />)

      const row = await screen.findByTestId(`manage-setlists-setlist-row-${TONIGHT_ID}`)
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /Edit songs in setlist Tonight/ }))
      })
      const renameInput = screen.getByLabelText('Setlist name')
      expect(row.querySelector('.manage-setlists-actions')).toBeTruthy()
      expect(window.getComputedStyle(renameInput).width).not.toBe('0px')
    })

    it('does not show a Done control when editing songs (toggle is icon-only)', async () => {
      clearStorage()
      seedTwoSetlistsTonightActive()
      sessionStorage.setItem('liveLyricLaunched', '1')
      window.location.hash = '#/songs/manage-setlists'
      stubFetchForSongsScreens()
      render(<App />)

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Edit songs in setlist Tonight/ })).toBeTruthy()
      })
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /Edit songs in setlist Tonight/ }))
      })
      expect(screen.getByTestId('manage-setlists-song-editor')).toBeTruthy()
      expect(screen.queryByRole('button', { name: /Done editing songs/ })).toBeNull()
      expect(screen.queryByRole('button', { name: /^Done$/ })).toBeNull()
    })

    it('pointer down outside while renaming keeps setlist songs column visible', async () => {
      clearStorage()
      seedTwoSetlistsTonightActive()
      sessionStorage.setItem('liveLyricLaunched', '1')
      window.location.hash = '#/songs/manage-setlists'
      stubFetchForSongsScreens()
      render(<App />)

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Edit songs in setlist Tonight/ })).toBeTruthy()
      })
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /Edit songs in setlist Tonight/ }))
      })
      expect(screen.getByTestId('manage-setlists-song-editor')).toBeTruthy()
      await act(async () => {
        fireEvent.keyDown(screen.getByLabelText('Setlist name'), { key: 'Enter', code: 'Enter' })
      })
      await waitFor(() => {
        expect(screen.queryByLabelText('Setlist name')).toBeNull()
      })

      await act(async () => {
        fireEvent.pointerDown(screen.getByRole('button', { name: 'Confirm' }))
      })
      await waitFor(() => {
        expect(screen.getByTestId('manage-setlists-song-editor')).toBeTruthy()
      })
    })

    it('pencil opens inline rename and keeps the song editor visible', async () => {
      clearStorage()
      seedTwoSetlistsTonightActive()
      sessionStorage.setItem('liveLyricLaunched', '1')
      window.location.hash = '#/songs/manage-setlists'
      stubFetchForSongsScreens()
      render(<App />)

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Edit songs in setlist Tonight/ })).toBeTruthy()
      })
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /Edit songs in setlist Tonight/ }))
      })
      expect(screen.getByLabelText('Setlist name')).toBeTruthy()
      expect(screen.getByTestId('manage-setlists-song-editor')).toBeTruthy()
    })

    it('pencil opens rename while setlist songs column is already visible', async () => {
      clearStorage()
      seedTwoSetlistsTonightActive()
      sessionStorage.setItem('liveLyricLaunched', '1')
      window.location.hash = '#/songs/manage-setlists'
      stubFetchForSongsScreens()
      render(<App />)

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Edit songs in setlist Tonight/ })).toBeTruthy()
      })
      expect(screen.getByTestId('manage-setlists-song-editor')).toBeTruthy()
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /Edit songs in setlist Tonight/ }))
      })
      expect(screen.getByLabelText('Setlist name')).toBeTruthy()
      expect(screen.getByTestId('manage-setlists-song-editor')).toBeTruthy()
    })

    it('Enter confirms rename while the song editor stays open until closed elsewhere', async () => {
      clearStorage()
      seedTwoSetlistsTonightActive()
      sessionStorage.setItem('liveLyricLaunched', '1')
      window.location.hash = '#/songs/manage-setlists'
      stubFetchForSongsScreens()
      render(<App />)

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Edit songs in setlist Tonight/ })).toBeTruthy()
      })
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /Edit songs in setlist Tonight/ }))
      })
      const nameInput = screen.getByLabelText('Setlist name')
      await act(async () => {
        fireEvent.change(nameInput, { target: { value: 'Main Stage' } })
      })
      await act(async () => {
        fireEvent.keyDown(nameInput, { key: 'Enter', code: 'Enter' })
      })
      await waitFor(() => {
        expect(screen.queryByLabelText('Setlist name')).toBeNull()
        expect(screen.getByRole('button', { name: 'Active setlist Main Stage' })).toBeTruthy()
      })
      expect(screen.getByTestId('manage-setlists-song-editor')).toBeTruthy()
    })

    it('Escape cancels rename but leaves the song editor open when opened via pencil', async () => {
      clearStorage()
      seedTwoSetlistsTonightActive()
      sessionStorage.setItem('liveLyricLaunched', '1')
      window.location.hash = '#/songs/manage-setlists'
      stubFetchForSongsScreens()
      render(<App />)

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Edit songs in setlist Tonight/ })).toBeTruthy()
      })
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /Edit songs in setlist Tonight/ }))
      })
      const nameInput = screen.getByLabelText('Setlist name')
      await act(async () => {
        fireEvent.change(nameInput, { target: { value: 'Bad Name' } })
      })
      await act(async () => {
        fireEvent.keyDown(nameInput, { key: 'Escape', code: 'Escape' })
      })
      await waitFor(() => {
        expect(screen.queryByLabelText('Setlist name')).toBeNull()
        expect(screen.getByRole('button', { name: 'Active setlist Tonight' })).toBeTruthy()
      })
      expect(screen.getByTestId('manage-setlists-song-editor')).toBeTruthy()
      expect(loadSetlistStore()!.setlists.find((s) => s.id === TONIGHT_ID)?.name).toBe('Tonight')
    })

    it('clicking outside after rename does not change setlist data', async () => {
      clearStorage()
      seedTwoSetlistsTonightActive()
      sessionStorage.setItem('liveLyricLaunched', '1')
      window.location.hash = '#/songs/manage-setlists'
      stubFetchForSongsScreens()
      render(<App />)

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Edit songs in setlist Tonight/ })).toBeTruthy()
      })
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /Edit songs in setlist Tonight/ }))
      })
      const before = JSON.stringify(loadSetlistStore())
      await act(async () => {
        fireEvent.keyDown(screen.getByLabelText('Setlist name'), { key: 'Enter', code: 'Enter' })
      })
      await waitFor(() => {
        expect(screen.queryByLabelText('Setlist name')).toBeNull()
      })

      await act(async () => {
        fireEvent.pointerDown(screen.getByRole('heading', { name: 'Manage setlists' }))
      })
      await waitFor(() => {
        expect(screen.getByTestId('manage-setlists-song-editor')).toBeTruthy()
      })
      expect(JSON.stringify(loadSetlistStore())).toBe(before)
      expect(getActiveSetlistId()).toBe(TONIGHT_ID)
    })

    it('selecting another setlist keeps setlist songs column available when returning to manage', async () => {
      clearStorage()
      seedTwoSetlistsTonightActive()
      sessionStorage.setItem('liveLyricLaunched', '1')
      window.location.hash = '#/songs/manage-setlists'
      stubFetchForSongsScreens()
      render(<App />)

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Edit songs in setlist Tonight/ })).toBeTruthy()
      })
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /Edit songs in setlist Tonight/ }))
      })
      expect(screen.getByTestId('manage-setlists-song-editor')).toBeTruthy()

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Select setlist Default' }))
      })
      await waitFor(() => {
        expect(window.location.hash).toBe('#/songs/manage-setlists')
        expect(getActiveSetlistId()).toBe(TONIGHT_ID)
        expect(screen.getByTestId('manage-setlists-song-editor')).toBeTruthy()
      })

      const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Back' }))
      })
      confirmSpy.mockRestore()
      await waitFor(() => {
        expect(window.location.hash).toBe('#/songs')
        expect(getActiveSetlistId()).toBe(TONIGHT_ID)
      })

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Manage setlists' }))
      })
      await waitFor(() => {
        expect(screen.getByTestId('manage-setlists-screen')).toBeTruthy()
        expect(screen.getByTestId('manage-setlists-song-editor')).toBeTruthy()
      })
    })

    it('adding a library song into selected setlist persists and Setlist screen lists it', async () => {
      clearStorage()
      seedTwoSetlistsTonightActive()
      sessionStorage.setItem('liveLyricLaunched', '1')
      window.location.hash = '#/songs/manage-setlists'
      stubFetchForSongsScreens()
      render(<App />)

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Edit songs in setlist Tonight/ })).toBeTruthy()
      })
      const addButton = await screen.findByRole('button', { name: /Add Vidas to setlist Tonight/ })
      await act(async () => {
        fireEvent.click(addButton)
      })
      expect(loadSetlistStore()!.setlists.find((s) => s.id === TONIGHT_ID)?.songIds).not.toContain('vidas')
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
      })
      await waitFor(() => {
        expect(window.location.hash).toBe('#/songs')
        expect(loadSetlistStore()!.setlists.find((s) => s.id === TONIGHT_ID)?.songIds).toContain('vidas')
      })
      await waitFor(() => {
        expect(screen.getByRole('heading', { name: 'Setlist: Tonight' })).toBeTruthy()
      })
      expect(screen.getByRole('button', { name: 'Vidas' })).toBeTruthy()
      expect(document.querySelectorAll('.songs-song-btn').length).toBe(3)
    })

    it('removing the loaded song from the active setlist clears current song id and loaded lines', async () => {
      clearStorage()
      seedTwoSetlistsTonightActive()
      setCurrentSongId('duelo')
      setSongLines(VALID_LINES)
      setSongIndex(0)
      setBlank(false)
      sessionStorage.setItem('liveLyricLaunched', '1')
      window.location.hash = '#/songs/manage-setlists'
      stubFetchForSongsScreens()
      render(<App />)

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Edit songs in setlist Tonight/ })).toBeTruthy()
      })
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /Edit songs in setlist Tonight/ }))
      })
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /Remove Duelo from setlist Tonight/ }))
      })
      expect(getCurrentSongId()).toBe('duelo')
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
      })
      await waitFor(() => {
        expect(getCurrentSongId()).toBe('')
        expect(getSongLines().length).toBe(0)
      })
    })

    it('removing a song from a non-active setlist does not clear the loaded current song', async () => {
      clearStorage()
      seedTwoSetlistsTonightActive()
      setCurrentSongId('duelo')
      setSongLines(VALID_LINES)
      setSongIndex(0)
      setBlank(false)
      sessionStorage.setItem('liveLyricLaunched', '1')
      window.location.hash = '#/songs/manage-setlists'
      stubFetchForSongsScreens()
      render(<App />)

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Edit songs in setlist Default/ })).toBeTruthy()
      })
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Select setlist Default' }))
      })
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /Edit songs in setlist Default/ }))
      })
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /Remove Vidas from setlist Default/ }))
      })
      expect(getActiveSetlistId()).toBe(TONIGHT_ID)
      expect(getCurrentSongId()).toBe('duelo')
      expect(getSongLines().length).toBeGreaterThan(0)
    })

    it('deleting a library song from Songs in app does not prompt confirm and removes it from the draft UI immediately', async () => {
      clearStorage()
      seedTwoSetlistsTonightActive()
      sessionStorage.setItem('liveLyricLaunched', '1')
      window.location.hash = '#/songs/manage-setlists'
      stubFetchForSongsScreens()
      const confirmSpy = vi.spyOn(window, 'confirm')
      const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {})
      render(<App />)

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Edit songs in setlist Default/ })).toBeTruthy()
      })
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Select setlist Default' }))
      })
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /Edit songs in setlist Default/ }))
      })
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /Remove Vidas from setlist Default/ }))
      })
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /Delete Vidas from library/ }))
      })
      expect(confirmSpy).not.toHaveBeenCalled()
      expect(alertSpy).not.toHaveBeenCalled()
      expect(screen.queryByRole('button', { name: /Delete Vidas from library/ })).toBeNull()
      expect(loadSetlistStore()!.songLibrary.songs.some((s) => s.id === 'vidas')).toBe(true)
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
      })
      await waitFor(() => {
        expect(loadSetlistStore()!.songLibrary.songs.some((s) => s.id === 'vidas')).toBe(false)
      })
      const defaultSl = loadSetlistStore()!.setlists.find((s) => s.id === DEFAULT_SETLIST_ID)!
      expect(defaultSl.songIds).not.toContain('vidas')
      confirmSpy.mockRestore()
      alertSpy.mockRestore()
    })

    it('delete from app does not show an alert when delete succeeds', async () => {
      clearStorage()
      seedTwoSetlistsTonightActive()
      sessionStorage.setItem('liveLyricLaunched', '1')
      window.location.hash = '#/songs/manage-setlists'
      stubFetchForSongsScreens()
      const confirmSpy = vi.spyOn(window, 'confirm')
      const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {})
      render(<App />)

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Edit songs in setlist Default/ })).toBeTruthy()
      })
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Select setlist Default' }))
      })
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /Edit songs in setlist Default/ }))
      })
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /Remove Vidas from setlist Default/ }))
      })
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /Delete Vidas from library/ }))
      })
      expect(confirmSpy).not.toHaveBeenCalled()
      expect(alertSpy).not.toHaveBeenCalled()
      confirmSpy.mockRestore()
      alertSpy.mockRestore()
    })

    it('blocks delete from app when the song is still in a setlist and lists setlist names', async () => {
      clearStorage()
      seedTwoSetlistsTonightActive()
      sessionStorage.setItem('liveLyricLaunched', '1')
      window.location.hash = '#/songs/manage-setlists'
      stubFetchForSongsScreens()
      const confirmSpy = vi.spyOn(window, 'confirm')
      const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {})
      render(<App />)

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Edit songs in setlist Tonight/ })).toBeTruthy()
      })
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /Edit songs in setlist Tonight/ }))
      })
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /Delete Vidas from library/ }))
      })
      expect(confirmSpy).not.toHaveBeenCalled()
      expect(alertSpy).toHaveBeenCalled()
      const msg = alertSpy.mock.calls[0]![0] as string
      expect(msg).toContain('Default')
      expect(loadSetlistStore()!.songLibrary.songs.some((s) => s.id === 'vidas')).toBe(true)
      confirmSpy.mockRestore()
      alertSpy.mockRestore()
    })

    it('blocked delete message lists every setlist that still contains the song in the draft', async () => {
      clearStorage()
      seedTwoSetlistsTonightActive()
      sessionStorage.setItem('liveLyricLaunched', '1')
      window.location.hash = '#/songs/manage-setlists'
      stubFetchForSongsScreens()
      const confirmSpy = vi.spyOn(window, 'confirm')
      const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {})
      render(<App />)

      await waitFor(() => {
        expect(window.__patchManageSetlistsDraft).toBeDefined()
      })
      await act(async () => {
        window.__patchManageSetlistsDraft!((d: SetlistStoreSnapshot) =>
          addSongToSetlistInSnapshot(d, TONIGHT_ID, 'vidas') ?? d
        )
      })
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'New setlist' }))
      })
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /Edit songs in setlist New setlist/ }))
      })
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /Delete Vidas from library/ }))
      })
      expect(confirmSpy).not.toHaveBeenCalled()
      const msg = alertSpy.mock.calls[0]![0] as string
      expect(msg).toContain('Default')
      expect(msg).toContain('Tonight')
      expect(loadSetlistStore()!.songLibrary.songs.some((s) => s.id === 'vidas')).toBe(true)
      confirmSpy.mockRestore()
      alertSpy.mockRestore()
    })

    it('Back without draft changes does not prompt and leaves the store unchanged', async () => {
      clearStorage()
      seedTwoSetlistsTonightActive()
      sessionStorage.setItem('liveLyricLaunched', '1')
      window.location.hash = '#/songs/manage-setlists'
      stubFetchForSongsScreens()
      const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
      const before = JSON.stringify(loadSetlistStore())
      render(<App />)

      await waitFor(() => {
        expect(screen.getByTestId('manage-setlists-screen')).toBeTruthy()
      })
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Back' }))
      })
      expect(confirmSpy).not.toHaveBeenCalled()
      await waitFor(() => {
        expect(window.location.hash).toBe('#/songs')
      })
      expect(JSON.stringify(loadSetlistStore())).toBe(before)
      confirmSpy.mockRestore()
    })

    it('Back with unconfirmed changes shows a warning; cancel keeps Manage setlists open', async () => {
      clearStorage()
      seedTwoSetlistsTonightActive()
      sessionStorage.setItem('liveLyricLaunched', '1')
      window.location.hash = '#/songs/manage-setlists'
      stubFetchForSongsScreens()
      const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
      render(<App />)

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Edit songs in setlist Tonight/ })).toBeTruthy()
      })
      const addButton = await screen.findByRole('button', { name: /Add Vidas to setlist Tonight/ })
      await act(async () => {
        fireEvent.click(addButton)
      })
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Back' }))
      })
      expect(confirmSpy).toHaveBeenCalledWith(
        'You have unconfirmed changes. If you go back now, they will be lost. Continue?'
      )
      await waitFor(() => {
        expect(window.location.hash).toBe('#/songs/manage-setlists')
        expect(screen.getByTestId('manage-setlists-screen')).toBeTruthy()
      })
      confirmSpy.mockRestore()
    })

    it('Back with unconfirmed changes discards draft when the user confirms', async () => {
      clearStorage()
      seedTwoSetlistsTonightActive()
      sessionStorage.setItem('liveLyricLaunched', '1')
      window.location.hash = '#/songs/manage-setlists'
      stubFetchForSongsScreens()
      const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
      render(<App />)

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Edit songs in setlist Tonight/ })).toBeTruthy()
      })
      const addButton = await screen.findByRole('button', { name: /Add Vidas to setlist Tonight/ })
      await act(async () => {
        fireEvent.click(addButton)
      })
      expect(loadSetlistStore()!.setlists.find((s) => s.id === TONIGHT_ID)?.songIds).not.toContain(
        'vidas'
      )
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Back' }))
      })
      await waitFor(() => {
        expect(window.location.hash).toBe('#/songs')
      })
      expect(loadSetlistStore()!.setlists.find((s) => s.id === TONIGHT_ID)?.songIds).not.toContain(
        'vidas'
      )
      confirmSpy.mockRestore()
    })

    it('deleting the currently loaded song after switching setlists loads the new first song safely', async () => {
      clearStorage()
      seedTwoSetlistsTonightActive()
      setCurrentSongId('vidas')
      setSongLines(VALID_LINES)
      setSongIndex(0)
      setBlank(false)
      sessionStorage.setItem('liveLyricLaunched', '1')
      window.location.hash = '#/songs/manage-setlists'
      stubFetchForSongsScreens()
      const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
      render(<App />)

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Edit songs in setlist Default/ })).toBeTruthy()
      })
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Select setlist Default' }))
      })
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /Edit songs in setlist Default/ }))
      })
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /Remove Vidas from setlist Default/ }))
      })
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /Delete Vidas from library/ }))
      })
      expect(getCurrentSongId()).toBe('vidas')
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
      })
      const expectedFirstDefaultSongId =
        loadSetlistStore()!.setlists.find((setlist) => setlist.id === DEFAULT_SETLIST_ID)?.songIds[0] ?? ''
      expect(expectedFirstDefaultSongId).not.toBe('')
      await waitFor(() => {
        expect(getCurrentSongId()).toBe(expectedFirstDefaultSongId)
        expect(getSongLines().length).toBeGreaterThan(0)
        expect(getSongIndex()).toBe(-1)
        expect(getBlank()).toBe(true)
      })
      confirmSpy.mockRestore()
    })

    it('Setlist screen shows active setlist songs in store order after reorder', async () => {
      clearStorage()
      seedTwoSetlistsTonightActive()
      sessionStorage.setItem('liveLyricLaunched', '1')
      window.location.hash = '#/songs/manage-setlists'
      stubFetchForSongsScreens()
      render(<App />)

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Edit songs in setlist Tonight/ })).toBeTruthy()
      })
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /Edit songs in setlist Tonight/ }))
      })
      await waitFor(() => {
        expect(window.__patchManageSetlistsDraft).toBeDefined()
      })
      await act(async () => {
        window.__patchManageSetlistsDraft!((d: SetlistStoreSnapshot) =>
          reorderSongsInSetlistInSnapshot(d, TONIGHT_ID, 0, 1) ?? d
        )
      })
      expect(loadSetlistStore()!.setlists.find((s) => s.id === TONIGHT_ID)?.songIds).toEqual([
        'duelo',
        'pimiento',
      ])
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
      })
      await waitFor(() => {
        expect(window.location.hash).toBe('#/songs')
        expect(loadSetlistStore()!.setlists.find((s) => s.id === TONIGHT_ID)?.songIds).toEqual([
          'pimiento',
          'duelo',
        ])
      })
      const titles = [...document.querySelectorAll('.songs-song-btn')].map((el) => el.textContent?.trim() ?? '')
      expect(titles).toEqual(['Pimiento', 'Duelo'])
    })

    it('shows drag handles for reordering each song in the setlist editor', async () => {
      clearStorage()
      seedTwoSetlistsTonightActive()
      sessionStorage.setItem('liveLyricLaunched', '1')
      window.location.hash = '#/songs/manage-setlists'
      stubFetchForSongsScreens()
      render(<App />)

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Edit songs in setlist Tonight/ })).toBeTruthy()
      })
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /Edit songs in setlist Tonight/ }))
      })
      expect(
        screen.getByRole('button', { name: /Drag to reorder Duelo in setlist Tonight/ })
      ).toBeTruthy()
      expect(
        screen.getByRole('button', { name: /Drag to reorder Pimiento in setlist Tonight/ })
      ).toBeTruthy()
    })

    it('reordering the active setlist does not clear loaded song state when that song remains in the setlist', async () => {
      clearStorage()
      seedTwoSetlistsTonightActive()
      setCurrentSongId('duelo')
      setSongLines(VALID_LINES)
      setSongIndex(0)
      setBlank(false)
      sessionStorage.setItem('liveLyricLaunched', '1')
      window.location.hash = '#/songs/manage-setlists'
      stubFetchForSongsScreens()
      render(<App />)

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Edit songs in setlist Tonight/ })).toBeTruthy()
      })
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /Edit songs in setlist Tonight/ }))
      })
      await waitFor(() => {
        expect(window.__patchManageSetlistsDraft).toBeDefined()
      })
      await act(async () => {
        window.__patchManageSetlistsDraft!((d: SetlistStoreSnapshot) =>
          reorderSongsInSetlistInSnapshot(d, TONIGHT_ID, 0, 1) ?? d
        )
      })
      expect(getCurrentSongId()).toBe('duelo')
      expect(getSongLines()).toEqual(VALID_LINES)
      expect(getSongIndex()).toBe(0)
      expect(getBlank()).toBe(false)
    })

    it('reordering a non-active setlist does not change loaded song state', async () => {
      clearStorage()
      seedTwoSetlistsTonightActive()
      setCurrentSongId('duelo')
      setSongLines(VALID_LINES)
      setSongIndex(0)
      setBlank(false)
      sessionStorage.setItem('liveLyricLaunched', '1')
      window.location.hash = '#/songs/manage-setlists'
      stubFetchForSongsScreens()
      render(<App />)

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Edit songs in setlist Default/ })).toBeTruthy()
      })
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /Edit songs in setlist Default/ }))
      })
      await waitFor(() => {
        expect(window.__patchManageSetlistsDraft).toBeDefined()
      })
      await act(async () => {
        window.__patchManageSetlistsDraft!((d: SetlistStoreSnapshot) =>
          reorderSongsInSetlistInSnapshot(d, DEFAULT_SETLIST_ID, 0, 1) ?? d
        )
      })
      expect(getActiveSetlistId()).toBe(TONIGHT_ID)
      expect(getCurrentSongId()).toBe('duelo')
      expect(getSongLines()).toEqual(VALID_LINES)
    })

    it('Back discards draft setlist selection without persisting activeSetlistId', async () => {
      clearStorage()
      seedTwoSetlistsTonightActive()
      sessionStorage.setItem('liveLyricLaunched', '1')
      window.location.hash = '#/songs/manage-setlists'
      stubFetchForSongsScreens()
      render(<App />)

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Select setlist Default' })).toBeTruthy()
      })
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Select setlist Default' }))
      })
      const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Back' }))
      })
      confirmSpy.mockRestore()
      await waitFor(() => {
        expect(window.location.hash).toBe('#/songs')
        expect(getActiveSetlistId()).toBe(TONIGHT_ID)
      })
    })

    describe('camera icon + link video dialog (§3)', () => {
      function seedSetlistWithSong() {
        const line: SongItem = { languages: { es: 'a', en: 'b' } }
        const snap = {
          version: 5 as const,
          setlists: [{ id: 'sl-1', name: 'Tonight', songIds: ['duelo'] }],
          activeSetlistId: 'sl-1',
          songLibrary: {
            songs: [{ id: 'duelo', title: 'Duelo', items: [line] }],
          },
        }
        saveSetlistStore(snap)
      }

      function renderManageSetlists(openFileDialogImpl?: () => Promise<string | null>) {
        vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.reject(new Error('No fetch'))))
        ;(window as unknown as { electronAPI?: unknown }).electronAPI = {
          isProjectionOpen: vi.fn().mockResolvedValue(false),
          onProjectionOpened: vi.fn(() => vi.fn()),
          onProjectionClosed: vi.fn(() => vi.fn()),
          openProjection: vi.fn().mockResolvedValue(undefined),
          closeProjection: vi.fn().mockResolvedValue(undefined),
          openFileDialog: openFileDialogImpl ?? vi.fn().mockResolvedValue(null),
        }
        window.location.hash = '#/songs/manage-setlists'
        sessionStorage.setItem('liveLyricLaunched', '1')
        render(<App />)
      }

      it('each setlist song row has a camera button', async () => {
        clearStorage()
        seedSetlistWithSong()
        renderManageSetlists()

        await waitFor(() => {
          expect(screen.getByTestId('manage-setlist-song-row-duelo')).toBeTruthy()
        })
        const row = screen.getByTestId('manage-setlist-song-row-duelo')
        expect(within(row).getByRole('button', { name: /Link video for Duelo/i })).toBeTruthy()
      })

      it('clicking the camera button opens the link video dialog', async () => {
        clearStorage()
        seedSetlistWithSong()
        renderManageSetlists()

        await waitFor(() => {
          expect(screen.getByTestId('manage-setlist-song-row-duelo')).toBeTruthy()
        })
        const row = screen.getByTestId('manage-setlist-song-row-duelo')
        await act(async () => {
          fireEvent.click(within(row).getByRole('button', { name: /Link video for Duelo/i }))
        })
        const dialog = screen.getByTestId('link-video-dialog')
        expect(dialog).toBeTruthy()
        expect(within(dialog).getByRole('button', { name: /Choose file.*Big/i })).toBeTruthy()
        expect(within(dialog).getByRole('button', { name: /Choose file.*Small/i })).toBeTruthy()
      })

      it('link dialog has a Close button that dismisses it', async () => {
        clearStorage()
        seedSetlistWithSong()
        renderManageSetlists()

        await waitFor(() => {
          expect(screen.getByTestId('manage-setlist-song-row-duelo')).toBeTruthy()
        })
        await act(async () => {
          fireEvent.click(
            within(screen.getByTestId('manage-setlist-song-row-duelo')).getByRole('button', {
              name: /Link video for Duelo/i,
            })
          )
        })
        expect(screen.getByTestId('link-video-dialog')).toBeTruthy()
        await act(async () => {
          fireEvent.click(screen.getByRole('button', { name: /Close/i }))
        })
        expect(screen.queryByTestId('link-video-dialog')).toBeNull()
      })

      it('Choose file for Small screen sets song.media.small and registers the path', async () => {
        clearStorage()
        seedSetlistWithSong()
        const chosenPath = '/Users/jorge/videos/duelo_small.mp4'
        renderManageSetlists(() => Promise.resolve(chosenPath))

        await waitFor(() => {
          expect(screen.getByTestId('manage-setlist-song-row-duelo')).toBeTruthy()
        })
        await act(async () => {
          fireEvent.click(
            within(screen.getByTestId('manage-setlist-song-row-duelo')).getByRole('button', {
              name: /Link video for Duelo/i,
            })
          )
        })
        await act(async () => {
          fireEvent.click(screen.getByRole('button', { name: /Choose file.*[Ss]mall/i }))
        })
        await waitFor(() => {
          const store = loadSetlistStore()!
          const song = store.songLibrary.songs.find((s) => s.id === 'duelo')!
          expect(song.media?.small?.src).toBe('duelo_small.mp4')
          expect(song.media?.small?.type).toBe('video')
        })
        const paths = JSON.parse(localStorage.getItem(MEDIA_PATH_STORE_KEY) ?? '{}')
        expect(paths['duelo_small.mp4']).toBe(chosenPath)
      })

      it('Choose file for Big screen sets song.media.big and registers the path', async () => {
        clearStorage()
        seedSetlistWithSong()
        const chosenPath = '/Users/jorge/videos/duelo_big.mp4'
        renderManageSetlists(() => Promise.resolve(chosenPath))

        await waitFor(() => {
          expect(screen.getByTestId('manage-setlist-song-row-duelo')).toBeTruthy()
        })
        await act(async () => {
          fireEvent.click(
            within(screen.getByTestId('manage-setlist-song-row-duelo')).getByRole('button', {
              name: /Link video for Duelo/i,
            })
          )
        })
        await act(async () => {
          fireEvent.click(screen.getByRole('button', { name: /Choose file.*[Bb]ig/i }))
        })
        await waitFor(() => {
          const store = loadSetlistStore()!
          const song = store.songLibrary.songs.find((s) => s.id === 'duelo')!
          expect(song.media?.big?.src).toBe('duelo_big.mp4')
          expect(song.media?.big?.type).toBe('video')
        })
        const paths = JSON.parse(localStorage.getItem(MEDIA_PATH_STORE_KEY) ?? '{}')
        expect(paths['duelo_big.mp4']).toBe(chosenPath)
      })

      it('shows a .mov warning inline when a .mov file is chosen', async () => {
        clearStorage()
        seedSetlistWithSong()
        renderManageSetlists(() => Promise.resolve('/Users/jorge/videos/duelo.mov'))

        await waitFor(() => {
          expect(screen.getByTestId('manage-setlist-song-row-duelo')).toBeTruthy()
        })
        await act(async () => {
          fireEvent.click(
            within(screen.getByTestId('manage-setlist-song-row-duelo')).getByRole('button', {
              name: /Link video for Duelo/i,
            })
          )
        })
        await act(async () => {
          fireEvent.click(screen.getByRole('button', { name: /Choose file.*[Ss]mall/i }))
        })
        await waitFor(() => {
          expect(screen.getByText(/ProRes.*MOV|MOV.*ProRes|not web-playable/i)).toBeTruthy()
        })
      })

      it('Clear for Small screen removes song.media.small from the store', async () => {
        clearStorage()
        const line: SongItem = { languages: { es: 'a', en: 'b' } }
        saveSetlistStore({
          version: 5 as const,
          setlists: [{ id: 'sl-1', name: 'Tonight', songIds: ['duelo'] }],
          activeSetlistId: 'sl-1',
          songLibrary: {
            songs: [{
              id: 'duelo',
              title: 'Duelo',
              items: [line],
              media: { small: { type: 'video', src: 'duelo_small.mp4' } },
            }],
          },
        })
        renderManageSetlists()

        await waitFor(() => {
          expect(screen.getByTestId('manage-setlist-song-row-duelo')).toBeTruthy()
        })
        await act(async () => {
          fireEvent.click(
            within(screen.getByTestId('manage-setlist-song-row-duelo')).getByRole('button', {
              name: /Link video for Duelo/i,
            })
          )
        })
        await waitFor(() => {
          expect(screen.getByText('duelo_small.mp4')).toBeTruthy()
        })
        await act(async () => {
          fireEvent.click(screen.getByRole('button', { name: /Clear.*[Ss]mall|[Ss]mall.*[Cc]lear/i }))
        })
        await act(async () => {
          fireEvent.click(screen.getByRole('button', { name: /Close/i }))
        })
        await act(async () => {
          fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
        })
        await waitFor(() => {
          const store = loadSetlistStore()!
          const song = store.songLibrary.songs.find((s) => s.id === 'duelo')!
          expect(song.media?.small).toBeUndefined()
        })
      })
    })
  })

  describe('Played song indicator', () => {
    it('when performer unarms at end-of-song, current song is marked as played', async () => {
      setupControlViewWithReadinessPassing()
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
      await navigateToLastLyric()
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
      installLibraryFromJsonFiles({
        'duelo.json': SONG_A_JSON,
        'luz-y-sal.json': SONG_B_JSON,
      })
      addPlayedSong('duelo')
      setCurrentSongId('duelo')
      setSongLines(VALID_LINES)
      setSongIndex(-1)
      setBlank(true)
      setProjectionLanguage('en')
      setSingingLanguage('es')
      sessionStorage.setItem('liveLyricLaunched', '1')
      sessionStorage.removeItem('liveLyricPerformanceArmed')
      window.location.hash = '#/'
      vi.stubGlobal(
        'fetch',
        vi.fn().mockImplementation(() => Promise.reject(new Error('Unexpected fetch')))
      )
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
      await navigateToLastLyric()
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
      installLibraryFromJsonFiles({ 'duelo.json': SONG_JSON })
      window.location.hash = '#/'
      vi.stubGlobal(
        'fetch',
        vi.fn().mockImplementation(() => Promise.reject(new Error('Unexpected fetch')))
      )

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
    installProductionLikeLibrary()
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
    // Prevent end-of-song next-song tile from replacing the lyric display.
    setActiveSetlistSongIds(['duelo'])
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
    await navigateToLastLyric()

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
    // Prevent end-of-song next-song tile from replacing the lyric display.
    setActiveSetlistSongIds(['duelo'])
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

describe('Control performance timer/status button', () => {
  beforeEach(() => {
    cleanup()
    localStorage.clear()
    sessionStorage.clear()
    installProductionLikeLibrary()
    window.location.hash = '#/'
  })

  afterEach(() => {
    vi.useRealTimers()
    cleanup()
    delete (window as unknown as { electronAPI?: unknown }).electronAPI
  })

  it("is visible only in performing view, starts with 0', and floats outside top bar", async () => {
    vi.useFakeTimers()
    setupControlViewWithReadinessPassing()
    render(<App initialHash="#/" />)

    await act(async () => {
      await Promise.resolve()
    })

    expect(screen.queryByTestId('performance-status-button')).toBeNull()

    await act(async () => {
      fireEvent.click(getArmButton())
    })

    const statusButton = screen.getByTestId('performance-status-button')
    const topBar = document.querySelector('.control-top-bar')
    const bottomButtons = document.querySelector('.bottom-buttons')
    const floatingRoot = screen.getByTestId('performance-status-floating')

    expect(statusButton).toBeTruthy()
    expect(floatingRoot.contains(statusButton)).toBe(true)
    expect(topBar?.contains(statusButton)).toBe(false)
    expect(bottomButtons?.contains(statusButton)).toBe(false)
    expect(screen.getByTestId('performance-status-minutes').textContent).toBe("0'")
    expect(screen.queryByTestId('performance-status-icon')).toBeNull()
    expect(screen.queryByTestId('performance-status-actions')).toBeNull()
  })

  it('renders minute-only musical format and does not render legacy timer text', async () => {
    vi.useFakeTimers()
    setupControlViewWithReadinessPassing()
    render(<App initialHash="#/" />)

    await act(async () => {
      await Promise.resolve()
    })
    await act(async () => {
      fireEvent.click(getArmButton())
    })

    expect(screen.getByTestId('performance-status-button')).toBeTruthy()
    expect(screen.getByTestId('performance-status-minutes').textContent).toMatch(/^\d+'$/)
    expect(screen.getByTestId('performance-status-minutes').textContent).toBe("0'")
    expect(screen.queryByText(/^Minute:/)).toBeNull()
  })

  it('increments elapsed time once per minute', async () => {
    vi.useFakeTimers()
    setupControlViewWithReadinessPassing()
    render(<App initialHash="#/" />)

    await act(async () => {
      await Promise.resolve()
    })
    await act(async () => {
      fireEvent.click(getArmButton())
    })

    expect(screen.getByTestId('performance-status-minutes').textContent).toBe("0'")

    act(() => {
      vi.advanceTimersByTime(59_000)
    })
    expect(screen.getByTestId('performance-status-minutes').textContent).toBe("0'")

    act(() => {
      vi.advanceTimersByTime(1_000)
    })
    expect(screen.getByTestId('performance-status-minutes').textContent).toBe("1'")
  })

  it('clicking the circle toggles visibility of floating timer actions', async () => {
    vi.useFakeTimers()
    setupControlViewWithReadinessPassing()
    render(<App initialHash="#/" />)

    await act(async () => {
      await Promise.resolve()
    })
    await act(async () => {
      fireEvent.click(getArmButton())
    })

    const statusButton = screen.getByTestId('performance-status-button')

    expect(screen.queryByTestId('performance-status-actions')).toBeNull()
    fireEvent.click(statusButton)
    expect(screen.getByTestId('performance-status-actions')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Pause' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Reset' })).toBeTruthy()

    fireEvent.click(statusButton)
    expect(screen.queryByTestId('performance-status-actions')).toBeNull()
  })

  it('clicking inside timer actions does not close them', async () => {
    vi.useFakeTimers()
    setupControlViewWithReadinessPassing()
    render(<App initialHash="#/" />)

    await act(async () => {
      await Promise.resolve()
    })
    await act(async () => {
      fireEvent.click(getArmButton())
    })

    const statusButton = screen.getByTestId('performance-status-button')
    fireEvent.click(statusButton)
    const pauseButton = screen.getByRole('button', { name: 'Pause' })

    fireEvent.click(pauseButton)
    expect(screen.getByTestId('performance-status-actions')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Resume' })).toBeTruthy()
  })

  it('clicking outside the timer and actions closes floating timer actions', async () => {
    vi.useFakeTimers()
    setupControlViewWithReadinessPassing()
    render(<App initialHash="#/" />)

    await act(async () => {
      await Promise.resolve()
    })
    await act(async () => {
      fireEvent.click(getArmButton())
    })

    const statusButton = screen.getByTestId('performance-status-button')
    fireEvent.click(statusButton)
    expect(screen.getByTestId('performance-status-actions')).toBeTruthy()

    fireEvent.pointerDown(document.body)
    expect(screen.queryByTestId('performance-status-actions')).toBeNull()
  })

  it('pause/resume action toggles timer running state without resetting value', async () => {
    vi.useFakeTimers()
    setupControlViewWithReadinessPassing()
    render(<App initialHash="#/" />)

    await act(async () => {
      await Promise.resolve()
    })
    await act(async () => {
      fireEvent.click(getArmButton())
    })

    const statusButton = screen.getByTestId('performance-status-button')
    fireEvent.click(statusButton)
    const pauseButton = screen.getByRole('button', { name: 'Pause' })

    act(() => {
      vi.advanceTimersByTime(60_000)
    })
    expect(screen.getByTestId('performance-status-minutes').textContent).toBe("1'")
    expect(statusButton.className).not.toContain('ctrl-timer-status-paused')

    fireEvent.click(pauseButton)
    expect(statusButton.className).toContain('ctrl-timer-status-paused')
    expect(screen.getByRole('button', { name: 'Resume' })).toBeTruthy()

    act(() => {
      vi.advanceTimersByTime(180_000)
    })
    expect(screen.getByTestId('performance-status-minutes').textContent).toBe("1'")

    fireEvent.click(screen.getByRole('button', { name: 'Resume' }))
    expect(statusButton.className).not.toContain('ctrl-timer-status-paused')
    act(() => {
      vi.advanceTimersByTime(60_000)
    })
    expect(screen.getByTestId('performance-status-minutes').textContent).toBe("2'")
  })

  it('reset action sets timer back to zero minutes', async () => {
    vi.useFakeTimers()
    setupControlViewWithReadinessPassing()
    render(<App initialHash="#/" />)

    await act(async () => {
      await Promise.resolve()
    })
    await act(async () => {
      fireEvent.click(getArmButton())
    })

    const statusButton = screen.getByTestId('performance-status-button')
    fireEvent.click(statusButton)

    act(() => {
      vi.advanceTimersByTime(120_000)
    })
    expect(screen.getByTestId('performance-status-minutes').textContent).toBe("2'")

    fireEvent.click(screen.getByRole('button', { name: 'Reset' }))
    expect(screen.getByTestId('performance-status-minutes').textContent).toBe("0'")
    expect(statusButton.className).not.toContain('ctrl-timer-status-paused')
  })

  it('persists elapsed timer when navigating away from performing view', async () => {
    vi.useFakeTimers()
    setupControlViewWithReadinessPassing()
    render(<App initialHash="#/" />)

    await act(async () => {
      await Promise.resolve()
    })

    await act(async () => {
      fireEvent.click(getArmButton())
    })
    await act(async () => {
      await Promise.resolve()
    })
    expect(screen.getByTestId('performance-state-label').textContent).toBe('Performance: Armed')

    expect(screen.getByTestId('performance-status-minutes').textContent).toBe("0'")

    act(() => {
      vi.advanceTimersByTime(120_000)
    })
    expect(screen.getByTestId('performance-status-minutes').textContent).toBe("2'")

    cleanup()
    render(<App initialHash="#/songs" />)

    // Advance time while ControlView is unmounted (timer UI not present)
    act(() => {
      vi.advanceTimersByTime(120_000)
    })

    cleanup()
    render(<App initialHash="#/" />)

    await act(async () => {
      await Promise.resolve()
    })
    expect(screen.getByTestId('performance-status-minutes').textContent).toBe("4'")
  })

  it('timer does not reset when opening Setlist after song end and re-arming', async () => {
    vi.useFakeTimers()

    setupControlViewWithReadinessPassing()
    render(<App initialHash="#/" />)

    await act(async () => {
      await Promise.resolve()
    })
    expect(screen.getByTestId('performance-state-label').textContent).toBe('Performance: Ready to Arm')

    await act(async () => {
      fireEvent.click(getArmButton())
    })

    await act(async () => {
      await Promise.resolve()
    })
    expect(screen.getByTestId('performance-state-label').textContent).toBe('Performance: Armed')

    // Navigate to last lyric so end-of-song single-click Unarm works.
    await navigateToLastLyric()

    act(() => {
      vi.advanceTimersByTime(120_000)
    })
    expect(screen.getByTestId('performance-status-minutes').textContent).toBe("2'")

    const unarmBtn = screen.getByRole('button', { name: /^Unarm/ })
    await act(async () => {
      fireEvent.click(unarmBtn)
    })

    await act(async () => {
      await Promise.resolve()
    })
    expect(screen.getByTestId('performance-state-label').textContent).toBe('Performance: Ready to Arm')

    cleanup()
    render(<App initialHash="#/songs" />)

    // Advance time while ControlView is unmounted.
    act(() => {
      vi.advanceTimersByTime(180_000)
    })

    cleanup()
    render(<App initialHash="#/" />)

    await act(async () => {
      await Promise.resolve()
    })
    expect(screen.getByTestId('performance-state-label').textContent).toBe('Performance: Ready to Arm')

    await act(async () => {
      fireEvent.click(getArmButton())
    })

    await act(async () => {
      await Promise.resolve()
    })
    expect(screen.getByTestId('performance-state-label').textContent).toBe('Performance: Armed')

    // Total: 2 min (before unarm) + 3 min (while on setlist screen)
    expect(screen.getByTestId('performance-status-minutes').textContent).toBe("5'")
  })

  it('uses the same base button style class while floating outside top bar layout', async () => {
    setupControlViewWithReadinessPassing()
    render(<App initialHash="#/" />)

    await act(async () => {
      await Promise.resolve()
    })
    await act(async () => {
      fireEvent.click(getArmButton())
    })

    const statusButton = screen.getByTestId('performance-status-button')
    const topBar = document.querySelector('.control-top-bar')
    const floatingRoot = screen.getByTestId('performance-status-floating')

    expect(floatingRoot.contains(statusButton)).toBe(true)
    expect(topBar?.contains(statusButton)).toBe(false)
    expect(statusButton.className).toContain('ctrl-btn')
  })

  it('uses circle and minute classes while keeping shared top-bar button contract', async () => {
    setupControlViewWithReadinessPassing()
    render(<App initialHash="#/" />)

    await act(async () => {
      await Promise.resolve()
    })
    await act(async () => {
      fireEvent.click(getArmButton())
    })

    const statusButton = screen.getByTestId('performance-status-button')
    const minutesLabel = screen.getByTestId('performance-status-minutes')

    expect(statusButton.className).toContain('ctrl-btn')
    expect(statusButton.className).toContain('ctrl-timer-status')
    expect(statusButton.className).toContain('ctrl-timer-status-circle')
    expect(minutesLabel.className).toContain('ctrl-timer-status-minutes')
    expect(minutesLabel.className).toContain('ctrl-timer-status-minutes-prominent')
    expect(screen.queryByTestId('performance-status-icon')).toBeNull()
  })

  it('uses reduced circular sizing while keeping the shared dark button family', () => {
    const css = readFileSync(resolve(__dirname, 'control.css'), 'utf8')
    const timerBlock = css.match(/\.ctrl-timer-status\s*\{([^}]*)\}/)
    expect(timerBlock).toBeTruthy()

    const timerRule = timerBlock![1]
    expect(timerRule).toMatch(/width:\s*112px/)
    expect(timerRule).toMatch(/height:\s*112px/)
    expect(timerRule).toMatch(/padding:\s*0/)
    expect(timerRule).toMatch(/border-radius:\s*50%/)
    expect(timerRule).toMatch(/border:\s*1px\s+solid\s+#48484a/)
    expect(timerRule).toMatch(/background:\s*#2c2c2e/)
    expect(timerRule).toMatch(/color:\s*#e5e5e5/)
  })

  it('keeps minute text dominant and removes icon styling complexity', () => {
    const css = readFileSync(resolve(__dirname, 'control.css'), 'utf8')
    const prominentMinutesBlock = css.match(/\.ctrl-timer-status-minutes-prominent\s*\{([^}]*)\}/)
    expect(prominentMinutesBlock).toBeTruthy()

    const prominentMinutesRule = prominentMinutesBlock![1]
    expect(css).not.toMatch(/\.ctrl-timer-status-icon\s*\{/)
    expect(prominentMinutesRule).toMatch(/font-size:\s*clamp\(2\.4em,\s*5vw,\s*2\.9em\)/)
    expect(prominentMinutesRule).toMatch(/font-weight:\s*700/)
  })

  it('uses paused state colors matching the unarm button family', () => {
    const css = readFileSync(resolve(__dirname, 'control.css'), 'utf8')
    const pausedBlock = css.match(/\.ctrl-timer-status-paused\s*\{([^}]*)\}/)
    expect(pausedBlock).toBeTruthy()

    const pausedRule = pausedBlock![1]
    expect(pausedRule).toMatch(/background:\s*#4a3d2d/)
    expect(pausedRule).toMatch(/border-color:\s*#5c4d3d/)
    expect(pausedRule).toMatch(/color:\s*#f0ebe0/)
  })

  it('positions floating actions vertically under the timer circle', () => {
    const css = readFileSync(resolve(__dirname, 'control.css'), 'utf8')
    const actionsBlock = css.match(/\.ctrl-timer-actions\s*\{([^}]*)\}/)
    expect(actionsBlock).toBeTruthy()
    const actionsRule = actionsBlock![1]
    expect(actionsRule).toMatch(/display:\s*flex/)
    expect(actionsRule).toMatch(/flex-direction:\s*column/)
    expect(actionsRule).toMatch(/align-items:\s*stretch/)
  })
})

describe('Control pre-first-lyric notes display', () => {
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

  function setupArmedSongForNotesTest(song: {
    id: string
    title: string
    items: SongItem[]
    notes?: string
  }) {
    saveSetlistStore(createInitialSnapshot([song]))
    sessionStorage.setItem('liveLyricLaunched', '1')
    sessionStorage.removeItem('liveLyricPerformanceArmed')
    setSongLines(song.items)
    setSongIndex(-1)
    setBlank(true)
    setCurrentSongId(song.id)
    setProjectionLanguage('en')
    setSingingLanguage('es')
  }

  it('shows notes when armed before the first lyric, then first Next replaces notes with first lyric', async () => {
    setupArmedSongForNotesTest({
      id: 'duelo',
      title: 'Duelo',
      items: VALID_LINES,
      notes: 'Capo 2. Soft intro.',
    })
    render(<App initialHash="#/" />)

    await waitFor(() => {
      expect(screen.getAllByText(/Ready to Arm/).length).toBeGreaterThan(0)
    })
    await act(async () => {
      fireEvent.click(getArmButton())
    })

    await waitFor(() => {
      expect(screen.getByText('Capo 2. Soft intro.')).toBeTruthy()
    })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /next/i }))
    })

    await waitFor(() => {
      expect(screen.getByText('Hola')).toBeTruthy()
    })
    expect(screen.queryByText('Capo 2. Soft intro.')).toBeNull()
  })

  it('keeps existing behavior for songs without notes (blank until first Next)', async () => {
    setupArmedSongForNotesTest({
      id: 'duelo',
      title: 'Duelo',
      items: VALID_LINES,
    })
    render(<App initialHash="#/" />)

    await waitFor(() => {
      expect(screen.getAllByText(/Ready to Arm/).length).toBeGreaterThan(0)
    })
    await act(async () => {
      fireEvent.click(getArmButton())
    })

    expect(screen.getByText(/Press Next to reveal the first line/)).toBeTruthy()
    expect(screen.queryByText(/Capo 2\. Soft intro\./)).toBeNull()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /next/i }))
    })
    await waitFor(() => {
      expect(screen.getByText('Hola')).toBeTruthy()
    })
  })

  it('continues normal navigation after the first lyric when notes were shown initially', async () => {
    setupArmedSongForNotesTest({
      id: 'duelo',
      title: 'Duelo',
      items: VALID_LINES,
      notes: 'Capo 2. Soft intro.',
    })
    render(<App initialHash="#/" />)

    await waitFor(() => {
      expect(screen.getAllByText(/Ready to Arm/).length).toBeGreaterThan(0)
    })
    await act(async () => {
      fireEvent.click(getArmButton())
    })
    await waitFor(() => {
      expect(screen.getByText('Capo 2. Soft intro.')).toBeTruthy()
    })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /next/i }))
    })
    await waitFor(() => {
      expect(screen.getByText('Hola')).toBeTruthy()
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
    await waitFor(() => {
      expect(screen.getByText('Hola')).toBeTruthy()
    })
  })
})

describe('Control pre-first-lyric intro display', () => {
  beforeEach(() => {
    cleanup()
    localStorage.clear()
    sessionStorage.clear()
    window.location.hash = '#/'
    ;(window as unknown as { electronAPI?: unknown }).electronAPI = {
      isProjectionOpen: vi.fn().mockResolvedValue(true),
      onProjectionOpened: vi.fn(() => vi.fn()),
      onProjectionClosed: vi.fn(() => vi.fn()),
      openProjection: vi.fn().mockResolvedValue(undefined),
      closeProjection: vi.fn().mockResolvedValue(undefined),
    }
  })

  function setupArmedSongForIntroTest(song: {
    id: string
    title: string
    items: SongItem[]
    intro?: Record<string, string>
  }) {
    saveSetlistStore(createInitialSnapshot([song]))
    sessionStorage.setItem('liveLyricLaunched', '1')
    sessionStorage.removeItem('liveLyricPerformanceArmed')
    setSongLines(song.items)
    setSongIndex(-1)
    setBlank(true)
    setCurrentSongId(song.id)
    setProjectionLanguage('en')
    setSingingLanguage('es')
  }

  const WAIT_TIMEOUT = 3000

  it('shows intro[projectionLang] in the middle slot when armed before the first lyric', async () => {
    setupArmedSongForIntroTest({
      id: 'song-intro',
      title: 'Tragedia',
      items: VALID_LINES,
      intro: { es: 'Pelea con tu destino.', en: 'Fight your destiny.' },
    })
    render(<App initialHash="#/" />)

    await waitFor(() => {
      expect(screen.getAllByText(/Ready to Arm/).length).toBeGreaterThan(0)
    })
    await act(async () => {
      fireEvent.click(getArmButton())
    })

    await waitFor(() => {
      expect(screen.getByText('Fight your destiny.')).toBeTruthy()
    }, { timeout: WAIT_TIMEOUT })
    expect(document.querySelector('.control-song-intro')).toBeTruthy()
  })

  it('shows nothing extra when song has no intro field', async () => {
    setupArmedSongForIntroTest({
      id: 'song-no-intro',
      title: 'Tragedia',
      items: VALID_LINES,
    })
    render(<App initialHash="#/" />)

    await waitFor(() => {
      expect(screen.getAllByText(/Ready to Arm/).length).toBeGreaterThan(0)
    })
    await act(async () => {
      fireEvent.click(getArmButton())
    })

    await waitFor(() => {
      expect(screen.getByText(/Press Next to reveal the first line/)).toBeTruthy()
    }, { timeout: WAIT_TIMEOUT })
    expect(document.querySelector('.control-song-intro')).toBeNull()
  })

  it('never shows intro_cues text (regression)', async () => {
    setupArmedSongForIntroTest({
      id: 'song-regression',
      title: 'Tragedia',
      items: VALID_LINES,
    })
    render(<App initialHash="#/" />)

    await waitFor(() => {
      expect(screen.getAllByText(/Ready to Arm/).length).toBeGreaterThan(0)
    })
    await act(async () => {
      fireEvent.click(getArmButton())
    })

    await waitFor(() => {
      expect(screen.getByText(/Press Next to reveal/)).toBeTruthy()
    }, { timeout: WAIT_TIMEOUT })
    expect(document.querySelector('.control-intro-cues')).toBeNull()
  })
})

describe('End Card — control view', () => {
  beforeEach(() => {
    cleanup()
    vi.clearAllMocks()
    clearStorage()
    installProductionLikeLibrary()
    localStorage.removeItem(KEY_END_CARD_VISIBLE)
  })

  afterEach(() => {
    vi.useRealTimers()
    cleanup()
    delete (window as unknown as { electronAPI?: unknown }).electronAPI
    localStorage.removeItem(KEY_END_CARD_VISIBLE)
  })

  it('End Card button is visible in ARMED state', async () => {
    setupControlViewWithReadinessPassing()
    render(<App initialHash="#/" />)

    await waitFor(() => {
      expect(screen.getByTestId('performance-state-label').textContent).toBe('Performance: Ready to Arm')
    }, { timeout: WAIT_TIMEOUT })
    await act(async () => {
      fireEvent.click(getArmButton())
    })

    expect(screen.getByRole('button', { name: /end card/i })).toBeTruthy()
  })

  it('End Card button is NOT visible in SETUP or READY_TO_ARM state', async () => {
    setupControlViewWithReadinessPassing()
    render(<App initialHash="#/" />)

    await waitFor(() => {
      expect(screen.getByTestId('performance-state-label').textContent).toBe('Performance: Ready to Arm')
    }, { timeout: WAIT_TIMEOUT })

    expect(screen.queryByRole('button', { name: /end card/i })).toBeNull()
  })

  it('clicking End Card sets the localStorage key and changes button label to Hide End Card', async () => {
    setupControlViewWithReadinessPassing()
    render(<App initialHash="#/" />)

    await waitFor(() => {
      expect(screen.getByTestId('performance-state-label').textContent).toBe('Performance: Ready to Arm')
    }, { timeout: WAIT_TIMEOUT })
    await act(async () => {
      fireEvent.click(getArmButton())
    })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^End Card$/i }))
    })

    expect(getEndCardVisible()).toBe(true)
    expect(screen.getByRole('button', { name: /hide end card/i })).toBeTruthy()
  })

  it('clicking Hide End Card removes the localStorage key and reverts label', async () => {
    setupControlViewWithReadinessPassing()
    render(<App initialHash="#/" />)

    await waitFor(() => {
      expect(screen.getByTestId('performance-state-label').textContent).toBe('Performance: Ready to Arm')
    }, { timeout: WAIT_TIMEOUT })
    await act(async () => {
      fireEvent.click(getArmButton())
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^End Card$/i }))
    })
    expect(getEndCardVisible()).toBe(true)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /hide end card/i }))
    })

    expect(getEndCardVisible()).toBe(false)
    expect(screen.getByRole('button', { name: /^End Card$/i })).toBeTruthy()
  })

  it('unarming automatically hides the end card', async () => {
    setupControlViewWithReadinessPassing()
    render(<App initialHash="#/" />)

    await waitFor(() => {
      expect(screen.getByTestId('performance-state-label').textContent).toBe('Performance: Ready to Arm')
    }, { timeout: WAIT_TIMEOUT })
    await act(async () => {
      fireEvent.click(getArmButton())
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^End Card$/i }))
    })
    expect(getEndCardVisible()).toBe(true)

    vi.useFakeTimers()
    const unarmBtn = screen.getByRole('button', { name: /^Unarm/ })
    await act(async () => { fireEvent.pointerDown(unarmBtn) })
    act(() => { vi.advanceTimersByTime(HOLD_CONFIRM_MS) })
    vi.useRealTimers()

    expect(getEndCardVisible()).toBe(false)
  })
})
