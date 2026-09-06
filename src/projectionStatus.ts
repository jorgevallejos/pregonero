/**
 * **What the `PROJECTION` column says, and it is one of two words.**
 *
 * It used to read `Open, No video` / `Open, Small` / `Open, Big` off the display mode. **The
 * display mode is gone** (Jorge, 2026-09-03, built 2026-09-06): format and placement are
 * Muralista's, whether the video runs is the drive mode, and **size was never a third thing.**
 *
 * So the column says whether the window is open, which is the one thing that column is about — and
 * the one thing about it a person cannot see from the stage.
 *
 * **This is what survived `screenSizeState.ts`**, which was named for a concept that had already
 * been dead since 2026-09-03 and now holds nothing at all.
 */
export function getProjectionStatusText(projectionOpen: boolean): string {
  return projectionOpen ? 'Open' : 'Closed'
}
