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

/**
 * The frame's own two rows of border, which no pin count removes: the one place the number is stated.
 * `panelFrameRows` puts them over the pin rows, `panelContentRows` (`panel-rows.ts`) takes them back off
 * a frame the caller already sized, and the builder draws them as its top and bottom border.
 */
export const BORDER_ROWS = 2;

/**
 * The tallest panel ever drawn, in rows: half the terminal, floored so an odd row count leaves the
 * extra row to the transcript. A tall terminal is not a reason to lay out a thousand rows the overlay
 * clips away, and pi-tui's own `maxHeight` of `"50%"` clamps to the same figure. There is no minimum of
 * its own: a ceiling that floored at three rows could hand back more rows than a short terminal has, and
 * a frame taller than the screen is worse than no frame — the builder refuses to draw one
 * (`panel-lines.ts`), which is the right answer for a terminal with no room for both borders.
 *
 * `rows` is what the caller could ask for: `tui.terminal.rows`, or `undefined` when the component has no
 * TUI to ask. Anything that is not a positive finite number — nothing stated, zero, `NaN`, `Infinity` —
 * is a terminal that cannot be asked, and answers with the fallback rows halved rather than zero, so a
 * frame is still a frame.
 */
export function panelMaxRows(rows: number | undefined): number {
  const available = rows !== undefined && Number.isFinite(rows) && rows > 0 ? rows : FALLBACK_ROWS;
  return Math.floor(available / 2);
}

/**
 * Rows the panel draws for `contentRows` of pins: the frame over them, never past the ceiling.
 *
 * There is no padding to the ceiling: a two-pin panel is four rows tall and the prompt is visible
 * beside it. `Math.max` keeps the degenerate case a *closed* frame rather than zero rows — two borders
 * and nothing between them — which the builder itself then refuses to draw (`panel-lines.ts`), because a
 * frame whose height came out below `PANEL_MIN_FRAME_ROWS` is an open box and the rail keeps the pins.
 */
export function panelFrameRows(contentRows: number, rows: number | undefined): number {
  return Math.max(BORDER_ROWS, Math.min(contentRows + BORDER_ROWS, panelMaxRows(rows)));
}
