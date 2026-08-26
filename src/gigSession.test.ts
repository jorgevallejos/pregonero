import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import type { LibrarySong } from './setlistStore'
import { installLibrary } from './testSupport/library'

const readGigFolder = vi.fn()
const writeGigFile = vi.fn()
const validateSongForPerformance = vi.fn()
const fileExists = vi.fn()
const chooseGigFolderPath = vi.fn()

vi.mock('./platform', () => ({
  hasGigFolderAccess: () => true,
  chooseGigFolderPath: (...a: unknown[]) => chooseGigFolderPath(...a),
  readGigFolder: (...a: unknown[]) => readGigFolder(...a),
  writeGigFile: (...a: unknown[]) => writeGigFile(...a),
  validateSongForPerformance: (...a: unknown[]) => validateSongForPerformance(...a),
  fileExists: (...a: unknown[]) => fileExists(...a),
}))

const {
  chooseGigFolder,
  closeGig,
  getGigReadiness,
  getRememberedGigFolder,
  refreshGigReadiness,
  rememberGigFolder,
  resetGigSession,
  subscribeGigReadiness,
} = await import('./gigSession')

function createStorage(): Storage {
  const store = new Map<string, string>()
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value)
    },
    removeItem: (key: string) => {
      store.delete(key)
    },
    clear: () => {
      store.clear()
    },
    key: (i: number) => [...store.keys()][i] ?? null,
    get length() {
      return store.size
    },
  }
}

beforeAll(() => {
  if (typeof globalThis.localStorage === 'undefined' || typeof globalThis.localStorage.clear !== 'function') {
    vi.stubGlobal('localStorage', createStorage())
  }
  if (typeof globalThis.sessionStorage === 'undefined' || typeof globalThis.sessionStorage.clear !== 'function') {
    vi.stubGlobal('sessionStorage', createStorage())
  }
})

const FOLDER = '/gigs/2026-09-12-bar-eduard'
const GIG_ID = '2026-09-12-bar-eduard'

function song(id: string, extra: Partial<LibrarySong> = {}): LibrarySong {
  return { id, title: id, items: [{ languages: { es: 'línea' } }], ...extra } as LibrarySong
}

function emptyRead(overrides: Record<string, unknown> = {}) {
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

function visualsText(defaults: Record<string, string[]>, gigId = GIG_ID) {
  return JSON.stringify({
    visualsVersion: 1,
    gigId,
    shapes: [{ id: 'lyr', layer: { type: 'song-lyrics' } }],
    songVisuals: { defaults, songs: {} },
  })
}

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  vi.clearAllMocks()
  resetGigSession()
  writeGigFile.mockResolvedValue({ ok: true })
  validateSongForPerformance.mockResolvedValue({ status: 'skipped', reason: 'bombista is not on PATH' })
  fileExists.mockResolvedValue(true)
  installLibrary([song('duelo'), song('vidas')])
})

describe('the remembered folder', () => {
  it('survives a launch', () => {
    rememberGigFolder(FOLDER)
    expect(getRememberedGigFolder()).toBe(FOLDER)
  })

  it('starts with none', () => {
    expect(getRememberedGigFolder()).toBeNull()
  })

  it('closeGig forgets it, and leaves the folder alone', async () => {
    rememberGigFolder(FOLDER)
    readGigFolder.mockResolvedValue(emptyRead())
    await closeGig()
    expect(getRememberedGigFolder()).toBeNull()
    expect(getGigReadiness().gate).toBe('off')
  })
})

describe('with no gig folder', () => {
  it('reads nothing and leaves the gate off', async () => {
    const r = await refreshGigReadiness()
    expect(readGigFolder).not.toHaveBeenCalled()
    expect(r.gate).toBe('off')
    expect(r.playableSongIds).toEqual(['duelo', 'vidas'])
  })
})

describe('opening a folder with no gig.json', () => {
  beforeEach(() => {
    rememberGigFolder(FOLDER)
    readGigFolder.mockResolvedValue(emptyRead())
  })

  it('creates one, taking identity from the folder name', async () => {
    await refreshGigReadiness()
    const [, text] = writeGigFile.mock.calls[0] as [string, string]
    expect(JSON.parse(text)).toMatchObject({ gigVersion: 1, id: GIG_ID, date: '2026-09-12' })
  })

  it('writes the setlist into it as songs and setlist', async () => {
    await refreshGigReadiness()
    const calls = writeGigFile.mock.calls as [string, string][]
    const last = calls[calls.length - 1]!
    const written = JSON.parse(last[1]) as { songs: unknown[]; setlist: string[] }
    expect(written.setlist).toEqual(['duelo', 'vidas'])
    expect(written.songs).toEqual([
      { id: 'duelo', title: 'duelo', file: 'duelo.json' },
      { id: 'vidas', title: 'vidas', file: 'vidas.json' },
    ])
  })

  it('reports step 3 as not yet, because Muralista has not run', async () => {
    const r = await refreshGigReadiness()
    expect(r.steps.find((s) => s.step === 3)!.status).toBe('not-yet')
    expect(r.refusals).toEqual([])
  })
})

describe('opening a folder that already holds a gig', () => {
  const gigText = JSON.stringify({
    gigVersion: 1,
    id: GIG_ID,
    date: '2026-09-12',
    venue: { name: 'Bar Eduard', city: 'Ghent' },
    visuals: './visuals.json',
    songs: [
      { id: 'duelo', title: 'duelo', file: 'duelo.json' },
      { id: 'vidas', title: 'vidas', file: 'vidas.json' },
    ],
    setlist: ['duelo', 'vidas'],
  })

  beforeEach(() => rememberGigFolder(FOLDER))

  it('writes nothing when the file already says what the setlist says', async () => {
    readGigFolder.mockResolvedValue(
      emptyRead({
        gigPresent: true,
        gigText,
        visualsPresent: true,
        visualsText: visualsText({ 'song-lyrics': ['lyr'] }),
      })
    )
    await refreshGigReadiness()
    expect(writeGigFile).not.toHaveBeenCalled()
  })

  it('is ready end to end when Muralista has mapped the room', async () => {
    readGigFolder.mockResolvedValue(
      emptyRead({
        gigPresent: true,
        gigText,
        visualsPresent: true,
        visualsText: visualsText({ 'song-lyrics': ['lyr'] }),
      })
    )
    const r = await refreshGigReadiness()
    expect(r.gate).toBe('on')
    expect(r.gigId).toBe(GIG_ID)
    expect(r.playableSongIds).toEqual(['duelo', 'vidas'])
    expect(r.steps.every((s) => s.status === 'complete')).toBe(true)
  })

  it('rewrites the running order when the setlist has been reordered since', async () => {
    installLibrary([song('vidas'), song('duelo')])
    readGigFolder.mockResolvedValue(emptyRead({ gigPresent: true, gigText }))
    await refreshGigReadiness()
    const calls = writeGigFile.mock.calls as [string, string][]
    const last = calls[calls.length - 1]!
    expect((JSON.parse(last[1]) as { setlist: string[] }).setlist).toEqual(['vidas', 'duelo'])
  })

  it('refuses a mapping of a different room, and blocks every song', async () => {
    readGigFolder.mockResolvedValue(
      emptyRead({
        gigPresent: true,
        gigText,
        visualsPresent: true,
        visualsText: visualsText({ 'song-lyrics': ['lyr'] }, 'last-month'),
      })
    )
    const r = await refreshGigReadiness()
    expect(r.refusals[0]).toMatch(/belongs to gig "last-month"/)
    expect(r.playableSongIds).toEqual([])
  })

  it('refuses a visuals.json from a schema it does not know', async () => {
    readGigFolder.mockResolvedValue(
      emptyRead({
        gigPresent: true,
        gigText,
        visualsPresent: true,
        visualsText: JSON.stringify({ visualsVersion: 9, gigId: GIG_ID }),
      })
    )
    const r = await refreshGigReadiness()
    expect(r.refusals[0]).toMatch(/version 9/)
  })

  it('reports an unparseable gig.json as broken, and never overwrites it', async () => {
    readGigFolder.mockResolvedValue(emptyRead({ gigPresent: true, gigText: '{' }))
    const r = await refreshGigReadiness()
    expect(r.steps.find((s) => s.step === 2)!.status).toBe('broken')
    expect(writeGigFile).not.toHaveBeenCalled()
  })

  it('follows a visuals pointer the gig file names', async () => {
    const pointed = JSON.parse(gigText) as Record<string, unknown>
    pointed.visuals = './room/v.json'
    readGigFolder
      .mockResolvedValueOnce(emptyRead({ gigPresent: true, gigText: JSON.stringify(pointed) }))
      .mockResolvedValueOnce(
        emptyRead({
          gigPresent: true,
          gigText: JSON.stringify(pointed),
          visualsPresent: true,
          visualsText: visualsText({ 'song-lyrics': ['lyr'] }),
        })
      )
    const r = await refreshGigReadiness()
    expect(readGigFolder).toHaveBeenLastCalledWith(FOLDER, './room/v.json')
    expect(r.steps.find((s) => s.step === 3)!.status).toBe('complete')
  })
})

describe('bombista', () => {
  beforeEach(() => {
    rememberGigFolder(FOLDER)
    readGigFolder.mockResolvedValue(emptyRead())
  })

  it('is asked once and then left alone when it is not installed', async () => {
    const r = await refreshGigReadiness()
    expect(validateSongForPerformance).toHaveBeenCalledTimes(1)
    expect(r.validationSkipped).toBe(true)
  })

  it('is asked about every song when it is installed', async () => {
    validateSongForPerformance.mockResolvedValue({ status: 'ok' })
    await refreshGigReadiness()
    expect(validateSongForPerformance).toHaveBeenCalledTimes(2)
    expect(validateSongForPerformance).toHaveBeenCalledWith('duelo.json')
  })
})

describe('subscribers', () => {
  it('hear every refresh', async () => {
    const heard = vi.fn()
    const unsubscribe = subscribeGigReadiness(heard)
    await refreshGigReadiness()
    expect(heard).toHaveBeenCalledTimes(1)
    unsubscribe()
    await refreshGigReadiness()
    expect(heard).toHaveBeenCalledTimes(1)
  })
})

describe('chooseGigFolder', () => {
  it('remembers what was picked and reports the delta', async () => {
    chooseGigFolderPath.mockResolvedValue(FOLDER)
    readGigFolder.mockResolvedValue(emptyRead())
    const r = await chooseGigFolder()
    expect(getRememberedGigFolder()).toBe(FOLDER)
    expect(r.gate).toBe('on')
  })

  it('changes nothing when the picker is cancelled', async () => {
    chooseGigFolderPath.mockResolvedValue(null)
    await chooseGigFolder()
    expect(getRememberedGigFolder()).toBeNull()
    expect(readGigFolder).not.toHaveBeenCalled()
  })
})

describe('before the first read of a gig folder has come back', () => {
  it('reports the no-gig delta, not an empty one', () => {
    rememberGigFolder(FOLDER)
    // No refresh has run, so nothing has been read from disk yet.
    const r = getGigReadiness()
    expect(r.gate).toBe('off')
    expect(r.playableSongIds).toEqual(['duelo', 'vidas'])
  })
})
