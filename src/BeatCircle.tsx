import type { CSSProperties } from 'react'
import { getBeatsPerBar, type BeatPhaseResult, type SongTempo } from './beatScheduler'

type Props = {
  tempo: SongTempo | null | undefined
  phase: BeatPhaseResult | null
  /** CSS styles applied to the outer element — use for positioning (e.g. absolute corner placement). */
  style?: CSSProperties
}

/**
 * Circle-sized beat indicator (same dimensions as the gig-time circle).
 * - Returns null when tempo is absent or phase is null (clock not started).
 * - Count-in phase: shows beatInBar number + dot row, downbeat accented.
 * - Running phase: shows beatInBar number with downbeat accent.
 * Presentation-only — no internal state or timers.
 */
export function BeatCircle({ tempo, phase, style }: Props) {
  if (!tempo || !phase) return null

  const beatsPerBar = getBeatsPerBar(tempo)
  const isDownbeat = phase.beatInBar === 1

  const beatNumber = (
    <span
      className={`beat-circle-beat-number${isDownbeat ? ' beat-circle-downbeat' : ''}`}
      data-testid="beat-circle-beat-number"
    >
      {phase.beatInBar}
    </span>
  )

  if (phase.inCountIn) {
    const dots = Array.from({ length: beatsPerBar }, (_, i) => i + 1)
    return (
      <div className="beat-circle" data-testid="beat-circle" style={style}>
        <div className="beat-circle-count-in" data-testid="beat-circle-count-in">
          {beatNumber}
          <div className="beat-circle-dots" data-testid="beat-circle-dots" aria-hidden="true">
            {dots.map((b) => (
              <span
                key={b}
                className={`beat-circle-dot${b === phase.beatInBar ? ' beat-circle-dot-active' : ''}`}
                data-testid="beat-circle-dot"
              />
            ))}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="beat-circle" data-testid="beat-circle" style={style}>
      <div className="beat-circle-running" data-testid="beat-circle-running">
        {beatNumber}
      </div>
    </div>
  )
}
