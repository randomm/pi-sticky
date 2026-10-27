/**
 * The tail's reserve is measured on the string the row *draws*, so a theme whose `dim` adds visible
 * columns cannot take the time away.
 *
 * `widestMetaColumns` used to measure `pinMeta(pin)` — the bare `#<id> HH:MM` — while the row spent
 * `style.dim(\` ${row.meta}\`)`. For a theme that only colours the tail that is the same width (SGR bytes
 * cost no columns), but a `dim` that wraps its argument in visible bytes makes the drawn tail wider than the
 * measured one, and `truncateToWidth` charges its ellipsis against the same figure the text was padded to —
 * so the surplus landed on the tail, whose `HH:MM` is the last thing on it. That is the regression: with a
 * wrapping `dim` the first row read `< < #1 12:0…` at every width.
 *
 * One stamp — `metaStamp` (`panel-tail.ts`) — is now measured by the layout and printed by the row, so the
 * two figures cannot disagree. The bound this sweeps is `roomFor`, stated in *drawn* columns: the frame's
 * six, the visible width of the stamped tail `pinRow` pads to, the space before it, and the one column of
 * text `panelTextColumns` always leaves. At or above it the whole `#<id> HH:MM` sits on the row, brackets
 * included; below it the frame cannot hold the drawn tail beside a column of text, and the assertion drops
 * to the weaker true thing — the id is there, and the *time* is what the reserve ran out of (the text
 * yields, never the id, and a tail that does not fit is cut at its own right end, not at the id's). Every
 * line of every frame is exactly `width`.
 */
import { expect, test } from "bun:test";
import { visibleWidth } from "@earendil-works/pi-tui";

import {
  FRAME_COLUMNS,
  META_SEPARATOR_COLUMNS,
  widestMetaColumns,
} from "../src/panel-frame-geometry.ts";
import { PANEL_MIN_FRAME_COLUMNS } from "../src/panel-geometry.ts";
import { GUTTER_COLUMNS } from "../src/panel-tail.ts";
import { plainStyle } from "../src/render.ts";
import type { PanelStyle } from "../src/render.ts";
import type { ViewPin } from "../src/types.ts";
import { LATER, NOW, NOW_AGE, pin } from "./fixtures.ts";
import { built } from "./panel-frame.ts";

/**
 * A theme that *wraps* rather than colours: the bracketed bytes are drawn, so every tail this style stamps
 * is two columns wider than the `#<id> HH:MM` the undimmed measurement saw. That gap is the bug.
 */
const bracketingStyle: PanelStyle = {
  ...plainStyle,
  dim: (s) => `<${s}>`,
  selected: (s) => `[${s}]`,
  border: (s) => s,
  borderFocused: (s) => s,
};

/** The ids the ticket names: one digit, the widest the old constant reserved room for, and the lengths past it. */
const IDS = [1, 999, 1000, 123456, Number.MAX_SAFE_INTEGER];

/** Long enough that the text must be cut at every width in the sweep, so the tail is the only candidate left. */
const TEXT = "Decide-which-provider-to-keep-and-never-give-it-up";

const at = (id: number): ViewPin => pin(id, TEXT, "info", { createdAt: NOW });

const view = (id: number) => ({
  pins: [at(id)],
  selection: 0,
  focused: false,
  replyHint: "",
  ageNow: LATER,
});

/**
 * The columns a first row needs for its *drawn* tail beside a column of text: the frame's six, the reserve
 * `widestMetaColumns` charges for the stamped tail (`pinRow` pads the tail to exactly that), the separator,
 * and the one text column. Spelled out of the constants and of the theme's own stamp, never counted by hand —
 * and with the same `Math.max` the measurement itself carries, so the bound says when the *reserved* tail
 * fits, which is what `pinRow` closes a row against.
 *
 * One caveat the sweep states rather than hides: `pinRow` cuts the tail with
 * `truncateToWidth(..., reserve, ELLIPSIS)` and then pads the result to `reserve`, so a tail whose visible
 * width lands on `reserve - 1` is clipped to `…` and padded back out to `reserve` — the time is gone and no
 * ellipsis marks it, because pi-tui charges the ellipsis against the reset bytes it strips. That happens at
 * exactly one width per id (`width === roomFor(id) - 1`, where `inner - 1` becomes the tail's own width),
 * and only ever *below* `roomFor` — the bound where the frame can hold the tail beside a column of text.
 */
const roomFor = (id: number): number =>
  FRAME_COLUMNS +
  widestMetaColumns([at(id)], bracketingStyle.dim, LATER) +
  META_SEPARATOR_COLUMNS +
  1;

/** The lines of a one-pin frame at `width`, drawn with the wrapping theme. */
function frame(id: number, width: number): string[] {
  return built(view(id), width, bracketingStyle);
}

/** The first content row of that frame, or the empty string where the builder drew nothing. */
function firstRow(id: number, width: number): string {
  return frame(id, width).slice(1, -1)[0] ?? "";
}

for (const id of IDS) {
  test(`a wrapping dim costs the tail its own columns: #${id} keeps "#<id>" and "<age>" whole from ${PANEL_MIN_FRAME_COLUMNS} to 80`, () => {
    for (let width = PANEL_MIN_FRAME_COLUMNS; width <= 80; width++) {
      // The panel's contract holds whatever the theme did: every drawn line is exactly the frame's width.
      for (const line of frame(id, width)) expect(visibleWidth(line)).toBe(width);
      // The promise the wrapping theme used to break is that *both* halves of the tail arrive whole, in
      // whichever of the two shapes the layout chose: a pin whose text fits one row carries `#<id> <age>`
      // beside it, and a pin whose text wraps carries the id on its first row and the age on its second.
      // The cut that frame does make is the text's, so a `…` inside either tail is the reserve having been
      // cut rather than the text, which is the defect this file exists to catch.
      const rows = frame(id, width)
        .slice(1, -1)
        .map((row) => row.replace(/│$/, ""));
      const first = rows[0] ?? "";
      const aged = rows[1] ?? first;
      if (width >= roomFor(id)) {
        const pair = first.slice(first.indexOf("< #")).trimEnd();
        if (pair === `< #${id}>`) {
          // The id was drawn alone, so the age has the next row — and must be whole there.
          expect(aged.slice(aged.indexOf("< "))).toContain(`< ${NOW_AGE}>`);
          expect(aged.slice(aged.indexOf("< "))).not.toContain("…");
        } else {
          // The pair share the first row: id and age, both bracketed, neither cut.
          expect(pair).toBe(`< #${id} ${NOW_AGE}>`);
        }
        expect(first.slice(first.indexOf("< #"))).not.toContain("…");
      } else {
        // Below the bound the frame cannot hold the reserved tail beside a column of text. The row still
        // draws, still measures `width`, and still names the pin: the id survives, and any cut the reserve
        // could not avoid sits at the *tail's* own right end, marked by the ellipsis — never at the `#id`.
        expect(first).toContain(`#${id}`);
        expect(first).not.toContain("#…");
      }
    }
  });
}

test("the wide reserve is charged to the drawn tail, so a wrapping theme never loses one", () => {
  // Same frame, same pin, two themes that differ only in what `dim` does with its argument: the wrapping one
  // draws two more columns per tail, and the reserve has to be measured on *that* string. Measuring the
  // undimmed `pinMeta` charged the frame for a tail it never drew, handed the difference to the text, and
  // the row closed by cutting the bracketed tail — so the promise is the drawn one: both halves arrive
  // whole, the id on the pin's first row and the age on its second, with the cut landing on the text alone.
  const width = 44;
  const id = 999;
  const rows = frame(id, width);
  expect(rows[1]).toContain(`< #${id}>`);
  expect(rows[2]).toContain(`< ${NOW_AGE}>`);
  // The ellipsis belongs to the text column and appears nowhere in either tail.
  const idLine = rows[1] ?? "";
  const ageLine = rows[2] ?? "";
  expect(idLine.slice(idLine.indexOf("< #"))).not.toContain("…");
  expect(ageLine.slice(ageLine.indexOf("< "))).not.toContain("…");
  // And the frame closed at the width it was asked for, which is what forced the text — and only the text —
  // to give up the columns the theme's own bytes cost.
  for (const line of rows) expect(visibleWidth(line)).toBe(width);
});

test("the gutter subtraction the row and the layout share is the one `GUTTER_COLUMNS` states", () => {
  // `panel-tail.ts` owns the figure both sides subtract: the wrap sizes the text against `FRAME_COLUMNS`
  // and the builder draws the row into `width - GUTTER_COLUMNS` inner columns. One figure, so a row can
  // neither overrun the gutter nor stop short of it.
  const width = 44;
  const lines = frame(1, width);
  const row = lines[1] as string;
  expect(GUTTER_COLUMNS).toBe(4);
  // `│ ` + inner + ` │`: the two gutters and their spaces are the four columns the row does not draw into.
  expect(row.startsWith("│ ")).toBe(true);
  expect(row.endsWith(" │")).toBe(true);
  expect(visibleWidth(row.slice(2, -2))).toBe(width - GUTTER_COLUMNS);
});
