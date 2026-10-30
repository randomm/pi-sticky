/**
 * `compact` — the third optional field — drawn hostile, at the bar and off it, and the row budget it owns.
 *
 * `panel-fields-hostile.test.ts` certifies `group` and `options`: neither buys a row the table did not count.
 * This file is the same frame and the same hostile fields for the field that *does* change the row count, which
 * is the reason every sweep next door parks the bar at the frame's resting coordinate.
 *
 * `compact` changes the count twice over. While the frame keeps the pin collapsed it is one cut row — a hold on
 * the wrap, not a row the table adds or loses. Since #63 the same pin is the pin the bar rests on in a frame
 * that takes keys, and then it owns its full entry: the wrap's rows and the options packer's rows. Both counts
 * are asserted here against the product's own figures rather than numbers this file remembers — the collapsed
 * count against the same pin with no fields at all plus the packer's answer for its labels, the expanded count
 * against the same pin without the flag at the same coordinate.
 *
 * The two states are never compared to each other for equality: the flag's whole point is that those tables
 * differ. What is compared is that *hostility* changes neither — a hostile group heading buys no row over the
 * ungrouped one's and hostile labels buy no row beyond the packing's own answer, in either state.
 */
import { expect, test } from "bun:test";

import { optionRowCount } from "../src/panel-options-wrap.ts";
import type { ViewPin } from "../src/types.ts";
import { LATER } from "./fixtures.ts";
import { built, framed } from "./panel-frame.ts";
import { assertNoForgery, foldedHostileFields, linesOf } from "./panel-hostile-fields.ts";
import { drawnOffenders, offenders } from "./panel-hostile.ts";
import { expectUniformWidth, one, plain } from "./panel-lines-hostile-fixture.ts";
import { levelPin } from "./panel-sections-fixture.ts";

/** What a test writes to ask for a frame; `drawnFrame` adds the sections the frame's title prints. */
const content = (pins: readonly ViewPin[], selection: number, focused: boolean) => ({
  pins,
  selection,
  focused,
  replyHint: "",
  ageNow: LATER,
});

/** The pin's text: `assertNoForgery`'s genuine-row pattern names it, so the marker stays `! Decide X`. */
const DECIDE = "Decide X";

/**
 * A text the 120-column frame cannot hold on one row.
 *
 * `compact` collapses a *wrapping* text; a pin whose text already fits is the same row table with or without the
 * flag, and every assertion below would then be counting rows no rule ever changed.
 */
const WRAPS = `The lens-fix pass on the worktree reported a clean tree and then the driver re-ran the whole
offline suite for no reason anyone could name, so the park fix has to land before the next cycle. ${DECIDE}`;

/** The pin under test: a warning carrying the field(s) of the case, at the text the frame cannot hold. */
const pinWith = (extra: Partial<ViewPin> = {}): ViewPin => ({
  ...levelPin(1, DECIDE, "warning"),
  text: WRAPS,
  ...extra,
});

/** The ungrouped fact beside it: two drawn sections, so the group's heading is a row that can be charged. */
const companion = (): ViewPin => one(2, "a plain note");

/** The rows a pin's options pack to at this frame — the drawer's own packing, not a remembered count. */
const optionRows = (options: string[]): number => optionRowCount(options, 120, plain);

/** The frame's two bar states: the layout reads the drawn focus beside the selection as one signal. */
const AT_BAR = true;
const OFF_BAR = false;

const at = (extra: Partial<ViewPin>, atBar: boolean): string[] =>
  built(content([pinWith(extra), companion()], 0, atBar), 120, plain, 100);
const tableAt = (extra: Partial<ViewPin>, atBar: boolean) =>
  framed(content([pinWith(extra), companion()], 0, atBar), 120, plain, 100);

/** The pin's own text rows in the table: the options rows are reserved, not written, so they are not counted. */
const textRowsOf = (extra: Partial<ViewPin>, atBar: boolean): number =>
  tableAt(extra, atBar).layout.owned.filter(
    (entry) => entry.pin === 0 && entry.row.kind === undefined,
  ).length;

test("off the bar a hostile compact pin owns one cut row and the options rows its labels pack to", () => {
  const fields = foldedHostileFields();
  // The frame a `compact` pin with no fields at all draws at the same coordinate, plus exactly the rows its
  // labels pack to: one cut text row and nothing else from the group. A cut is not a row, and a hostile field
  // cannot make the collapsed entry taller.
  expect(at({ compact: true, ...fields }, OFF_BAR)).toHaveLength(
    at({ compact: true }, OFF_BAR).length + optionRows(fields.options),
  );
  // The same collapsed frame, byte for byte, whatever the fields' contents: hostility is refused by drawing a
  // field as text, not by drawing fewer or more rows.
  expect(at({ compact: true, ...fields }, OFF_BAR)).toEqual(
    at({ compact: true, group: fields.group, options: fields.options }, OFF_BAR),
  );
  // No line of it carries a break — the shape a "row" the table never counted would take — and nothing in it is
  // a row or a reply the extension did not make.
  const collapsedLines = at({ compact: true, ...fields }, OFF_BAR);
  expect(linesOf(collapsedLines.join("\n"))).toHaveLength(collapsedLines.length);
  assertNoForgery(collapsedLines, /! Decide X/);
  // And the entry is really collapsed: one row of the pin's own text, however long that text is. Without this
  // the two comparisons above could be two expanded frames agreeing with each other and certify nothing.
  expect(textRowsOf({ compact: true, ...fields }, OFF_BAR)).toBe(1);
});

test("under the bar a hostile compact pin is the frame the same pin draws without the flag", () => {
  const fields = foldedHostileFields();
  // The expansion hands the row table the ordinary wrap and the options packer's own rows; a hostile group or
  // option adds no third of either. Deliberately *not* compared against the collapsed frame above: the flag's
  // whole point is that those two tables differ, and the row the collapsed pin cuts reappears here.
  expect(at({ compact: true, ...fields }, AT_BAR)).toEqual(at({ ...fields }, AT_BAR));
  // Which is to say the expansion really did buy rows: the frame at the bar is taller than the same frame off
  // it, and the rows it gained belong to the pin — stamped with its index, never `pin: null`, which is what a
  // heading wears and what the bar could never reach or `d` dismiss.
  const expanded = tableAt({ compact: true, ...fields }, AT_BAR);
  const resting = tableAt({ compact: true, ...fields }, OFF_BAR);
  expect(expanded.layout.owned.length).toBeGreaterThan(resting.layout.owned.length);
  expect(textRowsOf({ compact: true, ...fields }, AT_BAR)).toBeGreaterThan(1);
  const gained =
    expanded.layout.owned.filter((entry) => entry.pin === 0).length -
    resting.layout.owned.filter((entry) => entry.pin === 0).length;
  expect(gained).toBeGreaterThan(0);
  expect(expanded.layout.owned.filter((entry) => entry.pin === null)).toHaveLength(
    resting.layout.owned.filter((entry) => entry.pin === null).length,
  );
  // The extra rows are drawn, not merely counted: every line of both frames closes at the frame's width, the
  // promise a flush-right overlay makes and the one a row the table did not count breaks.
  expectUniformWidth(expanded.lines, 120);
  expectUniformWidth(resting.lines, 120);
  assertNoForgery(expanded.lines, /! Decide X/);
  assertNoForgery(resting.lines, /! Decide X/);
});

test("the expanded rows carry no escape, no control and no break, at every hostile field", () => {
  // The expansion is the one branch of the row table that draws *more* of a model's words than any other
  // surface: the whole wrapped text of the pin, where every other frame cuts it to one line. A cut row that
  // leaked a byte leaks one row's worth; an expanded entry leaks a paragraph's. So the forgery sweep above —
  // which asks whether a field became a row — is not the whole check: this one asks whether any byte of the
  // drawn entry can steer the terminal, and it is asked at the expanded state rather than only at the
  // collapsed one the rest of the file's sweeps are parked at.
  const fields = foldedHostileFields();
  const drawn = at({ compact: true, ...fields }, AT_BAR);
  // Every row of the frame, borders included: no escape byte, no C0/C1 control, no DEL, no bidi override and
  // no lone surrogate anywhere. The untrusted text is drawn with identity colours here, so there is no SGR for
  // the classifier to excuse — a byte in this frame was written by the pin, not by the theme.
  for (const line of drawn) expect(offenders(line)).toEqual([]);
  // …and the same rows through a theme that *does* colour: an SGR sequence is what the panel is allowed to
  // draw, and everything else in the classifier's other set still is not.
  for (const line of at({ compact: true, ...fields }, AT_BAR))
    expect(drawnOffenders(line)).toEqual([]);
  // No line of the expanded frame contains a break shape: an entry that wrapped by *breaking* is a frame whose
  // rows are not the rows the table counted, and the bar, `d` and `Enter` would be one out per break.
  const joined = at({ compact: true, ...fields }, AT_BAR).join("\n");
  expect(linesOf(joined)).toHaveLength(at({ compact: true, ...fields }, AT_BAR).length);
  // The expanded rows are the pin's own — the table's owner tags carry that, and it is what keeps a forged
  // row unreachable: the bar can only be parked on an entry the frame numbered, and `d` can only dismiss one.
  const atBar = tableAt({ compact: true, ...fields }, AT_BAR).layout.owned;
  const grew = atBar.filter((entry) => entry.pin === 0 && entry.row.kind === undefined);
  expect(grew.length).toBeGreaterThan(1);
  for (const entry of grew) {
    expect(offenders(entry.row.text)).toEqual([]);
    expect(offenders(entry.row.tail)).toEqual([]);
  }
});
