/**
 * Test-only helper for standing up **a room**: a gig folder and the `visuals.json` read out of it.
 *
 * The Projection window learns the room from the Control window's broadcast, so a test that wants
 * shapes on the wall seeds the two `localStorage` keys the Control window would have written after
 * reading the gig folder. This is the same seam the real read uses, not a back door around it:
 * `getBroadcastVisuals` re-parses what it finds here through `parseVisualsFile`, so a room that
 * would be refused in production is refused here too.
 *
 * **No room installed means no gig folder open, which means the wall is dark.** That is the whole
 * of the empty state and several tests rely on it, so `installRoom` is never called implicitly.
 */
import { KEY_VISUALS_BROADCAST } from '../visualsBroadcast'
import { GIG_FOLDER_KEY } from '../gigFolderStore'
import type { Point, VisualShape } from '../visualsFile'

export const TEST_GIG_FOLDER = '/gigs/2026-09-12-bar-eduard'
export const TEST_GIG_ID = '2026-09-12-bar-eduard'

/** The whole output frame, in the corner order used everywhere: [TL, TR, BR, BL]. */
export const FULL_FRAME: Point[] = [
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 1],
]

export function shape(
  id: string,
  type: string,
  corners: Point[] = FULL_FRAME,
  extra: Partial<VisualShape> = {}
): VisualShape {
  return {
    id,
    name: id,
    corners,
    outline: corners,
    layer: { type },
    visible: true,
    ...extra,
  }
}

type RoomOptions = {
  shapes?: VisualShape[]
  /** `{ type: [shapeId] }` at gig level. Defaults to every shape, under its own type. */
  defaults?: Record<string, string[]>
  /** Per-song reassignment: `{ songId: { type: [shapeId] } }`. */
  songs?: Record<string, Record<string, string[]>>
  gigId?: string
  folderPath?: string
  visualsVersion?: number
}

function defaultsFor(shapes: readonly VisualShape[]): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  for (const s of shapes) {
    const type = s.layer?.type
    if (typeof type !== 'string') continue
    ;(out[type] ??= []).push(s.id)
  }
  return out
}

/** The default room: one lyrics shape and one video shape, both filling the frame. */
export const DEFAULT_ROOM_SHAPES: VisualShape[] = [
  shape('video-1', 'song-video'),
  shape('lyrics-1', 'song-lyrics'),
]

/** Opens a gig and puts a room in it. Returns the shapes, in paint order. */
export function installRoom(options: RoomOptions = {}): VisualShape[] {
  const shapes = options.shapes ?? DEFAULT_ROOM_SHAPES
  const gigId = options.gigId ?? TEST_GIG_ID
  const folderPath = options.folderPath ?? TEST_GIG_FOLDER
  const visuals = {
    visualsVersion: options.visualsVersion ?? 1,
    gigId,
    shapes,
    songVisuals: {
      defaults: options.defaults ?? defaultsFor(shapes),
      songs: options.songs ?? {},
    },
  }
  localStorage.setItem(GIG_FOLDER_KEY, folderPath)
  localStorage.setItem(
    KEY_VISUALS_BROADCAST,
    JSON.stringify({ folderPath, gigId, visuals })
  )
  return shapes
}

/** Closes the gig: no folder, no room, dark wall. */
export function closeRoom(): void {
  localStorage.removeItem(GIG_FOLDER_KEY)
  localStorage.removeItem(KEY_VISUALS_BROADCAST)
}
