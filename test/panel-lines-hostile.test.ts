/**
 * What the panel draws when the bytes it is handed are not trusted: the theme's own escape sequences and
 * a pin's hostile text, both drawn through the frame.
 *
 * The frame made this a distinct question. A border glyph is the builder's own character coloured by the
 * theme, and a border label is the header or the hint the theme styles — both are drawn at the far right
 * of a flush-right panel, where `visibleWidth` counts an OSC title or an OSC 8 hyperlink as *zero*
 * columns. A drawing that trusted a styled string's measurement would pad such a sequence across the
 * chat behind it, so every drawn line, border included, is stripped before it is padded. These tests are
 * that promise, and the promise that a hostile pin cannot reach a border column.
 *
 * The three v2 fields (`group`, `options`, `compact`) get the same frame and the same sweep in
 * `panel-fields-hostile.test.ts`; the colours, the width assertion and the pin builder both files draw with
 * are `panel-lines-hostile-fixture.ts`.
 */
import { expect, test } from "bun:test";

import type { PanelStyle as RenderPanelStyle } from "../src/render.ts";
import { cleanPinText } from "../src/sanitize.ts";
import type { ViewPin } from "../src/types.ts";
import { NOW_AGE } from "./fixtures-age.ts";
import { LATER, NOW } from "./fixtures.ts";
import { built } from "./panel-frame.ts";
import {
  BREAKS,
  assertNoForgery,
  foldedHostileFields,
  linesOf,
  withHostileFields,
} from "./panel-hostile-fields.ts";
import {
  BEL,
  ESC,
  HOSTILE,
  MIN_FRAME_WIDTH,
  ST,
  TERMINAL_ROWS,
  offenders,
} from "./panel-hostile.ts";
import { expectUniformWidth, one, plain } from "./panel-lines-hostile-fixture.ts";

/** What a test writes to ask for a frame; `drawnFrame` adds the sections the frame's title prints. */
function content(
  pins: readonly ViewPin[],
  selection = 0,
  focused = false,
  replyHint = "",
  ageNow = LATER,
) {
  return { pins, selection, focused, replyHint, ageNow };
}

/**
 * The resting frame's pin row drawn by a theme whose `dim` *wraps* rather than colours, at the narrowest
 * width the frame closes at. Two columns of the tail here belong to the theme — `<d:t>` and its closing
 * bracket are drawn, not counted away — so this is the row an undimmed reserve measurement got wrong: it
 * charged the frame for `#1 12:00` and drew `<d:t> #1 12:00`, and the time was the column budget's casualty.
 */
test("a dim that adds columns is charged to the text, not to the id/time tail", () => {
  const wrapping: RenderPanelStyle = { ...plain, dim: (s) => `<${s}>` };
  const width = MIN_FRAME_WIDTH;
  const lines = built(content([one(1, "x")]), width, wrapping);
  expectUniformWidth(lines, width);
  const row = lines.slice(1, -1)[0] ?? "";
  // The tail carries the theme's own bytes and stays whole to the end of the time: `< x >`, not `< x …`.
  expect(row).toContain(`< #1 ${NOW_AGE}>`);
  // And the columns the wrapper cost came out of the text column, which is the only place they can come from.
  expect(row.indexOf("x")).toBeLessThan(row.indexOf("< #1"));
});

// `built` is `panel-frame.ts`'s: one `panelLayoutSections` pass at `width` — the rows the pins own over the two
// borders, cut to `TERMINAL_ROWS`' half — and the builder handed that very table.

/**
 * The marker cell of a drawn row: the columns between its left gutter and the row's text.
 *
 * A theme's `border` puts an SGR prefix in front of the gutter, and the row's own indent follows it, so the
 * cell is read from the gutter rather than from the start of the line — which is the only way to see what the
 * marker's wrapper left behind.
 */
function markerCellOf(line: string): string {
  const body = line.slice(line.indexOf(GUTTER) + 1).replace(/^ +/, "");
  const end = body.indexOf(" ");
  return end === -1 ? body : body.slice(0, end);
}

const GUTTER = String.fromCodePoint(0x2502);

test("a themed panel draws through all six colours", () => {
  // One draw per focus state: a frame is coloured by `border` or by `borderFocused` and never by both at
  // once, so the unfocused gutter and the focused corners are asked for from the frames that use them.
  const painted: RenderPanelStyle = {
    header: (s: string) => `<h:t>${s}`,
    marker: (_level: unknown, s: string) => `<m:t>${s}`,
    dim: (s: string) => `<d:t>${s}</d:t>`,
    selected: (s: string) => `<s:t>${s}`,
    // SGR-shaped, because that is what a theme does: colour a glyph. A wrapper that put visible
    // characters around one would ask for a frame wider than the overlay, and the builder's answer to
    // that is the one every drawn line gets — it is cut.
    border: (s: string) => `\u{1b}[2m${s}`,
    borderFocused: (s: string) => `\u{1b}[1m${s}`,
  };
  // Two frames of the same theme at the same width: the *resting* one, which draws the level's glyph, and
  // the focused one, which draws the bar. The marker assertion is made on the resting row, because the bar's
  // row exchanges the level's glyph for the panel's own selection marker (#70 decision 2) and there the
  // theme's `marker` wrapper is asked for the marker, not the level — `resting` is the frame in which this
  // theme's `marker` is asked for a level at all.
  const focused = built(content([one(1, "Decide X")], 0, true), 40, painted);
  const resting = built(content([one(1, "Decide X")], 0, false), 40, painted);
  expect(focused[0]).toContain("<h:t>");
  // The marker's wrapper is *cut*, not drawn: the glyph owns one column and this theme's `marker` puts six
  // visible columns around it, so the row keeps the first of them and the glyph itself is what gives way — the
  // policy `glyph` (`panel-frame.ts`) applies to a corner, and the one this file's first test spells out for a
  // tail (`< x >`, not `< x …`). Six colours are still asked for, and the frame's other five are drawn. The
  // cell the row opens with is therefore the wrapper's lone surviving column and none of its tail: `<m:t>`
  // would mean the whole wrapper was drawn, and `<m` would mean the cut left the marker's own name on the
  // screen, and a bare `<` would pass for any other byte a theme put there. `dropControls` (`escape.ts`) is
  // what took the theme's own reset with the rest of the wrapper, so the cell is the `<` and the pad that
  // brings it back to the glyph's two columns — and `resting` is the resting row, which is why no bracket
  // stands between the gutter and the cell.
  expect(markerCellOf(resting[1] ?? "")).toBe("<");
  expect(resting[1] ?? "").not.toContain("<m");
  expect(resting[1] ?? "").not.toContain("<s:t>");
  // The bar's own row, drawn focused, is where the theme's `selected` is asked for the row's columns.
  const bar = built(content([one(1, "Decide X")], 0, true), 40, painted);
  expect(bar[1] ?? "").toContain("<s:t>");
  // ...and the *resting* row's tail is whole. This theme's `dim` wraps — its tag is drawn, not counted away —
  // so the tail it stamps is sixteen columns wider than the `#<id> <age>` an undimmed measurement saw. A
  // reserve sized on the undimmed string handed those columns to the text and cut the age, drawing
  // `<d:t> #1 2…</d:t>`. The tail is stamped once and measured once now, so the row that has room for it
  // shows it complete — opening tag, id, age, closing tag — and the text is what gave way.
  // The focused row of the same theme is not that row: `<s:t>` puts its own six visible columns in front of a
  // line the frame already sized without them, so at 40 columns the whole line is cut by `fitLine` whatever
  // the tail's reserve was, and asserting an uncut tail there would be asserting the bar is free.
  // This theme's `dim` puts sixteen *drawn* columns around whatever it stamps, and the row must carry them
  // whole: the reserve is charged for the drawn tail, not the undimmed one, and that is what stops the
  // wrapper's own bytes from being paid for out of the tail — the defect that drew `<d:t> #1 2…</d:t>`.
  const tailRow = resting.find((line) => line.includes("<d:t>")) ?? "";
  expect(tailRow).toContain(`<d:t> #1 ${NOW_AGE}</d:t>`);
  expect(tailRow.slice(tailRow.indexOf("<d:t>"))).not.toContain("…");
  // The text paid for the wrapper: at a width where it cannot fit the column the reserve left, it is cut,
  // and cut *before* the tail begins — on the id's row and on the age's row alike.
  const tight = built(
    content([one(1, "Decide X a decision long enough to need cutting")], 0, false),
    40,
    painted,
  );
  // Where the cut lands is the promise: the ellipsis is the *text's*, and never the tail's. The marker's
  // wrapper puts six drawn columns in front of a line the frame sized without them, so `fitLine` cuts the
  // line — and the only columns it can take are the text's, left of the tail. The same theme with an
  // unwrapped `dim` proves the tail is what survived: identical frame, identical text, and the tail still
  // drawn whole with the text carrying the ellipsis.
  // The row where the text has to give: the pin's text is one long word, so the wrap needs cutting, and the
  // only place the ellipsis can land is the text column — the tails keep their wrapper whole whatever the
  // frame costs. `marker` is identity here so the marker's own wrapper cannot be what pushed the line out.
  const textOnly: RenderPanelStyle = {
    ...painted,
    header: (text) => text,
    marker: (_level, text) => text,
    selected: (text) => text,
    dim: (text) => `<d:t>${text}</d:t>`,
  };
  const wrapped = built(
    content([one(1, "Decide-X-a-decision-long-enough-to-need-cutting")], 0, false),
    40,
    textOnly,
  );
  const idRow = wrapped.find((line) => line.includes("<d:t> #1")) ?? "";
  const ageRow = wrapped.find((line) => line.includes(`<d:t> ${NOW_AGE}`)) ?? "";
  for (const line of [idRow, ageRow]) {
    const tail = line.indexOf("<d:t>");
    expect(tail).toBeGreaterThan(-1);
    expect(line.slice(0, tail)).toContain("…");
  }
  // ...and neither tail was the thing that lost a column to the cut.
  expect(idRow).toContain("<d:t> #1</d:t>");
  expect(ageRow).toContain(`<d:t> ${NOW_AGE}</d:t>`);
  // The frame is drawn through the style's `border`/`borderFocused` members, which is what lets the theme
  // own the frame's colour: the recording-theme test in `panel-lines.test.ts` is what pins which token is
  // asked for, and the uniform-width sweeps what proves the bytes a theme adds cost no columns. The
  // escape bytes themselves are refused on every drawn line — border glyphs included.
  expect(focused.join("\n")).toContain("╰");
  expect(focused.join("\n")).toContain("╭");
  expect(resting.join("\n")).toContain("│");
});

test("a coloured header over a narrow frame is cut without losing the theme's own bytes", () => {
  // `truncateToWidth` wraps its ellipsis in its own resets; those are the cut's bytes and go, while
  // the theme's prefix stays — the line was styled on purpose.
  const painted: RenderPanelStyle = {
    ...plain,
    header: (s: string) => `<h:k>${s}`,
  };
  const lines = built(content([one(1, "x")]), MIN_FRAME_WIDTH, painted);
  expectUniformWidth(lines, MIN_FRAME_WIDTH);
  expect(lines[0]?.includes("<h:k>")).toBe(true);
});

test("a theme that emits a hyperlink paints no escape bytes onto the panel, at any width", () => {
  const hostileStyle: RenderPanelStyle = {
    header: (text) => `${ESC}]8;;https://evil${ST}${text}${ESC}]8;;${ST}`,
    marker: (_level, text) => text,
    dim: (text) => `${ESC}]52;c;AAAA${BEL}${text}`,
    selected: (text) => text,
    // A border that smuggles a title sequence is the case the frame added: the glyphs are the builder's
    // own, but the bytes around them are the theme's, and the frame strips them rather than drawing them.
    border: (text) => `${ESC}]0;pwn${BEL}${text}`,
    borderFocused: (text) => `${ESC}]0;pwn${BEL}${text}`,
  };
  for (const focused of [false, true]) {
    for (const width of [40, 60]) {
      const lines = built(content([one(1, "Decide X")], 0, focused), width, hostileStyle);
      // One pin is a three-row frame — border, pin, border — and every row of it is swept.
      expect(lines.length).toBe(3);
      expectUniformWidth(lines, width);
      for (const line of lines) expect(offenders(line)).toEqual([]);
    }
  }
});

test("hostile text drawn at a width that forces a cut carries no escape, control or surrogate", () => {
  // The sanitizer is what removes these from a pin; the point here is that wrapping, cutting and
  // padding do not put any back, at a width narrow enough that every line is cut — the two border rows
  // included, since a pin's bytes must never reach a border column.
  for (const focused of [false, true]) {
    for (const width of [MIN_FRAME_WIDTH, 33, 60, 120]) {
      const lines = built(
        content([one(1, cleanPinText(HOSTILE), { level: "warning" })], 0, focused),
        width,
        plain,
      );
      // The cut rows: the two borders, plus one row for a pin whose text fits the text column and one
      // more once the `#id`/age pair no longer fits beside it — the age takes the row below rather than
      // the id's columns. Two rows of content at the frame's own floor, one anywhere roomier.
      expect([3, 4]).toContain(lines.length);
      if (width > MIN_FRAME_WIDTH) expect(lines).toHaveLength(3);
      expectUniformWidth(lines, width);
      for (const line of lines) expect(offenders(line)).toEqual([]);
    }
  }
});

test("every drawn line measures exactly the width from the frame's floor to 120 columns", () => {
  // The sweep the acceptance criteria name: nothing below the floor draws, and everything at or above it
  // closes, focused and unfocused, whatever the pin text.
  for (const focused of [false, true]) {
    for (let width = MIN_FRAME_WIDTH; width <= 120; width++) {
      const lines = built(
        content([one(1, cleanPinText(HOSTILE)), one(2, "日本語 🎯 tail")], 1, focused),
        width,
        plain,
      );
      expect(lines.length).toBeGreaterThan(2);
      expectUniformWidth(lines, width);
      for (const line of lines) expect(offenders(line)).toEqual([]);
    }
  }
});
