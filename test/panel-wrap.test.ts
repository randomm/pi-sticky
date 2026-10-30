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
 * assertion is that the pin's characters come back whole — every code unit of a ZWJ family included, with no row
 * left holding a lone surrogate. A negative assertion ("no `…` invented") passes over rows that were emptied.
 */
import { expect, test } from "bun:test";
import { visibleWidth } from "@earendil-works/pi-tui";

import { stripSequences } from "../src/escape.ts";
import { panelPinRows } from "../src/panel-rows.ts";
import { wrapAtDrawnWidth } from "../src/panel-wrap.ts";
import type { PanelStyle } from "../src/render.ts";
import type { ViewPin } from "../src/types.ts";
import { pin } from "./fixtures.ts";
import { figuresOf } from "./panel-rows-frame.ts";

/** Identity colours: nothing the theme adds is measured as a column. */
const style: PanelStyle = {
  header: (s) => s,
  marker: (_level, s) => s,
  dim: (s) => s,
  selected: (s) => s,
  border: (s) => s,
  borderFocused: (s) => s,
};

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

test("a two-column glyph handed a two-column figure is handed back whole", () => {
  // The *wide* side of `whole`, where the packer's own loop already did its job: `textWidth` 2 clamps the pack to
  // two columns, a single ideograph fits that exactly, and there is nothing left to break. The one-column pack
  // — the case where the loop actually cuts — is the block below, which asserts the characters survive it.
  const rows = wrapAtDrawnWidth(CJK, 2, META, 60);
  expect(rows.length).toBeGreaterThan(1);
  for (const row of rows) {
    expect(visibleWidth(row), JSON.stringify(row)).toBeLessThanOrEqual(2);
    expect(row).not.toContain("\u2026");
  }
  // No character was lost in the break: the rows, joined, are the pin's own characters in order.
  expect(rows.join("")).toBe(CJK);
});

test("a two-column glyph packed to one column is hard-broken, and every glyph survives the break", () => {
  // The shape `whole`'s loop exists for: `narrow` is 1 at a frame whose room the indent has eaten down to seven
  // (`room` 7, minus the marker cell twice), and pi-tui hands a two-column ideograph back over that figure.
  //
  // The loop cuts with `truncateToWidth`, which closes what it kept with `ESC[0m` *even with no ellipsis* — so
  // when a grapheme will not fit, the head it returns is those four bytes and nothing else: non-empty, so an
  // `head === ""` guard cannot see it, but zero columns wide, and slicing the row by its length spends the
  // grapheme's own code units. Measured before the fix, this call returned 2n rows alternating `[""]` and
  // `["\u001b[0m"]` with every ideograph gone; the family emoji below came back as two rows of lone low
  // surrogates. So the assertion is the positive one — the pin's characters, whole and in order — and not the
  // negative one ("no ellipsis invented"), which the broken rows satisfied by containing nothing at all.
  const rows = wrapAtDrawnWidth(CJK, 999, META, 21);
  expect(rows.length, "a one-column pack must split the run").toBeGreaterThan(1);
  expect(rows.join(""), "every ideograph survives the break").toBe(CJK);
  for (const row of rows) {
    // The width the pack was actually cut at, read off the module's own arithmetic rather than restated: `room`
    // is `inner` less `tailReserve`, and the pack gives up the marker cell twice.
    expect(visibleWidth(row), JSON.stringify(row)).toBeLessThanOrEqual(room(21) - 2 * CELL);
    expect(row, JSON.stringify(row)).not.toContain("\u2026");
  }
  for (const row of rows) expect(balanced(row), JSON.stringify(row)).toBe(true);
});

test("a hard break never splits a surrogate pair, whatever the grapheme is", () => {
  // The astral case of the same loop: a ZWJ family is eleven code units for one grapheme of twenty-one columns,
  // so a cut that steps by code units lands inside the pairs and hands back `\udc69` on a row of its own. A lone
  // surrogate is not a character — the terminal draws nothing or a placeholder for it — and it is what the
  // "kept rather than dropped" promise in `whole` actually breaks on.
  const families = [
    "\u{1F468}\u200D\u{1F469}\u200D\u{1F467}\u200D\u{1F466}",
    "\u{1F469}\u200D\u{1F469}\u200D\u{1F466}\u200D\u{1F466}",
    "\u{1F3F4}\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F}",
  ];
  for (const family of families) {
    for (const width of [1, 2, 3]) {
      const rows = wrapAtDrawnWidth(family, width, META, 21);
      for (const row of rows) expect(balanced(row), `${width}: ${JSON.stringify(row)}`).toBe(true);
      // The family is one grapheme, so the break keeps it as one row's content — and if the pack split it, every
      // of its code units still has to come back, in order, from the rows joined.
      expect(rows.join(""), `${width}: lost code units`).toContain(family);
    }
  }
  // ...and the same invariant where the family shares a row with ordinary text, which is the case that puts the
  // cut *inside* the family rather than around it.
  const mixed = `a${families[0] ?? ""}b`;
  for (const width of [1, 2, 3, 4]) {
    const rows = wrapAtDrawnWidth(mixed, width, META, 21);
    for (const row of rows) expect(balanced(row), `${width}: ${JSON.stringify(row)}`).toBe(true);
    // The reset `truncateToWidth` closes a cut with is the only byte between the packer and the pin's own
    // characters, so it is taken off by the project's own sequence pass rather than by a spelled-out escape.
    expect(stripSequences(rows.join("")), `${width}: mixed`).toBe(mixed);
  }
});

/** Whether `row` holds any lone surrogate — a split pair, which is not a character at all. */
function balanced(row: string): boolean {
  for (let i = 0; i < row.length; i++) {
    const code = row.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = row.charCodeAt(i + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      i++;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return false;
    }
  }
  return true;
}

test("the row table's degenerate text column draws no lone surrogate and loses no character", () => {
  // The public entry point to that pack: `panelPinRows` forwards the figures straight to the wrap, so a frame
  // whose room the indent has eaten to one column reaches `whole` through the row table rather than only through
  // a test. Nothing in the builder hands `panelPinRows` a text column this narrow — `panelTextColumns` keeps it
  // at seven or more — which is exactly why this needs an assertion of its own: the path is documented,
  // reachable, and outside every drawn sweep.
  const mk = (text: string): ViewPin =>
    pin(7, text, "info", { createdAt: "2026-10-25T09:00:00.000Z" });
  const family = "\u{1F468}\u200D\u{1F469}\u200D\u{1F467}\u200D\u{1F466}";
  const cases: readonly (readonly [string, string])[] = [
    ["family", `${family} b`],
    ["cjk", CJK],
  ];
  for (const [name, text] of cases) {
    const pin = mk(text);
    const now = "2026-10-25T10:00:00.000Z";
    // Spread from the fixture rather than spelled: `panelPinRows` takes the reserve and the inner width as two
    // adjacent numbers, so a call site that wrote them by hand could transpose them silently. Here the pair is
    // produced by the same subtraction the layout runs, in the order the row table wants them.
    const rows = panelPinRows(pin, 11, style, ...figuresOf(pin, 11, style, now));
    const drawn = rows.map((row) => row.text).join("");
    for (const row of rows)
      expect(balanced(row.text), `${name}: ${JSON.stringify(row.text)}`).toBe(true);
    // Every character of the pin's text is on some row of the table, and no `…` was invented for it.
    for (const character of [...text])
      expect(drawn, `${name}: lost ${JSON.stringify(character)}`).toContain(character);
    expect(drawn, `${name}: invented ellipsis`).not.toContain("\u2026");
  }
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
