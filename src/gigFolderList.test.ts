/**
 * **The gigs list is the folder** (Jorge, 2026-09-03), and these are the three answers it gives
 * about a folder: a gig, a gig that will not read, and something that was never a gig.
 */
import { describe, it, expect, vi } from 'vitest'
import { readGigFolders } from './gigFolderList'

const gig = (over: Record<string, unknown> = {}) =>
  JSON.stringify({ gigVersion: 1, id: 'k3f9x2abcd', ...over })

function reads(byPath: Record<string, { text: string | null; present?: boolean; error?: string | null }>) {
  return async (folderPath: string) => {
    const entry = byPath[folderPath] ?? { text: null, present: false }
    return {
      gigText: entry.text,
      gigError: entry.error ?? null,
      gigPresent: entry.present ?? entry.text !== null,
    }
  }
}

const lists = (folders: string[], problem: string | null = null) => async () => ({ folders, problem })

describe('reading the gigs out of the folder', () => {
  it('makes a gig of every folder whose gig.json reads', async () => {
    const r = await readGigFolders('/gigs', {
      list: lists(['a', 'b']),
      read: reads({ '/gigs/setup/a': { text: gig() }, '/gigs/setup/b': { text: gig() } }),
    })
    expect(r.gigs).toEqual(['/gigs/setup/a', '/gigs/setup/b'])
    expect(r.unreadable).toEqual([])
    expect(r.problem).toBeNull()
  })

  it('ignores a folder with no gig.json, silently', async () => {
    // **No gig.json, no gig, no visibility** (Jorge's words). It was never claimed to be a gig, so
    // there is nothing to report: no row and no popup.
    const r = await readGigFolders('/gigs', {
      list: lists(['a', 'notagig']),
      read: reads({ '/gigs/setup/a': { text: gig() }, '/gigs/setup/notagig': { text: null } }),
    })
    expect(r.gigs).toEqual(['/gigs/setup/a'])
    expect(r.unreadable).toEqual([])
  })

  it('reports a gig.json that will not parse, and does not list it as a gig', async () => {
    // **The unreadable-song case.** Something *was* claimed to be a gig and cannot be read, which
    // is a fact about the person's own file — said once, and never drawn as a row.
    const r = await readGigFolders('/gigs', {
      list: lists(['broken']),
      read: reads({ '/gigs/setup/broken': { text: '{ not json' } }),
    })
    expect(r.gigs).toEqual([])
    expect(r.unreadable.map((u) => u.folder)).toEqual(['broken'])
    expect(r.unreadable[0]!.reason.length).toBeGreaterThan(0)
  })

  it('reports a gig.json the read itself refused, the same way', async () => {
    const r = await readGigFolders('/gigs', {
      list: lists(['broken']),
      read: reads({ '/gigs/setup/broken': { text: null, present: true, error: 'EIO' } }),
    })
    expect(r.gigs).toEqual([])
    expect(r.unreadable).toEqual([{ folder: 'broken', reason: 'EIO' }])
  })

  it('gives up on the whole list when the gigs folder itself will not read', async () => {
    // A folder that refuses is not evidence about any gig in it, so nothing is claimed either way.
    const r = await readGigFolders('/gigs', {
      list: lists([], 'ENOENT: /gigs'),
      read: reads({}),
    })
    expect(r).toEqual({ gigs: [], unreadable: [], problem: 'ENOENT: /gigs' })
  })

  it('survives a read that throws, and says nothing about that folder', async () => {
    const r = await readGigFolders('/gigs', {
      list: lists(['a', 'gone']),
      read: async (folderPath: string) => {
        if (folderPath.endsWith('gone')) throw new Error('bridge is gone')
        return { gigText: gig(), gigError: null, gigPresent: true }
      },
    })
    expect(r.gigs).toEqual(['/gigs/setup/a'])
    expect(r.unreadable).toEqual([])
  })

  it('writes nothing, ever', async () => {
    // Reading a folder must not create a file in it. The write-on-open that dated a gig.json-less
    // folder with today is exactly what this listing replaced.
    const read = vi.fn(async () => ({ gigText: null, gigError: null, gigPresent: false }))
    await readGigFolders('/gigs', { list: lists(['a']), read })
    expect(read).toHaveBeenCalledTimes(1)
  })

  it('is empty when the folder is', async () => {
    expect(await readGigFolders('/gigs', { list: lists([]), read: reads({}) })).toEqual({
      gigs: [],
      unreadable: [],
      problem: null,
    })
  })
})
