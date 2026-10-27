/**
 * The two strings the user hears when the panel cannot be shown, and the one predicate that picks between
 * them.
 *
 * Beside the panel's other user-facing text rather than in `panel-geometry.ts`, whose whole argument is
 * that it holds the *numbers* several modules share: a copy edit must not be a change to the file the
 * boundary-integrity argument exists to protect. `/pins show`, `ctrl+alt+t` and `ctrl+alt+p` all say
 * these two lines, on the same two conditions (operator resolution round 2), which is why the choice is
 * one function rather than a pair of `if`s at three call sites.
 */
import { PANEL_MIN_COLUMNS, panelHasRoom } from "./panel-geometry.ts";

import type { PinView } from "./types.ts";

/**
 * What the user is told when the terminal is too narrow for the panel. The number is interpolated from
 * `PANEL_MIN_COLUMNS` rather than repeated as a literal: that constant *is* the boundary `panelHasRoom`
 * measures against, and a copy of `100` here is a second copy of it, one a rebind of the boundary would
 * leave lying to the user. `panelHasRoom` is therefore the *only* thing that decides this line, and
 * `test/panel-refusals.test.ts` holds the pairing across the boundary: move `PANEL_MIN_COLUMNS` and the
 * sentence has to move with it. The two lifecycle files drive the same refusal through `/pins show` and
 * the focused shortcut. README.md quotes the rendered sentence, so it must stay byte-identical.
 */
export const TOO_NARROW = `The pins panel needs at least ${PANEL_MIN_COLUMNS} columns; use /pins.`;
export const NOTHING_PINNED = "Nothing is pinned.";

/** The reason a show attempt failed, or `undefined` when the panel can be shown. */
export function refusalToShow(columns: number, view: PinView): string | undefined {
  if (!panelHasRoom(columns)) return TOO_NARROW;
  if (view.pins.length === 0) return NOTHING_PINNED;
  return undefined;
}
