export interface LyricLine {
  es: string
  tr: string
}

export interface SectionMarker {
  type: 'section'
  label: string
}

export type SongItem = LyricLine | SectionMarker

const KEY_SONG_LINES = 'songLines'
const KEY_SONG_INDEX = 'songIndex'
const KEY_SONG_BLANK = 'songBlank'
const KEY_CURRENT_SONG_ID = 'currentSongId'

export function isSection(item: SongItem): item is SectionMarker {
  return 'type' in item && item.type === 'section'
}

export function isLyricLine(item: SongItem): item is LyricLine {
  return !isSection(item) && 'es' in item && 'tr' in item
}

function validateLine(item: unknown, index: number): SongItem {
  if (item !== null && typeof item === 'object') {
    const obj = item as Record<string, unknown>
    if (obj.type === 'section') {
      const label = obj.label
      if (typeof label !== 'string') {
        throw new Error(`Item ${index}: section must have a string "label"`)
      }
      return { type: 'section', label }
    }
    const es = obj.es
    const tr = obj.tr
    if (typeof es !== 'string' || typeof tr !== 'string') {
      throw new Error(`Item ${index}: lyric line must have "es" and "tr" strings`)
    }
    const esTrim = es.trim()
    const trTrim = tr.trim()
    if (esTrim === '' || trTrim === '') {
      throw new Error(`Item ${index}: "es" and "tr" must be non-empty`)
    }
    return { es: esTrim, tr: trTrim }
  }
  throw new Error(`Item ${index}: must be an object (lyric line or section marker)`)
}

/**
 * Parse and validate JSON. Returns array of SongItem.
 * Normal lines: { "es": "...", "tr": "..." }
 * Section markers: { "type": "section", "label": "..." }
 */
export function parseSongJson(jsonString: string): SongItem[] {
  const raw = JSON.parse(jsonString)
  if (!Array.isArray(raw)) {
    throw new Error('JSON must be a flat array')
  }
  return raw.map((item, index) => validateLine(item, index))
}

export function getSongLines(): SongItem[] {
  try {
    const stored = localStorage.getItem(KEY_SONG_LINES)
    if (!stored) return []
    const parsed = JSON.parse(stored) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed as SongItem[]
  } catch {
    return []
  }
}

export function setSongLines(lines: SongItem[]): void {
  localStorage.setItem(KEY_SONG_LINES, JSON.stringify(lines))
}

export function getSongIndex(): number {
  const raw = localStorage.getItem(KEY_SONG_INDEX)
  if (raw === null || raw === '') return -1
  const n = Number(raw)
  if (Number.isNaN(n) || n < -1) return -1
  return Math.floor(n)
}

export function setSongIndex(index: number): void {
  const value = index < 0 ? -1 : Math.max(0, Math.floor(index))
  localStorage.setItem(KEY_SONG_INDEX, String(value))
}

export function getBlank(): boolean {
  return localStorage.getItem(KEY_SONG_BLANK) === 'true'
}

export function setBlank(blank: boolean): void {
  localStorage.setItem(KEY_SONG_BLANK, String(blank))
}

export function getCurrentSongId(): string {
  return localStorage.getItem(KEY_CURRENT_SONG_ID) || ''
}

export function setCurrentSongId(id: string): void {
  localStorage.setItem(KEY_CURRENT_SONG_ID, id)
}

export function getCurrentItem(lines: SongItem[], index: number): SongItem | null {
  if (lines.length === 0 || index < 0 || index >= lines.length) return null
  return lines[index]
}

/** Index of the next lyric line (skipping section markers), or -1 if none. */
export function getNextLyricIndex(lines: SongItem[], fromIndex: number): number {
  for (let i = fromIndex + 1; i < lines.length; i++) {
    if (isLyricLine(lines[i])) return i
  }
  return -1
}

/** Bounds-safe next index (moves by one item). From -1 goes to 0. */
export function nextIndex(lines: SongItem[], current: number): number {
  if (lines.length === 0) return current
  if (current < 0) return 0
  return Math.min(current + 1, lines.length - 1)
}

/** Bounds-safe previous index. From -1 stays -1. */
export function prevIndex(_lines: SongItem[], current: number): number {
  if (current <= -1) return -1
  return Math.max(0, current - 1)
}
