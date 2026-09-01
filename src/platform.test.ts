import { describe, it, expect, afterEach, beforeAll, vi } from 'vitest'
import { ensureStorage } from './testSupport/storage'
import {
  chooseGigFolderPath,
  fileExists,
  chooseFilePath,
  chooseFolderPath,
  hasGigFolderAccess,
  listSongsFolder,
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
    expect(await chooseGigFolderPath()).toBeNull()
  })

  it('cannot see a file', async () => {
    expect(await fileExists('/x')).toBe(false)
  })
})

describe('inside Electron', () => {
  it('passes the visuals pointer through, and looks in <gig>/setup', async () => {
    // **The gig folder goes in and the gig folder comes back.** The `setup/` join happens here, at
    // the one boundary that talks to the main process, so every module above holds the gig folder
    // itself — `gigIdFromFolderPath` included, which would name every gig `setup` otherwise.
    const readGig = vi.fn().mockResolvedValue({ folderPath: '/gigs/x/setup' })
    setApi({ readGigFolder: readGig })
    const read = await readGigFolder('/gigs/x', './room/v.json')
    expect(readGig).toHaveBeenCalledWith('/gigs/x/setup', './room/v.json')
    expect(read.folderPath).toBe('/gigs/x')
  })

  it('writes gig.json into <gig>/setup, from the gig folder', async () => {
    const write = vi.fn().mockResolvedValue({ ok: true })
    setApi({ writeGigFile: write })
    await writeGigFile('/gigs/x', '{}')
    expect(write).toHaveBeenCalledWith('/gigs/x/setup', '{}')
  })

  it('lists <songs>/song-performance, from the songs root', async () => {
    const list = vi.fn().mockResolvedValue({ ok: true, present: true, files: ['a.json'] })
    setApi({ listSongsFolder: list })
    expect(await listSongsFolder('/vault/songs')).toEqual({ files: ['a.json'], problem: null })
    expect(list).toHaveBeenCalledWith('/vault/songs/song-performance')
  })

  it('reports a catalogue that will not read, rather than an empty one', async () => {
    // "No songs yet" with a folder full of songs is the app disagreeing with the disk in the
    // quietest possible way. The songs list says the reason out loud instead.
    setApi({
      listSongsFolder: vi.fn().mockResolvedValue({ ok: false, error: 'EACCES: permission denied' }),
    })
    expect(await listSongsFolder('/vault/songs')).toEqual({
      files: [],
      problem: 'EACCES: permission denied',
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
