import type { CSSProperties } from 'react'

/**
 * **The big word in a Standby column, sized so it never breaks inside itself.**
 *
 * ## What was actually wrong
 *
 * `Unarmed` broke as `Unarm / ed`, and `Closed` before it. It was blamed on the column count and it
 * was never the column count — the Rig column came off in `v0.52.0` and `Unarmed` still broke, at
 * five columns instead of six.
 *
 * **The type was sized off the VIEWPORT and the column was sized off the PANEL.** The value's rule
 * was `clamp(1.75em, 4vw, 2.75em)`; its column is `minmax(0, 1fr)`, one of N equal shares of the
 * panel. Two unrelated numbers, and nothing anywhere made them agree. On a 1440-wide window the
 * type lands at 57.6px and `Unarmed` measures ~242px, in a column with ~226px of content width:
 * the word does not fit, and `word-break: break-word` on the same rule is what turns *does not fit*
 * into a break inside the word. Taking a column away moved the column from ~180px to ~226px — a
 * smaller deficit, and still a deficit. **The count only ever changed the size of the gap.**
 *
 * ## What makes it true instead
 *
 * **The column sizes the type.** `.control-setup-content` is a container, and the value's size is
 * capped in `cqi` — a share of *its own column*, at any window width and any number of columns.
 *
 * **And the cap knows how long the word is.** A fixed `cqi` cap fits `Unarmed` and not a fifteen-
 * character song title, and the values here are not all the app's own words: the Gig and Song
 * columns carry whatever a person called their gig and their song. So the cap is divided by the
 * longest word's length, which this component measures and hands to CSS as a number. **No layout
 * is measured** — the length of a string is known without asking the browser anything, which is
 * also why it is testable here rather than only on a screen.
 *
 * **Mid-word breaking is then switched off outright**, in `.control-setup-value`. The sizing is
 * what keeps a word inside its column; the switch is what makes *no word breaks mid-word* a
 * property of the screen rather than a consequence of arithmetic that could drift.
 */

/**
 * The character count of the longest unbreakable run in a value.
 *
 * Split on whitespace and on hyphens, because those are the two places CSS will break a line
 * without being asked. Everything between them has to fit as one piece.
 *
 * **Never zero**: an empty value has no word to fit, and a zero would divide the cap by nothing.
 */
export function longestWordLength(text: string): number {
  let longest = 1
  for (const word of text.split(/[\s-]+/)) {
    if (word.length > longest) longest = word.length
  }
  return longest
}

/**
 * The value's own type-size cap, as a custom property CSS divides by.
 *
 * Kept as a function so the one place the number is decided is next to the reasoning for it, and
 * so a test can assert what a given string asks for.
 */
export function setupValueStyle(text: string): CSSProperties {
  return { '--value-longest-word': longestWordLength(text) } as CSSProperties
}

/**
 * One column's value. `data-testid` is passed through because two of the five are asserted by id.
 */
export function SetupValue({ text, testId }: { text: string; testId?: string }) {
  return (
    <span className="control-setup-value" style={setupValueStyle(text)} data-testid={testId}>
      {text}
    </span>
  )
}
