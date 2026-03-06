import { describe, it, expect } from 'vitest'
import type { SongItem } from './songState'
import {
  getPerformanceChecks,
  getPerformanceState,
  type PerformanceChecks,
} from './performanceState'

const validLines: SongItem[] = [
  { es: 'Hola', translations: { en: 'Hello' } },
]

describe('getPerformanceChecks', () => {
  it('projectionOpen = false, valid lines, valid language → projectionOpen false, translationAvailable true, phraseListLoaded true, allPass false', () => {
    const checks = getPerformanceChecks(false, validLines, 'en')
    expect(checks.projectionOpen).toBe(false)
    expect(checks.translationAvailable).toBe(true)
    expect(checks.phraseListLoaded).toBe(true)
    expect(checks.allPass).toBe(false)
  })

  it('projectionOpen = true, empty lines, valid language → phraseListLoaded false, allPass false', () => {
    const checks = getPerformanceChecks(true, [], 'en')
    expect(checks.phraseListLoaded).toBe(false)
    expect(checks.allPass).toBe(false)
  })

  it('projectionOpen = true, valid lines, missing/invalid language → translationAvailable false, allPass false', () => {
    const checks = getPerformanceChecks(true, validLines, '')
    expect(checks.translationAvailable).toBe(false)
    expect(checks.allPass).toBe(false)
  })

  it('projectionOpen = true, valid lines, valid language → all individual checks true and allPass true', () => {
    const checks = getPerformanceChecks(true, validLines, 'en')
    expect(checks.projectionOpen).toBe(true)
    expect(checks.translationAvailable).toBe(true)
    expect(checks.phraseListLoaded).toBe(true)
    expect(checks.allPass).toBe(true)
  })
})

describe('getPerformanceState', () => {
  const allPassChecks: PerformanceChecks = {
    projectionOpen: true,
    translationAvailable: true,
    phraseListLoaded: true,
    allPass: true,
  }

  const notAllPassChecks: PerformanceChecks = {
    projectionOpen: true,
    translationAvailable: false,
    phraseListLoaded: true,
    allPass: false,
  }

  it('if index >= 0 → state is "performing"', () => {
    expect(getPerformanceState(allPassChecks, 0, false)).toBe('performing')
    expect(getPerformanceState(allPassChecks, 1, true)).toBe('performing')
  })

  it('if index = -1, allPass = true, armed = true → state is "armed"', () => {
    expect(getPerformanceState(allPassChecks, -1, true)).toBe('armed')
  })

  it('if index = -1, allPass = true, armed = false → state is "ready"', () => {
    expect(getPerformanceState(allPassChecks, -1, false)).toBe('ready')
  })

  it('if checks do not all pass and index = -1 → state is "setup"', () => {
    expect(getPerformanceState(notAllPassChecks, -1, false)).toBe('setup')
    expect(getPerformanceState(notAllPassChecks, -1, true)).toBe('setup')
  })
})
