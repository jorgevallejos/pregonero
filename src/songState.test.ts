import { describe, it, expect } from 'vitest'
import type { LyricLine, SectionMarker, SongItem } from './songState'
import {
  getAvailableLanguages,
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
