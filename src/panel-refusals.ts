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
import { panelHasRoom } from "./panel-geometry.ts";

import type { PinView } from "./types.ts";

export const TOO_NARROW = "The pins panel needs at least 100 columns; use /pins.";
export const NOTHING_PINNED = "Nothing is pinned.";

/** The reason a show attempt failed, or `undefined` when the panel can be shown. */
export function refusalToShow(columns: number, view: PinView): string | undefined {
  if (!panelHasRoom(columns)) return TOO_NARROW;
  if (view.pins.length === 0) return NOTHING_PINNED;
  return undefined;
}
