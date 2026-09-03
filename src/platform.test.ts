import { describe, it, expect, afterEach, beforeAll, vi } from 'vitest'
import { ensureStorage } from './testSupport/storage'
import * as platform from './platform'
import {
  fileExists,
  chooseFilePath,
  chooseFolderPath,
  hasGigFolderAccess,
  listSongsFolder,
  folderReadable,
  createGigFolder,
  readGigFolder,
  validateSongForPerformance,
  writeGigFile,
} from './platform'

function setApi(api: unknown) {
  ;(window as unknown as { electronAPI?: unknown }).electronAPI = api
}

beforeAll(ensureStorage)

afterEach(() => {
  delete (window as unknown as { electronAPI?: unknown }).electronAPI
  // Picker memory is per machine and outlives a render; each test starts where nobody has been.
  localStorage.clear()
})

describe('outside Electron', () => {
  it('says the gig folder cannot be reached', () => {
    expect(hasGigFolderAccess()).toBe(false)
  })

  it('reports an empty folder rather than a failure, so readiness still runs', async () => {
    const read = await readGigFolder('/gigs/x')
    expect(read).toEqual({
      folderPath: '/gigs/x',
      gigText: null,
      gigError: null,
      gigPresent: false,
      visualsText: null,
      visualsError: null,
      visualsPresent: false,
    })
  })

  it('refuses to write, and says why', async () => {
    expect(await writeGigFile('/gigs/x', '{}')).toEqual({
      ok: false,
      error: 'The gig folder can only be written from the desktop app.',
    })
  })

  it('skips validation rather than failing it', async () => {
    const result = await validateSongForPerformance('/songs/duelo.json')
    expect(result.status).toBe('skipped')
  })

  it('cancels the picker', async () => {
    expect(await chooseFilePath('json')).toBeNull()
  })

  /**
   * **There is no gig-folder picker and no multi-file song picker**, and the absence is asserted
   * because an absence with no test is an invitation. The first served `Locate…`, which has no
   * destination under the single-`setup/` ruling; the second served the manage-setlists screen,
   * which is gone. A song arrives by being in `<songs>/song-performance`, and a gig by being made.
   */
  it('offers neither picker the deleted screens used', () => {
    const module = platform as Record<string, unknown>
    expect(module.chooseGigFolderPath).toBeUndefined()
    expect(module.chooseSongFilePaths).toBeUndefined()
  })

  it('cannot see a file', async () => {
    expect(await fileExists('/x')).toBe(false)
  })
})

describe('inside Electron', () => {
  it('passes the visuals pointer through, and reads the gig’s own folder', async () => {
    // **A gig's folder IS where its two files are** (2026-09-02): `<gigs>/setup/<gig>`. There is no
    // second join left at this boundary, and `gigIdFromFolderPath` still takes the id off the last
    // segment — which is the gig's name, never `setup`.
    const readGig = vi.fn().mockResolvedValue({ folderPath: '/gigs/setup/x' })
    setApi({ readGigFolder: readGig })
    const read = await readGigFolder('/gigs/setup/x', './room/v.json')
    expect(readGig).toHaveBeenCalledWith('/gigs/setup/x', './room/v.json')
    expect(read.folderPath).toBe('/gigs/setup/x')
  })

  it('writes gig.json into the gig’s own folder', async () => {
    const write = vi.fn().mockResolvedValue({ ok: true })
    setApi({ writeGigFile: write })
    await writeGigFile('/gigs/setup/x', '{}')
    expect(write).toHaveBeenCalledWith('/gigs/setup/x', '{}')
  })

  /**
   * **The one folder the tools own, joined here and nowhere else** (Jorge, 2026-09-02). The main
   * process is handed `<gigs>/setup` already joined, exactly as it is handed every other folder in
   * this file: it stays ignorant of the suite's conventions, and there is one definition to drift
   * from. **Nothing is ever created in the artist's own territory**, which is what this asserts.
   */
  it('makes a gig folder inside <gigs>/setup, never beside it', async () => {
    const create = vi.fn().mockResolvedValue({ ok: true, folderPath: '/gigs/setup/x' })
    setApi({ createGigFolder: create })
    await createGigFolder('/gigs', 'w7q4hbz1nm')
    expect(create).toHaveBeenCalledWith('/gigs/setup', 'w7q4hbz1nm')
  })

  it('lists <songs>/song-performance, from the songs root', async () => {
    const list = vi.fn().mockResolvedValue({ ok: true, present: true, files: ['a.json'] })
    setApi({ listSongsFolder: list })
    expect(await listSongsFolder('/vault/songs')).toEqual({
      files: ['a.json'],
      problem: null,
      answered: true,
    })
    expect(list).toHaveBeenCalledWith('/vault/songs/song-performance')
  })

  it('says nobody looked when there is no Electron, which is not an empty catalogue', async () => {
    // The difference the Songs list renders: *nothing there* empties it, *we could not look*
    // leaves it showing what the app already knows.
    setApi({})
    expect(await listSongsFolder('/vault/songs')).toEqual({
      files: [],
      problem: null,
      answered: false,
    })
  })

  it('reports a catalogue that will not read, and calls it no answer at all', async () => {
    // "No songs yet" with a folder full of songs is the app disagreeing with the disk in the
    // quietest possible way. **`answered` is false** (2026-09-02): a read that failed says nothing
    // about what is in the folder, and calling it an answer emptied the list AND announced every
    // song in it as vanished.
    setApi({
      listSongsFolder: vi.fn().mockResolvedValue({ ok: false, error: 'EACCES: permission denied' }),
    })
    expect(await listSongsFolder('/vault/songs')).toEqual({
      files: [],
      problem: 'EACCES: permission denied',
      answered: false,
    })
  })

  it('asks about the songs root before it asks what is inside it', async () => {
    // `song-performance/` is absent on a fresh machine and that is deliberately not a problem — so
    // a catalogue on a drive that is not plugged in reads as an empty folder inside a folder
    // nobody checked. The root is the question that catches it.
    const list = vi.fn().mockResolvedValue({ ok: true, present: false, files: [] })
    setApi({
      listSongsFolder: list,
      folderReadable: vi.fn().mockResolvedValue({ ok: false, error: 'ENOENT: /vault/songs' }),
    })
    expect(await listSongsFolder('/vault/songs')).toEqual({
      files: [],
      problem: 'ENOENT: /vault/songs',
      answered: false,
    })
    expect(list).not.toHaveBeenCalled()
  })

  it('says nobody looked at a folder when there is no Electron to look with', async () => {
    // Never *it is not there*: a browser tab has no filesystem, and a screen that disabled a half
    // on that would be reporting a fact it never learned.
    setApi({})
    expect(await folderReadable('/vault/gigs')).toEqual({
      readable: true,
      answered: false,
      problem: null,
    })
  })

  it('names why a folder would not read, and says it did look', async () => {
    setApi({ folderReadable: vi.fn().mockResolvedValue({ ok: false, error: 'ENOENT: /vault/gigs' }) })
    expect(await folderReadable('/vault/gigs')).toEqual({
      readable: false,
      answered: true,
      problem: 'ENOENT: /vault/gigs',
    })
  })

  it('turns a rejected bridge call into a value, never a throw', async () => {
    setApi({ readGigFolder: vi.fn().mockRejectedValue(new Error('bridge is gone')) })
    expect((await readGigFolder('/gigs/x')).gigError).toBe('bridge is gone')
  })

  it('turns a rejected write into a value too', async () => {
    setApi({ writeGigFile: vi.fn().mockRejectedValue(new Error('EROFS')) })
    expect(await writeGigFile('/gigs/x', '{}')).toEqual({ ok: false, error: 'EROFS' })
  })

  // ── Pickers reopen where they last were, per picker ──────────────────────────────────────

  it('opens a picker where it last was, and remembers where it went', async () => {
    const openFile = vi.fn().mockResolvedValue('/takes/libertad/take-3.m4a')
    setApi({ openFileDialog: openFile })
    // Nothing remembered yet: the OS decides where it opens.
    await chooseFilePath('audio')
    expect(openFile).toHaveBeenCalledWith('audio', undefined)
    await chooseFilePath('audio')
    expect(openFile).toHaveBeenLastCalledWith('audio', '/takes/libertad')
  })

  it('keeps the words picker and the recording picker apart', async () => {
    const openFile = vi
      .fn()
      .mockResolvedValueOnce('/vault/lyrics/libertad.txt')
      .mockResolvedValueOnce('/takes/libertad/take-3.m4a')
      .mockResolvedValue(null)
    setApi({ openFileDialog: openFile })
    await chooseFilePath('lyrics')
    await chooseFilePath('audio')
    await chooseFilePath('lyrics')
    expect(openFile).toHaveBeenLastCalledWith('lyrics', '/vault/lyrics')
  })

  it('remembers a folder picker beside its answer, per picker', async () => {
    const openFolder = vi.fn().mockResolvedValue('/Users/j/Chango Pepper/songs')
    setApi({ openFolderDialog: openFolder })
    await chooseFolderPath('Where your songs live', 'songs-folder')
    await chooseFolderPath('Where your songs live', 'songs-folder')
    expect(openFolder).toHaveBeenLastCalledWith(
      'Where your songs live',
      '/Users/j/Chango Pepper'
    )
    // A different picker still has nothing to say.
    await chooseFolderPath('Where your gigs live', 'gigs-folder')
    expect(openFolder).toHaveBeenLastCalledWith('Where your gigs live', undefined)
  })

  it('never lets a validation failure become a hard block', async () => {
    setApi({ validateSongForPerformance: vi.fn().mockRejectedValue(new Error('spawn blew up')) })
    expect(await validateSongForPerformance('/songs/x.json')).toEqual({
      status: 'skipped',
      reason: 'spawn blew up',
    })
  })

  it('reads a file’s existence through getFileStats', async () => {
    setApi({ getFileStats: vi.fn().mockResolvedValue({ exists: true, size: 12 }) })
    expect(await fileExists('/x')).toBe(true)
  })

  it('treats a stat that throws as absent', async () => {
    setApi({ getFileStats: vi.fn().mockRejectedValue(new Error('nope')) })
    expect(await fileExists('/x')).toBe(false)
  })
})
