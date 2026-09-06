import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import type { LibrarySong } from './setlistStore'
import { installLibrary } from './testSupport/library'
import { ensureStorage } from './testSupport/storage'
import { VISUALS_VERSION } from './visualsFile'

const readGigFolder = vi.fn()
const writeGigFile = vi.fn()
const validateSongForPerformance = vi.fn()
const fileExists = vi.fn()
const createGigFolder = vi.fn()
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
  createGigFolder: (...a: unknown[]) => createGigFolder(...a),
  readGigFolder: (...a: unknown[]) => readGigFolder(...a),
  writeGigFile: (...a: unknown[]) => writeGigFile(...a),
  validateSongForPerformance: (...a: unknown[]) => validateSongForPerformance(...a),
  fileExists: (...a: unknown[]) => fileExists(...a),
}))

const {
  getActiveSetlistId,
  getOrderedEntriesForActiveSetlist,
  hasValidActiveSetlist,
} = await import('./setlistStore')

const {
  closeGig,
  createGig,
  saveGigIdentity,
  getGigReadiness,
  getRememberedGigFolder,
  confirmSetup,
  publishSetlistToGig,
  refreshGigReadiness,
  rememberGigFolder,
  resetGigSession,
  subscribeGigReadiness,
} = await import('./gigSession')

beforeAll(ensureStorage)

const FOLDER = '/gigs/setup/k3f9x2abcd'
const GIG_ID = 'k3f9x2abcd'

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
    visualsVersion: VISUALS_VERSION,
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
  describeDisplays.mockResolvedValue({ count: 1, displays: [], fingerprint: '1728x1117@2*' })
  // Adopting the file's running order re-reads any song it points somewhere new.
  readSongFileText.mockImplementation((path: string) => {
    const id = String(path).split('/').pop()!.replace(/\.json$/, '')
    return Promise.resolve({
      ok: true,
      text: JSON.stringify({ title: id, lyrics: [{ es: 'línea' }] }),
    })
  })
  installLibrary([song('duelo'), song('vidas')])
})

/**
 * **A gig is made by saying what it is, and there is no name to type either.** The folder question
 * went first; the `Name it` field that replaced it went on 2026-09-02, because its answer was still
 * a folder name.
 *
 * **The folder is an opaque id** (Jorge, 2026-09-03), so nothing about the night is derivable from
 * it — and the protection that fell out of the old derived name has to be stated instead. That
 * rule, `nothing is written until date and venue are both answered`, is the block below.
 */
describe('making a gig by saying what it is', () => {
  const GIGS_ROOT = '/vault/gigs'

  beforeEach(() => {
    localStorage.setItem('pregoneroGigsFolder', GIGS_ROOT)
    createGigFolder.mockResolvedValue({ ok: true, folderPath: `${GIGS_ROOT}/${GIG_ID}` })
    // A filesystem that remembers what was written to it, so the on-open read sees the file the
    // creation just made rather than an empty folder.
    let onDisk: string | null = null
    writeGigFile.mockImplementation((_folder: string, text: string) => {
      onDisk = text
      return Promise.resolve({ ok: true })
    })
    readGigFolder.mockImplementation(() =>
      Promise.resolve({
        ...emptyRead(),
        folderPath: `${GIGS_ROOT}/${GIG_ID}`,
        gigPresent: onDisk !== null,
        gigText: onDisk,
      })
    )
  })

  it('names the folder with an opaque id, in the gigs root first run recorded', async () => {
    const r = await createGig({ date: '2026-09-12', venue: { name: 'Bar Eduard', city: 'Ghent' } })
    expect(r.ok).toBe(true)
    // The gigs root goes in; `platform.createGigFolder` is what joins `setup/` on to it, at the one
    // boundary that talks to the main process.
    const [root, name] = createGigFolder.mock.calls[0] as [string, string]
    expect(root).toBe(GIGS_ROOT)
    expect(name).toMatch(/^[0-9abcdefghjkmnpqrstvwxyz]{10}$/)
  })

  it('puts nothing about the night in the folder name', async () => {
    // **The whole of the 2026-09-03 ruling.** A name carrying the date or the venue is a name that
    // has to change when either does, and identity that changes is not identity.
    await createGig({ date: '2026-09-12', venue: { name: 'Bar Eduard', city: 'Ghent' } })
    const [, name] = createGigFolder.mock.calls[0] as [string, string]
    expect(name).not.toContain('2026')
    expect(name).not.toContain('bar')
    expect(name).not.toContain('eduard')
  })

  it('gives two gigs on the same night at the same venue two folders', async () => {
    const names = new Set<string>()
    for (let i = 0; i < 5; i += 1) {
      createGigFolder.mockClear()
      await createGig({ date: '2026-09-12', venue: { name: 'Bar Eduard' } })
      names.add((createGigFolder.mock.calls[0] as [string, string])[1])
    }
    expect(names.size).toBe(5)
  })

  it('opens it, so the flow continues on the gig it just made', async () => {
    await createGig({ date: '2026-09-12', venue: { name: 'Bar Eduard' } })
    expect(getRememberedGigFolder()).toBe(`${GIGS_ROOT}/${GIG_ID}`)
  })

  it('writes the date and the venue into gig.json', async () => {
    await createGig({ date: '2026-09-12', venue: { name: 'Bar Eduard', city: 'Ghent' } })
    const calls = writeGigFile.mock.calls as [string, string][]
    const written = JSON.parse(calls[calls.length - 1]![1]) as {
      id: string
      date: string
      venue: { name: string; city: string }
    }
    expect(written.id).toBe(GIG_ID)
    expect(written.date).toBe('2026-09-12')
    // Written once, whole. The id is the folder's name and is never rewritten after this.
    expect(written.venue).toEqual({ name: 'Bar Eduard', city: 'Ghent' })
  })

  /**
   * ## The write gate, which is the part an opaque id would silently repeal
   *
   * **Nothing is written until the date and the venue are both answered** (Jorge, 2026-09-03).
   *
   * Until then this needed no code: the folder was named from the date and the venue, so a missing
   * half meant no name and there was nothing to create. **An opaque id answers at any moment**, so
   * the gate stopped being a consequence of the naming scheme and had to become a rule. These are
   * the tests that would go green on their own if it were dropped, which is why they assert the
   * *absence of calls* rather than the returned error: the error is a message, and the folder not
   * existing is the fact.
   */
  it('creates nothing at all when the venue has not been answered', async () => {
    const r = await createGig({ date: '2026-09-12', venue: {} })
    expect(r.ok).toBe(false)
    expect(!r.ok && r.error).toMatch(/Nothing has been written/)
    expect(createGigFolder).not.toHaveBeenCalled()
    expect(writeGigFile).not.toHaveBeenCalled()
  })

  it('creates nothing at all when the date has not been answered', async () => {
    const r = await createGig({ date: '', venue: { name: 'Bar Eduard' } })
    expect(r.ok).toBe(false)
    expect(createGigFolder).not.toHaveBeenCalled()
    expect(writeGigFile).not.toHaveBeenCalled()
  })

  it('creates nothing at all when neither has been answered', async () => {
    const r = await createGig({ date: '', venue: {} })
    expect(r.ok).toBe(false)
    expect(createGigFolder).not.toHaveBeenCalled()
    expect(writeGigFile).not.toHaveBeenCalled()
  })

  it('creates nothing for a venue that is only whitespace', async () => {
    const r = await createGig({ date: '2026-09-12', venue: { name: '   ', city: 'Ghent' } })
    expect(r.ok).toBe(false)
    expect(createGigFolder).not.toHaveBeenCalled()
    expect(writeGigFile).not.toHaveBeenCalled()
  })

  it('creates nothing for a date that is not a date', async () => {
    const r = await createGig({ date: '12/09/2026', venue: { name: 'Bar Eduard' } })
    expect(r.ok).toBe(false)
    expect(createGigFolder).not.toHaveBeenCalled()
    expect(writeGigFile).not.toHaveBeenCalled()
  })

  it('leaves the gig list and the open gig alone when it refuses', async () => {
    // A refused creation must not be visible anywhere: no row, and no gig open. The half-made
    // shape this guards against is a folder on disk that is in no list.
    const before = localStorage.getItem('pregoneroGigList')
    const r = await createGig({ date: '2026-09-12', venue: {} })
    expect(r.ok).toBe(false)
    expect(localStorage.getItem('pregoneroGigList')).toBe(before)
    expect(getRememberedGigFolder()).toBeNull()
  })

  it('refuses with the reason when there is no gigs folder, rather than picking one', async () => {
    localStorage.removeItem('pregoneroGigsFolder')
    const r = await createGig({ date: '2026-09-12', venue: { name: 'Bar Eduard' } })
    expect(r.ok).toBe(false)
    expect(!r.ok && r.error).toMatch(/no gigs folder/)
    expect(createGigFolder).not.toHaveBeenCalled()
  })

  it('carries the main process’s refusal through rather than opening a gig that is not there', async () => {
    createGigFolder.mockResolvedValue({ ok: false, error: 'There is already a gig called "x".' })
    const r = await createGig({ date: '2026-09-12', venue: { name: 'Bar Eduard' } })
    expect(r.ok).toBe(false)
    expect(!r.ok && r.error).toMatch(/already a gig called/)
    expect(getRememberedGigFolder()).toBeNull()
  })
})

describe('the gig’s date and venue, written down', () => {
  function openGigWithIdentity() {
    rememberGigFolder(FOLDER)
    readGigFolder.mockResolvedValue(
      emptyRead({
        gigPresent: true,
        gigText: JSON.stringify({ gigVersion: 1, id: GIG_ID, visuals: './visuals.json' }),
      })
    )
  }

  it('writes what was typed and leaves the rest of the file alone', async () => {
    openGigWithIdentity()
    await saveGigIdentity({ date: '2026-09-12', venue: { name: 'Bar Eduard', city: 'Ghent' } })
    const calls = writeGigFile.mock.calls as [string, string][]
    const written = JSON.parse(calls[calls.length - 1]![1]) as Record<string, unknown>
    expect(written.date).toBe('2026-09-12')
    expect(written.venue).toEqual({ name: 'Bar Eduard', city: 'Ghent' })
    expect(written.id).toBe(GIG_ID)
    expect(written.visuals).toBe('./visuals.json')
  })

  it('turns the step green once both are there', async () => {
    openGigWithIdentity()
    const r = await saveGigIdentity({ date: '2026-09-12', venue: { name: 'Bar Eduard' } })
    expect(r.steps.find((s) => s.step === 1)!.status).toBe('complete')
  })

  it('does nothing with no gig open, rather than writing somewhere', async () => {
    rememberGigFolder(null)
    await saveGigIdentity({ date: '2026-09-12', venue: { name: 'Bar Eduard' } })
    expect(writeGigFile).not.toHaveBeenCalled()
  })
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

  it('writes nothing at all, and invents no date', async () => {
    // **Reading a folder must not create a file in it** (Jorge, 2026-09-03). This used to write an
    // identity-only `gig.json` carrying today's date, which is how a folder nobody had called a
    // gig became one with an invented night. Under *the gigs list is the folder* such a folder is
    // not a gig and is never listed, so there is nothing to date and nothing to write.
    await refreshGigReadiness()
    expect(writeGigFile).not.toHaveBeenCalled()
  })

  it('says so, rather than covering it with a file it made itself', async () => {
    const r = await refreshGigReadiness()
    expect(r.steps.find((s) => s.step === 1)!.status).toBe('not-yet')
    expect(r.steps.find((s) => s.step === 1)!.missing).toContain('No gig.json in this folder yet.')
    // Not a refusal: a folder without a gig file is a state, not a failure to report.
    expect(r.refusals).toEqual([])
  })

  it('reports step 3 as not yet, because Muralista has not run', async () => {
    const r = await refreshGigReadiness()
    expect(r.steps.find((s) => s.step === 3)!.status).toBe('not-yet')
    expect(r.refusals).toEqual([])
  })
})

describe('publishing a setlist Pregonero just changed', () => {
  const gigText = JSON.stringify({
    gigVersion: 1,
    id: GIG_ID,
    date: '2026-09-12',
    venue: { name: 'Bar Eduard' },
    songs: [
      { id: 'duelo', title: 'duelo', file: 'duelo.json' },
      { id: 'vidas', title: 'vidas', file: 'vidas.json' },
    ],
    setlist: ['duelo', 'vidas'],
  })

  beforeEach(() => rememberGigFolder(FOLDER))

  it('writes the app’s order into the file', async () => {
    readGigFolder.mockResolvedValue(emptyRead({ gigPresent: true, gigText }))
    await refreshGigReadiness()
    installLibrary([song('vidas'), song('duelo')])
    await publishSetlistToGig()
    const calls = writeGigFile.mock.calls as [string, string][]
    expect((JSON.parse(calls[calls.length - 1]![1]) as { setlist: string[] }).setlist).toEqual([
      'vidas',
      'duelo',
    ])
  })

  it('writes nothing when the file already says what the app says', async () => {
    readGigFolder.mockResolvedValue(emptyRead({ gigPresent: true, gigText }))
    await refreshGigReadiness()
    await publishSetlistToGig()
    expect(writeGigFile).not.toHaveBeenCalled()
  })

  it('says so when it replaces an order edited in the file since this session read it', async () => {
    readGigFolder.mockResolvedValue(emptyRead({ gigPresent: true, gigText }))
    await refreshGigReadiness()

    const editedOutside = JSON.stringify({
      gigVersion: 1,
      id: GIG_ID,
      date: '2026-09-12',
      venue: { name: 'Bar Eduard' },
      songs: [
        { id: 'duelo', title: 'duelo', file: 'duelo.json' },
        { id: 'vidas', title: 'vidas', file: 'vidas.json' },
      ],
      setlist: ['vidas'],
    })
    readGigFolder.mockResolvedValue(emptyRead({ gigPresent: true, gigText: editedOutside }))

    const r = await publishSetlistToGig()
    expect(r.adoption).toEqual({
      direction: 'wrote',
      now: ['duelo', 'vidas'],
      displaced: ['vidas'],
      unresolved: [],
    })
  })

  it('says nothing when the file is where this session left it', async () => {
    readGigFolder.mockResolvedValue(emptyRead({ gigPresent: true, gigText }))
    await refreshGigReadiness()
    installLibrary([song('duelo')])
    const r = await publishSetlistToGig()
    expect(r.adoption).toBeNull()
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
    // Everything up to the confirmation, which is stored rather than derived and is nobody's to
    // make on the person's behalf.
    expect(r.steps.filter((s) => s.step < 4).every((s) => s.status === 'complete')).toBe(true)
    expect(r.confirmation).toBeNull()
  })

  it('takes the file’s running order over the one the app held, and writes nothing', async () => {
    installLibrary([song('vidas'), song('duelo')])
    readGigFolder.mockResolvedValue(emptyRead({ gigPresent: true, gigText }))
    const r = await refreshGigReadiness()
    expect(writeGigFile).not.toHaveBeenCalled()
    expect(r.songs.map((entry) => entry.songId)).toEqual(['duelo', 'vidas'])
  })

  it('says on screen that the file’s order replaced the one held here', async () => {
    installLibrary([song('vidas'), song('duelo')])
    readGigFolder.mockResolvedValue(emptyRead({ gigPresent: true, gigText }))
    const r = await refreshGigReadiness()
    expect(r.adoption).toEqual({
      direction: 'adopted',
      now: ['duelo', 'vidas'],
      displaced: ['vidas', 'duelo'],
      unresolved: [],
    })
  })

  it('says nothing when the file’s order is the one already in force', async () => {
    readGigFolder.mockResolvedValue(emptyRead({ gigPresent: true, gigText }))
    const r = await refreshGigReadiness()
    expect(r.adoption).toBeNull()
  })

  it('honours a hand edit in the file rather than overwriting it', async () => {
    const handEdited = JSON.stringify({
      gigVersion: 1,
      id: GIG_ID,
      date: '2026-09-12',
      venue: { name: 'Bar Eduard' },
      songs: [
        { id: 'duelo', title: 'duelo', file: 'duelo.json' },
        { id: 'vidas', title: 'vidas', file: 'vidas.json' },
      ],
      setlist: ['vidas'],
    })
    readGigFolder.mockResolvedValue(emptyRead({ gigPresent: true, gigText: handEdited }))
    const r = await refreshGigReadiness()
    expect(writeGigFile).not.toHaveBeenCalled()
    expect(r.songs.map((entry) => entry.songId)).toEqual(['vidas'])
  })

  it('names a setlist id it cannot turn into a song, rather than dropping it', async () => {
    const withGhost = JSON.stringify({
      gigVersion: 1,
      id: GIG_ID,
      date: '2026-09-12',
      venue: { name: 'Bar Eduard' },
      songs: [{ id: 'duelo', title: 'duelo', file: 'duelo.json' }],
      setlist: ['duelo', 'ghost'],
    })
    readGigFolder.mockResolvedValue(emptyRead({ gigPresent: true, gigText: withGhost }))
    const r = await refreshGigReadiness()
    expect(r.adoption?.unresolved).toEqual(['ghost'])
    expect(r.steps.find((step) => step.step === 2)!.missing).toContain(
      'ghost: named in the gig’s setlist, but no file for it is known here.'
    )
  })

  it('gives a file with no running order an EMPTY one, never the app’s', async () => {
    // **The other direction of the E1 defect, walked on `v0.52.0`.** This branch wrote
    // `readSetlist()` into the file, so a gig created from Backstage while another gig's setlist
    // was active arrived carrying that setlist, and step 2 opened on *Every song you have is in
    // this gig's setlist*. A new gig's setlist is empty; only step 2 fills it.
    const noSetlist = JSON.stringify({
      gigVersion: 1,
      id: GIG_ID,
      date: '2026-09-12',
      venue: { name: 'Bar Eduard' },
    })
    readGigFolder.mockResolvedValue(emptyRead({ gigPresent: true, gigText: noSetlist }))
    const r = await refreshGigReadiness()
    const calls = writeGigFile.mock.calls as [string, string][]
    expect(calls).toHaveLength(1)
    const written = JSON.parse(calls[0]![1]) as { setlist: string[]; songs: unknown[] }
    expect(written.setlist).toEqual([])
    expect(written.songs).toEqual([])
    // And the app comes away holding the gig's own — empty — running order, not the one it had.
    expect(r.songs).toEqual([])
  })

  it('still leaves an active setlist for `Add →` to write into', async () => {
    // The `v0.39.0` fix, unchanged by the repair above: the field is still written and still
    // adopted, so the store has `gig-<id>` active and `addSongToSetlist` has somewhere to go. It
    // is the CONTENT that changed, not whether the setlist exists.
    const noSetlist = JSON.stringify({
      gigVersion: 1,
      id: GIG_ID,
      date: '2026-09-12',
      venue: { name: 'Bar Eduard' },
    })
    readGigFolder.mockResolvedValue(emptyRead({ gigPresent: true, gigText: noSetlist }))
    await refreshGigReadiness()
    expect(hasValidActiveSetlist()).toBe(true)
    expect(getActiveSetlistId()).toBe(`gig-${GIG_ID}`)
    expect(getOrderedEntriesForActiveSetlist()).toEqual([])
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
  // **The songs folder is set here because the app cannot run without one.** Bombista is handed a
  // resolved file, and resolving a bare reference is what the songs folder is for — with none, the
  // reference passes through as the bare name and the assertion below would be about a path no
  // machine ever produces. First run makes both folders a precondition of everything past it.
  beforeEach(() => {
    localStorage.setItem('pregoneroSongsFolder', '/vault/songs')
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
    expect(validateSongForPerformance).toHaveBeenCalledWith(
      '/vault/songs/song-performance/duelo.json'
    )
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

describe('before the first read of a gig folder has come back', () => {
  it('reports the no-gig delta, not an empty one', () => {
    rememberGigFolder(FOLDER)
    // No refresh has run, so nothing has been read from disk yet.
    const r = getGigReadiness()
    expect(r.gate).toBe('off')
    expect(r.playableSongIds).toEqual(['duelo', 'vidas'])
  })
})

describe('confirming setup, and the reload boundary', () => {
  const gigText = JSON.stringify({
    gigVersion: 1,
    id: GIG_ID,
    date: '2026-09-12',
    venue: { name: 'Bar Eduard' },
    visuals: './visuals.json',
    songs: [
      { id: 'duelo', title: 'duelo', file: 'duelo.json' },
      { id: 'vidas', title: 'vidas', file: 'vidas.json' },
    ],
    setlist: ['duelo', 'vidas'],
  })

  beforeEach(() => rememberGigFolder(FOLDER))

  function openGig() {
    readGigFolder.mockResolvedValue(
      emptyRead({
        gigPresent: true,
        gigText,
        visualsPresent: true,
        visualsText: visualsText({ 'song-lyrics': ['lyr'] }),
      })
    )
  }

  it('writes the confirmation and what it was confirmed against', async () => {
    openGig()
    await refreshGigReadiness()
    const r = await confirmSetup()
    const calls = writeGigFile.mock.calls as [string, string][]
    const written = JSON.parse(calls[calls.length - 1]![1]) as {
      setup: { confirmedAt: string; against: { songs: Record<string, string>; visuals: string; display: string } }
    }
    expect(Object.keys(written.setup.against.songs).sort()).toEqual(['duelo', 'vidas'])
    expect(written.setup.against.display).toBe('1728x1117@2*')
    expect(r.confirmation).not.toBeNull()
    expect(r.confirmation!.stale).toBe(false)
  })

  it('reports a confirmation as still true when nothing has moved', async () => {
    openGig()
    await refreshGigReadiness()
    const confirmed = await confirmSetup()
    // What the write produced, read back the way the next launch would read it.
    const calls = writeGigFile.mock.calls as [string, string][]
    readGigFolder.mockResolvedValue(
      emptyRead({
        gigPresent: true,
        gigText: calls[calls.length - 1]![1],
        visualsPresent: true,
        visualsText: visualsText({ 'song-lyrics': ['lyr'] }),
      })
    )
    const reopened = await refreshGigReadiness()
    expect(reopened.confirmation!.stale).toBe(false)
    expect(reopened.confirmation!.confirmedAt).toBe(confirmed.confirmation!.confirmedAt)
  })

  it('lapses when the room is re-mapped between one open and the next, and says so', async () => {
    openGig()
    await refreshGigReadiness()
    await confirmSetup()
    const calls = writeGigFile.mock.calls as [string, string][]
    readGigFolder.mockResolvedValue(
      emptyRead({
        gigPresent: true,
        gigText: calls[calls.length - 1]![1],
        visualsPresent: true,
        // Same shapes, different bytes: Muralista saved again.
        visualsText: visualsText({ 'song-lyrics': ['lyr'] }).replace('"shapes"', '"shapes" '),
      })
    )
    const reopened = await refreshGigReadiness()
    expect(reopened.confirmation!.stale).toBe(true)
    expect(reopened.confirmation!.moved).toContain(
      'The room has been re-mapped since setup was confirmed.'
    )
  })

  it('lapses when the projector is unplugged', async () => {
    openGig()
    await refreshGigReadiness()
    await confirmSetup()
    const calls = writeGigFile.mock.calls as [string, string][]
    readGigFolder.mockResolvedValue(
      emptyRead({
        gigPresent: true,
        gigText: calls[calls.length - 1]![1],
        visualsPresent: true,
        visualsText: visualsText({ 'song-lyrics': ['lyr'] }),
      })
    )
    describeDisplays.mockResolvedValue({ count: 1, displays: [], fingerprint: 'laptop only' })
    const reopened = await refreshGigReadiness()
    expect(reopened.confirmation!.moved).toContain(
      'The displays have changed since setup was confirmed.'
    )
  })

  it('is a milestone and not a lock: nothing is refused and no song is blocked', async () => {
    openGig()
    await refreshGigReadiness()
    await confirmSetup()
    const calls = writeGigFile.mock.calls as [string, string][]
    readGigFolder.mockResolvedValue(
      emptyRead({
        gigPresent: true,
        gigText: calls[calls.length - 1]![1],
        visualsPresent: true,
        visualsText: visualsText({ 'song-lyrics': ['lyr'] }),
      })
    )
    describeDisplays.mockResolvedValue({ count: 1, displays: [], fingerprint: 'laptop only' })
    const reopened = await refreshGigReadiness()
    expect(reopened.refusals).toEqual([])
    expect(reopened.playableSongIds).toEqual(['duelo', 'vidas'])
  })

  it('does nothing with no gig folder open, rather than writing somewhere', async () => {
    rememberGigFolder(null)
    const r = await confirmSetup()
    expect(writeGigFile).not.toHaveBeenCalled()
    expect(r.confirmation).toBeNull()
  })

  it('re-reads on open and builds no watcher — every read is a call, never a subscription', async () => {
    openGig()
    await refreshGigReadiness()
    const after = readGigFolder.mock.calls.length
    // Nothing arrives on its own between two opens.
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(readGigFolder.mock.calls.length).toBe(after)
    await refreshGigReadiness()
    expect(readGigFolder.mock.calls.length).toBeGreaterThan(after)
  })
})
