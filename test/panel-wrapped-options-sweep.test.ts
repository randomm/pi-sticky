/**
 * The options half of the width sweep: the rows a pin's options own, at every width the builder closes at.
 *
 * Split out of `panel-wrapped-sweep.test.ts`, which owns the width/ids product for text rows and is at its
 * size cap. These two blocks ask a narrower question — the shared wrap is now the only thing that decides how
 * many rows a pin's options cost, so the sweep checks the *delta* the wrap reports rather than a remembered
 * `+1` — and they pay for it with the same 91 × 143 walk the file above uses.
 *
 * Two things are asserted at once, because only together they mean anything:
 *
 * - **the count is the wrap's** — the frame's option rows are exactly `optionRowCount` of them, so a wrap that
 *   reserved rows the drawer could not fill (or filled rows the window never owned) fails at the width it
 *   started at, rather than three layers up in a frame test;
 * - **the tag, not the pad character, keeps them out of the rejoin** — a reserved row's text is filled by the
 *   drawer at draw time, so the pin's characters must never be charged to it.
 */
import { expect, test } from "bun:test";

import { optionRowCount } from "../src/panel-options-wrap.ts";
import { isOptionRow } from "../src/panel-rows.ts";
import { IDS, WIDTHS } from "./panel-sweep-frame.ts";
import {
  SWEEP_CORPORA,
  carriedCharacters,
  owedCharacters,
  sweepStyle,
  sweptFrame,
} from "./panel-wrapped-sweep.ts";

/** The options the row-count sweep gives each pin; two labels a roomy frame packs onto one row. */
const OPTIONS_UNDER_SWEEP = ["Passed on", "Not yet"];

test("the options rows the table reserves are the rows the wrap draws, and are excluded from the rejoin by their tag", () => {
  // The row-count promise the options half of the fix must not disturb, restated against the thing that now
  // decides it: the pin owns *as many rows as the shared wrap needs at this frame's inner width* — one at a
  // roomy frame, more once the labels will not close inside one — and it is the *tag* on each of them, not the
  // pad character, that keeps them out of the rejoin. Comparing against `optionRowCount` rather than against a
  // literal `+1` is what makes this the wrap's test and not a second opinion about it: a wrap that started
  // counting rows the drawer could not fill would fail here at the width it started at, and a wrap that went
  // back to one row would fail at the widths where four labels plainly need more.
  for (const width of WIDTHS) {
    // The baseline frame does not depend on the id: the row table's height for one pin whose text is
    // `SWEEP_CORPORA[0]` is the same whatever number stamps it, so it is built once per width and compared
    // against each id's `withOptions` frame. This keeps the row-count delta, the tag exclusion and the rejoin
    // under test at every id while halving the frames this sweep draws.
    const plain = sweptFrame(IDS[0] ?? 1, SWEEP_CORPORA[0]?.[1] ?? "", width);
    for (const id of IDS) {
      const withOptions = sweptFrame(id, SWEEP_CORPORA[0]?.[1] ?? "", width, {
        options: OPTIONS_UNDER_SWEEP,
      });
      expect(withOptions.rows.length).toBe(
        plain.rows.length + optionRowCount(OPTIONS_UNDER_SWEEP, width, sweepStyle),
      );
      const reserved = withOptions.rows[withOptions.rows.length - 1];
      expect(withOptions.textRows).not.toContain(reserved ?? null);
      // The rejoin sees the pin's text and nothing of the row the drawer fills.
      expect(carriedCharacters(withOptions)).toBe(owedCharacters(SWEEP_CORPORA[0]?.[1] ?? ""));
    }
  }
});

test("four long options own one row apiece at the widths where they cannot share one", () => {
  // The shape the single-row drawer could not express: labels that will not close inside a row are packed onto
  // the rows below rather than dropped, so the count grows with the labels and the window scrolls past all of
  // them. At 40 columns four `MAX_FIELD_GRAPHEMES` labels cannot share a row, and the reserve the pin's own
  // text rows give up is *not* charged to them — the options rows carry no tail, so they are packed against
  // the frame's full inner width, which is the whole reason four of them do not need four rows everywhere.
  const wide = ["Passed on", "Not yet", "Escalated to the on-call", "Deferred to next quarter"];
  for (const width of [40, 33]) {
    const frame = sweptFrame(1, "short", width, { options: wide });
    expect(frame.rows.filter(isOptionRow).length).toBe(optionRowCount(wide, width, sweepStyle));
    expect(frame.rows.filter(isOptionRow).length).toBeGreaterThan(1);
    // The text of the pin is still whole, whatever the rows beneath it cost.
    expect(carriedCharacters(frame)).toBe(owedCharacters("short"));
  }
});
