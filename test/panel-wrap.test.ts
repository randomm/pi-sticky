/**
 * `wrapAtDrawnWidth`'s degenerate figures: the widths at which wrapping stops being a wrap.
 *
 * The function exists to answer the drawer's question — how wide may a row be, given the tail's reserve and the
 * three columns of the marker cell a wrapping pin pays twice. Most of the suite answers that indirectly, through
 * a drawn frame. These cases ask it directly, because the shapes that break are the ones a frame the builder
 * closes never hands over: a `room` too narrow to hold a row after the indent, and a figure that is not a count
 * of columns at all (`NaN`, a fraction, a negative). Left alone, the packer answers both by spelling the text one
 * grapheme per row — a pin that owns a row per character, and a row count no window scrolls. The answer these
 * tests pin is the folded text whole, which is the same fallback `panelPinRows` gives for a frame with no text
 * column, reached from the other side of the arithmetic.
 *
 * The wide-glyph case is the third shape and the narrowest: a CJK ideograph or an astral emoji is *two* columns,
 * and pi-tui's token fallback breaks a token only while it measures over the width it was handed, so a one-column
 * figure handed a two-column grapheme gets it back whole on a row of its own. `whole` breaks it instead, and the
 * assertion is on the row the drawer would have had to cut.
 */
import { expect, test } from "bun:test";
import { visibleWidth } from "@earendil-works/pi-tui";

import { wrapAtDrawnWidth } from "../src/panel-wrap.ts";

/** A paragraph long enough that no ordinary width leaves it on a row. */
const TEXT =
  "The lens-fix pass on the worktree reported a clean tree and then the driver re-ran the whole offline suite for no reason anyone could name, so the park fix has to land before the next cycle.";

/** A run of CJK glyphs, every one of them two columns and its own break opportunity. */
const CJK = "工作树重新运行整个离线测试套件所以停放修复必须在下个周期之前落地";

/** A marker cell's columns, and the reserve floor the geometry gives a view of one small id. */
const CELL = 3;
const META = 11;

/** The columns a frame of `inner` gives a row's text: the inner width less the tail's reserve. */
const room = (inner: number): number =>
  Math.max(1, inner - Math.min(META + 1, Math.max(0, inner - 1)));

test("a room too narrow for the indent returns the text whole rather than one character per row", () => {
  // `room` of 1, 2 or 3 is the case where the marker cell alone eats the row: the pack width the wrap would use
  // is `room - 2 * cell`, i.e. zero or less, and pi-tui answers a pack of zero or less by spelling the text one
  // grapheme per row. That is not a wrap — it is a row count no window scrolls and no tail fits, and the panel
  // would draw a pin across half the terminal to say nothing more. One row is the answer.
  for (const inner of [1, 2, 3, 4, 5, 10, 12, 13, 14, 15]) {
    if (room(inner) - 2 * CELL >= 1) continue;
    const rows = wrapAtDrawnWidth(TEXT, inner, META, inner);
    expect(rows, `inner ${inner}`).toEqual([TEXT]);
    expect(rows.length, `inner ${inner} must be one row`).toBe(1);
  }
});

test("a wrap that does have room still wraps, so the fallback is a fallback and not a shortcut", () => {
  // The other side of the branch: widen `inner` until the pack figure is positive and the same call must produce
  // several rows again. Without this the guard above could be a permanent "never wrap" and stay green.
  const rows = wrapAtDrawnWidth(TEXT, 40, META, 40);
  expect(rows.length).toBeGreaterThan(1);
  expect(rows.join("")).toContain("lens-fix");
});

test("a pin that fits its own row is retried at the roomy width and drawn whole", () => {
  // The single-row retry (`whole(wrapTextWithAnsi(plain, min(ceiling, room)), …)`): the first pack at `room -
  // 2 * cell` is narrow and, for a text that would fit the row it owns, over-eager — it wraps a line that had a
  // right to one row into two by charging the continuation indent a pin that never wrapped. When the narrow pack
  // comes back as a single row the wrap retries at the frame's own `room`, and the pin keeps the row. The text
  // is one short word at a wide frame so the narrow pack is one row and the retry is what runs; the assertion is
  // that it stays one row (no spurious second line) and keeps the word.
  const rows = wrapAtDrawnWidth("Decide", 60, META, 60);
  expect(rows).toEqual(["Decide"]);
});

test("a non-finite or negative figure is not a frame worth wrapping inside", () => {
  // `NaN` compares false against every width, so the packer handed a `NaN` never cuts and returns the text
  // whole on a row of its own; a negative floors to nothing and reaches the same fallback. Both are answered
  // the way the degenerate frame is, rather than by a row count nobody measured.
  for (const inner of [Number.NaN, -1, -4000, Number.NEGATIVE_INFINITY]) {
    expect(wrapAtDrawnWidth(TEXT, inner, META, inner), String(inner)).toEqual([TEXT]);
  }
  for (const textWidth of [Number.NaN, -5, Number.POSITIVE_INFINITY]) {
    // A text column that is not a count of columns is bounded to zero, and a zero ceiling is the degenerate
    // figure: the text whole on one row, which the drawer cuts. What it must not do is reach the packer as a raw
    // `NaN` (which never cuts) or an `Infinity` (which packs a line to nothing at all).
    const rows = wrapAtDrawnWidth(TEXT, textWidth, META, 60);
    expect(rows, String(textWidth)).toEqual([TEXT]);
  }
});

test("a fractional figure is cut to a whole number of columns before it reaches the packer", () => {
  // `visibleWidth` answers whole columns, so a row packed at 30.5 measures 31 and the drawer re-cuts it. The
  // wrap floors, so the figure it packs at and the figure `pinRow` cuts to are the same integer.
  const fractional = wrapAtDrawnWidth(TEXT, 30.7, META, 40.9);
  const whole = wrapAtDrawnWidth(TEXT, 30, META, 40);
  expect(fractional).toEqual(whole);
  for (const row of fractional) expect(visibleWidth(row)).toBeLessThanOrEqual(30);
});

test("a two-column glyph is hard-broken rather than handed back whole over the row", () => {
  // pi-tui's fallback breaks a token only while it measures *over* the width it was handed, and it treats a Han
  // glyph as a token of its own. At a one-column figure a two-column ideograph is handed back whole — the row
  // reaches `pinRow` wider than the columns it was packed at, and the drawer's re-cut spends an ellipsis on it.
  // The wrap breaks the glyph instead, so every row it returns measures within the width it was given.
  const rows = wrapAtDrawnWidth(CJK, 2, META, 60);
  expect(rows.length).toBeGreaterThan(1);
  for (const row of rows) {
    expect(visibleWidth(row), JSON.stringify(row)).toBeLessThanOrEqual(2);
    expect(row).not.toContain("\u2026");
  }
  // No character was lost in the break: the rows, joined, are the pin's own characters in order.
  expect(rows.join("")).toBe(CJK);
});

test("a run of wide glyphs packed to one column yields the fallback rows, not an invented ellipsis", () => {
  // The degenerate pack seen from the glyph side rather than the room side: a run of two-column ideographs handed
  // a one-column pack (`narrow` is 1 at a frame whose room the indent has eaten down to seven). pi-tui's packer
  // answers with its token fallback and `whole`'s loop runs against it. What the wrap must not do is invent an
  // ellipsis the pin never wrote, or throw on a row it cannot cut — both of which a naive grapheme split does.
  // The rows are the packer's, empty and reset-sequence rows included; the assertion is the negative one this
  // path owns: no `…` appears anywhere in them.
  const rows = wrapAtDrawnWidth(CJK, 999, META, 19);
  for (const row of rows) expect(row).not.toContain("\u2026");
});

test("the marker cell is charged twice to a wrapping pin, once for the indent", () => {
  // The figure the whole module is built on: a *continuation* row pays the tail's reserve and the marker cell as
  // an indent, so no row may be packed wider than `room - 2 * cell`. One cell short and the shortfall lands on
  // the second row — the age's row — which is the shape the report described.
  const inner = 60;
  const limit = room(inner) - 2 * CELL;
  for (const meta of [META, 20, 30]) {
    for (const textWidth of [10, 30, inner]) {
      const rows = wrapAtDrawnWidth(TEXT, textWidth, meta, inner);
      expect(rows.length, `meta ${meta} tw ${textWidth} should wrap`).toBeGreaterThan(1);
      for (const row of rows) {
        expect(
          visibleWidth(row),
          `meta ${meta} tw ${textWidth}: ${JSON.stringify(row)}`,
        ).toBeLessThanOrEqual(limit);
      }
    }
  }
});
