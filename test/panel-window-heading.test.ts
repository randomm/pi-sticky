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
import type { PanelOwned } from "../src/panel-row-owner.ts";
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
  // starts on its heading; for a pin lower in its section it starts on that same heading, which is further up
  // the table than the one row the first case needs.
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
  // A pin that is *not* a section head: the row above it is a sibling pin's, and the heading of its section
  // sits above that sibling. Before the walk-up rule the window opened on the pin and the heading scrolled
  // away with the sibling; now it travels with the window, capped at the last window that fits the table.
  const second = sections.order[0]?.pins[1];
  expect(second, "the fixture's first section has a second pin").toBeDefined();
  const secondIndex = sections.flat.indexOf(second as ViewPin);
  const secondRow = layout.owned.findIndex((entry) => entry.pin === secondIndex);
  expect(
    rows[secondRow - 1]?.pin,
    `row above pin ${secondIndex} is a sibling, not a heading`,
  ).not.toBeNull();
  // ...and the row above *that* is the section's heading, i.e. this is the case the one-row test missed.
  expect(rows[secondRow - 2]?.pin, `the heading is two rows above pin ${secondIndex}`).toBeNull();
  expect(panelWindowOffset(budget, secondIndex, rows, secondRow)).toBe(
    Math.min(secondRow - 2, lastWindow),
  );
  // The last pin of the last section: the window is capped at the end of the table whatever the heading wants,
  // so the rule can never scroll the final pin off the bottom to fetch a label.
  const tail = sections.flat.length - 1;
  const tailRow = layout.owned.findIndex((entry) => entry.pin === tail);
  expect(panelWindowOffset(budget, tail, rows, tailRow)).toBe(lastWindow);
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

test("a multi-row selected pin keeps every row of its own before it keeps the heading", () => {
  // The other half of the fit rule for a pin that is *not* its section's first: the walk reaches the heading
  // past the sibling rows above, and then the fit is asked of the heading *plus every row of the pin*. At the
  // equality the three are precisely the window and the heading stays; one row over, the label is what goes —
  // a heading never costs the selected pin a row of its text. The tables are synthetic so the budget can be
  // named exactly, which is what a frame two layers up cannot do.
  // `[null, 0,0, 1,1, …]`: heading, the sibling's two rows, the selected pin's two rows.
  const twoRowsOfSelected = table([null, 0, 0, 1, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  // heading + sibling(2) + selected(2) = 5 rows: exactly the window, so the heading is kept and the window
  // opens on it.
  expect(panelWindowOffset(5, 1, twoRowsOfSelected, 3)).toBe(0);
  // Six rows of the same table, one of them the selected pin's third: the heading is now the thing that does
  // not fit, and the window opens on the pin. `start` is 3 and the cap is nowhere near it, so the cap is not
  // what answered.
  const threeRowsOfSelected = table([null, 0, 0, 1, 1, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  expect(panelWindowOffset(5, 1, threeRowsOfSelected, 3)).toBe(3);
  // And the sibling rows are not a free pass: the fit costs heading + siblings + the pin, so a seven-row
  // window holds the label above two one-row siblings and a two-row pin, and an eight-row one does not hold
  // it above three siblings and the same pin. The rule reads the table, not a remembered distance.
  const twoSiblings = table([null, 0, 0, 1, 1, 2, 2, 3, 3, 4, 5, 6, 7, 8, 9, 10]);
  expect(panelWindowOffset(9, 3, twoSiblings, 7)).toBe(0);
  // One row short of that and the label is the thing that goes: the window opens on the pin instead.
  expect(panelWindowOffset(8, 3, twoSiblings, 7)).toBe(7);
  // [null, then three siblings of two rows each (0,1,2), then the selected pin 3's two rows, then filler]:
  // heading(1) + six sibling rows + the pin's two = nine, and ten rows of table past the pin so the cap is
  // nowhere near the heading and cannot be what answered.
  const threeSiblings = table([null, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9]);
  // The selected pin is 3: the heading is kept at nine rows exactly, and dropped at eight.
  expect(panelWindowOffset(9, 3, threeSiblings, 7)).toBe(0);
  // One row short: the heading is the thing that does not fit, so the window opens on the pin — capped at the
  // last window the table allows, which is what `Math.min(start, total - contentRows)` answers here.
  expect(panelWindowOffset(8, 3, threeSiblings, 7)).toBe(7);
});

test("the walk up reaches the heading over a pin that is not its section's first", () => {
  // The seam the one-row rule could not see: a *two-row* selected pin whose nearest neighbour is a sibling.
  // In the table above the heading is also the row directly above the pin, so a one-row look found it; here it
  // sits two rows up and the window must hold heading + sibling + both rows of the pin = 5. The table runs on
  // past the pin so the cap (`total - contentRows`) is never what answered for the heading.
  const owners: (number | null)[] = [null, 0, 1, 2, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];
  const above = table(owners);
  expect(owners.length).toBeGreaterThan(8); // the cap is well below the heading, so it is not what answers
  expect(
    panelWindowOffset(4, 2, above, 3),
    "four rows cannot hold the heading, the sibling and both rows of the pin",
  ).toBe(3);
  expect(
    panelWindowOffset(5, 2, above, 3),
    "five rows are exactly heading + sibling + the pin, so the label is kept",
  ).toBe(0);
  // ...and the walk really does *walk* — this is the regression the one-row rule could not see. Select the
  // *second* pin of the section rather than its first and the heading is no longer the row above the bar: the
  // walk has to pass a sibling's two rows to reach it, and the window must hold heading + 2 sibling rows + the
  // pin's own two = 5. The heading is the table's first row, so keeping it opens the window at 0; without the
  // walk the answer would be `start` itself. The table runs on past the pin, so the cap is nowhere near 0 and
  // cannot be what answered.
  const secondOfSection = table([null, 0, 0, 1, 1, 2, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
  expect(
    panelWindowOffset(5, 1, secondOfSection, 3),
    "five rows hold heading, sibling and pin, so the label is kept — the window opens on the heading",
  ).toBe(0);
  expect(
    panelWindowOffset(4, 1, secondOfSection, 3),
    "one row short, so the pin's text wins and the heading scrolls out above the frame",
  ).toBe(3);
  expect(
    panelWindowOffset(4, 2, table([0, 1, 2, 3, 4, 5]), 4),
    "with no heading in the table the window opens on the pin, capped at the last window",
  ).toBe(2);
  // Sibling rows are what the walk passes *through*: with the selected pin three siblings under its heading,
  // the walk passes three pin rows to reach it, and the cap is what answers when they will not all fit.
  const deep = table([null, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
  expect(panelWindowOffset(6, 4, deep, 5), "all six rows fit, heading included").toBe(0);
  expect(panelWindowOffset(5, 4, deep, 5), "one row short of the heading: the pin wins").toBe(5);
  // A table whose selected pin has no heading above it at all — every row belongs to a pin — has nothing to
  // walk up to, and behaves exactly as a headingless table always has.
  expect(panelWindowOffset(2, 3, table([0, 1, 2, 3, 4]), 3)).toBe(3);
  // And a heading the walk would have to leave the top of the table to reach is not a heading this window can
  // open on: at `start` of 0 the walk has nothing above the pin at all.
  expect(panelWindowOffset(2, 0, table(owners), 0)).toBe(0);
});

test("an expanded compact pin is counted by its rows, so the heading loses when they cannot share", () => {
  // The offset already keeps a section's heading only while it and *every* row of the selected pin fit. That
  // rule was nearly vacuous while a compact pin owned one row; expansion is what makes it bite. The tables are
  // synthetic so the budget is a number this file names — the frame-level twin of each case is in
  // `panel-compact-expand-frame.test.ts`.
  // The bar on the pin directly under its heading, whose entry the wrap grew from one row to three.
  const entry = table([null, 0, 0, 0, 1, 1, 2]);
  // Heading + three rows is exactly a four-row window: the label is kept and the window opens on it.
  expect(panelWindowOffset(4, 0, entry, 1), "heading + expanded entry = 4-row window").toBe(0);
  // One row short, and the label is the thing that goes — the pin's own rows are never the cost.
  expect(panelWindowOffset(3, 0, entry, 1), "three rows of the pin alone: no heading").toBe(1);
  // Collapsed, the same pin is one row, so a two-row window holds it *and* its heading: the budget at which a
  // pin keeps its label moves with the bar, which is the whole point of expanding only under it.
  expect(panelWindowOffset(2, 0, table([null, 0, 1, 1, 2]), 1), "collapsed: heading + 1 row").toBe(
    0,
  );
  // …and a one-row window cannot hold both, whatever the flag — the rule did not change shape, only the count
  // of rows it is asked to fit.
  expect(
    panelWindowOffset(1, 0, table([null, 0, 1, 1, 2]), 1),
    "collapsed, one row: the pin wins",
  ).toBe(1);
});
