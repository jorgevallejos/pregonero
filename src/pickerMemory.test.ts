/**
 * **Where each picker was last open.** A convenience, not a setting.
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeAll, beforeEach, vi, afterEach } from 'vitest'
import { ensureStorage } from './testSupport/storage'
import { lastPickerFolder, rememberPickerFolder } from './pickerMemory'

beforeAll(ensureStorage)
beforeEach(() => localStorage.clear())
afterEach(() => vi.restoreAllMocks())

describe('picker memory', () => {
  it('has nothing to say about a picker that has never been opened', () => {
    expect(lastPickerFolder('audio')).toBeNull()
  })

  it('remembers the folder the dialog was in, not the file that came out of it', () => {
    rememberPickerFolder('audio', '/takes/libertad/take-3.m4a')
    expect(lastPickerFolder('audio')).toBe('/takes/libertad')
  })

  it('reopens a folder picker beside its answer rather than inside it', () => {
    // Picking `…/Chango Pepper/songs` again means looking at what is next to `songs`.
    rememberPickerFolder('songs-folder', '/Users/j/Chango Pepper/songs')
    expect(lastPickerFolder('songs-folder')).toBe('/Users/j/Chango Pepper')
  })

  it('keeps each picker’s place apart', () => {
    // The words and the recording are different questions asked of different folders. One shared
    // memory would send each of them to the other's answer.
    rememberPickerFolder('lyrics', '/vault/lyrics/libertad.txt')
    rememberPickerFolder('audio', '/takes/libertad/take-3.m4a')
    expect(lastPickerFolder('lyrics')).toBe('/vault/lyrics')
    expect(lastPickerFolder('audio')).toBe('/takes/libertad')
  })

  it('records nothing for a cancelled dialog — where you nearly went is not where you were', () => {
    rememberPickerFolder('audio', '/takes/libertad/take-3.m4a')
    rememberPickerFolder('audio', null)
    expect(lastPickerFolder('audio')).toBe('/takes/libertad')
  })

  it('says nothing rather than a root for a path with nothing above it', () => {
    rememberPickerFolder('audio', '/take.m4a')
    expect(lastPickerFolder('audio')).toBeNull()
  })

  it('survives storage it cannot read, and storage it cannot write', () => {
    localStorage.setItem('pregoneroPickerFolders', 'not json')
    expect(lastPickerFolder('audio')).toBeNull()
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota')
    })
    expect(() => rememberPickerFolder('audio', '/takes/x.m4a')).not.toThrow()
  })
})
