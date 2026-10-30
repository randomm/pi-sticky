/**
 * The optional fields (`group`, `options`, `compact`) as the *open panel* draws them: group headings, the
 * options row, and the frame title's level counts in the presence of groups.
 *
 * The frame is drawn through `test/panel-frame.ts`, the one way a test pairs the row table with the drawer,
 * so what these tests assert on is the frame the component would put on screen — the same sectioning feeds
 * the headings, the title's counts and the flattened list the selection indexes.
 *
 * Four promises:
 *
 * 1. A **group heading** names the group, carries no level glyph (a group mixes levels) and lines up with the
 *    pin text under it.
 * 2. A **counting section** — a level whose every pin lives in a group — prints no heading and owns no rows,
 *    yet the title still counts its level.
 * 3. An **options row** is one row belonging to its pin, and the bar, `d` and `Enter` still address the pin.
 * 4. **Every row closes at the frame's width**, options row included, whatever the option labels hold.
 */
import { expect, test } from "bun:test";

import { visibleWidth } from "@earendil-works/pi-tui";

import { ELLIPSIS } from "../src/panel-frame.ts";
import type { PanelStyle } from "../src/render.ts";
import type { ViewPin } from "../src/types.ts";
import { LATER } from "./fixtures.ts";
import { built, framed } from "./panel-frame.ts";
import { levelPin } from "./panel-sections-fixture.ts";
import { barRowOf, contentRows } from "./panel-window-fixture.ts";

/** Identity colours with a bar visible in the drawn string. */
const style: PanelStyle = {
  header: (s) => s,
  marker: (_level, s) => s,
  dim: (s) => s,
  selected: (s) => `[${s}]`,
  border: (s) => s,
  borderFocused: (s) => s,
};

const WIDTH = 60;

/** The selection marker, spelled from its code point: a literal of it in source is rewritten on the way in. */
const SELECTED = String.fromCodePoint(0x203a);
/** The action level's own glyph, which the ungrouped pin of the counting-section test draws. */
const LEVEL_GLYPH = "?";

/**
 * The glyph a drawn row puts in its marker column, `""` for a row that draws none.
 *
 * The row table pads an unfocused marker to two columns and the selection marker keeps that width, so the
 * column is read by code point and compared on its first character — `includes` over the whole line would
 * also match a glyph inside a pin's text or a padded tail.
 */
const markerColumn = (row: string): string => {
  const inner = row
    .replace(/\u2502/g, "")
    .replace(/[[\]]/g, "")
    .replace(/\s+$/, "");
  const first = [...inner].find((cell) => cell !== " ") ?? "";
  return first === SELECTED || LEVEL_GLYPHS.has(first) ? first : "";
};

const LEVEL_GLYPHS = new Set(["!", "?", "\u2022"]);

/** The one row of `rows` that draws a marker column — a pin's first row, never a heading. */
const markerRow = (rows: string[]): string =>
  rows.find((row) => row.includes(SELECTED) || row.includes(LEVEL_GLYPH)) ?? "";

/** The options row a single pin draws in a frame of `width`, which is the row beneath its own. */
const optionsRowOf = (pins: ViewPin[], width: number): string => {
  const rows = frameOf(pins, 0, width);
  return rows[rows.length - 1] ?? "";
};

/** `levelPin` plus the fields under test. */
const pin = (
  id: number,
  level: ViewPin["level"],
  extra: Partial<Pick<ViewPin, "group" | "options" | "compact">> = {},
): ViewPin => ({ ...levelPin(id, `pin ${id}`, level), ...extra });

const frameOf = (pins: ViewPin[], selection = 0, width = WIDTH) =>
  contentRows(
    built({ pins, selection, focused: true, replyHint: "", ageNow: LATER }, width, style),
  );

/** The frame's title — its first line — for `pins`. */
const titleOf = (pins: ViewPin[]): string =>
  built({ pins, selection: 0, focused: true, replyHint: "", ageNow: LATER }, WIDTH, style)[0] ?? "";

test("a group section is headed by the group's own name, with no level glyph", () => {
  const pins = [pin(1, "warning", { group: "Release blockers" }), pin(2, "info")];
  const rows = frameOf(pins);
  const heading = rows[0] ?? "";
  expect(heading).toContain("Release blockers");
  // The name sits exactly where a level heading's *word* sits — the `FYI` of `• FYI` — and so one column
  // right of the markers its own rows open with. A group's heading is a label in the level heading's seat,
  // with the glyph's columns given back as indentation; at the marker's column it would read as a pin.
  const levelHeading = rows.find((row) => row.includes("FYI")) ?? "";
  expect(heading.indexOf("Release")).toBe(levelHeading.indexOf("FYI"));
  // The frame is drawn focused, so the pin’s marker column carries the selection marker rather than the
  // warning’s `!` (#70 decision 2) — the same column either way, which is what this comparison is about.
  // `markerRow` picks the row that draws a marker, which is the pin’s own row and not the heading over it.
  expect(heading.indexOf("Release")).toBe(markerRow(rows).indexOf(SELECTED) + 2);
  // No level’s mark stands for a group that mixes them, and no `!` is drawn anywhere in this frame:
  // the warning’s own row is the bar’s row, so its glyph has been exchanged for the marker there.
  expect(heading).not.toContain("!");
  expect(rows.join("")).not.toContain("!");
  expect(markerRow(rows)).toContain(`${SELECTED} pin 1`);
});

test("a group whose name is hostile text draws as text and closes at the width", () => {
  const hostile = pin(1, "info", { group: "\u001b[31mred\u001b[0m # heading\nsecond line" });
  // A companion of another level, so the view has two drawn sections. One section draws no heading at all
  // (spec 3.5), so a lone grouped pin's frame would have no heading row left for this to be a promise about.
  const rows = frameOf([hostile, pin(2, "info")]);
  expect(rows).toHaveLength(4);
  for (const row of rows) expect(visibleWidth(row)).toBe(WIDTH);
  // Read for its own word rather than by position: which of the two sections leads is ranking's answer, not
  // this test's.
  const heading = rows.find((row) => row.includes("red")) ?? "";
  expect(heading).not.toContain("\u001b");
  // The break is folded into the heading's own line rather than becoming a second row of the frame: the
  // builder hands each line to `fitLine` and cannot tell a folded name from a short one.
  expect(heading).toContain("red # heading second line");
});

test("a level whose pins are all grouped owns no rows and no heading, yet the title counts it", () => {
  // The view's only warning and its only fact both live in a group, and the action pin is ungrouped: the
  // frame draws two headings (the group's, `Needs you`'s) and three pins, and the two empty counting
  // sections contribute nothing at all — no heading row, no pin row, nothing for the bar to be parked on.
  const pins = [
    pin(1, "warning", { group: "Now" }),
    pin(2, "info", { group: "Now" }),
    pin(3, "action"),
  ];
  const rows = frameOf(pins);
  expect(rows).toHaveLength(5);
  expect(rows[0]).toContain("Now");
  // The warning's marker column is the selection marker's, because this pin owns the bar's row: the
  // counting section drew no heading, and the frame's only level glyph is the ungrouped action pin's own.
  // The marker is drawn once, on the warning's row, and nowhere else in the frame.
  expect(rows.filter((row) => row.includes(SELECTED))).toHaveLength(1);
  expect(markerColumn(rows[barRowOf(rows)] ?? "")).toBe(SELECTED);
  expect(rows.filter((row) => markerColumn(row) === LEVEL_GLYPH)).toHaveLength(2);
  // ...and the frame's title still names both grouped levels, which is the only thing those sections do.
  expect(titleOf(pins)).toContain("1 warning");
  expect(titleOf(pins)).toContain("1 needs you");
  // A counting section owns no rows: nothing in the table is tagged by a pin that is not drawn once.
  const { layout } = framed(
    { pins, selection: 0, focused: true, replyHint: "", ageNow: LATER },
    WIDTH,
    style,
  );
  expect(layout.owned.filter((entry) => entry.pin === 0)).toHaveLength(1);
});

test("the options row is one row of its pin, and the bar still lands on the pin", () => {
  const pins = [pin(1, "action", { options: ["Passed on", "Not yet"] }), pin(2, "info")];
  const rows = frameOf(pins);
  // Heading, pin 1, its options, heading, pin 2.
  expect(rows).toHaveLength(5);
  const options = rows[2] ?? "";
  expect(options).toContain("1 Passed on");
  expect(options).toContain("2 Not yet");
  // The row is one row of the table: at the bar's selection the highlight covers the pin's own row, never
  // its options — `d` and `Enter` address a pin, and a bar parked on its option row would answer neither.
  // Heading, pin 1, its options ...
  expect(barRowOf(rows)).toBe(1);
  const unowned = framed(
    { pins, selection: 0, focused: true, replyHint: "", ageNow: LATER },
    WIDTH,
    style,
  ).layout.owned;
  // The options row is *owned* by the pin, which is what makes the window, the bar and the keys agree.
  expect(unowned[2]?.pin).toBe(0);
});

test("the digits the frame draws are the positions in the pin's option list, across the wrapped rows", () => {
  // The row table (`optionRows`, `panel-rows.ts`) and the drawer (`fillOptionRow`, `panel-options-row.ts`) read
  // the same field through the same packing (`panel-options-wrap.ts`) and must agree about it: the user answers a
  // pin by typing the digit beside a label, so a table that reserved rows the drawer filled differently — or a
  // drawer that renumbered the entries it kept — sends the answer to an option the user never saw. What the
  // single-row drawer used to do at these widths (drop entries 3 and 4) is now what the wrap does with them:
  // pack them onto the rows below, each keeping the digit of its own position.
  const options = ["a", "a label much too wide for this frame", "c", "d"];
  // One pin, so the frame is its row and its options rows beneath it — no section heading above them.
  const rows = frameOf([pin(1, "info", { options })], 0, 48);
  const drawn = rows.slice(1).join("\n");
  // Entries 1 and 2 close inside the first row; 3 and 4 are packed onto the next.
  expect(drawn).toContain("1 a");
  expect(drawn).toContain("2 a label much too wide for this frame");
  expect(drawn).toContain("3 c");
  expect(drawn).toContain("4 d");
  // At the narrowest width the builder closes, the wide label is the entry that has to give columns up: it keeps
  // its digit — that digit is the key the user presses — and the label ends in the wrap's ellipsis. No entry is
  // numbered by how many fitted before it.
  const narrowRows = frameOf([pin(1, "info", { options })], 0, 34);
  const narrow = narrowRows.slice(1).join("\n");
  expect(narrow).toContain("1 a");
  expect(narrow).toContain("2 a label much too wide fo");
  expect(narrow).toContain(ELLIPSIS);
  expect(narrow).not.toContain("2 a label much too wide for this frame");
  // And in order: the digit beside each label is that label's 1-based position, never the count of the
  // labels that happened to fit before it — and an entry the rows gave up leaves nothing half-drawn behind.
  const named = (row: string, index: number): boolean =>
    row.includes(`${index + 1} ${options[index]}`);
  options.forEach((label, index) => {
    expect(drawn.includes(`${index + 1} ${label}`)).toBe(true);
    // At 34 the wide entry is the one the wrap cut, so only that entry is not whole on a row of its own.
    expect(narrowRows.some((row) => named(row, index))).toBe(index !== 1);
  });
});

test("a pin with no options has no options row", () => {
  const rows = frameOf([pin(1, "info")]);
  // One row and nothing else: a single-section view draws no heading, and a pin with no options reserves no
  // row — the frame is the byte-for-byte plain list it was before any of this existed.
  expect(rows).toHaveLength(1);
  // Neither the keycap glyph #70 dropped nor any digit: the pin has no options, so the row is not drawn.
  expect(rows.join("")).not.toContain("1)");
});

test("the options row closes at the frame's width at every width the panel draws at", () => {
  const pins = [
    pin(1, "info", {
      options: ["Passed on", "Not yet", "Escalated to the on-call", "Deferred to next quarter"],
    }),
  ];
  for (const width of [100, 80, 60, 44]) {
    const lines = built(
      { pins, selection: 0, focused: true, replyHint: "", ageNow: LATER },
      width,
      style,
    );
    for (const row of lines) expect(visibleWidth(row)).toBe(width);
  }
});

test("compact changes how many rows the pin owns, which is how the user sees it", () => {
  // The flag's whole effect on screen is a row count, and the frame it is counted in is the frame the bar is
  // *not* on: the pin beside the bar is the one pin a compact entry is drawn long for (`test/panel-compact-
  // expand-frame.test.ts`), so this pair has to draw the two pins with the bar on neither of them — which is
  // what a second, plain pin takes the bar off to.
  // The companion is a *warning*: the drawn order ranks warnings first, so the bar at selection 0 rests on
  // it and both shapes of the long pin are read with the bar on neither of them.
  const long = (id: number): ViewPin => ({
    ...levelPin(id, "x".repeat(300), "info"),
    compact: true,
  });
  const companion: ViewPin = levelPin(9, "the pin the bar is on", "warning");
  // The continuation rows carry no id — only the pin's first row prints its stamp — so the owner is the row
  // the id is on and the rows under it that belong to the same entry: counted the way the window counts them,
  // which is between this pin's row and the next section's heading or the frame's end.
  const rowsOf = (pin: ViewPin): number => {
    const rows = frameOf([pin, companion]);
    const own = rows.findIndex((row) => row.includes(`#${pin.id}`));
    let last = own;
    while (last + 1 < rows.length && !rows[last + 1]?.includes("#")) last++;
    return last - own + 1;
  };
  const [compactRows, plainRows] = [rowsOf(long(1)), rowsOf(levelPin(1, "x".repeat(300), "info"))];
  expect(compactRows).toBe(1);
  expect(plainRows).toBeGreaterThan(3);
  // A compact pin whose text fits is indistinguishable from a plain one — the flag adds no marker to draw.
  expect(frameOf([pin(1, "info", { compact: true }), companion]).join("\n")).toContain("pin 1");
});

test("a compact pin the bar is not on draws its text cut, not wrapped, and keeps its id's seat", () => {
  // The collapsed half of the flag, drawn: one row, its id on it, and the row closed at the frame's width with
  // its ellipsis — the expansion belongs to the pin under the bar alone.
  const rows = frameOf([
    { ...levelPin(1, "x".repeat(300), "info"), compact: true },
    levelPin(9, "the pin the bar is on", "warning"),
  ]);
  const own = rows.filter((row) => row.includes("#1"));
  expect(own).toHaveLength(1);
  expect(own[0]).toContain("#1");
  // Cut, not run over: the row closes at the frame's width with its ellipsis.
  expect(visibleWidth(own[0] ?? "")).toBe(WIDTH);
});
