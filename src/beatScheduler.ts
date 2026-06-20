export type SongTempo = {
  bpm: number
  meter: number
  countInBars?: number
}

export type BeatPhaseResult = {
  /** 0-indexed absolute beat number since the clock started. */
  absoluteBeat: number
  /** 1-indexed position within the current bar (1 = downbeat). */
  beatInBar: number
  /** 1-indexed bar within the count-in phase; 0 once count-in ends. */
  barInCountIn: number
  /** True while the count-in bars are still running. */
  inCountIn: boolean
  /** True once all count-in bars have elapsed — the song proper begins. */
  beginFired: boolean
}

/**
 * Pure function: given a tempo descriptor and elapsed milliseconds since
 * the clock started, returns the current beat phase.
 *
 * No side effects; safe to call in tests with arbitrary time values.
 */
export function getBeatPhase(tempo: SongTempo, elapsedMs: number): BeatPhaseResult {
  const { bpm, meter } = tempo
  const countInBars = tempo.countInBars ?? 1
  const beatMs = 60_000 / bpm
  const absoluteBeat = Math.floor(elapsedMs / beatMs)
  const countInTotalBeats = countInBars * meter
  const inCountIn = absoluteBeat < countInTotalBeats
  const beginFired = absoluteBeat >= countInTotalBeats
  const beatInBar = (absoluteBeat % meter) + 1
  const barInCountIn = inCountIn ? Math.floor(absoluteBeat / meter) + 1 : 0
  return { absoluteBeat, beatInBar, barInCountIn, inCountIn, beginFired }
}
