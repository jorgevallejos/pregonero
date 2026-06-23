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

export interface TimelineEntry {
  start: number
  end: number
}

export interface MediaFile {
  type: 'video' | 'audio'
  src: string
  /** Seconds from the beginning of the file at which playback begins (skips blank lead-in). */
  trimStart?: number
  offset?: number
}

/** Per-song media container: optional big-screen and small-screen video files. */
export interface SongMedia {
  big?: MediaFile
  small?: MediaFile
}

/** @deprecated Use MediaFile. Kept for backward compatibility. */
export type MediaMetadata = MediaFile

/** Tempo for count-in and beat-pulse display in the performer view (mirrors SongTempo in setlistStore). */
export interface SongTempoFromFile {
  bpm: number
  numerator: number
  denominator: number
  countInBars?: number
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
  /** Title translated into other languages, keyed by language code. Omitted when not present. */
  title_translations?: Record<string, string>
  /** One-line intro tagline per language shown on the intro screen. Omitted when not present. */
  intro?: Record<string, string>
  /** Timing entries in seconds, one per lyrics array item (including sections). Omitted when not present. */
  timeline?: TimelineEntry[]
  /** Optional media files (video or audio) for big and small screens. Omitted when not present. */
  media?: SongMedia
  /** Optional tempo for count-in and beat-pulse display. Omitted when not present. */
  tempo?: SongTempoFromFile
}

function validateTimeline(timeline: unknown, itemCount: number): TimelineEntry[] {
  if (!Array.isArray(timeline)) {
    throw new Error('Song file timeline must be an array when present')
  }
  if (timeline.length !== itemCount) {
    throw new Error(`Song file timeline length must match lyric count (${itemCount})`)
  }
  const entries: TimelineEntry[] = []
  let previousEnd = -Infinity
  for (let i = 0; i < timeline.length; i++) {
    const item = timeline[i]
    if (item === null || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error(`Song file timeline[${i}]: must be an object`)
    }
    const entry = item as Record<string, unknown>
    const start = entry.start
    const end = entry.end
    if (typeof start !== 'number' || typeof end !== 'number') {
      throw new Error(`Song file timeline[${i}]: must have numeric start and end`)
    }
    if (start < 0 || end < 0) {
      throw new Error(`Song file timeline[${i}]: times must be non-negative`)
    }
    if (start < previousEnd) {
      throw new Error(`Song file timeline[${i}]: times must be monotonic (start >= previous end)`)
    }
    entries.push({ start, end })
    previousEnd = end
  }
  return entries
}

function validateMediaFile(obj: Record<string, unknown>): MediaFile {
  const type = obj.type
  const src = obj.src
  const offset = obj.offset
  if (type !== 'video' && type !== 'audio') {
    throw new Error('Song file "media" type must be "video" or "audio"')
  }
  if (typeof src !== 'string' || src.trim().length === 0) {
    throw new Error('Song file "media" src must be a non-empty string')
  }
  const result: MediaFile = { type, src: src.trim() }
  const trimStart = obj.trimStart
  if (trimStart !== undefined) {
    if (typeof trimStart !== 'number' || trimStart < 0) {
      throw new Error('Song file "media" trimStart must be a non-negative number when present')
    }
    result.trimStart = trimStart
  }
  if (offset !== undefined) {
    if (typeof offset !== 'number' || offset < 0) {
      throw new Error('Song file "media" offset must be a non-negative number when present')
    }
    result.offset = offset
  }
  return result
}

function validateMedia(media: unknown): SongMedia {
  if (media === null || typeof media !== 'object' || Array.isArray(media)) {
    throw new Error('Song file "media" must be an object when present')
  }
  const obj = media as Record<string, unknown>
  // Old flat format: has 'type' key → auto-migrate to { small: ... }
  if (obj.type !== undefined) {
    return { small: validateMediaFile(obj) }
  }
  // New SongMedia format: has 'big' and/or 'small' keys
  const result: SongMedia = {}
  if (obj.big !== undefined) {
    if (obj.big === null || typeof obj.big !== 'object' || Array.isArray(obj.big)) {
      throw new Error('Song file "media.big" must be an object when present')
    }
    result.big = validateMediaFile(obj.big as Record<string, unknown>)
  }
  if (obj.small !== undefined) {
    if (obj.small === null || typeof obj.small !== 'object' || Array.isArray(obj.small)) {
      throw new Error('Song file "media.small" must be an object when present')
    }
    result.small = validateMediaFile(obj.small as Record<string, unknown>)
  }
  if (result.big === undefined && result.small === undefined) {
    throw new Error('Song file "media" must have at least one of "big" or "small"')
  }
  return result
}

function validateTempo(tempo: unknown): SongTempoFromFile {
  if (tempo === null || typeof tempo !== 'object' || Array.isArray(tempo)) {
    throw new Error('Song file "tempo" must be an object when present')
  }
  const obj = tempo as Record<string, unknown>
  if (typeof obj.bpm !== 'number' || obj.bpm <= 0) {
    throw new Error('Song file "tempo.bpm" must be a positive number')
  }
  let numerator: number
  let denominator: number
  if (obj.numerator !== undefined || obj.denominator !== undefined) {
    // New format: explicit numerator + denominator
    if (typeof obj.numerator !== 'number' || !Number.isInteger(obj.numerator) || obj.numerator <= 0) {
      throw new Error('Song file "tempo.numerator" must be a positive integer')
    }
    if (typeof obj.denominator !== 'number' || !Number.isInteger(obj.denominator) || obj.denominator <= 0) {
      throw new Error('Song file "tempo.denominator" must be a positive integer')
    }
    numerator = obj.numerator
    denominator = obj.denominator
  } else if (obj.meter !== undefined) {
    // Old format: meter: N defaults to { numerator: N, denominator: 4 }
    if (typeof obj.meter !== 'number' || !Number.isInteger(obj.meter) || obj.meter <= 0) {
      throw new Error('Song file "tempo.meter" must be a positive integer')
    }
    numerator = obj.meter
    denominator = 4
  } else {
    throw new Error('Song file "tempo" must have "numerator" and "denominator"')
  }
  const result: SongTempoFromFile = { bpm: obj.bpm, numerator, denominator }
  if (obj.countInBars !== undefined) {
    if (typeof obj.countInBars !== 'number' || !Number.isInteger(obj.countInBars) || obj.countInBars <= 0) {
      throw new Error('Song file "tempo.countInBars" must be a positive integer when present')
    }
    result.countInBars = obj.countInBars
  }
  return result
}

/**
 * Validates a song JSON object (after `JSON.parse`): `title`, `lyrics`, optional `notes`.
 * Used by `parseSongFile` and by the setlist import path.
 */
export function parseSongRecordFromUnknown(raw: Record<string, unknown>): ParsedSongFile {
  if (raw.title === undefined || raw.title === null || typeof raw.title !== 'string') {
    throw new Error('Song file is missing "title"')
  }
  if (raw.lyrics === undefined || raw.lyrics === null || !Array.isArray(raw.lyrics)) {
    throw new Error('Song file is missing "lyrics"')
  }
  const items = (raw.lyrics as unknown[]).map((item, index) =>
    validateLyricsItem(item, index)
  )
  const out: ParsedSongFile = { title: raw.title.trim(), items }
  if (Object.prototype.hasOwnProperty.call(raw, 'notes')) {
    const n = raw.notes
    if (typeof n !== 'string') {
      throw new Error('Song file "notes" must be a string when present')
    }
    const trimmed = n.trim()
    if (trimmed.length > 0) {
      out.notes = trimmed
    }
  }
  if (Object.prototype.hasOwnProperty.call(raw, 'title_translations')) {
    const tt = raw.title_translations
    if (tt === null || typeof tt !== 'object' || Array.isArray(tt)) {
      throw new Error('Song file "title_translations" must be an object when present')
    }
    const map: Record<string, string> = {}
    for (const [k, v] of Object.entries(tt as Record<string, unknown>)) {
      if (typeof v !== 'string') {
        throw new Error('Song file "title_translations" values must be strings')
      }
      const trimmed = v.trim()
      if (trimmed.length > 0) map[k] = trimmed
    }
    if (Object.keys(map).length > 0) out.title_translations = map
  }
  // intro_cues (old string field) is silently dropped; use "intro" object instead
  if (Object.prototype.hasOwnProperty.call(raw, 'intro')) {
    const intr = raw.intro
    if (intr === null || typeof intr !== 'object' || Array.isArray(intr)) {
      // plain string or non-object intro: silently drop (old format or single-lang value)
    } else {
      const map: Record<string, string> = {}
      for (const [k, v] of Object.entries(intr as Record<string, unknown>)) {
        if (typeof v !== 'string') {
          throw new Error('Song file "intro" values must be strings')
        }
        const trimmed = v.trim()
        if (trimmed.length > 0) map[k] = trimmed
      }
      if (Object.keys(map).length > 0) out.intro = map
    }
  }
  if (Object.prototype.hasOwnProperty.call(raw, 'timeline')) {
    const tl = raw.timeline
    if (tl !== null && tl !== undefined) {
      out.timeline = validateTimeline(tl, items.length)
    }
  }
  if (Object.prototype.hasOwnProperty.call(raw, 'media')) {
    const m = raw.media
    if (m !== null && m !== undefined) {
      out.media = validateMedia(m)
    } else {
      throw new Error('Song file "media" must be an object when present')
    }
  }
  if (Object.prototype.hasOwnProperty.call(raw, 'tempo')) {
    const t = raw.tempo
    if (t !== null && t !== undefined) {
      out.tempo = validateTempo(t)
    } else {
      throw new Error('Song file "tempo" must be an object when present')
    }
  }
  return out
}

export function parseSongFile(jsonString: string): ParsedSongFile {
  const raw = JSON.parse(jsonString)
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('JSON must be an object with "title" and "lyrics"')
  }
  return parseSongRecordFromUnknown(raw as Record<string, unknown>)
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
