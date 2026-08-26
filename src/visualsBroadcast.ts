/**
 * **`visuals.json`, carried from the Control window to the Projection window.**
 *
 * The Projection window is created without a preload script, so it has no `window.electronAPI`
 * and cannot read the gig folder itself. That is not a limitation to route around: the Control
 * window is the one that opens a gig and re-reads it, and having a second reader would mean two
 * answers to *which room is this* — the same duplication the warp is shared code to avoid.
 *
 * So the room travels over the `localStorage` channel this app already uses for state each window
 * owns a local resource for. It is a **cache of a file Pregonero does not write**: Muralista owns
 * `visuals.json`, Pregonero only ever reads it, and this key only ever holds what was read.
 *
 * **The gig folder is part of the payload, and it is what makes a stale value harmless.**
 * `localStorage` survives a quit, so the key can still hold last night's room at the next launch.
 * A reader checks it against the folder actually remembered — `gigSession`'s own key — and a
 * mismatch reads as no room at all. **No gig folder open means there is nothing to project**, and
 * the Projection window is dark; that is the same empty-state model as a shape whose song is not
 * playing, not a fallback path.
 *
 * The value is read at mount and on every `storage` event, so the missed-event problem the nonce
 * rule in `CLAUDE.md` exists for does not arise here — a suppressed no-op event is harmless when
 * the mount-time read is already correct. The write-through in `gigSession` is what keeps that
 * true: it fires on every read of the gig folder, not only when something changed.
 */

import { useEffect, useState } from 'react'
import { parseVisualsFile, type VisualsFile } from './visualsFile'
import { getRememberedGigFolder } from './gigFolderStore'

export const KEY_VISUALS_BROADCAST = 'pregoneroVisualsBroadcast'

type Payload = {
  folderPath: string
  gigId: string
  visuals: unknown
}

/** Called wherever the gig folder is read. `null` clears the room, which darkens the wall. */
export function broadcastVisuals(
  folderPath: string | null,
  visuals: VisualsFile | null
): void {
  try {
    if (typeof localStorage === 'undefined') return
    if (folderPath === null || visuals === null) {
      localStorage.removeItem(KEY_VISUALS_BROADCAST)
      return
    }
    const payload: Payload = { folderPath, gigId: visuals.gigId, visuals }
    localStorage.setItem(KEY_VISUALS_BROADCAST, JSON.stringify(payload))
  } catch {
    /* unavailable in some environments */
  }
}

/**
 * The room to paint, or null.
 *
 * It is re-parsed through `parseVisualsFile` rather than trusted as an object, so the two hard
 * refusals — an unknown `visualsVersion`, a `gigId` that is not this gig's — hold on this side of
 * the window boundary too. A `localStorage` value is arbitrary text like any other input.
 */
export function getBroadcastVisuals(): VisualsFile | null {
  try {
    if (typeof localStorage === 'undefined') return null
    const folderPath = getRememberedGigFolder()
    if (folderPath === null) return null
    const raw = localStorage.getItem(KEY_VISUALS_BROADCAST)
    if (!raw) return null
    const payload = JSON.parse(raw) as Payload
    if (!payload || payload.folderPath !== folderPath) return null
    return parseVisualsFile(JSON.stringify(payload.visuals), payload.gigId)
  } catch {
    return null
  }
}

/** The room, kept current. Mount-time read plus every `storage` event. */
export function useBroadcastVisuals(): VisualsFile | null {
  const [visuals, setVisuals] = useState<VisualsFile | null>(getBroadcastVisuals)
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === KEY_VISUALS_BROADCAST || e.key === null) {
        setVisuals(getBroadcastVisuals())
      }
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])
  return visuals
}
