import { describe, it, expect } from 'vitest'
import {
  isReadyToArm,
  getPerformanceControlState,
  tryArm,
  applyUnarm,
  isNavigationEnabled,
  type PerformanceControlPrerequisites,
} from './performanceControlStateMachine'

const allTrue: PerformanceControlPrerequisites = {
  songSelected: true,
  translationLanguageSelected: true,
  singingLanguageSelected: true,
  projectionOpen: true,
}

describe('performance control state machine', () => {
  describe('isReadyToArm', () => {
    it('returns false when any prerequisite is false', () => {
      expect(isReadyToArm({ ...allTrue, songSelected: false })).toBe(false)
      expect(isReadyToArm({ ...allTrue, translationLanguageSelected: false })).toBe(false)
      expect(isReadyToArm({ ...allTrue, singingLanguageSelected: false })).toBe(false)
      expect(isReadyToArm({ ...allTrue, projectionOpen: false })).toBe(false)
    })

    it('returns true when all prerequisites are true', () => {
      expect(isReadyToArm(allTrue)).toBe(true)
    })
  })

  describe('1. Initial state is SETUP', () => {
    it('getState with armed false and prerequisites not all met returns SETUP', () => {
      expect(getPerformanceControlState({ ...allTrue, songSelected: false }, false)).toBe('SETUP')
    })

    it('getState with armed false and all prerequisites met returns READY_TO_ARM (not SETUP)', () => {
      expect(getPerformanceControlState(allTrue, false)).toBe('READY_TO_ARM')
    })

    it('initial state with no prerequisites is SETUP', () => {
      const none: PerformanceControlPrerequisites = {
        songSelected: false,
        translationLanguageSelected: false,
        singingLanguageSelected: false,
        projectionOpen: false,
      }
      expect(getPerformanceControlState(none, false)).toBe('SETUP')
    })
  })

  describe('2. If any prerequisite is missing, state remains SETUP', () => {
    it('when not ready and armed is false, state is SETUP', () => {
      expect(getPerformanceControlState({ ...allTrue, projectionOpen: false }, false)).toBe('SETUP')
    })

    it('when not ready and armed is true, state is still SETUP (armed cannot persist to ARMED)', () => {
      expect(getPerformanceControlState({ ...allTrue, projectionOpen: false }, true)).toBe('SETUP')
    })
  })

  describe('3. If all prerequisites are satisfied, state becomes READY_TO_ARM', () => {
    it('when all prerequisites true and not armed, state is READY_TO_ARM', () => {
      expect(getPerformanceControlState(allTrue, false)).toBe('READY_TO_ARM')
    })
  })

  describe('4. Arm from READY_TO_ARM transitions to ARMED', () => {
    it('tryArm when READY_TO_ARM returns true (armed becomes true)', () => {
      expect(tryArm(allTrue, false)).toBe(true)
    })

    it('getState with all prerequisites and armed true is ARMED', () => {
      expect(getPerformanceControlState(allTrue, true)).toBe('ARMED')
    })
  })

  describe('5. Arm from SETUP must not transition to ARMED', () => {
    it('tryArm when SETUP (prerequisites missing) leaves armed false', () => {
      const prereqs: PerformanceControlPrerequisites = { ...allTrue, songSelected: false }
      expect(getPerformanceControlState(prereqs, false)).toBe('SETUP')
      expect(tryArm(prereqs, false)).toBe(false)
      expect(getPerformanceControlState(prereqs, tryArm(prereqs, false))).toBe('SETUP')
    })

    it('tryArm when SETUP does not yield ARMED state', () => {
      const prereqs: PerformanceControlPrerequisites = { ...allTrue, projectionOpen: false }
      const newArmed = tryArm(prereqs, false)
      expect(getPerformanceControlState(prereqs, newArmed)).not.toBe('ARMED')
      expect(getPerformanceControlState(prereqs, newArmed)).toBe('SETUP')
    })
  })

  describe('6. Unarm from ARMED returns to READY_TO_ARM if all prerequisites still satisfied', () => {
    it('applyUnarm returns false', () => {
      expect(applyUnarm()).toBe(false)
    })

    it('after unarm, with prerequisites still satisfied, state is READY_TO_ARM', () => {
      const armedAfterArm = tryArm(allTrue, false)
      expect(getPerformanceControlState(allTrue, armedAfterArm)).toBe('ARMED')
      const armedAfterUnarm = applyUnarm()
      expect(getPerformanceControlState(allTrue, armedAfterUnarm)).toBe('READY_TO_ARM')
    })
  })

  describe('7. If a prerequisite becomes false while READY_TO_ARM, state returns to SETUP', () => {
    it('was READY_TO_ARM (all true, not armed), then projectionOpen becomes false → SETUP', () => {
      expect(getPerformanceControlState(allTrue, false)).toBe('READY_TO_ARM')
      const prereqsNow: PerformanceControlPrerequisites = { ...allTrue, projectionOpen: false }
      expect(getPerformanceControlState(prereqsNow, false)).toBe('SETUP')
    })

    it('was READY_TO_ARM, then songSelected becomes false → SETUP', () => {
      const prereqsNow: PerformanceControlPrerequisites = { ...allTrue, songSelected: false }
      expect(getPerformanceControlState(prereqsNow, false)).toBe('SETUP')
    })
  })

  describe('8. Navigation actions are only enabled in ARMED state', () => {
    it('SETUP → navigation disabled', () => {
      expect(isNavigationEnabled('SETUP')).toBe(false)
    })

    it('READY_TO_ARM → navigation disabled', () => {
      expect(isNavigationEnabled('READY_TO_ARM')).toBe(false)
    })

    it('ARMED → navigation enabled', () => {
      expect(isNavigationEnabled('ARMED')).toBe(true)
    })
  })
})
