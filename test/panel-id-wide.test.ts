/**
 * The ids a long session actually reaches — past `#999`, up to `MAX_PIN_ID`.
 *
 * `META_COLUMNS` was eleven columns, sized on `#999 12:00`, and the panel treated it as the whole reserve.
 * But `nextId` keeps counting and `MAX_PIN_ID` (`bounds.ts`) is `Number.MAX_SAFE_INTEGER` — twenty digits —
 * so from `#1000` on the tail was wider than its reserve and the `#id` was the thing the row cut to close at
 * the width the overlay was given. The reserve is now sized per frame from the view's widest id
 * (`widestMetaColumns`), floored at `META_COLUMNS`, and the tail is drawn into its own columns rather than
 * cut off the end of the text.
 *
 * This file is that promise at the ids the old constant never covered, over the same 30-to-80 sweep the 1-999
 * cases in `panel-id-never-cut.test.ts` use. The assertion is the one that stays true however the row is
 * squeezed: `#<id> HH:MM` is on the first row, whole, whenever the frame can physically fit the tail beside a
 * column of text — and where it cannot, the *text* is what went, never the id.
 */
import { expect, test } from "bun:test";
import { visibleWidth } from "@earendil-works/pi-tui";

import {
  FRAME_COLUMNS,
  META_COLUMNS,
  META_SEPARATOR_COLUMNS,
  MIN_COLUMNS_FOR_META,
} from "../src/panel-frame-geometry.ts";
import { PANEL_MIN_FRAME_COLUMNS } from "../src/panel-geometry.ts";
import { plainStyle } from "../src/render.ts";
import type { PanelStyle } from "../src/render.ts";
import type { ViewPin } from "../src/types.ts";
import { NOW, localTime, pin } from "./fixtures.ts";
import { built } from "./panel-frame.ts";

const style: PanelStyle = {
  ...plainStyle,
  selected: (s) => `[${s}]`,
  border: (s) => s,
  borderFocused: (s) => s,
};

const at = (id: number, text: string): ViewPin => ({
  ...pin(id, text, "info", { createdAt: NOW }),
});

/** The tail `panelPinRows` stamps for `id`, spelled the way the product stamps it. */
const tail = (id: number): string => `#${id} ${localTime(NOW)}`;

/** The first content row of a one-pin frame at `width`, or `undefined` where the builder drew nothing. */
function firstRow(id: number, text: string, width: number): string | undefined {
  const pins = [at(id, text)];
  return built({ pins, selection: 0, focused: false, replyHint: "" }, width, style).slice(1, -1)[0];
}

/** Columns the row must keep for the tail: the tail, the space before it, and one column of text. */
const roomFor = (id: number): number =>
  FRAME_COLUMNS + visibleWidth(tail(id)) + META_SEPARATOR_COLUMNS + 1;

// The three ids the ticket names: one past the old three-digit assumption, one mid-range, and the ceiling
// a snapshot may carry. Each is swept over the same widths the 1-999 cases sweep, with a long single word as
// the text so the row must cut something, and the id is the only candidate left.
for (const id of [1000, 123456, Number.MAX_SAFE_INTEGER]) {
  test(`a ${String(id).length}-digit id keeps its #id uncut at every width the builder closes at`, () => {
    for (let width = PANEL_MIN_FRAME_COLUMNS; width <= 80; width++) {
      const first = firstRow(id, "Decide-which-provider-to-keep-and-never-give-it-up", width);
      expect(first).toBeDefined();
      // Every drawn line measures the frame's width, however the row was squeezed.
      expect(visibleWidth(first as string)).toBe(width);
      if (width >= roomFor(id)) {
        // The frame can fit the tail beside a column of text: then the tail is on the row, whole — the id
        // and the time both, and `#…` standing in for neither.
        expect(first).toContain(`#${id} `);
        expect(first).toContain(localTime(NOW));
        expect(first).not.toContain("#…");
      } else {
        // It cannot. The row still draws and still carries its id — the text is what the cut takes, down to
        // the single column `panelTextColumns` promises. Asserting the id here rather than a text that was
        // never meant to survive is the whole point of the ticket.
        expect(first).toContain(`#${id}`);
        expect(first).not.toContain("#…");
      }
    }
  });
}

test("the reserve is a floor, and a wide id buys its own columns out of the text", () => {
  // `META_COLUMNS` is what the reserve never goes *below*, not the reserve itself: a `#999` row still costs
  // eleven columns and a `MAX_SAFE_INTEGER` one costs its twenty digits. The two rows below are the same
  // frame width and the same text — the only difference is the id — and the wide one loses text columns while
  // both keep their tails whole. That is `widestMetaColumns` sizing the frame from the ids on screen.
  const wide = firstRow(Number.MAX_SAFE_INTEGER, "a".repeat(80), 60) as string;
  const narrow = firstRow(1, "a".repeat(80), 60) as string;
  expect(wide).toContain(`#${Number.MAX_SAFE_INTEGER} ${localTime(NOW)}`);
  expect(narrow).toContain(`#1 ${localTime(NOW)}`);
  const keptWide = /a+/.exec(wide.slice(0, wide.indexOf("#")))?.[0].length ?? 0;
  const keptNarrow = /a+/.exec(narrow.slice(0, narrow.indexOf("#")))?.[0].length ?? 0;
  expect(keptNarrow).toBeGreaterThan(keptWide);
});

test("the reserved tail is measured, not guessed, and the frame floor covers it", () => {
  // The relationships the "never cut" promise rests on, pinned against each other rather than against a
  // literal a future edit could move one at a time. The reserve is the *actual* `#999 HH:MM` — its width is
  // `formatLocalTime`'s, not a guess — plus the separator `pinRow` puts before the tail. `MIN_COLUMNS_FOR_META`
  // is that tail beside one column of text, and the builder's floor (`PANEL_MIN_FRAME_COLUMNS`, the overlay's
  // own `minWidth`) must sit at or above it: the narrowest frame the overlay may hand over is wide enough for
  // the reserved tail, and never narrower than the arithmetic that says so. A floor *above* the arithmetic is
  // the builder asking for more than the tail needs, which costs nothing; a floor below it is the `#id`
  // drawing in a frame too narrow for it, which is the defect. An id past `#999` is neither one's problem —
  // it buys its own columns from the text, which the sweeps above prove.
  expect(META_COLUMNS).toBe(visibleWidth(`#${999} ${localTime(NOW)}`) + META_SEPARATOR_COLUMNS);
  expect(MIN_COLUMNS_FOR_META).toBe(FRAME_COLUMNS + META_COLUMNS + META_SEPARATOR_COLUMNS + 1);
  expect(PANEL_MIN_FRAME_COLUMNS).toBeGreaterThanOrEqual(MIN_COLUMNS_FOR_META);
});
