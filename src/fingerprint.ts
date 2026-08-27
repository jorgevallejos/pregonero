/**
 * **A fingerprint of a file, for noticing that it moved.**
 *
 * Used by the setup confirmation and nowhere else. The whole point of the confirmation is that it
 * can **go stale**: it records that the checks passed, against these files as they were, and lapses
 * visibly when any of them changes. A confirmation that cannot go stale is worse than none, because
 * it hands out peace of mind that is no longer true.
 *
 * **This is a recipe, not a cake.** A fingerprint is compared and never read back into anything: no
 * warp matrix, no layout, no pixel size is ever recovered from one. It answers *is this the same
 * file* and nothing else, which is why a short non-cryptographic digest is the right size of tool —
 * there is no adversary here, only a file that was edited between two moments.
 */

/** FNV-1a, 32-bit, as eight lowercase hex digits. Deterministic across launches and machines. */
export function digest(text: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    // The 32-bit FNV prime, as shifts, because Math.imul on 16777619 is the same thing spelled out.
    hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}
