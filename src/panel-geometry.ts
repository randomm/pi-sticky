/**
 * The panel's geometry: the boundary numbers, the overlay configuration, and the checks that decide
 * whether a show can happen at all.
 *
 * Split out of `panel.ts` because the same numbers are quoted from three directions — the overlay
 * options, the rail's handoff, and the commands/shortcuts that refuse — and a boundary that lives in
 * one of those three is a boundary the other two can drift from. `PANEL_MIN_COLUMNS` in particular is
 * both the overlay's floor and the rail's stand-down point; they are one number precisely so the two
 * surfaces cannot disagree about who owns the pins.
 *
 * Only numbers and predicates live here. The refusal copy these predicates answer with is in
 * `panel-refusals.ts`, the keyboard in `panel-keys.ts` and the `/pins` grammar in `commands.ts`, so a
 * copy edit or a rebind never touches the file whose whole point is a shared numeric boundary. The two
 * questions a *width* or a *view* has to answer for both surfaces — what an unstated terminal counts as,
 * and what the installed rail draws — are here for the same reason: they are the boundary, asked twice.
 */
import type { OverlayOptions } from "@earendil-works/pi-tui";

import type { TerminalStatus } from "./panel-width.ts";
import type { ViewPin } from "./types.ts";

/** Below this many columns the panel has no room and the above-editor rail draws instead. */
export const PANEL_MIN_COLUMNS = 100;

/** The panel's own overlay configuration, fixed by the ticket rather than configurable. */
export const PANEL_OVERLAY_OPTIONS: OverlayOptions = {
  anchor: "right-center",
  width: "33%",
  minWidth: 30,
  maxHeight: "100%",
  nonCapturing: true,
};

/**
 * Whether a size is one the panel can promise about at all: a whole number of columns and rows.
 *
 * The panel's contract is that every line it returns measures *exactly* `width` visible columns, and
 * padding to a fraction is not that. pi-tui only ever hands out integers, so this states the
 * precondition rather than catching a live defect: a host that states 30.5 has stated a size the panel
 * cannot honour, and the honest answer is the rail's. The integer rule is written once, here: both
 * questions pi-tui asks — "does the overlay draw?" and "can this frame be laid out?" — are answered in
 * terms of it, so they cannot disagree about what a fractional width means.
 */
export function isPanelSize(width: number, height: number): boolean {
  return Number.isInteger(width) && Number.isInteger(height) && width > 0 && height > 0;
}

/**
 * Whether the panel can be shown at all: a width that is a size the panel can honour, at or past the
 * boundary.
 *
 * A fractional width is refused with the too-narrow string rather than honoured: `TerminalWidth` is a
 * record of what the host *said*, so it keeps what it was told, and the two questions about a width —
 * "what did the host state?" and "can the panel be measured against it?" — are answered here, in one
 * place, by the readers that act on the answer.
 */
export function panelHasRoom(columns: number): boolean {
  return isPanelSize(columns, columns) && columns >= PANEL_MIN_COLUMNS;
}

/**
 * Whether the panel is drawn at `columns`: the boundary, the user's flag and the pins, all three.
 *
 * One definition, asked by the overlay's own `visible()` and by the rail's handoff, so the two
 * surfaces answer the same question rather than two similar ones — which is the difference between
 * the pins moving from one surface to the other and the pins vanishing from both. A fractional width
 * answers false: the panel cannot promise its exact-width contract at 30.5 columns, so the rail — which
 * draws at whatever width it is handed — keeps the pins.
 */
export function panelIsVisible(columns: number, shown: boolean, pinCount: number): boolean {
  return panelHasRoom(columns) && shown && pinCount > 0;
}

/**
 * What an unstated terminal is judged as, by the one predicate that has to answer for it.
 *
 * `TerminalWidth` says *which* silence is holding; the guess itself lives here, next to the boundary it
 * is measured against, so the two halves of the rule cannot be joined by the numeric coincidence that a
 * placeholder happens to clear `PANEL_MIN_COLUMNS`. A host that has never asked has no frame to wait for
 * and is guessed wide (see `panel-width.ts`); a session whose first frame has not arrived is not measured
 * at all, and the rail keeps the pins.
 */
export function judgeColumns(status: TerminalStatus): number {
  if ("measured" in status) return status.measured;
  return status.unstated === "never_asks" ? PANEL_MIN_COLUMNS : 0;
}

/**
 * What the installed rail draws, in one string: which pins, at what level, when they last changed, and
 * whether the user has replied to them.
 *
 * The rail's install guard needs a discriminator the visibility predicate does not: `RailComponent`
 * snapshots the view it was built with, so any of those four has to reach the key or the rail keeps
 * drawing the previous view — a same-count swap, a pin whose text changed (which stamps `updatedAt`),
 * or one the user replied to (the dimming the rail renders). None is the text itself, and this runs on
 * every overlay frame, so it stays a handful of appends per pin. An empty view stamps the empty string,
 * which is why the count is not needed separately.
 */
export function railStamp(pins: readonly ViewPin[]): string {
  let stamp = "";
  for (const pin of pins) {
    stamp += `${pin.id}:${pin.level}:${pin.updatedAt}:${pin.repliedAt ?? ""},`;
  }
  return stamp;
}
