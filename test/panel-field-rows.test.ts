/**
 * The rows the row table gives a pin that carries `group`, `options` or `compact`, and what the drawer makes
 * of them.
 *
 * Two halves, and both are the *table's* business rather than the drawer's: the number of rows a pin owns is
 * decided before anything is measured (the scroll window, the selection bar and `d`/`Enter` all index that
 * count), and the frame only fills in the text of the rows the table reserved.
 *
 * - `group` costs the table nothing — the group is a heading over the section, not a row of the pin — so a
 *   grouped pin owns exactly the rows an ungrouped one does.
 * - `options` reserve exactly one row, whatever the labels, and the drawer fills it at the frame's width.
 * - `compact` collapses the wrap to one row. It is the model's word for "do not spend the window on this one"
 *   and it changes what the *table* holds, so it is stamped in the table rather than cut later: a pin that
 *   wrapped into four rows and was then cut to one would leave the window, the bar and the keys counting
 *   four.
 *
 * `compact` holds at the bar *except* on the one row the user is looking at: the row table expands a compact
 * pin to its full text and its options rows when the caller names it as the selected pin of a focused frame
 * (`ExpandedAt`), and draws it collapsed for every other pin and for every caller that names no selection —
 * the peek and the rail among them. The expansion is the caller's argument, not a cell this module reads, so
 * the collapsed table is the one built before the bar moved and the expanded one is built for the frame the
 * bar is drawn in: the two are the same function at the same width, and only the rows the drawer fills — and
 * the keys, which index this very count — can differ.
 */
import { expect, test } from "bun:test";

import type { ExpandedAt } from "../src/panel-expand.ts";
import { widestMetaColumns } from "../src/panel-frame-geometry.ts";
import { ELLIPSIS } from "../src/panel-frame.ts";
import { NO_PANEL_COLOUR } from "../src/panel-host.ts";
import { optionLine } from "../src/panel-options-row.ts";
import { optionRowCount } from "../src/panel-options-wrap.ts";
import { isOptionRow, panelPinRows } from "../src/panel-rows.ts";
import { GUTTER_COLUMNS } from "../src/panel-tail.ts";
import type { PanelStyle } from "../src/render.ts";
import { plainStyle } from "../src/render.ts";
import type { ViewPin } from "../src/types.ts";
import { innerAt } from "./panel-rows-frame.ts";
import { levelPin } from "./panel-sections-fixture.ts";

const style: PanelStyle = { ...plainStyle, ...NO_PANEL_COLOUR };

/** The instant the rows are aged at — the same one the reserve is measured at, which is the pair's whole point. */
const atOnce = (): string => new Date().toISOString();

/**
 * The frame whose text column a `rowsOf` call names — the inverse of the inner width that call hands the rows.
 *
 * `optionRowCount` asks for a *frame* and makes the gutter subtraction itself, so a test that compares a row
 * count against it has to name the frame `innerAt` derived its `inner` from. One spelling per width, on both
 * sides of the comparison.
 */
const frameOfText = (textWidth: number): number => innerAt(textWidth) + GUTTER_COLUMNS;

/**
 * The row table of one pin, at a text column wide enough to make wrapping interesting.
 *
 * The frame's two figures are named rather than guessed: the reserve is measured on this pin's own tail (what
 * `panelPinRows` falls back to for a caller with no view) and `inner` is the width `panelTextColumns` leaves it
 * — the inverse of the subtraction that produced `textWidth`. A row-count test that guessed either would be
 * counting rows no drawer cut.
 */
/**
 * The row table of one pin at a text column of `textWidth`, expanded or not.
 *
 * `expanded` is the frame's signal spelled the way the frame spells it — a predicate over the very pin the
 * call is building — so the test, not the table, decides which pin the bar is on. Omitting it is the caller
 * that has no frame to name and passes no signal at all, which is the row table before this argument existed.
 */
const rowsOf = (pin: ViewPin, textWidth = 60, expanded?: ExpandedAt) =>
  panelPinRows(
    pin,
    textWidth,
    style,
    widestMetaColumns([pin], style.dim, atOnce()),
    innerAt(textWidth),
    atOnce(),
    expanded,
  );

/** The signal of a frame whose bar sits on `pin` and which takes keys. */
const selected = (pin: ViewPin): ExpandedAt => ({
  isSelected: (candidate) => candidate === pin,
  focused: true,
});

const LONG = "x".repeat(400);

const textOf = (pin: ViewPin, textWidth = 60) => rowsOf(pin, textWidth).map((row) => row.text);

test("a grouped pin owns the same rows as an ungrouped one", () => {
  const plain = levelPin(1, "one line", "info");
  const grouped = { ...plain, group: "Now" };
  expect(rowsOf(grouped)).toEqual(rowsOf(plain));
  // The group belongs to the section's heading, never to the pin's own row — the frame would otherwise draw
  // the same word once per pin and once over them.
  expect(textOf(grouped).join("")).not.toContain("Now");
});

test("a pin with options owns the rows its labels need, and the same pin without them owns none of those", () => {
  const plain = levelPin(1, "one line", "info");
  const withOptions = { ...plain, options: ["Passed on"] };
  expect(rowsOf(withOptions)).toHaveLength(rowsOf(plain).length + 1);
  // The count is what the window, the bar and the keys count, so it is the *wrap's* answer
  // (`optionRowCount`, `panel-options-wrap.ts`) read back rather than a number this file remembers: four labels
  // that will not close inside one row own more than one row, and a pin with no labels owns none.
  for (const options of [["a"], ["a", "b", "c", "d"], ["a", "b", "c", "d".repeat(200)]]) {
    const pin = { ...plain, options };
    expect(rowsOf(pin)).toHaveLength(
      rowsOf(plain).length + optionRowCount(options, frameOfText(60), style),
    );
  }
});

test("the reserved options row is the blank the drawer fills, and it carries no tail", () => {
  const pin = { ...levelPin(1, "one line", "info"), options: ["a"] };
  const rows = rowsOf(pin);
  const reserved = rows[rows.length - 1];
  expect(reserved?.text).toBe(" ");
  // No id, no age: the pin's first row carries the tail, so the options row cannot be mistaken for a pin.
  expect(reserved?.tail).toBe("");
});

test("the row table and the drawer read pin.options through one packing, so a reserved row is a drawn row", () => {
  // The two halves of the frame, pinned against the one packing they now share. The table decides how many rows
  // a pin owns — the window scrolls, the bar sits and the keys index that count — and the drawer fills the rows
  // it reserved. If they disagree about what `options` is, the user gets a counted row of padding that names no
  // option, or (in the shape this replaces) a table that reserved a row from `options.length` while the drawer
  // answered it blank after filtering every entry out. So the assertion is the identity, not a number: the
  // reserve is exactly the count of the lines the drawer can produce, at the same width.
  const cases: readonly (readonly [unknown, number])[] = [
    [undefined, 1],
    [[], 1],
    [["a"], 2],
    [["a", "b", "c", "d"], 2],
  ];
  for (const [options, expected] of cases) {
    const view = { ...levelPin(1, "one line", "info"), options } as ViewPin;
    const rows = panelPinRows(
      view,
      40,
      style,
      widestMetaColumns([view], style.dim, atOnce()),
      innerAt(40),
      atOnce(),
      // Rows built outside a frame: no bar, so no expansion.
      undefined,
    );
    expect(rows).toHaveLength(expected);
    // The reserved rows are the last ones the pin owns, tagged for the drawer, and the drawer fills each with
    // the entries whose digits name their positions — never a counted row the drawer had nothing to say about.
    const reserved = rows.filter(isOptionRow).length;
    const fillable = [0, 1, 2, 3].filter(
      (index) => optionLine(view, innerAt(40), style, index) !== null,
    ).length;
    expect(reserved).toBe(fillable);
    expect(reserved).toBe(expected - 1);
    if (expected === 2) expect(optionLine(view, innerAt(40), style, 0)).toContain("1 a");
  }
});

test("a compact pin owns exactly one text row however long its text is", () => {
  const long = { ...levelPin(1, LONG, "info"), compact: true };
  const rows = rowsOf(long);
  expect(rows).toHaveLength(1);
  // The row keeps the id's seat, which is the point of cutting the text rather than the row.
  expect(rows[0]?.tail).toContain("#1");
});

test("a non-compact pin of the same text owns many rows, so compact is what collapsed them", () => {
  const long = levelPin(1, LONG, "info");
  expect(rowsOf(long).length).toBeGreaterThan(3);
});

test("compact costs no options row and options cost no compact row", () => {
  const base = levelPin(1, LONG, "info");
  const both = { ...base, compact: true, options: ["a", "b"] };
  // One text row plus the reserved options row: neither field borrows from the other.
  expect(rowsOf(both)).toHaveLength(2);
});

test("a compact pin's one row keeps the marker, and the reply mark when it was answered", () => {
  const compact = { ...levelPin(1, LONG, "warning"), compact: true };
  expect(textOf(compact)[0]).toContain("!");
  const replied = { ...compact, repliedAt: "2026-10-23T14:30:00.000Z" };
  expect(textOf(replied)[0]).toContain("↩");
});

test("a compact pin in a degenerate frame is that frame's one row plus its options row", () => {
  // `textWidth` at or below zero is the frame with no text column at all: the marker *is* the row, and every
  // pin owns exactly one. `compact` asks for one row, so it neither adds nor removes one here — which is the
  // cheapest way to see that the flag is a hold on the wrap and not a branch that grows the table.
  const compact = { ...levelPin(1, LONG, "info"), compact: true, options: ["a"] };
  const rows = rowsOf(compact, 0);
  expect(rows).toHaveLength(2);
  expect(rows[0]?.tail).toContain("#1");
  expect(rowsOf({ ...levelPin(1, LONG, "info"), options: ["a"] }, 0)).toHaveLength(2);
});

test("a compact pin whose text fits is the same pin as a plain one", () => {
  const short = levelPin(1, "short", "info");
  expect(rowsOf({ ...short, compact: true })).toEqual(rowsOf(short));
});

test("an expanded compact pin is byte-for-byte the non-compact pin of the same one-line text", () => {
  // The comparison the rule is stated as — "exactly as a non-compact pin does" — is exact only for a text that
  // fits the row it owns: `pinTails` puts the id/age pair on one row only when the wrap produced one, so the
  // wrapping case gets its own pair of assertions below rather than being folded into this one.
  const short = levelPin(1, "short", "info");
  expect(rowsOf({ ...short, compact: true }, 60, selected(short))).toEqual(
    rowsOf({ ...short, compact: false }, 60),
  );
});

test("an expanded compact pin wraps its text, keeps the id on its first row and its age on the next", () => {
  const pin = { ...levelPin(1, LONG, "info"), compact: true };
  const rows = rowsOf(pin, 60, selected(pin));
  // Collapsed it is one row (`a compact pin owns exactly one text row however long its text is`); expanded it
  // is the multi-row entry the same text without the flag draws, and the tail lands where `pinTails` puts it:
  // the id alone on the first row, the age on the second, because a wrapping pin has a second row to give it.
  expect(rows.length).toBeGreaterThan(1);
  expect(rowsOf({ ...pin, compact: false }, 60)).toEqual(rows);
  // The tails are compared to each other rather than to a literal age: `pinTails` splits the pair once the
  // wrap owns more than one row — the id alone on the first, the age alone on the second.
  expect(rows[0]?.tail).toContain("#1");
  expect(rows[1]?.tail).not.toContain("#1");
  expect(rows[1]?.tail).not.toBe("");
  // No continuation row carries an ellipsis: the cut was the collapsed row's, and the expansion is a wrap.
  expect(rows.join("")).not.toContain(ELLIPSIS);
});

test("an expanded compact pin reserves its options rows, and the collapsed one does not", () => {
  const pin = { ...levelPin(1, LONG, "info"), compact: true, options: ["a", "b", "c", "d"] };
  const expanded = rowsOf(pin, 60, selected(pin));
  const collapsed = rowsOf(pin, 60);
  // The count the expansion adds is the wrap's own answer at this frame, read at the same width the rows were
  // built at — the same figure `optionRows` charged the collapsed table's options to, so the two tables differ
  // by the pin's *text* rows and by nothing else.
  const options = optionRowCount(pin.options ?? [], frameOfText(60), style);
  expect(collapsed).toHaveLength(1 + options);
  expect(expanded).toHaveLength(rowsOf({ ...pin, compact: false }, 60).length);
  expect(expanded.filter(isOptionRow)).toHaveLength(collapsed.filter(isOptionRow).length);
});

test("the expansion is opt-in: no argument, and the pin is collapsed whatever its selection would be", () => {
  // The peek, the rail and every test that counts rows outside a frame call the table with no third figure and
  // must keep getting the one-row table byte-for-byte — the peek passes no selection or focus at all
  // (`PeekContent` is `{ sections, ageNow, replyHint }`), so there is no "selected pin in the peek" to expand.
  const pin = { ...levelPin(1, LONG, "info"), compact: true, options: ["a", "b"] };
  // The signal present but this pin not under the bar is the peek's answer for every pin it draws...
  expect(rowsOf(pin, 60, { isSelected: () => false, focused: true })).toEqual(rowsOf(pin));
  // ...and a caller that hands no signal at all gets it too, byte for byte.
  expect(rowsOf(pin)).toHaveLength(2);
  expect(rowsOf(pin)[0]?.text).not.toContain("…");
});

test("an expanded compact pin in a degenerate frame is that frame's one row plus its options rows", () => {
  // `textWidth <= 0` is the frame with no text column at all: expansion cannot buy rows a frame has no room
  // for, so the expanded flag and the collapsed one draw the same one-row entry here — which is also the
  // branch's only coverage of the options reserve under expansion.
  const pin = { ...levelPin(1, LONG, "info"), compact: true, options: ["a"] };
  expect(rowsOf(pin, 0, selected(pin))).toEqual(rowsOf(pin, 0));
  expect(rowsOf(pin, 0, selected(pin))).toHaveLength(2);
  expect(rowsOf(pin, 0, selected(pin))[0]?.tail).toContain("#1");
});
