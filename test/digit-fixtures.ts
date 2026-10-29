/**
 * The digit-edged shapes of the pin fields and their stamps — the inputs no other fixture carries.
 *
 * The edge trim of `cleanPinText` once interpolated CR (0x0d) into its character class as the *number*,
 * so the class held the characters "1" and "3" and every field the readers re-clean lost a digit per
 * pass: a group lost its tail, an all-digit option list emptied and dropped the whole `options` key, and
 * a stamp ending in a digit was cut. The suite's own ISO stamp ends in `Z`, which is why no existing
 * fixture could show it, so these fixtures exist only to be cut off at the edge.
 *
 * They live here rather than in `fixtures.ts` because that file is the shared baseline the drawn and
 * snapshot suites compare against and stays byte-identical to main; a digit-bearing fixture is a case,
 * not part of that baseline.
 */
import type { Pin, PinState } from "../src/types.ts";
import { NOW, pin, removal } from "./fixtures.ts";

/** An ISO stamp ending in a digit rather than the `Z` every other fixture ends in. */
export const NOW_DIGIT = `${NOW.slice(0, -1)}3`;

/** The digit-edged shapes of the three optional fields, as the tool receives them. */
export const DIGIT_GROUP = "Backlog 1";
export const DIGIT_OPTIONS = ["Plan 1", "Plan 3"];
/** Options that are nothing but digits — the shape that used to clean to `""` and empty the list. */
export const DIGIT_ONLY_OPTIONS = ["1", "3"];

/**
 * A pin whose text, group, options and both timestamps end in a digit: the shape no fixture had, for the
 * readers that re-clean every string.
 */
export function digitPin(id = 1): Pin {
  return {
    ...pin(id, `Ship ${id}`, "warning", { createdAt: NOW_DIGIT, updatedAt: NOW_DIGIT }),
    group: DIGIT_GROUP,
    options: [...DIGIT_OPTIONS],
    compact: true,
  };
}

/**
 * A coherent snapshot made of nothing but digit-edged strings, including a removal addressed to the same
 * digit-edged stamp. `nextId` clears both ids, so it passes `isPinState`.
 */
export function digitState(): PinState {
  return { v: 1, pins: [digitPin(1)], nextId: 3, removed: [removal(2, "user", NOW_DIGIT)] };
}
