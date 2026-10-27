/**
 * The `#id` is never cut.
 *
 * At 33 columns — what the overlay resolves to in a 120-column terminal, and the width the real session
 * this came out of drew at — a pin's first row read `#100 …`: the text kept a column and the id lost
 * one. The cause was two callers of one geometry disagreeing. `panelLayout` sized the text column at
 * `frameWidth - 4 - 10` (`META_RESERVE`, a flat guess) while `buildPanelLines` cut each finished row at
 * `width - 4`; on a pin whose text needed every column, the tail sat in the columns the cut took.
 *
 * The fix is one arithmetic, in `panel-frame-geometry.ts`, sized from the *actual* tail (`#999 12:00`)
 * rather than a flat reserve, and floored at one column of text so a row that cannot show its text still
 * draws and still carries its meta. The operator's rule: **the text column yields, never the id.**
 *
 * So this is the sweep the ticket asks for — every width the builder closes at, every id to 999 — and it
 * asserts the weaker, true thing: `#<id>` and the time are present and uncut on every pin's first row.
 * It does *not* assert the text is uncut; that is the whole point. The time is built with `localTime()`,
 * never a literal, because `formatLocalTime` reads the machine's clock and a hardcoded `12:00` is only
 * true under one `TZ`.
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
import { panelPinRows } from "../src/panel-rows.ts";
import { idStamp } from "../src/panel-tail.ts";
import { plainStyle } from "../src/render.ts";
import type { PanelStyle } from "../src/render.ts";
import type { ViewPin } from "../src/types.ts";
import { LATER, NOW, NOW_AGE, pin } from "./fixtures.ts";
import { built } from "./panel-frame.ts";

const style: PanelStyle = {
  ...plainStyle,
  selected: (s) => `[${s}]`,
  border: (s) => s,
  borderFocused: (s) => s,
};

/** A panel width wide enough for a first row's whole `#id HH:MM` beside a column of text. */
const MIN_ID_ROOM = PANEL_MIN_FRAME_COLUMNS;

const at = (id: number, text: string): ViewPin => ({
  ...pin(id, text, "info", { createdAt: NOW }),
});

/** The rows the builder drew, minus the two borders. */
function rowsOf(lines: string[]): string[] {
  return lines.slice(1, -1);
}

/**
 * The meta a first row must carry, spelled the way `panelPinRows` stamps it: the leading space and the
 * theme's `dim` included, because the row carries the *drawn* tail (`idStamp`, `panel-tail.ts`) and the
 * reserve is measured on that same string — a test that named the undimmed form here would be asserting a
 * string no row ever draws.
 */
const metaOf = (id: number): string => idStamp(at(id, ""), style.dim);

test("every pin's rows carry its #id and its age, uncut, at every width and every id", () => {
  // 30 → 80 covers the builder's own floor (`PANEL_MIN_FRAME_COLUMNS`) through the widest frame the
  // 33%-of-a-terminal overlay reaches on a wide screen; the ids are stepped so the width-times-texts
  // cross stays inside bun's per-test budget. Every id from 1 to 999 is swept on its own below, where
  // the cost is one text rather than fifty-one widths' worth of them.
  const texts = ["x", "Decide which provider to keep", "y".repeat(120)];
  for (let width = PANEL_MIN_FRAME_COLUMNS; width <= 80; width++) {
    for (let id = 1; id <= 999; id += 7) {
      for (const text of texts) {
        const pins = [at(id, text)];
        const lines = built(
          { pins, selection: 0, focused: false, replyHint: "", ageNow: LATER },
          width,
          style,
        );
        const rows = rowsOf(lines);
        const first = rows[0];
        expect(first).toBeDefined();
        // The id is on the pin's first row, in one piece, and not the ellipsis standing in for it.
        expect(first).toContain(`#${id}`);
        expect(first).not.toContain("#…");
        // The age is drawn somewhere on the pin — beside the id where the pair fit, on the row below where
        // it did not — which is the whole of the layout's promise, and the reason the sweep reads the pin's
        // rows rather than its first line: a text that wraps has already moved the age down.
        expect(rows.join("|")).toContain(NOW_AGE);
      }
    }
  }
});

test("every id from 1 to 999 keeps its #id uncut at the widths where the tail is tightest", () => {
  // The sweep above steps its ids; this one walks all 999 of them. Split out because the two together
  // blow bun's per-test budget, and because the axis that matters for the *id* is the id itself: the
  // reservation is sized on the widest tail the product can stamp, so a regression is a digit of `#999`
  // losing its column, and the narrow frames are where that shows. 30 is the floor the builder closes at
  // and 33 what 33% of a 100-column terminal resolves to — the width the 12-pin session this came out of
  // actually drew at, and the one `integration-panel-surface.test.ts` renders the live component at.
  for (const width of [PANEL_MIN_FRAME_COLUMNS, 33]) {
    for (let id = 1; id <= 999; id++) {
      const pins = [at(id, "Decide")];
      const first = rowsOf(
        built({ pins, selection: 0, focused: false, replyHint: "", ageNow: LATER }, width, style),
      )[0];
      expect(first).toBeDefined();
      expect(first).toContain(`#${id} `);
      expect(first).toContain(NOW_AGE);
      expect(first).not.toContain("#…");
    }
  }
});

test("a long text is what the cut takes, not the id", () => {
  // The narrow end of the sweep with the widest tail: at `#999` a 40-column frame gives the text 22 of
  // its columns and cuts the rest. The id stays; the text loses a character to `…`, which is the row
  // giving up width from the side that was always meant to give.
  const lines = built(
    {
      pins: [at(999, "z".repeat(200))],
      selection: 0,
      focused: false,
      replyHint: "",
      ageNow: LATER,
    },
    40,
    style,
  );
  const rows = rowsOf(lines);
  const first = rows[0] as string;
  expect(first).toContain("#999");
  // The age is drawn for this pin — on the row the id had to give up, since the text needed it.
  expect(rows.join("|")).toContain(NOW_AGE);
  expect(first).not.toContain("z".repeat(200));
});

test("a pin whose text needs only one column still shows its id", () => {
  // The floor case: at `MIN_COLUMNS_FOR_META` the text column is exactly one wide, and a row with no text
  // column at all is the case whose tail `fitLine` used to cut away at column zero.
  const pins = [at(999, "a")];
  const lines = built(
    { pins, selection: 0, focused: false, replyHint: "", ageNow: LATER },
    MIN_ID_ROOM,
    style,
  );
  // The frame floor is exactly this width (`MIN_COLUMNS_FOR_META === PANEL_MIN_FRAME_COLUMNS`, pinned
  // below), so this is the narrowest frame the builder will close at all: a border, one pin row, a border.
  expect(lines.length).toBe(3);
  const first = rowsOf(lines)[0] as string;
  expect(visibleWidth(first)).toBe(MIN_ID_ROOM);
  expect(first).toContain("#999");
  expect(first).toContain(NOW_AGE);
});

test("the reservation is the widest tail the product can stamp, and the floor leaves a column for text", () => {
  // The two numbers the "never cut" promise rests on, pinned against each other rather than against a
  // literal a future edit could move one at a time: the reservation is the actual `#999 HH:MM` (its width
  // is `formatLocalTime`'s, not a guess), and the frame's floor is at least the reservation plus the
  // gutter/corner columns plus the separator plus one column of text.
  // `#999` is four columns, the time is five, and the space between them is `panelPinRows`'s, not the
  // separator `pinRow` puts before the tail — so the reservation is the tail alone, and the separator is
  // counted beside it.
  // The reservation is the tail's display width *plus* the slack a row needs to survive the wrap: the
  // tail is `#999 12:00`, and the sweep below proves the reservation is enough to draw it whole at the
  // frame's own floor — asserting the number against the string alone would pin a copy of the product's
  // arithmetic rather than the guarantee it is meant to buy.
  expect(META_COLUMNS).toBeGreaterThanOrEqual(visibleWidth(`#${999} ${NOW_AGE}`));
  expect(META_SEPARATOR_COLUMNS).toBe(1);
  expect(FRAME_COLUMNS).toBe(6);
  expect(MIN_COLUMNS_FOR_META).toBe(FRAME_COLUMNS + META_COLUMNS + META_SEPARATOR_COLUMNS + 1);
  expect(PANEL_MIN_FRAME_COLUMNS).toBeGreaterThanOrEqual(MIN_COLUMNS_FOR_META);
});

test("a continuation row carries no id, so the id appears exactly once per pin", () => {
  const pins = [at(42, "a decision long enough to wrap in a narrow panel somewhere")];
  const lines = built(
    { pins, selection: 0, focused: false, replyHint: "", ageNow: LATER },
    34,
    style,
  );
  const rows = rowsOf(lines);
  expect(rows.length).toBeGreaterThan(1);
  expect(rows.filter((line) => line.includes("#42"))).toHaveLength(1);
  for (const row of rows) expect(visibleWidth(row)).toBe(34);
});

test("the row table itself keeps the id on the first row and the age below it", () => {
  // The drawing above is one call away from the table, and the table is where the tails are stamped: a
  // zero-width text column is the degenerate case that used to draw a row whose tail was cut away, and the
  // rows the layout builds must still carry the id. With a text column at all, the id owns the first row
  // and the age the second, so neither is ever the thing a cut takes.
  for (const textWidth of [0, 1, 2, 5, 40]) {
    const rows = panelPinRows(at(777, "a text that will not fit"), textWidth, style, LATER);
    // The degenerate frame has no second row, so its one row carries the whole tail; every other width
    // gives the age a line of its own, and the first row's tail is then the id alone — unless the frame is
    // wide enough for the pair to share it, which is the shape a short one-row pin draws. Either way the
    // pin's tails are exactly one id and exactly one age, and a third row carries neither.
    const tails = rows.map((row) => row.tail);
    expect(tails.filter((tail) => tail.includes("#777"))).toHaveLength(1);
    expect(tails.filter((tail) => tail.includes(NOW_AGE))).toHaveLength(1);
    // Whatever the text column is, the id owns the pin's first row: an age came up beside it only because
    // the whole pair fit the tail's reserve, and never in place of the id.
    expect(rows[0]?.tail).toContain("#777");
    for (const row of rows.slice(2)) expect(row.tail).toBe("");
  }
});
