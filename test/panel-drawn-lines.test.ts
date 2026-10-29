/**
 * What a *themed* frame draws, line by line, once the theme's own colours are allowed on the screen (#70).
 *
 * `panel-lines-hostile.test.ts` asks whether a hostile theme can put a byte on the screen. This file asks
 * the two questions the fix owes: whether the colour a theme asked for actually *reaches* the drawn bytes
 * (it did not, before #70 — every branch of `fitLine` stripped the row, the bar's included), and whether
 * the selection marker marks the row the bar sits on and no other. The line-end reset discipline is the
 * other half of the same fix and lives in `panel-frame-resets.test.ts`.
 *
 * Three things are asserted on the frames this file draws:
 *
 * 1. **The theme's SGR survives**, on the row the bar sits on and nowhere else, and moves with the keys.
 * 2. **The `›` marker marks the bar's row only**, focused, at the resting frame's widths, and leaves no
 *    orphaned colour parameters behind when the theme coloured the glyph it replaces.
 * 3. **No non-SGR escape survives** a theme that emitted one from every member — the sweep is
 *    `drawnOffenders` (`panel-hostile.ts`), the SGR-tolerant sibling of the unconditional `offenders`.
 *
 * Every escape is spelled from code points: a literal written into a source file is rewritten on the way
 * in, and an escape assertion against a rewritten literal is vacuous whenever both sides agree by accident.
 */
import { expect, test } from "bun:test";

import { SELECTION_MARKER } from "../src/panel-frame.ts";
import {
  BAR,
  BORDER_FOCUSED,
  DIM,
  E,
  KEYCAP,
  WARNING,
  csi,
  frame,
  identity,
  inner,
  openColours,
  pin,
  sameLevel,
  visibleWidth,
} from "./panel-drawn-lines-fixture.ts";
import { drawnOffenders, offenders } from "./panel-hostile.ts";
import { expectUniformWidth } from "./panel-lines-hostile-fixture.ts";

test("the theme's selected colour reaches the drawn row, and only the bar's row", () => {
  const rows = inner(frame(sameLevel(3), 60, openColours, 0));
  // The bar's own row carries the background the theme asked for; no other row does. Before #70 the whole
  // frame was byte-identical to the frame the identity style drew, which is what made the selection
  // invisible while `j`/`k` kept working underneath it.
  expect(rows.findIndex((row) => row.includes(BAR))).toBe(0);
  expect(rows.filter((row) => row.includes(BAR))).toHaveLength(1);
  // The dim meta survives too, and the focused frame's glyphs are coloured by `borderFocused`.
  expect(rows[0]).toContain(DIM);
  expect(frame(sameLevel(1), 60, openColours, 0, false).join("")).toContain(csi("90m"));
});

test("j and k move the colour to the row the keys moved to", () => {
  // The row table ranks a level newest-first (`panelSections`), so the bar sits on the row of the *ranked*
  // pin, not the row of the index the keys moved. The colour follows it: the two assertions that matter are
  // that exactly one row is painted and that it is a different row for a different selection.
  const pins = sameLevel(3);
  const painted = (selection: number): number[] =>
    inner(frame(pins, 60, openColours, selection))
      .map((row, index) => (row.includes(BAR) ? index : -1))
      .filter((index) => index >= 0);
  expect(painted(0)).toHaveLength(1);
  expect(painted(1)).toHaveLength(1);
  expect(painted(2)).toHaveLength(1);
  // ...and no two selections paint the same single row: the bar moves, which is the fix.
  expect(new Set([...painted(0), ...painted(1), ...painted(2)]).size).toBe(3);
});

test("an unfocused frame draws no bar at all", () => {
  // The bar is the *focused* panel's answer. A resting panel that drew one would point at a pin the keys
  // are not on, which is the same bug seen from the other side.
  const lines = frame(sameLevel(3), 60, openColours, 1, false);
  expect(lines.join("")).not.toContain(BAR);
  expect(lines.join("")).not.toContain(SELECTION_MARKER);
});

test("the unconditional sweep still refuses every escape on an uncoloured frame", () => {
  // The two sweeps are two promises and neither one is softened: `offenders` is what the hostile-text
  // surfaces read, and a frame drawn with no colours at all still carries no ESC byte anywhere.
  for (const focused of [false, true]) {
    for (const line of frame(sameLevel(2), 60, identity, 0, focused)) {
      expect(offenders(line)).toEqual([]);
      expect(drawnOffenders(line)).toEqual([]);
    }
  }
});

test("the selection marker marks the bar's row only, focused, at unchanged widths", () => {
  const pins = sameLevel(3, "warning");
  const focusedRows = inner(frame(pins, 60, identity, 1));
  const restingRows = inner(frame(pins, 60, identity, 1, false));
  // Focused: exactly one row carries the marker, and it is the row the bar sits on.
  expect(focusedRows.filter((row) => row.includes(SELECTION_MARKER))).toHaveLength(1);
  expect(focusedRows[1]).toContain(SELECTION_MARKER);
  // Unfocused: nothing is marked, so a resting panel never points at a pin the keys are not on.
  expect(restingRows.join("")).not.toContain(SELECTION_MARKER);
  // The marker replaces the level's glyph in its own column: same width, same text column, nothing appended.
  const marked = focusedRows[1] ?? "";
  const unmarked = restingRows[1] ?? "";
  expect(visibleWidth(marked)).toBe(visibleWidth(unmarked));
  expect(marked.indexOf(SELECTION_MARKER)).toBe(unmarked.indexOf("!"));
  expect(marked).not.toContain("!");
});

test("a coloured marker leaves no orphaned parameters on the bar's row", () => {
  // The regression the marker exchange had: `barMarker` cut the row's text at a fixed number of code units,
  // so the theme's `ESC [ 3 3 m` around the glyph came back as the *text* `33m` once the glyph was replaced
  // — visible bytes the frame charged columns for.
  const rows = inner(frame(sameLevel(2, "warning"), 60, openColours, 0));
  const bar = rows.find((row) => row.includes(BAR)) ?? "";
  expect(bar).not.toBe("");
  expect(bar).toContain(WARNING);
  expect(bar).toContain(`${SELECTION_MARKER} `);
  // The parameters of the theme's colour never survive on their own as text: every `33m` in the row is
  // preceded by its introducer, so nothing prints as the orphaned string the fixed slice used to leave.
  for (const match of bar.matchAll(/33m/g)) {
    expect(bar.slice(Math.max(0, (match.index ?? 0) - 2), match.index)).toBe(`${E}[`);
  }
});

test("the options row draws no keyboard glyph anywhere", () => {
  // #70 decision 4: the glyph rendered as a box in common terminal fonts and the spec never asked for it.
  // The digit is the whole keycap, and the column it spent belongs to the labels.
  const pins = [pin(1, "Decide", "info", { options: ["Passed on", "Not yet"] })];
  for (const style of [identity, openColours]) {
    const lines = frame(pins, 60, style, 0);
    expectUniformWidth(lines, 60);
    expect(lines.join("")).not.toContain(KEYCAP);
    // The options row is its own line, and the digits sit beside their labels with no glyph between them.
    // The theme's colour sits between the two (`1 ` is coloured, then the label is dimmed), so the pair is
    // checked by what it must not contain rather than by a literal the theme would break.
    const options = lines.find((line) => line.includes("Passed on"));
    expect(options).toBeDefined();
    expect(options).toContain("1 ");
    expect(options).toContain("Passed on");
    expect(options).toContain("2 ");
    expect(options).toContain("Not yet");
    expect(/\d\s*[\u2328]/.test(options ?? "")).toBe(false);
    for (const line of lines) expect(drawnOffenders(line)).toEqual([]);
  }
});
