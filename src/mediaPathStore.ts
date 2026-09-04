import { getVisualsFolder } from './contentFolders'
import { joinPath } from './paths'

export const MEDIA_PATH_STORE_KEY = 'mediaPathStore'

type MediaPathMap = Record<string, string>

export type MediaValidationWarning = 'mov-or-prores' | 'large-file'

const LARGE_FILE_THRESHOLD_BYTES = 500_000_000

function readMap(): MediaPathMap {
  try {
    if (typeof localStorage === 'undefined') return {}
    const raw = localStorage.getItem(MEDIA_PATH_STORE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const map: MediaPathMap = {}
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === 'string') map[k] = v
    }
    return map
  } catch {
    return {}
  }
}

function writeMap(map: MediaPathMap): void {
  if (typeof localStorage === 'undefined') return
  localStorage.setItem(MEDIA_PATH_STORE_KEY, JSON.stringify(map))
}

/** Returns the remembered absolute path for `src`, or null if none. */
export function getMediaPath(src: string): string | null {
  if (!src) return null
  return readMap()[src] ?? null
}

/**
 * **Where this machine keeps the file called `src`** — the answer every renderer wants.
 *
 * Two sources, in order: the per-source link, then the configured media folder. The link is the
 * override for a file that is somewhere else; the folder is the answer for everything that is
 * where it says it is, which is what makes a logo, a QR code and a video resolve without anybody
 * clicking *Locate…* fourteen times.
 *
 * Null means this machine has no answer, and the callers paint nothing rather than a placeholder.
 */
export function resolveMediaPath(src: string): string | null {
  if (!src) return null
  const linked = getMediaPath(src)
  if (linked) return linked
  const folder = getVisualsFolder()
  return folder === null ? null : joinPath(folder, src)
}

/** Persists an absolute path for the given logical `src` filename. */
export function setMediaPath(src: string, absolutePath: string): void {
  if (!src || !absolutePath) return
  const map = readMap()
  map[src] = absolutePath
  writeMap(map)
}

/** Removes the remembered path for `src`. No-op if not present. */
export function removeMediaPath(src: string): void {
  if (!src) return
  const map = readMap()
  if (!(src in map)) return
  delete map[src]
  writeMap(map)
}

/**
 * Returns warnings for a video file that isn't a web-playable delivery format.
 * Does NOT block import — callers surface these as non-fatal warnings.
 *
 * @param absolutePath  Full path to the video file (used for extension check).
 * @param fileSizeBytes Optional file size in bytes (from Electron IPC `getFileStats`).
 */
export function validateVideoForImport(
  absolutePath: string,
  fileSizeBytes?: number
): MediaValidationWarning[] {
  const warnings: MediaValidationWarning[] = []
  const lower = absolutePath.toLowerCase()
  if (lower.endsWith('.mov') || lower.endsWith('.prores')) {
    warnings.push('mov-or-prores')
  }
  if (fileSizeBytes !== undefined && fileSizeBytes > LARGE_FILE_THRESHOLD_BYTES) {
    warnings.push('large-file')
  }
  return warnings
}

/**
 * Converts an absolute file path to a `media://local/...` URL served by the
 * Electron custom protocol handler (registered in electron/main.cjs). Spaces
 * and special characters are percent-encoded path-segment by path-segment;
 * slashes are preserved so the full path is the URL path component.
 *
 * The fixed `local` host is required: an empty-host media:/// URL is
 * canonicalized by Chromium into media://firstsegment/..., absorbing and
 * lowercasing the first path segment as the hostname, which breaks the path
 * reconstruction in the main-process handler. Use this instead of file:// URLs,
 * which are blocked by webSecurity when the renderer runs on http://localhost.
 */
export function absolutePathToMediaUrl(absolutePath: string): string {
  const encodedPath = absolutePath
    .split('/')
    .map((segment, i) => (i === 0 ? segment : encodeURIComponent(segment)))
    .join('/')
  return `media://local${encodedPath}`
}
