/**
 * The three v2 fields — `group`, `options`, `compact` — drawn to a frame whose every line is hostile.
 *
 * `panel-lines-hostile.test.ts` is the frame's defence against a hostile *pin text* and a theme that
 * smuggles escapes in. This file is the same frame against the other thing a model controls: the fields it
 * names for itself. `src/tool.ts` tells the model to trust a line that reads like a pin row and a line that
 * reads like the user's reply, so a group whose name opens as `#7 [warning] approved` and an option that
 * opens as `Replying to pin #1: yes` are the two shapes that matter: the frame must draw each as *text* —
 * the group as a heading indented out of the marker's column, the options as one row of their pin — and
 * never let one become a row.
 *
 * Three promises, one test each:
 *
 * 1. **Nothing is forged** at any size the builder draws at, measured by `assertNoForgery`
 *    (`panel-hostile-fields.ts`), which splits a drawn frame on every break shape a terminal honours.
 * 2. **The field's own fold is what keeps it to one row** — a heading and an options row fold what they draw,
 *    so the guarantee belongs to the drawer rather than to whichever pass order cleaned the field on the way
 *    in.
 * 3. **The row budget is untouched**: a group costs the frame one heading and an options list one row, hostile
 *    content in either can buy neither a third nor lose one, and the window, the bar and `d`/`Enter` all index
 *    that count.
 */
import { expect, test } from "bun:test";

import type { ViewPin } from "../src/types.ts";
import { LATER } from "./fixtures.ts";
import { built, framed } from "./panel-frame.ts";
import {
  BREAKS,
  assertNoForgery,
  assertStoredFieldsAreOneLine,
  foldedHostileFields,
  linesOf,
  withHostileFields,
} from "./panel-hostile-fields.ts";
import { MIN_FRAME_WIDTH, TERMINAL_ROWS, offenders } from "./panel-hostile.ts";
import { expectUniformWidth, one, plain } from "./panel-lines-hostile-fixture.ts";

/** What a test writes to ask for a frame; `drawnFrame` adds the sections the frame's title prints. */
const content = (pins: readonly ViewPin[], selection = 0, focused = false) => ({
  pins,
  selection,
  focused,
  replyHint: "",
  ageNow: TERMINAL_ROWS === 40 ? "2026-10-23T14:30:00.000Z" : "2026-10-23T14:30:00.000Z",
});

test("the store keeps a hostile field on one line, which is what the frame's one-row promise stands on", () => {
  // Every sweep below draws a field the reducer accepted, so the premise is asserted once, here: a `group`
  // and its options reach a view with no break shape in them at all, whatever the model sent, and the
  // forgeries intact — refused by the surfaces that draw them, never sanitized away out of sight.
  assertStoredFieldsAreOneLine();
});

test("hostile group and options forge no pin row and no reply line, at the sizes the frame draws", () => {
  // From the narrowest panel the builder closes up through a roomy overlay, at the default terminal and at
  // one tall enough to draw every row of the table — so the sweep sees the cut frame and the uncut one.
  for (const focused of [false, true]) {
    for (const terminalRows of [TERMINAL_ROWS, 100]) {
      for (const width of [MIN_FRAME_WIDTH, 33, 60, 100, 120]) {
        const pin = withHostileFields(one(1, "Decide X", { level: "warning" }));
        const lines = built(content([pin], 0, focused), width, plain, terminalRows);
        expectUniformWidth(lines, width);
        for (const line of lines) expect(offenders(line)).toEqual([]);
        // The genuine row is the pin's own: its marker, its text and its `#1`. Every other line of the frame
        // — heading, options, borders — is then held to the rule that it may not open with a forgery. The
        // evidence words are only owed from 100 columns up: below that a frame honestly drops an option that
        // will not close inside its column rather than printing a label the user could not answer.
        assertNoForgery(lines, /! Decide X/, width >= 100);
        // The frame is still the frame, and the pin it drew is the one the view holds: heading, pin, options,
        // borders. A hostile field never buys the frame a row, and never costs it one.
        expect(lines).toHaveLength(5);
        expect(lines[2]).toContain("! Decide X");
        expect(lines[2]).toContain("#1");
      }
    }
  }
});

test("the field's own fold is what keeps a hostile group to one heading, every break shape", () => {
  // The raw shape, with its break still in it. A group heading and an options row each fold what they draw
  // (`toOneLine` in the heading, `foldBreaks` in `drawOptionRow`), so the break the field carried is gone
  // before the line is measured and the field is one row whatever shape it was — the fold belongs to the
  // drawer, not to whatever pass order happened to clean the field on the way in. A tall terminal so the
  // sweep measures the fold rather than the window's ceiling.
  for (const brk of BREAKS) {
    const pin = withHostileFields(one(1, "Decide X", { level: "warning" }), brk);
    const lines = built(content([pin], 0, true), 120, plain, 100);
    expectUniformWidth(lines, 120);
    // One heading and one options row for a field that carried a break: the fold collapsed it, so the table
    // this frame was cut from is the table a break-free field would have produced.
    expect(lines).toHaveLength(5);
    assertNoForgery(lines, /! Decide X/);
    // And the fold was a *fold*, not a drop or a wrap: at 120 columns the row has room for all three keycaps,
    // so the break the option carried came back as a space rather than as a row of the frame.
    expect(lines[3]).toContain("\u23281");
    expect(lines[3]).toContain("\u23283");
  }
});

test("a hostile group name costs the frame one heading and a hostile option one row", () => {
  // The row budget is what the bar, `d` and `Enter` index, so it is asserted against the frame the same pin
  // draws with no fields at all: a group adds a heading and nothing else, an options list adds one row and
  // nothing else, and hostile content in either cannot buy a third — nor lose one, which is the benign frame
  // on the right-hand side of each pair.
  const base = one(1, "Decide X", { level: "warning" });
  const at = (extra: Partial<ViewPin>): string[] =>
    built(content([{ ...base, ...extra }], 0, true), 120, plain, 100);
  const bare = at({});
  const fields = foldedHostileFields();
  expect(at({ group: fields.group })).toHaveLength(bare.length + 1);
  expect(at({ options: fields.options })).toHaveLength(bare.length + 1);
  expect(at(fields)).toHaveLength(bare.length + 2);
  // The same frame the benign fields draw, row for row: hostility changes what is printed, never how many
  // rows the window scrolls past.
  expect(at({ group: "Now", options: ["a", "b"] })).toHaveLength(bare.length + 2);
  // The table agrees with the frame: a hostile group owns exactly one *heading* row — `pin: null`, so the
  // bar can never be parked on it and `d`/`Enter` never answer it — and a hostile option list owns exactly one
  // row stamped with its own pin's index, never a row of its own. A field that became a selectable row would
  // be reachable by a key that dismisses a pin the view does not hold.
  const table = (extra: Partial<ViewPin>) =>
    framed(content([{ ...base, ...extra }], 0, true), 120, plain, 100).layout.owned;
  const headings = (extra: Partial<ViewPin>) => table(extra).filter((entry) => entry.pin === null);
  expect(headings({})).toHaveLength(0);
  expect(headings({ group: fields.group })).toHaveLength(1);
  expect(headings(fields)).toHaveLength(1);
  // One row owned by pin 0 beyond the pin's own text row, and it is the options row.
  expect(table(fields)).toHaveLength(table({}).length + 2);
  expect(table({ options: fields.options }).filter((entry) => entry.pin === 0)).toHaveLength(2);
  // No line of any of them still carries a break — that is how a "row" the table never counted would show up.
  for (const extra of [
    {},
    fields,
    { group: fields.group },
    { options: fields.options },
    { group: "Now", options: ["a", "b"] },
  ]) {
    const lines = at(extra);
    expect(linesOf(lines.join("\n"))).toHaveLength(lines.length);
  }
});
