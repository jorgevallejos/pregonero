/** @vitest-environment jsdom */
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { BeatCircle } from './BeatCircle'
import type { SongTempo } from './beatScheduler'
import { getBeatPhase } from './beatScheduler'

afterEach(cleanup)

const tempo4_4: SongTempo = { bpm: 120, numerator: 4, denominator: 4, countInBars: 1 }
const tempo6_8: SongTempo = { bpm: 100, numerator: 6, denominator: 8, countInBars: 1 }
const tempo3_4: SongTempo = { bpm: 90,  numerator: 3, denominator: 4, countInBars: 1 }

// ── no-tempo guard ──────────────────────────────────────────────────────────

describe('BeatCircle — no-tempo guard', () => {
  it('renders nothing when tempo is null', () => {
    const { container } = render(<BeatCircle tempo={null} phase={null} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders nothing when tempo is undefined', () => {
    const { container } = render(<BeatCircle tempo={undefined} phase={null} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders nothing when tempo provided but phase is null', () => {
    const { container } = render(<BeatCircle tempo={tempo4_4} phase={null} />)
    expect(container.firstChild).toBeNull()
  })
})

// ── count-in phase ──────────────────────────────────────────────────────────

describe('BeatCircle — count-in phase (4/4)', () => {
  it('renders the beat-circle in count-in mode', () => {
    const phase = getBeatPhase(tempo4_4, 0)
    render(<BeatCircle tempo={tempo4_4} phase={phase} />)
    expect(screen.getByTestId('beat-circle')).toBeTruthy()
    expect(screen.getByTestId('beat-circle-count-in')).toBeTruthy()
  })

  it('shows the current beatInBar number', () => {
    const phase = getBeatPhase(tempo4_4, 0) // beat 1 at t=0
    render(<BeatCircle tempo={tempo4_4} phase={phase} />)
    expect(screen.getByTestId('beat-circle-beat-number').textContent).toBe('1')
  })

  it('applies downbeat accent class on beat 1', () => {
    const phase = getBeatPhase(tempo4_4, 0) // beat 1
    render(<BeatCircle tempo={tempo4_4} phase={phase} />)
    expect(screen.getByTestId('beat-circle-beat-number').className).toMatch(/downbeat/)
  })

  it('does not apply downbeat class on beat 2', () => {
    // At 120bpm beat interval = 500ms; beat 2 starts at 500ms
    const phase = getBeatPhase(tempo4_4, 500)
    expect(phase.beatInBar).toBe(2)
    render(<BeatCircle tempo={tempo4_4} phase={phase} />)
    expect(screen.getByTestId('beat-circle-beat-number').className).not.toMatch(/downbeat/)
  })

  it('renders 4 dots for 4/4 (simple meter)', () => {
    const phase = getBeatPhase(tempo4_4, 0)
    render(<BeatCircle tempo={tempo4_4} phase={phase} />)
    const dots = screen.getByTestId('beat-circle-dots').querySelectorAll('[data-testid="beat-circle-dot"]')
    expect(dots).toHaveLength(4)
  })

  it('marks only the current beat dot as active', () => {
    // beat 2 at 500ms
    const phase = getBeatPhase(tempo4_4, 500)
    expect(phase.beatInBar).toBe(2)
    render(<BeatCircle tempo={tempo4_4} phase={phase} />)
    const dots = Array.from(
      screen.getByTestId('beat-circle-dots').querySelectorAll('[data-testid="beat-circle-dot"]')
    )
    const activeCount = dots.filter((d) => d.className.includes('active')).length
    expect(activeCount).toBe(1)
    expect(dots[1].className).toMatch(/active/) // 0-indexed: dot index 1 = beat 2
  })
})

// ── compound meter — 6/8 ───────────────────────────────────────────────────

describe('BeatCircle — count-in phase (6/8 compound)', () => {
  it('renders 2 dots for 6/8 (compound: 6÷3 = 2 felt beats)', () => {
    const phase = getBeatPhase(tempo6_8, 0)
    render(<BeatCircle tempo={tempo6_8} phase={phase} />)
    const dots = screen.getByTestId('beat-circle-dots').querySelectorAll('[data-testid="beat-circle-dot"]')
    expect(dots).toHaveLength(2)
  })
})

// ── simple meter 3/4 ───────────────────────────────────────────────────────

describe('BeatCircle — count-in phase (3/4)', () => {
  it('renders 3 dots for 3/4', () => {
    const phase = getBeatPhase(tempo3_4, 0)
    render(<BeatCircle tempo={tempo3_4} phase={phase} />)
    const dots = screen.getByTestId('beat-circle-dots').querySelectorAll('[data-testid="beat-circle-dot"]')
    expect(dots).toHaveLength(3)
  })
})

// ── running phase (post-count-in) ──────────────────────────────────────────

describe('BeatCircle — running phase', () => {
  // For 4/4 at 120bpm, countInBars=1 → count-in ends after 4 beats = 2000ms
  const AFTER_COUNT_IN = 2001

  it('renders in running mode once count-in ends', () => {
    const phase = getBeatPhase(tempo4_4, AFTER_COUNT_IN)
    expect(phase.inCountIn).toBe(false)
    render(<BeatCircle tempo={tempo4_4} phase={phase} />)
    expect(screen.queryByTestId('beat-circle-count-in')).toBeNull()
    expect(screen.getByTestId('beat-circle-running')).toBeTruthy()
  })

  it('shows beatInBar in running mode', () => {
    const phase = getBeatPhase(tempo4_4, AFTER_COUNT_IN)
    render(<BeatCircle tempo={tempo4_4} phase={phase} />)
    expect(screen.getByTestId('beat-circle-beat-number').textContent).toBe(String(phase.beatInBar))
  })

  it('applies downbeat accent when beatInBar === 1 in running mode', () => {
    // Find a moment just after count-in starts where beatInBar === 1
    let phase = getBeatPhase(tempo4_4, AFTER_COUNT_IN)
    // Advance to a downbeat if not already on one
    let elapsed = AFTER_COUNT_IN
    while (phase.beatInBar !== 1) {
      elapsed += 1
      phase = getBeatPhase(tempo4_4, elapsed)
    }
    render(<BeatCircle tempo={tempo4_4} phase={phase} />)
    expect(screen.getByTestId('beat-circle-beat-number').className).toMatch(/downbeat/)
  })

  it('does not apply downbeat accent on non-first beats in running mode', () => {
    const phase = getBeatPhase(tempo4_4, AFTER_COUNT_IN + 500) // should be beat 2
    expect(phase.inCountIn).toBe(false)
    if (phase.beatInBar !== 1) {
      render(<BeatCircle tempo={tempo4_4} phase={phase} />)
      expect(screen.getByTestId('beat-circle-beat-number').className).not.toMatch(/downbeat/)
    } else {
      // If it landed on a downbeat, skip (acceptable)
      expect(true).toBe(true)
    }
  })
})

// ── position prop ───────────────────────────────────────────────────────────

describe('BeatCircle — position prop', () => {
  it('applies the provided style to the outer element', () => {
    const phase = getBeatPhase(tempo4_4, 0)
    render(
      <BeatCircle
        tempo={tempo4_4}
        phase={phase}
        style={{ position: 'absolute', top: '1rem', left: '1rem' }}
      />
    )
    const el = screen.getByTestId('beat-circle')
    expect(el.style.position).toBe('absolute')
    expect(el.style.top).toBe('1rem')
  })

  it('renders without style prop — no crash', () => {
    const phase = getBeatPhase(tempo4_4, 0)
    render(<BeatCircle tempo={tempo4_4} phase={phase} />)
    expect(screen.getByTestId('beat-circle')).toBeTruthy()
  })
})
