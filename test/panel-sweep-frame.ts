/**
 * The bar a swept frame is drawn with, and the pin the sweep asserts on.
 *
 * A swept frame used to be drawn at `selection: 0` with no keys, which made `compact` a permanent carve-out from
 * the character round trip: the cut that excludes it is a property of the *collapsed* entry, not of the flag,
 * and the bar that takes it off the cut is a property of the frame. These helpers are the sweep's side of that,
 * so the carve-out can be asked of the frame rather than guessed from the corpus.
 *
 * Two shapes of view, because the two things the sweep measures need different ones:
 *
 * - **The one-pin view** (`sweptFrameAt`) is what every row-count invariant reads: `rows`/`textRows` of a swept
 *   frame are the whole table, so a companion's rows and its section's headings would be counted as the swept
 *   pin's own. The bar's coordinate is what separates the states here — index 0 names the pin (expanded, once the
 *   frame also takes keys) and an index past the end of the view names no pin, which is the same coordinate an
 *   unfocused panel carries and the collapsed state.
 * - **The two-pin view** (`sweptWideIdFrame`) exists only for the reserve invariant, which a one-pin frame cannot
 *   express: there the view's widest stamp *is* the swept pin's, so the honest limit and the lenient one are equal
 *   by construction. Its bar is parked on the wide warning, where no compact pin of that frame expands.
 */
import { isOptionRow } from "../src/panel-rows.ts";
import type { PanelStyle } from "../src/render.ts";
import type { ViewPin } from "../src/types.ts";
import { LATER, NOW, pin } from "./fixtures.ts";
import { framed } from "./panel-frame.ts";
import type { SweptFrame } from "./panel-wrapped-sweep.ts";
import { sweepStyle } from "./panel-wrapped-sweep.ts";

/** The bar of a one-pin swept frame: on the pin, or at a coordinate that names no pin. */
export type SweepBar = "pin" | "nowhere";

/** The bar's coordinate when it names no pin — what an unfocused panel carries, and the collapsed state. */
const NO_PIN = 1;

/** The swept pin: the view's only `info` pin, which the wide companion of the reserve view never is. */
export const sweptPinOf = (frame: {
  pins: readonly ViewPin[];
}): ViewPin | undefined => frame.pins.find((candidate) => candidate.level === "info");

/** One frame drawn the way the component draws it, with the swept pin's own rows split out of the table. */
function frameOfSweep(
  pins: readonly ViewPin[],
  selection: number,
  width: number,
  focused: boolean,
  style: PanelStyle,
): SweptFrame {
  const { lines, layout } = framed(
    { pins, selection, focused, replyHint: "", ageNow: LATER },
    width,
    style,
  );
  const rows = layout.owned.map((entry) => entry.row);
  return {
    lines,
    pins,
    rows,
    width,
    textRows: rows.filter((row) => !isOptionRow(row)),
    selected: selection === 0 && pins[0]?.level === "info",
    focused,
  };
}

/**
 * The swept pin's own frame, at the bar and focus the caller names.
 *
 * `at`/`focused` together are the expansion signal: the pin is drawn expanded only with the bar on it *and* a
 * frame that takes keys, and collapsed for either answer alone. The view is the one pin, so the table this
 * returns is the swept pin's entry and nothing else.
 */
export function sweptFrameAt(
  id: number,
  text: string,
  width: number,
  extra: Partial<ViewPin> = {},
  at: SweepBar = "nowhere",
  focused = false,
  style: PanelStyle = sweepStyle,
): SweptFrame {
  return frameOfSweep(
    [pin(id, text, "info", { createdAt: NOW, ...extra })],
    at === "pin" ? 0 : NO_PIN,
    width,
    focused,
    style,
  );
}

/**
 * The swept pin's frame with a **wide id beside it**, so the reserve the drawer charges is not the swept row's own.
 *
 * The one-pin view cannot see the bug this fixture exists for: its widest stamp is the swept pin's, so charging
 * each row `min(own, frame)` and charging it the frame's figure were the same arithmetic and the check could not
 * fail — which is how the sweep stayed green over rows the drawer re-cut. Put a twenty-digit id beside a `#1` and
 * the two part company. The wide pin is a `warning`, so `panelSections` draws it first; `selection: 0` names it,
 * which is what the component does with this view and what keeps any compact pin of it collapsed.
 */
export function sweptWideIdFrame(
  id: number,
  text: string,
  width: number,
  extra: Partial<ViewPin> = {},
  style: PanelStyle = sweepStyle,
): SweptFrame {
  const wide = pin(987_654_321_098, "a wide id that owns the frame's reserve", "warning", {
    createdAt: NOW,
  });
  return frameOfSweep(
    [pin(id, text, "info", { createdAt: NOW, ...extra }), wide],
    0,
    width,
    false,
    style,
  );
}
