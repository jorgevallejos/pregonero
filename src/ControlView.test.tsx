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
import { KEY_END_CARD_VISIBLE } from './endCardState'
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
import { DISPLAY_PROFILE_STORAGE_KEY } from './displayProfileStore'
import { clearStoredDisplayMode, KEY_DISPLAY_MODE_BROADCAST } from './screenSizeState'
import { getAutoBlackout } from './autoBlackout'

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

  it('2. In Setup state, the sections appear in this exact order: Song, Lyrics display, Projection, Arm', async () => {
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
    expect(firstLabels[1]).toBe('Lyrics display')
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

  it('2d. In Setup state, Lyrics display column shows the current language pair as its big value, with a Languages button below (not separate Singing/Translation buttons)', async () => {
    setupControlViewInitial()
    setSongLines(VALID_LINES)
    setCurrentSongId('duelo')
    setSingingLanguage('es')
    setProjectionLanguage('en')
    render(<App initialHash="#/" />)

    await waitFor(
      () => {
        expect(screen.getByTestId('performance-state-label').textContent).toBe('Performance: Setup')
      },
      { timeout: WAIT_TIMEOUT }
    )

    // The language pair renders as the column's big value; the button is a plain "Languages" link.
    const main = screen.getByRole('main')
    const sections = main.querySelectorAll('.control-setup-section')
    const lyricsSection = Array.from(sections).find(
      (s) => s.querySelector('.control-setup-label')?.textContent === 'Lyrics display'
    )
    expect(lyricsSection?.querySelector('.control-setup-value')?.textContent).toBe('ES → EN')
    expect(screen.getByRole('button', { name: 'Languages' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'ES → EN' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Singing' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Translation' })).toBeNull()
  })

  // Nothing is *stored* for either language here, but that does not mean nothing is shown:
  // getEffectiveProjectionLanguage has, since the original multilingual work, defaulted to 'en'
  // when nothing is stored and the song offers it — behaviour with its own unit test in
  // songState.test.ts ("when no stored language exists and 'en' is available → return 'en'").
  // VALID_LINES carries an 'en' translation, so the projection language resolves to 'en' and the
  // value area correctly reads "EN". No singing language is stored and none is defaulted, so the
  // display is the bare target language rather than the "ES → EN" pair form.
  //
  // This test previously asserted the value area was absent entirely, which contradicted that
  // default; corrected 2026-08-14 once Jorge confirmed the default is intended.
  it('2g. Lyrics display: shows the defaulted projection language when none is stored, button still reads Languages', async () => {
    setupControlViewInitial()
    setSongLines(VALID_LINES)
    setCurrentSongId('duelo')
    setSingingLanguage('')
    setProjectionLanguage('')
    render(<App initialHash="#/" />)

    await waitFor(
      () => {
        expect(screen.getByTestId('performance-state-label').textContent).toBe('Performance: Setup')
      },
      { timeout: WAIT_TIMEOUT }
    )

    const main = screen.getByRole('main')
    const sections = main.querySelectorAll('.control-setup-section')
    const lyricsSection = Array.from(sections).find(
      (s) => s.querySelector('.control-setup-label')?.textContent === 'Lyrics display'
    )
    expect(lyricsSection?.querySelector('.control-setup-value')?.textContent).toBe('EN')
    expect(screen.getByRole('button', { name: 'Languages' })).toBeTruthy()
  })

  it('2h. Lyrics display: clicking the Languages button navigates to the Languages screen', async () => {
    setupControlViewInitial()
    setSongLines(VALID_LINES)
    setCurrentSongId('duelo')
    setSingingLanguage('es')
    setProjectionLanguage('en')
    render(<App initialHash="#/" />)

    await waitFor(
      () => {
        expect(screen.getByTestId('performance-state-label').textContent).toBe('Performance: Setup')
      },
      { timeout: WAIT_TIMEOUT }
    )

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Languages' }))
    })

    expect(window.location.hash).toBe('#/languages')
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

    describe('camera button — direct picker (§3)', () => {
      function seedSetlistWithSong() {
        const line: SongItem = { languages: { es: 'a', en: 'b' } }
        const snap = {
          version: 7 as const,
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

      it('choosing a .mov file alerts a web-playable warning', async () => {
        clearStorage()
        seedSetlistWithSong()
        const alertMock = vi.spyOn(window, 'alert').mockImplementation(() => undefined)
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
        await waitFor(() => {
          expect(alertMock).toHaveBeenCalledWith(expect.stringMatching(/ProRes.*MOV|MOV.*ProRes|not web-playable/i))
        })
        alertMock.mockRestore()
      })

      it('clicking the camera button calls openFileDialog directly without showing a dialog', async () => {
        clearStorage()
        seedSetlistWithSong()
        const openFileMock = vi.fn().mockResolvedValue(null)
        renderManageSetlists(() => openFileMock())

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
        expect(screen.queryByTestId('link-video-dialog')).toBeNull()
        expect(openFileMock).toHaveBeenCalledTimes(1)
      })

      it('choosing a file via camera button sets song.media and registers the path', async () => {
        clearStorage()
        seedSetlistWithSong()
        const chosenPath = '/Users/jorge/videos/duelo.mp4'
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
        await waitFor(() => {
          const store = loadSetlistStore()!
          const song = store.songLibrary.songs.find((s) => s.id === 'duelo')!
          expect(song.media?.src).toBe('duelo.mp4')
          expect(song.media?.type).toBe('video')
        })
        const paths = JSON.parse(localStorage.getItem(MEDIA_PATH_STORE_KEY) ?? '{}')
        expect(paths['duelo.mp4']).toBe(chosenPath)
      })

      it('camera button has --linked class when song already has media', async () => {
        clearStorage()
        const line: SongItem = { languages: { es: 'a', en: 'b' } }
        saveSetlistStore({
          version: 7 as const,
          setlists: [{ id: 'sl-1', name: 'Tonight', songIds: ['duelo'] }],
          activeSetlistId: 'sl-1',
          songLibrary: {
            songs: [{
              id: 'duelo',
              title: 'Duelo',
              items: [line],
              media: { type: 'video', src: 'duelo.mp4' },
            }],
          },
        })
        renderManageSetlists()

        await waitFor(() => {
          expect(screen.getByTestId('manage-setlist-song-row-duelo')).toBeTruthy()
        })
        const row = screen.getByTestId('manage-setlist-song-row-duelo')
        const cameraBtn = within(row).getByRole('button', { name: /Link video for Duelo/i })
        expect(cameraBtn.classList.contains('manage-setlists-icon-btn--linked')).toBe(true)
      })

      it('camera button does not have --linked class when song has no media', async () => {
        clearStorage()
        seedSetlistWithSong()
        renderManageSetlists()

        await waitFor(() => {
          expect(screen.getByTestId('manage-setlist-song-row-duelo')).toBeTruthy()
        })
        const row = screen.getByTestId('manage-setlist-song-row-duelo')
        const cameraBtn = within(row).getByRole('button', { name: /Link video for Duelo/i })
        expect(cameraBtn.classList.contains('manage-setlists-icon-btn--linked')).toBe(false)
      })
    })

    describe('camera button — library rows + empty-state affordance (§9)', () => {
      function seedLibraryOnly() {
        const line: SongItem = { languages: { es: 'a', en: 'b' } }
        saveSetlistStore({
          version: 7 as const,
          setlists: [],
          activeSetlistId: '',
          songLibrary: { songs: [{ id: 'duelo', title: 'Duelo', items: [line] }] },
        })
      }

      function seedLibraryOnlyWithMedia() {
        const line: SongItem = { languages: { es: 'a', en: 'b' } }
        saveSetlistStore({
          version: 7 as const,
          setlists: [],
          activeSetlistId: '',
          songLibrary: {
            songs: [{ id: 'duelo', title: 'Duelo', items: [line], media: { type: 'video' as const, src: 'duelo.mp4' } }],
          },
        })
      }

      function seedSetlistWithMediaSong() {
        const line: SongItem = { languages: { es: 'a', en: 'b' } }
        saveSetlistStore({
          version: 7 as const,
          setlists: [{ id: 'sl-1', name: 'Tonight', songIds: ['duelo'] }],
          activeSetlistId: 'sl-1',
          songLibrary: {
            songs: [{ id: 'duelo', title: 'Duelo', items: [line], media: { type: 'video' as const, src: 'duelo.mp4' } }],
          },
        })
      }

      function seedSetlistWithNoMediaSong() {
        const line: SongItem = { languages: { es: 'a', en: 'b' } }
        saveSetlistStore({
          version: 7 as const,
          setlists: [{ id: 'sl-1', name: 'Tonight', songIds: ['duelo'] }],
          activeSetlistId: 'sl-1',
          songLibrary: { songs: [{ id: 'duelo', title: 'Duelo', items: [line] }] },
        })
      }

      function renderManageSetlists9(openFileDialogImpl?: () => Promise<string | null>) {
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

      it('library song row has a video-link camera button', async () => {
        clearStorage()
        seedLibraryOnly()
        renderManageSetlists9()

        const libraryPanel = await screen.findByTestId('manage-setlists-library-panel')
        expect(within(libraryPanel).getByRole('button', { name: /Link video for Duelo/i })).toBeTruthy()
      })

      it('clicking library camera button calls openFileDialog and links the video', async () => {
        clearStorage()
        seedLibraryOnly()
        const chosenPath = '/Users/jorge/videos/duelo.mp4'
        renderManageSetlists9(() => Promise.resolve(chosenPath))

        const libraryPanel = await screen.findByTestId('manage-setlists-library-panel')
        await act(async () => {
          fireEvent.click(within(libraryPanel).getByRole('button', { name: /Link video for Duelo/i }))
        })
        await waitFor(() => {
          const store = loadSetlistStore()!
          const song = store.songLibrary.songs.find((s) => s.id === 'duelo')!
          expect(song.media?.src).toBe('duelo.mp4')
          expect(song.media?.type).toBe('video')
        })
        const paths = JSON.parse(localStorage.getItem(MEDIA_PATH_STORE_KEY) ?? '{}')
        expect(paths['duelo.mp4']).toBe(chosenPath)
      })

      it('library camera button has --linked class when song already has media', async () => {
        clearStorage()
        seedLibraryOnlyWithMedia()
        renderManageSetlists9()

        const libraryPanel = await screen.findByTestId('manage-setlists-library-panel')
        const cameraBtn = within(libraryPanel).getByRole('button', { name: /Link video for Duelo/i })
        expect(cameraBtn.classList.contains('manage-setlists-icon-btn--linked')).toBe(true)
      })

      it('library camera button does not have --linked class when song has no media', async () => {
        clearStorage()
        seedLibraryOnly()
        renderManageSetlists9()

        const libraryPanel = await screen.findByTestId('manage-setlists-library-panel')
        const cameraBtn = within(libraryPanel).getByRole('button', { name: /Link video for Duelo/i })
        expect(cameraBtn.classList.contains('manage-setlists-icon-btn--linked')).toBe(false)
      })

      it('setlist camera button has --add class when song has no media', async () => {
        clearStorage()
        seedSetlistWithNoMediaSong()
        renderManageSetlists9()

        await waitFor(() => {
          expect(screen.getByTestId('manage-setlist-song-row-duelo')).toBeTruthy()
        })
        const row = screen.getByTestId('manage-setlist-song-row-duelo')
        const cameraBtn = within(row).getByRole('button', { name: /Link video for Duelo/i })
        expect(cameraBtn.classList.contains('manage-setlists-icon-btn--add')).toBe(true)
      })

      it('setlist camera button does not have --add class when song has media', async () => {
        clearStorage()
        seedSetlistWithMediaSong()
        renderManageSetlists9()

        await waitFor(() => {
          expect(screen.getByTestId('manage-setlist-song-row-duelo')).toBeTruthy()
        })
        const row = screen.getByTestId('manage-setlist-song-row-duelo')
        const cameraBtn = within(row).getByRole('button', { name: /Link video for Duelo/i })
        expect(cameraBtn.classList.contains('manage-setlists-icon-btn--add')).toBe(false)
      })

      it('library camera button has --add class when song has no media', async () => {
        clearStorage()
        seedLibraryOnly()
        renderManageSetlists9()

        const libraryPanel = await screen.findByTestId('manage-setlists-library-panel')
        const cameraBtn = within(libraryPanel).getByRole('button', { name: /Link video for Duelo/i })
        expect(cameraBtn.classList.contains('manage-setlists-icon-btn--add')).toBe(true)
      })

      it('library camera button does not have --add class when song has media', async () => {
        clearStorage()
        seedLibraryOnlyWithMedia()
        renderManageSetlists9()

        const libraryPanel = await screen.findByTestId('manage-setlists-library-panel')
        const cameraBtn = within(libraryPanel).getByRole('button', { name: /Link video for Duelo/i })
        expect(cameraBtn.classList.contains('manage-setlists-icon-btn--add')).toBe(false)
      })

      it('camera button linked state has a checkmark badge', async () => {
        clearStorage()
        seedLibraryOnlyWithMedia()
        renderManageSetlists9()

        const libraryPanel = await screen.findByTestId('manage-setlists-library-panel')
        const cameraBtn = within(libraryPanel).getByRole('button', { name: /Link video for Duelo/i })
        expect(cameraBtn.textContent).toContain('✓')
      })

      it('camera button without media has "+" badge and no checkmark', async () => {
        clearStorage()
        seedLibraryOnly()
        renderManageSetlists9()

        const libraryPanel = await screen.findByTestId('manage-setlists-library-panel')
        const cameraBtn = within(libraryPanel).getByRole('button', { name: /Link video for Duelo/i })
        expect(cameraBtn.textContent).toContain('+')
        expect(cameraBtn.textContent).not.toContain('✓')
      })
    })

    describe('timeline-import button (§16)', () => {
      function seedSetlistSongNoTimeline() {
        const line: SongItem = { languages: { es: 'a', en: 'b' } }
        saveSetlistStore({
          version: 7 as const,
          setlists: [{ id: 'sl-1', name: 'Tonight', songIds: ['duelo'] }],
          activeSetlistId: 'sl-1',
          songLibrary: { songs: [{ id: 'duelo', title: 'Duelo', items: [line] }] },
        })
      }

      function seedSetlistSongWithTimeline() {
        const line: SongItem = { languages: { es: 'a', en: 'b' } }
        saveSetlistStore({
          version: 7 as const,
          setlists: [{ id: 'sl-1', name: 'Tonight', songIds: ['duelo'] }],
          activeSetlistId: 'sl-1',
          songLibrary: {
            songs: [{ id: 'duelo', title: 'Duelo', items: [line], timeline: [{ start: 0, end: 1 }] }],
          },
        })
      }

      function seedLibrarySongNoTimeline() {
        const line: SongItem = { languages: { es: 'a', en: 'b' } }
        saveSetlistStore({
          version: 7 as const,
          setlists: [],
          activeSetlistId: '',
          songLibrary: { songs: [{ id: 'duelo', title: 'Duelo', items: [line] }] },
        })
      }

      function seedLibrarySongWithTimeline() {
        const line: SongItem = { languages: { es: 'a', en: 'b' } }
        saveSetlistStore({
          version: 7 as const,
          setlists: [],
          activeSetlistId: '',
          songLibrary: {
            songs: [{ id: 'duelo', title: 'Duelo', items: [line], timeline: [{ start: 0, end: 1 }] }],
          },
        })
      }

      function renderManageSetlists16() {
        vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.reject(new Error('No fetch'))))
        ;(window as unknown as { electronAPI?: unknown }).electronAPI = {
          isProjectionOpen: vi.fn().mockResolvedValue(false),
          onProjectionOpened: vi.fn(() => vi.fn()),
          onProjectionClosed: vi.fn(() => vi.fn()),
          openProjection: vi.fn().mockResolvedValue(undefined),
          closeProjection: vi.fn().mockResolvedValue(undefined),
          openFileDialog: vi.fn().mockResolvedValue(null),
        }
        window.location.hash = '#/songs/manage-setlists'
        sessionStorage.setItem('liveLyricLaunched', '1')
        render(<App />)
      }

      it('setlist song row has a timeline-import button when song has no timeline (--add class)', async () => {
        clearStorage()
        seedSetlistSongNoTimeline()
        renderManageSetlists16()

        await waitFor(() => {
          expect(screen.getByTestId('manage-setlist-song-row-duelo')).toBeTruthy()
        })
        const row = screen.getByTestId('manage-setlist-song-row-duelo')
        const btn = within(row).getByRole('button', { name: /Import timeline for Duelo/i })
        expect(btn).toBeTruthy()
        expect(btn.classList.contains('manage-setlists-icon-btn--add')).toBe(true)
        expect(btn.classList.contains('manage-setlists-icon-btn--linked')).toBe(false)
      })

      it('setlist song row timeline button has --linked class when song has a timeline', async () => {
        clearStorage()
        seedSetlistSongWithTimeline()
        renderManageSetlists16()

        await waitFor(() => {
          expect(screen.getByTestId('manage-setlist-song-row-duelo')).toBeTruthy()
        })
        const row = screen.getByTestId('manage-setlist-song-row-duelo')
        const btn = within(row).getByRole('button', { name: /Import timeline for Duelo/i })
        expect(btn.classList.contains('manage-setlists-icon-btn--linked')).toBe(true)
        expect(btn.classList.contains('manage-setlists-icon-btn--add')).toBe(false)
      })

      it('timeline button has "+" badge when no timeline and "✓" badge when has timeline on setlist rows', async () => {
        clearStorage()
        seedSetlistSongNoTimeline()
        renderManageSetlists16()

        await waitFor(() => {
          expect(screen.getByTestId('manage-setlist-song-row-duelo')).toBeTruthy()
        })
        const row = screen.getByTestId('manage-setlist-song-row-duelo')
        const btnNoTl = within(row).getByRole('button', { name: /Import timeline for Duelo/i })
        expect(btnNoTl.textContent).toContain('+')
        expect(btnNoTl.textContent).not.toContain('✓')
        cleanup()

        clearStorage()
        seedSetlistSongWithTimeline()
        renderManageSetlists16()

        await waitFor(() => {
          expect(screen.getByTestId('manage-setlist-song-row-duelo')).toBeTruthy()
        })
        const row2 = screen.getByTestId('manage-setlist-song-row-duelo')
        const btnTl = within(row2).getByRole('button', { name: /Import timeline for Duelo/i })
        expect(btnTl.textContent).toContain('✓')
        expect(btnTl.textContent).not.toContain('+')
      })

      it('library song row has a timeline-import button with --add class when no timeline', async () => {
        clearStorage()
        seedLibrarySongNoTimeline()
        renderManageSetlists16()

        const libraryPanel = await screen.findByTestId('manage-setlists-library-panel')
        const btn = within(libraryPanel).getByRole('button', { name: /Import timeline for Duelo/i })
        expect(btn.classList.contains('manage-setlists-icon-btn--add')).toBe(true)
      })

      it('library song row timeline button has --linked class when song has a timeline', async () => {
        clearStorage()
        seedLibrarySongWithTimeline()
        renderManageSetlists16()

        const libraryPanel = await screen.findByTestId('manage-setlists-library-panel')
        const btn = within(libraryPanel).getByRole('button', { name: /Import timeline for Duelo/i })
        expect(btn.classList.contains('manage-setlists-icon-btn--linked')).toBe(true)
      })

      it('clicking setlist timeline button then selecting a valid JSON file writes timeline to the song', async () => {
        clearStorage()
        seedSetlistSongNoTimeline()
        renderManageSetlists16()

        await waitFor(() => {
          expect(screen.getByTestId('manage-setlist-song-row-duelo')).toBeTruthy()
        })
        const row = screen.getByTestId('manage-setlist-song-row-duelo')
        await act(async () => {
          fireEvent.click(within(row).getByRole('button', { name: /Import timeline for Duelo/i }))
        })

        // P3: the import file must be a valid timeline v2 envelope (timelineVersion + leadIn +
        // timeline) — a bare { timeline: [...] } (v1-shaped) is now rejected by the guard.
        const jsonText = JSON.stringify({
          timelineVersion: 2,
          leadIn: { durationSec: 0, source: 'none', confidence: 'low', apply: false },
          timeline: [{ start: 0, end: 1 }],
        })
        const mockFile = new File([jsonText], 'timeline.json', { type: 'application/json' })
        const input = document.querySelector<HTMLInputElement>('[data-testid="import-timeline-input"]')!
        await act(async () => {
          fireEvent.change(input, { target: { files: [mockFile] } })
        })

        await waitFor(() => {
          const store = loadSetlistStore()!
          const song = store.songLibrary.songs.find((s) => s.id === 'duelo')!
          expect(song.timeline).toEqual([{ start: 0, end: 1 }])
          expect(song.timelineVersion).toBe(2)
          expect(song.leadIn).toEqual({ durationSec: 0, source: 'none', confidence: 'low', apply: false })
        })
      })

      it('clicking library timeline button then selecting a valid JSON file writes timeline to the song', async () => {
        clearStorage()
        seedLibrarySongNoTimeline()
        renderManageSetlists16()

        const libraryPanel = await screen.findByTestId('manage-setlists-library-panel')
        await act(async () => {
          fireEvent.click(within(libraryPanel).getByRole('button', { name: /Import timeline for Duelo/i }))
        })

        const jsonText = JSON.stringify({
          timelineVersion: 2,
          leadIn: { durationSec: 0, source: 'none', confidence: 'low', apply: false },
          timeline: [{ start: 0, end: 2 }, { start: 2, end: 4 }],
        })
        const mockFile = new File([jsonText], 'timeline.json', { type: 'application/json' })
        const input = document.querySelector<HTMLInputElement>('[data-testid="import-timeline-input"]')!
        await act(async () => {
          fireEvent.change(input, { target: { files: [mockFile] } })
        })

        await waitFor(() => {
          const store = loadSetlistStore()!
          const song = store.songLibrary.songs.find((s) => s.id === 'duelo')!
          expect(song.timeline).toEqual([{ start: 0, end: 2 }, { start: 2, end: 4 }])
          expect(song.timelineVersion).toBe(2)
        })
      })

      it('P3: importing a v1-shaped timeline file (no timelineVersion) is rejected with the older-Bombista message', async () => {
        clearStorage()
        seedSetlistSongNoTimeline()
        const alertMock = vi.spyOn(window, 'alert').mockImplementation(() => undefined)
        renderManageSetlists16()

        await waitFor(() => {
          expect(screen.getByTestId('manage-setlist-song-row-duelo')).toBeTruthy()
        })
        const row = screen.getByTestId('manage-setlist-song-row-duelo')
        await act(async () => {
          fireEvent.click(within(row).getByRole('button', { name: /Import timeline for Duelo/i }))
        })

        const jsonText = JSON.stringify({ timeline: [{ start: 0, end: 1 }] })
        const mockFile = new File([jsonText], 'timeline.json', { type: 'application/json' })
        const input = document.querySelector<HTMLInputElement>('[data-testid="import-timeline-input"]')!
        await act(async () => {
          fireEvent.change(input, { target: { files: [mockFile] } })
        })

        await waitFor(() => {
          expect(alertMock).toHaveBeenCalledWith(
            expect.stringMatching(/This timeline was made by an older Bombista — re-run the extractor\./)
          )
        })
        const store = loadSetlistStore()!
        const song = store.songLibrary.songs.find((s) => s.id === 'duelo')!
        expect(song.timeline).toBeUndefined()
        alertMock.mockRestore()
      })

      it('importing an invalid JSON file shows an alert and does not change the song', async () => {
        clearStorage()
        seedSetlistSongNoTimeline()
        const alertMock = vi.spyOn(window, 'alert').mockImplementation(() => undefined)
        renderManageSetlists16()

        await waitFor(() => {
          expect(screen.getByTestId('manage-setlist-song-row-duelo')).toBeTruthy()
        })
        const row = screen.getByTestId('manage-setlist-song-row-duelo')
        await act(async () => {
          fireEvent.click(within(row).getByRole('button', { name: /Import timeline for Duelo/i }))
        })

        const mockFile = new File(['not valid json'], 'timeline.json', { type: 'application/json' })
        const input = document.querySelector<HTMLInputElement>('[data-testid="import-timeline-input"]')!
        await act(async () => {
          fireEvent.change(input, { target: { files: [mockFile] } })
        })

        await waitFor(() => {
          expect(alertMock).toHaveBeenCalledWith(expect.stringMatching(/invalid timeline/i))
        })

        const store = loadSetlistStore()!
        const song = store.songLibrary.songs.find((s) => s.id === 'duelo')!
        expect(song.timeline).toBeUndefined()
        alertMock.mockRestore()
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
    expect(timerRule).toMatch(/width:\s*var\(--beat-circle-size\)/)
    expect(timerRule).toMatch(/height:\s*var\(--beat-circle-size\)/)
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

  it('End Card button is NOT rendered in the armed footer', async () => {
    setupControlViewWithReadinessPassing()
    render(<App initialHash="#/" />)

    await waitFor(() => {
      expect(screen.getByTestId('performance-state-label').textContent).toBe('Performance: Ready to Arm')
    }, { timeout: WAIT_TIMEOUT })
    await act(async () => {
      fireEvent.click(getArmButton())
    })

    expect(screen.queryByTestId('end-card-btn')).toBeNull()
    expect(screen.queryByRole('button', { name: /end card/i })).toBeNull()
  })
})

// ── §5 + §6 — simplified performance screens ──────────────────────────────

describe('§6 non-video armed screen', () => {
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

  it('End Card button is NOT rendered in the non-video armed screen', async () => {
    setupControlViewWithReadinessPassing()
    render(<App initialHash="#/" />)

    await waitFor(() => {
      expect(screen.getByTestId('performance-state-label').textContent).toBe('Performance: Ready to Arm')
    }, { timeout: WAIT_TIMEOUT })
    await act(async () => {
      fireEvent.click(getArmButton())
    })

    expect(screen.queryByTestId('end-card-btn')).toBeNull()
    expect(screen.queryByRole('button', { name: /end card/i })).toBeNull()
  })

  it('Previous, Next, Restart, Unarm are all present in non-video armed screen', async () => {
    setupControlViewWithReadinessPassing()
    render(<App initialHash="#/" />)

    await waitFor(() => {
      expect(screen.getByTestId('performance-state-label').textContent).toBe('Performance: Ready to Arm')
    }, { timeout: WAIT_TIMEOUT })
    await act(async () => {
      fireEvent.click(getArmButton())
    })

    expect(screen.getByRole('button', { name: /previous/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /next/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /restart/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /^unarm/i })).toBeTruthy()
  })

  it('no ← Cue or Cue → buttons appear on the non-video armed screen', async () => {
    setupControlViewWithReadinessPassing()
    render(<App initialHash="#/" />)

    await waitFor(() => {
      expect(screen.getByTestId('performance-state-label').textContent).toBe('Performance: Ready to Arm')
    }, { timeout: WAIT_TIMEOUT })
    await act(async () => {
      fireEvent.click(getArmButton())
    })

    expect(screen.queryByText(/← cue/i)).toBeNull()
    expect(screen.queryByText(/cue →/i)).toBeNull()
  })

  it('P5: the pulse runs on arm while the transport stays idle until the bottom-bar Start, and there is NO standalone Pause / restart-beat overlay trio', async () => {
    // Set up a library with a song that has tempo
    const songWithTempo = {
      id: 'duelo',
      title: 'Duelo',
      items: VALID_LINES,
      tempo: { bpm: 120, numerator: 4, denominator: 4, countInBars: 1 },
    }
    const snapshot = createInitialSnapshot([songWithTempo, { id: 'pimiento', title: 'Pimiento', items: VALID_LINES }])
    saveSetlistStore(snapshot)
    setCurrentSongId('duelo')

    setupControlViewWithReadinessPassing()
    render(<App initialHash="#/" />)

    await waitFor(() => {
      expect(screen.getByTestId('performance-state-label').textContent).toBe('Performance: Ready to Arm')
    }, { timeout: WAIT_TIMEOUT })
    await act(async () => {
      fireEvent.click(getArmButton())
    })

    vi.useFakeTimers()
    act(() => { vi.advanceTimersByTime(5000) })
    vi.useRealTimers()

    // P5 (amends the pre-P5 "no beat circle on arm" assertion): the pulse is a click track the
    // performer plays to, so it free-runs from Arm — but as a plain click, not a count-in, and
    // the transport is still idle. The count-in only exists once Start is pressed.
    expect(screen.getByTestId('beat-circle')).toBeTruthy()
    expect(screen.getByTestId('beat-circle-running')).toBeTruthy()
    expect(screen.queryByTestId('beat-circle-count-in')).toBeNull()
    // R2: the pre-count-in control is the bottom-bar Start button (relabelled Restart).
    expect(screen.getByRole('button', { name: /^start$/i })).toBeTruthy()
    // But there is still NO standalone Pause / dedicated beat-restart control overlaying phrases.
    expect(screen.queryByRole('button', { name: /^pause$/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /restart beat/i })).toBeNull()
  })

  it('BeatCircle is NOT rendered when the loaded song has no tempo (and there is no Start button)', async () => {
    // Standard library (no tempo on songs)
    setupControlViewWithReadinessPassing()
    render(<App initialHash="#/" />)

    await waitFor(() => {
      expect(screen.getByTestId('performance-state-label').textContent).toBe('Performance: Ready to Arm')
    }, { timeout: WAIT_TIMEOUT })
    await act(async () => {
      fireEvent.click(getArmButton())
    })

    expect(screen.queryByTestId('beat-circle')).toBeNull()
    expect(screen.queryByRole('button', { name: /^start$/i })).toBeNull()
  })

  it('R2: Start begins the beat clock (before any lyric) and BeatCircle appears and keeps ticking (Luz y sal repro)', async () => {
    // Repro for Luz y sal: tempo present, no media. R2: the beat clock is started by the
    // explicit Start step (a count-in bar BEFORE the first lyric), then must keep ticking
    // (not just render once and freeze). The first Next reveals line 0 with the beat already
    // running.
    const songWithTempo = {
      id: 'luz-y-sal',
      title: 'Luz y sal',
      items: VALID_LINES,
      tempo: { bpm: 140, numerator: 3, denominator: 4, countInBars: 1 },
    }
    saveSetlistStore(createInitialSnapshot([songWithTempo]))
    setupControlViewWithReadinessPassing()
    setCurrentSongId('luz-y-sal')
    render(<App initialHash="#/" />)

    await waitFor(() => {
      expect(screen.getByTestId('performance-state-label').textContent).toBe('Performance: Ready to Arm')
    }, { timeout: WAIT_TIMEOUT })
    await act(async () => {
      fireEvent.click(getArmButton())
    })

    // Transport idle before Start: the P5 pulse is running as a plain click (no count-in), and
    // Next is disabled (the count-in must run first).
    expect(screen.queryByTestId('beat-circle-count-in')).toBeNull()
    expect((screen.getByRole('button', { name: /^next$/i }) as HTMLButtonElement).disabled).toBe(true)

    // Press Start → the count-in begins, still no lyric.
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^start$/i }))
    })
    expect(getSongIndex()).toBe(-1)
    await waitFor(() => {
      expect(screen.getByTestId('beat-circle-count-in')).toBeTruthy()
    }, { timeout: WAIT_TIMEOUT })

    // First Next now reveals line 0 (beat already running).
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^next$/i }))
    })
    expect(getSongIndex()).toBe(0)

    vi.useFakeTimers()
    // Advance well past the single count-in bar (3 beats at 140bpm ≈ 1286ms) so the
    // clock must have ticked many times via setInterval, not just the initial sync tick().
    act(() => { vi.advanceTimersByTime(5000) })
    vi.useRealTimers()

    // Still visible — this is the regression: it must not disappear or freeze.
    expect(screen.getByTestId('beat-circle')).toBeTruthy()
  })

  it('subsequent Next presses advance lyrics without stopping the beat clock', async () => {
    const songWithTempo = {
      id: 'duelo',
      title: 'Duelo',
      items: VALID_LINES,
      tempo: { bpm: 120, numerator: 4, denominator: 4, countInBars: 1 },
    }
    saveSetlistStore(createInitialSnapshot([songWithTempo]))
    setupControlViewWithReadinessPassing()
    setCurrentSongId('duelo')
    render(<App initialHash="#/" />)

    await waitFor(() => {
      expect(screen.getByTestId('performance-state-label').textContent).toBe('Performance: Ready to Arm')
    }, { timeout: WAIT_TIMEOUT })
    await act(async () => {
      fireEvent.click(getArmButton())
    })

    // R2: Start begins the beat (count-in), then the first Next reveals line 0.
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^start$/i }))
    })
    expect(screen.getByTestId('beat-circle')).toBeTruthy()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^next$/i }))
    })
    expect(getSongIndex()).toBe(0)
    expect(screen.getByTestId('beat-circle')).toBeTruthy()

    // Second Next advances to line 1; the beat clock keeps running (circle still present).
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^next$/i }))
    })
    expect(getSongIndex()).toBe(1)
    expect(screen.getByTestId('beat-circle')).toBeTruthy()
  })

  it('R2: the bottom-bar Start button begins the beat clock and then becomes Restart', async () => {
    const songWithTempo = {
      id: 'duelo',
      title: 'Duelo',
      items: VALID_LINES,
      tempo: { bpm: 120, numerator: 4, denominator: 4, countInBars: 1 },
    }
    saveSetlistStore(createInitialSnapshot([songWithTempo]))
    setupControlViewWithReadinessPassing()
    setCurrentSongId('duelo')
    render(<App initialHash="#/" />)

    await waitFor(() => {
      expect(screen.getByTestId('performance-state-label').textContent).toBe('Performance: Ready to Arm')
    }, { timeout: WAIT_TIMEOUT })
    await act(async () => {
      fireEvent.click(getArmButton())
    })

    // Transport idle after arm — the P5 pulse runs but no count-in has begun, and the
    // pre-count-in control is Start (not Restart).
    expect(screen.queryByTestId('beat-circle-count-in')).toBeNull()
    expect(screen.queryByRole('button', { name: /^restart$/i })).toBeNull()

    // Start (plain click) begins the beat clock.
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^start$/i }))
    })
    await waitFor(() => {
      expect(screen.getByTestId('beat-circle')).toBeTruthy()
    }, { timeout: WAIT_TIMEOUT })

    // Once started, the same button becomes Restart (Start is gone).
    expect(screen.getByRole('button', { name: /^restart$/i })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^start$/i })).toBeNull()
  })
})

describe('§6 Projection display-format toggle (Big/Small)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearStorage()
  })

  afterEach(() => {
    vi.useRealTimers()
    cleanup()
    delete (window as unknown as { electronAPI?: unknown }).electronAPI
  })

  function setupWithVideoSong() {
    const songWithVideo = {
      id: 'duelo',
      title: 'Duelo',
      items: VALID_LINES,
      media: { type: 'video' as const, src: 'test.mp4' },
      timeline: [{ start: 0, end: 1 }, { start: 1, end: 2 }],
    }
    saveSetlistStore(createInitialSnapshot([songWithVideo]))
    localStorage.setItem(MEDIA_PATH_STORE_KEY, JSON.stringify({ 'test.mp4': '/fake/path/test.mp4' }))
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

  function setupWithPlainSong() {
    const plainSong = {
      id: 'duelo',
      title: 'Duelo',
      items: VALID_LINES,
    }
    saveSetlistStore(createInitialSnapshot([plainSong]))
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

  it('shows the Videoclip segmented control in Projection row when song has a video, defaulting to No video', async () => {
    setupWithVideoSong()
    render(<App initialHash="#/" />)

    await waitFor(() => {
      expect(screen.getByTestId('performance-state-label').textContent).toMatch(/Ready to Arm|Setup/)
    }, { timeout: WAIT_TIMEOUT })

    const projectionSection = Array.from(document.querySelectorAll('.control-setup-section'))
      .find((s) => s.querySelector('.control-setup-label')?.textContent === 'Projection')
    expect(projectionSection).toBeTruthy()
    // Default mode is None — the segment is active.
    const noneBtn = within(projectionSection as HTMLElement).getByRole('button', { name: 'No video' })
    expect(noneBtn).toBeTruthy()
    expect(noneBtn.getAttribute('aria-pressed')).toBe('true')
    expect(within(projectionSection as HTMLElement).getByRole('button', { name: 'Small screen' })).toBeTruthy()
    expect(within(projectionSection as HTMLElement).getByRole('button', { name: 'Big screen' })).toBeTruthy()
  })

  it('does not show the Videoclip toggle when song has no video', async () => {
    setupWithPlainSong()
    render(<App initialHash="#/" />)

    await waitFor(() => {
      expect(screen.getByTestId('performance-state-label').textContent).toMatch(/Ready to Arm|Setup/)
    }, { timeout: WAIT_TIMEOUT })

    expect(screen.queryByRole('button', { name: 'Small screen' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Big screen' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'No video' })).toBeNull()
  })

  it('selecting Small then Big directly activates the matching profile and stores the matching screen size', async () => {
    setupWithVideoSong()
    render(<App initialHash="#/" />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'No video' })).toBeTruthy()
    }, { timeout: WAIT_TIMEOUT })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Small screen' }))
    })
    expect(sessionStorage.getItem('liveLyricScreenSize')).toBe('small')
    expect(screen.getByRole('button', { name: 'Small screen' }).getAttribute('aria-pressed')).toBe('true')

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Big screen' }))
    })

    expect(localStorage.getItem(DISPLAY_PROFILE_STORAGE_KEY)).toBe('big-screen')
    expect(sessionStorage.getItem('liveLyricScreenSize')).toBe('big')
    expect(screen.getByRole('button', { name: 'Big screen' }).getAttribute('aria-pressed')).toBe('true')
  })

  it('default (No video segment active, no click) still activates small-canvas profile via the legacy screen-size default', async () => {
    setupWithVideoSong()
    render(<App initialHash="#/" />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'No video' })).toBeTruthy()
    }, { timeout: WAIT_TIMEOUT })

    await waitFor(() => {
      expect(localStorage.getItem(DISPLAY_PROFILE_STORAGE_KEY)).toBe('small-canvas')
    }, { timeout: WAIT_TIMEOUT })
  })

  it('does not render the old Display profile row (ctrl-display-row) with a video song', async () => {
    setupWithVideoSong()
    render(<App initialHash="#/" />)

    await waitFor(() => {
      expect(screen.getByTestId('performance-state-label').textContent).toMatch(/Ready to Arm|Setup/)
    }, { timeout: WAIT_TIMEOUT })

    expect(document.querySelector('.ctrl-display-row')).toBeNull()
  })

  it('does not render the old Display profile row (ctrl-display-row) with a plain song', async () => {
    setupWithPlainSong()
    render(<App initialHash="#/" />)

    await waitFor(() => {
      expect(screen.getByTestId('performance-state-label').textContent).toMatch(/Ready to Arm|Setup/)
    }, { timeout: WAIT_TIMEOUT })

    expect(document.querySelector('.ctrl-display-row')).toBeNull()
  })

  // §10 — segmented control, all three options always visible, direct selection
  it('the No video segment is active by default when song has a video and no mode stored, and Small/Big are present but inactive', async () => {
    setupWithVideoSong()
    sessionStorage.removeItem('liveLyricDisplayMode')
    render(<App initialHash="#/" />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'No video' })).toBeTruthy()
    }, { timeout: WAIT_TIMEOUT })

    expect(screen.getByRole('button', { name: 'No video' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: 'Small screen' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Small screen' }).getAttribute('aria-pressed')).toBe('false')
    expect(screen.getByRole('button', { name: 'Big screen' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Big screen' }).getAttribute('aria-pressed')).toBe('false')
  })

  it('clicking the Small screen segment selects Small directly', async () => {
    setupWithVideoSong()
    sessionStorage.removeItem('liveLyricDisplayMode')
    render(<App initialHash="#/" />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'No video' })).toBeTruthy()
    }, { timeout: WAIT_TIMEOUT })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Small screen' }))
    })

    expect(screen.getByRole('button', { name: 'Small screen' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: 'No video' }).getAttribute('aria-pressed')).toBe('false')
  })

  it('starting from a stored Big mode, clicking No video selects None directly, and a further click on Small selects Small directly', async () => {
    setupWithVideoSong()
    sessionStorage.setItem('liveLyricDisplayMode', 'big')
    render(<App initialHash="#/" />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Big screen' }).getAttribute('aria-pressed')).toBe('true')
    }, { timeout: WAIT_TIMEOUT })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'No video' }))
    })

    expect(screen.getByRole('button', { name: 'No video' }).getAttribute('aria-pressed')).toBe('true')

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Small screen' }))
    })

    expect(screen.getByRole('button', { name: 'Small screen' }).getAttribute('aria-pressed')).toBe('true')
  })

  it('activates small-canvas profile by default when song has a video and no size stored (Videoclip segment still defaults to No video)', async () => {
    setupWithVideoSong()
    sessionStorage.removeItem('liveLyricScreenSize')
    localStorage.removeItem(DISPLAY_PROFILE_STORAGE_KEY)
    render(<App initialHash="#/" />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'No video' })).toBeTruthy()
    }, { timeout: WAIT_TIMEOUT })

    await waitFor(() => {
      expect(localStorage.getItem(DISPLAY_PROFILE_STORAGE_KEY)).toBe('small-canvas')
    }, { timeout: WAIT_TIMEOUT })
  })
})

describe('§17 C2 — Projection status text ignores leftover screenSize for non-video songs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearStorage()
  })

  afterEach(() => {
    vi.useRealTimers()
    cleanup()
    delete (window as unknown as { electronAPI?: unknown }).electronAPI
  })

  function setupWithVideoSong() {
    const songWithVideo = {
      id: 'duelo',
      title: 'Duelo',
      items: VALID_LINES,
      media: { type: 'video' as const, src: 'test.mp4' },
      timeline: [{ start: 0, end: 1 }, { start: 1, end: 2 }],
    }
    saveSetlistStore(createInitialSnapshot([songWithVideo]))
    localStorage.setItem(MEDIA_PATH_STORE_KEY, JSON.stringify({ 'test.mp4': '/fake/path/test.mp4' }))
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

  /** Plain (non-video) song, but with a 'big' screenSize left over in sessionStorage from an
   * earlier video song selected this same session (§C2 repro — see coordinator's root cause). */
  function setupWithPlainSongAndLeftoverBigScreenSize() {
    const plainSong = {
      id: 'duelo',
      title: 'Duelo',
      items: VALID_LINES,
      tempo: { bpm: 140, numerator: 3, denominator: 4, countInBars: 1 },
    }
    saveSetlistStore(createInitialSnapshot([plainSong]))
    sessionStorage.setItem('liveLyricLaunched', '1')
    sessionStorage.removeItem('liveLyricPerformanceArmed')
    sessionStorage.setItem('liveLyricScreenSize', 'big')
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

  function getProjectionSetupValueText(): string | null | undefined {
    const projectionSection = Array.from(document.querySelectorAll('.control-setup-section'))
      .find((s) => s.querySelector('.control-setup-label')?.textContent === 'Projection')
    return projectionSection?.querySelector('.control-setup-value')?.textContent
  }

  it('C2: setup-panel Projection value reads exactly "Open" for a non-video song, even with a leftover big screenSize', async () => {
    setupWithPlainSongAndLeftoverBigScreenSize()
    render(<App initialHash="#/" />)

    await waitFor(() => {
      expect(screen.getByTestId('performance-state-label').textContent).toMatch(/Ready to Arm|Setup/)
    }, { timeout: WAIT_TIMEOUT })

    expect(getProjectionSetupValueText()).toBe('Open')
  })

  it('C2: header Projection summary reads exactly "Projection: Open" for a non-video song when armed, even with a leftover big screenSize', async () => {
    setupWithPlainSongAndLeftoverBigScreenSize()
    render(<App initialHash="#/" />)

    await waitFor(() => {
      expect(screen.getByTestId('performance-state-label').textContent).toBe('Performance: Ready to Arm')
    }, { timeout: WAIT_TIMEOUT })
    await act(async () => {
      fireEvent.click(getArmButton())
    })

    const header = screen.getByRole('banner')
    const projectionLine = Array.from(header.querySelectorAll('.top-summary-line'))
      .find((s) => s.textContent?.startsWith('Projection:'))
    expect(projectionLine?.textContent).toBe('Projection: Open')
  })

  it('C2 regression: setup-panel Projection value still reads "Open, Big"/"Open, Small" for a video song once selected (default is "Open, No video")', async () => {
    setupWithVideoSong()
    render(<App initialHash="#/" />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'No video' })).toBeTruthy()
    }, { timeout: WAIT_TIMEOUT })

    expect(getProjectionSetupValueText()).toBe('Open, No video')

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Small screen' }))
    })

    expect(getProjectionSetupValueText()).toBe('Open, Small')

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Big screen' }))
    })

    expect(getProjectionSetupValueText()).toBe('Open, Big')
  })
})

describe('§5 video armed screen — End Card absent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearStorage()
  })

  afterEach(() => {
    vi.useRealTimers()
    cleanup()
    delete (window as unknown as { electronAPI?: unknown }).electronAPI
  })

  it('End Card button is NOT rendered in the video armed screen', async () => {
    // Set up a library with a song that has a video
    const { MEDIA_PATH_STORE_KEY } = await import('./mediaPathStore')
    const songWithVideo = {
      id: 'duelo',
      title: 'Duelo',
      items: VALID_LINES,
      media: { type: 'video' as const, src: 'test.mp4' },
      timeline: [{ start: 0, end: 1 }, { start: 1, end: 2 }],
    }
    saveSetlistStore(createInitialSnapshot([songWithVideo]))
    // Provide a resolved path so the panel renders with video
    localStorage.setItem(MEDIA_PATH_STORE_KEY, JSON.stringify({ 'test.mp4': '/fake/path/test.mp4' }))

    setupControlViewWithReadinessPassing()
    // Override the song state to use the video song
    setSongLines(VALID_LINES)
    setCurrentSongId('duelo')

    render(<App initialHash="#/" />)

    await waitFor(() => {
      expect(screen.getByTestId('performance-state-label').textContent).toBe('Performance: Ready to Arm')
    }, { timeout: WAIT_TIMEOUT })
    // Videoclip defaults to None — select Small screen so the video performance panel
    // actually renders once armed.
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Small screen' }))
    })
    await act(async () => {
      fireEvent.click(getArmButton())
    })

    // Video armed screen should NOT have End Card
    expect(screen.queryByRole('button', { name: /end card/i })).toBeNull()
  })

  it('Previous / Next / Restart are NOT in the video armed screen (video controls are Play/Pause/Restart/Unarm)', async () => {
    const { MEDIA_PATH_STORE_KEY } = await import('./mediaPathStore')
    const songWithVideo = {
      id: 'duelo',
      title: 'Duelo',
      items: VALID_LINES,
      media: { type: 'video' as const, src: 'test.mp4' },
      timeline: [{ start: 0, end: 1 }, { start: 1, end: 2 }],
    }
    saveSetlistStore(createInitialSnapshot([songWithVideo]))
    localStorage.setItem(MEDIA_PATH_STORE_KEY, JSON.stringify({ 'test.mp4': '/fake/path/test.mp4' }))

    setupControlViewWithReadinessPassing()
    setSongLines(VALID_LINES)
    setCurrentSongId('duelo')

    render(<App initialHash="#/" />)

    await waitFor(() => {
      expect(screen.getByTestId('performance-state-label').textContent).toBe('Performance: Ready to Arm')
    }, { timeout: WAIT_TIMEOUT })
    // Videoclip defaults to None — select Small screen so the video performance panel
    // actually renders once armed.
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Small screen' }))
    })
    await act(async () => {
      fireEvent.click(getArmButton())
    })

    // Video screen has Restart (but not Previous/Next)
    expect(screen.queryByRole('button', { name: /^previous$/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /^next$/i })).toBeNull()
    // Play, Pause, Restart, Unarm should be present
    expect(screen.getByRole('button', { name: /^play$/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /^pause$/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /^restart$/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /^unarm$/i })).toBeTruthy()
  })
})


describe('§13 Display mode: None/Small/Big 3-way toggle', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearStorage()
    clearStoredDisplayMode()
  })

  afterEach(() => {
    vi.useRealTimers()
    cleanup()
    delete (window as unknown as { electronAPI?: unknown }).electronAPI
  })

  function setupWithVideoSong13() {
    const songWithVideo = {
      id: 'duelo',
      title: 'Duelo',
      items: VALID_LINES,
      media: { type: 'video' as const, src: 'test.mp4' },
      timeline: [{ start: 0, end: 1 }, { start: 1, end: 2 }],
    }
    saveSetlistStore(createInitialSnapshot([songWithVideo]))
    localStorage.setItem(MEDIA_PATH_STORE_KEY, JSON.stringify({ 'test.mp4': '/fake/path/test.mp4' }))
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

  function setupWithPlainSong13() {
    const plainSong = {
      id: 'duelo',
      title: 'Duelo',
      items: VALID_LINES,
    }
    saveSetlistStore(createInitialSnapshot([plainSong]))
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

  it('T1: shows a "Videoclip" label above the display-mode toggle for a video song', async () => {
    setupWithVideoSong13()
    render(<App initialHash="#/" />)

    await waitFor(() => {
      expect(screen.getByTestId('performance-state-label').textContent).toMatch(/Ready to Arm|Setup/)
    }, { timeout: WAIT_TIMEOUT })

    expect(screen.getByText('Videoclip')).toBeTruthy()
  })

  it('the Videoclip segmented control renders text labels (None/Small/Big) for all three segments, not SVG icons', async () => {
    setupWithVideoSong13()
    render(<App initialHash="#/" />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'No video' })).toBeTruthy()
    }, { timeout: WAIT_TIMEOUT })

    const noneBtn = screen.getByRole('button', { name: 'No video' })
    expect(noneBtn.textContent).toBe('None')
    expect(noneBtn.querySelector('svg')).toBeNull()

    const smallBtn = screen.getByRole('button', { name: 'Small screen' })
    expect(smallBtn.textContent).toBe('Small')
    expect(smallBtn.querySelector('svg')).toBeNull()

    const bigBtn = screen.getByRole('button', { name: 'Big screen' })
    expect(bigBtn.textContent).toBe('Big')
    expect(bigBtn.querySelector('svg')).toBeNull()
  })

  it('T1: does NOT show a "Videoclip" label for a plain (non-video) song', async () => {
    setupWithPlainSong13()
    render(<App initialHash="#/" />)

    await waitFor(() => {
      expect(screen.getByTestId('performance-state-label').textContent).toMatch(/Ready to Arm|Setup/)
    }, { timeout: WAIT_TIMEOUT })

    expect(screen.queryByText('Videoclip')).toBeNull()
  })

  it('renders all three Videoclip segments together (None active by default) when song has a video', async () => {
    setupWithVideoSong13()
    render(<App initialHash="#/" />)

    await waitFor(() => {
      expect(screen.getByTestId('performance-state-label').textContent).toMatch(/Ready to Arm|Setup/)
    }, { timeout: WAIT_TIMEOUT })

    expect(screen.getByRole('button', { name: 'No video' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: 'Small screen' }).getAttribute('aria-pressed')).toBe('false')
    expect(screen.getByRole('button', { name: 'Big screen' }).getAttribute('aria-pressed')).toBe('false')
  })

  it('does NOT render the Videoclip toggle when song has no video', async () => {
    setupWithPlainSong13()
    render(<App initialHash="#/" />)

    await waitFor(() => {
      expect(screen.getByTestId('performance-state-label').textContent).toMatch(/Ready to Arm|Setup/)
    }, { timeout: WAIT_TIMEOUT })

    expect(screen.queryByRole('button', { name: 'No video' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Small screen' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Big screen' })).toBeNull()
  })

  it('default is None for a video song with no mode stored', async () => {
    setupWithVideoSong13()
    sessionStorage.removeItem('liveLyricDisplayMode')
    render(<App initialHash="#/" />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'No video' }).getAttribute('aria-pressed')).toBe('true')
    }, { timeout: WAIT_TIMEOUT })
  })

  it('clicking Small then Big then No video selects each mode directly, one click each', async () => {
    setupWithVideoSong13()
    render(<App initialHash="#/" />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'No video' })).toBeTruthy()
    }, { timeout: WAIT_TIMEOUT })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Small screen' }))
    })
    expect(screen.getByRole('button', { name: 'Small screen' }).getAttribute('aria-pressed')).toBe('true')

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Big screen' }))
    })
    expect(screen.getByRole('button', { name: 'Big screen' }).getAttribute('aria-pressed')).toBe('true')

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'No video' }))
    })
    expect(screen.getByRole('button', { name: 'No video' }).getAttribute('aria-pressed')).toBe('true')
  })

  it('clicking No video while on Big stores display mode "none" in sessionStorage', async () => {
    setupWithVideoSong13()
    sessionStorage.setItem('liveLyricDisplayMode', 'big')
    render(<App initialHash="#/" />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Big screen' }).getAttribute('aria-pressed')).toBe('true')
    }, { timeout: WAIT_TIMEOUT })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'No video' }))
    })

    expect(sessionStorage.getItem('liveLyricDisplayMode')).toBe('none')
  })

  it('default screen-size profile (small-canvas) activates without any click, even though the Videoclip segment defaults to None', async () => {
    setupWithVideoSong13()
    render(<App initialHash="#/" />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'No video' })).toBeTruthy()
    }, { timeout: WAIT_TIMEOUT })

    await waitFor(() => {
      expect(localStorage.getItem(DISPLAY_PROFILE_STORAGE_KEY)).toBe('small-canvas')
    }, { timeout: WAIT_TIMEOUT })
  })

  it('selecting Small directly stores display mode "small" and activates small-canvas profile', async () => {
    setupWithVideoSong13()
    render(<App initialHash="#/" />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'No video' })).toBeTruthy()
    }, { timeout: WAIT_TIMEOUT })

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Small screen' })) })

    expect(screen.getByRole('button', { name: 'Small screen' }).getAttribute('aria-pressed')).toBe('true')
    expect(sessionStorage.getItem('liveLyricDisplayMode')).toBe('small')
    expect(localStorage.getItem(DISPLAY_PROFILE_STORAGE_KEY)).toBe('small-canvas')
  })

  it('clicking Big while on Small switches to Big and activates big-screen profile', async () => {
    setupWithVideoSong13()
    sessionStorage.setItem('liveLyricDisplayMode', 'small')
    render(<App initialHash="#/" />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Small screen' }).getAttribute('aria-pressed')).toBe('true')
    }, { timeout: WAIT_TIMEOUT })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Big screen' }))
    })

    expect(sessionStorage.getItem('liveLyricDisplayMode')).toBe('big')
    expect(localStorage.getItem(DISPLAY_PROFILE_STORAGE_KEY)).toBe('big-screen')
  })

  // §13.GREEN — active segment carries the --active (green) class; inactive segments do not
  it('the active segment carries ctrl-segment--active for Small/Big/None depending on selection', async () => {
    setupWithVideoSong13()
    sessionStorage.removeItem('liveLyricDisplayMode')
    render(<App initialHash="#/" />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'No video' })).toBeTruthy()
    }, { timeout: WAIT_TIMEOUT })

    // Default is None — selected/green; Small/Big are not.
    expect(screen.getByRole('button', { name: 'No video' }).classList.contains('ctrl-segment--active')).toBe(true)
    expect(screen.getByRole('button', { name: 'Small screen' }).classList.contains('ctrl-segment--active')).toBe(false)

    // Click Small screen — selected/green.
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Small screen' }))
    })
    expect(screen.getByRole('button', { name: 'Small screen' }).classList.contains('ctrl-segment--active')).toBe(true)
    expect(screen.getByRole('button', { name: 'No video' }).classList.contains('ctrl-segment--active')).toBe(false)

    // Click Big screen — still selected/green.
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Big screen' }))
    })
    expect(screen.getByRole('button', { name: 'Big screen' }).classList.contains('ctrl-segment--active')).toBe(true)
    expect(screen.getByRole('button', { name: 'Small screen' }).classList.contains('ctrl-segment--active')).toBe(false)

    // Click No video — no longer selected/green on Big.
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'No video' }))
    })
    expect(screen.getByRole('button', { name: 'No video' }).classList.contains('ctrl-segment--active')).toBe(true)
    expect(screen.getByRole('button', { name: 'Big screen' }).classList.contains('ctrl-segment--active')).toBe(false)
  })
})

describe('§A1 Display mode broadcast resync at session start (fixes stale-broadcast bug)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearStorage()
    clearStoredDisplayMode()
  })

  afterEach(() => {
    vi.useRealTimers()
    cleanup()
    delete (window as unknown as { electronAPI?: unknown }).electronAPI
  })

  function setupWithVideoSongA1() {
    const songWithVideo = {
      id: 'duelo',
      title: 'Duelo',
      items: VALID_LINES,
      media: { type: 'video' as const, src: 'test.mp4' },
      timeline: [{ start: 0, end: 1 }, { start: 1, end: 2 }],
    }
    saveSetlistStore(createInitialSnapshot([songWithVideo]))
    localStorage.setItem(MEDIA_PATH_STORE_KEY, JSON.stringify({ 'test.mp4': '/fake/path/test.mp4' }))
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

  function setupWithPlainSongA1() {
    const plainSong = {
      id: 'duelo',
      title: 'Duelo',
      items: VALID_LINES,
    }
    saveSetlistStore(createInitialSnapshot([plainSong]))
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

  it('a stale "big" broadcast left over from a previous session is overwritten with the fresh session default ("none") for a video song', async () => {
    // The default display mode is now always 'none' (Videoclip toggle opt-in), so a fresh
    // launch (no sessionStorage selection yet) for a video song must resync a stale
    // leftover broadcast value down to 'none', matching the freshly computed default.
    localStorage.setItem(KEY_DISPLAY_MODE_BROADCAST, 'big')
    setupWithVideoSongA1()

    render(<App initialHash="#/" />)

    await waitFor(() => {
      expect(screen.getByTestId('performance-state-label').textContent).toMatch(/Ready to Arm|Setup/)
    }, { timeout: WAIT_TIMEOUT })

    await waitFor(() => {
      expect(localStorage.getItem(KEY_DISPLAY_MODE_BROADCAST)).toBe('none')
    }, { timeout: WAIT_TIMEOUT })
  })

  it('a stale "small" broadcast left over from a previous session is overwritten with "none" for a non-video song', async () => {
    localStorage.setItem(KEY_DISPLAY_MODE_BROADCAST, 'small')
    setupWithPlainSongA1()

    render(<App initialHash="#/" />)

    await waitFor(() => {
      expect(screen.getByTestId('performance-state-label').textContent).toMatch(/Ready to Arm|Setup/)
    }, { timeout: WAIT_TIMEOUT })

    await waitFor(() => {
      expect(localStorage.getItem(KEY_DISPLAY_MODE_BROADCAST)).toBe('none')
    }, { timeout: WAIT_TIMEOUT })
  })

  it('toggle clicks still update the broadcast as before (regression guard)', async () => {
    setupWithVideoSongA1()
    render(<App initialHash="#/" />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'No video' })).toBeTruthy()
    }, { timeout: WAIT_TIMEOUT })

    await waitFor(() => {
      expect(localStorage.getItem(KEY_DISPLAY_MODE_BROADCAST)).toBe('none')
    }, { timeout: WAIT_TIMEOUT })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Small screen' }))
    })

    expect(localStorage.getItem(KEY_DISPLAY_MODE_BROADCAST)).toBe('small')
  })
})

describe('§16 A2.2 — video song armed with display mode "none" behaves like a non-video song (performer view)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearStorage()
    clearStoredDisplayMode()
  })

  afterEach(() => {
    vi.useRealTimers()
    cleanup()
    delete (window as unknown as { electronAPI?: unknown }).electronAPI
  })

  function setupWithVideoSongDisplayNone() {
    const songWithVideo = {
      id: 'duelo',
      title: 'Duelo',
      items: VALID_LINES,
      media: { type: 'video' as const, src: 'test.mp4' },
      timeline: [{ start: 0, end: 1 }, { start: 1, end: 2 }],
    }
    saveSetlistStore(createInitialSnapshot([songWithVideo]))
    localStorage.setItem(MEDIA_PATH_STORE_KEY, JSON.stringify({ 'test.mp4': '/fake/path/test.mp4' }))
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

  it('performer view shows manual (non-video) flow, not VideoPerformancePanel, when armed with display mode None (default)', async () => {
    setupWithVideoSongDisplayNone()
    render(<App initialHash="#/" />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'No video' })).toBeTruthy()
    }, { timeout: WAIT_TIMEOUT })

    // This timeline song defaults to Auto; select the Manual segment so we exercise the
    // manual (non-video) performer flow with Next/Previous (T2: Auto would show
    // Play/Pause transport instead).
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Manual' }))
    })

    await waitFor(() => {
      expect(screen.getByTestId('performance-state-label').textContent).toBe('Performance: Ready to Arm')
    }, { timeout: WAIT_TIMEOUT })
    await act(async () => {
      fireEvent.click(getArmButton())
    })

    // Manual performer stage present (non-video path)
    expect(screen.getByTestId('performing-content')).toBeTruthy()
    // Video performance panel controls must be absent
    expect(screen.queryByTestId('video-perf-no-path')).toBeNull()
    // Manual Next/Previous/Restart present
    expect(screen.getByRole('button', { name: /^next$/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /^previous$/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /^restart$/i })).toBeTruthy()
  })

  it('performer view shows VideoPerformancePanel (not manual flow) when the video song has display mode Small (explicitly selected)', async () => {
    setupWithVideoSongDisplayNone()
    render(<App initialHash="#/" />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'No video' })).toBeTruthy()
    }, { timeout: WAIT_TIMEOUT })

    // Videoclip defaults to None — select Small screen directly.
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Small screen' }))
    })
    expect(screen.getByRole('button', { name: 'Small screen' }).getAttribute('aria-pressed')).toBe('true')

    await waitFor(() => {
      expect(screen.getByTestId('performance-state-label').textContent).toBe('Performance: Ready to Arm')
    }, { timeout: WAIT_TIMEOUT })
    await act(async () => {
      fireEvent.click(getArmButton())
    })

    expect(screen.getByRole('button', { name: /^play$/i })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^next$/i })).toBeNull()
  })
})

describe('§P14 Manual/Auto lyric-advance toggle', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearStorage()
  })

  afterEach(() => {
    vi.useRealTimers()
    cleanup()
    delete (window as unknown as { electronAPI?: unknown }).electronAPI
  })

  function setupWithTimelineSong() {
    const songWithTimeline = {
      id: 'duelo',
      title: 'Duelo',
      items: VALID_LINES,
      tempo: { bpm: 120, numerator: 4, denominator: 4, countInBars: 1 },
      // 120bpm, 1 bar count-in (4 beats) -> begin fires at 2000ms.
      // Line 0 covers [0, 2)s of song time, line 1 covers [2, 100)s.
      timeline: [{ start: 0, end: 2 }, { start: 2, end: 100 }],
    }
    saveSetlistStore(createInitialSnapshot([songWithTimeline]))
    setupControlViewWithReadinessPassing()
    setCurrentSongId('duelo')
  }

  function setupWithNoTimelineSong() {
    const songNoTimeline = {
      id: 'duelo',
      title: 'Duelo',
      items: VALID_LINES,
      tempo: { bpm: 120, numerator: 4, denominator: 4, countInBars: 1 },
    }
    saveSetlistStore(createInitialSnapshot([songNoTimeline]))
    setupControlViewWithReadinessPassing()
    setCurrentSongId('duelo')
  }

  /** C1: neither tempo nor timeline — the Transitions toggle must stay absent entirely. */
  function setupWithNeitherTempoNorTimelineSong() {
    const plainSong = {
      id: 'duelo',
      title: 'Duelo',
      items: VALID_LINES,
    }
    saveSetlistStore(createInitialSnapshot([plainSong]))
    setupControlViewWithReadinessPassing()
    setCurrentSongId('duelo')
  }

  async function armAndReachSetup() {
    render(<App initialHash="#/" />)
    await waitFor(() => {
      expect(screen.getByTestId('performance-state-label').textContent).toMatch(/Ready to Arm|Setup/)
    }, { timeout: WAIT_TIMEOUT })
  }

  /**
   * Fake-timer-safe variant of armAndReachSetup: avoids RTL's `waitFor` (which polls via
   * setTimeout and hangs when fake timers are already active — the project convention seen
   * in VideoPerformancePanel.test.tsx is to flush microtasks directly instead). Callers must
   * have already called vi.useFakeTimers() before invoking this.
   */
  async function armAndReachSetupFakeTimers() {
    render(<App initialHash="#/" />)
    // isProjectionOpen() resolves a plain Promise (no real timers involved) — flush it.
    await act(async () => { await Promise.resolve() })
    await act(async () => { await Promise.resolve() })
  }

  it('renders the Transitions segmented control (Manual, Auto) in the setup screen when the song has a timeline', async () => {
    setupWithTimelineSong()
    await armAndReachSetup()

    // Defaults to Auto for a timeline song — both segments present, Auto active.
    expect(screen.getByRole('button', { name: 'Auto' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Manual' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Auto' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: 'Manual' }).getAttribute('aria-pressed')).toBe('false')
  })

  it('T1: shows a "Transitions" label above the advance-mode toggle for a timeline song', async () => {
    setupWithTimelineSong()
    await armAndReachSetup()

    expect(screen.getByText('Transitions')).toBeTruthy()
  })

  it('C1: DOES render the Transitions toggle for a song with tempo but no timeline (Auto unavailable, dimmed + disabled)', async () => {
    setupWithNoTimelineSong()
    await armAndReachSetup()

    // C1: a tempo-only song still gets the Transitions control so the performer can see it —
    // Auto genuinely needs a timeline, which this song doesn't have, so Manual is active/green
    // and Auto is dimmed and disabled, with a tooltip explaining why.
    const manualBtn = screen.getByRole('button', { name: 'Manual' }) as HTMLButtonElement
    expect(manualBtn).toBeTruthy()
    expect(manualBtn.getAttribute('aria-pressed')).toBe('true')

    const autoBtn = screen.getByRole('button', { name: 'Auto' }) as HTMLButtonElement
    expect(autoBtn).toBeTruthy()
    expect(autoBtn.getAttribute('aria-pressed')).toBe('false')
    expect(autoBtn.disabled).toBe(true)
    expect(autoBtn.title).toBe('Auto needs a timeline.')
  })

  it('C1: does NOT render the Transitions toggle when the song has neither tempo nor timeline', async () => {
    setupWithNeitherTempoNorTimelineSong()
    await armAndReachSetup()

    expect(screen.queryByRole('button', { name: 'Manual' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Auto' })).toBeNull()
    expect(screen.queryByText('Transitions')).toBeNull()
    expect(screen.queryByLabelText('Auto needs a timeline.')).toBeNull()
  })

  it('C1: clicking the disabled Auto segment on a tempo-no-timeline song does not switch to Auto (no-op)', async () => {
    setupWithNoTimelineSong()
    await armAndReachSetup()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Auto' }))
    })

    expect(screen.getByRole('button', { name: 'Manual' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: 'Auto' }).getAttribute('aria-pressed')).toBe('false')
  })

  it('defaults to Auto selected when the song has a non-empty timeline', async () => {
    setupWithTimelineSong()
    await armAndReachSetup()

    expect(screen.getByRole('button', { name: 'Auto' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: 'Manual' }).getAttribute('aria-pressed')).toBe('false')
  })

  it('clicking Manual switches selection to Manual even on a timeline song (default Auto)', async () => {
    setupWithTimelineSong()
    await armAndReachSetup()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Manual' }))
    })

    expect(screen.getByRole('button', { name: 'Manual' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: 'Auto' }).getAttribute('aria-pressed')).toBe('false')
  })

  it('the Transitions toggle renders text labels ("Auto"/"Manual"), not SVG icons', async () => {
    setupWithTimelineSong()
    await armAndReachSetup()

    const autoBtn = screen.getByRole('button', { name: 'Auto' })
    expect(autoBtn.textContent).toBe('Auto')
    expect(autoBtn.querySelector('svg')).toBeNull()

    const manualBtn = screen.getByRole('button', { name: 'Manual' })
    expect(manualBtn.textContent).toBe('Manual')
    expect(manualBtn.querySelector('svg')).toBeNull()
  })

  it('Manual mode (unchanged): first lyric only appears on explicit Next, and count-in alone does not advance', async () => {
    vi.useFakeTimers()
    setupWithTimelineSong()
    await armAndReachSetupFakeTimers()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Manual' }))
    })
    await act(async () => {
      fireEvent.click(getArmButton())
    })

    expect(getSongIndex()).toBe(-1)

    // R2: this tempo song shows the Start step; press Start to run the count-in.
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^start$/i }))
    })

    // Time passing alone (even past the count-in and both timeline windows) must not advance
    // the index in Manual mode.
    act(() => { vi.advanceTimersByTime(10_000) })
    expect(getSongIndex()).toBe(-1)

    // Only explicit Next advances.
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^next$/i }))
    })
    expect(getSongIndex()).toBe(0)

    act(() => { vi.advanceTimersByTime(10_000) })
    // Still 0 — Manual never auto-advances past the pressed Next.
    expect(getSongIndex()).toBe(0)
  })

  it('R2: Manual Start step — after arm Next/Previous are disabled and the button is Start; Start enables Next and becomes Restart; Restart returns to pre-Start', async () => {
    setupWithTimelineSong()
    await armAndReachSetup()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Manual' }))
    })
    await act(async () => {
      fireEvent.click(getArmButton())
    })

    // Pre-Start: Previous + Next disabled, third button is Start (no Restart yet).
    expect((screen.getByRole('button', { name: /^previous$/i }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: /^next$/i }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByRole('button', { name: /^start$/i })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^restart$/i })).toBeNull()

    // Start → count-in begins, Next enabled, no lyric yet, button becomes Restart.
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^start$/i }))
    })
    expect(getSongIndex()).toBe(-1)
    expect((screen.getByRole('button', { name: /^next$/i }) as HTMLButtonElement).disabled).toBe(false)
    expect(screen.getByRole('button', { name: /^restart$/i })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^start$/i })).toBeNull()

    // First Next reveals line 0 (beat already running).
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^next$/i }))
    })
    expect(getSongIndex()).toBe(0)

    // Restart (hold to confirm) returns to the pre-Start state: index -1, Next disabled, Start back.
    vi.useFakeTimers()
    const restartBtn = screen.getByRole('button', { name: /^restart$/i })
    await act(async () => { fireEvent.pointerDown(restartBtn) })
    act(() => { vi.advanceTimersByTime(HOLD_CONFIRM_MS) })
    await act(async () => { fireEvent.pointerUp(restartBtn) })
    vi.useRealTimers()

    expect(getSongIndex()).toBe(-1)
    expect(screen.getByRole('button', { name: /^start$/i })).toBeTruthy()
    expect((screen.getByRole('button', { name: /^next$/i }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('T2: Auto armed shows Play/Pause/Restart transport, not Previous/Next', async () => {
    setupWithTimelineSong()
    await armAndReachSetup()
    await act(async () => {
      fireEvent.click(getArmButton())
    })

    expect(screen.queryByRole('button', { name: /^previous$/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /^next$/i })).toBeNull()
    expect(screen.getByRole('button', { name: /^play$/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /^pause$/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /^restart$/i })).toBeTruthy()
  })

  it('T2: Auto mode — pressing Play (not Next) drives the lines automatically per the timeline', async () => {
    vi.useFakeTimers()
    setupWithTimelineSong()
    await armAndReachSetupFakeTimers()
    // Auto is already the default for this timeline song.
    await act(async () => {
      fireEvent.click(getArmButton())
    })

    // Before Play, nothing is showing (index -1).
    expect(getSongIndex()).toBe(-1)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^play$/i }))
    })

    // Count-in is 2000ms; a tick past it starts song time and the first cue [0,2)s → line 0.
    act(() => { vi.advanceTimersByTime(2000 + 100) })
    expect(getSongIndex()).toBe(0)

    // Into the second timeline window (>= 2s song time) → line 1.
    act(() => { vi.advanceTimersByTime(2500) })
    expect(getSongIndex()).toBe(1)
  })

  it('R1: Auto drive to the first cue un-blanks the shared (cross-window) state so the audience shows the lyric', async () => {
    // Regression: index/blank live in localStorage, which the Projection window re-reads on
    // every storage event. Auto used applyCommand('setIndex') whose computeNavigationState
    // branch PRESERVES the pre-Play blank (true), leaving blank=true in localStorage while the
    // WS broadcast said blank=false — the Projection read blank=true and stayed BLACK. The
    // fix writes blank=false for a real cue, matching manual Next.
    vi.useFakeTimers()
    setupWithTimelineSong()
    await armAndReachSetupFakeTimers()
    await act(async () => {
      fireEvent.click(getArmButton())
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^play$/i }))
    })

    // Count-in 2000ms, then first cue [0,2)s → line 0.
    act(() => { vi.advanceTimersByTime(2000 + 100) })

    expect(getSongIndex()).toBe(0)
    // The cross-window value the Projection reads: must be un-blanked so showContent is true.
    expect(getBlank()).toBe(false)
  })

  it('T2: Auto Play broadcasts an audience blackout (dark during count-in / before first cue)', async () => {
    vi.useFakeTimers()
    setupWithTimelineSong()
    await armAndReachSetupFakeTimers()
    await act(async () => {
      fireEvent.click(getArmButton())
    })

    // On arm, no blackout — audience shows the intro/title.
    expect(getAutoBlackout()).toBe(false)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^play$/i }))
    })
    // Play → audience goes black immediately (count-in shows only on the performer beat clock).
    expect(getAutoBlackout()).toBe(true)
    // Still black through the count-in, index not yet driven.
    act(() => { vi.advanceTimersByTime(1000) })
    expect(getSongIndex()).toBe(-1)
    expect(getAutoBlackout()).toBe(true)
  })

  it('T2: Auto Restart clears the blackout and returns to the pre-Play intro (index -1)', async () => {
    vi.useFakeTimers()
    setupWithTimelineSong()
    await armAndReachSetupFakeTimers()
    await act(async () => {
      fireEvent.click(getArmButton())
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^play$/i }))
    })
    act(() => { vi.advanceTimersByTime(2000 + 200) })
    expect(getSongIndex()).toBe(0)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^restart$/i }))
    })
    expect(getAutoBlackout()).toBe(false)
    expect(getSongIndex()).toBe(-1)
    // Clock reset: further time does not drive the index until Play is pressed again.
    act(() => { vi.advanceTimersByTime(5000) })
    expect(getSongIndex()).toBe(-1)
  })

  it('T2: Auto mode does not drive the index during the count-in (before begin fires)', async () => {
    vi.useFakeTimers()
    setupWithTimelineSong()
    await armAndReachSetupFakeTimers()
    await act(async () => {
      fireEvent.click(getArmButton())
    })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^play$/i }))
    })

    // Still within the 2000ms count-in window — Auto must not have advanced past intro.
    act(() => { vi.advanceTimersByTime(1000) })
    expect(getSongIndex()).toBe(-1)
  })

  describe('§P1 Auto start-on-cue (v2 timeline, no video)', () => {
    /** Libertad-shaped v2 timeline: leadIn.apply === false (Auto's cue is the pedal press, not
     * the lead-in). No tempo — the realistic case for a v2 timeline with no BPM metadata. */
    function setupWithTimelineV2Song() {
      const songWithTimelineV2 = {
        id: 'duelo',
        title: 'Duelo',
        items: VALID_LINES,
        timelineVersion: 2,
        leadIn: { durationSec: 7.26, source: 'measured' as const, confidence: 'low' as const, apply: false },
        // Line 0 covers [0, 5.84)s of song time (matches the golden fixture's first entry —
        // docs/timeline-v2-contract.md), line 1 covers [5.84, ...).
        timeline: [{ start: 0, end: 5.84 }, { start: 5.84, end: 200 }],
      }
      saveSetlistStore(createInitialSnapshot([songWithTimelineV2]))
      setupControlViewWithReadinessPassing()
      setCurrentSongId('duelo')
    }

    it('1. armed but not cued: no lines shown, nothing advances, and time passing changes nothing', async () => {
      vi.useFakeTimers()
      setupWithTimelineV2Song()
      await armAndReachSetupFakeTimers()
      await act(async () => { fireEvent.click(getArmButton()) })

      // No Play button and no count-in for a cue-start song.
      expect(screen.queryByRole('button', { name: /^play$/i })).toBeNull()
      expect(getSongIndex()).toBe(-1)

      act(() => { vi.advanceTimersByTime(20_000) })
      expect(getSongIndex()).toBe(-1)
    })

    it('2. the first pedal press (Next) shows line 0 and starts the clock', async () => {
      vi.useFakeTimers()
      setupWithTimelineV2Song()
      await armAndReachSetupFakeTimers()
      await act(async () => { fireEvent.click(getArmButton()) })

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /^next$/i }))
      })

      expect(getSongIndex()).toBe(0)
      // The cross-window value the Projection reads: must be un-blanked.
      expect(getBlank()).toBe(false)
    })

    it('3. line 1 appears 5.84s after the cue with no further input', async () => {
      vi.useFakeTimers()
      setupWithTimelineV2Song()
      await armAndReachSetupFakeTimers()
      await act(async () => { fireEvent.click(getArmButton()) })
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /^next$/i }))
      })
      expect(getSongIndex()).toBe(0)

      act(() => { vi.advanceTimersByTime(5_840 + 100) })
      expect(getSongIndex()).toBe(1)
    })

    it('4. manual Next/Previous remain available and work both before and after the cue', async () => {
      vi.useFakeTimers()
      setupWithTimelineV2Song()
      await armAndReachSetupFakeTimers()
      await act(async () => { fireEvent.click(getArmButton()) })

      // Before the cue: Previous is disabled (nothing to go back to), Next is the cue trigger.
      expect((screen.getByRole('button', { name: /^previous$/i }) as HTMLButtonElement).disabled).toBe(true)

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /^next$/i }))
      })
      expect(getSongIndex()).toBe(0)

      // After the cue: Next still works as a manual override.
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /^next$/i }))
      })
      expect(getSongIndex()).toBe(1)

      // After the cue: Previous still works as a manual override.
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /^previous$/i }))
      })
      expect(getSongIndex()).toBe(0)
    })

    /**
     * P5 acceptance, at the level Jorge actually performs at: the pulse is a click track he
     * plays to. He talks to the audience while arming, picks the tempo up on guitar, plays a
     * 2-bar intro TO the pulse, and cues the lyrics with the pedal when settled — mid-bar,
     * because the lyrics do not always start on the first pulse of a bar.
     */
    function setupWithTimelineV2SongWithTempo() {
      const song = {
        id: 'duelo',
        title: 'Duelo',
        items: VALID_LINES,
        timelineVersion: 2,
        leadIn: { durationSec: 7.26, source: 'measured' as const, confidence: 'low' as const, apply: false },
        timeline: [{ start: 0, end: 5.84 }, { start: 5.84, end: 200 }],
        // 120bpm 4/4 → 500ms per beat, 2000ms per bar.
        tempo: { bpm: 120, numerator: 4, denominator: 4, countInBars: 1 },
      }
      saveSetlistStore(createInitialSnapshot([song]))
      setupControlViewWithReadinessPassing()
      setCurrentSongId('duelo')
    }

    it('P5: the pulse runs from Arm, and cueing mid-bar does not shift the click', async () => {
      vi.useFakeTimers()
      setupWithTimelineV2SongWithTempo()
      await armAndReachSetupFakeTimers()
      await act(async () => { fireEvent.click(getArmButton()) })

      // The pulse is already running, before any cue — this is what he plays the intro to.
      expect(screen.getByTestId('beat-circle-running')).toBeTruthy()

      // Two bars of intro plus a bit: 4500ms → absoluteBeat 9, i.e. beat 2 of the third bar.
      // Deliberately NOT a bar line — the performer cues when he is settled, not on the grid.
      act(() => { vi.advanceTimersByTime(4500) })
      expect(screen.getByTestId('beat-circle-beat-number').textContent).toBe('2')

      // The pedal press. Pre-P5 this re-phased the click to beat 1 under his fingers at the
      // exact moment he started singing.
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /^next$/i }))
      })
      expect(screen.getByTestId('beat-circle-beat-number').textContent).toBe('2')
      // Line 0 appears and the song is running.
      expect(getSongIndex()).toBe(0)
      expect(getBlank()).toBe(false)

      // The click keeps its own time: 500ms later it is beat 3, continuing the pre-cue count,
      // not restarting from the cue.
      act(() => { vi.advanceTimersByTime(500) })
      expect(screen.getByTestId('beat-circle-beat-number').textContent).toBe('3')

      // And the song clock, which started at the cue, advances the timeline independently.
      act(() => { vi.advanceTimersByTime(5_840 - 500 + 100) })
      expect(getSongIndex()).toBe(1)
    })

    it('Pause and Restart are absent before the cue and appear only after it', async () => {
      vi.useFakeTimers()
      setupWithTimelineV2Song()
      await armAndReachSetupFakeTimers()
      await act(async () => { fireEvent.click(getArmButton()) })

      expect(screen.queryByRole('button', { name: /^pause$/i })).toBeNull()
      expect(screen.queryByRole('button', { name: /^restart$/i })).toBeNull()

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /^next$/i }))
      })

      expect(screen.getByRole('button', { name: /^pause$/i })).toBeTruthy()
      expect(screen.getByRole('button', { name: /^restart$/i })).toBeTruthy()
    })

    it('does not black out the audience while waiting for the cue (title/intro card shows, uncapped intro length)', async () => {
      vi.useFakeTimers()
      setupWithTimelineV2Song()
      await armAndReachSetupFakeTimers()
      await act(async () => { fireEvent.click(getArmButton()) })

      expect(getAutoBlackout()).toBe(false)
      act(() => { vi.advanceTimersByTime(120_000) }) // a long live intro
      expect(getAutoBlackout()).toBe(false)

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /^next$/i }))
      })
      expect(getAutoBlackout()).toBe(false)
    })

    it('Restart returns to the pre-cue waiting state, and re-cueing works again', async () => {
      vi.useFakeTimers()
      setupWithTimelineV2Song()
      await armAndReachSetupFakeTimers()
      await act(async () => { fireEvent.click(getArmButton()) })
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /^next$/i }))
      })
      expect(getSongIndex()).toBe(0)

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /^restart$/i }))
      })
      expect(getSongIndex()).toBe(-1)
      expect(screen.queryByRole('button', { name: /^pause$/i })).toBeNull()

      // Re-cue: the timeline drives again from 0.
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /^next$/i }))
      })
      expect(getSongIndex()).toBe(0)
      act(() => { vi.advanceTimersByTime(5_840 + 100) })
      expect(getSongIndex()).toBe(1)
    })

    it('cue state resets cleanly when the song changes while armed and cued — a second song does not inherit the first song\'s cue', async () => {
      const v2Timeline = [{ start: 0, end: 5.84 }, { start: 5.84, end: 200 }]
      const v2LeadIn = { durationSec: 7.26, source: 'measured' as const, confidence: 'low' as const, apply: false }
      const songs = [
        { id: 'duelo', title: 'Duelo', items: VALID_LINES, timelineVersion: 2, leadIn: v2LeadIn, timeline: v2Timeline },
        { id: 'otra', title: 'Otra', items: OTHER_LINES, timelineVersion: 2, leadIn: v2LeadIn, timeline: v2Timeline },
      ]
      saveSetlistStore(createInitialSnapshot(songs))
      setupControlViewWithReadinessPassing()
      setCurrentSongId('duelo')
      await armAndReachSetup()

      await act(async () => { fireEvent.click(getArmButton()) })
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /^next$/i }))
      })
      expect(getSongIndex()).toBe(0)
      expect(screen.getByRole('button', { name: /^pause$/i })).toBeTruthy()

      // The song changes underneath while armed — the app auto-unarms (existing behavior).
      setCurrentSongId('otra')
      setSongLines(OTHER_LINES)
      setSongIndex(-1)
      setBlank(true)
      await act(async () => { dispatchStorageEvent() })

      await waitFor(() => {
        expect(screen.getAllByText(/Ready to Arm/).length).toBeGreaterThan(0)
      })

      // Re-arm for the new song: must NOT inherit the first song's cue.
      await act(async () => { fireEvent.click(getArmButton()) })
      expect(getSongIndex()).toBe(-1)
      expect(screen.queryByRole('button', { name: /^pause$/i })).toBeNull()
    })

    it('5. legacy timeline (no timelineVersion) keeps today\'s exact Auto behavior: Play button, count-in, no Next/Previous', async () => {
      vi.useFakeTimers()
      setupWithTimelineSong() // legacy helper: tempo w/ countInBars, no timelineVersion
      await armAndReachSetupFakeTimers()
      await act(async () => { fireEvent.click(getArmButton()) })

      // No cue-start affordance: Next/Previous are absent, Play/Pause/Restart are present.
      expect(screen.queryByRole('button', { name: /^next$/i })).toBeNull()
      expect(screen.queryByRole('button', { name: /^previous$/i })).toBeNull()
      expect(screen.getByRole('button', { name: /^play$/i })).toBeTruthy()

      // Time passing alone never advances without Play.
      act(() => { vi.advanceTimersByTime(10_000) })
      expect(getSongIndex()).toBe(-1)

      // Play starts the count-in; line 0 only appears once the count-in completes.
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /^play$/i }))
      })
      act(() => { vi.advanceTimersByTime(1999) })
      expect(getSongIndex()).toBe(-1)
      // A tick past the exact count-in boundary — songElapsedMs must be > 0 for the auto-drive
      // effect to compute a target index (matches the existing T2 Play test's own buffer).
      act(() => { vi.advanceTimersByTime(101) })
      expect(getSongIndex()).toBe(0)

      // Audience blackout still applies for legacy Auto (unchanged behavior).
      expect(getAutoBlackout()).toBe(true)
    })
  })
})
