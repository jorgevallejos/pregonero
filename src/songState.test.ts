/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach } from 'vitest'
import type { LyricLine, SectionMarker, SongItem } from './songState'
import {
  getAvailableLanguages,
  getCurrentItem,
  getEffectiveProjectionLanguage,
  getNextLyricIndex,
  nextIndex,
  parseSongJson,
  prevIndex,
  setProjectionLanguage,
} from './songState'

const lyric = (es: string, translations: Record<string, string>): LyricLine =>
  ({ es, translations })
const section = (label: string): SectionMarker => ({ type: 'section', label })

describe('nextIndex', () => {
  it('empty array → stays at -1', () => {
    expect(nextIndex([], -1)).toBe(-1)
  })

  it('index -1 with non-empty array → goes to 0', () => {
    const lines: SongItem[] = [lyric('Hola', { en: 'Hello' })]
    expect(nextIndex(lines, -1)).toBe(0)
  })

  it('middle index → increments by 1', () => {
    const lines: SongItem[] = [
      lyric('Uno', {}),
      lyric('Dos', {}),
      lyric('Tres', {}),
    ]
    expect(nextIndex(lines, 1)).toBe(2)
  })

  it('last index → stays at last index', () => {
    const lines: SongItem[] = [
      lyric('Uno', {}),
      lyric('Dos', {}),
    ]
    expect(nextIndex(lines, 1)).toBe(1)
  })
})

describe('prevIndex', () => {
  it('empty array → stays at -1', () => {
    expect(prevIndex([], -1)).toBe(-1)
  })

  it('index -1 → stays at -1', () => {
    const lines: SongItem[] = [lyric('Hola', { en: 'Hello' })]
    expect(prevIndex(lines, -1)).toBe(-1)
  })

  it('middle index → decrements by 1', () => {
    const lines: SongItem[] = [
      lyric('Uno', {}),
      lyric('Dos', {}),
      lyric('Tres', {}),
    ]
    expect(prevIndex(lines, 1)).toBe(0)
  })

  it('index 0 → stays at 0', () => {
    const lines: SongItem[] = [
      lyric('Uno', {}),
      lyric('Dos', {}),
    ]
    expect(prevIndex(lines, 0)).toBe(0)
  })
})

describe('getCurrentItem', () => {
  it('empty array and index -1 → returns undefined', () => {
    expect(getCurrentItem([], -1)).toBeUndefined()
  })

  it('valid index pointing to a lyric line → returns that lyric line', () => {
    const line = lyric('Hola', { en: 'Hello' })
    const lines: SongItem[] = [section('Intro'), line, lyric('Adiós', { en: 'Bye' })]
    expect(getCurrentItem(lines, 1)).toBe(line)
  })

  it('valid index pointing to a section marker → returns that section marker', () => {
    const sec = section('Verse 1')
    const lines: SongItem[] = [sec, lyric('Uno', { en: 'One' })]
    expect(getCurrentItem(lines, 0)).toBe(sec)
  })

  it('out-of-range index → returns undefined', () => {
    const lines: SongItem[] = [lyric('Uno', { en: 'One' })]
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
      lyric('First', { en: 'First' }),
      lyric('Second', { en: 'Second' }),
    ]
    expect(getNextLyricIndex(lines, -1)).toBe(1)
    expect(getNextLyricIndex(lines, 0)).toBe(1)
  })

  it('skips section markers and returns the next lyric index', () => {
    const lines: SongItem[] = [
      lyric('A', { en: 'A' }),
      section('Bridge'),
      section('Chorus'),
      lyric('B', { en: 'B' }),
    ]
    expect(getNextLyricIndex(lines, 0)).toBe(3)
    expect(getNextLyricIndex(lines, 1)).toBe(3)
    expect(getNextLyricIndex(lines, 2)).toBe(3)
  })

  it('when already on the last lyric line → returns -1', () => {
    const lines: SongItem[] = [
      lyric('Uno', { en: 'One' }),
      lyric('Dos', { en: 'Two' }),
    ]
    expect(getNextLyricIndex(lines, 1)).toBe(-1)
  })

  it('when only section markers remain after the current index → returns -1', () => {
    const lines: SongItem[] = [
      lyric('Last lyric', { en: 'Last' }),
      section('Outro'),
      section('End'),
    ]
    expect(getNextLyricIndex(lines, 0)).toBe(-1)
    expect(getNextLyricIndex(lines, 1)).toBe(-1)
  })
})

describe('getAvailableLanguages', () => {
  it('ignores section markers', () => {
    const lines: SongItem[] = [
      section('Verse 1'),
      lyric('Hola', { en: 'Hello', fr: 'Bonjour' }),
    ]
    expect(getAvailableLanguages(lines)).toEqual(['en', 'fr'])
  })

  it('returns unique language codes', () => {
    const lines: SongItem[] = [
      lyric('Uno', { en: 'One', es: 'Uno' }),
      lyric('Dos', { en: 'Two', es: 'Dos' }),
    ]
    expect(getAvailableLanguages(lines)).toEqual(['en', 'es'])
  })

  it('returns sorted language codes', () => {
    const lines: SongItem[] = [
      lyric('Hola', { fr: 'Bonjour', en: 'Hello', de: 'Hallo' }),
    ]
    expect(getAvailableLanguages(lines)).toEqual(['de', 'en', 'fr'])
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
      lyric('Hola', { en: 'Hello', fr: 'Bonjour' }),
      lyric('Adiós', { en: 'Goodbye', fr: 'Au revoir' }),
    ]
    expect(getEffectiveProjectionLanguage(lines)).toBe('fr')
  })

  it('when stored language exists but is NOT available in the song → return empty string', () => {
    setProjectionLanguage('de')
    const lines: SongItem[] = [
      lyric('Hola', { en: 'Hello', fr: 'Bonjour' }),
    ]
    expect(getEffectiveProjectionLanguage(lines)).toBe('')
  })

  it('when no stored language exists and "en" is available → return "en"', () => {
    const lines: SongItem[] = [
      lyric('Hola', { en: 'Hello', es: 'Hola' }),
    ]
    expect(getEffectiveProjectionLanguage(lines)).toBe('en')
  })

  it('when no stored language exists and "en" is not available → return empty string', () => {
    const lines: SongItem[] = [
      lyric('Hola', { fr: 'Bonjour', es: 'Hola' }),
    ]
    expect(getEffectiveProjectionLanguage(lines)).toBe('')
  })
})

describe('parseSongJson', () => {
  it('valid lyric array parses correctly', () => {
    const json = '[{"es":"Hola","translations":{"en":"Hello"}}]'
    const result = parseSongJson(json)
    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({ es: 'Hola', translations: { en: 'Hello' } })
  })

  it('invalid JSON string throws an error', () => {
    expect(() => parseSongJson('not json')).toThrow()
    expect(() => parseSongJson('{')).toThrow()
  })

  it('JSON that is not an array throws an error', () => {
    expect(() => parseSongJson('{}')).toThrow('JSON must be a flat array')
    expect(() => parseSongJson('"hello"')).toThrow('JSON must be a flat array')
  })

  it('lyric line missing "es" field throws an error', () => {
    const json = '[{"translations":{"en":"Hi"}}]'
    expect(() => parseSongJson(json)).toThrow(/lyric line must have "es"/)
  })

  it('lyric line missing "translations" field throws an error', () => {
    const json = '[{"es":"Hola"}]'
    expect(() => parseSongJson(json)).toThrow(/translations/)
  })

  it('section marker with { type: "section", label: string } is accepted', () => {
    const json = '[{"type":"section","label":"Verse 1"}]'
    const result = parseSongJson(json)
    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({ type: 'section', label: 'Verse 1' })
  })

  it('malformed section marker (missing label or wrong type) throws an error', () => {
    expect(() => parseSongJson('[{"type":"section"}]')).toThrow(/section must have a string "label"/)
    expect(() => parseSongJson('[{"type":"section","label":null}]')).toThrow(/section must have a string "label"/)
    expect(() => parseSongJson('[{"type":"other","label":"X"}]')).toThrow(/lyric line must have "es"/)
  })

  it('mixed lyric lines and section markers parse correctly', () => {
    const json = [
      { type: 'section', label: 'Intro' },
      { es: 'Uno', translations: { en: 'One' } },
      { es: 'Dos', translations: { en: 'Two' } },
      { type: 'section', label: 'Chorus' },
      { es: 'Tres', translations: { en: 'Three' } },
    ]
    const result = parseSongJson(JSON.stringify(json))
    expect(result).toHaveLength(5)
    expect(result[0]).toEqual({ type: 'section', label: 'Intro' })
    expect(result[1]).toEqual({ es: 'Uno', translations: { en: 'One' } })
    expect(result[2]).toEqual({ es: 'Dos', translations: { en: 'Two' } })
    expect(result[3]).toEqual({ type: 'section', label: 'Chorus' })
    expect(result[4]).toEqual({ es: 'Tres', translations: { en: 'Three' } })
  })
})
