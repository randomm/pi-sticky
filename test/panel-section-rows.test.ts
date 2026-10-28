/**
 * The section headings as the frame draws them: where the rows sit, what they cost, and the one thing they
 * must never take — the bar.
 *
 * Headings are the visible half of pins v2-3 and the half a test cannot reach through the section module or
 * the string module alone: they are rows in the same table the pins are cut from, so they change the frame's
 * height, the window's offset and the row the bar is drawn on, without changing any of the coordinates the
 * keys answer to. These four tests are that seam. The strings themselves belong to
 * `panel-section-headings.test.ts`; the counts in the frame's title to `panel-frame-title.test.ts`; the
 * grouping to `panel-sections.test.ts`.
 *
 * The bar tests are the load-bearing ones. A selection is an index into the *flattened pins*, and a heading
 * owns a row and no pin, so any arithmetic that mixed the two coordinates would park the bar on a heading —
 * and `d` or `Enter` would then dismiss the pin the user was never looking at.
 */
import { expect, test } from "bun:test";
import type { TUI } from "@earendil-works/pi-tui";
import { visibleWidth } from "@earendil-works/pi-tui";

import { PanelComponent } from "../src/panel-component.ts";
import { panelSections } from "../src/panel-sections.ts";
import type { PanelStyle as RenderPanelStyle } from "../src/render.ts";
import type { ViewPin } from "../src/types.ts";
import { LATER } from "./fixtures.ts";
import { createOverlayHandle } from "./harness.ts";
import { host } from "./panel-component-host.ts";
import { built, framed } from "./panel-frame.ts";
import { levelPin, mixedView } from "./panel-sections-fixture.ts";

/** Identity colours with a bar that is visible in the drawn string. */
const style: RenderPanelStyle = {
  header: (s) => s,
  marker: (_level, s) => s,
  dim: (s) => s,
  selected: (s) => `[${s}]`,
  border: (s) => s,
  borderFocused: (s) => s,
};

/** The same colours with no bar at all, for the tests that read a row for its marker. */
const noBar: RenderPanelStyle = { ...style, selected: (s) => s };

const WIDTH = 60;

/** The frame's content rows — the two borders taken off, so row 0 is the first row inside the frame. */
function contentRows(lines: string[]): string[] {
  return lines.slice(1, -1);
}

const frameOf = (pins: Parameters<typeof built>[0]["pins"], selection = 0, focused = true) =>
  built({ pins, selection, focused, replyHint: "", ageNow: LATER }, WIDTH, style);

/**
 * A real focused component over `pins`, drawn at `WIDTH`: the only way to see the order the *component*
 * draws, since its `PanelMemory` is what feeds the layout and the keys. The bar style is installed on the
 * host rather than passed to `render` — the component resolves its colours from the host, once.
 */
function componentRows(pins: ViewPin[], selection: number): string[] {
  const h = host(pins);
  h.stub.style = () => style;
  const c = new PanelComponent(h.stub, h.tui);
  const handle = createOverlayHandle();
  handle.unfocus();
  c.setHandle(handle);
  c.focus();
  c.select(selection);
  return contentRows(c.render(WIDTH));
}

test("a mixed view draws a heading above each level, in the drawn order", () => {
  const rows = contentRows(frameOf(mixedView()));
  // Warnings lead (resolution 4), each heading on its own row, its word readable and its pins beneath it.
  expect(
    rows.map((row) => row.includes("Warnings") || row.includes("Needs you") || row.includes("FYI")),
  ).toEqual([
    true, // ⚠ Warnings
    false,
    false,
    true, // ? Needs you
    false,
    false,
    true, // · FYI
    false,
    false,
    false,
  ]);
  // The heading's word lines up with the pin text under it: both are opened by the same three columns, so
  // the word a heading names sits in the column the text of its pins begins in. The warning's own marker is
  // `!` and the heading's glyph is `⚠`, which is why the comparison is made on the words.
  const heading = rows[0] as string;
  const pinUnderIt = rows[1] as string;
  expect(heading.indexOf("Warnings") + 1).toBe(pinUnderIt.indexOf("warn two"));
});

test("a single-level view draws no headings at all (resolution 1)", () => {
  const rows = contentRows(frameOf([levelPin(1, "one", "info"), levelPin(2, "two", "info")]));
  expect(rows).toHaveLength(2);
  for (const row of rows) expect(row).not.toMatch(/Warnings|Needs you|FYI/);
});

test("headings cost rows to the frame and no slot to the selection (resolution 2)", () => {
  const view = mixedView();
  const { layout } = framed(
    { pins: view, selection: 0, focused: true, replyHint: "", ageNow: LATER },
    WIDTH,
    style,
  );
  // Seven pins, three headings: the table the window scrolls by holds ten rows, and the highest owner tag
  // the table carries is still the seventh pin's index — no heading is addressable.
  expect(layout.owned).toHaveLength(10);
  const owners = layout.owned.map((entry) => entry.pin);
  expect(owners.filter((owner) => owner === null)).toHaveLength(3);
  expect(owners.filter((owner) => owner !== null).sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual([
    0, 1, 2, 3, 4, 5, 6,
  ]);
});

test("the bar can never be drawn on a heading, whatever the selection", () => {
  const view = mixedView();
  for (let selection = 0; selection < view.length; selection++) {
    const lines = frameOf(view, selection);
    const barRows = contentRows(lines).filter((row) => row.includes("["));
    expect(barRows).toHaveLength(1);
    // The row the bar is on is a pin's row: it carries the id, which no heading prints.
    expect(barRows[0]).toMatch(/#\d/);
    expect(barRows[0]).not.toMatch(/Warnings|Needs you|FYI/);
  }
  // A selection past the end draws no bar at all rather than one on whatever row lands there.
  const past = contentRows(frameOf(view, 99)).filter((row) => row.includes("["));
  expect(past).toHaveLength(0);
});

/**
 * The terminal these sweeps draw against. `panelMaxRows` halves it and `panelFrameRows` puts the two border
 * rows over the table, so eighteen rows leave a seven-row window over this fixture's ten-row table: three
 * rows of the table are always scrolled away, which is the only case in which a heading can be lost.
 */
const SHORT_TERMINAL = 18;

/** The frame, its table and its drawn rows for `selection` at that short terminal. */
function windowAt(view: ViewPin[], selection: number) {
  const { lines, layout } = framed(
    { pins: view, selection, focused: true, replyHint: "", ageNow: LATER },
    WIDTH,
    style,
    SHORT_TERMINAL,
  );
  return { lines, layout, rows: contentRows(lines) };
}

/**
 * A focused component over `pins` with the bar on `selection`, drawn at the short terminal.
 *
 * The component's own path rather than the helper's, because the two destructive keys are the thing under
 * test and they live on the component: `d` and `Enter` index the drawn pin list, so the frame they are checked
 * against must be the frame that very component drew.
 */
function keySweepAt(view: ViewPin[], selection: number) {
  const h = host(view);
  h.stub.style = () => style;
  // Named rather than spread onto the host's stub, which has no `terminal` at all: the component reads a
  // missing one as "no terminal to ask" and sizes the frame from `panelMaxRows`'s fallback instead.
  const tui = { ...h.tui, terminal: { columns: 80, rows: SHORT_TERMINAL } } as TUI;
  const c = new PanelComponent(h.stub, tui);
  const handle = createOverlayHandle();
  handle.unfocus();
  c.setHandle(handle);
  c.focus();
  c.select(selection);
  const lines = c.render(WIDTH);
  return { h, c, lines, rows: contentRows(lines), drawn: panelSections(view).flat };
}

test("the bar's row is the selected pin's first row, not a continuation of it", () => {
  // The other half of the heading rule: opening the window a row early is only right if the bar still lands
  // on the pin's *first* row — the one carrying its id — and not on a continuation line cut from the same pin.
  const view = mixedView();
  for (let selection = 0; selection < view.length; selection++) {
    const { rows, drawn } = keySweepAt(view, selection);
    const pin = drawn[selection] as ViewPin;
    const bar = rows.findIndex((row) => row.includes("["));
    expect(bar, `a bar for selection ${selection}`).toBeGreaterThanOrEqual(0);
    expect(rows[bar]).toContain(`#${pin.id}`);
    // Not a continuation row: those open under the text column, with the row's first three columns blank.
    expect(rows[bar]?.replace(/^[│ ]+/, "").startsWith("   ")).toBe(false);
  }
});

test("d and Enter act on the pin under the bar, whatever row of the table that is", () => {
  // The other half of the sweep: the bar is only worth its position if the two destructive keys answer to the
  // pin drawn under it. `d` and `Enter` index the *pin* list and the bar indexes the *table*; the heading rows
  // are exactly where those two numberings part company.
  const view = mixedView();
  const drawn = panelSections(view).flat;
  for (let selection = 0; selection < view.length; selection++) {
    const { rows } = windowAt(view, selection);
    const bar = rows.findIndex((row) => row.includes("["));
    const underBar = drawn[selection] as ViewPin;

    const dismissed = host(view);
    dismissed.stub.style = () => style;
    const d = new PanelComponent(dismissed.stub, dismissed.tui);
    d.focus();
    d.select(selection);
    d.handleInput("d");
    expect(dismissed.state.dismissals, `d at selection ${selection}`).toEqual([underBar.id]);

    const answered = host(view);
    answered.stub.style = () => style;
    const enter = new PanelComponent(answered.stub, answered.tui);
    enter.focus();
    enter.select(selection);
    enter.handleInput("\r");
    expect(answered.state.replies, `Enter at selection ${selection}`).toEqual([underBar.id]);

    // What the user looked at is what was acted on: the bar's own row names that pin's id.
    expect(rows[bar]).toContain(`#${underBar.id}`);
  }
});

test("a replied-before-unreplied view draws the unanswered pin's row under the bar", () => {
  // The same divergence seen at the frame: the bar is addressed by *pin* index into the drawn list, so if the
  // fast path accepts an answered pin above an unanswered one the row under the bar belongs to the wrong pin —
  // and `d`/`Enter`, which index that very list, act on the pin the user was not looking at.
  //
  // Drawn through the component's own path — `PanelMemory.sectionsOf` and the `flat` it memorises — rather
  // than through the test helper, because the fast path the bug lived in is only ever handed the memorised
  // array: a helper that sections the view itself cannot show an accepted order diverging from `orderPins`.
  //
  // Both pins are facts, so one section, and the drawn order is the ranking's: the unreplied pin leads its
  // answered twin whatever their ids. Selection 0 is therefore the pin still asking — the one that used to
  // sink below the bar whenever the guard accepted a view whose newer pin had been answered first.
  const view = [levelPin(5, "answered note", "info", true), levelPin(4, "new note", "info")];
  const barRows = componentRows(view, 0).filter((row) => row.includes("["));
  expect(barRows).toHaveLength(1);
  expect(barRows[0]).toContain("new note");
  expect(barRows[0]).toContain("#4");
});

test("the frame's counts are the very sections its rows were laid out from", () => {
  // One sectioning per frame, end to end. `framed` hands the layout a grouping and the builder the same one
  // on the content it draws, so the top border's counts and the headings in the window it drew cannot be two
  // readings of the view: for the mixed view the title prints 2 warnings, 2 that need you and 3 facts, and
  // the table the same call returned holds exactly those three sections' worth of pin rows.
  const { lines, layout } = framed(
    { pins: mixedView(), selection: 0, focused: true, replyHint: "", ageNow: LATER },
    WIDTH,
    style,
  );
  expect(lines[0]).toContain("📌 Pinned · 2 warnings · 2 needs you · 3 more");
  // The sections the layout carries out are the ones the frame printed counts for: three, in drawn order,
  // with the row table holding one heading per section and one row per pin.
  expect(layout.sections.map((section) => [section.kind, section.pins.length])).toEqual([
    ["warning", 2],
    ["action", 2],
    ["info", 3],
  ]);
  expect(layout.owned.filter((entry) => entry.pin === null)).toHaveLength(3);
  expect(layout.owned.filter((entry) => entry.pin !== null)).toHaveLength(7);
});

test("an unfocused panel draws headings and no bar", () => {
  const rows = contentRows(frameOf(mixedView(), 0, false));
  expect(rows.filter((row) => row.includes("Warnings"))).toHaveLength(1);
  expect(rows.filter((row) => row.includes("["))).toHaveLength(0);
});

test("every heading row is measured to the frame's width like the pins beside it", () => {
  for (const width of [33, 40, 60]) {
    const lines = built(
      { pins: mixedView(), selection: 0, focused: true, replyHint: "", ageNow: LATER },
      width,
      noBar,
    );
    for (const line of lines) expect(visibleWidth(line)).toBe(width);
  }
});
