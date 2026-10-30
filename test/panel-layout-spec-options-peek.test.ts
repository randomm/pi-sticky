/**
 * The two layout rules of pins v2 the frame has to obey, read off a *drawn* frame rather than a table:
 *
 * 1. **A pin's options wrap.** At the narrow widths the overlay is handed, the labels cannot all close inside
 *    one row, and the frame gives them more rows instead of losing the ones that did not fit — the count the
 *    row table reserved and the count the drawer fills are the wrap's answer, so the window scrolls past every
 *    option the model named.
 * 2. **The peek stays three rows.** A shown panel that rests draws the counts title, one line of the
 *    best-ranked pin, and the border — and the pin it rests on is the one whose options wrap. The peek is the
 *    panel's rest state, not a shrunken panel: it never grows a row for options the open frame needs.
 *
 * Both are asserted at the two widths the spec names: 40 columns, and `PANEL_MIN_FRAME_COLUMNS * 33 / 100`
 * rounded down — the overlay's own `minWidth` at the overlay's own 33% anchor, i.e. the narrowest frame the
 * builder is ever handed for a real 100-column terminal. The second is *derived* from the two constants the
 * overlay config carries, because a test that wrote `33` would keep passing after someone moved either one.
 *
 * The third case is the keys: focus, `j`, `d`. `d` dismisses the pin the bar reached, and the bar moves by a
 * *pin*, not by a row — which is the promise an options row could break, since a pin that owns several rows
 * now owns several option rows too. It lives here because it is the same row-count contract as the wrap, seen
 * from the side that presses keys.
 */
import { expect, test } from "bun:test";
import { visibleWidth } from "@earendil-works/pi-tui";

import { PanelComponent } from "../src/panel-component.ts";
import { PANEL_MIN_FRAME_COLUMNS, PANEL_OVERLAY_OPTIONS } from "../src/panel-geometry.ts";
import { optionLine } from "../src/panel-options-row.ts";
import { optionRowCount } from "../src/panel-options-wrap.ts";
import { buildPeekLines } from "../src/panel-peek.ts";
import { isOptionRow } from "../src/panel-rows.ts";
import { panelSections } from "../src/panel-sections.ts";
import { GUTTER_COLUMNS } from "../src/panel-tail.ts";
import type { PanelStyle } from "../src/render.ts";
import type { ViewPin } from "../src/types.ts";
import { NOW } from "./fixtures.ts";
import { createOverlayHandle } from "./harness.ts";
import { style as componentStyle, host, withOptions } from "./panel-component-host.ts";
import { built, framed } from "./panel-frame.ts";
import { MIN_FRAME_WIDTH } from "./panel-hostile.ts";
import { levelPin } from "./panel-sections-fixture.ts";

/**
 * Identity colours, frame included: every row is measured on what the panel asked for, not on a theme's bytes.
 *
 * The component host's identity style, read from its owner rather than rebuilt here: `plainStyle` (`render.ts`)
 * is the *rail's* style and carries no `border`, `borderFocused` or `selected`, and a frame drawn with it
 * answers "no box I can promise" with no rows at all. Importing the host's copy is what keeps this file's
 * frames the frames the component actually draws.
 */
const style: PanelStyle = componentStyle;

/**
 * The four options the wrap is exercised with: each one the longest label a pin may store
 * (`MAX_FIELD_GRAPHEMES`, `pin-fields.ts`), so no two of them can share a narrow row.
 */
const FOUR_LONG = ["abcdefghij", "klmnopqrst", "uvwxyzabcd", "efghijklmn"].map(
  (head) => `${head}${"z".repeat(24 - head.length)}`,
);

/** The 40-column frame the spec names. */
const WIDE = 40;
/**
 * The narrowest frame the overlay is ever handed at a 100-column terminal: the builder's floor
 * (`PANEL_MIN_FRAME_COLUMNS`, which is the overlay's `minWidth`) taken at the overlay's own `width` anchor.
 *
 * Read out of `PANEL_OVERLAY_OPTIONS` rather than written as a literal, because both numbers belong to the
 * config and a test that hardcoded their product would keep passing when either moved.
 */
const NARROW = Math.floor((100 * percentWidth(PANEL_OVERLAY_OPTIONS.width ?? "")) / 100);

/** The column share an overlay `width` states, as a number: `"33%"` is 33. */
function percentWidth(width: string | number): number {
  return typeof width === "string" ? Number.parseFloat(width) : Number(width);
}

/** A pin with these options and a one-line text, so the only extra rows are its options' own. */
const optioned = (id: number, options: string[]): ViewPin => ({
  ...levelPin(id, "decide", "action"),
  options,
});

/** The rows inside the frame's borders, so an assertion reads content and never a border glyph. */
const inside = (lines: string[]): string[] => lines.slice(1, -1);

/** A drawn row's inner columns, i.e. what sits between the two gutters — the drawer's own framing removed. */
const between = (row: string): string => row.replace(/^\u2502 /, "").replace(/ \u2502$/, "");

test("four 24-grapheme options all appear across wrapped rows, at 40 and at the narrowest real frame", () => {
  // The acceptance criterion in one sweep: at both widths every option the model named reaches the screen,
  // the reserved count equals the drawn count *by construction* (both come from `optionRowCount`), and every
  // line measures exactly the frame.
  expect(NARROW).toBe(33);
  for (const width of [WIDE, NARROW]) {
    const view = [optioned(1, FOUR_LONG)];
    const { lines, layout } = framed(
      { pins: view, selection: 0, focused: true, replyHint: "", ageNow: NOW },
      width,
      style,
    );
    const reserved = layout.owned.filter((entry) => isOptionRow(entry.row)).length;
    // The window is tall enough to reach every reserved row at these two widths, which is what lets the frame
    // be compared row for row against the table rather than against whatever subset fitted.
    expect(inside(lines).length).toBe(layout.owned.length);
    expect(reserved).toBe(optionRowCount(FOUR_LONG, width, style));
    expect(reserved).toBeGreaterThan(1);
    // Every one of the four options is on screen: the digit and the whole label of each.
    const content = inside(lines).join("\n");
    FOUR_LONG.forEach((label, index) => {
      expect(content, `option ${index + 1} at ${width} columns`).toContain(`${index + 1} ${label}`);
    });
    // The rows the table tagged are the rows that name options, and nothing else in the frame does: the tags
    // and the digits are read together, so a reserved row the drawer answered blank would be caught here. The
    // pattern is a *digit followed by a space and a non-space* — a keycap and what it answers — which only the
    // option rows spell: the pin's own row opens with its marker and its `#id` has no space behind its digits.
    // The rows the table tagged are the rows that name options: the tags and the digits are read together, so
    // a reserved row the drawer answered blank — or a row of the pin's own text that happened to carry a digit
    // and a space — would be caught here. Read positionally rather than by pattern: the frame drew every row of
    // the table, so entry `1 + k` of the table is the frame's option row *k*, and asking the drawer for that
    // row's own text is the only way to compare a reserved row with the line meant to fill it.
    for (let k = 0; k < reserved; k++) {
      const filled = optionLine(view[0] as ViewPin, width - GUTTER_COLUMNS, style, k) ?? "";
      expect(between(inside(lines)[1 + k] ?? ""), `option row ${k} at ${width}`).toBe(filled);
      expect(filled, `option row ${k} is not the pad the table reserved`).not.toBe(" ");
    }
    // And the frame still closes: every line is exactly the width the overlay was handed.
    for (const line of lines) expect(visibleWidth(line)).toBe(width);
  }
});

test("the rows the table reserves are the rows the drawer fills, by construction", () => {
  // The identity the split used to make possible: a table that counted rows the drawer left blank, or a drawer
  // that filled rows the window never owned. Both halves read the one packing, so this asks the *table* how
  // many option rows the pin owns and the *frame* how many rows carry their text, and requires them to agree
  // at every width the builder closes at.
  for (const width of [WIDE, NARROW, 60, 100]) {
    const view = [optioned(7, FOUR_LONG)];
    const { lines, layout } = framed(
      { pins: view, selection: 0, focused: true, replyHint: "", ageNow: NOW },
      width,
      style,
    );
    const reserved = layout.owned.filter((entry) => isOptionRow(entry.row)).length;
    const rows = inside(lines);
    const viewPin = view[0] as ViewPin;
    // The table's count and the wrap's count are one answer, asked at the same width.
    expect(reserved).toBe(optionRowCount(FOUR_LONG, width, style));
    // The frame drew every row of the table: the window is not cutting any of them at these heights, so a row
    // the table counted and the drawer could not fill would show up as a padded line among these.
    expect(rows.length).toBe(layout.owned.length);
    for (let k = 0; k < reserved; k++) {
      expect(between(rows[1 + k] ?? ""), `option row ${k} at ${width}`).toBe(
        optionLine(viewPin, width - GUTTER_COLUMNS, style, k) ?? "",
      );
    }
    // Every drawn line closes at the frame, including the wrapped option rows.
    for (const line of lines) expect(visibleWidth(line)).toBe(width);
  }
});

test("the peek stays three rows and shows no option text at those widths", () => {
  // The rest state is not a shrunken panel: however many rows the open frame needs for one pin's options, the
  // peek draws the counts title, one line of the best-ranked pin, and the border.
  const view = [optioned(1, FOUR_LONG), levelPin(2, "another note", "info")];
  const sections = panelSections(view);
  for (const width of [WIDE, NARROW]) {
    const lines = buildPeekLines(
      { sections, ageNow: NOW, replyHint: "ctrl+alt+p to reply" },
      width,
      style,
    );
    expect(lines).toHaveLength(3);
    for (const line of lines) expect(visibleWidth(line)).toBe(width);
    // No digit-and-label of any option reaches the peek, and no option label at all.
    const content = lines.join("\n");
    for (const label of FOUR_LONG) expect(content).not.toContain(label);
    // The one line it does draw is the best-ranked pin's own text.
    expect(inside(lines)[0]).toContain("decide");
  }
  // The premise the assertion rests on: the open frame of this very view really does need more than one row
  // for those options, so "three rows" is a restraint and not an accident of a pin that needed none.
  expect(optionRowCount(FOUR_LONG, WIDE, style)).toBeGreaterThan(1);
});

test("focus, j, then d dismisses the second pin of the drawn order, and a digit still answers a wrapped pin", () => {
  // The key case the extra rows could have broken: `j` moves by a *pin*, so after one `j` the bar is on the
  // next pin whatever rows the pin it left owned — and `d` dismisses *that* pin, the one named by
  // `panelSections(view).flat[1]`, never the one the bar started on.
  // One pin whose options wrap — four 24-grapheme labels, four option rows beside its one text row — and
  // two plain pins behind it, so the bar has somewhere to go and `d` has a pin to name.
  const wrapped = optioned(1, FOUR_LONG);
  const other = optioned(2, ["a", "b"]);
  const fact = optioned(3, ["y"]);
  const view = [wrapped, other, fact];
  // The component's own drawn order, read once and reused for both the bar's index and the pin it names: a
  // test that re-derived the ranking in its expected values would be asserting on its own guess rather than
  // on the array the keys index. Ids grow with the pins, so the newest leads and the wrapped pin is last.
  const drawn = panelSections(view).flat;
  expect(drawn.map((pin) => pin.id)).toEqual([3, 2, 1]);
  // The wrapped pin owns several rows of the table and is still *one* bar position — three `j`s cross all
  // three pins exactly once, and `d` after two of them names the pin the bar reached, which is
  // `panelSections(view).flat[1]`: not the one the bar started on, and not the one its option rows sit under.
  const { layout } = framed(
    { pins: view, selection: 0, focused: true, replyHint: "", ageNow: NOW },
    WIDE,
    style,
  );
  const wrappedIndex = drawn.findIndex((pin) => pin?.id === 1);
  expect(
    layout.owned.filter((entry) => entry.pin === wrappedIndex).length,
    "the wrapped pin owns its text row and its option rows",
  ).toBeGreaterThan(2);

  const h = host(view);
  h.stub.style = () => componentStyle;
  const c = new PanelComponent(h.stub, h.tui);
  const handle = createOverlayHandle();
  handle.unfocus();
  c.setHandle(handle);
  c.focus();
  expect(c.selection).toBe(0);
  // `j` moves by a *pin*: one press leaves the pin the bar started on whatever rows it owns. A component that
  // indexed rows would have taken the bar to that pin's second row, and `d` would dismiss the pin the user
  // never moved onto.
  c.handleInput("j");
  expect(c.selection).toBe(1);
  c.handleInput("d");
  expect(h.state.dismissals).toEqual([2]);
  expect(drawn[1]?.id).toBe(2);

  // And a digit still answers the pin under the bar by position: the same two `j`s, then the digit, and the
  // answer is that pin's *second* option — the numbering keyed by position, with the wrapped pin's extra rows
  // buying nobody a keypress.
  const a = host(view);
  a.stub.style = () => componentStyle;
  const answering = new PanelComponent(a.stub, a.tui);
  const secondHandle = createOverlayHandle();
  secondHandle.unfocus();
  answering.setHandle(secondHandle);
  answering.focus();
  answering.handleInput("j");
  expect(answering.selection).toBe(1);
  answering.handleInput("2");
  expect([a.state.replies, a.state.answers]).toEqual([[2], ["b"]]);
});

test("the narrowest frame the builder will still close draws the options and nothing over its width", () => {
  // The floor itself, at the width `isPanelFrameSize` admits: the options rows are cut with their digits kept,
  // the frame closes, and the wrap never hands the drawer a line it would have to re-cut.
  const view = [optioned(1, ["a", "bb", "ccc"])];
  const lines = built(
    { pins: view, selection: 0, focused: true, replyHint: "", ageNow: NOW },
    MIN_FRAME_WIDTH,
    style,
  );
  for (const line of lines) expect(visibleWidth(line)).toBe(MIN_FRAME_WIDTH);
  expect(inside(lines).join("\n")).toContain("1 a");
});
