import { describe, it, expect, afterEach, vi } from 'vitest'
import {
  chooseGigFolderPath,
  fileExists,
  hasGigFolderAccess,
  readGigFolder,
  validateSongForPerformance,
  writeGigFile,
} from './platform'

function setApi(api: unknown) {
  ;(window as unknown as { electronAPI?: unknown }).electronAPI = api
}

afterEach(() => {
  delete (window as unknown as { electronAPI?: unknown }).electronAPI
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
  it('passes the visuals pointer through', async () => {
    const readGig = vi.fn().mockResolvedValue({ folderPath: '/gigs/x' })
    setApi({ readGigFolder: readGig })
    await readGigFolder('/gigs/x', './room/v.json')
    expect(readGig).toHaveBeenCalledWith('/gigs/x', './room/v.json')
  })

  it('turns a rejected bridge call into a value, never a throw', async () => {
    setApi({ readGigFolder: vi.fn().mockRejectedValue(new Error('bridge is gone')) })
    expect((await readGigFolder('/gigs/x')).gigError).toBe('bridge is gone')
  })

  it('turns a rejected write into a value too', async () => {
    setApi({ writeGigFile: vi.fn().mockRejectedValue(new Error('EROFS')) })
    expect(await writeGigFile('/gigs/x', '{}')).toEqual({ ok: false, error: 'EROFS' })
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
