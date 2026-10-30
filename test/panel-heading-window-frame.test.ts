/**
 * The scroll window over a sectioned table, drawn as a **frame**: what the user actually sees when the pin
 * under the bar is not the first pin of its section.
 *
 * `panel-window-heading.test.ts` owns the `panelWindowOffset` seam — the offset's arithmetic on synthetic
 * owner arrays, where the budget can be named exactly. This file is the other half of the same rule, at the
 * seam the acceptance criteria name: `framed`/`built` (`test/panel-frame.ts`), the one pair a test draws a
 * frame from, at a terminal too short for the table.
 *
 * That distinction is the whole point of the file. The offset can be right on paper and the frame still
 * wrong, because three separate numbers have to agree for a heading to reach the screen: the row the window
 * opens at, the row the bar sits on (`layout.start - offset`) and the number of rows the frame draws. A rule
 * that keeps the heading by moving the bar instead of the window would pass an offset test and put the bar on
 * a heading — which is the failure `panel-section-rows.test.ts` refuses, because `d` and `Enter` then act on
 * a pin the user was never looking at.
 *
 * The single-group case is asserted here too, at both seams, because "one section draws no heading" is a
 * *frame* promise (`hasHeadings` decides, but only the drawn rows are what the operator sees) and the frame
 * title must keep counting levels while the heading goes.
 */
import { expect, test } from "bun:test";
import { visibleWidth } from "@earendil-works/pi-tui";

import { panelWindowOffset } from "../src/panel-frame-layout.ts";
import { panelContentRows } from "../src/panel-rows.ts";
import { panelSections } from "../src/panel-sections.ts";
import type { PanelStyle as RenderPanelStyle } from "../src/render.ts";
import type { ViewPin } from "../src/types.ts";
import { LATER } from "./fixtures.ts";
import { built, framed } from "./panel-frame.ts";
import { levelPin, mixedView } from "./panel-sections-fixture.ts";
import { SHORT_TERMINAL, componentAt, contentRows } from "./panel-window-fixture.ts";

/** Identity colours with a bar visible in the drawn string. */
const style: RenderPanelStyle = {
  header: (s) => s,
  marker: (_level, s) => s,
  dim: (s) => s,
  selected: (s) => `[${s}]`,
  border: (s) => s,
  borderFocused: (s) => s,
};

/** No bar at all, for the cases that read a row for its own marker. */
const noBar: RenderPanelStyle = { ...style, selected: (s) => s };

const WIDTH = 60;

/** The word the frame prints over a level section. */
const HEADING: Record<ViewPin["level"], string> = {
  warning: "Warnings",
  action: "Needs you",
  info: "FYI",
};

/**
 * A view whose *first* section holds three one-row pins.
 *
 * The three facts are short enough to own one row each at `WIDTH` and their text is unique, so a row can be
 * read for the pin it belongs to. `mixedView`'s sections have two pins each, which is enough to name the case
 * but not enough to push a heading further from the bar than the single row the old rule could see.
 */
function threeWarningView(): ViewPin[] {
  return [
    levelPin(11, "first warning", "warning"),
    levelPin(12, "second warning", "warning"),
    levelPin(13, "third warning", "warning"),
    levelPin(2, "act one", "action"),
    levelPin(1, "note one", "info"),
  ];
}

/** Draw `view` focused at the short terminal, as rows inside the frame. */
const rowsAt = (view: ViewPin[], selection: number, panelStyle = style): string[] =>
  contentRows(
    built(
      { pins: view, selection, focused: true, replyHint: "", ageNow: LATER },
      WIDTH,
      panelStyle,
      SHORT_TERMINAL,
    ),
  );

test("the section's second pin keeps its heading in the window, drawn as a frame", () => {
  const view = threeWarningView();
  const sections = panelSections(view);
  // The premise, asserted rather than remembered: the view really is too tall for the terminal, so the window
  // scrolls and a heading really can be scrolled out of the frame.
  const { layout } = framed(
    { pins: view, selection: 1, focused: true, replyHint: "", ageNow: LATER },
    WIDTH,
    style,
    SHORT_TERMINAL,
  );
  expect(layout.owned.length).toBeGreaterThan(panelContentRows(layout.height));

  // Selection 1 and 2 are the second and third pins of the warning section — neither has a heading directly
  // above it in the table, which is precisely the case the one-row rule left without a heading.
  for (const selection of [1, 2]) {
    const rows = rowsAt(view, selection);
    const bar = rows.findIndex((row) => row.includes("["));
    expect(bar, `a bar for selection ${selection}`).toBeGreaterThan(0);
    // The bar is on the selected pin's own row: its id and its text, never a heading's word.
    const pin = sections.flat[selection] as ViewPin;
    expect(rows[bar]).toContain(`#${pin.id}`);
    expect(rows[bar]).toContain(pin.text);
    expect(rows[bar]).not.toContain(HEADING.warning);
    // ...and somewhere above the bar in the *same window* the section's heading is drawn. This is the defect:
    // before the walk-up rule the window opened on the pin, the heading scrolled off the top of the frame and
    // the user had to infer the level from the marker on the bar's row.
    const headings = rows.slice(0, bar).filter((row) => row.includes(HEADING.warning));
    expect(headings, `the heading is visible above the bar at selection ${selection}`).toHaveLength(
      1,
    );
    for (const line of built(
      { pins: view, selection, focused: true, replyHint: "", ageNow: LATER },
      WIDTH,
      noBar,
      SHORT_TERMINAL,
    )) {
      expect(visibleWidth(line)).toBe(WIDTH);
    }
  }
});

test("the bar never moves to make room for the heading, whatever the selection", () => {
  // The heading is kept by moving the *window*, never the bar: `bar = layout.start - offset`, so a rule that
  // opened the window correctly and then adjusted the bar would highlight a heading. Sweep every selection of
  // the three-warning view and check the row under the bar names the selected pin.
  const view = threeWarningView();
  const drawn = panelSections(view).flat;
  for (let selection = 0; selection < drawn.length; selection++) {
    const { rows } = componentAt(view, selection, WIDTH, style);
    const bar = rows.findIndex((row) => row.includes("["));
    expect(bar, `a bar for selection ${selection}`).toBeGreaterThanOrEqual(0);
    const pin = drawn[selection] as ViewPin;
    expect(rows[bar]).toContain(`#${pin.id}`);
    // No heading row carries the bar, and the bar is on exactly one row of the window.
    expect(rows[bar]).not.toMatch(/Warnings|Needs you|FYI/);
    expect(rows.filter((row) => row.includes("["))).toHaveLength(1);
  }
});

test("the frame drops the heading before it drops a row of the selected pin", () => {
  // The priority rule, at the frame: a pin whose own rows fill the window keeps every one of them and loses
  // the label above them. `panelWindowOffset` answers its own fit at the table level
  // (`panel-window-heading.test.ts`); this is the same rule seen through the drawer, where the thing at risk
  // is a row of the user's text rather than a number.
  const view = [
    levelPin(1, "a".repeat(20), "warning"),
    levelPin(2, "far below", "info"),
    levelPin(3, "and another", "info"),
    levelPin(4, "and a third", "info"),
  ];
  const { layout } = framed(
    { pins: view, selection: 0, focused: true, replyHint: "", ageNow: LATER },
    30,
    style,
    8,
  );
  const budget = panelContentRows(layout.height);
  const rowsOfSelected = layout.owned.filter((entry) => entry.pin === 0).length;
  // One row too many for the heading and the pin to share the window.
  expect(rowsOfSelected).toBe(budget + 1);
  const rows = contentRows(
    built({ pins: view, selection: 0, focused: true, replyHint: "", ageNow: LATER }, 30, style, 8),
  );
  expect(rows).toHaveLength(budget);
  // Every row of the pin is drawn and the heading is the thing that went.
  expect(rows.filter((row) => row.includes("a".repeat(8))).length).toBeGreaterThan(0);
  for (const row of rows) expect(row).not.toContain("Warnings");
  // The bar is on the pin's first row — the one carrying its id — not on a heading and not on a continuation.
  expect(rows.filter((row) => row.includes("[")).map((row) => row.includes("#1"))).toEqual([true]);
  // And the offset that drew this frame is the capped one, not the heading's: `start`, not `start - 1`.
  expect(panelWindowOffset(budget, 0, layout.owned, layout.start)).toBe(
    Math.min(layout.start, layout.owned.length - budget),
  );
});

test("a single group draws no heading, and its title still counts the levels", () => {
  // The frame the operator described: one `Now` group holding the view's only warning and a couple of facts.
  // Before the change it drew a `Now` heading row; now it is the plain list, and the only thing that still
  // says what these rows are is the title's counts — which must not move when the heading does.
  const grouped = (id: number, text: string, level: ViewPin["level"], group: string): ViewPin => ({
    ...levelPin(id, text, level),
    group,
  });
  const pins = [
    grouped(1, "ship the gate", "warning", "Now"),
    grouped(2, "note one", "info", "Now"),
    grouped(3, "note two", "info", "Now"),
  ];
  const sections = panelSections(pins);
  // One section owns rows; the levels the group's pins carry keep their empty counting sections for the title.
  expect(sections.order.filter((section) => section.pins.length > 0)).toHaveLength(1);
  expect(sections.order.some((section) => section.kind === "group")).toBe(true);

  const lines = built(
    { pins, selection: 0, focused: true, replyHint: "", ageNow: LATER },
    WIDTH,
    style,
  );
  const rows = contentRows(lines);
  // Three pins, three rows — the heading row is gone, not merely empty.
  expect(rows).toHaveLength(3);
  for (const row of rows) {
    expect(row).not.toContain("Now");
    expect(row).not.toMatch(/Warnings|Needs you|FYI/);
  }
  // The pins themselves are all drawn, in the group's order.
  expect(rows.join("\n")).toContain("ship the gate");
  expect(rows.join("\n")).toContain("note one");
  expect(rows.join("\n")).toContain("note two");
  // The title counts by level and is unchanged by the heading's removal: the group's warning still earns
  // `1 warning`, and the facts are spelled `more` because a segment precedes them.
  expect(lines[0]).toContain("📌 Pinned · 1 warning · 2 more");
  // The table agrees with the frame: no row is unowned, so there is no heading for the bar to land on.
  const { layout } = framed(
    { pins, selection: 0, focused: true, replyHint: "", ageNow: LATER },
    WIDTH,
    style,
  );
  expect(layout.owned.filter((entry) => entry.pin === null)).toHaveLength(0);
  expect(layout.owned).toHaveLength(3);
  for (const line of lines) expect(visibleWidth(line)).toBe(WIDTH);
});

test("two sections still draw both headings, and the second section's lower pins keep theirs", () => {
  // The other side of the single-group rule: two drawn sections are still headed, so the walk-up rule has a
  // heading to find at all. `mixedView` is three level sections of two pins each at a terminal that scrolls.
  const view = mixedView();
  const drawn = panelSections(view).flat;
  for (let selection = 0; selection < drawn.length; selection++) {
    const rows = rowsAt(view, selection);
    const bar = rows.findIndex((row) => row.includes("["));
    expect(bar, `a bar for selection ${selection}`).toBeGreaterThan(0);
    const pin = drawn[selection] as ViewPin;
    // The heading of the selected pin's own level is above the bar, whichever pin of that level is selected.
    const above = rows.slice(0, bar).join("\n");
    expect(above, `${HEADING[pin.level]} above the bar at selection ${selection}`).toContain(
      HEADING[pin.level],
    );
    // And the window is the one the offset asked for, not a drawer-side guess about it.
    expect(rows.filter((row) => row.includes("["))).toHaveLength(1);
  }
});
