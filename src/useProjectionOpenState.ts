import { useState, useEffect } from 'react'

export interface ProjectionAPI {
  isProjectionOpen: () => Promise<boolean>
  onProjectionOpened: (cb: () => void) => () => void
  onProjectionClosed: (cb: () => void) => () => void
  openProjection: () => Promise<void>
  closeProjection: () => Promise<void>
}

/**
 * Syncs projection open/closed state with the Electron projection window.
 * - On mount: asks isProjectionOpen() and subscribes to opened/closed events.
 * - openProjection / closeProjection call the API and update state (optimistic + event-driven).
 */
export function useProjectionOpenState(api: ProjectionAPI | undefined): {
  projectionOpen: boolean
  openProjection: () => void
  closeProjection: () => void
} {
  const [projectionOpen, setProjectionOpen] = useState(false)

  useEffect(() => {
    if (!api?.isProjectionOpen || !api?.onProjectionOpened || !api?.onProjectionClosed) return
    let cancelled = false
    api.isProjectionOpen().then((open) => {
      if (!cancelled) setProjectionOpen(open)
    })
    const unsubOpened = api.onProjectionOpened(() => setProjectionOpen(true))
    const unsubClosed = api.onProjectionClosed(() => setProjectionOpen(false))
    return () => {
      cancelled = true
      unsubOpened()
      unsubClosed()
    }
  }, [api])

  const openProjection = () => {
    if (!api?.openProjection) return
    api.openProjection()
    setProjectionOpen(true)
  }

  const closeProjection = () => {
    if (!api?.closeProjection) return
    api.closeProjection()
    setProjectionOpen(false)
  }

  return { projectionOpen, openProjection, closeProjection }
}
