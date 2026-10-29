/**
 * The two helpers every `reconstruct`-of-an-untrusted-snapshot test shares, extracted so the surface
 * split across `state-untrusted.test.ts` (sanitizing, guard refusals, copies) and
 * `state-untrusted-fields.test.ts` (the three optional pins-v2-5 fields) holds each of them once.
 *
 * `drawn` is the load-bearing half. A snapshot is only dangerous in what it can put on
 * the screen, so the assertion a hostile entry has to answer for is on every string the surfaces draw
 * for the state it built — the listing, the model-facing `/pins` text and the rail — at a width that
 * forces a cut so pi-tui's own ellipsis appears in the output (the header is included for that reason:
 * `truncateToWidth` cuts on grapheme boundaries, so the leading 📌 is never split and a lone surrogate
 * half has to be reported). Break shapes are `drawnBreaks` beside it, and a sweep that owes both asserts
 * the two together. The forbidden code points themselves belong to `panel-hostile.ts`, which holds the
 * one copy of `offenders` and is imported from there directly, not through here.
 *
 * `drawn` refuses to return nothing for a state that has pins. A sweep of an empty list passes every
 * assertion in the file — `offenders` of nothing is `[]` — and the guard below is not enough to tell that
 * apart from a real board: an empty state is itself a state `isPinState` accepts. So `drawn` also refuses
 * a rebuild that kept pins and drew no row for them.
 */
import { renderRailLines } from "../src/rail-lines.ts";

import { plainStyle, renderList, renderPinsText } from "../src/render.ts";
import { isPinState } from "../src/state-guards.ts";
import { reconstruct } from "../src/state.ts";
import type { PinState } from "../src/types.ts";
import { customEntry } from "./fixtures.ts";

/** The rail budget `drawn` asks for: header plus one row per pin, up to seven rows. */
const RAIL_BUDGET = 8;

/** Every string the surfaces draw for a state, as one list to sweep. */
export function drawn(state: PinState): string[] {
  // The guard runs before the surfaces are asked: `reconstruct` skips a snapshot `isPinState` refuses,
  // so without it a state no reader could produce would still sweep clean rows of an empty board.
  if (!isPinState(state)) throw new Error("drawn() was handed a state no reader would accept");
  const result = reconstruct([customEntry(state)], []);
  const lines = [
    renderList(result.view, 5),
    renderPinsText(result.view),
    ...renderRailLines(result.view, 20, { maxLines: RAIL_BUDGET, style: plainStyle }),
  ];
  // A state that has pins but draws none of them is not an empty sweep, it is a broken one: the caller's
  // `for (const text of drawn(…))` would then assert on nothing, and an empty state — the shape a skipped
  // snapshot leaves — is itself a state the guard above accepts. So each pin of the rebuilt state has to
  // appear under the marker all three surfaces put first: `#<id>` is on the listing row, the `/pins` row
  // and the rail row alike, so it is present exactly when the pin was drawn and absent when a surface or a
  // rebuild dropped it.
  // The rail caps its rows at `RAIL_BUDGET`, so nine pins legitimately draw a `+2 more` row in their
  // place; the per-pin floor is only owed up to that cap. Past it, the marker check above is what decides.
  const pins = result.state.pins;
  const owed = Math.min(pins.length, RAIL_BUDGET - 1);
  if (owed > 0 && lines.length < 1 + owed) {
    throw new Error(
      `drawn() drew ${lines.length} line(s) for ${pins.length} pin(s): the sweep would pass on nothing`,
    );
  }
  for (const pin of pins) {
    if (lines.some((line) => line.includes(`#${pin.id}`))) continue;
    throw new Error(`drawn() drew no #${pin.id}: the sweep would pass on a pin nobody shows`);
  }
  return lines;
}

/**
 * The break-shape half of the drawn sweep, for the caller that owes that promise. The code points are
 * private to this helper: `panel-hostile.ts` owns the escape and control list, and a second exported
 * list of code points is one more thing that could drift from it.
 */
const BREAK_CODES = [0x0d, 0x85, 0x2028, 0x2029];

export function drawnBreaks(text: string): string[] {
  const found: string[] = [];
  for (const code of BREAK_CODES) {
    if (text.includes(String.fromCodePoint(code))) found.push(`0x${code.toString(16)}`);
  }
  return found;
}
