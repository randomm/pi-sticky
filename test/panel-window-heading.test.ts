/**
 * The scroll *window* over a sectioned table: where `panelWindowOffset` opens it, and what that costs a
 * heading when the terminal is short.
 *
 * `panel-section-rows.test.ts` covers the rows themselves — the headings' place in the table and the bar's
 * place among them, at a terminal tall enough to hold the whole view. This file is the other seam: the same
 * table at a terminal too short for it, where the offset has somewhere to move and a heading can genuinely
 * be scrolled out of the frame. That is the case the offset exists for, and the only one in which a change
 * to it can be seen at all — at a tall terminal the window is the whole table and every offset draws the
 * same frame.
 *
 * Two coordinates run through these tests and must not be mixed: a **selection** is an index into the
 * flattened pins, a **table row** is an index into `layout.owned`, and a heading owns a row and no pin, so
 * the two numberings part company at every heading above the selection.
 */
import { expect, test } from "bun:test";
import { visibleWidth } from "@earendil-works/pi-tui";

import { panelWindowOffset } from "../src/panel-frame-layout.ts";
import type { PanelOwned } from "../src/panel-frame-layout.ts";
import { panelContentRows } from "../src/panel-rows.ts";
import { panelSections } from "../src/panel-sections.ts";
import type { PanelStyle as RenderPanelStyle } from "../src/render.ts";
import type { ViewPin } from "../src/types.ts";
import { LATER } from "./fixtures.ts";
import { framed } from "./panel-frame.ts";
import { mixedView } from "./panel-sections-fixture.ts";
import { SHORT_TERMINAL, componentAt } from "./panel-window-fixture.ts";

/** Identity colours with a bar that is visible in the drawn string. */
const style: RenderPanelStyle = {
  header: (s) => s,
  marker: (_level, s) => s,
  dim: (s) => s,
  selected: (s) => `[${s}]`,
  border: (s) => s,
  borderFocused: (s) => s,
};

const WIDTH = 60;

/** The drawn index of each section's first pin — the only pins with a heading directly above them. */
function sectionHeads(view: ViewPin[]): number[] {
  const sections = panelSections(view);
  return sections.order.map((section) => sections.flat.indexOf(section.pins[0] as ViewPin));
}

test("each section's first pin draws its own heading directly above the bar's row", () => {
  const view = mixedView();
  // Only a section's *first* pin has a heading directly above it in the table, so only those selections can
  // show the offset at work. A pin lower in its section has another pin's row above it whatever the window
  // does, and asserting a heading there would test the fixture rather than the offset.
  const heads = sectionHeads(view);
  expect(heads.length).toBe(3);
  for (const selection of heads) {
    const { lines, rows, drawn } = componentAt(view, selection, WIDTH, style);
    const pin = drawn[selection] as ViewPin;
    const bar = rows.findIndex((row) => row.includes("["));
    expect(bar, `a bar for selection ${selection}`).toBeGreaterThanOrEqual(0);
    // The bar is on a pin's row — the selected one, which carries its id — and never on a heading.
    expect(rows[bar]).toMatch(/#\d/);
    expect(rows[bar]).not.toMatch(/Warnings|Needs you|FYI/);
    expect(rows[bar]).toContain(`#${pin.id}`);
    // The row above the bar is that pin's section heading: the window opened on it rather than on the pin.
    // `bar === 0` is what the offset drew before it knew about headings — the bar pinned to the top of the
    // window with its heading scrolled away above the frame.
    const heading = { warning: "Warnings", action: "Needs you", info: "FYI" }[pin.level];
    expect(bar, `room above the bar at selection ${selection}`).toBeGreaterThan(0);
    expect(rows[bar - 1], `${heading} above the bar at selection ${selection}`).toContain(heading);
    for (const line of lines) expect(visibleWidth(line)).toBe(WIDTH);
  }
});

test("the offset opens the window on the heading above the selected pin, one row earlier", () => {
  // The offset itself, at the row-table level, where the arithmetic is legible: for a section head the window
  // starts on its heading; for a pin lower in its section it starts on the pin.
  const view = mixedView();
  const sections = panelSections(view);
  const { layout } = framed(
    { pins: view, selection: 0, focused: true, replyHint: "", ageNow: LATER },
    WIDTH,
    style,
    SHORT_TERMINAL,
  );
  const budget = panelContentRows(layout.height);
  const rows = layout.owned;
  const lastWindow = layout.owned.length - budget;
  for (const head of sectionHeads(view)) {
    const tableRow = layout.owned.findIndex((entry) => entry.pin === head);
    expect(rows[tableRow - 1]?.pin, `row above the head pin ${head} is its heading`).toBeNull();
    // The window this offset opens has the heading on its first row and the pin next to it. Capped at the
    // last window that fits the table, which is the bound the offset itself obeys.
    const offset = panelWindowOffset(budget, head, rows, tableRow);
    expect(offset, `window opens on the heading above pin ${head}`).toBe(
      Math.min(tableRow - 1, lastWindow),
    );
  }
  // A pin that is not a section head: the row above it is a sibling pin's, so there is no heading to open on
  // and the window opens on the pin itself.
  const second = sections.order[0]?.pins[1];
  expect(second, "the fixture's first section has a second pin").toBeDefined();
  const secondIndex = sections.flat.indexOf(second as ViewPin);
  const secondRow = layout.owned.findIndex((entry) => entry.pin === secondIndex);
  expect(
    rows[secondRow - 1]?.pin,
    `row above pin ${secondIndex} is a sibling, not a heading`,
  ).not.toBeNull();
  expect(panelWindowOffset(budget, secondIndex, rows, secondRow)).toBe(
    Math.min(secondRow, lastWindow),
  );
});

test("the window scrolls for these frames: three rows of the table are always off screen", () => {
  // The premise the sweep above rests on: a seven-row window over a ten-row table, so a heading really can be
  // scrolled away and the assertion above is not satisfied by a frame tall enough to draw everything.
  const view = mixedView();
  for (let selection = 0; selection < view.length; selection++) {
    const { lines, rows } = componentAt(view, selection, WIDTH, style);
    expect(rows).toHaveLength(7);
    expect(lines).toHaveLength(9);
    expect(rows.filter((row) => row.includes("[")).length).toBe(1);
  }
});

/** A table of dummy rows owned as `owners`, for the offset's own arithmetic — the table is one array now. */
function table(owners: readonly (number | null)[]): PanelOwned[] {
  return owners.map((pin) => ({ row: { text: "row", tail: "" }, pin }));
}

test("the heading is kept exactly while it and the whole pin fit, and dropped one row after that", () => {
  // The seam of the fit rule, at the row-table level where the budget can be named: a one-row pin under a
  // heading in a two-row window is *exactly* the window — heading and pin fill it and nothing is lost, so the
  // heading stays. Give that same pin one more row and the heading is now the thing that does not fit, and the
  // window opens on the pin instead. The two cases differ by one row of the pin and one row of the budget, so
  // a comparison off by one anywhere in the rule shows up here rather than in a frame two layers up.
  const exact = [null, 0, 1, 1, 2]; // heading, one-row pin 0, …
  const overflows = [null, 0, 0, 1, 1, 2]; // heading, two-row pin 0, …
  expect(panelWindowOffset(2, 0, table(exact), 1), "heading + 1 row = 2-row window").toBe(0);
  expect(panelWindowOffset(2, 0, table(overflows), 1), "heading + 2 rows > 2-row window").toBe(1);
  // A budget of five over a three-row pin leaves two rows over: the heading is kept with room to spare.
  const generous = [null, 0, 0, 0, 1, 1, 2, 3, 4];
  expect(panelWindowOffset(5, 0, table(generous), 1)).toBe(0);
  // A pin the table tags with no row at all owns nothing to keep, so there is no heading to open on.
  expect(panelWindowOffset(3, 0, table(generous.map(() => 1)), 1)).toBe(1);
});
