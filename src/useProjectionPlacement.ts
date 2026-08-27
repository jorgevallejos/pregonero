import { useEffect, useState } from 'react'
import { projectionPlacement } from './platform'
import type { ProjectorPlacement } from './electronApi'

const NOWHERE: ProjectorPlacement = { placed: false, reason: null, display: null }

/**
 * **Where the projection window went, and why.**
 *
 * Read after the window opens, and re-read on every arm — the projector can be plugged in between
 * arriving and doors, and the answer changes with it. **Nothing renders from this**: the output
 * size is a parameter passed on every render, and this is a sentence for a screen.
 *
 * It exists so the one-display fallback is *said*. A projection window that quietly stayed on the
 * laptop is otherwise discovered by looking at a blank wall.
 */
export function useProjectionPlacement(pollKey?: unknown): ProjectorPlacement {
  const [placement, setPlacement] = useState<ProjectorPlacement>(NOWHERE)

  useEffect(() => {
    let cancelled = false
    void projectionPlacement().then((next) => {
      if (!cancelled) setPlacement(next)
    })
    return () => {
      cancelled = true
    }
  }, [pollKey])

  return placement
}
