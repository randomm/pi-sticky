/**
 * The two coordinates the expansion is *not* made of: the key gate, and the window's budget.
 *
 * `test/panel-compact-expand-frame.test.ts` draws the expansion at the bar and off it. These two cases move
 * the levers that file holds constant:
 *
 * - **The key gate.** Under `PI_STICKY_PANEL=open` the cell keeps answering the full frame after the earned
 *   open ended while `dispatchPanelKey` hands every key back, so a focused component can sit inside a frame
 *   that takes no keys. A pin whose digits no keystroke reaches has no reason to show them, and the frame's
 *   table has to stay collapsed. `keys` on the frame request (`test/panel-frame.ts`) is that lever.
 * - **The window's budget.** The heading rule (`panelWindowOffset`) keeps a section's heading only while it
 *   and *every* row of the selected pin fit; expansion is what made that rule bite, because a compact pin
 *   first owned several rows under the bar. The synthetic arithmetic is
 *   `test/panel-window-heading.test.ts`; what only a drawn frame shows is that the budget the window is
 *   fitted against is the expanded row count — and that a frame the terminal caps still draws *exactly* the
 *   height the layout counted, no matter how tall the expanded entry is.
 */
import { expect, test } from "bun:test";

import { visibleWidth } from "@earendil-works/pi-tui";

import { BORDER_ROWS } from "../src/panel-height.ts";
import type { PanelStyle } from "../src/render.ts";
import type { ViewPin } from "../src/types.ts";
import { LATER } from "./fixtures.ts";
import { built, framed } from "./panel-frame.ts";
import { levelPin } from "./panel-sections-fixture.ts";
import { contentRows } from "./panel-window-fixture.ts";

/** The label the info section's heading row prints (`panel-section-headings.ts`). */
const HEADING = { info: "FYI" } as const;

const style: PanelStyle = {
  header: (s) => s,
  marker: (_level, s) => s,
  dim: (s) => s,
  selected: (s) => `[${s}]`,
  border: (s) => s,
  borderFocused: (s) => s,
};

const WIDTH = 60;
const TALL = 100;

/** The four labels the border names digits for. */
const OPTIONS = ["Passed on", "Not yet", "Escalated to the on-call", "Deferred to next quarter"];

/** The text: long enough that no frame the panel draws leaves it on one row. */
const TEXT = (id: number): string => `${"decide ".repeat(12)}keep provider A ${id}`;

const compactPin = (id = 1): ViewPin => ({
  ...levelPin(id, TEXT(id), "info"),
  compact: true,
  options: OPTIONS,
});

/** The compact pin under the bar, beside a warning that keeps the frame's two headings honest. */
const view = (pin: ViewPin): ViewPin[] => [pin, levelPin(2, "a plain note", "warning")];
/** The compact pin is selection 1 of `view`; the companion fact is selection 0. */
const ON_PIN = 1;
const OFF_PIN = 0;

/** The table of a frame drawn for `pins` with the bar on `selection`, focused or not. */
const table = (pins: readonly ViewPin[], selection: number, focused: boolean) =>
  framed({ pins, selection, focused, replyHint: "", ageNow: LATER }, WIDTH, style, TALL).layout
    .owned;

/** The window rows of a frame drawn for `pins` with the bar on `selection`, taking keys (the host's answer). */
const rows = (pins: readonly ViewPin[], selection: number, focused = true): string[] =>
  rowsAt(pins, selection, focused, TALL);

/** `rows` at a named terminal height — the height the window rule and the frame's ceiling are fitted against. */
const rowsAt = (
  pins: readonly ViewPin[],
  selection: number,
  focused: boolean,
  terminalRows: number,
): string[] =>
  contentRows(
    built({ pins, selection, focused, replyHint: "", ageNow: LATER }, WIDTH, style, terminalRows),
  );

test("an open frame that may not take keys expands nothing, however it is focused", () => {
  // The gate is a term of the expansion and not a decoration on the frame: under `PI_STICKY_PANEL=open` the
  // cell keeps answering the full frame after the earned open ended, and `dispatchPanelKey` hands every key
  // back to the editor. A pin whose digits no keystroke reaches has no reason to show them, and an entry that
  // grew there would be an entry the user can look at and do nothing with. The `keys` lever lives on the
  // frame request (`test/panel-frame.ts`), so this is the same view, the same bar and the same focus with one
  // host answer moved.
  const pins = view(compactPin());
  const focused = rows(pins, ON_PIN, true);
  expect(focused.length).toBeGreaterThan(rows(pins, OFF_PIN, true).length);
  const resting = contentRows(
    built(
      { pins, selection: ON_PIN, focused: true, replyHint: "", ageNow: LATER, keys: false },
      WIDTH,
      style,
      TALL,
    ),
  );
  // Collapsed: the pin owns one cut row and the tail of its text appears nowhere — which is the whole
  // assertion. (It is not compared to the unfocused frame's lines, which differ by the bar the focus flag
  // still draws: `content.focused` is `keysLive`'s answer and the drawer's bar obeys it, while the frame
  // request above says the component *is* focused.)
  expect(resting.filter((row) => row.includes("#1"))).toHaveLength(1);
  expect(resting.join("\n")).not.toContain("keep provider A 1");
});

test("the window keeps every row of the expanded pin and drops the heading instead", () => {
  // The numeric statement of the heading rule at the frame level: the synthetic arithmetic lives in
  // `test/panel-window-heading.test.ts`, and what only a drawn frame can show is that the row count the
  // window is fitted against is the *expanded* one. `ROWS` below is the selected pin's own row count read
  // off the table, so the two budgets are named relative to it — one row under, exactly enough — and the
  // heading is the row that goes, never a row of the pin.
  const pins = [compactPin()];
  const owned = table(pins, 0, true).filter((entry) => entry.pin === 0);
  const rows = owned.length;
  expect(rows).toBeGreaterThan(2);
  // The frame's content budget is the terminal's half less the two borders, so the terminal that leaves the
  // window exactly `budget` rows is `budget + BORDER_ROWS` doubled — spelled here rather than remembered.
  const terminalFor = (budget: number): number => (budget + BORDER_ROWS) * 2;
  // Exactly enough room for the pin's own rows: every one of them is drawn, all of the text and its digits.
  const enough = contentRows(
    built(
      { pins, selection: 0, focused: true, replyHint: "", ageNow: LATER },
      WIDTH,
      style,
      terminalFor(rows),
    ),
  );
  expect(enough).toHaveLength(rows);
  expect(enough.join("\n")).toContain("keep provider A 1");
  expect(enough.join("\n")).toContain("4 Deferred to next quarter");
  // One row short, and the entry is still whole: a label never costs the selected pin a row of its text, so
  // what the window gives up is the heading above it.
  const short = contentRows(
    built(
      { pins, selection: 0, focused: true, replyHint: "", ageNow: LATER },
      WIDTH,
      style,
      terminalFor(rows - 1),
    ),
  );
  expect(short).toHaveLength(rows - 1);
  expect(short.filter((row) => row.includes(HEADING.info))).toHaveLength(0);
  expect(short.some((row) => row.includes("#1"))).toBe(true);
});

test("a compact pin expanded in a short terminal draws exactly the frame the layout counted", () => {
  // The ceiling is the one thing an expanded entry can push a frame against: `panelFrameRows` puts the two
  // border rows over the table and cuts the result at half the terminal, and `buildPanelLines` draws the
  // `height` it was handed rather than counting one of its own. So a tall entry in a short terminal must come
  // back as *exactly* the layout's height — not the table's row count (that would draw past the screen) and
  // not one row less (that would be an open box). Every figure below is read off the layout the frame was
  // built from, so neither number is one this file invented.
  const pins = view(compactPin());
  // Well below the expanded table, so the entry's rows are scrolled by the window rather than drawn whole —
  // the ceiling case drawn through the file's own helper, at the same terminal the layout is counted for.
  const drawn = rowsAt(pins, ON_PIN, true, 10);
  const { lines, layout } = framed(
    { pins, selection: ON_PIN, focused: true, replyHint: "", ageNow: LATER },
    WIDTH,
    style,
    10,
  );
  expect(drawn).toEqual(contentRows(lines));
  expect(lines.length).toBe(layout.height);
  // The ceiling really bites at this terminal: the table is taller than the frame the layout counted, which is
  // what makes the equality above a statement about the cap and not about a frame that never needed one.
  expect(layout.owned.length).toBeGreaterThan(layout.height);
  // The content rows are the frame less its two borders, and the border glyphs close the box: a frame that
  // drew the whole table here would be taller than the terminal that holds it.
  expect(drawn).toHaveLength(layout.height - BORDER_ROWS);
  expect(lines[0]).toContain("╭");
  expect(lines.at(-1)).toContain("╰");
  // …and every drawn line still measures the frame's width at the ceiling, which is the promise a flush-right
  // overlay makes to the chat beside it while the expanded entry scrolls.
  for (const line of lines) expect(visibleWidth(line)).toBe(WIDTH);
});
