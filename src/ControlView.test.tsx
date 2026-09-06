/** @vitest-environment jsdom */
/**
 * ControlView performer state flow: smallest practical UI/integration-style tests.
 * Renders App with hash #/ so ControlView is shown; drives state via storage and DOM.
 */
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest'
import { installRequiredFolders } from './testSupport/folders'
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
  getSongDetails,
  setLoadedSong,
  getSongLines,
  parseSongFile,
  getSongEnded,
} from './songState'
import { HOLD_CONFIRM_MS } from './useHoldToConfirm'
import { getPlayedSongs, addPlayedSong } from './playedSongsState'
import { getContactLitBroadcast } from './cardBroadcast'
import type { SongItem } from './songState'
import { SONGS } from './songs'
import {
  DEFAULT_SETLIST_ID,
  dropLibraryCache,
  loadSetlistStore,
  saveSetlistStore,
  getLibrarySongById,
} from './setlistStore'
import { installLibrary } from './testSupport/library'
import { APP_VERSION } from './appVersion'
import { MEDIA_PATH_STORE_KEY } from './mediaPathStore'
import { getAutoBlackout } from './autoBlackout'
import { installRoom, TEST_GIG_ID } from './testSupport/room'
import { KEY_VISUALS_BROADCAST } from './visualsBroadcast'
import { standbyState } from './testSupport/standbyState'

/** The played log flattened to ids, for the assertions that only care that a song is in it. */
function playedSongIds(): string[] {
  return getPlayedSongs().map((e) => e.songId)
}

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
  // The two folders this machine is pointed at, so a gig's relative `file` and the library's own
  // reference resolve to one path. Harmless for the tests that never open a gig.
  installRequiredFolders('/vault/songs', '/vault/gigs')
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
    /**
     * **A gig folder that reads back the room the test installed.**
     *
     * Needed since *the song holds no media* (Jorge, 2026-09-03): a video song is one the ROOM
     * assigns a video to, so a test about a video song has to open a gig — and a remembered folder
     * turns the arm gate on. Without this the folder is remembered and unreadable, which is a real
     * state and a blocked one, so every song would fail the gate for the wrong reason.
     *
     * It answers out of the broadcast the test seeded, so readiness and the wall cannot disagree.
     */
    readGigFolder: vi.fn(async () => {
      const raw = localStorage.getItem(KEY_VISUALS_BROADCAST)
      const visuals = raw ? (JSON.parse(raw) as { visuals: unknown }).visuals : null
      return {
        gigText: JSON.stringify({
          gigVersion: 1,
          id: TEST_GIG_ID,
          date: '2026-05-16',
          venue: { name: 'Test' },
          visuals: './visuals.json',
          // **The gig states its own running order**, because reading a gig ADOPTS it: a gig.json
          // with no setlist gets an empty one written in, and the song under test would drop out
          // of the setlist it was just put in.
          // **The same file the library already holds**, written relative to the gig folder as a
          // real one is. Adopting compares RESOLVED paths, so a match means the reference is not
          // repointed and not re-read — which is the behaviour on a real machine too.
          songs: [
            { id: 'duelo', title: 'Duelo', file: '../../../vault/songs/song-performance/duelo.json' },
          ],
          setlist: ['duelo'],
        }),
        gigError: null,
        gigPresent: true,
        visualsText: visuals ? JSON.stringify(visuals) : null,
        visualsError: null,
        visualsPresent: visuals !== null,
      }
    }),
    writeGigFile: vi.fn(async () => ({ ok: true })),
    // The video the room assigns is on this machine. `platform.fileExists` asks through this.
    getFileStats: vi.fn(async () => ({ exists: true })),
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
  installRequiredFolders()
  dropLibraryCache()
}

/** References for every bundled song id (matches the `SONGS` catalog), resolved to one line each. */
function installProductionLikeLibrary(): void {
  const line: SongItem = { languages: { es: 't', en: 't' } }
  installLibrary(SONGS.map((s) => ({ id: s.id, title: s.title, items: [line] })))
}

/** Installs a library from inline JSON, as reading those files out of `songs/` would produce. */
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
  installLibrary(songs)
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

  it('Setlist screen says there is no GIG — the thing that is actually missing', async () => {
    // **Walked on `v0.52.0`.** From nothing, `Setlist` said *Choose a setlist to continue*, which
    // asks for something that cannot exist: a setlist belongs to a gig and no gig is open. It
    // names the gig now, and points at where a gig is chosen.
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
        expect(screen.getByTestId('setlist-no-gig')).toBeTruthy()
      },
      { timeout: WAIT_TIMEOUT }
    )
    expect(screen.getByTestId('setlist-no-gig').textContent).toContain('No gig is open')
    expect(screen.getByTestId('setlist-no-gig').textContent).toContain('Backstage')
    expect(screen.queryByTestId('setlist-selection-prompt')).toBeNull()
    // And it is a way there, not only a sentence about there.
    fireEvent.click(screen.getByTestId('setlist-go-backstage'))
    expect(window.location.hash).toBe('#/setup')
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
        expect(standbyState()).toBe('SETUP')
      },
      { timeout: WAIT_TIMEOUT }
    )
  })

  it('2. In Setup state, the sections appear in this exact order: Gig, Song, Lyrics display, Projection, Arm', async () => {
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
        expect(standbyState()).toBe('SETUP')
      },
      { timeout: WAIT_TIMEOUT }
    )

    const main = screen.getByRole('main')
    const sections = main.querySelectorAll('.control-setup-section')
    expect(sections.length).toBeGreaterThanOrEqual(5)
    const firstLabels = Array.from(sections).map((s) => s.querySelector('.control-setup-label')?.textContent)
    // The gig comes first because it is what the rest of the panel is inside: which night, then
    // which song of it, then how it looks and where it goes.
    expect(firstLabels[0]).toBe('Gig')
    expect(firstLabels[1]).toBe('Song')
    expect(firstLabels[2]).toBe('Lyrics display')
    expect(firstLabels[3]).toBe('Projection')
    // **Arm follows Projection directly since 2026-09-04**: the Rig column is gone, and the rest
    // of the arrangement is untouched — same columns, same order, same proportions.
    expect(firstLabels[4]).toBe('Arm')
    // And the order is the whole of it: nothing sits after Arm.
    expect(firstLabels).toHaveLength(5)
  })

  it('2a. The rig column is gone, and nothing took its place', async () => {
    // **Jorge said it three times** and it was already owed removal on 02/09 for not being
    // understood: none of it is a performance concern, and it was inert anyway — a static list
    // with no state and no store. `RIG_CHECKLIST` itself stays; `GigView`'s step-5 checklist
    // renders it, and that one is ticked rather than read.
    setupControlViewInitial()
    setSongLines(VALID_LINES)
    setCurrentSongId('duelo')
    setProjectionLanguage('en')
    render(<App initialHash="#/" />)
    await waitFor(
      () => {
        expect(standbyState()).toBe('SETUP')
      },
      { timeout: WAIT_TIMEOUT }
    )
    expect(screen.queryByTestId('control-rig')).toBeNull()
    expect(document.querySelector('.control-rig-list')).toBeNull()
  })

  it('names the room Standby, and only while it is the room you are in', async () => {
    // **The stage manager's call before a cue**, which is what this screen is: choose the gig,
    // choose the song, choose the mode, stand by. Arming is the GO — so the name goes when the
    // performing view takes over, because that is a different room.
    setupControlViewInitial()
    setSongLines(VALID_LINES)
    setCurrentSongId('duelo')
    setProjectionLanguage('en')
    render(<App initialHash="#/" />)
    await waitFor(
      () => {
        expect(standbyState()).toBe('SETUP')
      },
      { timeout: WAIT_TIMEOUT }
    )
    const name = screen.getByTestId('control-room-name')
    expect(name.textContent).toBe('Standby')
    // Titled the way Backstage is: a heading naming the room.
    expect(name.tagName).toBe('H1')
  })

  it('2b. In Setup state, old top navigation shell is not rendered (no top bar, no bottom transport)', async () => {
    setupControlViewInitial()
    setSongLines(VALID_LINES)
    setCurrentSongId('duelo')
    setProjectionLanguage('en')
    render(<App initialHash="#/" />)

    await waitFor(
      () => {
        expect(standbyState()).toBe('SETUP')
      },
      { timeout: WAIT_TIMEOUT }
    )

    // The old shell specifically — the setup masthead is also a banner, and is expected.
    expect(document.querySelector('.control-top-bar')).toBeNull()
    expect(document.querySelector('.control-masthead')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /previous/i })).toBeNull()
    expect(queryArmedTransportNextButton()).toBeNull()
    expect(screen.queryByRole('button', { name: /restart/i })).toBeNull()
  })

  it('2c. In Ready to Arm state, old top navigation shell and bottom transport are not rendered', async () => {
    setupControlViewWithReadinessPassing()
    render(<App initialHash="#/" />)

    await waitFor(
      () => {
        expect(standbyState()).toBe('READY_TO_ARM')
      },
      { timeout: WAIT_TIMEOUT }
    )

    // The old shell specifically — the setup masthead is also a banner, and is expected.
    expect(document.querySelector('.control-top-bar')).toBeNull()
    expect(document.querySelector('.control-masthead')).toBeTruthy()
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
        expect(standbyState()).toBe('SETUP')
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
        expect(standbyState()).toBe('SETUP')
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
        expect(standbyState()).toBe('SETUP')
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
        expect(standbyState()).toBe('READY_TO_ARM')
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
        expect(standbyState()).toBe('SETUP')
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
        expect(standbyState()).toBe('READY_TO_ARM')
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
        expect(standbyState()).toBe('SETUP')
      },
      { timeout: WAIT_TIMEOUT }
    )

    const main = screen.getByRole('main')
    const armBtn = within(main).queryByRole('button', { name: 'Arm' })
    // **`Arm` is pressable and refuses** since 2026-09-06; `aria-disabled` carries what `disabled`
    // used to, without taking the press and the explanation with it.
    expect(armBtn === null || armBtn.getAttribute('aria-disabled') === 'true').toBe(true)
  })

  it('4. When all prerequisites are satisfied, status becomes READY_TO_ARM and Arm is enabled', async () => {
    setupControlViewWithReadinessPassing()
    render(<App initialHash="#/" />)

    await waitFor(
      () => {
        expect(standbyState()).toBe('READY_TO_ARM')
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
        expect(standbyState()).toBe('SETUP')
      },
      { timeout: WAIT_TIMEOUT }
    )

    const armBtn = getArmButton()
    expect(armBtn!.getAttribute('aria-disabled')).toBe('true')
  })

  it('4c. Setup/ready screen displays language pair as singing → translation (ES → EN)', async () => {
    setupControlViewWithReadinessPassing()
    render(<App initialHash="#/" />)

    await waitFor(
      () => {
        expect(standbyState()).toBe('READY_TO_ARM')
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
        expect(standbyState()).toBe('READY_TO_ARM')
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
        expect(standbyState()).toBe('READY_TO_ARM')
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
        expect(standbyState()).toBe('READY_TO_ARM')
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
        expect(standbyState()).toBe('READY_TO_ARM')
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

    expect(standbyState()).toBe('READY_TO_ARM')
  })

  it('8a. Unarm button requires hold-to-confirm (single click does not unarm)', async () => {
    setupControlViewWithReadinessPassing()
    render(<App initialHash="#/" />)

    await waitFor(
      () => {
        expect(standbyState()).toBe('READY_TO_ARM')
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
        expect(standbyState()).toBe('READY_TO_ARM')
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

    expect(standbyState()).toBe('READY_TO_ARM')
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
        expect(standbyState()).toBe('READY_TO_ARM')
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
        expect(standbyState()).toBe('SETUP')
      },
      { timeout: WAIT_TIMEOUT }
    )
  })

  it('8d. Close: single click closes projection (no hold required)', async () => {
    setupControlViewWithReadinessPassing()
    render(<App initialHash="#/" />)

    await waitFor(
      () => {
        expect(standbyState()).toBe('READY_TO_ARM')
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
        expect(standbyState()).toBe('READY_TO_ARM')
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
        expect(standbyState()).toBe('READY_TO_ARM')
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
        expect(standbyState()).toBe('READY_TO_ARM')
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

      expect(standbyState()).toBe('READY_TO_ARM')
    })

    it('when armed and not at last lyric phrase, Unarm keeps normal style and requires hold-to-confirm', async () => {
      setupControlViewWithReadinessPassing()
      setSongIndex(0)
      render(<App initialHash="#/" />)

      await waitFor(() => {
        expect(standbyState()).toBe('READY_TO_ARM')
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
        expect(standbyState()).toBe('READY_TO_ARM')
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
        expect(standbyState()).toBe('READY_TO_ARM')
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

    /**
     * **SUPERSEDED, 2026-09-06: Next stays live on the last line, and that press ends the song.**
     *
     * Disabling it there is how `manual` came to have no end at all — `nextIndex` clamps, so the
     * press moves nothing, but **the press is the end, not the index.** With it dead the last line
     * stayed on the wall, the song never finished, the setlist never closed and the message home
     * was never reached; and for the last song of a setlist there is no next-song tile either, so
     * nothing in the flow could end it. **It goes dead once the song has ended**, which is what
     * this now asserts.
     */
    it('shows the last phrase immediately, and Next ends the song rather than sitting dead', async () => {
      setActiveSetlistSongIds(['duelo', 'pimiento'])
      setupControlViewWithReadinessPassing()
      render(<App initialHash="#/" />)

      await waitFor(
        () => {
          expect(standbyState()).toBe('READY_TO_ARM')
        },
        { timeout: WAIT_TIMEOUT }
      )

      await act(async () => {
        fireEvent.click(getArmButton())
      })
      await navigateToLastLyric()

      expect(screen.getByText('Mundo')).toBeTruthy()
      // Live on the last line: the song is still being sung, and the press that follows is *done*.
      expect((screen.getByRole('button', { name: 'Next' }) as HTMLButtonElement).disabled).toBe(false)
      expect(screen.queryByTestId('next-song-tile')).toBeNull()
      expect(screen.queryByText('Tap to continue')).toBeNull()

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Next' }))
      })
      expect(getSongEnded()).toBe(true)
      // Nothing further to do, so it goes dead — and the last line is still the index, which is
      // what keeps the end-of-song footer and its tile in place.
      expect((screen.getByRole('button', { name: 'Next' }) as HTMLButtonElement).disabled).toBe(true)
      expect(getSongIndex()).toBe(1)
    })

    it('does not show next-song tile before 6 seconds, then auto-reveals it at 6 seconds', async () => {
      vi.useFakeTimers()
      setActiveSetlistSongIds(['duelo', 'pimiento'])
      setupControlViewWithReadinessPassing()
      render(<App initialHash="#/" />)

      await act(async () => {
        await Promise.resolve()
      })
      expect(standbyState()).toBe('READY_TO_ARM')

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
      expect(standbyState()).toBe('READY_TO_ARM')

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

    /**
     * **STARTING THE NEXT SONG CARRIES EVERYTHING THE WALL NEEDS, NOT JUST THE ID AND THE TITLE**
     * (2026-09-06).
     *
     * The Projection window has no song library — it is a second `BrowserWindow` with its own
     * module instances and nothing hydrates it — so **what it cannot be told, it does not have.**
     * This transition wrote the id and the title and left `songDetails` holding the *previous*
     * song's tagline, translated title, timeline and lead-in: the wall would have carried one
     * song's intro card into the next song, and, in Video mode, the wrong cue table.
     *
     * Loading a song anywhere else already goes through `setLoadedSong`; this was the one path
     * that set the pieces by hand.
     */
    it('hands the wall the next song\u2019s own details, not the last song\u2019s', async () => {
      vi.useFakeTimers()
      setActiveSetlistSongIds(['duelo', 'pimiento'])
      setupControlViewWithReadinessPassing()
      // Two songs the wall can tell apart. Installed after the setup so these entries win.
      installLibrary([
        { id: 'duelo', title: 'Duelo', items: VALID_LINES, intro: { en: 'A duel.' } },
        { id: 'pimiento', title: 'Pimiento', items: VALID_LINES, intro: { en: 'A pepper.' } },
      ] as never)
      setLoadedSong({
        id: 'duelo',
        title: 'Duelo',
        items: VALID_LINES,
        intro: { en: 'A duel.' },
      })
      setSongIndex(-1)
      expect(getSongDetails()).toEqual({ intro: { en: 'A duel.' } })

      render(<App initialHash="#/" />)
      await act(async () => {
        await Promise.resolve()
      })
      await act(async () => {
        fireEvent.click(getArmButton())
      })
      await navigateToLastLyric()
      act(() => {
        vi.advanceTimersByTime(6_000)
      })
      await act(async () => {
        fireEvent.click(screen.getByTestId('next-song-tile'))
      })

      expect(getCurrentSongId()).toBe('pimiento')
      // **The whole of the defect**: the id and the title moved and the details did not, so the
      // wall would have carried Duelo's intro card into Pimiento.
      expect(getSongDetails()).toEqual({ intro: { en: 'A pepper.' } })
      vi.useRealTimers()
    })

    it('next-song tile reuses Setlist song-tile visual classes', async () => {
      vi.useFakeTimers()
      setActiveSetlistSongIds(['duelo', 'pimiento'])
      setupControlViewWithReadinessPassing()
      render(<App initialHash="#/" />)

      await act(async () => {
        await Promise.resolve()
      })
      expect(standbyState()).toBe('READY_TO_ARM')

      await act(async () => {
        fireEvent.click(getArmButton())
      })
      await navigateToLastLyric()
      act(() => {
        vi.advanceTimersByTime(6_000)
      })

      const tile = screen.getByTestId('next-song-tile')
      expect(tile.className.trim()).toBe('songs-song-btn')
      // **The box is the setlist's; the title inside it is not** (2026-09-06). See the test below.
      expect(tile.querySelector('.performing-next-song-title')?.textContent).toBe('Pimiento')
    })

    /**
     * **THE PERFORMING VIEW STOPS BREAKING THE NEXT SONG'S TITLE MID-WORD** (Jorge, 2026-09-06).
     *
     * **The same defect class as `Unarmed` on 04/09**, and the kickoff's own question — *check
     * whether that fix simply never reached this tile* — is exactly right: it did not. The tile
     * borrowed `.songs-song-title` from the setlist screen, which carries
     * `overflow-wrap: anywhere`, **which is mid-word breaking asked for by name.**
     *
     * The `Unarmed` fix is two halves and both are here now: **the box sizes the type**, in `cqi`
     * against the tile's own width and divided by the longest word — `SetupValue.longestWordLength`
     * is the same measurement, made from the string rather than off the screen — and **mid-word
     * breaking is switched off outright**, so *no word breaks mid-word* is a property of the screen
     * rather than a consequence of arithmetic that could drift.
     *
     * The setlist screen's own tiles are untouched: this is the surface read across a stage.
     */
    it('sizes the next song\u2019s title against its tile, and never breaks a word', async () => {
      vi.useFakeTimers()
      setActiveSetlistSongIds(['duelo', 'pimiento'])
      setupControlViewWithReadinessPassing()
      render(<App initialHash="#/" />)
      await act(async () => { await Promise.resolve() })
      await act(async () => { fireEvent.click(getArmButton()) })
      await navigateToLastLyric()
      act(() => { vi.advanceTimersByTime(6_000) })

      const title = screen.getByTestId('next-song-tile').querySelector(
        '.performing-next-song-title'
      ) as HTMLElement
      // The longest unbreakable run, handed to CSS as a number — nothing is measured off screen.
      expect(title.style.getPropertyValue('--value-longest-word')).toBe('8')

      const css = readFileSync(resolve(__dirname, 'control.css'), 'utf8')
      const rule = (selector: string) => {
        const at = css.indexOf(selector + ' {')
        expect(at, `${selector} is not in control.css`).toBeGreaterThan(-1)
        return css.slice(at, css.indexOf('}', at))
      }
      const own = rule('.performing-next-song-title')
      expect(own).toMatch(/overflow-wrap:\s*normal/)
      expect(own).toMatch(/word-break:\s*normal/)
      expect(own).not.toMatch(/anywhere|break-word/)
      // Sized against its own box, not the viewport — the half the `Unarmed` fix turned on.
      expect(own).toMatch(/cqi/)
      expect(own).toMatch(/var\(--value-longest-word/)
      expect(rule('.performing-next-song-tile-wrap .songs-song-btn')).toMatch(
        /container-type:\s*inline-size/
      )
      vi.useRealTimers()
    })

    it('tapping next-song tile starts next song directly (without unarm/setup)', async () => {
      vi.useFakeTimers()
      setActiveSetlistSongIds(['duelo', 'pimiento'])
      setupControlViewWithReadinessPassing()
      render(<App initialHash="#/" />)

      await act(async () => {
        await Promise.resolve()
      })
      expect(standbyState()).toBe('READY_TO_ARM')

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
    expect(standbyState()).toBe('READY_TO_ARM')

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
      expect(standbyState()).toBe('READY_TO_ARM')
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
      expect(standbyState()).toBe('READY_TO_ARM')
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
      expect(standbyState()).toBe('READY_TO_ARM')
    }, { timeout: WAIT_TIMEOUT })
  })

  it('2. pressing Arm changes the UI to Ready to Perform', async () => {
    setupControlViewWithReadinessPassing()
    render(<App initialHash="#/" />)

    await waitFor(() => {
      expect(standbyState()).toBe('READY_TO_ARM')
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
      expect(standbyState()).toBe('READY_TO_ARM')
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
      expect(standbyState()).toBe('READY_TO_ARM')
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
      expect(standbyState()).toBe('READY_TO_ARM')
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

    expect(standbyState()).toBe('READY_TO_ARM')
    expect(getCurrentSongId()).toBe('duelo')
    expect(getSongIndex()).toBe(-1)
  })

  it('5. Next is not shown when the app is not armed (transport only in Armed state)', async () => {
    setupControlViewWithReadinessPassing()
    render(<App initialHash="#/" />)

    await waitFor(() => {
      expect(standbyState()).toBe('READY_TO_ARM')
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
    expect(armBtn!.getAttribute('aria-disabled')).toBe('true')
  }, 10000)

  describe('reset behavior when configuration changes during a session', () => {
    it('1. changing song while armed resets the session', async () => {
      setupControlViewWithReadinessPassing()
      render(<App initialHash="#/" />)

      await waitFor(() => {
        expect(standbyState()).toBe('READY_TO_ARM')
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
        expect(standbyState()).toBe('READY_TO_ARM')
      })
      expect(screen.queryByText(/Armed/)).toBeNull()
    })

    it('2. changing song while performing resets the session', async () => {
      setupControlViewWithReadinessPassing()
      render(<App initialHash="#/" />)

      await waitFor(() => {
        expect(standbyState()).toBe('READY_TO_ARM')
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
        expect(standbyState()).toBe('READY_TO_ARM')
      })
      expect(standbyState()).toBe('READY_TO_ARM')
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
        expect(standbyState()).toBe('READY_TO_ARM')
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
        expect(standbyState()).toBe('READY_TO_ARM')
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
        expect(standbyState()).toBe('READY_TO_ARM')
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
        expect(standbyState()).toBe('READY_TO_ARM')
      })
      expect(standbyState()).toBe('READY_TO_ARM')
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
        expect(standbyState()).toBe('READY_TO_ARM')
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

      expect(standbyState()).toBe('READY_TO_ARM')
      expect(getSongIndex()).toBe(0)

      setProjectionLanguage('fr')
      dispatchStorageEvent()

      await waitFor(() => {
        expect(getSongIndex()).toBe(-1)
        expect(getBlank()).toBe(true)
      })

      type CommandLog = {
        type: string
        action?: string
        value?: number
        currentIndex?: number
        blank?: boolean
      }
      let lastCmd: CommandLog | null = null
      for (let i = sendSpy.mock.calls.length - 1; i >= 0; i--) {
        const msg = JSON.parse(sendSpy.mock.calls[i][0] as string) as CommandLog
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
        expect(standbyState()).toBe('READY_TO_ARM')
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
        expect(standbyState()).toBe('READY_TO_ARM')
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
        expect(standbyState()).toBe('READY_TO_ARM')
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
      expect(armBtn!.getAttribute('aria-disabled')).toBe('true')
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
        expect(standbyState()).toBe('READY_TO_ARM')
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
      expect(armBtn!.getAttribute('aria-disabled')).toBe('true')
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

    function getLastCommandPayload(): { type: string; action?: string; currentIndex?: number; blank?: boolean; value?: number } | null {
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
        expect(standbyState()).toBe('READY_TO_ARM')
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
        expect(standbyState()).toBe('READY_TO_ARM')
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
        expect(standbyState()).toBe('READY_TO_ARM')
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
        expect(standbyState()).toBe('READY_TO_ARM')
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
        expect(standbyState()).toBe('READY_TO_ARM')
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
        expect(standbyState()).toBe('READY_TO_ARM')
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
        expect(standbyState()).toBe('READY_TO_ARM')
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
        expect(standbyState()).toBe('READY_TO_ARM')
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

      expect(standbyState()).toBe('READY_TO_ARM')
      expect(screen.queryByText(/Armed/)).toBeNull()
    })

    it('5. Next shortcut does nothing when not allowed (ready, not armed)', async () => {
      setupControlViewWithReadinessPassing()
      render(<App initialHash="#/" />)

      await waitFor(() => {
        expect(standbyState()).toBe('READY_TO_ARM')
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
        expect(standbyState()).toBe('READY_TO_ARM')
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
        expect(standbyState()).toBe('READY_TO_ARM')
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
      expect(armBtn!.getAttribute('aria-disabled')).toBe('true')
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

    it('when there is no gig and no setlist, names the gig as the thing that is missing', async () => {
      clearStorage()
      installProductionLikeLibrary()
      const base = loadSetlistStore()!
      saveSetlistStore({ ...base, activeSetlistId: '' })
      sessionStorage.setItem('liveLyricLaunched', '1')
      window.location.hash = '#/songs'
      renderSetlistScreen()

      await waitFor(() => {
        expect(screen.getByTestId('setlist-no-gig')).toBeTruthy()
      })
      expect(document.querySelectorAll('.songs-song-btn').length).toBe(0)
      expect(screen.getByRole('heading', { name: 'Setlist' })).toBeTruthy()
      expect(screen.queryByTestId('active-setlist-name')).toBeNull()
      expect(document.querySelector('.setlist-picker-bar')).toBeNull()
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
        expect(standbyState()).toBe('SETUP')
      })
      await waitFor(() => {
        expect(getCurrentSongId()).toBe('duelo')
      })
      expect(getSongLines().length).toBeGreaterThan(0)
      expect(getSongIndex()).toBe(-1)
      expect(getBlank()).toBe(true)
    })

    it('auto-selecting the first song fills the control view Song column', async () => {
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
        expect(getCurrentSongId()).toBe('duelo')
      })
      await waitFor(() => {
        const main = screen.getByRole('main')
        const sections = main.querySelectorAll('.control-setup-section')
        const songSection = Array.from(sections).find(
          (s) => s.querySelector('.control-setup-label')?.textContent === 'Song'
        )
        expect(songSection?.querySelector('.control-setup-value')?.textContent).toBe('Duelo')
      })
    })

    it('arriving at the control view from setup fills the Song column, not just storage', async () => {
      // Journey step 11's own sequence: the setlist becomes active while the performer is off the
      // control view (a gig is opened on Setup home, and adopting it makes the gig's setlist the
      // active one), and the control view is then mounted by the navigation back to the stage.
      clearStorage()
      seedTwoSetlistsTonightActive()
      setCurrentSongId('')
      setCurrentSongTitle('')
      setSongLines([])
      sessionStorage.setItem('liveLyricLaunched', '1')
      window.location.hash = '#/songs'
      renderSetlistScreen()

      await waitFor(() => {
        expect(standbyState()).toBeNull()
      })

      await act(async () => {
        window.location.hash = '#/'
        window.dispatchEvent(new HashChangeEvent('hashchange'))
      })

      await waitFor(() => {
        const main = screen.getByRole('main')
        const songSection = Array.from(main.querySelectorAll('.control-setup-section')).find(
          (s) => s.querySelector('.control-setup-label')?.textContent === 'Song'
        )
        expect(songSection?.querySelector('.control-setup-value')?.textContent).toBe('Duelo')
      })
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
        expect(standbyState()).toBe('SETUP')
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
      // The empty setlist is written straight into the store: `createEmptySetlist` went with the
      // manage-setlists screen, and this test is about what the control view does when the active
      // setlist has nothing in it, not about how one gets made.
      const snapshot = loadSetlistStore()!
      saveSetlistStore({
        ...snapshot,
        setlists: [...snapshot.setlists, { id: 'empty', name: 'Empty', songIds: [] }],
        activeSetlistId: 'empty',
      })
      setCurrentSongId('duelo')
      setCurrentSongTitle('Duelo')
      setSongLines(VALID_LINES)
      setSongIndex(0)
      setBlank(false)
      sessionStorage.removeItem('liveLyricLaunched')
      window.location.hash = '#/'
      renderSetlistScreen()

      await waitFor(() => {
        expect(standbyState()).toBe('SETUP')
      })
      await waitFor(() => {
        expect(getCurrentSongId()).toBe('')
      })
      expect(getSongLines()).toEqual([])
      expect(getSongIndex()).toBe(-1)
      expect(getBlank()).toBe(true)
    })

  })

  describe('Played song indicator', () => {
    it('when performer unarms at end-of-song, current song is marked as played', async () => {
      setupControlViewWithReadinessPassing()
      render(<App initialHash="#/" />)

      await waitFor(() => {
        expect(standbyState()).toBe('READY_TO_ARM')
      }, { timeout: WAIT_TIMEOUT })
      await act(async () => {
        fireEvent.click(getArmButton())
      })
      await waitFor(() => {
        expect(screen.getByTestId('performance-state-label').textContent).toBe('Performance: Armed')
      })
      await navigateToLastLyric()
      expect(playedSongIds()).not.toContain('duelo')

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /^Unarm/ }))
      })

      expect(standbyState()).toBe('READY_TO_ARM')
      expect(playedSongIds()).toContain('duelo')
    })

    it('when performer unarms before end-of-song (hold-to-confirm), song is NOT marked as played', async () => {
      setupControlViewWithReadinessPassing()
      setSongIndex(0)
      render(<App initialHash="#/" />)

      await waitFor(() => {
        expect(standbyState()).toBe('READY_TO_ARM')
      }, { timeout: WAIT_TIMEOUT })
      await act(async () => {
        fireEvent.click(getArmButton())
      })
      await waitFor(() => {
        expect(screen.getByTestId('performance-state-label').textContent).toBe('Performance: Armed')
      })
      expect(playedSongIds()).not.toContain('duelo')

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

      expect(standbyState()).toBe('READY_TO_ARM')
      expect(playedSongIds()).not.toContain('duelo')
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
        expect(standbyState()).toBe('READY_TO_ARM')
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
        expect(standbyState()).toBe('READY_TO_ARM')
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
        expect(standbyState()).toBe('READY_TO_ARM')
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
  installRequiredFolders()
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
      expect(standbyState()).toBe('READY_TO_ARM')
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
      expect(standbyState()).toBe('READY_TO_ARM')
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
      expect(standbyState()).toBe('READY_TO_ARM')
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
      expect(standbyState()).toBe('READY_TO_ARM')
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
      expect(standbyState()).toBe('READY_TO_ARM')
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
  installRequiredFolders()
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
    expect(standbyState()).toBe('READY_TO_ARM')

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
    expect(standbyState()).toBe('READY_TO_ARM')

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
    expect(standbyState()).toBe('READY_TO_ARM')

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
    expect(timerRule).toMatch(/border-radius:\s*var\(--radius-round\)/)
    expect(timerRule).toMatch(/border:\s*1px\s+solid\s+var\(--control-border\)/)
    expect(timerRule).toMatch(/background:\s*var\(--control-bg\)/)
    expect(timerRule).toMatch(/color:\s*var\(--text-primary\)/)
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
    expect(pausedRule).toMatch(/background:\s*var\(--state-paused-bg\)/)
    expect(pausedRule).toMatch(/border-color:\s*var\(--state-paused-border\)/)
    expect(pausedRule).toMatch(/color:\s*var\(--state-paused-text\)/)
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
  installRequiredFolders()
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
    installLibrary([song])
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
      expect(standbyState()).toBe('READY_TO_ARM')
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
      expect(standbyState()).toBe('READY_TO_ARM')
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
      expect(standbyState()).toBe('READY_TO_ARM')
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
  installRequiredFolders()
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
    installLibrary([song])
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
      expect(standbyState()).toBe('READY_TO_ARM')
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
      expect(standbyState()).toBe('READY_TO_ARM')
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
      expect(standbyState()).toBe('READY_TO_ARM')
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

// ── §5 + §6 — simplified performance screens ──────────────────────────────

/**
 * **A COLUMN SHOWS A STATE, NEVER A MESSAGE — AND THIS IS THE TEST THAT HOLDS IT.**
 *
 * **Ruled 2026-09-03, restated 2026-09-05, and broken again by 2026-09-06.** A paragraph in `GIG`,
 * bullets in `ARM`, two placement notes in `PROJECTION`. **Three times is not a wording problem, it
 * is a missing guard** — the same shape as the translations note that drifted home three times and
 * only stopped when something failed on it.
 *
 * **Why the rule exists**: this panel is read across a stage in the dark, where a band of text at a
 * control is invisible. Anything that has gone wrong is a popup; anything that is a fact is the
 * column's value.
 *
 * **What a column may contain**: its label, its value, and its controls — a control's own group
 * label and its buttons. **Anything else fails this test**, whatever it is called and however good
 * the reason is. If a new fact must be said, it goes in the value or in a popup.
 */
describe('a column shows a state, never a message', () => {
  const SPANISH: SongItem[] = [
    { languages: { es: 'Fui brasa viva en la oscuridad,' } },
    { languages: { es: 'Chispa que quiso brotar.' } },
  ]

  beforeEach(() => {
    cleanup()
    vi.clearAllMocks()
    clearStorage()
  })

  afterEach(() => {
    vi.useRealTimers()
    cleanup()
    delete (window as unknown as { electronAPI?: unknown }).electronAPI
  })

  /** Everything a column is allowed to say, in the order the DOM gives it. */
  function allowedText(section: Element): string {
    const parts: string[] = []
    for (const el of section.querySelectorAll(
      '.control-setup-label, .control-setup-value, .ctrl-toggle-label, button'
    )) {
      parts.push(el.textContent ?? '')
    }
    return parts.join('').replace(/\s+/g, ' ').trim()
  }

  function actualText(section: Element): string {
    return (section.textContent ?? '').replace(/\s+/g, ' ').trim()
  }

  async function renderStandby() {
    installLibrary([{ id: 'libertad', title: 'Libertad', items: SPANISH } as never])
    setupControlViewWithReadinessPassing()
    setSongLines(SPANISH)
    setCurrentSongId('libertad')
    setCurrentSongTitle('Libertad')
    render(<App initialHash="#/" />)
    await waitFor(() => {
      expect(standbyState()).not.toBeNull()
    }, { timeout: WAIT_TIMEOUT })
  }

  it('says nothing in any column beyond its label, its value and its controls', async () => {
    await renderStandby()
    const sections = [...document.querySelectorAll('.control-setup-section')]
    expect(sections.length).toBeGreaterThan(1)
    for (const section of sections) {
      expect(actualText(section)).toBe(allowedText(section))
    }
  })

  it('says nothing extra when the gig cannot be armed, which is when it used to say most', async () => {
    // The state that produced the paragraph and the bullets: a gig open, a song that readiness
    // refuses, and setup unconfirmed.
    await renderStandby()
    const sections = [...document.querySelectorAll('.control-setup-section')]
    for (const section of sections) {
      expect(actualText(section)).toBe(allowedText(section))
    }
    expect(screen.queryByTestId('control-gig-summary')).toBeNull()
    expect(screen.queryByTestId('arm-blocked-reasons')).toBeNull()
    expect(screen.queryByTestId('arm-setup-warning')).toBeNull()
    expect(screen.queryByTestId('projection-placement')).toBeNull()
    expect(screen.queryByTestId('projection-placement-fallback')).toBeNull()
  })

  it('carries no paragraph, list or note element inside a column, whatever it would say', async () => {
    // **The shape, not the sentence.** A rule about wording is what failed three times; this fails
    // on the element itself, so the next message has nowhere to land.
    await renderStandby()
    for (const section of document.querySelectorAll('.control-setup-section')) {
      expect(section.querySelector('p')).toBeNull()
      expect(section.querySelector('ul')).toBeNull()
      expect(section.querySelector('li')).toBeNull()
      expect(section.querySelector('.control-setup-note')).toBeNull()
    }
  })
})

/**
 * **THE WALK'S BLOCKER, AS A TEST** (walked 2026-09-06, `v0.80.0`).
 *
 * **Arming did nothing and nothing on the screen said why.** The diagnosis, before any fix: it was
 * not *armed without navigating* — **the `Arm` button was disabled**, because the control state
 * never left `SETUP`.
 *
 * **The cause is the catalogue's own shape.** Every line of every real song carries `es` and
 * nothing else; the projection default was *`en` if the song has it, otherwise nothing*, and the
 * singing default was *the stored value or nothing*. With neither answered, two of the five arm
 * prerequisites were false.
 *
 * **1764 tests said nothing about it**, because every fixture in the suite was bilingual. This one
 * is shaped like the songs on disk.
 */
describe('a Spanish-only song arms and reaches the performing view', () => {
  const SPANISH_ONLY: SongItem[] = [
    { languages: { es: 'Fui brasa viva en la oscuridad,' } },
    { languages: { es: 'Chispa que quiso brotar.' } },
  ]

  beforeEach(() => {
    // **`cleanup()` first, and it is not a formality.** `standbyState()` reads the *first* arm
    // button in the document, so a container left behind by an earlier test answers for this one —
    // and answers `SETUP`, because that screen was never set up. Found here, where three tests that
    // pass alone had one failing in the file's own run.
    cleanup()
    vi.clearAllMocks()
    clearStorage()
  })

  afterEach(() => {
    vi.useRealTimers()
    cleanup()
    delete (window as unknown as { electronAPI?: unknown }).electronAPI
  })

  function setupSpanishOnly() {
    installLibrary([{ id: 'libertad', title: 'Libertad', items: SPANISH_ONLY } as never])
    setupControlViewWithReadinessPassing()
    setSongLines(SPANISH_ONLY)
    setCurrentSongId('libertad')
    setCurrentSongTitle('Libertad')
    // **Nothing chosen on the Languages screen**, which is the state the walk was in: neither key
    // exists in the machine's storage.
    localStorage.removeItem('projectionLanguage')
    localStorage.removeItem('singingLanguage')
  }

  it('reaches READY_TO_ARM with no language ever chosen', async () => {
    setupSpanishOnly()
    render(<App initialHash="#/" />)
    await waitFor(() => {
      expect(standbyState()).toBe('READY_TO_ARM')
    }, { timeout: WAIT_TIMEOUT })
    expect((getArmButton() as HTMLButtonElement).disabled).toBe(false)
  })

  it('shows the pair as `ES → ES`, because the identity case is not a reason to show nothing', async () => {
    setupSpanishOnly()
    render(<App initialHash="#/" />)
    await waitFor(() => {
      expect(standbyState()).toBe('READY_TO_ARM')
    }, { timeout: WAIT_TIMEOUT })
    const column = [...document.querySelectorAll('.control-setup-section')].find((s) =>
      s.textContent?.includes('Lyrics display')
    )!
    expect(column.querySelector('.control-setup-value')?.textContent).toBe('ES → ES')
  })

  it('leaves Standby for the performing view when Arm is pressed', async () => {
    // **The ruling it was violating**: arm and unarm are the door between the control view and the
    // performing view, and only that door. Arming leaves the control view.
    setupSpanishOnly()
    render(<App initialHash="#/" />)
    await waitFor(() => {
      expect(standbyState()).toBe('READY_TO_ARM')
    }, { timeout: WAIT_TIMEOUT })

    await act(async () => {
      fireEvent.click(getArmButton())
    })

    expect(standbyState()).toBeNull()
    expect(document.querySelector('.control-masthead')).toBeNull()
    expect(screen.getByTestId('performance-state-label').textContent).toBe('Performance: Armed')
    expect(screen.getByTestId('performing-content')).toBeTruthy()
  })
})

describe('§6 non-video armed screen', () => {
  beforeEach(() => {
    cleanup()
    vi.clearAllMocks()
    clearStorage()
    installProductionLikeLibrary()
  })

  afterEach(() => {
    vi.useRealTimers()
    cleanup()
    delete (window as unknown as { electronAPI?: unknown }).electronAPI
  })

  it('Previous, Next, Restart, Unarm are all present in non-video armed screen', async () => {
    setupControlViewWithReadinessPassing()
    render(<App initialHash="#/" />)

    await waitFor(() => {
      expect(standbyState()).toBe('READY_TO_ARM')
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
      expect(standbyState()).toBe('READY_TO_ARM')
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
    const snapshot = installLibrary([songWithTempo, { id: 'pimiento', title: 'Pimiento', items: VALID_LINES }])
    saveSetlistStore(snapshot)
    setCurrentSongId('duelo')

    setupControlViewWithReadinessPassing()
    render(<App initialHash="#/" />)

    await waitFor(() => {
      expect(standbyState()).toBe('READY_TO_ARM')
    }, { timeout: WAIT_TIMEOUT })
    await act(async () => {
      fireEvent.click(getArmButton())
    })

    vi.useFakeTimers()
    act(() => { vi.advanceTimersByTime(5000) })
    vi.useRealTimers()

    // **NOTHING BEAT-RELATED EXISTS IN `manual` AT ALL** (Jorge, 2026-09-06). This song has a
    // tempo and no timeline, which is what makes it `manual`: he is the clock, so there is no
    // pulse drawn, no count-in, and **no Start step to run one** — R2's step is deleted, because
    // the indicator was its only observable effect.
    expect(screen.queryByTestId('beat-circle')).toBeNull()
    expect(screen.queryByRole('button', { name: /^start$/i })).toBeNull()
    // The bottom bar's third button is the plain Restart, as it is for any manual song.
    expect(screen.getByRole('button', { name: /^restart$/i })).toBeTruthy()
    // And there is still NO standalone Pause / dedicated beat-restart control overlaying phrases.
    expect(screen.queryByRole('button', { name: /^pause$/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /restart beat/i })).toBeNull()
  })

  it('BeatCircle is NOT rendered when the loaded song has no tempo (and there is no Start button)', async () => {
    // Standard library (no tempo on songs)
    setupControlViewWithReadinessPassing()
    render(<App initialHash="#/" />)

    await waitFor(() => {
      expect(standbyState()).toBe('READY_TO_ARM')
    }, { timeout: WAIT_TIMEOUT })
    await act(async () => {
      fireEvent.click(getArmButton())
    })

    expect(screen.queryByTestId('beat-circle')).toBeNull()
    expect(screen.queryByRole('button', { name: /^start$/i })).toBeNull()
  })

  it('a manual song with a tempo has no Start, no count-in and no beat circle (Luz y sal)', async () => {
    // **Luz y sal is the repro that produced R2**: a tempo, no media, no timeline. R2 gave it an
    // explicit Start so the count-in ran a bar before the first lyric. **That whole step is
    // deleted** (Jorge, 2026-09-06) — the indicator was its only observable effect, and nothing
    // beat-related exists in `manual` at all. Kept as a test because this song is exactly the
    // case the step was built for, so it is the one that would notice it coming back.
    const songWithTempo = {
      id: 'luz-y-sal',
      title: 'Luz y sal',
      items: VALID_LINES,
      tempo: { bpm: 140, numerator: 3, denominator: 4, countInBars: 1 },
    }
    installLibrary([songWithTempo])
    setupControlViewWithReadinessPassing()
    setCurrentSongId('luz-y-sal')
    render(<App initialHash="#/" />)

    await waitFor(() => {
      expect(standbyState()).toBe('READY_TO_ARM')
    }, { timeout: WAIT_TIMEOUT })
    await act(async () => {
      fireEvent.click(getArmButton())
    })

    expect(screen.queryByRole('button', { name: /^start$/i })).toBeNull()
    expect(screen.queryByTestId('beat-circle')).toBeNull()
    expect(screen.queryByTestId('beat-circle-count-in')).toBeNull()

    // **Next is enabled from the moment of arming**, because there is no step in front of it.
    // The first press reveals the first phrase, which is what moment 7 describes.
    expect((screen.getByRole('button', { name: /^next$/i }) as HTMLButtonElement).disabled).toBe(false)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^next$/i }))
    })
    expect(getSongIndex()).toBe(0)

    vi.useFakeTimers()
    act(() => { vi.advanceTimersByTime(5000) })
    vi.useRealTimers()

    // Still nothing: no clock was started, so none can appear later.
    expect(screen.queryByTestId('beat-circle')).toBeNull()
  })

  it('subsequent Next presses advance lyrics, with nothing beat-related in manual', async () => {
    const songWithTempo = {
      id: 'duelo',
      title: 'Duelo',
      items: VALID_LINES,
      tempo: { bpm: 120, numerator: 4, denominator: 4, countInBars: 1 },
    }
    installLibrary([songWithTempo])
    setupControlViewWithReadinessPassing()
    setCurrentSongId('duelo')
    render(<App initialHash="#/" />)

    await waitFor(() => {
      expect(standbyState()).toBe('READY_TO_ARM')
    }, { timeout: WAIT_TIMEOUT })
    await act(async () => {
      fireEvent.click(getArmButton())
    })

    // **This song is `manual`** — a tempo, no timeline — so the first press reveals the first
    // phrase and there is nothing beat-related to watch at any point.
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^next$/i }))
    })
    expect(getSongIndex()).toBe(0)
    expect(screen.queryByTestId('beat-circle')).toBeNull()

    // Second Next advances to line 1, the last lyric of this two-line song.
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^next$/i }))
    })
    expect(getSongIndex()).toBe(1)
    expect(screen.queryByTestId('beat-circle')).toBeNull()
  })

  it('the bottom bar carries one Restart, and never a Start', async () => {
    // R2 put a `Start` in this slot for a manual song with a tempo, and a second `Restart`
    // behind it that returned to the pre-Start state. **Both were the count-in's**, and the
    // count-in has left `manual` (Jorge, 2026-09-06), so there is one Restart and it is the
    // plain hold-to-confirm one every manual song has always had.
    const songWithTempo = {
      id: 'duelo',
      title: 'Duelo',
      items: VALID_LINES,
      tempo: { bpm: 120, numerator: 4, denominator: 4, countInBars: 1 },
    }
    installLibrary([songWithTempo])
    setupControlViewWithReadinessPassing()
    setCurrentSongId('duelo')
    render(<App initialHash="#/" />)

    await waitFor(() => {
      expect(standbyState()).toBe('READY_TO_ARM')
    }, { timeout: WAIT_TIMEOUT })
    await act(async () => {
      fireEvent.click(getArmButton())
    })

    expect(screen.queryByRole('button', { name: /^start$/i })).toBeNull()
    expect(screen.getAllByRole('button', { name: /^restart$/i })).toHaveLength(1)

    // It stays one Restart once the song is running: there is no state it flips between.
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^next$/i }))
    })
    expect(getSongIndex()).toBe(0)
    expect(screen.queryByRole('button', { name: /^start$/i })).toBeNull()
    expect(screen.getAllByRole('button', { name: /^restart$/i })).toHaveLength(1)
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
      timeline: [{ start: 0, end: 1 }, { start: 1, end: 2 }],
    }
    installLibrary([songWithVideo])
    // **THE VIDEO IS THE ROOM'S, NOT THE SONG'S** (Jorge, 2026-09-03). A song holds no media; the
    // `song-video` shape on the wall is told what this song puts in it, in `visuals.json`.
    installRoom({ assets: { duelo: { 'video-1': 'test.mp4' } } })
    // Provide a resolved path so the panel renders with video
    localStorage.setItem(MEDIA_PATH_STORE_KEY, JSON.stringify({ 'test.mp4': '/fake/path/test.mp4' }))

    setupControlViewWithReadinessPassing()
    // Override the song state to use the video song
    setSongLines(VALID_LINES)
    setCurrentSongId('duelo')

    render(<App initialHash="#/" />)

    await waitFor(() => {
      expect(standbyState()).toBe('READY_TO_ARM')
    }, { timeout: WAIT_TIMEOUT })
    // **The drive mode defaults to the most capable available** (Jorge, 2026-09-03), so a song the
    // room gives a video to is on `video` without anybody choosing it. Nothing is selected here.
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
      timeline: [{ start: 0, end: 1 }, { start: 1, end: 2 }],
    }
    installLibrary([songWithVideo])
    // **THE VIDEO IS THE ROOM'S, NOT THE SONG'S** (Jorge, 2026-09-03). A song holds no media; the
    // `song-video` shape on the wall is told what this song puts in it, in `visuals.json`.
    installRoom({ assets: { duelo: { 'video-1': 'test.mp4' } } })
    localStorage.setItem(MEDIA_PATH_STORE_KEY, JSON.stringify({ 'test.mp4': '/fake/path/test.mp4' }))

    setupControlViewWithReadinessPassing()
    setSongLines(VALID_LINES)
    setCurrentSongId('duelo')

    render(<App initialHash="#/" />)

    await waitFor(() => {
      expect(standbyState()).toBe('READY_TO_ARM')
    }, { timeout: WAIT_TIMEOUT })
    // **The drive mode defaults to the most capable available** (Jorge, 2026-09-03), so a song the
    // room gives a video to is on `video` without anybody choosing it. Nothing is selected here.
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

/**
 * **A video song driven by `manual` behaves like a non-video song** — the shape of §16's A2.2,
 * under the control that replaced the display mode. **Choosing the drive mode is what makes the
 * video run**, so choosing `manual` on a song the room gave a video is how you get the pedal flow
 * on it.
 */
describe('§16 a video song driven by hand behaves like a non-video song (performer view)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearStorage()
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
      timeline: [{ start: 0, end: 1 }, { start: 1, end: 2 }],
    }
    installLibrary([songWithVideo])
    // **THE VIDEO IS THE ROOM'S, NOT THE SONG'S** (Jorge, 2026-09-03). A song holds no media; the
    // `song-video` shape on the wall is told what this song puts in it, in `visuals.json`.
    installRoom({ assets: { duelo: { 'video-1': 'test.mp4' } } })
    localStorage.setItem(MEDIA_PATH_STORE_KEY, JSON.stringify({ 'test.mp4': '/fake/path/test.mp4' }))
    // **The shared helper, because a video song now needs a gig.** It carries the gig bridges the
    // arm gate reads through — a remembered folder with nothing behind it is a real, blocked state.
    return setupControlViewWithReadinessPassing()
  }

  it('performer view shows manual (non-video) flow, not VideoPerformancePanel, when armed with display mode None (default)', async () => {
    setupWithVideoSongDisplayNone()
    render(<App initialHash="#/" />)

    await waitFor(() => {
      expect(screen.getByTestId('drive-mode-manual')).toBeTruthy()
    }, { timeout: WAIT_TIMEOUT })

    // **The room gives this song a video, so it defaults to `video`.** Choose `manual` to exercise
    // the pedal flow with Next/Previous — `clock` would show Play/Pause transport instead.
    await act(async () => {
      fireEvent.click(screen.getByTestId('drive-mode-manual'))
    })

    await waitFor(() => {
      expect(standbyState()).toBe('READY_TO_ARM')
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

  it('shows the video panel without anybody choosing it, because video is the most capable', async () => {
    // **The default is the most capable available** — video, then clock, then manual — so the
    // common case is that Jorge touches nothing. **This overturns `getDefaultDisplayMode`'s
    // unconditional `'none'`**, whose reason was about the Videoclip control and did not survive
    // it: choosing `video` is still an explicit opt-in, just a performance one rather than a
    // format one.
    setupWithVideoSongDisplayNone()
    render(<App initialHash="#/" />)

    await waitFor(() => {
      expect(screen.getByTestId('drive-mode-video')).toBeTruthy()
    }, { timeout: WAIT_TIMEOUT })
    expect(screen.getByTestId('drive-mode-video').getAttribute('aria-pressed')).toBe('true')

    await waitFor(() => {
      expect(standbyState()).toBe('READY_TO_ARM')
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
    installLibrary([songWithTimeline])
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
    installLibrary([songNoTimeline])
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
    installLibrary([plainSong])
    setupControlViewWithReadinessPassing()
    setCurrentSongId('duelo')
  }

  async function armAndReachSetup() {
    render(<App initialHash="#/" />)
    await waitFor(() => {
      expect(standbyState()).not.toBeNull()
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

  /**
   * **DRIVE MODE REPLACED THE TRANSITIONS TOGGLE** (Jorge, 2026-09-03/04), and it replaced the
   * Videoclip toggle in the same move: those were the two axes the one control is assembled from.
   *
   * **Always three buttons**, so the control keeps the same shape song to song and can be hit
   * without looking — **only-the-possible was rejected**, because a control that changes shape per
   * song is harder to use at distance than one with a dead button in it.
   */
  it('offers three modes, always three, whatever the song can do', async () => {
    setupWithTimelineSong()
    await armAndReachSetup()

    expect(screen.getByText('Drive mode')).toBeTruthy()
    for (const mode of ['video', 'clock', 'manual']) {
      expect(screen.getByTestId(`drive-mode-${mode}`)).toBeTruthy()
    }
    expect(screen.queryByText('Transitions')).toBeNull()
    expect(screen.queryByText('Videoclip')).toBeNull()
  })

  it('defaults to the most capable available: clock for a timeline song with no video', async () => {
    setupWithTimelineSong()
    await armAndReachSetup()

    expect(screen.getByTestId('drive-mode-clock').getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByTestId('drive-mode-manual').getAttribute('aria-pressed')).toBe('false')
    expect(screen.getByTestId('drive-mode-video').getAttribute('aria-pressed')).toBe('false')
  })

  it('defaults to manual when the song can do nothing else', async () => {
    setupWithNeitherTempoNorTimelineSong()
    await armAndReachSetup()

    expect(screen.getByTestId('drive-mode-manual').getAttribute('aria-pressed')).toBe('true')
    // Still three buttons: the shape does not change with what the song can do.
    expect(screen.getByTestId('drive-mode-clock')).toBeTruthy()
    expect(screen.getByTestId('drive-mode-video')).toBeTruthy()
  })

  it('switches to a mode the song can do', async () => {
    setupWithTimelineSong()
    await armAndReachSetup()

    await act(async () => {
      fireEvent.click(screen.getByTestId('drive-mode-manual'))
    })
    expect(screen.getByTestId('drive-mode-manual').getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByTestId('drive-mode-clock').getAttribute('aria-pressed')).toBe('false')
  })

  /**
   * **A button that cannot act stays pressable and refuses, naming why in a popup** (Jorge,
   * 2026-09-04) — exactly as `Arm` does when the gig is not ready. **A disabled control with
   * nothing explaining it is forbidden, and an explanation is precisely what cannot be read across
   * a dark room**, which is why the refusal is a popup rather than a tooltip or a line at the
   * control. **No message ever appears in a control column.**
   */
  it('refuses a mode the song cannot do, in a popup, and changes nothing', async () => {
    setupWithNoTimelineSong()
    await armAndReachSetup()
    expect(screen.getByTestId('drive-mode-manual').getAttribute('aria-pressed')).toBe('true')

    await act(async () => {
      fireEvent.click(screen.getByTestId('drive-mode-clock'))
    })

    expect(screen.getByTestId('drive-mode-refusal-message').textContent).toBe(
      'This song has no timeline. Bombista makes one, in the song flow.'
    )
    expect(screen.getByTestId('drive-mode-manual').getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByTestId('drive-mode-clock').getAttribute('aria-pressed')).toBe('false')

    await act(async () => {
      fireEvent.click(screen.getByTestId('drive-mode-refusal-close'))
    })
    expect(screen.queryByTestId('drive-mode-refusal')).toBeNull()
  })

  it('says what the song is missing, in words about the song', async () => {
    // *This song has no video* is a fact he can act on — assign one in the room. *Unavailable* is
    // not.
    setupWithTimelineSong()
    await armAndReachSetup()
    await act(async () => {
      fireEvent.click(screen.getByTestId('drive-mode-video'))
    })
    expect(screen.getByTestId('drive-mode-refusal-message').textContent).toMatch(/no video/i)
  })

  /**
   * **THREE SQUARE BUTTONS, ONE ICON EACH, NO TEXT LABELS** (Jorge, 2026-09-06). The segmented
   * strip this replaces was a toolbar control on a surface read across a stage in the dark: three
   * words at 12.5px inside a shared 34px-tall box, in a column that is a quarter of the panel.
   * **The glyph is the label now**, and the button is a square big enough to hit without looking.
   *
   * **The icons are Jorge's own files and are used as supplied, never redrawn** — a lookalike
   * drawn here would be a second copy of a decision that already has an owner. They are imported
   * as modules rather than referenced out of `public/`, because a bare `/icons/...` string in a
   * component is the one asset reference Vite does not rewrite, and the packaged app loads over
   * `file://` where an absolute URL resolves to the filesystem root. **The failure would be
   * silent**: three empty squares, nothing in the console, exactly the shape of the missing-logo
   * bug that `#/folders` exists to make visible.
   *
   * **The accessible name survives the text going away.** Every other test in this file that
   * reaches a mode by `getByRole('button', { name: 'Manual' })` still works, because `aria-label`
   * carries what the text used to.
   */
  it('renders one icon per button, no text, and keeps the accessible name', async () => {
    setupWithTimelineSong()
    await armAndReachSetup()

    for (const [mode, name] of [
      ['video', 'Video'],
      ['clock', 'Clock'],
      ['manual', 'Manual'],
    ] as const) {
      const button = screen.getByTestId(`drive-mode-${mode}`)
      expect(button.textContent).toBe('')
      expect(button.getAttribute('aria-label')).toBe(name)

      const icons = button.querySelectorAll('img')
      expect(icons.length).toBe(1)
      // Its own file, not one icon reused three times.
      expect(icons[0]!.getAttribute('src')).toMatch(new RegExp(`icon-${mode}\\.png`))
      // Decorative: the button already carries the name, so the image must not repeat it.
      expect(icons[0]!.getAttribute('alt')).toBe('')
      expect(button.querySelector('svg')).toBeNull()
    }

    // Three separate squares, not one strip: the segmented container is gone from the screen.
    expect(document.querySelector('.ctrl-segmented')).toBeNull()
    expect(screen.getAllByTestId(/^drive-mode-(video|clock|manual)$/).length).toBe(3)
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

    // **There is no Start step to press** (Jorge, 2026-09-06): a manual song has no count-in and
    // no clock at all, so time passing has nothing to drive the index with in the first place.
    expect(screen.queryByRole('button', { name: /^start$/i })).toBeNull()

    // Time passing alone (even past both timeline windows) must not advance the index in Manual
    // mode.
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

  /**
   * **A SONG ENDS ONCE AND STAYS ENDED** (Jorge, 2026-09-06). *These were the most disturbing
   * moments of the walk* — the two things below happen in front of a room, with both hands on the
   * guitar, and there is no recovering from either without stopping to touch the app.
   *
   * **Two faces, one fault: a song had no ended state.** `computeAutoAdvanceIndex` answers `-1`
   * *before the first cue* and *after the last one*, and the drive took both as *no line showing* —
   * so a song on the clock, having played out, snapped back to index `-1`, **which is the intro
   * card on the wall and no end-of-song on the control screen.** The tile appeared and vanished and
   * the song looked like it had started again. In `manual` there was no end at all: `nextIndex`
   * clamps, so the last line stayed up, the song never finished, the setlist never closed **and
   * the message home was never reached.**
   */
  it('a song on the clock ends where its last cue does \u2014 it does not go back to the top', async () => {
    vi.useFakeTimers()
    setupWithTimelineSong()
    await armAndReachSetupFakeTimers()
    await act(async () => { fireEvent.click(getArmButton()) })
    // Count-in is 2000ms; the cue table is [0,2) and [2,100) seconds of song time.
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /^play$/i })) })
    act(() => { vi.advanceTimersByTime(2_000 + 2_500) })
    expect(getSongIndex()).toBe(1)

    // Past the last cue's end.
    act(() => { vi.advanceTimersByTime(100_000) })

    // **The index holds at the last line**, so `isEndOfSong` stays true and the tile still has a
    // reason to be there — it used to snap to -1 and take both away.
    expect(getSongIndex()).toBe(1)
    expect(getSongEnded()).toBe(true)
    // And the performance is logged by the ending itself, not by whichever control gets pressed.
    expect(playedSongIds()).toEqual(['duelo'])
    vi.useRealTimers()
  })

  it('a manual song ends on the press after its last line', async () => {
    setupWithNoTimelineSong()
    await armAndReachSetup()
    await act(async () => { fireEvent.click(getArmButton()) })

    const next = () => screen.getByRole('button', { name: /^next$/i })
    await act(async () => { fireEvent.click(next()) })
    await act(async () => { fireEvent.click(next()) })
    expect(getSongIndex()).toBe(1)
    // On the last line and still singing it: not ended.
    expect(getSongEnded()).toBe(false)
    expect(playedSongIds()).toEqual([])

    await act(async () => { fireEvent.click(next()) })
    // `nextIndex` clamps, so the index cannot move — **the press is the end, not the index.**
    expect(getSongIndex()).toBe(1)
    expect(getSongEnded()).toBe(true)
    expect(playedSongIds()).toEqual(['duelo'])
  })

  it('logs the performance once, however many ways the song is ended', async () => {
    // The clock got there first, then `Unarm` at the end of a song was pressed. **One entry per
    // performance** — the log's own rule — and `Unarm` used to add a second.
    vi.useFakeTimers()
    setupWithTimelineSong()
    await armAndReachSetupFakeTimers()
    await act(async () => { fireEvent.click(getArmButton()) })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /^play$/i })) })
    act(() => { vi.advanceTimersByTime(2_000 + 101_000) })
    expect(playedSongIds()).toEqual(['duelo'])

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /^Unarm/ })) })
    expect(playedSongIds()).toEqual(['duelo'])
    vi.useRealTimers()
  })

  it('does not carry the ending into the next song, or into a restart', async () => {
    // **The failure this guards is a whole song played to a black wall.** `loadLines` is the
    // navigation hook's and does not go through `setLoadedSong`, so the concert-session transition
    // ends one song and sets the next by hand — `setCurrentSong` is where the clear belongs.
    setupWithNoTimelineSong()
    await armAndReachSetup()
    await act(async () => { fireEvent.click(getArmButton()) })
    const next = () => screen.getByRole('button', { name: /^next$/i })
    await act(async () => { fireEvent.click(next()) })
    await act(async () => { fireEvent.click(next()) })
    await act(async () => { fireEvent.click(next()) })
    expect(getSongEnded()).toBe(true)

    vi.useFakeTimers()
    const restartBtn = screen.getByRole('button', { name: /^restart$/i })
    await act(async () => { fireEvent.pointerDown(restartBtn) })
    act(() => { vi.advanceTimersByTime(HOLD_CONFIRM_MS) })
    await act(async () => { fireEvent.pointerUp(restartBtn) })
    vi.useRealTimers()

    expect(getSongEnded()).toBe(false)
    expect(getSongIndex()).toBe(-1)
  })

  it('a manual song has no Start step: Next is live from the moment of arming', async () => {
    // **R2's Manual Start step is deleted** (Jorge, 2026-09-06). It disabled Next until a
    // count-in had run, and the indicator was the count-in's only observable effect — so with
    // the indicator gone from `manual` the step disabled a control to show nothing. What is
    // left is what moment 7 describes: the first press reveals the first phrase.
    setupWithTimelineSong()
    await armAndReachSetup()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Manual' }))
    })
    await act(async () => {
      fireEvent.click(getArmButton())
    })

    expect(screen.queryByRole('button', { name: /^start$/i })).toBeNull()
    expect(screen.getByRole('button', { name: /^restart$/i })).toBeTruthy()
    // Previous stays disabled before the first line — that gate is the index's, not the clock's.
    expect((screen.getByRole('button', { name: /^previous$/i }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: /^next$/i }) as HTMLButtonElement).disabled).toBe(false)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^next$/i }))
    })
    expect(getSongIndex()).toBe(0)
    expect(screen.queryByTestId('beat-circle')).toBeNull()

    // Restart is the plain hold-to-confirm one, and it returns to no line showing.
    vi.useFakeTimers()
    const restartBtn = screen.getByRole('button', { name: /^restart$/i })
    await act(async () => { fireEvent.pointerDown(restartBtn) })
    act(() => { vi.advanceTimersByTime(HOLD_CONFIRM_MS) })
    await act(async () => { fireEvent.pointerUp(restartBtn) })
    vi.useRealTimers()

    expect(getSongIndex()).toBe(-1)
    expect(screen.queryByRole('button', { name: /^start$/i })).toBeNull()
    expect((screen.getByRole('button', { name: /^next$/i }) as HTMLButtonElement).disabled).toBe(false)
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
      installLibrary([songWithTimelineV2])
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
      installLibrary([song])
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
      installLibrary(songs)
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
        expect(standbyState()).toBe('READY_TO_ARM')
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

  /**
   * Setup panel — the four columns share one line for their big value.
   *
   * Each column used to be its own independent grid, so the value row was only as tall as
   * whatever was left after that column's own buttons. Lyrics display carries two extra
   * controls, so its value floated ~100px above Song / Projection / Arm. Fixed by making the
   * outer container own the rows and each column a subgrid of it: the value row is then one
   * shared row, and the extras get a row of their own between value and buttons.
   */
  describe('Setup panel column alignment', () => {
    const setupCss = () => readFileSync(resolve(__dirname, 'control.css'), 'utf8')

    it('lets the outer container own the four rows, so every column shares them', () => {
      const outer = setupCss().match(
        /\.control-center-setup \.control-performance-state \{([^}]*)\}/
      )
      expect(outer).toBeTruthy()
      expect(outer![1]).toMatch(/grid-template-rows:\s*auto\s+minmax\(min-content,\s*1fr\)\s+auto\s+auto/)
    })

    it('makes each setup column a subgrid spanning those four rows', () => {
      const section = setupCss().match(
        /\.control-center-setup \.control-setup-section \{([^}]*)\}/
      )
      expect(section).toBeTruthy()
      expect(section![1]).toMatch(/grid-template-rows:\s*subgrid/)
      expect(section![1]).toMatch(/grid-row:\s*span\s+4/)
    })

    it('gives every column the same four children in the same order', async () => {
      setupControlViewWithReadinessPassing()
      await armAndReachSetup()
      const sections = document.querySelectorAll('.control-setup-section')
      expect(sections.length).toBeGreaterThan(1)
      sections.forEach((section) => {
        const classes = Array.from(section.children).map((c) => c.className)
        expect(classes).toEqual([
          'control-setup-label',
          'control-setup-content',
          'control-setup-extras',
          'control-setup-buttons',
        ])
      })
    })

    it('puts the transitions toggle in the extras row, not in the button row', async () => {
      setupWithTimelineSong() // a v2 timeline is what makes the Transitions toggle appear
      await armAndReachSetup()
      const toggle = document.querySelector('.control-setup-toggle-area')
      expect(toggle).toBeTruthy()
      expect(toggle!.closest('.control-setup-extras')).toBeTruthy()
      expect(toggle!.closest('.control-setup-buttons')).toBeNull()
    })
  })

  /**
   * Setup panel — every section gets a column, and they all sit in ONE row-block.
   *
   * The grid named four columns (`grid-template-columns: 1fr 1fr 1fr 1fr`) long after App grew
   * to six sections, so auto-placement wrapped the surplus — Rig and Arm — into a second
   * row-block that rendered on top of Gig and Song. Nothing errored; the columns just collided.
   *
   * jsdom does no layout, so the invariant is checked where it is authored: the grid must not
   * declare a fixed number of columns, and the number of sections App can render must fit
   * whatever it does declare. A seventh section fails here rather than wrapping in silence.
   */
  describe('Setup panel column count', () => {
    /** The declaration block of the setup grid, with CSS comments stripped. */
    const setupGridDeclarations = () => {
      const css = readFileSync(resolve(__dirname, 'control.css'), 'utf8')
      const block = css.match(/\.control-center-setup \.control-performance-state \{([^}]*)\}/)
      expect(block).toBeTruthy()
      return block![1].replace(/\/\*[\s\S]*?\*\//g, '')
    }

    /**
     * How many sections the grid can place before auto-placement folds one into a second
     * row-block. `Infinity` when it generates a column per item instead of naming a fixed set.
     */
    const declaredColumnCapacity = (declarations: string): number => {
      const template = declarations.match(/grid-template-columns:\s*([^;}]*)/)
      if (template) {
        const value = template[1].trim()
        const repeat = value.match(/^repeat\(\s*(\d+)\s*,/)
        return repeat ? Number(repeat[1]) : value.split(/\s+/).length
      }
      if (/grid-auto-flow:\s*column/.test(declarations) && /grid-auto-columns:/.test(declarations)) {
        return Infinity
      }
      return 1 // row flow with no column template: one implicit column, everything stacks
    }

    /**
     * Every `.control-setup-section` Standby can render, conditional ones included.
     *
     * **It reads `ControlView.tsx`, and it read `App.tsx` until 2026-09-06** — the screen moved
     * into its own file when the two products were separated, and this fixture reads the file the
     * screen is in.
     */
    const sectionsAppCanRender = () =>
      (readFileSync(resolve(__dirname, 'ControlView.tsx'), 'utf8').match(
        /className="control-setup-section"/g
      ) ?? []).length

    it('generates a column per section instead of naming a fixed number of them', () => {
      expect(declaredColumnCapacity(setupGridDeclarations())).toBe(Infinity)
    })

    it('has room for every section App can render, so none wraps into a second row-block', () => {
      const capacity = declaredColumnCapacity(setupGridDeclarations())
      const sections = sectionsAppCanRender()
      // Sanity on the fixture itself: this only guards anything while App has more sections
      // than the four the old fixed track list held.
      expect(sections).toBeGreaterThan(4)
      expect(sections).toBeLessThanOrEqual(capacity)
    })

    it('puts the sections it actually renders in that one row-block, as direct children', async () => {
      setupControlViewWithReadinessPassing()
      await armAndReachSetup()
      const grid = document.querySelector('.control-performance-state')
      expect(grid).toBeTruthy()
      const sections = grid!.querySelectorAll('.control-setup-section')
      expect(sections.length).toBeGreaterThan(1)
      expect(sections.length).toBeLessThanOrEqual(sectionsAppCanRender())
      expect(sections.length).toBeLessThanOrEqual(declaredColumnCapacity(setupGridDeclarations()))
      sections.forEach((section) => expect(section.parentElement).toBe(grid))
    })
  })

  /**
   * **The masthead carries the room's name and nothing else** (Jorge, 2026-09-05). The wordmark and
   * the by-line came off: **the tool does not introduce itself to someone who did not choose it**,
   * which is the argument that removed Bombista's header on 02/09 and Muralista's label on 04/09.
   *
   * Asserted as absences on purpose. **A test that only checked `Standby` is there would stay green
   * the day someone puts a wordmark back beside it**, and this is the third time the branding has
   * had to be argued off a screen.
   */
  describe('Setup screen masthead', () => {
    it('says the room and refuses to say anything else', async () => {
      setupControlViewWithReadinessPassing()
      await armAndReachSetup()
      const mast = document.querySelector('.control-masthead')
      expect(mast).toBeTruthy()
      expect(mast!.textContent).toContain('Standby')
      expect(mast!.textContent).not.toContain('Pregonero')
      expect(mast!.textContent).not.toContain('Live lyric translation')
      expect(mast!.textContent).not.toContain('Tramoya')
      expect(mast!.textContent).not.toContain('Chango Pepper')
      expect(mast!.textContent).not.toContain(APP_VERSION)
    })

    it('carries no `Performance: Setup` heading anywhere on Standby', async () => {
      // **Gone for a second reason on top of the masthead's**: *Performance* and *Setup* now name
      // the two halves of the split, so a label pairing them contradicts both. The state itself is
      // still on the screen — `ARM`'s button is pressable exactly when it is `READY_TO_ARM`.
      setupControlViewWithReadinessPassing()
      await armAndReachSetup()
      expect(document.body.textContent).not.toContain('Performance: Setup')
      expect(document.body.textContent).not.toContain('Performance: Ready to Arm')
      expect(standbyState()).not.toBeNull()
    })

    it('is gone once the song is armed — the stage view carries no branding', async () => {
      setupControlViewWithReadinessPassing()
      await armAndReachSetup()
      expect(document.querySelector('.control-masthead')).toBeTruthy()
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /^arm$/i }))
      })
      expect(document.querySelector('.control-masthead')).toBeNull()
    })
  })

  /**
   * **PREGONERO STORES NO TEMPO** (Jorge, 2026-09-05).
   *
   * §P9 was a performed tempo per song, typed into a box on Standby and kept in `localStorage`
   * under `llt.performedBpm.v1`. It scaled the recording's cue times and the pulse from one
   * number, so the two could not drift. **The whole of it is gone: tempo has one home and it is
   * the song file**, so there is no second number, nothing to scale against, and no question of
   * which reset clears it.
   *
   * What is asserted here is the absence and the consequence — a song's cue times are its own
   * timings, and the pulse is its own `tempo.bpm`.
   */
  describe('the song file is the only tempo', () => {
    const DECLARED = 60 // 1000ms per beat at 4/4 — easy arithmetic in tests

    function setupTempoSong() {
      const song = {
        id: 'duelo',
        title: 'Duelo',
        items: VALID_LINES,
        timelineVersion: 2,
        leadIn: { durationSec: 7.26, source: 'measured' as const, confidence: 'low' as const, apply: false },
        timeline: [{ start: 0, end: 6 }, { start: 6, end: 200 }],
        tempo: { bpm: DECLARED, numerator: 4, denominator: 4, countInBars: 1 },
      }
      installLibrary([song])
      setupControlViewWithReadinessPassing()
      setCurrentSongId('duelo')
    }

    it('offers no box to type a tempo into, for a song that declares one', async () => {
      vi.useFakeTimers()
      setupTempoSong()
      await armAndReachSetupFakeTimers()
      expect(screen.queryByTestId('performed-bpm-input')).toBeNull()
      expect(screen.getByRole('main').textContent).not.toContain('Performed tempo')
    })

    it('writes nothing to `llt.performedBpm.v1`, ever', async () => {
      // **The key is deleted rather than moved to a side**, so nothing in the app should be able
      // to bring it back. A machine that still holds one from an older build keeps it as inert
      // bytes — this app never reads it and never writes it.
      vi.useFakeTimers()
      setupTempoSong()
      await armAndReachSetupFakeTimers()
      await act(async () => { fireEvent.click(getArmButton()) })
      expect(localStorage.getItem('llt.performedBpm.v1')).toBeNull()
    })

    it("cues on the recording's own timings, unscaled", async () => {
      vi.useFakeTimers()
      setupTempoSong()
      await armAndReachSetupFakeTimers()
      await act(async () => { fireEvent.click(getArmButton()) })
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: /^next$/i })) })
      expect(getSongIndex()).toBe(0)

      // Line 1 is due at 6.000s of song time, which is what the song file says.
      act(() => { vi.advanceTimersByTime(5_900) })
      expect(getSongIndex()).toBe(0)
      act(() => { vi.advanceTimersByTime(200) })
      expect(getSongIndex()).toBe(1)
    })

    it("pulses at the song file's own tempo", async () => {
      vi.useFakeTimers()
      setupTempoSong()
      await armAndReachSetupFakeTimers()
      await act(async () => { fireEvent.click(getArmButton()) })

      // At 60bpm a beat lasts 1000ms, so 1500ms in reads beat 2 at 4/4.
      act(() => { vi.advanceTimersByTime(1_500) })
      expect(screen.getByTestId('beat-circle-beat-number').textContent).toBe('2')
    })

    it("never writes tempo.bpm — the recording's tempo survives in the song library", async () => {
      vi.useFakeTimers()
      setupTempoSong()
      await armAndReachSetupFakeTimers()
      await act(async () => { fireEvent.click(getArmButton()) })
      expect(getLibrarySongById('duelo')?.tempo?.bpm).toBe(DECLARED)
    })
  })

  /**
   * §P6 — Next/Previous drops the song into Manual for the remainder of the song.
   *
   * The bug: the auto-advance effect recomputed the index from elapsed time on every tick and
   * snapped to it, so a manual Next reverted within a tick. The buttons LOOKED like a safety
   * net and were not one — and they failed exactly when drift shows up mid-song and the
   * instinct is to tap Next.
   */
  describe('§P6 manual override takes the wheel', () => {
    function setupOverrideSong() {
      const song = {
        id: 'duelo',
        title: 'Duelo',
        items: VALID_LINES,
        timelineVersion: 2,
        leadIn: { durationSec: 7.26, source: 'measured' as const, confidence: 'low' as const, apply: false },
        // Line 0 owns a long window, so Auto would keep snapping back to it for 5.84s.
        timeline: [{ start: 0, end: 5.84 }, { start: 5.84, end: 200 }],
      }
      installLibrary([song])
      setupControlViewWithReadinessPassing()
      setCurrentSongId('duelo')
    }

    async function armAndCue() {
      await armAndReachSetupFakeTimers()
      await act(async () => { fireEvent.click(getArmButton()) })
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: /^next$/i })) })
    }

    it('THE P6 BUG: a mid-song Next advances the line and it STAYS advanced', async () => {
      vi.useFakeTimers()
      setupOverrideSong()
      await armAndCue()
      expect(getSongIndex()).toBe(0)

      // 1s into line 0's [0, 5.84) window — Auto is actively holding index 0 here.
      act(() => { vi.advanceTimersByTime(1000) })
      expect(getSongIndex()).toBe(0)

      // The performer takes the wheel.
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: /^next$/i })) })
      expect(getSongIndex()).toBe(1)

      // Pre-P6 the very next tick recomputed 1000ms → index 0 and snapped it back.
      act(() => { vi.advanceTimersByTime(100) })
      expect(getSongIndex()).toBe(1)
      // And it stays taken for the rest of the song, not just for a tick.
      act(() => { vi.advanceTimersByTime(3000) })
      expect(getSongIndex()).toBe(1)
    })

    it('a mid-song Previous takes the wheel the same way', async () => {
      vi.useFakeTimers()
      setupOverrideSong()
      await armAndCue()
      // Get to line 1 via Auto so Previous has somewhere to go back to.
      act(() => { vi.advanceTimersByTime(5_840 + 100) })
      expect(getSongIndex()).toBe(1)

      await act(async () => { fireEvent.click(screen.getByRole('button', { name: /^previous$/i })) })
      expect(getSongIndex()).toBe(0)

      // Auto would have snapped straight back to 1 (elapsed is past 5.84s).
      act(() => { vi.advanceTimersByTime(500) })
      expect(getSongIndex()).toBe(0)
    })

    it('the override is visible — the performer can see at a glance that the song is no longer driving itself', async () => {
      vi.useFakeTimers()
      setupOverrideSong()
      await armAndCue()
      expect(screen.queryByTestId('manual-override-badge')).toBeNull()

      await act(async () => { fireEvent.click(screen.getByRole('button', { name: /^next$/i })) })
      expect(screen.getByTestId('manual-override-badge')).toBeTruthy()
    })

    it('the cue press itself is not an override — Auto still drives the song after the first Next', async () => {
      vi.useFakeTimers()
      setupOverrideSong()
      await armAndCue()

      expect(screen.queryByTestId('manual-override-badge')).toBeNull()
      // Auto advances to line 1 on its own at 5.84s, proving it was never dropped.
      act(() => { vi.advanceTimersByTime(5_840 + 100) })
      expect(getSongIndex()).toBe(1)
    })

    it('Restart clears the override — the song drives itself again', async () => {
      vi.useFakeTimers()
      setupOverrideSong()
      await armAndCue()
      act(() => { vi.advanceTimersByTime(1000) })
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: /^next$/i })) })
      expect(screen.getByTestId('manual-override-badge')).toBeTruthy()

      // Once the override is taken the song is Manual, so Restart is the hold-to-confirm
      // control (guarding against an accidental mid-song reset), not a plain click.
      await act(async () => {
        fireEvent.pointerDown(screen.getByRole('button', { name: /restart/i }))
      })
      act(() => { vi.advanceTimersByTime(HOLD_CONFIRM_MS) })
      expect(screen.queryByTestId('manual-override-badge')).toBeNull()

      // Cue again and let Auto drive.
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: /^next$/i })) })
      expect(getSongIndex()).toBe(0)
      act(() => { vi.advanceTimersByTime(5_840 + 100) })
      expect(getSongIndex()).toBe(1)
    })

    it('the override is not sticky across arms — unarming and re-arming clears it', async () => {
      vi.useFakeTimers()
      setupOverrideSong()
      await armAndCue()
      act(() => { vi.advanceTimersByTime(1000) })
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: /^next$/i })) })
      expect(screen.getByTestId('manual-override-badge')).toBeTruthy()

      // The override moved us to the last line, so this is the end-of-song state where Unarm is
      // a plain click (no hold guard — there is nothing left to lose).
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /^Unarm/ }))
      })
      expect(standbyState()).toBe('READY_TO_ARM')

      await act(async () => { fireEvent.click(getArmButton()) })
      expect(screen.queryByTestId('manual-override-badge')).toBeNull()

      await act(async () => { fireEvent.click(screen.getByRole('button', { name: /^next$/i })) })
      act(() => { vi.advanceTimersByTime(5_840 + 100) })
      expect(getSongIndex()).toBe(1)
    })
  })
})

describe('the setlist is played once', () => {
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

  it('offers no next-song tile once the setlist is done, so a repeat cannot resume it', async () => {
    vi.useFakeTimers()
    setActiveSetlistSongIds(['duelo', 'pimiento'])
    setupControlViewWithReadinessPassing()
    const { unmount } = render(<App initialHash="#/" />)

    await act(async () => { await Promise.resolve() })
    await act(async () => { fireEvent.click(getArmButton()) })
    await navigateToLastLyric()
    act(() => { vi.advanceTimersByTime(6_000) })

    // Walk the setlist through: duelo, then pimiento via the tile.
    await act(async () => { fireEvent.click(screen.getByTestId('next-song-tile')) })
    expect(getCurrentSongId()).toBe('pimiento')

    // pimiento is one line in this library, so one Next reaches its last lyric.
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Next' })) })
    act(() => { vi.advanceTimersByTime(6_000) })
    expect(screen.queryByTestId('next-song-tile')).toBeNull()

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /^Unarm/ })) })
    expect(playedSongIds()).toEqual(['duelo', 'pimiento'])

    // The repeat: duelo again, from the top. Before this change `nextSongForTile` was computed
    // from duelo's index in the setlist, so the app would have offered Pimiento a second time
    // and silently restarted the running order.
    unmount()
    setupControlViewWithReadinessPassing()
    render(<App initialHash="#/" />)
    await act(async () => { await Promise.resolve() })
    await act(async () => { fireEvent.click(getArmButton()) })
    await navigateToLastLyric()
    act(() => { vi.advanceTimersByTime(6_000) })

    expect(screen.getByText('Mundo')).toBeTruthy()
    expect(screen.queryByTestId('next-song-tile')).toBeNull()
    expect(screen.getByRole('button', { name: /^Unarm/ }).textContent).toBe('Unarm')

    // Ending the repeat returns to the end-of-setlist state and appends a second performance.
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /^Unarm/ })) })
    expect(playedSongIds()).toEqual(['duelo', 'pimiento', 'duelo'])
    expect(screen.queryByTestId('next-song-tile')).toBeNull()
  })

  it('records the finished song with a real end time and the time it was loaded', async () => {
    setActiveSetlistSongIds(['duelo', 'pimiento'])
    setupControlViewWithReadinessPassing()
    render(<App initialHash="#/" />)

    await waitFor(() => {
      expect(standbyState()).toBe('READY_TO_ARM')
    }, { timeout: WAIT_TIMEOUT })
    await act(async () => { fireEvent.click(getArmButton()) })
    await navigateToLastLyric()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /^Unarm/ })) })

    const log = getPlayedSongs()
    expect(log).toHaveLength(1)
    expect(log[0].songId).toBe('duelo')
    expect(log[0].endedAt).not.toBeNull()
    expect(log[0].startedAt).not.toBeNull()
    expect(Date.parse(log[0].endedAt as string)).toBeGreaterThanOrEqual(
      Date.parse(log[0].startedAt as string)
    )
  })

  it('does not record a song the performer unarmed away from before the end', async () => {
    setActiveSetlistSongIds(['duelo', 'pimiento'])
    setupControlViewWithReadinessPassing()
    setSongIndex(0)
    render(<App initialHash="#/" />)

    await waitFor(() => {
      expect(standbyState()).toBe('READY_TO_ARM')
    }, { timeout: WAIT_TIMEOUT })
    await act(async () => { fireEvent.click(getArmButton()) })

    const unarmBtn = screen.getByRole('button', { name: /^Unarm/ })
    vi.useFakeTimers()
    await act(async () => { fireEvent.pointerDown(unarmBtn) })
    act(() => { vi.advanceTimersByTime(HOLD_CONFIRM_MS) })
    await act(async () => { fireEvent.pointerUp(unarmBtn) })

    expect(getPlayedSongs()).toEqual([])
  })
})

// ── The contact panel's condition, written through from the window that can answer it ────────

describe('The contact panel condition is broadcast from the control window', () => {
  const WAIT_TIMEOUT = 3000

  beforeEach(() => {
    cleanup()
    vi.clearAllMocks()
    clearStorage()
    installProductionLikeLibrary()
  })

  afterEach(() => {
    vi.useRealTimers()
    cleanup()
    delete (window as unknown as { electronAPI?: unknown }).electronAPI
  })

  function lit(): boolean {
    // **The channel carries the answer and, since 2026-09-06, the content with it** — the
    // Projection window cannot read the gig folder, so the four fields go where the boolean goes.
    // Read through the module's own reader rather than re-parsing the key here.
    return getContactLitBroadcast()
  }

  /**
   * The Projection window is handed the answer, not the inputs — `armed` is this window's session,
   * the played log is this window's session, and the playable setlist is its readiness snapshot.
   * What is asserted here is that the answer is written **on every change of the value**, not only
   * inside a click handler: the reader takes it at mount, so a broadcast that only moved on a
   * click would go stale against a fresh session's own state.
   */
  it('writes the answer at mount, before anything is armed', async () => {
    setupControlViewWithReadinessPassing()
    render(<App initialHash="#/" />)
    await waitFor(() => {
      expect(standbyState()).toBe('READY_TO_ARM')
    }, { timeout: WAIT_TIMEOUT })
    // Nothing is armed, so the wall carries his details.
    expect(lit()).toBe(true)
  })

  /**
   * **SUPERSEDED, 2026-09-06.** This asserted that unarming lit the message home again. It does
   * not: *arming and unarming move Jorge between rooms; they never move the gig between states.*
   * **The first arm enters the setlist and nothing takes that back**, so a mid-setlist unarm leaves
   * the gig `during` and the wall black. **Cowork proposed the old behaviour and Jorge overruled
   * it** — the message home returns when the last song ends, and only then.
   */
  it('goes dark on arm and STAYS dark on a mid-setlist unarm', async () => {
    setupControlViewWithReadinessPassing()
    render(<App initialHash="#/" />)
    await waitFor(() => {
      expect(standbyState()).toBe('READY_TO_ARM')
    }, { timeout: WAIT_TIMEOUT })
    expect(lit()).toBe(true)

    await act(async () => { fireEvent.click(getArmButton()) })
    await waitFor(() => expect(lit()).toBe(false), { timeout: WAIT_TIMEOUT })

    vi.useFakeTimers()
    const unarmBtn = screen.getByRole('button', { name: /^Unarm/ })
    await act(async () => { fireEvent.pointerDown(unarmBtn) })
    act(() => { vi.advanceTimersByTime(HOLD_CONFIRM_MS) })
    vi.useRealTimers()

    // Still inside the setlist. Jorge left the room; the gig did not.
    expect(lit()).toBe(false)
  })
})

// ── The gig column says which night, never which folder ──────────────────────────────────────
//
// **Jorge, 2026-09-03.** The column that answers *which gig is this* rendered `gigReadiness.gigId`,
// and since 03/09 that is an opaque ten-character id — so the stage read `k3f9x2abcd`. Backstage
// was fixed for exactly this the same day, with `gigLabels.ts`; the control view was missed.
//
// **One owner**: `gigFile.gigLabelFrom`. A second rendering of *what a gig is called* is how the
// row and the stage start disagreeing.

describe('the gig column', () => {
  beforeEach(() => {
    cleanup()
    vi.clearAllMocks()
    clearStorage()
    installProductionLikeLibrary()
  })

  afterEach(() => {
    cleanup()
    delete (window as unknown as { electronAPI?: unknown }).electronAPI
  })

  it('reads No gig from nothing', async () => {
    render(<App initialHash="#/" />)
    await waitFor(() => {
      expect(screen.getByTestId('control-gig-value').textContent).toBe('No gig')
    }, { timeout: 3000 })
  })
})
