import { describe, it, expect } from 'vitest'
import { readGigLabels } from './gigLabels'

const gig = (fields: Record<string, unknown>) =>
  JSON.stringify({ gigVersion: 1, id: 'k3f9x2abcd', ...fields })

function reader(byPath: Record<string, string | null>) {
  return (folderPath: string) => Promise.resolve({ gigText: byPath[folderPath] ?? null })
}

/**
 * **What each gig on Backstage is called, read every time the list draws** (Jorge, 2026-09-03).
 * Never stored: a written-down label goes stale the moment a venue is corrected, which is the
 * defect this replaced.
 */
describe('readGigLabels', () => {
  it('labels each gig from its own file', async () => {
    const labels = await readGigLabels(['/gigs/setup/a', '/gigs/setup/b'], {
      read: reader({
        '/gigs/setup/a': gig({ date: '2026-10-17', venue: { name: 'Geel Coffee' } }),
        '/gigs/setup/b': gig({ date: '2026-05-16', venue: { name: 'BOM Festival' } }),
      }),
    })
    expect(labels.get('/gigs/setup/a')).toBe('2026-10-17 · Geel Coffee')
    expect(labels.get('/gigs/setup/b')).toBe('2026-05-16 · BOM Festival')
  })

  it('gives every path a label, so no row is ever nameless', async () => {
    const paths = ['/gigs/setup/a', '/gigs/setup/b', '/gigs/setup/c']
    const labels = await readGigLabels(paths, { read: reader({}) })
    expect([...labels.keys()]).toEqual(paths)
    expect([...labels.values()]).toEqual(['a', 'b', 'c'])
  })

  it('falls back to the folder for a gig with no file, and invents no night', async () => {
    const labels = await readGigLabels(['/gigs/setup/k3f9x2abcd'], { read: reader({}) })
    expect(labels.get('/gigs/setup/k3f9x2abcd')).toBe('k3f9x2abcd')
  })

  it('falls back to the folder for a file that will not parse', async () => {
    const labels = await readGigLabels(['/gigs/setup/k3f9x2abcd'], {
      read: reader({ '/gigs/setup/k3f9x2abcd': '{ not json' }),
    })
    expect(labels.get('/gigs/setup/k3f9x2abcd')).toBe('k3f9x2abcd')
  })

  it('keeps the row of a gig on a drive that is not plugged in', async () => {
    // **A folder that will not read is not a deleted gig.** The row stays, named by its folder;
    // a list that tidied itself would erase the evidence that something moved.
    const labels = await readGigLabels(['/gigs/setup/k3f9x2abcd'], {
      read: () => Promise.reject(new Error('EIO')),
    })
    expect(labels.get('/gigs/setup/k3f9x2abcd')).toBe('k3f9x2abcd')
  })

  it('reads only gig.json, never the visuals pointer', async () => {
    // The label needs the date and the venue. `gigFolderRead` is the heavier read and this is not
    // it: a list being drawn must not turn into one visuals parse per row.
    const seen: unknown[][] = []
    await readGigLabels(['/gigs/setup/a'], {
      read: (...args: unknown[]) => {
        seen.push(args)
        return Promise.resolve({ gigText: null })
      },
    })
    expect(seen).toEqual([['/gigs/setup/a']])
  })
})
