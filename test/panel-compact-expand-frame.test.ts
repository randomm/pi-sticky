/**
 * The open frame's half of compact expand-on-select: what the user sees when the bar moves onto a compact
 * pin, and what goes back when it moves off.
 *
 * `test/panel-field-rows.test.ts` asserts the row table's argument; this file draws the frame the argument
 * reaches the screen through, via `built`/`framed` (`test/panel-frame.ts`) — one sectioning, one
 * `panelLayoutSections` pass, and the builder handed that very table. The distinction is the point: the
 * expansion changes the *height* the frame was counted at, the rows the window cuts and the digits the bottom
 * border advertises, and a table that expanded while the drawer cut the collapsed rows would pass a row-count
 * test and draw a frame whose lines do not measure its own width.
 *
 * Four states of one golden pin, drawn side by side: unfocused, focused with the bar elsewhere, focused with
 * the bar on it, and the same pin without the flag. The first three of those draw the identical collapsed
 * entry, and only the third may differ from the fourth — which is the whole rule in one assertion.
 */
import { expect, test } from "bun:test";
import { visibleWidth } from "@earendil-works/pi-tui";

import { BORDER_ROWS } from "../src/panel-height.ts";
import { optionRowCount } from "../src/panel-options-wrap.ts";
import type { PanelStyle } from "../src/render.ts";
import type { ViewPin } from "../src/types.ts";
import { LATER } from "./fixtures.ts";
import { built, framed } from "./panel-frame.ts";
import { levelPin } from "./panel-sections-fixture.ts";
import { barRowOf, componentAt, contentRows } from "./panel-window-fixture.ts";

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

/** Tall enough that the window is the whole table: these cases are about which rows exist, not which are scrolled. */
const TALL = 100;

/** The four labels the border names digits for, and the rows the collapsed entry pays for. */
const OPTIONS = ["Passed on", "Not yet", "Escalated to the on-call", "Deferred to next quarter"];

/** The text: long enough that no frame the panel draws leaves it on one row. */
const TEXT = (id: number): string => `${"decide ".repeat(12)}keep provider A ${id}`;

const compactPin = (id = 1): ViewPin => ({
  ...levelPin(id, TEXT(id), "info"),
  compact: true,
  options: OPTIONS,
});

const plainPin = (id = 1): ViewPin => ({ ...levelPin(id, TEXT(id), "info"), options: OPTIONS });

/** The content rows of a frame drawn for `pins` with the bar on `selection`, focused or not. */
const rows = (pins: readonly ViewPin[], selection: number, focused = true): string[] =>
  contentRows(
    built({ pins, selection, focused, replyHint: "", ageNow: LATER }, WIDTH, style, TALL),
  );

const table = (pins: readonly ViewPin[], selection: number, focused = true) =>
  framed({ pins, selection, focused, replyHint: "", ageNow: LATER }, WIDTH, style, TALL).layout
    .owned;

/**
 * The compact pin under the bar, beside a warning that keeps the frame's two-section headings honest.
 *
 * `panelSections` ranks the warning first, so selection 0 is the companion and selection 1 is the compact pin
 * this file is about — spelled out here rather than inferred, because the selection is the coordinate the
 * whole feature turns on.
 */
const view = (pin: ViewPin): ViewPin[] => [pin, levelPin(2, "a plain note", "warning")];
/** The compact pin is selection 1 of `view`; the companion fact is selection 0. */
const ON_PIN = 1;
const OFF_PIN = 0;

test("the expansion needs a compact pin whose collapsed row is narrower than its wrap", () => {
  // The guard every case below leans on: at this frame's width the pin's cut row cannot fit whole, so the wrap
  // necessarily owns more rows than it. Without this the two tables would be equal and the tests would pass
  // over a feature that did nothing.
  const collapsed = table(view(compactPin()), 0, false).filter((entry) => entry.pin === 1);
  // Collapsed: one text row (no `kind` tag) and the options rows its labels need.
  expect(collapsed.filter((entry) => entry.row.kind === undefined)).toHaveLength(1);
  expect(collapsed.filter((entry) => entry.row.kind === "options")).toHaveLength(
    optionRowCount(OPTIONS, WIDTH, style),
  );
});

test("a compact pin draws its full text and its options while the bar sits on it", () => {
  // Ranking's answer decides which selection names the compact pin, so the pair is *located* rather than
  // assumed: the two frames differ by exactly the expansion, and whichever selection produced the taller one
  // is the one the bar was on the compact pin.
  const [collapsed, expanded, pinSelection] = locatedPair();
  // The coordinate the expansion turns on, pinned: the bar has to sit on the compact pin for its entry to
  // grow, and the pair above was taken by height alone — so this is the one place the file names the index
  // it *believes* the compact pin to be, and ranking's answer is what it checks rather than a remembered 1.
  expect(pinSelection).toBe(ON_PIN);
  // Collapsed, the pin owns one cut text row and the options rows its labels need — the drawer's own packing
  // read back, so a change to the wrap moves this line and says so rather than breaking a remembered count.
  expect(collapsed.filter((row) => row.includes("#1"))).toHaveLength(1);
  // The row count is the collapsed pin's cut row and its options rows, plus the companion's row: read off the
  // table of the *unfocused* frame, which expands nothing, so the count is the product's own answer and not a
  // wrap this file would have to duplicate.
  const collapsedTable = table(view(compactPin()), 0, false);
  expect(collapsed).toHaveLength(collapsedTable.length);
  // The view has two drawn sections, so its table carries two heading rows: the count below is a table with
  // headings in it, not a degenerate one-row view.
  expect(collapsedTable.filter((entry) => entry.pin === null)).toHaveLength(2);
  // Expanded, it owns its whole wrapped text, and the frame is byte-for-byte the one the *same* view draws
  // with a non-compact pin: the flag buys rows exactly when the user is looking at the pin and nothing else.
  expect(expanded.length).toBeGreaterThan(collapsed.length);
  expect(expanded).toEqual(rows(view(plainPin()), ON_PIN, true));
  // The options rows are filled and every line closes at the frame's width: the expansion is a wrap of the
  // frame's own arithmetic, not rows the drawer then has to cut.
  const drawn = expanded.join("\n");
  expect(drawn).toContain("1 Passed on");
  expect(drawn).toContain("4 Deferred to next quarter");
  for (const line of built(
    { pins: view(compactPin()), selection: ON_PIN, focused: true, replyHint: "", ageNow: LATER },
    WIDTH,
    style,
    TALL,
  ))
    expect(visibleWidth(line)).toBe(WIDTH);
});

/**
 * The collapsed frame, the expanded frame, and the selection the bar has to be on for the second.
 *
 * `panelSections` ranks the view (newest id first within a level, warnings first across levels), so a test that
 * hardcoded an index would be asserting on ranking's answer as much as on the expansion. The pair is therefore
 * taken as the two frames this view can draw and read for which is taller — and the equality assertions below
 * still name the *same* two frames, so nothing here can pass by comparing a frame with itself. The third
 * element is the bar's coordinate, which is where the expansion starts: `sameFrame` compares `selection`, so
 * an expansion never reaches the cache unless the bar moved onto the pin — and this file cannot observe that
 * directly (its `built`/`framed` helpers are stateless), which is why it reads the coordinate back off the
 * pair instead of trusting a literal.
 */
function locatedPair(): [string[], string[], number] {
  const pins = view(compactPin());
  const first = rows(pins, 0, true);
  const second = rows(pins, 1, true);
  return first.length > second.length ? [second, first, 0] : [first, second, 1];
}

test("moving the bar off the compact pin collapses it again, row for row", () => {
  const both = [compactPin(1), compactPin(2)];
  // The table is the honest measurement: the pin under the bar owns its wrapped text plus its options rows,
  // and the pin beside it owns exactly its collapsed entry — one cut row and the options rows its labels need.
  // The collapsed entry is what the same table draws when the frame takes no keys: the product's own figure,
  // so the comparison below cannot be satisfied by two numbers this file invented.
  const collapsedEntry = table(both, 0, false).filter((entry) => entry.pin === 0).length;
  expect(collapsedEntry).toBeGreaterThan(0);
  // Whichever of the two positions puts the bar on a pin, that pin owns more than its collapsed entry and the
  // other owns exactly it — asserted for both positions, so the rule does not depend on the drawn order.
  for (const selection of [0, 1]) {
    const at = table(both, selection, true);
    const other = selection === 0 ? 1 : 0;
    expect(at.filter((entry) => entry.pin === selection).length).toBeGreaterThan(collapsedEntry);
    expect(at.filter((entry) => entry.pin === other).length).toBe(collapsedEntry);
  }
  // The frame follows the table: the two bar positions draw different frames, and in each the id of the pin
  // the bar has left behind appears on one row only.
  expect(rows(both, 0, true).join("\n")).not.toBe(rows(both, 1, true).join("\n"));
  // The pin the bar has left behind draws its id on one row: the collapsed entry, not the wrapped one.
  const barOnSecond = rows(both, 1, true);
  expect(barOnSecond.filter((row) => row.includes("#1"))).toHaveLength(1);
});

/** The rows one pin owns in the table of a frame that takes no keys — the collapsed entry, by construction. */
function collapsedEntryOf(pins: readonly ViewPin[]): number {
  return table(pins, 0, false).filter((entry) => entry.pin === 0).length;
}

test("an unfocused panel draws a compact pin collapsed at the bar it is not showing", () => {
  const both = [compactPin(1), compactPin(2)];
  // Unfocused, both entries stay collapsed whatever the bar's index — the same frame either way, which is also
  // the peek's answer: a surface with a selection and no bar expands nothing.
  expect(rows(both, 0, false)).toEqual(rows(both, 1, false));
  // Focused with the bar on either pin, one of the two entries grows and the other is the collapsed entry the
  // unfocused frame drew: the bar alone does not expand a pin, only the pin it rests on.
  for (const selection of [0, 1]) {
    const at = table(both, selection, true);
    const other = selection === 0 ? 1 : 0;
    expect(at.filter((entry) => entry.pin === other).length).toBe(collapsedEntryOf(both));
    expect(at.length).toBeGreaterThan(table(both, 0, false).length);
  }
});

test("the digits the focused border names follow the expanded pin", () => {
  // The compact pin's options are invisible while it is collapsed and answered by `1`–`MAX_OPTIONS`
  // (`pin-fields.ts`) the moment the bar reaches it, so the border has to say so — `focusedHint` reads the
  // selected pin's own `options`, and the assertion is on the real count rather than a literal.
  const lines = built(
    { pins: [compactPin()], selection: 0, focused: true, replyHint: "", ageNow: LATER },
    WIDTH,
    style,
    TALL,
  );
  expect(lines.at(-1)).toContain("1–4 answer");
  // …and an option-less compact pin at the bar keeps the plain hint: the expansion does not invent keys.
  const bare = built(
    {
      pins: [{ ...compactPin(), options: undefined }],
      selection: 0,
      focused: true,
      replyHint: "",
      ageNow: LATER,
    },
    WIDTH,
    style,
    TALL,
  );
  expect(bare.at(-1)).not.toContain("answer");
});

test("the expansion does not park the bar on an option row", () => {
  // The options rows belong to the pin (`PanelOwned.pin` stamps them), so an expanded pin owns several rows
  // and one selection: the bar has to sit on the pin's own first row, and `d`/`Enter` still address the pin.
  const { lines, layout } = framed(
    { pins: [compactPin()], selection: 0, focused: true, replyHint: "", ageNow: LATER },
    WIDTH,
    style,
    TALL,
  );
  const drawn = contentRows(lines);
  expect(barRowOf(drawn)).toBe(0);
  expect(drawn[0]).toContain("#1");
  // The rows below the bar are the pin's own options, owned by the pin the bar is on and not selectable.
  // Every row below the pin's first is one of its own — either a continuation of the wrap or a reserved
  // options row — and none of them is what the bar sits on.
  const below = layout.owned.slice(1).filter((entry) => entry.pin === 0);
  expect(below.length).toBeGreaterThan(0);
  // A continuation row carries the age (`pinTails` gives it the second slot) and no marker, which is what
  // distinguishes it from the pin's first row — the only row `d`/`Enter` and the bar address.
  expect(below.every((entry) => entry.row.markerLevel === undefined)).toBe(true);
});

test("the frame the component draws is the whole expanded entry, heading included", () => {
  // The window rule (`panelWindowOffset`) keeps a heading only while it and *every* row of the selected pin
  // fit — a rule that was nearly vacuous while a compact pin owned one row, and expansion is what first put
  // several rows of one pin behind it. The synthetic arithmetic is in `test/panel-window-heading.test.ts`;
  // what is only visible here is the frame the component itself draws agreeing with it.
  const pair = [compactPin(), levelPin(2, "a plain note", "warning")];
  // The component sizes its frame from the TUI it was built with, so the height has to be handed to it here
  // rather than to `built`: 40 rows is well past twice this view's table, which is the point — the whole
  // table fits, nothing is scrolled.
  const roomy = componentAt(pair, ON_PIN, WIDTH, style, 40);
  // The whole table is on screen — nothing scrolled away at this height — so what follows is about the entry,
  // not the window. The figure is the layout's own row count over the borders, not a remembered line count.
  expect(roomy.lines).toHaveLength(
    framed(
      { pins: pair, selection: ON_PIN, focused: true, replyHint: "", ageNow: LATER },
      WIDTH,
      style,
      40,
    ).layout.owned.length + BORDER_ROWS,
  );
  // The label of the pin's own section sits above the bar, and the bar is on the pin's *first* row: an
  // expansion that pushed the bar onto a continuation row would move `d`/`Enter` off the pin they address.
  const bar = barRowOf(roomy.rows);
  expect(roomy.rows[bar]).toContain("#1");
  expect(roomy.rows.slice(0, bar).filter((row) => row.includes(HEADING.info))).toHaveLength(1);
  // Its text is drawn whole — the last words of it are on screen, where the collapsed drawer cut them with
  // the ellipsis — and its options rows follow, all of it owned by the one selection.
  const joined = roomy.rows.join("\n");
  expect(joined).toContain("keep provider A 1");
  expect(joined).toContain("4 Deferred to next quarter");
  // …and with the bar moved off it the same view collapses back: the text is cut again, in one row.
  const elsewhere = componentAt(pair, OFF_PIN, WIDTH, style, 40);
  expect(elsewhere.rows.filter((row) => row.includes("keep provider A 1"))).toHaveLength(0);
  expect(elsewhere.rows.filter((row) => row.includes("decide"))).toHaveLength(1);
});
