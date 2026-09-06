/**
 * **What Standby's state is, read from the screen after the heading came off** (2026-09-05).
 *
 * `Performance: Setup` / `Performance: Ready to Arm` was the heading on the setup panel, and it was
 * also what ~90 tests waited on to know which state they had reached. **The heading is gone** —
 * those two words name the two halves of the split and a label pairing them contradicts both — so
 * the tests need the state from something that is still on the screen.
 *
 * **The `ARM` column is that something, and it is not a substitute: it is the same fact.**
 * `canArm` is `controlState === 'READY_TO_ARM'` exactly, and the button's `disabled` is `!canArm`.
 * So a pressable `Arm` button *is* `READY_TO_ARM` and a dead one *is* `SETUP` — the distinction the
 * heading spelled out, read where a performer acts on it rather than where it was announced.
 *
 * **`null` means Standby is not up at all**: the app is armed, or on another screen entirely.
 *
 * **It reads the FIRST arm button in the document**, so a container a previous test left behind
 * answers for this one — and answers `SETUP`, because that screen was never set up. **Call
 * `cleanup()` before rendering** if the file's earlier tests might have leaked one.
 */
export type StandbyState = 'SETUP' | 'READY_TO_ARM'

export function standbyState(): StandbyState | null {
  const arm = document.querySelector<HTMLButtonElement>('[data-testid="control-arm-button"]')
  if (arm === null) return null
  return arm.disabled ? 'SETUP' : 'READY_TO_ARM'
}
