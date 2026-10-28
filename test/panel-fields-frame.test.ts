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

/** `levelPin` plus the fields under test. */
const pin = (
  id: number,
  level: ViewPin["level"],
  extra: Partial<Pick<ViewPin, "group" | "options" | "compact">> = {},
): ViewPin => ({ ...levelPin(id, `pin ${id}`, level), ...extra });

const frameOf = (pins: ViewPin[], selection = 0) =>
  contentRows(
    built({ pins, selection, focused: true, replyHint: "", ageNow: LATER }, WIDTH, style),
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
  expect(heading.indexOf("Release")).toBe((rows[1] ?? "").indexOf("!") + 1);
  // No level's mark stands for a group that mixes them: the warning's `!` belongs to the pin's own row.
  expect(heading).not.toContain("!");
  expect(rows[1]).toContain("! pin 1");
});

test("a group whose name is hostile text draws as text and closes at the width", () => {
  const hostile = pin(1, "info", { group: "\u001b[31mred\u001b[0m # heading\nsecond line" });
  const rows = frameOf([hostile]);
  expect(rows).toHaveLength(2);
  for (const row of rows) expect(visibleWidth(row)).toBe(WIDTH);
  const heading = rows[0] ?? "";
  expect(heading).not.toContain("\u001b");
  // The break is folded into the heading's own line rather than becoming a second row of the frame: the
  // builder hands each line to `fitLine` and cannot tell a folded name from a short one.
  expect(heading).toContain("red # heading second line");
});

/**
 * Sequences that are an *escape* to the panel's own policy (`stripSequences`, `escape.ts`) and printable
 * columns to pi-tui's `visibleWidth` — the one class of text a width measured on the raw string cannot be
 * trusted for. Each is padded with the word that must not reach the screen: a cut that trusted pi-tui's
 * measurement would print the payload, and a row that trusted nothing would spill its column.
 */
const UNTRUSTED = [
  ["unterminated OSC", "\u001b]8;;http://evil"],
  ["OSC without its BEL", "\u001b]2;a title"],
  ["unterminated DCS", "\u001bP++++"],
  ["lone introducer", "\u001b_"],
] as const;

test("a group name whose escapes the terminal counts as printable cannot widen the frame", () => {
  for (const [name, sequence] of UNTRUSTED) {
    const rows = frameOf([pin(1, "info", { group: `G${sequence}${"PAYLOAD".repeat(20)}` })]);
    // The heading owns one row whatever the sequence did to the measurement, and it closes at the width.
    expect(rows, name).toHaveLength(2);
    for (const row of rows) expect(visibleWidth(row), name).toBe(WIDTH);
    expect(rows.join(""), name).not.toContain("PAYLOAD");
    // The name is still the name: what the cut removes is the sequence and its payload, not the group.
    expect(rows[0] ?? "", name).toContain("G");
  }
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
  // The warning's `!` appears once, on its pin's row: the counting section drew no heading for it.
  expect(rows.filter((row) => row.includes("! "))).toHaveLength(1);
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
  expect(options).toContain("⌨1 Passed on");
  expect(options).toContain("⌨2 Not yet");
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

test("a pin with no options has no options row", () => {
  const rows = frameOf([pin(1, "info")]);
  // One row and nothing else: a single-section view draws no heading, and a pin with no options reserves no
  // row — the frame is the byte-for-byte plain list it was before any of this existed.
  expect(rows).toHaveLength(1);
  expect(rows.join("")).not.toContain("⌨");
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

test("an option carrying an escape buys no free columns", () => {
  const smuggled = `a\u001b[1m${"x".repeat(200)}\u001b[0m`;
  const pins = [pin(1, "info", { options: [smuggled, "b"] })];
  const lines = built(
    { pins, selection: 0, focused: true, replyHint: "", ageNow: LATER },
    60,
    style,
  );
  for (const row of lines) expect(visibleWidth(row)).toBe(60);
  expect(lines.join("")).not.toContain("\u001b[1m");
});

/** An option label whose escape pi-tui counts as printable, padded with the word that must not be drawn. */
const hostileOption = (sequence: string): string => `o${sequence}${"PAYLOAD".repeat(20)}`;

test("an option whose escapes the terminal counts as printable cannot widen the frame", () => {
  for (const [name, sequence] of UNTRUSTED) {
    const lines = built(
      {
        pins: [pin(1, "info", { options: [hostileOption(sequence), "b"] })],
        selection: 0,
        focused: true,
        replyHint: "",
        ageNow: LATER,
      },
      WIDTH,
      style,
    );
    // The frame is the same number of rows it would be for a clean label — an escape buys a row neither by
    // widening one nor by splitting one — and none of its rows prints the sequence's payload.
    expect(lines, name).toHaveLength(4);
    for (const row of lines) expect(visibleWidth(row), name).toBe(WIDTH);
    expect(lines.join(""), name).not.toContain("PAYLOAD");
  }
});

test("compact changes how many rows the pin owns, which is how the user sees it", () => {
  // The flag has no glyph of its own: what it buys is one row instead of many, and a frame whose window is
  // not spent on a wall of text. Asserting on the row count is asserting on the only effect it has on screen.
  const long = (id: number) => ({ ...levelPin(id, "x".repeat(300), "info"), compact: true });
  const [compactRows, plainRows] = [
    frameOf([long(1)]).length,
    frameOf([levelPin(1, "x".repeat(300), "info")]).length,
  ];
  expect(compactRows).toBe(1);
  expect(plainRows).toBeGreaterThan(3);
  // A compact pin whose text fits is indistinguishable from a plain one — the flag adds no marker to draw.
  expect(frameOf([pin(1, "info", { compact: true })])[0]).toContain("pin 1");
});

test("a compact pin's text is cut, not wrapped, and its id keeps its seat", () => {
  const rows = frameOf([{ ...levelPin(1, "x".repeat(300), "info"), compact: true }]);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toContain("#1");
  // Cut, not run over: the row closes at the frame's width with its ellipsis.
  expect(visibleWidth(rows[0] ?? "")).toBe(WIDTH);
});
