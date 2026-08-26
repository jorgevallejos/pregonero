/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach } from 'vitest'
import type { LyricLine, SectionMarker, SongItem } from './songState'
import {
  GOLDEN_LEAD_IN,
  GOLDEN_LYRICS_20,
  GOLDEN_SONG_JSON_V2,
  GOLDEN_TIMELINE_ENTRIES,
  SONG_JSON_WITH_SECTION_MARKER,
  V1_SHAPED_SONG_JSON,
} from './fixtures/timelineV2'
import {
  getAvailableLanguages,
  getAvailableSingingLanguages,
  getBlank,
  getCurrentItem,
  getCurrentSongId,
  getEffectiveProjectionLanguage,
  getEffectiveSingingLanguage,
  getLastLyricIndex,
  getNextLyricIndex,
  getProjectionLanguage,
  getSingingLanguage,
  getSongIndex,
  getSongLines,
  nextIndex,
  parseSongFile,
  parseSongRecordFromUnknown,
  prevIndex,
  resetLoadedSongState,
  tryParseSongItemsArray,
  setCurrentSongId,
  setCurrentSongTitle,
  setProjectionLanguage,
  setSingingLanguage,
  setSongLines,
  setSongIndex,
} from './songState'

const lyric = (languages: Record<string, string>): LyricLine => ({ languages })
const section = (label: string): SectionMarker => ({ type: 'section', label })

describe('nextIndex', () => {
  it('empty array → stays at -1', () => {
    expect(nextIndex([], -1)).toBe(-1)
  })

  it('index -1 with non-empty array → goes to 0', () => {
    const lines: SongItem[] = [lyric({ es: 'Hola', en: 'Hello' })]
    expect(nextIndex(lines, -1)).toBe(0)
  })

  it('middle index → increments by 1', () => {
    const lines: SongItem[] = [
      lyric({ es: 'Uno' }),
      lyric({ es: 'Dos' }),
      lyric({ es: 'Tres' }),
    ]
    expect(nextIndex(lines, 1)).toBe(2)
  })

  it('last index → stays at last index', () => {
    const lines: SongItem[] = [
      lyric({ es: 'Uno' }),
      lyric({ es: 'Dos' }),
    ]
    expect(nextIndex(lines, 1)).toBe(1)
  })
})

describe('prevIndex', () => {
  it('empty array → stays at -1', () => {
    expect(prevIndex([], -1)).toBe(-1)
  })

  it('index -1 → stays at -1', () => {
    const lines: SongItem[] = [lyric({ es: 'Hola', en: 'Hello' })]
    expect(prevIndex(lines, -1)).toBe(-1)
  })

  it('middle index → decrements by 1', () => {
    const lines: SongItem[] = [
      lyric({ es: 'Uno' }),
      lyric({ es: 'Dos' }),
      lyric({ es: 'Tres' }),
    ]
    expect(prevIndex(lines, 1)).toBe(0)
  })

  it('index 0 → stays at 0', () => {
    const lines: SongItem[] = [
      lyric({ es: 'Uno' }),
      lyric({ es: 'Dos' }),
    ]
    expect(prevIndex(lines, 0)).toBe(0)
  })
})

describe('getCurrentItem', () => {
  it('empty array and index -1 → returns undefined', () => {
    expect(getCurrentItem([], -1)).toBeUndefined()
  })

  it('valid index pointing to a lyric line → returns that lyric line', () => {
    const line = lyric({ es: 'Hola', en: 'Hello' })
    const lines: SongItem[] = [section('Intro'), line, lyric({ es: 'Adiós', en: 'Bye' })]
    expect(getCurrentItem(lines, 1)).toBe(line)
  })

  it('valid index pointing to a section marker → returns that section marker', () => {
    const sec = section('Verse 1')
    const lines: SongItem[] = [sec, lyric({ es: 'Uno', en: 'One' })]
    expect(getCurrentItem(lines, 0)).toBe(sec)
  })

  it('out-of-range index → returns undefined', () => {
    const lines: SongItem[] = [lyric({ es: 'Uno', en: 'One' })]
    expect(getCurrentItem(lines, 1)).toBeUndefined()
    expect(getCurrentItem(lines, -2)).toBeUndefined()
    expect(getCurrentItem(lines, 5)).toBeUndefined()
  })
})

describe('getNextLyricIndex', () => {
  it('empty array and index -1 → returns -1', () => {
    expect(getNextLyricIndex([], -1)).toBe(-1)
  })

  it('index before the first lyric line → returns the index of the first lyric line', () => {
    const lines: SongItem[] = [
      section('Intro'),
      lyric({ es: 'First', en: 'First' }),
      lyric({ es: 'Second', en: 'Second' }),
    ]
    expect(getNextLyricIndex(lines, -1)).toBe(1)
    expect(getNextLyricIndex(lines, 0)).toBe(1)
  })

  it('skips section markers and returns the next lyric index', () => {
    const lines: SongItem[] = [
      lyric({ es: 'A', en: 'A' }),
      section('Bridge'),
      section('Chorus'),
      lyric({ es: 'B', en: 'B' }),
    ]
    expect(getNextLyricIndex(lines, 0)).toBe(3)
    expect(getNextLyricIndex(lines, 1)).toBe(3)
    expect(getNextLyricIndex(lines, 2)).toBe(3)
  })

  it('when already on the last lyric line → returns -1', () => {
    const lines: SongItem[] = [
      lyric({ es: 'Uno', en: 'One' }),
      lyric({ es: 'Dos', en: 'Two' }),
    ]
    expect(getNextLyricIndex(lines, 1)).toBe(-1)
  })

  it('when only section markers remain after the current index → returns -1', () => {
    const lines: SongItem[] = [
      lyric({ es: 'Last lyric', en: 'Last' }),
      section('Outro'),
      section('End'),
    ]
    expect(getNextLyricIndex(lines, 0)).toBe(-1)
    expect(getNextLyricIndex(lines, 1)).toBe(-1)
  })
})

describe('getLastLyricIndex', () => {
  it('empty array → returns -1', () => {
    expect(getLastLyricIndex([])).toBe(-1)
  })

  it('only section markers → returns -1', () => {
    const lines: SongItem[] = [section('Intro'), section('Outro')]
    expect(getLastLyricIndex(lines)).toBe(-1)
  })

  it('only lyric lines → returns last index', () => {
    const lines: SongItem[] = [
      lyric({ es: 'Uno', en: 'One' }),
      lyric({ es: 'Dos', en: 'Two' }),
    ]
    expect(getLastLyricIndex(lines)).toBe(1)
  })

  it('mixed: last item is lyric → returns that index', () => {
    const lines: SongItem[] = [
      section('Verse'),
      lyric({ es: 'A', en: 'A' }),
      lyric({ es: 'B', en: 'B' }),
      section('Outro'),
    ]
    expect(getLastLyricIndex(lines)).toBe(2)
  })

  it('mixed: last item is section → returns index of last lyric before it', () => {
    const lines: SongItem[] = [
      lyric({ es: 'First', en: 'First' }),
      lyric({ es: 'Last lyric', en: 'Last' }),
      section('Outro'),
    ]
    expect(getLastLyricIndex(lines)).toBe(1)
  })
})

describe('getAvailableLanguages', () => {
  it('ignores section markers', () => {
    const lines: SongItem[] = [
      section('Verse 1'),
      lyric({ es: 'Hola', en: 'Hello', fr: 'Bonjour' }),
    ]
    expect(getAvailableLanguages(lines)).toEqual(['en', 'es', 'fr'])
  })

  it('returns unique language codes', () => {
    const lines: SongItem[] = [
      lyric({ es: 'Uno', en: 'One' }),
      lyric({ es: 'Dos', en: 'Two' }),
    ]
    expect(getAvailableLanguages(lines)).toEqual(['en', 'es'])
  })

  it('returns sorted language codes', () => {
    const lines: SongItem[] = [
      lyric({ es: 'Hola', fr: 'Bonjour', en: 'Hello', de: 'Hallo' }),
    ]
    expect(getAvailableLanguages(lines)).toEqual(['de', 'en', 'es', 'fr'])
  })
})

describe('getAvailableSingingLanguages', () => {
  it('returns empty when no lyric lines', () => {
    expect(getAvailableSingingLanguages([])).toEqual([])
    expect(getAvailableSingingLanguages([section('Verse 1')])).toEqual([])
  })

  it('returns all language codes from lyric lines when song has lyrics (multilingual model)', () => {
    const lines: SongItem[] = [
      lyric({ es: 'Hola', en: 'Hello' }),
      lyric({ es: 'Mundo', en: 'World' }),
    ]
    expect(getAvailableSingingLanguages(lines)).toEqual(['en', 'es'])
  })

  it('returns all language codes for mixed lines with sections', () => {
    const lines: SongItem[] = [
      section('Intro'),
      lyric({ es: 'Uno', en: 'One' }),
    ]
    expect(getAvailableSingingLanguages(lines)).toEqual(['en', 'es'])
  })
})

describe('getSingingLanguage / setSingingLanguage', () => {
  let storage: Record<string, string>

  beforeEach(() => {
    storage = {}
    globalThis.localStorage = {
      getItem: (k: string) => storage[k] ?? null,
      setItem: (k: string, v: string) => {
        storage[k] = v
      },
      removeItem: (k: string) => {
        delete storage[k]
      },
      clear: () => {
        for (const k of Object.keys(storage)) delete storage[k]
      },
      get length() {
        return Object.keys(storage).length
      },
      key: () => null,
    }
  })

  it('returns empty string when nothing stored', () => {
    expect(getSingingLanguage()).toBe('')
  })

  it('stores and returns singing language', () => {
    setSingingLanguage('es')
    expect(getSingingLanguage()).toBe('es')
  })

  it('overwrites previous value', () => {
    setSingingLanguage('es')
    setSingingLanguage('en')
    expect(getSingingLanguage()).toBe('en')
  })
})

describe('getEffectiveSingingLanguage', () => {
  let storage: Record<string, string>

  beforeEach(() => {
    storage = {}
    globalThis.localStorage = {
      getItem: (k: string) => storage[k] ?? null,
      setItem: (k: string, v: string) => {
        storage[k] = v
      },
      removeItem: (k: string) => {
        delete storage[k]
      },
      clear: () => {
        for (const k of Object.keys(storage)) delete storage[k]
      },
      get length() {
        return Object.keys(storage).length
      },
      key: () => null,
    }
  })

  it('when stored singing language is available in song, returns it', () => {
    setSingingLanguage('es')
    const lines: SongItem[] = [lyric({ es: 'Hola', en: 'Hello' })]
    expect(getEffectiveSingingLanguage(lines)).toBe('es')
  })

  it('when stored singing language is not available for song, returns empty string', () => {
    setSingingLanguage('de')
    const lines: SongItem[] = [lyric({ es: 'Hola', en: 'Hello' })]
    expect(getEffectiveSingingLanguage(lines)).toBe('')
  })

  it('when nothing stored, returns empty string', () => {
    const lines: SongItem[] = [lyric({ es: 'Hola', en: 'Hello' })]
    expect(getEffectiveSingingLanguage(lines)).toBe('')
  })
})

describe('getEffectiveProjectionLanguage', () => {
  let storage: Record<string, string>

  beforeEach(() => {
    storage = {}
    globalThis.localStorage = {
      getItem: (k: string) => storage[k] ?? null,
      setItem: (k: string, v: string) => {
        storage[k] = v
      },
      removeItem: (k: string) => {
        delete storage[k]
      },
      clear: () => {
        for (const k of Object.keys(storage)) delete storage[k]
      },
      get length() {
        return Object.keys(storage).length
      },
      key: () => null,
    }
  })

  it('when a stored projection language exists and is available in the song → return that language', () => {
    setProjectionLanguage('fr')
    const lines: SongItem[] = [
      lyric({ es: 'Hola', en: 'Hello', fr: 'Bonjour' }),
      lyric({ es: 'Adiós', en: 'Goodbye', fr: 'Au revoir' }),
    ]
    expect(getEffectiveProjectionLanguage(lines)).toBe('fr')
  })

  it('when stored language exists but is NOT available in the song → return empty string', () => {
    setProjectionLanguage('de')
    const lines: SongItem[] = [
      lyric({ es: 'Hola', en: 'Hello', fr: 'Bonjour' }),
    ]
    expect(getEffectiveProjectionLanguage(lines)).toBe('')
  })

  it('when no stored language exists and "en" is available → return "en"', () => {
    const lines: SongItem[] = [
      lyric({ es: 'Hola', en: 'Hello' }),
    ]
    expect(getEffectiveProjectionLanguage(lines)).toBe('en')
  })

  it('when no stored language exists and "en" is not available → return empty string', () => {
    const lines: SongItem[] = [
      lyric({ es: 'Hola', fr: 'Bonjour' }),
    ]
    expect(getEffectiveProjectionLanguage(lines)).toBe('')
  })
})

describe('resetLoadedSongState', () => {
  let storage: Record<string, string>

  beforeEach(() => {
    storage = {}
    globalThis.localStorage = {
      getItem: (k: string) => storage[k] ?? null,
      setItem: (k: string, v: string) => {
        storage[k] = v
      },
      removeItem: (k: string) => {
        delete storage[k]
      },
      clear: () => {
        for (const k of Object.keys(storage)) delete storage[k]
      },
      get length() {
        return Object.keys(storage).length
      },
      key: () => null,
    }
  })

  it('clears song id, title, lines, index, and blank state', () => {
    setCurrentSongId('duelo')
    setCurrentSongTitle('Duelo')
    setSongLines([lyric({ es: 'Hola', en: 'Hello' })])
    setSongIndex(0)

    resetLoadedSongState()

    expect(getCurrentSongId()).toBe('')
    expect(getSongLines()).toEqual([])
    expect(getSongIndex()).toBe(-1)
    expect(getBlank()).toBe(true)
  })

  it('does not clear stored projection or singing language preferences', () => {
    setProjectionLanguage('en')
    setSingingLanguage('es')
    setCurrentSongId('duelo')
    setSongLines([lyric({ es: 'Hola', en: 'Hello' })])

    resetLoadedSongState()

    expect(getProjectionLanguage()).toBe('en')
    expect(getSingingLanguage()).toBe('es')
  })
})

describe('parseSongFile', () => {
  it('parses valid object with title and lyrics array', () => {
    const json = '{"title":"Paso","lyrics":[{"es":"Como cualquier atardecer,","en":"Like any sunset,"}]}'
    const result = parseSongFile(json)
    expect(result.title).toBe('Paso')
    expect(result.items).toHaveLength(1)
    expect(result.items[0]).toEqual({
      languages: { es: 'Como cualquier atardecer,', en: 'Like any sunset,' },
    })
  })

  it('invalid JSON string throws an error', () => {
    expect(() => parseSongFile('not json')).toThrow()
    expect(() => parseSongFile('{')).toThrow()
  })

  it('JSON that is not an object throws an error', () => {
    expect(() => parseSongFile('[]')).toThrow(/must be an object with "title" and "lyrics"/)
    expect(() => parseSongFile('"hello"')).toThrow(/must be an object with "title" and "lyrics"/)
  })

  it('object missing "title" throws an error', () => {
    const json = '{"lyrics":[{"es":"Hola","en":"Hello"}]}'
    expect(() => parseSongFile(json)).toThrow(/missing "title"/)
  })

  it('object missing "lyrics" throws an error', () => {
    const json = '{"title":"Song"}'
    expect(() => parseSongFile(json)).toThrow(/missing "lyrics"/)
  })

  it('lyric line must have at least one language string', () => {
    const json = '{"title":"S","lyrics":[{}]}'
    expect(() => parseSongFile(json)).toThrow(/at least one language/)
  })

  // P4: the CP song format carries sung lines only. Section markers are rejected at the
  // file-load boundary (parseSongFile / parseSongRecordFromUnknown). The SectionMarker type,
  // isSection, and section *rendering* elsewhere in the app are untouched — only import rejects.
  it('section marker in lyrics array is rejected, naming the index', () => {
    const json = '{"title":"S","lyrics":[{"type":"section","label":"Verse 1"}]}'
    expect(() => parseSongFile(json)).toThrow(
      /Item 0: section markers are no longer supported — lyrics must contain sung lines only\./
    )
  })

  it('a malformed section-shaped entry is rejected the same way, not for its missing label', () => {
    expect(() => parseSongFile('{"title":"S","lyrics":[{"type":"section"}]}')).toThrow(
      /section markers are no longer supported/
    )
    expect(() => parseSongFile('{"title":"S","lyrics":[{"type":"section","label":null}]}')).toThrow(
      /section markers are no longer supported/
    )
  })

  it('a section marker anywhere in a mixed lyrics array is rejected, naming its index', () => {
    const json = JSON.stringify({
      title: 'Test',
      lyrics: [
        { es: 'Uno', en: 'One' },
        { es: 'Dos', en: 'Two' },
        { type: 'section', label: 'Chorus' },
        { es: 'Tres', en: 'Three' },
      ],
    })
    expect(() => parseSongFile(json)).toThrow(/Item 2: section markers are no longer supported/)
  })

  it('optional "notes" string is parsed and trimmed', () => {
    const json = JSON.stringify({
      title: 'S',
      notes: '  Capo 2; mood: soft  ',
      lyrics: [{ es: 'Hola', en: 'Hello' }],
    })
    const result = parseSongFile(json)
    expect(result.notes).toBe('Capo 2; mood: soft')
    expect(result.title).toBe('S')
    expect(result.items).toHaveLength(1)
  })

  it('when "notes" is omitted, result has no meaningful notes (backward compatible)', () => {
    const json = '{"title":"Paso","lyrics":[{"es":"A","en":"B"}]}'
    const result = parseSongFile(json)
    expect(result.notes).toBeUndefined()
  })

  it('when "notes" is only whitespace, it is treated as absent', () => {
    const json = JSON.stringify({
      title: 'S',
      notes: '   \n\t  ',
      lyrics: [{ es: 'A', en: 'B' }],
    })
    const result = parseSongFile(json)
    expect(result.notes).toBeUndefined()
  })

  it('when "notes" is present but not a string, throws an error', () => {
    const json = JSON.stringify({
      title: 'S',
      notes: 42,
      lyrics: [{ es: 'A', en: 'B' }],
    })
    expect(() => parseSongFile(json)).toThrow(/"notes" must be a string/)
  })

  it('when "intro_cues" is present, it is silently dropped and import succeeds', () => {
    const json = JSON.stringify({
      title: 'S',
      intro_cues: 'The leap of faith',
      lyrics: [{ es: 'A', en: 'B' }],
    })
    const result = parseSongFile(json)
    expect(result.title).toBe('S')
    expect(result).not.toHaveProperty('intro_cues')
    expect(result.intro).toBeUndefined()
  })

  it('optional "intro" object is parsed and whitespace-only values are dropped', () => {
    const json = JSON.stringify({
      title: 'S',
      intro: { es: 'Pelea con tu destino.', en: '  ', nl: 'Vecht tegen je lot.' },
      lyrics: [{ es: 'A', en: 'B' }],
    })
    const result = parseSongFile(json)
    expect(result.intro).toEqual({ es: 'Pelea con tu destino.', nl: 'Vecht tegen je lot.' })
  })

  it('when "intro" is absent, result has no intro property', () => {
    const json = '{"title":"S","lyrics":[{"es":"A","en":"B"}]}'
    const result = parseSongFile(json)
    expect(result.intro).toBeUndefined()
  })

  it('when "intro" is an empty object, result has no intro property', () => {
    const json = JSON.stringify({
      title: 'S',
      intro: {},
      lyrics: [{ es: 'A', en: 'B' }],
    })
    const result = parseSongFile(json)
    expect(result.intro).toBeUndefined()
  })

  it('when all "intro" values are whitespace-only, result has no intro property', () => {
    const json = JSON.stringify({
      title: 'S',
      intro: { es: '  ', en: '\t' },
      lyrics: [{ es: 'A', en: 'B' }],
    })
    const result = parseSongFile(json)
    expect(result.intro).toBeUndefined()
  })

  it('when "intro" is a plain string, it is silently dropped and import succeeds', () => {
    const json = JSON.stringify({
      title: 'S',
      intro: 'a plain string',
      lyrics: [{ es: 'A', en: 'B' }],
    })
    const result = parseSongFile(json)
    expect(result.title).toBe('S')
    expect(result.intro).toBeUndefined()
  })

  it('when an "intro" value is not a string, throws an error', () => {
    const json = JSON.stringify({
      title: 'S',
      intro: { es: 42 },
      lyrics: [{ es: 'A', en: 'B' }],
    })
    expect(() => parseSongFile(json)).toThrow(/"intro" values must be strings/)
  })

  it('optional "title_translations" object is parsed and whitespace-only values are dropped', () => {
    const json = JSON.stringify({
      title: 'S',
      title_translations: { en: 'English Title', fr: '  ', nl: 'Dutch Title' },
      lyrics: [{ es: 'A', en: 'B' }],
    })
    const result = parseSongFile(json)
    expect(result.title_translations).toEqual({ en: 'English Title', nl: 'Dutch Title' })
  })

  it('when "title_translations" is absent, result has no title_translations property', () => {
    const json = '{"title":"S","lyrics":[{"es":"A","en":"B"}]}'
    const result = parseSongFile(json)
    expect(result.title_translations).toBeUndefined()
  })

  it('when "title_translations" is an empty object, result has no title_translations property', () => {
    const json = JSON.stringify({
      title: 'S',
      title_translations: {},
      lyrics: [{ es: 'A', en: 'B' }],
    })
    const result = parseSongFile(json)
    expect(result.title_translations).toBeUndefined()
  })

  it('when all "title_translations" values are whitespace-only, result has no title_translations property', () => {
    const json = JSON.stringify({
      title: 'S',
      title_translations: { en: '  ', fr: '\t' },
      lyrics: [{ es: 'A', en: 'B' }],
    })
    const result = parseSongFile(json)
    expect(result.title_translations).toBeUndefined()
  })

  it('when "title_translations" is not an object, throws an error', () => {
    const json = JSON.stringify({
      title: 'S',
      title_translations: 'not an object',
      lyrics: [{ es: 'A', en: 'B' }],
    })
    expect(() => parseSongFile(json)).toThrow(/"title_translations" must be an object/)
  })

  it('when a "title_translations" value is not a string, throws an error', () => {
    const json = JSON.stringify({
      title: 'S',
      title_translations: { en: 42 },
      lyrics: [{ es: 'A', en: 'B' }],
    })
    expect(() => parseSongFile(json)).toThrow(/"title_translations" values must be strings/)
  })
})

describe('parseSongRecordFromUnknown', () => {
  it('matches parseSongFile for an object (extra keys like id are ignored for song fields)', () => {
    const obj = {
      id: 'extra',
      title: 'T',
      lyrics: [{ es: 'a', en: 'b' }],
    }
    expect(parseSongRecordFromUnknown(obj)).toEqual(parseSongFile(JSON.stringify(obj)))
  })
})

describe('parseSongFile — timeline field', () => {
  it('when timeline is absent, result has no timeline property (backward compat)', () => {
    const json = '{"title":"S","lyrics":[{"es":"A","en":"B"}]}'
    const result = parseSongFile(json)
    expect(result.timeline).toBeUndefined()
    expect(result.timelineVersion).toBeUndefined()
    expect(result.leadIn).toBeUndefined()
  })

  it('valid v2 timeline with correct length and monotonic non-negative times is parsed, carrying timelineVersion and leadIn', () => {
    const json = JSON.stringify({
      title: 'S',
      lyrics: [{ es: 'A', en: 'B' }, { es: 'C', en: 'D' }],
      timelineVersion: 2,
      leadIn: { durationSec: 1.5, source: 'measured', confidence: 'low', apply: true },
      timeline: [{ start: 0, end: 2.5 }, { start: 3, end: 5 }],
    })
    const result = parseSongFile(json)
    expect(result.timeline).toEqual([{ start: 0, end: 2.5 }, { start: 3, end: 5 }])
    expect(result.timelineVersion).toBe(2)
    expect(result.leadIn).toEqual({ durationSec: 1.5, source: 'measured', confidence: 'low', apply: true })
  })

  it('the golden Libertad fixture (20 lines, 20-entry timeline) round-trips exactly', () => {
    const result = parseSongFile(JSON.stringify(GOLDEN_SONG_JSON_V2))
    expect(result.items).toHaveLength(GOLDEN_LYRICS_20.length)
    expect(result.timeline).toEqual(GOLDEN_TIMELINE_ENTRIES)
    expect(result.timelineVersion).toBe(2)
    expect(result.leadIn).toEqual(GOLDEN_LEAD_IN)
  })

  describe('timelineVersion guard', () => {
    it('missing timelineVersion on a file that has a timeline is rejected', () => {
      expect(() => parseSongFile(JSON.stringify(V1_SHAPED_SONG_JSON))).toThrow(
        /This timeline was made by an older Bombista — re-run the extractor\./
      )
    })

    it('a timelineVersion other than 2 is rejected and names the offending value', () => {
      const json = JSON.stringify({
        title: 'S',
        lyrics: [{ es: 'A', en: 'B' }],
        timelineVersion: 1,
        leadIn: { durationSec: 0, source: 'none', confidence: 'low', apply: false },
        timeline: [{ start: 0, end: 1 }],
      })
      expect(() => parseSongFile(json)).toThrow(/found timelineVersion 1/)
    })

    it('never coerces a non-2 timelineVersion into acceptance', () => {
      const json = JSON.stringify({
        title: 'S',
        lyrics: [{ es: 'A', en: 'B' }],
        timelineVersion: '2', // string, not number — must not be coerced
        leadIn: { durationSec: 0, source: 'none', confidence: 'low', apply: false },
        timeline: [{ start: 0, end: 1 }],
      })
      expect(() => parseSongFile(json)).toThrow(/older Bombista/)
    })
  })

  describe('leadIn validation (required when timelineVersion: 2 is present)', () => {
    it('missing leadIn throws', () => {
      const json = JSON.stringify({
        title: 'S',
        lyrics: [{ es: 'A', en: 'B' }],
        timelineVersion: 2,
        timeline: [{ start: 0, end: 1 }],
      })
      expect(() => parseSongFile(json)).toThrow(/leadIn/)
    })

    it('negative leadIn.durationSec throws', () => {
      const json = JSON.stringify({
        title: 'S',
        lyrics: [{ es: 'A', en: 'B' }],
        timelineVersion: 2,
        leadIn: { durationSec: -1, source: 'measured', confidence: 'low', apply: false },
        timeline: [{ start: 0, end: 1 }],
      })
      expect(() => parseSongFile(json)).toThrow(/leadIn\.durationSec/)
    })

    it('invalid leadIn.source throws', () => {
      const json = JSON.stringify({
        title: 'S',
        lyrics: [{ es: 'A', en: 'B' }],
        timelineVersion: 2,
        leadIn: { durationSec: 0, source: 'guessed', confidence: 'low', apply: false },
        timeline: [{ start: 0, end: 1 }],
      })
      expect(() => parseSongFile(json)).toThrow(/leadIn\.source/)
    })

    it('invalid leadIn.confidence throws', () => {
      const json = JSON.stringify({
        title: 'S',
        lyrics: [{ es: 'A', en: 'B' }],
        timelineVersion: 2,
        leadIn: { durationSec: 0, source: 'measured', confidence: 'medium', apply: false },
        timeline: [{ start: 0, end: 1 }],
      })
      expect(() => parseSongFile(json)).toThrow(/leadIn\.confidence/)
    })

    it('non-boolean leadIn.apply throws', () => {
      const json = JSON.stringify({
        title: 'S',
        lyrics: [{ es: 'A', en: 'B' }],
        timelineVersion: 2,
        leadIn: { durationSec: 0, source: 'measured', confidence: 'low', apply: 'yes' },
        timeline: [{ start: 0, end: 1 }],
      })
      expect(() => parseSongFile(json)).toThrow(/leadIn\.apply/)
    })
  })

  it('timeline length mismatch throws an error', () => {
    const json = JSON.stringify({
      title: 'S',
      lyrics: [{ es: 'A', en: 'B' }, { es: 'C', en: 'D' }],
      timelineVersion: 2,
      leadIn: GOLDEN_LEAD_IN,
      timeline: [{ start: 0, end: 2 }],
    })
    expect(() => parseSongFile(json)).toThrow(/timeline length must match/)
  })

  it('non-monotonic times throw an error (start < previous end)', () => {
    const json = JSON.stringify({
      title: 'S',
      lyrics: [{ es: 'A', en: 'B' }, { es: 'C', en: 'D' }],
      timelineVersion: 2,
      leadIn: GOLDEN_LEAD_IN,
      timeline: [{ start: 0, end: 5 }, { start: 3, end: 7 }],
    })
    expect(() => parseSongFile(json)).toThrow(/monotonic/)
  })

  it('negative start time throws an error', () => {
    const json = JSON.stringify({
      title: 'S',
      lyrics: [{ es: 'A', en: 'B' }],
      timelineVersion: 2,
      leadIn: GOLDEN_LEAD_IN,
      timeline: [{ start: -1, end: 2 }],
    })
    expect(() => parseSongFile(json)).toThrow(/non-negative/)
  })

  it('negative end time throws an error', () => {
    const json = JSON.stringify({
      title: 'S',
      lyrics: [{ es: 'A', en: 'B' }],
      timelineVersion: 2,
      leadIn: GOLDEN_LEAD_IN,
      timeline: [{ start: 0, end: -1 }],
    })
    expect(() => parseSongFile(json)).toThrow(/non-negative/)
  })

  it('timeline entry missing numeric start or end throws an error', () => {
    const json = JSON.stringify({
      title: 'S',
      lyrics: [{ es: 'A', en: 'B' }],
      timelineVersion: 2,
      leadIn: GOLDEN_LEAD_IN,
      timeline: [{ start: 0 }],
    })
    expect(() => parseSongFile(json)).toThrow()
  })

  it('a song file with a section marker is rejected before the timeline is even considered (P4)', () => {
    expect(() => parseSongFile(JSON.stringify(SONG_JSON_WITH_SECTION_MARKER))).toThrow(
      /section markers are no longer supported/
    )
  })

  describe('incomplete v2 envelope (declares version 2, no usable timeline) — rejected', () => {
    // Updated 2026-08-13: this used to be a silent no-op (see contract amendment). A file
    // declaring timelineVersion: 2 with no usable timeline is now a hard rejection — it reads
    // as truncated/half-written, not "this song has no timings".
    const INCOMPLETE_MESSAGE =
      'This timeline file is incomplete — it declares version 2 but contains no timeline.'

    it('timeline key entirely absent, with a valid leadIn, is rejected', () => {
      const json = JSON.stringify({
        title: 'S',
        lyrics: [{ es: 'A', en: 'B' }],
        timelineVersion: 2,
        leadIn: GOLDEN_LEAD_IN,
      })
      expect(() => parseSongFile(json)).toThrow(INCOMPLETE_MESSAGE)
    })

    it('timeline is null is rejected', () => {
      const json = JSON.stringify({
        title: 'S',
        lyrics: [{ es: 'A', en: 'B' }],
        timelineVersion: 2,
        leadIn: GOLDEN_LEAD_IN,
        timeline: null,
      })
      expect(() => parseSongFile(json)).toThrow(INCOMPLETE_MESSAGE)
    })

    it('timeline that is not an array is rejected (previously "must be an array" — now the incomplete message)', () => {
      const json = JSON.stringify({
        title: 'S',
        lyrics: [{ es: 'A', en: 'B' }],
        timelineVersion: 2,
        leadIn: GOLDEN_LEAD_IN,
        timeline: 'not-an-array',
      })
      expect(() => parseSongFile(json)).toThrow(INCOMPLETE_MESSAGE)
    })

    it('empty timeline array is rejected, even for a song with no lyrics (previously accepted as valid — now rejected)', () => {
      const json = JSON.stringify({
        title: 'S',
        lyrics: [],
        timelineVersion: 2,
        leadIn: GOLDEN_LEAD_IN,
        timeline: [],
      })
      expect(() => parseSongFile(json)).toThrow(INCOMPLETE_MESSAGE)
    })
  })

  describe('timelineVersion check order (2026-08-13 amendment)', () => {
    it('timelineVersion: 1 and no timeline gets the older-Bombista message, not the incomplete message', () => {
      const json = JSON.stringify({
        title: 'S',
        lyrics: [{ es: 'A', en: 'B' }],
        timelineVersion: 1,
      })
      expect(() => parseSongFile(json)).toThrow(
        /This timeline was made by an older Bombista — re-run the extractor\./
      )
    })
  })

  describe('un-timed song (no timeline key, no timelineVersion key) — must keep loading untouched', () => {
    // The 11-song regression case: most of the catalogue has no timeline at all. Locked in with
    // an explicit test per docs/timeline-v2-contract.md.
    it('loads normally with no timeline/timelineVersion/leadIn set', () => {
      const json = JSON.stringify({
        title: 'S',
        lyrics: [{ es: 'A', en: 'B' }],
      })
      const result = parseSongFile(json)
      expect(result.timeline).toBeUndefined()
      expect(result.timelineVersion).toBeUndefined()
      expect(result.leadIn).toBeUndefined()
    })
  })

  describe('unknown top-level keys are ignored, not rejected (forward-compatibility guarantee)', () => {
    it('a valid v2 envelope with an extra unknown top-level key parses successfully, ignoring the key', () => {
      const json = JSON.stringify({
        ...GOLDEN_SONG_JSON_V2,
        provenance: { model: 'faster-whisper', extractedAt: '2026-08-11T00:00:00Z' },
        linesHash: 'sha256:abc',
      })
      const result = parseSongFile(json)
      expect(result.timeline).toEqual(GOLDEN_TIMELINE_ENTRIES)
      expect(result.timelineVersion).toBe(2)
      expect(result.leadIn).toEqual(GOLDEN_LEAD_IN)
    })
  })
})

describe('parseSongFile — media field', () => {
  it('when media is absent, result has no media property (backward compat)', () => {
    const json = '{"title":"S","lyrics":[{"es":"A","en":"B"}]}'
    const result = parseSongFile(json)
    expect(result.media).toBeUndefined()
  })

  describe('flat format (parses as single MediaFile)', () => {
    it('flat video media parses as a single MediaFile', () => {
      const json = JSON.stringify({
        title: 'S',
        lyrics: [{ es: 'A', en: 'B' }],
        media: { type: 'video', src: 'song.mp4' },
      })
      const result = parseSongFile(json)
      expect(result.media).toEqual({ type: 'video', src: 'song.mp4' })
    })

    it('flat audio media with offset parses as a single MediaFile', () => {
      const json = JSON.stringify({
        title: 'S',
        lyrics: [{ es: 'A', en: 'B' }],
        media: { type: 'audio', src: 'song.mp3', offset: 2.5 },
      })
      const result = parseSongFile(json)
      expect(result.media).toEqual({ type: 'audio', src: 'song.mp3', offset: 2.5 })
    })

    it('zero offset is valid (flat)', () => {
      const json = JSON.stringify({
        title: 'S',
        lyrics: [{ es: 'A', en: 'B' }],
        media: { type: 'audio', src: 'song.mp3', offset: 0 },
      })
      const result = parseSongFile(json)
      expect(result.media).toEqual({ type: 'audio', src: 'song.mp3', offset: 0 })
    })

    it('invalid media type (flat) throws an error', () => {
      const json = JSON.stringify({
        title: 'S',
        lyrics: [{ es: 'A', en: 'B' }],
        media: { type: 'image', src: 'song.png' },
      })
      expect(() => parseSongFile(json)).toThrow(/type must be "video" or "audio"/)
    })

    it('empty src (flat) throws an error', () => {
      const json = JSON.stringify({
        title: 'S',
        lyrics: [{ es: 'A', en: 'B' }],
        media: { type: 'video', src: '' },
      })
      expect(() => parseSongFile(json)).toThrow(/src must be a non-empty string/)
    })

    it('whitespace-only src (flat) throws an error', () => {
      const json = JSON.stringify({
        title: 'S',
        lyrics: [{ es: 'A', en: 'B' }],
        media: { type: 'audio', src: '   ' },
      })
      expect(() => parseSongFile(json)).toThrow(/src must be a non-empty string/)
    })

    it('negative offset (flat) throws an error', () => {
      const json = JSON.stringify({
        title: 'S',
        lyrics: [{ es: 'A', en: 'B' }],
        media: { type: 'audio', src: 'song.mp3', offset: -1 },
      })
      expect(() => parseSongFile(json)).toThrow(/offset must be a non-negative number/)
    })
  })

  describe('legacy SongMedia format ({ big?, small? }) — collapses to single MediaFile', () => {
    it('{ small } collapses to that MediaFile', () => {
      const json = JSON.stringify({
        title: 'S',
        lyrics: [{ es: 'A', en: 'B' }],
        media: { small: { type: 'video', src: 'small.mp4' } },
      })
      const result = parseSongFile(json)
      expect(result.media).toEqual({ type: 'video', src: 'small.mp4' })
    })

    it('{ big } collapses to that MediaFile', () => {
      const json = JSON.stringify({
        title: 'S',
        lyrics: [{ es: 'A', en: 'B' }],
        media: { big: { type: 'video', src: 'big.mp4' } },
      })
      const result = parseSongFile(json)
      expect(result.media).toEqual({ type: 'video', src: 'big.mp4' })
    })

    it('{ big, small } collapses to big (preferred)', () => {
      const json = JSON.stringify({
        title: 'S',
        lyrics: [{ es: 'A', en: 'B' }],
        media: {
          big: { type: 'video', src: 'big.mp4', trimStart: 2 },
          small: { type: 'video', src: 'small.mp4', offset: 0.1 },
        },
      })
      const result = parseSongFile(json)
      expect(result.media).toEqual({ type: 'video', src: 'big.mp4', trimStart: 2 })
    })

    it('SongMedia with no slots throws', () => {
      const json = JSON.stringify({
        title: 'S',
        lyrics: [{ es: 'A', en: 'B' }],
        media: {},
      })
      expect(() => parseSongFile(json)).toThrow(/"media" must have at least one/)
    })

    it('SongMedia with invalid small slot type throws', () => {
      const json = JSON.stringify({
        title: 'S',
        lyrics: [{ es: 'A', en: 'B' }],
        media: { small: { type: 'image', src: 'file.png' } },
      })
      expect(() => parseSongFile(json)).toThrow(/type must be "video" or "audio"/)
    })

    it('SongMedia with null big slot throws', () => {
      const json = JSON.stringify({
        title: 'S',
        lyrics: [{ es: 'A', en: 'B' }],
        media: { big: null, small: { type: 'video', src: 'small.mp4' } },
      })
      expect(() => parseSongFile(json)).toThrow(/"media.big" must be an object/)
    })
  })

  it('media not an object throws an error', () => {
    const json = JSON.stringify({
      title: 'S',
      lyrics: [{ es: 'A', en: 'B' }],
      media: 'not-an-object',
    })
    expect(() => parseSongFile(json)).toThrow(/"media" must be an object/)
  })

  it('media that is null throws an error', () => {
    const json = JSON.stringify({
      title: 'S',
      lyrics: [{ es: 'A', en: 'B' }],
      media: null,
    })
    expect(() => parseSongFile(json)).toThrow(/"media" must be an object/)
  })
})

describe('tryParseSongItemsArray', () => {
  it('returns parsed items for a valid lyrics-shaped array (sung lines only)', () => {
    const items = [{ es: 'A', en: 'B' }, { es: 'C', en: 'D' }]
    expect(tryParseSongItemsArray(items)).toEqual([
      { languages: { es: 'A', en: 'B' } },
      { languages: { es: 'C', en: 'D' } },
    ])
  })

  it('returns null when not an array', () => {
    expect(tryParseSongItemsArray({})).toBeNull()
    expect(tryParseSongItemsArray('x')).toBeNull()
  })

  it('returns null when an element is invalid', () => {
    expect(tryParseSongItemsArray([{ es: 1 }])).toBeNull()
  })

  it('returns null when an element is a section marker (P4: sung lines only)', () => {
    expect(tryParseSongItemsArray([{ es: 'A', en: 'B' }, { type: 'section', label: 'X' }])).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// v6 media schema: ParsedSongFile.media is a single MediaFile, not SongMedia.
// These tests fail until validateMedia returns MediaFile and ParsedSongFile.media
// is typed as MediaFile.
// ---------------------------------------------------------------------------
describe('parseSongFile — media field (v6: single MediaFile)', () => {
  it('flat video media parses as a single MediaFile (no slot wrapping)', () => {
    const json = JSON.stringify({
      title: 'S',
      lyrics: [{ es: 'A', en: 'B' }],
      media: { type: 'video', src: 'song.mp4' },
    })
    const result = parseSongFile(json)
    expect(result.media).toEqual({ type: 'video', src: 'song.mp4' })
  })

  it('flat audio media with offset parses as a single MediaFile', () => {
    const json = JSON.stringify({
      title: 'S',
      lyrics: [{ es: 'A', en: 'B' }],
      media: { type: 'audio', src: 'song.mp3', offset: 2.5 },
    })
    const result = parseSongFile(json)
    expect(result.media).toEqual({ type: 'audio', src: 'song.mp3', offset: 2.5 })
  })

  it('{ big } collapses to that MediaFile', () => {
    const json = JSON.stringify({
      title: 'S',
      lyrics: [{ es: 'A', en: 'B' }],
      media: { big: { type: 'video', src: 'big.mp4' } },
    })
    const result = parseSongFile(json)
    expect(result.media).toEqual({ type: 'video', src: 'big.mp4' })
  })

  it('{ small } collapses to that MediaFile', () => {
    const json = JSON.stringify({
      title: 'S',
      lyrics: [{ es: 'A', en: 'B' }],
      media: { small: { type: 'video', src: 'small.mp4' } },
    })
    const result = parseSongFile(json)
    expect(result.media).toEqual({ type: 'video', src: 'small.mp4' })
  })

  it('{ big, small } collapses to big (big is preferred)', () => {
    const json = JSON.stringify({
      title: 'S',
      lyrics: [{ es: 'A', en: 'B' }],
      media: {
        big: { type: 'video', src: 'big.mp4', trimStart: 2 },
        small: { type: 'video', src: 'small.mp4', offset: 0.1 },
      },
    })
    const result = parseSongFile(json)
    expect(result.media).toEqual({ type: 'video', src: 'big.mp4', trimStart: 2 })
  })

  it('media: {} still throws (empty object is rejected)', () => {
    const json = JSON.stringify({
      title: 'S',
      lyrics: [{ es: 'A', en: 'B' }],
      media: {},
    })
    expect(() => parseSongFile(json)).toThrow()
  })
})
