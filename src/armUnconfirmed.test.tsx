/** @vitest-environment jsdom */
/**
 * The guided setup flow: **four** ordered steps, a forward button that greys, the escape hatch said
 * out loud, two doors on a song and only two, and step 0 named rather than hidden.
 *
 * Every assertion here is about **rendering** the readiness delta. The gig folder is mocked at the
 * platform seam, which is the one module that knows Electron exists.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import { installRequiredFolders } from './testSupport/folders'
import { standbyState } from './testSupport/standbyState'
import { render, screen, act, waitFor, cleanup, fireEvent } from '@testing-library/react'
import type { SongItem } from './songState'
import { dropLibraryCache, type LibrarySong } from './setlistStore'
import { installLibrary } from './testSupport/library'

const readGigFolder = vi.fn()
const writeGigFile = vi.fn()
const createGigFolder = vi.fn()
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
  hasFolderPicker: () => true,
  chooseFolderPath: vi.fn(),
  readGigFolder: (...a: unknown[]) => readGigFolder(...a),
  writeGigFile: (...a: unknown[]) => writeGigFile(...a),
  createGigFolder: (...a: unknown[]) => createGigFolder(...a),
  validateSongForPerformance: (...a: unknown[]) => validateSongForPerformance(...a),
  fileExists: (...a: unknown[]) => fileExists(...a),
  readSongFileText: (...a: unknown[]) => readSongFileText(...a),
}))

const PlayerRoot = (await import('./PlayerRoot')).PlayerRoot
const { rememberGigFolder, resetGigSession } = await import('./gigSession')

const FOLDER = '/gigs/setup/k3f9x2abcd'
const GIG_ID = 'k3f9x2abcd'
const WAIT = { timeout: 3000 }

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

function visualsJson(defaults: Record<string, string[]>) {
  return JSON.stringify({
    visualsVersion: 1,
    gigId: GIG_ID,
    shapes: [{ id: 'lyr', name: 'Back wall', layer: { type: 'song-lyrics' } }],
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
  readSongFileText.mockImplementation((path: string) => {
    const id = String(path).split('/').pop()!.replace(/\.json$/, '')
    return Promise.resolve({
      ok: true,
      text: JSON.stringify({
        title: id.charAt(0).toUpperCase() + id.slice(1),
        lyrics: [{ es: 'Hola', en: 'Hello' }, { es: 'Mundo', en: 'World' }],
      }),
    })
  })
  installLibrary([song('duelo', 'Duelo'), song('vidas', 'Vidas')])
})

afterEach(() => {
  cleanup()
  window.location.hash = ''
})



/**
 * **Moved from Tramoya's `SetupFlowView.test.tsx` by the repo split** (2026-09-06). It renders the
 * player's Standby to check that an unconfirmed gig warns rather than refuses, so it is the
 * player's test; the other thirty-nine cases in that file are the shell's setup flow and stayed.
 */

describe('arming an unconfirmed gig warns rather than refuses', () => {
  it('says setup is not confirmed on the control screen, and leaves Arm alone', async () => {
    rememberGigFolder(FOLDER)
    readGigFolder.mockResolvedValue(
      folderRead({
        gigPresent: true,
        gigText: gigJson(['duelo', 'vidas']),
        visualsPresent: true,
        visualsText: visualsJson({ 'song-lyrics': ['lyr'] }),
      })
    )
    await act(async () => {
      render(<PlayerRoot initialHash="#/" />)
    })
    // **The warning came off the control screen on 2026-09-06** — *a column shows a state, never a
    // message*. **It is removed rather than moved, and deliberately**: it is not a gate, so arming
    // proceeds, and a popup carrying it would be a dialog in front of the one press that must never
    // wait. Everything it said is on the gig flow's sign-off, one press away through `Setup`.
    await waitFor(() => expect(standbyState()).not.toBeNull(), WAIT)
    expect(screen.queryByTestId('arm-setup-warning')).toBeNull()

    // **And it leaves `Arm` alone**, which is what *a milestone, not a lock* has always meant: the
    // confirmation is never among the reasons `Arm` gives for refusing.
    await act(async () => {
      fireEvent.click(screen.getByTestId('control-arm-button'))
    })
    const refusal = screen.queryByTestId('arm-refusal-reasons')
    if (refusal !== null) {
      expect(refusal.textContent).not.toMatch(/confirm/i)
    }
  })
})
