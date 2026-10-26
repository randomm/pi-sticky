/**
 * How tall the panel draws, which is a question about the terminal rather than about the pins.
 *
 * `PanelComponent` asks this once per frame. It is deliberately *not* `handle.getBounds()`: pi-tui
 * computes the layout from `component.render(width)`, so reading the bounds from the previous frame
 * would make the panel's height depend on what it drew last frame and a dismissed pin could leave a
 * hole. `maxHeight` is `"100%"` in the overlay's own options, which pi-tui clamps to the available
 * rows, so filling the terminal is both the intent and the ceiling.
 */

/** Rows to fall back to when neither the overlay bounds nor the terminal can be asked. */
const FALLBACK_ROWS = 24;

/**
 * The tallest panel ever drawn. A tall terminal is not a reason to lay out a thousand rows the
 * overlay clips away, and pi-tui's own `maxHeight` of `"100%"` keeps this above what it will draw.
 */
const MAX_PANEL_ROWS = 100;

/**
 * Rows to draw: the terminal's own height, capped. A terminal that cannot be asked — no TUI, no
 * `terminal` member, or one that states zero — answers with the fallback, so a frame is still a frame.
 */
export function panelRows(rows: unknown): number {
  const available = typeof rows === "number" && rows > 0 ? rows : FALLBACK_ROWS;
  return Math.min(available, MAX_PANEL_ROWS);
}
