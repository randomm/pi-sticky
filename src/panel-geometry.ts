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
 * The two key ids the panel registers, spelled once here with the rest of the panel's vocabulary: the
 * registration sites, the tests that fire them and the prose that names them all quote these, so a
 * rebind is one edit rather than a hunt through four files.
 */
export const TOGGLE_KEY = "ctrl+alt+t";
export const FOCUS_KEY = "ctrl+alt+p";

/**
 * The verbs `/pins` answers besides listing, and the panel method each one means — one table, so the
 * grammar of the sub-command is stated in the same place as the rest of the panel's vocabulary and a
 * third verb has somewhere to be added. The mapping is by *name*, not by function value: the handler
 * that dispatches off it owns what calling the panel looks like, and a verb table that reached back into
 * `PanelOwner` would make this module depend on the thing it exists to describe.
 */
export const PANEL_VERBS = { show: "show", hide: "hide" } as const;

/** The name of the panel method a `/pins` argument names, or `undefined` when it is a listing. */
export function panelVerb(token: string): keyof typeof PANEL_VERBS | undefined {
  return token === PANEL_VERBS.show || token === PANEL_VERBS.hide ? token : undefined;
}

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
  if (!panelHasRoom(columns)) return TOO_NARROW;
  if (view.pins.length === 0) return NOTHING_PINNED;
  return undefined;
}

/**
 * Whether the panel can be shown at all: a whole-numbered width at or past the boundary.
 *
 * A fractional width is refused with the too-narrow string rather than honoured: `TerminalWidth` is a
 * record of what the host *said*, so it keeps what it was told, and the two questions about a width —
 * "what did the host state?" and "can the panel be measured against it?" — are answered here, in one
 * place, by the readers that act on the answer.
 */
function panelHasRoom(columns: number): boolean {
  return Number.isInteger(columns) && columns >= PANEL_MIN_COLUMNS;
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
 * A size the panel can promise about: a whole number of columns and rows.
 *
 * The panel's contract is that every line it returns measures *exactly* `width` visible columns, and
 * padding to a fraction is not that. pi-tui only ever hands out integers, so this states the
 * precondition rather than catching a live defect: a host that states 30.5 has stated a size the panel
 * cannot honour, and the honest answer is the rail's.
 */
export function isPanelSize(width: number, height: number): boolean {
  return Number.isInteger(width) && Number.isInteger(height) && width > 0 && height > 0;
}
