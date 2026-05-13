/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach } from 'vitest'
import type { LyricLine, SectionMarker, SongItem } from './songState'
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
  tryParsePersistedSongItemsArray,
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

  it('section marker in lyrics array is accepted', () => {
    const json = '{"title":"S","lyrics":[{"type":"section","label":"Verse 1"}]}'
    const result = parseSongFile(json)
    expect(result.items).toHaveLength(1)
    expect(result.items[0]).toEqual({ type: 'section', label: 'Verse 1' })
  })

  it('malformed section marker (missing label or wrong type) throws an error', () => {
    expect(() => parseSongFile('{"title":"S","lyrics":[{"type":"section"}]}')).toThrow(/section must have a string "label"/)
    expect(() => parseSongFile('{"title":"S","lyrics":[{"type":"section","label":null}]}')).toThrow(/section must have a string "label"/)
  })

  it('mixed lyric lines and section markers parse correctly', () => {
    const json = JSON.stringify({
      title: 'Test',
      lyrics: [
        { type: 'section', label: 'Intro' },
        { es: 'Uno', en: 'One' },
        { es: 'Dos', en: 'Two' },
        { type: 'section', label: 'Chorus' },
        { es: 'Tres', en: 'Three' },
      ],
    })
    const result = parseSongFile(json)
    expect(result.title).toBe('Test')
    expect(result.items).toHaveLength(5)
    expect(result.items[0]).toEqual({ type: 'section', label: 'Intro' })
    expect(result.items[1]).toEqual({ languages: { es: 'Uno', en: 'One' } })
    expect(result.items[2]).toEqual({ languages: { es: 'Dos', en: 'Two' } })
    expect(result.items[3]).toEqual({ type: 'section', label: 'Chorus' })
    expect(result.items[4]).toEqual({ languages: { es: 'Tres', en: 'Three' } })
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

  it('when "intro_cues" is present, throws a migration error', () => {
    const json = JSON.stringify({
      title: 'S',
      intro_cues: 'The leap of faith',
      lyrics: [{ es: 'A', en: 'B' }],
    })
    expect(() => parseSongFile(json)).toThrow(/intro_cues.*no longer supported.*intro/)
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

  it('when "intro" is not an object, throws an error', () => {
    const json = JSON.stringify({
      title: 'S',
      intro: 'a plain string',
      lyrics: [{ es: 'A', en: 'B' }],
    })
    expect(() => parseSongFile(json)).toThrow(/"intro" must be an object/)
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

describe('tryParsePersistedSongItemsArray', () => {
  it('accepts canonical persisted lyric lines with nested languages', () => {
    const items = [{ languages: { es: 'A', en: 'B' } }]
    expect(tryParsePersistedSongItemsArray(items)).toEqual([
      { languages: { es: 'A', en: 'B' } },
    ])
  })

  it('still accepts flat file-style lyric objects', () => {
    const items = [{ es: 'A', en: 'B' }]
    expect(tryParsePersistedSongItemsArray(items)).toEqual([
      { languages: { es: 'A', en: 'B' } },
    ])
  })
})

describe('tryParseSongItemsArray', () => {
  it('returns parsed items for a valid lyrics-shaped array', () => {
    const items = [{ es: 'A', en: 'B' }, { type: 'section', label: 'X' }]
    expect(tryParseSongItemsArray(items)).toEqual([
      { languages: { es: 'A', en: 'B' } },
      { type: 'section', label: 'X' },
    ])
  })

  it('returns null when not an array', () => {
    expect(tryParseSongItemsArray({})).toBeNull()
    expect(tryParseSongItemsArray('x')).toBeNull()
  })

  it('returns null when an element is invalid', () => {
    expect(tryParseSongItemsArray([{ es: 1 }])).toBeNull()
  })
})
