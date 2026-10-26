/**
 * How tall the panel draws, which is a question about the terminal *and* about the pins.
 *
 * `PanelComponent` asks this once per frame. It is deliberately *not* `handle.getBounds()`: pi-tui
 * computes the layout from `component.render(width)`, so reading the bounds from the previous frame
 * would make the panel's height depend on what it drew last frame and a dismissed pin could leave a
 * hole.
 *
 * The panel is only as tall as its content: the frame is two rows of border over the wrapped pin rows,
 * so those two numbers are the only thing that decides the height, and a panel with one pin does not
 * pad itself out to the ceiling. The ceiling is what the overlay's own `maxHeight` of `"50%"` states —
 * kept in the one place, so the overlay and the component cannot disagree about the tallest frame.
 */

/** Rows to fall back to when neither the overlay bounds nor the terminal can be asked. */
const FALLBACK_ROWS = 24;

/** The frame's own two rows of border, which no pin count removes. */
const BORDER_ROWS = 2;

/**
 * The tallest panel ever drawn, in rows: half the terminal, floored so an odd row count leaves the
 * extra row to the transcript. A tall terminal is not a reason to lay out a thousand rows the overlay
 * clips away, and pi-tui's own `maxHeight` of `"50%"` clamps to the same figure. A terminal that
 * cannot be asked answers with the fallback rows rather than zero, so a frame is still a frame.
 */
export function panelMaxRows(rows: unknown): number {
  const available = typeof rows === "number" && rows > 0 ? rows : FALLBACK_ROWS;
  return Math.max(3, Math.floor(available / 2));
}

/**
 * Rows the panel draws for `contentRows` of pins: the frame over them, never past the ceiling.
 *
 * There is no padding to the ceiling: a two-pin panel is four rows tall and the prompt is visible
 * beside it. `Math.max` keeps the degenerate case a *closed* frame rather than zero rows, since the
 * builder itself refuses to draw an open one (`panel-lines.ts`).
 */
export function panelFrameRows(contentRows: number, rows: unknown): number {
  return Math.max(BORDER_ROWS, Math.min(contentRows + BORDER_ROWS, panelMaxRows(rows)));
}
