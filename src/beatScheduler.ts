export type SongTempo = {
  bpm: number
  /** Numerator of the time signature (e.g. 4 for 4/4, 6 for 6/8). Positive integer. */
  numerator: number
  /** Denominator of the time signature (e.g. 4 for 4/4, 8 for 6/8). Positive integer. */
  denominator: number
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
 * Derives the number of felt beats per bar from a time signature.
 *
 * Compound meters (6/8, 9/8, 12/8 — denominator 8, numerator divisible by 3
 * and > 3) pulse at the dotted-note level: beatsPerBar = numerator / 3.
 * All other meters are simple: beatsPerBar = numerator.
 *
 * bpm convention: bpm is always the felt pulse — the beat you count out loud.
 * In 4/4 that is the quarter note; in 6/8 set bpm to the dotted-quarter rate.
 */
export function getBeatsPerBar(tempo: SongTempo): number {
  const { numerator, denominator } = tempo
  const isCompound = denominator === 8 && numerator % 3 === 0 && numerator > 3
  return isCompound ? numerator / 3 : numerator
}

/**
 * Pure function: given a tempo descriptor and elapsed milliseconds since
 * the clock started, returns the current beat phase.
 *
 * No side effects; safe to call in tests with arbitrary time values.
 */
export function getBeatPhase(tempo: SongTempo, elapsedMs: number): BeatPhaseResult {
  const { bpm } = tempo
  const countInBars = tempo.countInBars ?? 1
  const beatMs = 60_000 / bpm
  const beatsPerBar = getBeatsPerBar(tempo)
  const absoluteBeat = Math.floor(elapsedMs / beatMs)
  const countInTotalBeats = countInBars * beatsPerBar
  const inCountIn = absoluteBeat < countInTotalBeats
  const beginFired = absoluteBeat >= countInTotalBeats
  const beatInBar = (absoluteBeat % beatsPerBar) + 1
  const barInCountIn = inCountIn ? Math.floor(absoluteBeat / beatsPerBar) + 1 : 0
  return { absoluteBeat, beatInBar, barInCountIn, inCountIn, beginFired }
}
