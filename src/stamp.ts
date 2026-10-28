/**
 * The age of a pin, in the one spelling every drawn surface uses.
 *
 * `formatPinAge` (`time.ts`) is the only thing that spells an age, and this is the only thing the panel calls:
 * the row tails and the frame's arithmetic both need the age, one to draw it and one to charge the text for
 * it, and if either reached for a formatter of its own the two figures could come from two readings of the
 * same `createdAt`. Routed through here, the string a row prints is the string the layout measured — and the
 * module that decides *where* the age is drawn (`panel-row-tail.ts`) never has to know how it is spelled.
 *
 * This module is a leaf: it imports the formatter and the pin's shape, and no panel module. The row tails and
 * the frame's arithmetic both reach the age through it, which is what lets them reach each other without a
 * cycle whose constants are read before their own module has finished evaluating — the failure
 * `panel-tail.ts`'s header records, and the reason the tail's shared halves live beside it rather than in
 * either of their callers.
 */
import { formatPinAge } from "./time.ts";
import type { ViewPin } from "./types.ts";

/**
 * The age of `pin` at `now`, as the one formatter spells it.
 *
 * A function rather than a call at each site so the age a row prints and the tail the frame's reserve is
 * measured on cannot come from two different readings of the pin's `createdAt`.
 */
export function pinAge(pin: ViewPin, now: string): string {
  return formatPinAge(pin.createdAt, now);
}
