import { describe, it, expect } from 'vitest'
import type { LyricLine, SectionMarker, SongItem } from './songState'
import {
  getAvailableLanguages,
  getCurrentItem,
  getNextLyricIndex,
  nextIndex,
  prevIndex,
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
