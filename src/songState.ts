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

/**
 * Whether a song carries any words at all.
 *
 * **A `bombista new` skeleton does not**, and that is its normal state — it exists to carry
 * `artist`, `notes` and `title_translations` for a song that has not been recorded yet. The
 * distinction matters wherever a song file is about to be treated as the words: handing `align` a
 * file with nothing in it to align is not a starting point.
 */
export function hasLyricLines(song: { items: SongItem[] }): boolean {
  return song.items.some(isLyricLine)
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

/**
 * The CP song format carries sung lines only — no section markers, no meta entries (P4).
 * This is a file-load boundary rule only: `SectionMarker`, `isSection`, and section rendering
 * elsewhere in the app are unaffected.
 */
function validateLyricsItem(item: unknown, index: number): SongItem {
  if (item !== null && typeof item === 'object') {
    const obj = item as Record<string, unknown>
    if (obj.type === 'section') {
      throw new Error(
        `Item ${index}: section markers are no longer supported — lyrics must contain sung lines only.`
      )
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

export interface TimelineEntry {
  start: number
  end: number
}

/**
 * Lead-in metadata accompanying a v2 timeline (see `docs/timeline-v2-contract.md`).
 * Required whenever `timelineVersion: 2` is present.
 */
export interface TimelineLeadIn {
  /** Seconds of audio before the first sung word. */
  durationSec: number
  /** `measured` = Bombista computed it; `manual` = a human overrode it. */
  source: 'measured' | 'manual' | 'none'
  /** Always `low` when `measured` — faster-whisper clamps the first sung word toward 0. */
  confidence: 'low' | 'high'
  /** `true` when the song has `media.type == "video"`, else `false`. */
  apply: boolean
}

const TIMELINE_VERSION_REJECT_MESSAGE =
  'This timeline was made by an older Bombista — re-run the extractor.'

/**
 * Shared, exact rejection message for a file that declares `timelineVersion: 2` and a valid
 * `leadIn` but carries no usable `timeline` (absent, null, not an array, or empty). Such a file
 * is truncated or half-written; loading it as a no-op would make the song look merely un-timed —
 * the exact silent-failure class this format exists to eliminate. See
 * "Producer vs consumer strictness" in docs/timeline-v2-contract.md.
 */
export const TIMELINE_INCOMPLETE_MESSAGE =
  'This timeline file is incomplete — it declares version 2 but contains no timeline.'

/**
 * Builds the (shared, exact) rejection message for a missing/mismatched `timelineVersion`.
 * `found` is the offending value (or `undefined` when the field is simply absent).
 */
export function timelineVersionRejectionMessage(found: unknown): string {
  if (found === undefined) return TIMELINE_VERSION_REJECT_MESSAGE
  return `${TIMELINE_VERSION_REJECT_MESSAGE} (found timelineVersion ${JSON.stringify(found)})`
}

/** Validates a `leadIn` block per the timeline v2 contract. `context` prefixes error messages. */
export function validateTimelineLeadIn(leadIn: unknown, context: string): TimelineLeadIn {
  if (leadIn === null || typeof leadIn !== 'object' || Array.isArray(leadIn)) {
    throw new Error(`${context} "leadIn" must be an object`)
  }
  const obj = leadIn as Record<string, unknown>
  if (typeof obj.durationSec !== 'number' || obj.durationSec < 0) {
    throw new Error(`${context} "leadIn.durationSec" must be a non-negative number`)
  }
  if (obj.source !== 'measured' && obj.source !== 'manual' && obj.source !== 'none') {
    throw new Error(`${context} "leadIn.source" must be "measured", "manual", or "none"`)
  }
  if (obj.confidence !== 'low' && obj.confidence !== 'high') {
    throw new Error(`${context} "leadIn.confidence" must be "low" or "high"`)
  }
  if (typeof obj.apply !== 'boolean') {
    throw new Error(`${context} "leadIn.apply" must be a boolean`)
  }
  return { durationSec: obj.durationSec, source: obj.source, confidence: obj.confidence, apply: obj.apply }
}

export interface MediaFile {
  type: 'video' | 'audio'
  src: string
  /** Seconds from the beginning of the file at which playback begins (skips blank lead-in). */
  trimStart?: number
  offset?: number
}

/** @deprecated v5 per-song container; kept only for migration code in setlistStore. Use MediaFile directly. */
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
  /** Timing entries in seconds, one per lyrics array item. Omitted when not present. */
  timeline?: TimelineEntry[]
  /** Timeline schema version. Only ever `2` — present iff `timeline` is present. */
  timelineVersion?: number
  /** Lead-in metadata accompanying a v2 timeline. Present iff `timelineVersion` is present. */
  leadIn?: TimelineLeadIn
  /** Optional media file (video or audio). Omitted when not present. */
  media?: MediaFile
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

function validateMedia(media: unknown): MediaFile {
  if (media === null || typeof media !== 'object' || Array.isArray(media)) {
    throw new Error('Song file "media" must be an object when present')
  }
  const obj = media as Record<string, unknown>
  // Flat format (has 'type' key) → validate and return directly as MediaFile
  if (obj.type !== undefined) {
    return validateMediaFile(obj)
  }
  // Legacy v5 SongMedia format ({ big?, small? }) → collapse to single MediaFile (big preferred)
  const big = obj.big
  const small = obj.small
  if (big !== undefined) {
    if (big === null || typeof big !== 'object' || Array.isArray(big)) {
      throw new Error('Song file "media.big" must be an object when present')
    }
    return validateMediaFile(big as Record<string, unknown>)
  }
  if (small !== undefined) {
    if (small === null || typeof small !== 'object' || Array.isArray(small)) {
      throw new Error('Song file "media.small" must be an object when present')
    }
    return validateMediaFile(small as Record<string, unknown>)
  }
  throw new Error('Song file "media" must have at least one of "big" or "small"')
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
  // Unknown top-level keys (e.g. a future "provenance" or "linesHash" envelope field) are
  // deliberately ignored, never rejected — this is a forward-compatibility guarantee from
  // docs/timeline-v2-contract.md ("Producer vs consumer strictness"), not an oversight. Only
  // the keys read below are consulted; everything else in `raw` is left untouched.
  const hasTimelineVersionKey = Object.prototype.hasOwnProperty.call(raw, 'timelineVersion')
  const hasTimelineKey = Object.prototype.hasOwnProperty.call(raw, 'timeline')
  const tl = raw.timeline
  // A song with neither key is a perfectly normal un-timed song (the 11-song regression case)
  // and must keep loading untouched — this branch is skipped entirely for it.
  if (hasTimelineVersionKey || (hasTimelineKey && tl !== null && tl !== undefined)) {
    // timelineVersion guard (P3): a timeline is only accepted when the enclosing object
    // carries timelineVersion: 2. Never coerce — a missing/older field is a hard rejection.
    // This check comes first: a file declaring an older/other version is always "an older
    // Bombista" (below), never "incomplete" — only a file correctly declaring 2 can be that.
    if (raw.timelineVersion !== 2) {
      throw new Error(timelineVersionRejectionMessage(raw.timelineVersion))
    }
    // A file that declares v2 but has no usable timeline — absent, null, not an array, or
    // empty — is truncated/half-written; reject loudly rather than silently loading it as if
    // the song simply has no timings (docs/timeline-v2-contract.md).
    const noUsableTimeline = !hasTimelineKey || tl === null || !Array.isArray(tl) || tl.length === 0
    if (noUsableTimeline) {
      throw new Error(TIMELINE_INCOMPLETE_MESSAGE)
    }
    const leadIn = validateTimelineLeadIn(raw.leadIn, 'Song file')
    out.timeline = validateTimeline(tl, items.length)
    out.timelineVersion = 2
    out.leadIn = leadIn
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
