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
import { visibleWidth } from "@earendil-works/pi-tui";

import type { PanelStyle as RenderPanelStyle } from "../src/render.ts";
import { LATER } from "./fixtures.ts";
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
