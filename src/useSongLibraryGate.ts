/**
 * **The song library's gate, as one hook, because there are two documents now.**
 *
 * The library is an in-memory cache and **a document cannot hydrate from another document's
 * memory** — the Projection window has always proved that, and once the player is a framed page it
 * is a third document with the same property. So each root that needs the catalogue hydrates its
 * own; what must not exist twice is the *rule* for when it is ready, which is this.
 *
 * `#/projection` never hydrates: that window paints from what crosses on the wire and reads no
 * files. It is `'ready'` immediately, which is not a shortcut — it is that the gate has nothing to
 * hold.
 */
import { useEffect, useState } from 'react'
import { ensureSongLibraryHydrated, isLibraryHydrated } from './setlistStore'

export type SongLibraryGate = {
  state: 'loading' | 'ready' | 'error'
  error: string | null
  retry: () => void
}

export function useSongLibraryGate(isProjectionRoute: boolean): SongLibraryGate {
  const [retryKey, setRetryKey] = useState(0)
  const [state, setState] = useState<'loading' | 'ready' | 'error'>(() =>
    isProjectionRoute || isLibraryHydrated() ? 'ready' : 'loading'
  )
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (isProjectionRoute) {
      setState('ready')
      setError(null)
      return
    }
    if (isLibraryHydrated()) {
      setState('ready')
      setError(null)
      return
    }
    setState('loading')
    setError(null)
    let cancelled = false
    ensureSongLibraryHydrated()
      .then(() => {
        if (!cancelled) {
          setState('ready')
          setError(null)
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setState('error')
          setError(e instanceof Error ? e.message : 'Failed to load song library')
        }
      })
    return () => {
      cancelled = true
    }
  }, [isProjectionRoute, retryKey])

  return { state, error, retry: () => setRetryKey((k) => k + 1) }
}
