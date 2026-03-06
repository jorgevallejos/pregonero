import { nextIndex, prevIndex, type SongItem } from './songState'

export type NavigationAction =
  | 'next'
  | 'prev'
  | 'restart'
  | 'blankToggle'
  | 'setIndex'

/**
 * Pure computation of next (index, blank) from current state and action.
 * No side effects; used by useSongNavigation for next, prev, restart, blank toggle, setIndex.
 */
export function computeNavigationState(
  lines: SongItem[],
  index: number,
  blank: boolean,
  action: NavigationAction,
  value?: number
): { index: number; blank: boolean } {
  if (action === 'next') {
    const next = nextIndex(lines, index)
    return {
      index: next,
      blank: next >= 0 ? false : blank,
    }
  }
  if (action === 'prev') {
    const prev = prevIndex(lines, index)
    return {
      index: prev,
      blank: prev >= 0 ? false : blank,
    }
  }
  if (action === 'restart') {
    return { index: -1, blank: true }
  }
  if (action === 'blankToggle') {
    return { index, blank: !blank }
  }
  if (action === 'setIndex') {
    if (value === undefined) return { index, blank }
    const clamped =
      value < 0 ? -1 : Math.max(0, Math.min(value, lines.length - 1))
    return {
      index: clamped,
      blank: clamped === -1 ? true : blank,
    }
  }
  return { index, blank }
}
