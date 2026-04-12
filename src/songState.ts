export interface LyricLine {
  languages: Record<string, string>
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
const KEY_CURRENT_SONG_TITLE = 'currentSongTitle'
const KEY_PROJECTION_LANGUAGE = 'projectionLanguage'
const KEY_SINGING_LANGUAGE = 'singingLanguage'

export function isSection(item: SongItem): item is SectionMarker {
  return 'type' in item && item.type === 'section'
}

export function isLyricLine(item: SongItem): item is LyricLine {
  return (
    !isSection(item) &&
    'languages' in item &&
    typeof (item as LyricLine).languages === 'object' &&
    (item as LyricLine).languages !== null &&
    !Array.isArray((item as LyricLine).languages)
  )
}

/** Returns the text for a given language from a lyric line, or empty string. */
export function getLyricText(line: LyricLine, lang: string): string {
  const text = line.languages[lang]
  return typeof text === 'string' ? text.trim() : ''
}

function validateLyricLine(obj: Record<string, unknown>, index: number): LyricLine {
  const languages: Record<string, string> = {}
  let hasOne = false
  for (const [k, v] of Object.entries(obj)) {
    if (k === 'type') continue
    if (typeof k !== 'string' || k.trim() === '') {
      throw new Error(`Item ${index}: language keys must be non-empty strings`)
    }
    if (typeof v !== 'string') {
      throw new Error(`Item ${index}: language values must be strings`)
    }
    const trimmed = (v as string).trim()
    if (trimmed.length > 0) hasOne = true
    languages[k] = trimmed
  }
  if (!hasOne) {
    throw new Error(`Item ${index}: lyric line must have at least one language string`)
  }
  return { languages }
}

function validateLyricsItem(item: unknown, index: number): SongItem {
  if (item !== null && typeof item === 'object') {
    const obj = item as Record<string, unknown>
    if (obj.type === 'section') {
      const label = obj.label
      if (typeof label !== 'string') {
        throw new Error(`Item ${index}: section must have a string "label"`)
      }
      return { type: 'section', label }
    }
    return validateLyricLine(obj, index)
  }
  throw new Error(`Item ${index}: must be an object (lyric line or section marker)`)
}

/**
 * Validates a persisted lyric `items` array (same shape as parsed song `lyrics`).
 * Returns null if the value is not an array or any element fails validation.
 */
export function tryParseSongItemsArray(items: unknown): SongItem[] | null {
  if (!Array.isArray(items)) return null
  try {
    return (items as unknown[]).map((item, index) => validateLyricsItem(item, index))
  } catch {
    return null
  }
}

function tryParsePersistedLyricsItem(item: unknown, index: number): SongItem | null {
  if (item === null || typeof item !== 'object') return null
  const obj = item as Record<string, unknown>
  if (obj.type === 'section') {
    if (typeof obj.label !== 'string') return null
    return { type: 'section', label: obj.label }
  }
  if (
    'languages' in obj &&
    obj.languages !== null &&
    typeof obj.languages === 'object' &&
    !Array.isArray(obj.languages)
  ) {
    try {
      return validateLyricLine(obj.languages as Record<string, unknown>, index)
    } catch {
      return null
    }
  }
  try {
    return validateLyricLine(obj, index)
  } catch {
    return null
  }
}

/**
 * Validates persisted `items` as canonical `SongItem[]` (lyric lines use `{ languages: { … } }`).
 * Also accepts flat `{ "es": "…" }` objects for forward compatibility.
 */
export function tryParsePersistedSongItemsArray(items: unknown): SongItem[] | null {
  if (!Array.isArray(items)) return null
  const out: SongItem[] = []
  for (let i = 0; i < items.length; i++) {
    const one = tryParsePersistedLyricsItem(items[i], i)
    if (one === null) return null
    out.push(one)
  }
  return out
}

/**
 * Parsed song file format: { title: string, lyrics: Array<LyricLineRaw | SectionMarker>, notes?: string }
 * Lyric line raw: { "es": "...", "en": "...", ... }
 * Section: { "type": "section", "label": "..." }
 */
export interface ParsedSongFile {
  title: string
  items: SongItem[]
  /** Free-text performance notes (capo, mood, cues). Omitted when not present in the file. */
  notes?: string
}

export function parseSongFile(jsonString: string): ParsedSongFile {
  const raw = JSON.parse(jsonString)
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('JSON must be an object with "title" and "lyrics"')
  }
  const obj = raw as Record<string, unknown>
  if (obj.title === undefined || obj.title === null || typeof obj.title !== 'string') {
    throw new Error('Song file is missing "title"')
  }
  if (obj.lyrics === undefined || obj.lyrics === null || !Array.isArray(obj.lyrics)) {
    throw new Error('Song file is missing "lyrics"')
  }
  const items = (obj.lyrics as unknown[]).map((item, index) =>
    validateLyricsItem(item, index)
  )
  const out: ParsedSongFile = { title: obj.title.trim(), items }
  if (Object.prototype.hasOwnProperty.call(obj, 'notes')) {
    const n = obj.notes
    if (typeof n !== 'string') {
      throw new Error('Song file "notes" must be a string when present')
    }
    const trimmed = n.trim()
    if (trimmed.length > 0) {
      out.notes = trimmed
    }
  }
  return out
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

export function getCurrentSongTitle(): string {
  return localStorage.getItem(KEY_CURRENT_SONG_TITLE) || ''
}

export function setCurrentSongTitle(title: string): void {
  if (title) {
    localStorage.setItem(KEY_CURRENT_SONG_TITLE, title)
  } else {
    localStorage.removeItem(KEY_CURRENT_SONG_TITLE)
  }
}

/** Clears loaded song and lyric position; leaves language and projection preferences unchanged. */
export function resetLoadedSongState(): void {
  setCurrentSongId('')
  setCurrentSongTitle('')
  setSongLines([])
  setSongIndex(-1)
  setBlank(true)
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

export function getSingingLanguage(): string {
  return localStorage.getItem(KEY_SINGING_LANGUAGE) ?? ''
}

export function setSingingLanguage(lang: string): void {
  if (lang) {
    localStorage.setItem(KEY_SINGING_LANGUAGE, lang)
  } else {
    localStorage.removeItem(KEY_SINGING_LANGUAGE)
  }
}

/** Union of all language keys across lyric lines. */
export function getAvailableLanguages(lines: SongItem[]): string[] {
  const set = new Set<string>()
  for (const item of lines) {
    if (isLyricLine(item)) {
      for (const k of Object.keys(item.languages)) set.add(k)
    }
  }
  return [...set].sort()
}

/** Available singing languages for the current song (all languages present in lyrics). */
export function getAvailableSingingLanguages(lines: SongItem[]): string[] {
  return getAvailableLanguages(lines)
}

/** Effective singing language: stored value if available for song, else ''. */
export function getEffectiveSingingLanguage(lines: SongItem[]): string {
  const stored = getSingingLanguage()
  const available = getAvailableSingingLanguages(lines)
  return stored && available.includes(stored) ? stored : ''
}

/** Effective projection language: stored value if available in song, else 'en' if no stored and song has it, else ''. */
export function getEffectiveProjectionLanguage(lines: SongItem[]): string {
  const stored = getProjectionLanguage()
  const available = getAvailableLanguages(lines)
  if (stored) {
    return available.includes(stored) ? stored : ''
  }
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

/** Index of the last lyric line in the song, or -1 if there are no lyric lines. */
export function getLastLyricIndex(lines: SongItem[]): number {
  for (let i = lines.length - 1; i >= 0; i--) {
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
