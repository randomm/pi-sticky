/**
 * The three optional fields — `group`, `options`, `compact` — drawn to a frame whose every line is hostile.
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
 *
 * Promise 3 is measured at the bar's **resting** position, selection 0, in every sweep below. That coordinate is
 * part of the promise and not an oversight: since #63 a `compact` pin the bar rests on in a frame that takes
 * keys draws its full entry, so a row-count sweep parked on the pin would have been counting an *expanded*
 * entry — the row count of a second rule the sweep has no business certifying, and one whose count is the wrap's
 * answer rather than the field's. Either off-selection counts (`selection` naming no pin) or the expanded row
 * count, spelled out, are what these counts may be. `at()` fixes the coordinate for the whole file, so the
 * counts below are the collapsed entry's; the expanded half of the promise is `panel-hostile-compact.test.ts`,
 * which drives the same fields with the bar *on* the pin and asserts the forgery sweep at that row count.
 *
 * Promise 3 is measured against a frame that has a *heading to lose*: one section draws no heading at all
 * (spec 3.5), so every sweep below pairs the grouped pin with a plain ungrouped fact of another level. Two
 * drawn sections are both headed, and then a hostile group name really does cost the frame its one heading
 * row — which is the row the promise is about.
 */
import { expect, test } from "bun:test";

import { optionRowCount } from "../src/panel-options-wrap.ts";

import type { ViewPin } from "../src/types.ts";
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
import { levelPin } from "./panel-sections-fixture.ts";

/** What a test writes to ask for a frame; `drawnFrame` adds the sections the frame's title prints. */
const content = (pins: readonly ViewPin[], selection = 0, focused = false) => ({
  pins,
  selection,
  focused,
  replyHint: "",
  ageNow: TERMINAL_ROWS === 40 ? "2026-10-23T14:30:00.000Z" : "2026-10-23T14:30:00.000Z",
});

/** The pin's text every row-count comparison below holds constant while the fields move. */
const DECIDE = "Decide X";

/**
 * The pin the sweeps draw: the text every row count is measured over, plus whatever field is under test.
 *
 * Built through `levelPin` so this file's sweeps and the compact half of the promise
 * (`panel-fields-hostile-compact.test.ts`) mint the same shape, and so the marker `assertNoForgery`'s
 * genuine-row pattern names stays `! Decide X` whichever field is bolted on.
 */
const fieldPin = (extra: Partial<ViewPin> = {}): ViewPin => ({
  ...levelPin(1, DECIDE, "warning"),
  ...extra,
});

/**
 * The ungrouped fact every sweep draws beside the grouped pin.
 *
 * A view whose every pin carries one group is *one* drawn section, and a single section draws no heading
 * (spec 3.5) — so a single-pin view would have no heading row for a hostile group name to fail to add, and
 * the row-count promise below would be measuring nothing. One plain fact of another level makes two drawn
 * sections, both headed.
 */
const companion = (): ViewPin => one(2, "a plain note");

/** The same frame with the *same* fields cleaned: one line each, no forgery in them. */
const benign = (width: number, terminalRows: number, focused: boolean): string[] => {
  const fields = foldedHostileFields();
  const pin = one(1, DECIDE, { level: "warning", ...fields });
  return built(content([pin, companion()], 0, focused), width, plain, terminalRows);
};

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
        const pin = withHostileFields(fieldPin());
        const lines = built(content([pin, companion()], 0, focused), width, plain, terminalRows);
        expectUniformWidth(lines, width);
        for (const line of lines) expect(offenders(line)).toEqual([]);
        // The genuine row is the pin's own: its marker, its text and its `#1`. Every other line of the frame
        // — heading, options, borders — is then held to the rule that it may not open with a forgery. The
        // evidence words are only owed from 100 columns up: below that a frame honestly drops an option that
        // will not close inside its column rather than printing a label the user could not answer.
        assertNoForgery(lines, /! Decide X/, width >= 100);
        // The frame is still the frame, and the pin it drew is the one the view holds: the two sections'
        // headings, the grouped pin, its options row or rows, the companion's row, borders. A hostile field
        // never buys the frame a row, and never costs it one. The row count is not asserted here as a number
        // to remember: the options wrap to as many rows as their labels need at the frame's text width, so a
        // literal count would be the wrap's assertion (`test/panel-field-rows.test.ts`), not this one. What is
        // asserted is that the frame is the same frame the *benign* version of the same fields draws, row for
        // row — hostility changes what is printed, never how many rows there are.
        expect(lines).toEqual(benign(width, terminalRows, focused));
        // The pin's own row, whichever glyph stands in its marker column: focused, the bar sits on it and the
        // panel draws its own selection marker there instead of the warning's `!` (#70 decision 2).
        expect(lines[2]).toContain("Decide X");
        expect(lines[2]).toContain("#1");
      }
    }
  }
});

test("the field's own fold is what keeps a hostile group to one heading, every break shape", () => {
  // The raw shape, with its break still in it. A group heading and an options row each fold what they draw
  // (`foldBreaks` in the heading and in `drawOptionRow`), so the break the field carried is gone
  // before the line is measured and the field is one row whatever shape it was — the fold belongs to the
  // drawer, not to whatever pass order happened to clean the field on the way in. A tall terminal so the
  // sweep measures the fold rather than the window's ceiling.
  for (const brk of BREAKS) {
    const pin = withHostileFields(fieldPin(), brk);
    const lines = built(content([pin, companion()], 0, true), 120, plain, 100);
    expectUniformWidth(lines, 120);
    // One heading and one options row for a field that carried a break: the fold collapsed it, so the table
    // this frame was cut from is the table a break-free field would have produced. Asserted against that
    // frame rather than a remembered number, because the options row count is the wrap's answer at this width
    // (`test/panel-field-rows.test.ts`), not this test's.
    expect(lines).toEqual(benign(120, 100, true));
    assertNoForgery(lines, /! Decide X/);
    // And the fold was a *fold*, not a drop or a wrap: at 120 columns the row has room for all three digits,
    // so the break the option carried came back as a space rather than as a row of the frame.
    expect(lines[3]).toContain("1 ");
    expect(lines[3]).toContain("3 ");
  }
});

test("a hostile group name costs the frame one heading and a hostile option list the options rows", () => {
  // The row budget is what the bar, `d` and `Enter` index, so it is asserted against the frame the same pin
  // draws with no fields at all, and against a view with **two** drawn sections: one section draws no heading
  // (spec 3.5), so a lone grouped pin has no heading row to charge for and the group half of the promise would
  // be measuring nothing. A group adds the heading it is entitled to and nothing else; an options list adds
  // the rows its labels wrap to and nothing else; hostile content in either buys neither a further row nor
  // loses one.
  const base = fieldPin();
  const at = (extra: Partial<ViewPin>): string[] =>
    built(content([{ ...base, ...extra }, companion()], 0, true), 120, plain, 100);
  const bare = at({});
  const fields = foldedHostileFields();
  // The group *replaces* the level heading over its own pin rather than adding a row: the pin moves out of
  // `Warnings` and into the group's section, which owns the one heading instead. So a group is charged for
  // the heading it draws, not for a second one — and an options list, which adds no heading of its own, is
  // what buys the extra row here.
  expect(at({ group: fields.group })).toHaveLength(bare.length);
  // The number the options add is *the wrap's* answer at this frame's inner width, not a remembered `+1`: the
  // labels here are long enough to need a row of their own, and the count that buys them is the count the
  // drawer fills (`optionRowCount`, `panel-options-wrap.ts`), read at the same width the frame draws at.
  const optionRows = (options: string[]): number => optionRowCount(options, 120, plain);
  expect(at({ options: fields.options })).toHaveLength(bare.length + optionRows(fields.options));
  expect(at(fields)).toHaveLength(bare.length + optionRows(fields.options));
  // The same frame the benign fields draw, row for row: hostility changes what is printed, never how many
  // rows the window scrolls past.
  expect(at({ group: "Now", options: ["a", "b"] })).toHaveLength(
    bare.length + optionRows(["a", "b"]),
  );
  // The table agrees with the frame: a hostile group owns a *heading* row — `pin: null`, so the bar can never
  // be parked on it and `d`/`Enter` never answer it — and a hostile option list owns rows stamped with its
  // own pin's index, never a row of its own. A field that became a selectable row would be reachable by a key
  // that dismisses a pin the view does not hold.
  const table = (extra: Partial<ViewPin>) =>
    framed(content([{ ...base, ...extra }, companion()], 0, true), 120, plain, 100).layout.owned;
  const headings = (extra: Partial<ViewPin>) => table(extra).filter((entry) => entry.pin === null);
  // Two drawn sections — the grouped pin's and the companion's level — so two headings, and one of them is
  // the group's. A view whose only drawn section is a group has none at all (spec 3.5), which is why the
  // companion is in every frame here.
  expect(headings({})).toHaveLength(2);
  expect(headings({ group: fields.group })).toHaveLength(2);
  expect(headings(fields)).toHaveLength(2);
  // The options rows are owned by pin 0 beyond the pin's own text row, and the frame charges exactly that
  // many: the count the window scrolls past is the count the drawer fills. One row for the pin's text, that
  // many more for its options, and the headings are the rows that belong to no pin.
  const optionRowsOf = (extra: Partial<ViewPin>) =>
    table(extra).filter((entry) => entry.pin === 0).length - 1;
  expect(optionRowsOf(fields)).toBeGreaterThanOrEqual(1);
  expect(table(fields)).toHaveLength(table({}).length + optionRowsOf(fields));
  expect(table({ options: fields.options }).filter((entry) => entry.pin === 0)).toHaveLength(
    optionRowsOf({ options: fields.options }) + 1,
  );
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
