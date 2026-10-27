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
import { NOW, localTime, pin } from "./fixtures.ts";
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
  FRAME_COLUMNS + widestMetaColumns([at(id)], bracketingStyle.dim) + META_SEPARATOR_COLUMNS + 1;

/** The lines of a one-pin frame at `width`, drawn with the wrapping theme. */
function frame(id: number, width: number): string[] {
  return built(view(id), width, bracketingStyle);
}

/** The first content row of that frame, or the empty string where the builder drew nothing. */
function firstRow(id: number, width: number): string {
  return frame(id, width).slice(1, -1)[0] ?? "";
}

for (const id of IDS) {
  test(`a wrapping dim costs the tail its own columns: #${id} keeps "#<id> HH:MM" whole from ${PANEL_MIN_FRAME_COLUMNS} to 80`, () => {
    for (let width = PANEL_MIN_FRAME_COLUMNS; width <= 80; width++) {
      // The panel's contract holds whatever the theme did: every drawn line is exactly the frame's width.
      for (const line of frame(id, width)) expect(visibleWidth(line)).toBe(width);
      const first = firstRow(id, width);
      if (width >= roomFor(id)) {
        // The frame can hold the drawn tail beside a column of text, so the row keeps all of it: brackets,
        // hash, id, the space, the time. The cut this frame does make is the text's — the ellipsis belongs
        // to the text column, never to the tail, so the assertion is made on the tail's own slice rather
        // than on the whole row (which at these widths has always cut the text).
        const tail = first.slice(first.indexOf("< #"));
        expect(tail.startsWith(`< #${id} ${localTime(NOW)}>`)).toBe(true);
        expect(tail).not.toContain("…");
      } else if (first.includes(localTime(NOW))) {
        // Below the bound, and the time survived anyway: pi-tui charges `truncateToWidth`'s ellipsis against
        // the reset bytes it strips, so at this reserve the tail kept every visible column it had and
        // `padPlain` filled the rest — the row closes at `width`, names its pin, and shows a whole tail.
        expect(first).toContain(`< #${id} ${localTime(NOW)}>`);
      } else {
        // The frame cannot hold the reserved tail beside a column of text at all. The row still draws, still
        // measures `width`, and still names the pin — and the cut sits at the tail's own right end, marked by
        // the ellipsis where the time was, rather than taking the id that addresses the pin.
        expect(first).toContain(`#${id}`);
        expect(first.slice(first.indexOf("< #"))).toContain("…");
      }
    }
  });
}

test("the wide reserve is charged to the text, not to the tail", () => {
  // Same frame, same pin, two themes that differ only in what `dim` does with its argument: the wrapping one
  // owns two more drawn columns per tail, and those columns come out of the text. Measuring the undimmed
  // `pinMeta` made the two frames identical and left the bracketed tail cut, which is what this pair catches.
  const plain: PanelStyle = { ...bracketingStyle, dim: (s) => s };
  const width = 44;
  const id = 999;
  const kept = (style: PanelStyle): number => {
    const row = built(view(id), width, style).slice(1, -1)[0] ?? "";
    return /^[^<#]*/.exec(row.slice(2))?.[0].trimEnd().length ?? 0;
  };
  const bracketed = kept(bracketingStyle);
  const undimmed = kept(plain);
  expect(bracketed).toBeLessThan(undimmed);
  expect(firstRow(id, width)).toContain(`< #${id} ${localTime(NOW)}>`);
  expect(undimmed).toBeGreaterThan(0);
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
