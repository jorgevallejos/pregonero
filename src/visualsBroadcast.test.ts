/** @vitest-environment jsdom */
/**
 * The room, carried across the window boundary. What is being tested is mostly what it *refuses*:
 * a value left over from a previous launch, and a file this build cannot read.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import {
  broadcastVisuals,
  getBroadcastVisuals,
  KEY_VISUALS_BROADCAST,
} from './visualsBroadcast'
import { GIG_FOLDER_KEY, rememberGigFolder } from './gigFolderStore'
import { parseVisualsFile } from './visualsFile'
import { installRoom, closeRoom, TEST_GIG_FOLDER, shape } from './testSupport/room'

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
  if (typeof globalThis.localStorage === 'undefined' || typeof globalThis.localStorage.clear !== 'function') {
    vi.stubGlobal('localStorage', createStorage())
  }
})

beforeEach(() => {
  localStorage.clear()
})

describe('the room broadcast', () => {
  it('carries the shapes the Control window read', () => {
    installRoom()
    const visuals = getBroadcastVisuals()!
    expect(visuals.shapes.map((s) => s.id)).toEqual(['video-1', 'lyrics-1', 'intro-1'])
    expect(visuals.songVisuals.defaults['song-lyrics']).toEqual(['lyrics-1'])
  })

  it('is nothing at all when no gig folder is open', () => {
    installRoom()
    localStorage.removeItem(GIG_FOLDER_KEY)
    // There is nothing to project, so there is no room. The wall is dark, which is the answer
    // rather than a fallback.
    expect(getBroadcastVisuals()).toBeNull()
  })

  it('refuses a value left over from a different gig folder', () => {
    // localStorage survives a quit, so the key can still hold last night's room at the next
    // launch. Checking it against the folder actually remembered is what makes that harmless.
    installRoom({ folderPath: '/gigs/last-month' })
    rememberGigFolder(TEST_GIG_FOLDER)
    expect(getBroadcastVisuals()).toBeNull()
  })

  it('refuses a visualsVersion this build does not know, on this side of the window too', () => {
    installRoom({ visualsVersion: 99 })
    expect(getBroadcastVisuals()).toBeNull()
  })

  it('refuses a room mapped for another gig', () => {
    // Copying last month's gig folder and not re-mapping gives a mapping of the wrong room that
    // renders perfectly, with nothing anywhere reporting it.
    const payload = JSON.parse(localStorage.getItem(KEY_VISUALS_BROADCAST) ?? '{}') as unknown
    expect(payload).toEqual({})
    installRoom()
    const stored = JSON.parse(localStorage.getItem(KEY_VISUALS_BROADCAST)!)
    stored.visuals.gigId = 'some-other-gig'
    localStorage.setItem(KEY_VISUALS_BROADCAST, JSON.stringify(stored))
    expect(getBroadcastVisuals()).toBeNull()
  })

  it('survives a malformed value rather than throwing at the projector', () => {
    installRoom()
    localStorage.setItem(KEY_VISUALS_BROADCAST, 'not json')
    expect(getBroadcastVisuals()).toBeNull()
  })
})

describe('broadcastVisuals', () => {
  it('clears the key when the gig closes', () => {
    installRoom()
    broadcastVisuals(null, null)
    expect(localStorage.getItem(KEY_VISUALS_BROADCAST)).toBeNull()
  })

  it('writes what a reader can read back', () => {
    rememberGigFolder('/gigs/tonight')
    const visuals = parseVisualsFile(
      JSON.stringify({
        visualsVersion: 1,
        gigId: 'tonight',
        shapes: [shape('a', 'song-lyrics')],
        songVisuals: { defaults: { 'song-lyrics': ['a'] }, songs: {} },
      }),
      'tonight'
    )
    broadcastVisuals('/gigs/tonight', visuals)
    expect(getBroadcastVisuals()?.shapes.map((s) => s.id)).toEqual(['a'])
  })

  it('goes quiet when the room is closed with closeRoom', () => {
    installRoom()
    closeRoom()
    expect(getBroadcastVisuals()).toBeNull()
  })
})
