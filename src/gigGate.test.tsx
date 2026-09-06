/** @vitest-environment jsdom */
/**
 * The two views of the readiness delta this stage ships: the report when a gig is opened, and the
 * hard gate at arm time. Both render `computeGigReadiness`; neither decides anything.
 *
 * The gig folder is mocked at the platform seam, which is the one module that knows Electron
 * exists — the same seam the real app goes through.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import { installRequiredFolders } from './testSupport/folders'
import { render, screen, act, waitFor, within, cleanup, fireEvent } from '@testing-library/react'
import type { SongItem } from './songState'
import { setBlank, setCurrentSongId, setProjectionLanguage, setSingingLanguage, setSongIndex, setSongLines } from './songState'
import { dropLibraryCache, type LibrarySong } from './setlistStore'
import { getPlayedSongs } from './playedSongsState'
import { installLibrary } from './testSupport/library'
import { standbyState } from './testSupport/standbyState'

const readGigFolder = vi.fn()
const writeGigFile = vi.fn()
const validateSongForPerformance = vi.fn()
const fileExists = vi.fn()
const readSongFileText = vi.fn()

const describeDisplays = vi.fn()

vi.mock('./platform', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  projectionPlacement: () => Promise.resolve({ placed: false, reason: null, display: null }),
  canRunBombista: () => false,
  canHostTools: () => false,
  runBombista: vi.fn(),
  bombistaVersion: vi.fn(),
  bombistaStagingDir: vi.fn(),
  openTool: vi.fn(),
  openBombistaReview: vi.fn(),
  closeTool: vi.fn(),
  chooseFilePath: vi.fn(),
  describeDisplays: (...a: unknown[]) => describeDisplays(...a),
  hasGigFolderAccess: () => true,
  readSongFileText: (...a: unknown[]) => readSongFileText(...a),
  readGigFolder: (...a: unknown[]) => readGigFolder(...a),
  writeGigFile: (...a: unknown[]) => writeGigFile(...a),
  validateSongForPerformance: (...a: unknown[]) => validateSongForPerformance(...a),
  fileExists: (...a: unknown[]) => fileExists(...a),
}))

const PlayerRoot = (await import('./PlayerRoot')).PlayerRoot
const { rememberGigFolder, resetGigSession } = await import('./gigSession')

const FOLDER = '/gigs/setup/k3f9x2abcd'
const GIG_ID = 'k3f9x2abcd'
const WAIT_TIMEOUT = 3000

const LINES: SongItem[] = [
  { languages: { es: 'Hola', en: 'Hello' } },
  { languages: { es: 'Mundo', en: 'World' } },
]

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
    return { readyState: 1, send: vi.fn(), close: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() }
  }))
})

/** The played log flattened to ids, for the assertions that only care about the order. */
function playedSongIds(): string[] {
  return getPlayedSongs().map((e) => e.songId)
}

function song(id: string, title: string): LibrarySong {
  return { id, title, items: LINES } as LibrarySong
}

function gigJson(setlist: string[]) {
  return JSON.stringify({
    gigVersion: 1,
    id: GIG_ID,
    date: '2026-09-12',
    venue: { name: 'Bar Eduard', city: 'Ghent' },
    visuals: './visuals.json',
    songs: setlist.map((id) => ({ id, title: id, file: `${id}.json` })),
    setlist,
  })
}

function visualsJson(defaults: Record<string, string[]>, gigId = GIG_ID) {
  return JSON.stringify({
    visualsVersion: 1,
    gigId,
    shapes: [{ id: 'lyr', layer: { type: 'song-lyrics' } }],
    songVisuals: { defaults, songs: {} },
  })
}

function folderRead(overrides: Record<string, unknown> = {}) {
  return {
    folderPath: FOLDER,
    gigText: null,
    gigError: null,
    gigPresent: false,
    visualsText: null,
    visualsError: null,
    visualsPresent: false,
    ...overrides,
  }
}

beforeEach(() => {
  localStorage.clear()
  installRequiredFolders()
  sessionStorage.clear()
  dropLibraryCache()
  vi.clearAllMocks()
  resetGigSession()
  writeGigFile.mockResolvedValue({ ok: true })
  validateSongForPerformance.mockResolvedValue({ status: 'skipped', reason: 'bombista is not on PATH' })
  fileExists.mockResolvedValue(true)
  describeDisplays.mockResolvedValue({ count: 1, displays: [], fingerprint: '1728x1117@2*' })
  // Adopting `gig.json`'s running order re-reads any song it points somewhere new.
  readSongFileText.mockImplementation((path: string) => {
    const id = String(path).split('/').pop()!.replace(/\.json$/, '')
    return Promise.resolve({
      ok: true,
      text: JSON.stringify({
        title: id.charAt(0).toUpperCase() + id.slice(1),
        lyrics: [
          { es: 'Hola', en: 'Hello' },
          { es: 'Mundo', en: 'World' },
        ],
      }),
    })
  })
  installLibrary([song('duelo', 'Duelo'), song('vidas', 'Vidas')])
})

afterEach(() => {
  cleanup()
  window.location.hash = ''
  delete (window as unknown as { electronAPI?: unknown }).electronAPI
})

function armableControlSetup() {
  sessionStorage.setItem('liveLyricLaunched', '1')
  setSongLines(LINES)
  setSongIndex(-1)
  setBlank(true)
  setCurrentSongId('duelo')
  setProjectionLanguage('en')
  setSingingLanguage('es')
  ;(window as unknown as { electronAPI?: unknown }).electronAPI = {
    isProjectionOpen: vi.fn().mockResolvedValue(true),
    onProjectionOpened: vi.fn(() => vi.fn()),
    onProjectionClosed: vi.fn(() => vi.fn()),
    openProjection: vi.fn().mockResolvedValue(undefined),
    closeProjection: vi.fn().mockResolvedValue(undefined),
  }
}

async function renderAt(hash: string) {
  await act(async () => {
    render(<PlayerRoot initialHash={hash} />)
  })
}

/**
 * **The player's half of a test that used to cross the seam** (2026-09-06, the repo split).
 *
 * The hard gate at arm time, on the setlist screen, and the running order derived against the
 * playable setlist. These rendered through a helper that chose between the shell's root and the
 * player's; here there is only the player's, because that is the only root this repository has.
 *
 * The gig report they were filed with — what the shell says when a gig is opened — stayed in
 * Tramoya, at `#/gig/steps`.
 */

describe('the hard gate at arm time', () => {
  it('does not block anything while no gig is open', async () => {
    armableControlSetup()
    await renderAt('#/')
    await waitFor(
      () => expect(standbyState()).toBe('READY_TO_ARM'),
      { timeout: WAIT_TIMEOUT }
    )
    expect(screen.queryByTestId('arm-blocked-reasons')).toBeNull()
  })

  it('refuses to arm a song the gig carries nowhere, and says why when pressed', async () => {
    // **The reasons moved out of the column and into a popup** (2026-09-06): a column shows a
    // state, never a message, and this panel is read across a stage in the dark. **`Arm` stays
    // pressable and says why it cannot act**, which is the same behaviour a drive-mode button has.
    armableControlSetup()
    rememberGigFolder(FOLDER)
    readGigFolder.mockResolvedValue(
      folderRead({
        gigPresent: true,
        gigText: gigJson(['duelo', 'vidas']),
        visualsPresent: true,
        visualsText: visualsJson({}),
      })
    )
    await renderAt('#/')
    await waitFor(() => expect(standbyState()).toBe('SETUP'), { timeout: WAIT_TIMEOUT })

    // Nothing is said until it is asked for.
    expect(screen.queryByTestId('arm-refusal')).toBeNull()

    const main = screen.getByRole('main')
    const arm = within(main).getByRole('button', { name: 'Arm' })
    expect(arm.getAttribute('aria-disabled')).toBe('true')
    await act(async () => {
      fireEvent.click(arm)
    })

    expect(screen.getByTestId('arm-refusal-reasons').textContent).toMatch(
      /no shape carries this song/
    )
    // Still not armed: a refusal is a refusal.
    expect(standbyState()).toBe('SETUP')
  })

  it('says the escape hatch out loud, in the popup', async () => {
    armableControlSetup()
    rememberGigFolder(FOLDER)
    readGigFolder.mockResolvedValue(
      folderRead({
        gigPresent: true,
        gigText: gigJson(['duelo', 'vidas']),
        visualsPresent: true,
        visualsText: visualsJson({}),
      })
    )
    await renderAt('#/')
    await waitFor(() => expect(standbyState()).toBe('SETUP'), { timeout: WAIT_TIMEOUT })
    await act(async () => {
      fireEvent.click(within(screen.getByRole('main')).getByRole('button', { name: 'Arm' }))
    })
    expect(screen.getByTestId('arm-refusal-reasons').textContent).toMatch(/Muralista/)
  })

  it('arms a song the gig-level lyrics shape carries, with no per-song setup at all', async () => {
    armableControlSetup()
    rememberGigFolder(FOLDER)
    readGigFolder.mockResolvedValue(
      folderRead({
        gigPresent: true,
        gigText: gigJson(['duelo', 'vidas']),
        visualsPresent: true,
        visualsText: visualsJson({ 'song-lyrics': ['lyr'] }),
      })
    )
    await renderAt('#/')
    await waitFor(
      () => expect(standbyState()).toBe('READY_TO_ARM'),
      { timeout: WAIT_TIMEOUT }
    )
    expect(screen.queryByTestId('arm-blocked-reasons')).toBeNull()
  })

  it('summarises the gig in the setup panel', async () => {
    armableControlSetup()
    rememberGigFolder(FOLDER)
    readGigFolder.mockResolvedValue(
      folderRead({
        gigPresent: true,
        gigText: gigJson(['duelo', 'vidas']),
        visualsPresent: true,
        visualsText: visualsJson({ 'song-lyrics': ['lyr'] }),
      })
    )
    await renderAt('#/')
    // **The gig's NAME, never the folder's opaque id** (Jorge, 2026-09-03) — the same rule
    // Backstage's rows follow, through the same `gigLabelFrom`.
    await waitFor(
      () => expect(screen.getByTestId('control-gig-value').textContent).toBe('2026-09-12 · Bar Eduard'),
      { timeout: WAIT_TIMEOUT }
    )
    expect(screen.getByTestId('control-gig-value').textContent).not.toContain(GIG_ID)
    // **The summary paragraph is gone from this column** (2026-09-06). It said *Setup is not
    // confirmed* beside the gig's name, and **a column shows a state, never a message.** The
    // confirmation is still a milestone rather than a lock — the gig arms anyway — and the screen
    // that says so line by line is the gig flow's sign-off, one press away through `Setup`.
    expect(screen.queryByTestId('control-gig-summary')).toBeNull()
    expect(standbyState()).toBe('READY_TO_ARM')
  })
})

describe('the hard gate on the setlist screen', () => {
  it('makes a song the gig carries nowhere unselectable', async () => {
    sessionStorage.setItem('liveLyricLaunched', '1')
    rememberGigFolder(FOLDER)
    readGigFolder.mockResolvedValue(
      folderRead({
        gigPresent: true,
        gigText: gigJson(['duelo', 'vidas']),
        visualsPresent: true,
        visualsText: visualsJson({}),
      })
    )
    // The report is computed when the control screen is opened; the setlist screen renders it.
    await renderAt('#/')
    await waitFor(() => expect(readGigFolder).toHaveBeenCalled(), { timeout: WAIT_TIMEOUT })
    cleanup()
    await renderAt('#/songs')
    const blocked = screen.getByTestId('songs-song-blocked-duelo')
    expect(blocked.hasAttribute('disabled')).toBe(true)
    expect(blocked.textContent).toMatch(/no shape carries this song/)
  })

  it('will not confirm a blocked song even if it was already selected', async () => {
    sessionStorage.setItem('liveLyricLaunched', '1')
    setCurrentSongId('duelo')
    setSongLines(LINES)
    rememberGigFolder(FOLDER)
    readGigFolder.mockResolvedValue(
      folderRead({
        gigPresent: true,
        gigText: gigJson(['duelo', 'vidas']),
        visualsPresent: true,
        visualsText: visualsJson({}),
      })
    )
    await renderAt('#/')
    await waitFor(() => expect(readGigFolder).toHaveBeenCalled(), { timeout: WAIT_TIMEOUT })
    cleanup()
    await renderAt('#/songs')
    expect(screen.getByRole('button', { name: 'Confirm' }).hasAttribute('disabled')).toBe(true)
  })

  it('leaves every song selectable while no gig is open', async () => {
    sessionStorage.setItem('liveLyricLaunched', '1')
    await renderAt('#/songs')
    expect(screen.queryByTestId('songs-song-blocked-duelo')).toBeNull()
  })
})

describe('the running order is derived against the playable setlist', () => {
  /**
   * The predicate the prompt for this stage calls the easiest thing to get wrong, and the one
   * that fails at the end of a real night rather than in CI.
   *
   * `vidas` sits in the middle of the authored setlist and the gig carries it nowhere. Anything
   * derived against the authored list would offer it as the next song and then wait forever for
   * it to be played; derived against the playable list it is simply not in the night.
   */
  /**
   * `setlist` is the running order the app actually holds *and* what the gig file says, so the
   * two agree — the gig file is Pregonero's own setlist written down, not a second copy.
   */
  function openGigWhereVidasIsNotCarried(setlist: string[]) {
    const titles: Record<string, string> = { duelo: 'Duelo', vidas: 'Vidas', pimiento: 'Pimiento' }
    installLibrary(setlist.map((id) => song(id, titles[id]!)))
    rememberGigFolder(FOLDER)
    readGigFolder.mockResolvedValue(
      folderRead({
        gigPresent: true,
        gigText: gigJson(setlist),
        visualsPresent: true,
        visualsText: JSON.stringify({
          visualsVersion: 1,
          gigId: GIG_ID,
          shapes: [{ id: 'lyr', layer: { type: 'song-lyrics' } }],
          songVisuals: { defaults: { 'song-lyrics': ['lyr'] }, songs: { vidas: { 'song-lyrics': ['deleted'] } } },
        }),
      })
    )
  }

  async function armAndFinishCurrentSong() {
    const main = screen.getByRole('main')
    await act(async () => {
      fireEvent.click(within(main).getByRole('button', { name: 'Arm' }))
    })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Next' })) })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Next' })) })
  }

  afterEach(() => {
    vi.useRealTimers()
  })

  /** Lets the gig folder read settle, then takes the clock so the tile's delay costs nothing. */
  async function settleThenFakeTimers() {
    await waitFor(
      () => expect(screen.getByTestId('control-gig-value').textContent).toBe('2026-09-12 · Bar Eduard'),
      { timeout: WAIT_TIMEOUT }
    )
    vi.useFakeTimers()
  }

  async function waitOutTheTileDelay() {
    await act(async () => {
      vi.advanceTimersByTime(6_100)
    })
  }

  it('skips a middle song the gig carries nowhere, rather than offering it', async () => {
    armableControlSetup()
    openGigWhereVidasIsNotCarried(['duelo', 'vidas', 'pimiento'])
    await renderAt('#/')
    await settleThenFakeTimers()
    await armAndFinishCurrentSong()
    await waitOutTheTileDelay()
    expect(screen.getByTestId('next-song-tile').textContent).toMatch(/Pimiento/)
    expect(screen.getByTestId('next-song-tile').textContent).not.toMatch(/Vidas/)
  })

  it('ends the gig on the last playable song, so a trailing unplayable one cannot wedge it', async () => {
    // `vidas` is last in the authored setlist and the gig carries it nowhere, so it will never be
    // played. Derived against the authored list, "the setlist is done" would never become true:
    // the gig would never end, and a repeat would silently restart the running order. That is
    // found at the end of a real night, not in CI.
    armableControlSetup()
    openGigWhereVidasIsNotCarried(['duelo', 'pimiento', 'vidas'])
    await renderAt('#/')
    await settleThenFakeTimers()

    await armAndFinishCurrentSong()
    await waitOutTheTileDelay()
    await act(async () => { fireEvent.click(screen.getByTestId('next-song-tile')) })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Next' })) })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Next' })) })
    await waitOutTheTileDelay()
    expect(screen.queryByTestId('next-song-tile')).toBeNull()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /^Unarm/ })) })
    expect(playedSongIds()).toEqual(['duelo', 'pimiento'])

    // The repeat. `vidas` is still unplayed and always will be, so the only thing that can make
    // this right is the predicate reading the playable setlist.
    vi.useRealTimers()
    cleanup()
    armableControlSetup()
    await renderAt('#/')
    await settleThenFakeTimers()
    await armAndFinishCurrentSong()
    await waitOutTheTileDelay()

    expect(screen.queryByTestId('next-song-tile')).toBeNull()
    expect(screen.getByRole('button', { name: /^Unarm/ }).textContent).toBe('Unarm')
  })
})
