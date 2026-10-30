/**
 * The reported defect: a pin whose age row carried `…` at the right edge and lost its last characters to the
 * line below.
 *
 * The shape is the one that produced the report — a full id, a two-digit age, and text long enough that the
 * frame's own arithmetic decides how many rows it needs (three for the reported 64-column case: one with the
 * `#id` and the age, the rest carrying the overflow). The guarantee is stated in two parts because the defect
 * had two halves, and asserting only one of them is how it stayed invisible:
 *
 * 1. **the row table builds within what the drawer gives it.** `pinRow` (`panel-draw.ts`) fits a
 *    tail-bearing row's text to `panelLineColumns(inner)` less that row's reserve — `tailReserve` over the
 *    frame's widest stamp. The table used to wrap at `panelTextColumns`, the widest row in the frame, and the
 *    drawer then cut again. A row built inside its own limit cannot be re-cut, so this is the invariant that
 *    keeps the two halves of the layout from disagreeing.
 * 2. **the characters survive the draw.** Taking each row's tail back off and joining what is left reproduces
 *    the pin's text exactly, with no `…` anywhere in it.
 *
 * Both are checked at the exact width in the report, then swept across a window around it, at ids chosen so
 * `tailReserve` swings between its arms (a single-digit id reaches the clamp; three digits reach `maxTail`),
 * because the column a pin loses is a function of the widest stamp in its frame and a single id proves only
 * the arm it happens to land on.
 *
 * The last block is the regression that the fix's *other* half is for: a pin the wrap puts on one row must not
 * be charged the marker indent that only a second row needs. That is where the extra row came from, and it is
 * why a two-row window becomes a three-row window at 64 columns.
 */
import { expect, test } from "bun:test";
import { visibleWidth } from "@earendil-works/pi-tui";

import { META_SEPARATOR_COLUMNS, widestMetaColumns } from "../src/panel-frame-geometry.ts";
import { GUTTER_COLUMNS, tailReserve } from "../src/panel-tail.ts";
import { LATER, NOW, pin } from "./fixtures.ts";
import { framed } from "./panel-frame.ts";
import {
  carriedCharacters,
  limitOf,
  owedCharacters,
  sweepStyle,
  sweptFrame,
} from "./panel-wrapped-sweep.ts";

/** The width the report was drawn at. */
const REPORTED_WIDTH = 64;

/** The reported shape, drawn at `width` — a full id, a two-digit age, and text that needs the frame's rows. */
function reportedPin(width: number, id: number) {
  const frame = sweptFrame(id, REPORTED_TEXT, width);
  expect(
    frame.rows.length,
    `the reported shape needs more than one row at ${width} columns`,
  ).toBeGreaterThan(1);
  return frame;
}

/** Text long enough that a 64-column frame cannot keep it on a row, and its tail is a real word. */
const REPORTED_TEXT =
  "the #1882 lens-fix pass reported a clean tree and then re-ran the whole offline suite, so the park fix " +
  "has to land before the next cycle or every workstream pays for it again.";

/** Ids spread across both arms of `tailReserve`: the clamp, the ceiling, and what sits between them. */
const TAIL_IDS = [1, 7, 9, 10, 42, 99, 100, 357, 999];

test("the reported pin keeps every character at the width it was reported at", () => {
  const frame = reportedPin(REPORTED_WIDTH, 35);
  const drawn = frame.textRows.map((row) => row.text).join("");

  // The reported symptom, denied: the cut's `…` never appears in a wrapped pin's own rows.
  expect(drawn).not.toContain("\u2026");
  // And the characters themselves, in order, with nothing added: `carriedCharacters` strips the theme bytes,
  // the marker cell the row table prepends, and the pad the tail row is padded to.
  expect(carriedCharacters(frame)).toBe(owedCharacters(REPORTED_TEXT));
});

test("the pin is built within the columns the drawer gives each of its rows, so nothing is cut twice", () => {
  // Recomputed here rather than imported from the fixture, because this is the arithmetic the report is about
  // and it should read as the drawer's own: `pinRow` charges the tail's reserve to the row that owns it, and
  // that reserve is `tailReserve` over the frame's widest stamp.
  const pins = [pin(35, REPORTED_TEXT, "info", { createdAt: NOW })];
  const inner = REPORTED_WIDTH - GUTTER_COLUMNS;
  const reserve = tailReserve(
    widestMetaColumns(pins, sweepStyle.dim, LATER),
    inner,
    META_SEPARATOR_COLUMNS,
  );
  expect(reserve).toBeGreaterThan(0);

  const frame = reportedPin(REPORTED_WIDTH, 35);
  for (const row of frame.rows) {
    const limit = row.tail === "" ? inner : inner - reserve;
    expect(visibleWidth(row.text), JSON.stringify(row.text)).toBeLessThanOrEqual(limit);
  }
});

test("the reported shape keeps its text across the widths around the report, on both arms of the reserve", () => {
  // 60–68 rather than 30–120: this block is about *the reported shape* holding at the width it was seen at and
  // just either side of it, where the frame's row count changes and the wrap has to follow. The whole range is
  // swept in `panel-wrapped-sweep.test.ts`; repeating it here would only slow the file that is supposed to
  // document one defect.
  for (let width = 60; width <= 68; width++) {
    for (const id of TAIL_IDS) {
      const frame = sweptFrame(id, REPORTED_TEXT, width);
      const drawn = frame.textRows.map((row) => row.text).join("");
      expect(drawn, `id ${id} at ${width}`).not.toContain("\u2026");
      expect(carriedCharacters(frame), `id ${id} at ${width}`).toBe(owedCharacters(REPORTED_TEXT));
      for (const line of frame.lines)
        expect(visibleWidth(line), `id ${id} at ${width}`).toBe(width);
    }
  }
});

test("a pin the wrap puts on one row is not charged the indent a second row would need", () => {
  // The other half of the defect: charging a one-row pin the marker indent it does not draw stole columns the
  // text could have used. The panel's promise is the opposite — the window is sized to what the pin needs, and a
  // pin that owns one row owns one row.
  // Measured against the frame's own arithmetic rather than a hand-picked text: the row's limit is what decides
  // whether the wrap can keep a pin on one row, and a text chosen by eye for one width is a text that silently
  // stops fitting when the reserve moves. So the shortest whole word and the longest word are taken from the
  // reported text itself and asserted to stay on one row at the reported width — the two shapes a wrap can be
  // charged for paying an indent it never drew.
  for (const short of ["land", "workstream"]) {
    const oneRow = sweptFrame(35, short, REPORTED_WIDTH);
    expect(
      oneRow.textRows.length,
      `"${short}" -> ${JSON.stringify(oneRow.textRows.map((r) => r.text))}`,
    ).toBe(1);
    // A pin drawn on one row pays no indent: its text still starts at the marker cell, which is where the pin's
    // own characters begin.
    const first = oneRow.textRows[0]?.text ?? "";
    expect(visibleWidth(first)).toBeLessThanOrEqual(oneRow.width - GUTTER_COLUMNS);
    expect(carriedCharacters(oneRow)).toBe(owedCharacters(short));
  }

  // A pin the wrap must split is the case the indent belongs to, and the row beneath it pays the same three
  // columns: the pair the drawer charges, and the reason the wrap cannot size itself off the frame's text column.
  const wrapped = sweptFrame(35, REPORTED_TEXT, REPORTED_WIDTH);
  expect(wrapped.textRows.length).toBeGreaterThan(1);
  for (const row of wrapped.rows) {
    const limit = row.tail === "" ? REPORTED_WIDTH - GUTTER_COLUMNS : limitOf(wrapped, row);
    expect(visibleWidth(row.text), JSON.stringify(row.text)).toBeLessThanOrEqual(limit);
  }

  // And the same pin, one column narrower, still keeps its text: the row count may not silently cost characters.
  const narrower = sweptFrame(35, REPORTED_TEXT, REPORTED_WIDTH - 1);
  expect(carriedCharacters(narrower)).toBe(owedCharacters(REPORTED_TEXT));
});
