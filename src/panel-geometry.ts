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

/**
 * The smallest frame the builder will close, and so the smallest overlay pi may hand it: two border rows
 * over one row of pins, and a gutter and its space on each side of at least one column of text — which is
 * `MIN_COLUMNS_FOR_META` (`panel-frame-geometry.ts`) spelled out as a literal, and the test that asserts
 * this number sits at or above it (`>=`, the comparison that test uses: a floor above the arithmetic only
 * asks for a wider frame than the tail needs) is `test/panel-id-wide.test.ts`. Below
 * either bound the builder draws nothing rather than an open box, which is why these two numbers are
 * stated here with the overlay's own `minWidth` — `minWidth` *is* the columns bound, and pi-tui's
 * `OverlayOptions` has no `minHeight` to state the rows bound in, so the component is what keeps a frame
 * from being asked for a height it would refuse to close. Neither is `PANEL_MIN_COLUMNS`, which is the
 * wider terminal a panel takes the pins off the rail at: a narrower overlay simply never gets a frame,
 * and the rail keeps them.
 */
export const PANEL_MIN_FRAME_COLUMNS = 30;
export const PANEL_MIN_FRAME_ROWS = 3;

/**
 * The panel's own overlay configuration, fixed by the ticket rather than configurable.
 *
 * Anchored at the *top* right and capped at half the terminal: the panel is a column of notes beside
 * the conversation, not a second transcript, and an overlay that filled the rows hid the chat it is
 * meant to annotate. The cap is a ceiling rather than a height — the component draws only as many rows
 * as its pins need (`panel-height.ts`) — and `minWidth` is the narrowest frame the builder will close
 * (`PANEL_MIN_FRAME_COLUMNS`, exported from this file just above), which is why the two numbers are the same 30. The
 * rows a frame needs are the builder's floor too (`PANEL_MIN_FRAME_ROWS`), but pi-tui's
 * `OverlayOptions` has no `minHeight` to state it in, so the component is what keeps a frame from being
 * asked for a height it would refuse to close.
 */
export const PANEL_OVERLAY_OPTIONS: OverlayOptions = {
  anchor: "top-right",
  width: "33%",
  minWidth: PANEL_MIN_FRAME_COLUMNS,
  maxHeight: "50%",
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
 * terms of it, so they cannot disagree about what a fractional width means. How *small* a promiseable
 * size is is the frame builder's floor (`PANEL_MIN_FRAME_COLUMNS`, exported from this file just above),
 * not this
 * predicate's: the overlay and the rail agree on this one.
 */
export function isPanelSize(width: number, height: number): boolean {
  return Number.isInteger(width) && Number.isInteger(height) && width > 0 && height > 0;
}

/**
 * Whether a size is one a *closed* frame fits in: the builder draws nothing below either bound.
 *
 * Lives beside the two bounds it reads rather than in the frame's builder, because the frame and the peek
 * (`panel-peek.ts`) both ask it and neither may reach sideways into the other for a size predicate: a peek
 * which fitted where the open panel would not draw is a frame with gutters hanging off the overlay.
 */
export function isPanelFrameSize(width: number, height: number): boolean {
  return (
    isPanelSize(width, height) && width >= PANEL_MIN_FRAME_COLUMNS && height >= PANEL_MIN_FRAME_ROWS
  );
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
 *
 * `group`, `options` and `compact` are **not** in it, deliberately: the rail draws none of them (its rows
 * are `rail-lines.ts`'s marker, id, age and text), so a change to one of the three alone cannot make the
 * installed rail wrong, and the guard would reinstall a strip that draws the same bytes. The panel's half
 * of the same change does repaint, because the reducer publishes a *new pins array* for it and the frame
 * cache keys on that array's identity (`panel-frame-cache.ts`).
 */
export function railStamp(pins: readonly ViewPin[]): string {
  let stamp = "";
  for (const pin of pins) {
    stamp += `${pin.id}:${pin.level}:${pin.updatedAt}:${pin.repliedAt ?? ""},`;
  }
  return stamp;
}
