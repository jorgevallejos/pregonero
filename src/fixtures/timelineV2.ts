/**
 * Golden timeline v2 fixture — Libertad, 20 lines.
 * Mirrors the fixture in `docs/timeline-v2-contract.md` exactly (do not diverge; that doc is
 * authoritative). Lyric text below is placeholder-only (not the real song lyrics).
 */
import type { TimelineEntry } from '../songState'

export const GOLDEN_LEAD_IN = {
  durationSec: 7.26,
  source: 'measured' as const,
  confidence: 'low' as const,
  apply: false,
}

export const GOLDEN_TIMELINE_ENTRIES: TimelineEntry[] = [
  { start: 0.0, end: 5.84 },
  { start: 5.84, end: 9.64 },
  { start: 9.64, end: 13.32 },
  { start: 13.32, end: 17.0 },
  { start: 17.0, end: 20.72 },
  { start: 20.72, end: 24.66 },
  { start: 24.66, end: 28.22 },
  { start: 28.22, end: 32.88 },
  { start: 32.88, end: 37.5 },
  { start: 37.5, end: 39.58 },
  { start: 39.58, end: 44.0 },
  { start: 44.0, end: 48.62 },
  { start: 48.62, end: 52.26 },
  { start: 52.26, end: 56.12 },
  { start: 56.12, end: 59.82 },
  { start: 59.82, end: 63.62 },
  { start: 63.62, end: 67.26 },
  { start: 67.26, end: 72.66 },
  { start: 72.66, end: 76.64 },
  { start: 76.64, end: 98.84 },
]

/** 20 placeholder sung lines (not the real Libertad lyrics), one per timeline entry. */
export const GOLDEN_LYRICS_20 = Array.from({ length: 20 }, (_, i) => ({
  es: `Línea ${i + 1}`,
  en: `Line ${i + 1}`,
}))

/** A full v2 song-JSON file: 20 lyric lines + the 20-entry golden timeline. */
export const GOLDEN_SONG_JSON_V2 = {
  title: 'Libertad',
  lyrics: GOLDEN_LYRICS_20,
  timelineVersion: 2,
  leadIn: GOLDEN_LEAD_IN,
  timeline: GOLDEN_TIMELINE_ENTRIES,
}

/** Same song file, but v1-shaped timeline (no timelineVersion/leadIn) — must be rejected. */
export const V1_SHAPED_SONG_JSON = {
  title: 'Libertad',
  lyrics: GOLDEN_LYRICS_20,
  timeline: GOLDEN_TIMELINE_ENTRIES,
}

/** A song file whose lyrics array carries an old-style [Estribillo] section marker — must be rejected. */
export const SONG_JSON_WITH_SECTION_MARKER = {
  title: 'Libertad',
  lyrics: [
    { type: 'section', label: '[Estribillo]' },
    { es: 'Línea 1', en: 'Line 1' },
  ],
}
