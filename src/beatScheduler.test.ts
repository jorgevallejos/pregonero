import { describe, it, expect } from 'vitest'
import { getBeatPhase, type SongTempo } from './beatScheduler'

describe('getBeatPhase', () => {
  const TEMPO_120_4: SongTempo = { bpm: 120, numerator: 4, denominator: 4, countInBars: 1 }
  // At 120 bpm, one beat = 500ms, one 4/4 bar = 2000ms
  // countInBars=1 → 4 count-in beats (2000ms), then song starts

  describe('at elapsed 0ms (very start)', () => {
    it('is beat 1 of bar 1, in count-in, begin not fired', () => {
      const p = getBeatPhase(TEMPO_120_4, 0)
      expect(p.beatInBar).toBe(1)
      expect(p.barInCountIn).toBe(1)
      expect(p.inCountIn).toBe(true)
      expect(p.beginFired).toBe(false)
      expect(p.absoluteBeat).toBe(0)
    })
  })

  describe('beat progression within first count-in bar (4/4 at 120 bpm)', () => {
    it('499ms → still beat 1', () => {
      const p = getBeatPhase(TEMPO_120_4, 499)
      expect(p.beatInBar).toBe(1)
      expect(p.absoluteBeat).toBe(0)
      expect(p.inCountIn).toBe(true)
    })

    it('500ms → beat 2', () => {
      const p = getBeatPhase(TEMPO_120_4, 500)
      expect(p.beatInBar).toBe(2)
      expect(p.absoluteBeat).toBe(1)
      expect(p.inCountIn).toBe(true)
    })

    it('1000ms → beat 3', () => {
      const p = getBeatPhase(TEMPO_120_4, 1000)
      expect(p.beatInBar).toBe(3)
      expect(p.absoluteBeat).toBe(2)
      expect(p.inCountIn).toBe(true)
    })

    it('1500ms → beat 4', () => {
      const p = getBeatPhase(TEMPO_120_4, 1500)
      expect(p.beatInBar).toBe(4)
      expect(p.absoluteBeat).toBe(3)
      expect(p.inCountIn).toBe(true)
    })

    it('1999ms → still beat 4, still in count-in', () => {
      const p = getBeatPhase(TEMPO_120_4, 1999)
      expect(p.beatInBar).toBe(4)
      expect(p.inCountIn).toBe(true)
      expect(p.beginFired).toBe(false)
    })
  })

  describe('begin fires after count-in completes', () => {
    it('2000ms → beginFired=true, inCountIn=false', () => {
      const p = getBeatPhase(TEMPO_120_4, 2000)
      expect(p.inCountIn).toBe(false)
      expect(p.beginFired).toBe(true)
      expect(p.barInCountIn).toBe(0)
    })

    it('beat cycles back to 1 after the count-in bar', () => {
      const p = getBeatPhase(TEMPO_120_4, 2000)
      expect(p.beatInBar).toBe(1)
      expect(p.absoluteBeat).toBe(4)
    })

    it('remains fired beyond the transition point', () => {
      const p = getBeatPhase(TEMPO_120_4, 5000)
      expect(p.beginFired).toBe(true)
      expect(p.inCountIn).toBe(false)
    })
  })

  describe('countInBars=2 doubles the count-in length', () => {
    const TEMPO_120_4_2BAR: SongTempo = { bpm: 120, numerator: 4, denominator: 4, countInBars: 2 }
    // 8 beats × 500ms = 4000ms before begin

    it('3999ms → still in count-in (last beat of bar 2)', () => {
      const p = getBeatPhase(TEMPO_120_4_2BAR, 3999)
      expect(p.inCountIn).toBe(true)
      expect(p.beginFired).toBe(false)
      expect(p.barInCountIn).toBe(2)
      expect(p.beatInBar).toBe(4)
    })

    it('4000ms → beginFired=true', () => {
      const p = getBeatPhase(TEMPO_120_4_2BAR, 4000)
      expect(p.inCountIn).toBe(false)
      expect(p.beginFired).toBe(true)
    })

    it('tracks bar within count-in correctly (bar 1 vs bar 2)', () => {
      const bar1 = getBeatPhase(TEMPO_120_4_2BAR, 0)
      const bar2 = getBeatPhase(TEMPO_120_4_2BAR, 2000)
      expect(bar1.barInCountIn).toBe(1)
      expect(bar2.barInCountIn).toBe(2)
    })
  })

  describe('countInBars defaults to 1 when absent', () => {
    const TEMPO_NO_COUNT: SongTempo = { bpm: 120, numerator: 4, denominator: 4 }

    it('begin fires after one bar (same as countInBars=1)', () => {
      const p = getBeatPhase(TEMPO_NO_COUNT, 2000)
      expect(p.beginFired).toBe(true)
    })

    it('still in count-in before one bar', () => {
      const p = getBeatPhase(TEMPO_NO_COUNT, 1999)
      expect(p.inCountIn).toBe(true)
    })
  })

  describe('3/4 meter (waltz)', () => {
    const WALTZ: SongTempo = { bpm: 120, numerator: 3, denominator: 4, countInBars: 1 }
    // 3 beats × 500ms = 1500ms before begin

    it('beat cycles 1→2→3→1', () => {
      expect(getBeatPhase(WALTZ, 0).beatInBar).toBe(1)
      expect(getBeatPhase(WALTZ, 500).beatInBar).toBe(2)
      expect(getBeatPhase(WALTZ, 1000).beatInBar).toBe(3)
      expect(getBeatPhase(WALTZ, 1500).beatInBar).toBe(1)
    })

    it('begin fires after 3 beats', () => {
      expect(getBeatPhase(WALTZ, 1499).inCountIn).toBe(true)
      expect(getBeatPhase(WALTZ, 1500).beginFired).toBe(true)
    })
  })

  describe('downbeat detection (beatInBar === 1)', () => {
    it('beat 1 of every bar is the downbeat', () => {
      // at 2000ms (song start after count-in) beatInBar should be 1 (downbeat)
      const p = getBeatPhase(TEMPO_120_4, 2000)
      expect(p.beatInBar).toBe(1)
    })
  })

  describe('fast tempo (200 bpm)', () => {
    const FAST: SongTempo = { bpm: 200, numerator: 4, denominator: 4, countInBars: 1 }
    // beatMs = 300ms, 4 beats = 1200ms before begin

    it('begin fires at 1200ms', () => {
      expect(getBeatPhase(FAST, 1199).beginFired).toBe(false)
      expect(getBeatPhase(FAST, 1200).beginFired).toBe(true)
    })

    it('beat 4 is at 900ms', () => {
      expect(getBeatPhase(FAST, 900).beatInBar).toBe(4)
    })
  })
})

describe('getBeatPhase — numerator/denominator shape', () => {
  describe('4/4 — identical output to old meter:4', () => {
    const FOUR_FOUR: SongTempo = { bpm: 120, numerator: 4, denominator: 4, countInBars: 1 }

    it('beat 1 at 0ms (in count-in)', () => {
      const p = getBeatPhase(FOUR_FOUR, 0)
      expect(p.beatInBar).toBe(1)
      expect(p.inCountIn).toBe(true)
    })

    it('beat 2 at 500ms', () => {
      expect(getBeatPhase(FOUR_FOUR, 500).beatInBar).toBe(2)
    })

    it('beginFired at 2000ms (4-beat count-in)', () => {
      expect(getBeatPhase(FOUR_FOUR, 2000).beginFired).toBe(true)
      expect(getBeatPhase(FOUR_FOUR, 1999).beginFired).toBe(false)
    })
  })

  describe('3/4 simple meter — 3 beats per bar', () => {
    // 3/4: denominator=4, not compound → beatsPerBar = numerator = 3
    // At 120 bpm: beat = 500ms, bar = 1500ms
    const THREE_FOUR: SongTempo = { bpm: 120, numerator: 3, denominator: 4, countInBars: 1 }

    it('beat cycles 1→2→3→1', () => {
      expect(getBeatPhase(THREE_FOUR, 0).beatInBar).toBe(1)
      expect(getBeatPhase(THREE_FOUR, 500).beatInBar).toBe(2)
      expect(getBeatPhase(THREE_FOUR, 1000).beatInBar).toBe(3)
      expect(getBeatPhase(THREE_FOUR, 1500).beatInBar).toBe(1)
    })

    it('begin fires after 3 beats (1500ms)', () => {
      expect(getBeatPhase(THREE_FOUR, 1499).inCountIn).toBe(true)
      expect(getBeatPhase(THREE_FOUR, 1500).beginFired).toBe(true)
    })
  })

  describe('6/8 compound meter — 2 felt beats per bar', () => {
    // isCompound: denominator=8, numerator=6, 6%3=0, 6>3 → beatsPerBar = 6/3 = 2
    // bpm = felt dotted-quarter rate; at 120 bpm one beat = 500ms, bar = 1000ms
    const SIX_EIGHT: SongTempo = { bpm: 120, numerator: 6, denominator: 8, countInBars: 1 }

    it('has 2 felt beats per bar (not 6)', () => {
      expect(getBeatPhase(SIX_EIGHT, 0).beatInBar).toBe(1)
      expect(getBeatPhase(SIX_EIGHT, 500).beatInBar).toBe(2)
      expect(getBeatPhase(SIX_EIGHT, 1000).beatInBar).toBe(1)
    })

    it('begin fires after 2 beats / 1 bar (1000ms)', () => {
      expect(getBeatPhase(SIX_EIGHT, 999).inCountIn).toBe(true)
      expect(getBeatPhase(SIX_EIGHT, 1000).beginFired).toBe(true)
    })
  })

  describe('9/8 compound meter — 3 felt beats per bar', () => {
    // isCompound: denominator=8, numerator=9, 9%3=0, 9>3 → beatsPerBar = 9/3 = 3
    const NINE_EIGHT: SongTempo = { bpm: 120, numerator: 9, denominator: 8, countInBars: 1 }

    it('has 3 felt beats per bar', () => {
      expect(getBeatPhase(NINE_EIGHT, 0).beatInBar).toBe(1)
      expect(getBeatPhase(NINE_EIGHT, 500).beatInBar).toBe(2)
      expect(getBeatPhase(NINE_EIGHT, 1000).beatInBar).toBe(3)
      expect(getBeatPhase(NINE_EIGHT, 1500).beatInBar).toBe(1)
    })

    it('begin fires after 3 beats / 1 bar (1500ms)', () => {
      expect(getBeatPhase(NINE_EIGHT, 1499).inCountIn).toBe(true)
      expect(getBeatPhase(NINE_EIGHT, 1500).beginFired).toBe(true)
    })
  })

  describe('3/8 simple meter — stays 3 beats per bar (not compound)', () => {
    // isCompound requires numerator > 3; 3/8 has numerator=3 which fails → simple, beatsPerBar=3
    const THREE_EIGHT: SongTempo = { bpm: 120, numerator: 3, denominator: 8 }

    it('has 3 beats per bar (like 3/4, not treated as compound)', () => {
      expect(getBeatPhase(THREE_EIGHT, 0).beatInBar).toBe(1)
      expect(getBeatPhase(THREE_EIGHT, 500).beatInBar).toBe(2)
      expect(getBeatPhase(THREE_EIGHT, 1000).beatInBar).toBe(3)
      expect(getBeatPhase(THREE_EIGHT, 1500).beatInBar).toBe(1)
    })
  })
})
