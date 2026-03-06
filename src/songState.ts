export interface LyricLine {
  es: string
  translations: Record<string, string>
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
const KEY_PROJECTION_LANGUAGE = 'projectionLanguage'

export function isSection(item: SongItem): item is SectionMarker {
  return 'type' in item && item.type === 'section'
}

export function isLyricLine(item: SongItem): item is LyricLine {
  return !isSection(item) && 'es' in item && 'translations' in item
}

function validateTranslations(obj: Record<string, unknown>, index: number): Record<string, string> {
  if (obj.translations === undefined || obj.translations === null) {
    throw new Error('Invalid song format: missing \'translations\' field.')
  }
  const trans = obj.translations
  if (typeof trans !== 'object' || Array.isArray(trans)) {
    throw new Error(`Item ${index}: "translations" must be an object`)
  }
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(trans)) {
    if (typeof k !== 'string') {
      throw new Error(`Item ${index}: "translations" keys must be strings`)
    }
    if (typeof v !== 'string') {
      throw new Error(`Item ${index}: "translations" values must be strings`)
    }
    out[k] = v.trim()
  }
  return out
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
    if (typeof es !== 'string') {
      throw new Error(`Item ${index}: lyric line must have "es" string`)
    }
    const esTrim = es.trim()
    if (esTrim === '') {
      throw new Error(`Item ${index}: "es" must be non-empty`)
    }
    const translations = validateTranslations(obj, index)
    return { es: esTrim, translations }
  }
  throw new Error(`Item ${index}: must be an object (lyric line or section marker)`)
}

/**
 * Parse and validate JSON. Returns array of SongItem.
 * Lyric lines: { "es": "...", "translations": { "en": "...", ... } }
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

export function getProjectionLanguage(): string {
  return localStorage.getItem(KEY_PROJECTION_LANGUAGE) ?? ''
}

export function setProjectionLanguage(lang: string): void {
  if (lang) {
    localStorage.setItem(KEY_PROJECTION_LANGUAGE, lang)
  } else {
    localStorage.removeItem(KEY_PROJECTION_LANGUAGE)
  }
}

/** Union of all translation keys across lyric lines. */
export function getAvailableLanguages(lines: SongItem[]): string[] {
  const set = new Set<string>()
  for (const item of lines) {
    if (isLyricLine(item)) {
      for (const k of Object.keys(item.translations)) set.add(k)
    }
  }
  return [...set].sort()
}

/** Effective projection language: stored value, or 'en' if song has it, else ''. */
export function getEffectiveProjectionLanguage(lines: SongItem[]): string {
  const stored = getProjectionLanguage()
  if (stored) return stored
  const available = getAvailableLanguages(lines)
  return available.includes('en') ? 'en' : ''
}

export function getCurrentItem(lines: SongItem[], index: number): SongItem | undefined {
  if (index < 0 || index >= lines.length) return undefined
  return lines[index]
}

/** Index of the next lyric line (skipping section markers), or -1 if none. */
export function getNextLyricIndex(lines: SongItem[], fromIndex: number): number {
  return lines.findIndex((item, i) => i > fromIndex && isLyricLine(item))
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
