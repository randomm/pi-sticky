/**
 * The panel's own geometry, its two refusal strings, and the check that decides whether a show can
 * happen at all.
 *
 * Split out of `panel.ts` because the same numbers are quoted from three directions — the overlay
 * options, the rail's handoff, and the commands/shortcuts that refuse — and a boundary that lives in
 * one of those three is a boundary the other two can drift from. `PANEL_MIN_COLUMNS` in particular is
 * both the overlay's floor and the rail's stand-down point; they are one number precisely so the two
 * surfaces cannot disagree about who owns the pins.
 */
import type { OverlayOptions } from "@earendil-works/pi-tui";

import type { PinView } from "./types.ts";

/** Below this many columns the panel has no room and the above-editor rail draws instead. */
export const PANEL_MIN_COLUMNS = 100;

/**
 * What closing a panel resolves the host's `done` with. The value itself is never rendered — pi shows
 * a returned component's own result — but it must not be `undefined`, because "this panel was closed"
 * has to be distinguishable from "this panel was never opened" in what the host recorded.
 */
export const PANEL_CLOSED = "pi-sticky:panel-closed";

/** The panel's own overlay configuration, fixed by the ticket rather than configurable. */
export const PANEL_OVERLAY_OPTIONS: OverlayOptions = {
  anchor: "right-center",
  width: "33%",
  minWidth: 30,
  maxHeight: "100%",
  nonCapturing: true,
};

/**
 * The two strings the user hears when the panel cannot be shown. `/pins show`, `ctrl+alt+t` and
 * `ctrl+alt+p` all say them, on the same two conditions (operator resolution round 2).
 */
export const TOO_NARROW = "The pins panel needs at least 100 columns; use /pins.";
export const NOTHING_PINNED = "Nothing is pinned.";

/** The reason a show attempt failed, or `undefined` when the panel can be shown. */
export function refusalToShow(columns: number, view: PinView): string | undefined {
  if (columns < PANEL_MIN_COLUMNS) return TOO_NARROW;
  if (view.pins.length === 0) return NOTHING_PINNED;
  return undefined;
}

/**
 * Whether the panel is drawn at `columns`: the boundary, the user's flag and the pins, all three.
 *
 * One definition, asked by the overlay's own `visible()` and by the rail's handoff, so the two
 * surfaces answer the same question rather than two similar ones — which is the difference between
 * the pins moving from one surface to the other and the pins vanishing from both.
 */
export function panelIsVisible(columns: number, shown: boolean, pinCount: number): boolean {
  return columns >= PANEL_MIN_COLUMNS && shown && pinCount > 0;
}
