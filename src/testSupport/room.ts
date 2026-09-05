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

// **Shaped like a real gig folder, which since 2026-09-03 means an opaque id.** A test fixture
// carrying the old `2026-09-12-bar-eduard` shape is where the superseded assumption survives.
export const TEST_GIG_ID = 'k3f9x2abcd'
export const TEST_GIG_FOLDER = `/gigs/setup/${TEST_GIG_ID}`

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
  /**
   * **The room's named modes, in resolution order.** Absent means a room with no modes, which is
   * what every shape being always-on looks like and is what most of these tests want.
   */
  modes?: { id: string; name?: string; when?: { shape: string; is: 'filled' | 'empty' } }[]
  /** `{ type: [shapeId] }` at gig level. Defaults to every shape, under its own type. */
  defaults?: Record<string, string[]>
  /** Per-song reassignment: `{ songId: { type: [shapeId] } }`. */
  songs?: Record<string, Record<string, string[]>>
  /**
   * **What each song puts in each shape**: `{ songId: { shapeId: name } }`.
   *
   * A different question from `songs` above, and the two are easy to confuse: that one says *which
   * shape does this song use*, this one says *what does this song put in it*. Since *the song holds
   * no media* (Jorge, 2026-09-03) this is where a video's name lives — the song carries words and
   * timing, and nothing that has to be present on the night.
   */
  assets?: Record<string, Record<string, string>>
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

/**
 * The default room: a video shape, a lyrics shape and an intro shape, all filling the frame.
 *
 * Three shapes over the same patch of wall is not how a room is really mapped — it is the smallest
 * arrangement in which every song-aware type has somewhere to land, so a test can assert *which*
 * shape a thing appeared in.
 */
export const DEFAULT_ROOM_SHAPES: VisualShape[] = [
  shape('video-1', 'song-video'),
  shape('lyrics-1', 'song-lyrics'),
  shape('intro-1', 'song-intro'),
]

/** Opens a gig and puts a room in it. Returns the shapes, in paint order. */
export function installRoom(options: RoomOptions = {}): VisualShape[] {
  const shapes = options.shapes ?? DEFAULT_ROOM_SHAPES
  const gigId = options.gigId ?? TEST_GIG_ID
  const folderPath = options.folderPath ?? TEST_GIG_FOLDER
  const visuals = {
    visualsVersion: options.visualsVersion ?? 1,
    gigId,
    modes: options.modes ?? [],
    shapes,
    songVisuals: {
      defaults: options.defaults ?? defaultsFor(shapes),
      songs: options.songs ?? {},
      assets: options.assets ?? {},
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
