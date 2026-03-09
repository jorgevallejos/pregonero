/**
 * Performance control state machine — behavioral contract from spec.
 *
 * States: SETUP | READY_TO_ARM | ARMED
 * Readiness: songSelected && translationLanguageSelected && singingLanguageSelected && projectionOpen
 *
 * This module is UI-agnostic and contains only pure logic. The control screen (or any consumer)
 * should build PerformanceControlPrerequisites from app state and drive the armed flag via
 * tryArm / applyUnarm; state is derived with getPerformanceControlState(prereqs, armed).
 */

export type PerformanceControlState = 'SETUP' | 'READY_TO_ARM' | 'ARMED'

export interface PerformanceControlPrerequisites {
  songSelected: boolean
  translationLanguageSelected: boolean
  singingLanguageSelected: boolean
  projectionOpen: boolean
}

export function isReadyToArm(prereqs: PerformanceControlPrerequisites): boolean {
  return (
    prereqs.songSelected &&
    prereqs.translationLanguageSelected &&
    prereqs.singingLanguageSelected &&
    prereqs.projectionOpen
  )
}

export function getPerformanceControlState(
  prereqs: PerformanceControlPrerequisites,
  armed: boolean
): PerformanceControlState {
  if (armed && isReadyToArm(prereqs)) return 'ARMED'
  if (isReadyToArm(prereqs)) return 'READY_TO_ARM'
  return 'SETUP'
}

/**
 * Attempt to arm. Only transitions to armed when current state is READY_TO_ARM.
 * Arm from SETUP must not transition to ARMED.
 */
export function tryArm(
  prereqs: PerformanceControlPrerequisites,
  armed: boolean
): boolean {
  const state = getPerformanceControlState(prereqs, armed)
  if (state === 'READY_TO_ARM') return true
  return armed
}

/** Unarm: always sets armed to false. */
export function applyUnarm(): boolean {
  return false
}

/** Navigation actions (Previous/Next) are only enabled in ARMED state. */
export function isNavigationEnabled(state: PerformanceControlState): boolean {
  return state === 'ARMED'
}
