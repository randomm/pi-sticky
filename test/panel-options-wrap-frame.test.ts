/**
 * The options packing as the *frame* draws it, at the widths the wrap exists for.
 *
 * `panel-options-wrap.test.ts`-style unit assertions say what the packing returns for a list and a width. This
 * file asks the question a unit test cannot: does the frame that drew those rows still close, and does every
 * one of the model's options reach the screen? A wrap that counted rows the drawer could not fill, or filled
 * rows the window never owned, is a row the user scrolls past without ever seeing an option — so both halves
 * are compared at the width, not at the function.
 *
 * The two widths are the ones the spec names: 40 columns, and the narrowest frame the overlay is ever handed
 * (`Math.floor(PANEL_MIN_FRAME_COLUMNS * 33 / 100)` — the builder's floor at the overlay's own 33% anchor,
 * derived from the config rather than written as a literal so it cannot drift from either constant).
 */
import { expect, test } from "bun:test";
import { visibleWidth } from "@earendil-works/pi-tui";

import { ELLIPSIS } from "../src/panel-frame.ts";
import { PANEL_OVERLAY_OPTIONS } from "../src/panel-geometry.ts";
import { optionLine } from "../src/panel-options-row.ts";
import { optionColumns, optionRowCount } from "../src/panel-options-wrap.ts";
import { isOptionRow } from "../src/panel-rows.ts";
import type { PanelStyle } from "../src/render.ts";
import type { ViewPin } from "../src/types.ts";
import { NOW, pin } from "./fixtures.ts";
import { style } from "./panel-component-host.ts";
import { built, framed } from "./panel-frame.ts";
import { MIN_FRAME_WIDTH, TERMINAL_ROWS } from "./panel-hostile.ts";

/** The 40-column frame the spec names. */
const WIDE = 40;

/**
 * The narrowest frame the overlay is ever handed at a 100-column terminal: the overlay's `width` share taken
 * of 100 columns, which at the shipped config is `PANEL_MIN_FRAME_COLUMNS` itself.
 *
 * Read out of `PANEL_OVERLAY_OPTIONS` rather than hardcoded: the two numbers belong to the config, and a test
 * that wrote `33` would still pass after someone moved either of them.
 */
const NARROW = Math.floor((100 * percent(PANEL_OVERLAY_OPTIONS.width ?? "")) / 100);

/** The column share an overlay `width` states — `"33%"` is 33, an absolute width is itself. */
function percent(width: string | number): number {
  return typeof width === "string" ? Number.parseFloat(width) : Number(width);
}

/** The longest label a pin may store, repeated with distinct heads so no two entries collapse together. */
const LONG = (head: string): string => `${head}${"z".repeat(24 - head.length)}`;

/** Four `MAX_FIELD_GRAPHEMES` options: at a narrow frame, none of them shares a row with another. */
const FOUR_LONG = ["ab", "cd", "ef", "gh"].map((head) => LONG(`${head}_option_label`));

/**
 * The four options, one grapheme *over* `MAX_FIELD_GRAPHEMES` each.
 *
 * A pin may not store these (`pin-fields.ts` refuses an oversized entry), and a frame never draws them — but
 * the view is also built directly, by a test or by any future caller, and the rule "an entry too wide for a
 * row keeps its digit and cuts its label" can only be reached past the stored bound at this frame width. This
 * is the same reason the drawn surfaces strip and fold a label rather than trusting the store: the store
 * refuses, the drawer must not be surprised.
 */
const FOUR_OVER = FOUR_LONG.map((label) => `${label}${"over".repeat(3)}`);

/** One pin with these options, on a text short enough to own a single row of its own. */
const optioned = (id: number, options: string[]): ViewPin => ({
  ...pin(id, "decide", "action", { createdAt: NOW }),
  options,
});

/** The rows between the frame's borders, so an assertion reads content and never a border glyph. */
const inside = (lines: string[]): string[] => lines.slice(1, -1);

/** A drawn row's inner columns — what sits between the gutters, the drawer's framing taken back off. */
const between = (row: string): string => row.replace(/^\u2502 /, "").replace(/ \u2502$/, "");

/** The widths both sweeps run: the named one, the derived one, and the builder's own floor. */
const WIDTHS = [WIDE, NARROW, MIN_FRAME_WIDTH];

/**
 * A theme that writes **visible** bytes rather than colour around the two verbs an option row is composed from.
 *
 * The shape `test/panel-lines-hostile-theme.test.ts` calls a "wrapped" theme, and the one the options rows were
 * never swept against: a `header`/`dim` that returns `[1]` and `<label>` spends columns a colour costs none, so
 * a count measured on the bare label reserved rows the draw then refused to fill. Pi's own theme colours and
 * draws nothing, so the shipped suite could not see the difference between the two measurements.
 */
const visibleBytes: PanelStyle = {
  ...style,
  header: (s) => `[${s}]`,
  dim: (s) => `<${s}>`,
};

/**
 * The labels that used to draw a wholly blank row under such a theme.
 *
 * `word ` × 8 measured 25 columns unthemed — inside a 40-column frame's inner 36 — and 35 once the theme's
 * brackets went on, so the packer seated a second entry next to it, the cut refused it, and the row that row was
 * counted for drew nothing at all.
 */
const BRACKET_TRIP = ["x".repeat(24), "word ".repeat(8)];

test("a theme whose verbs draw bytes reserves no row it cannot fill, and no row it fills comes back blank", () => {
  // The frame-level half of the count: whatever the theme wrote around the keycap, the rows the table counted
  // are the rows the drawer has a line for, each one naming at least one option by its digit, and each one
  // closing at the frame. A counted-but-blank row is the defect: the window scrolls past it, the bar can sit on
  // it, and `d`/`Enter`/the digit keys index it as though it answered something.
  for (const width of [33, 36, 40, 48, 60]) {
    for (const options of [BRACKET_TRIP, ["word ".repeat(8)], ["word ".repeat(12)], FOUR_LONG]) {
      const view = [optioned(3, options)];
      const { lines, layout } = framed(
        { pins: view, selection: 0, focused: false, replyHint: "", ageNow: NOW },
        width,
        visibleBytes,
        TERMINAL_ROWS,
      );
      const reserved = layout.owned.filter((entry) => isOptionRow(entry.row)).length;
      expect(reserved, `${options.length} options at ${width}`).toBe(
        optionRowCount(options, width, visibleBytes),
      );
      // The frame drew every row of the table, so what was counted is what was printed — nothing scrolled away.
      const rows = inside(lines);
      expect(rows.length, `every counted row is drawn at ${width}`).toBe(layout.owned.length);
      for (let k = 0; k < reserved; k++) {
        const drawn = between(rows[1 + k] ?? "");
        expect(visibleWidth(rows[1 + k] ?? ""), `row ${k} at ${width}`).toBe(width);
        // A counted row is a row the wrap has a line for, and that line names an option: no row of padding, and
        // no row whose every digit the cut ate.
        expect(drawn.trimEnd(), `row ${k} at ${width} is not blank`).not.toBe("");
        expect(
          options.some((_label, index) => drawn.includes(String(index + 1))),
          `row ${k} at ${width} carries a digit the user can press`,
        ).toBe(true);
        expect(drawn, `row ${k} at ${width} is the wrap's own line`).toBe(
          optionLine(view[0] as ViewPin, optionColumns(width), visibleBytes, k) ?? "",
        );
      }
      for (const line of lines) expect(visibleWidth(line), `@${width}`).toBe(width);
    }
  }
});

test("every option of a wrapped pin still reaches the frame under a visible-bytes theme", () => {
  // The other half of the same theme: a row the cut shortens is the *label's* tail it gives up, never its
  // entry. Under the old asymmetry an entry the theme widened could vanish whole while its row stayed, so the
  // user read a list with a hole in the numbering — an option the model offered and no row ever named.
  const view = [optioned(4, FOUR_LONG)];
  for (const width of [36, 48, 60]) {
    const lines = built(
      { pins: view, selection: 0, focused: false, replyHint: "", ageNow: NOW },
      width,
      visibleBytes,
      TERMINAL_ROWS,
    );
    const content = inside(lines).join("\n");
    FOUR_LONG.forEach((_label, index) => {
      expect(
        content.includes(String(index + 1)),
        `option ${index + 1} is named at ${width} columns`,
      ).toBe(true);
    });
    for (const line of lines) expect(visibleWidth(line), `@${width}`).toBe(width);
  }
});

test("every option the model named reaches the frame at all three widths", () => {
  for (const width of WIDTHS) {
    const view = [optioned(1, FOUR_LONG)];
    const lines = built(
      { pins: view, selection: 0, focused: false, replyHint: "", ageNow: NOW },
      width,
      style,
      TERMINAL_ROWS,
    );
    const content = inside(lines).join("\n");
    FOUR_LONG.forEach((label, index) => {
      // The digit is the key the user presses, so a row that kept a label and lost its digit — or the reverse —
      // is a row that lies about what the option is. At the widest of these the whole entry is present; at the
      // narrowest the label is the half that gives columns up, which is the case the next test owns.
      expect(
        content.includes(String(index + 1)),
        `option ${index + 1} is named at ${width} columns`,
      ).toBe(true);
    });
    for (const line of lines) expect(visibleWidth(line)).toBe(width);
  }
});

test("the frame draws exactly the rows the wrap counted, and fills each one", () => {
  // The identity the split used to make possible, at the widths where it could actually break: the row table
  // reserves `optionRowCount` rows and the drawer fills `optionRowCount` lines, at the one width both read.
  for (const width of WIDTHS) {
    const view = [optioned(1, FOUR_LONG)];
    const { lines, layout } = framed(
      { pins: view, selection: 0, focused: false, replyHint: "", ageNow: NOW },
      width,
      style,
      TERMINAL_ROWS,
    );
    const reserved = layout.owned.filter((entry) => isOptionRow(entry.row)).length;
    expect(reserved).toBe(optionRowCount(FOUR_LONG, width, style));
    const rows = inside(lines);
    // A tall terminal, so the window reaches every row: what the table counted is what the frame drew.
    expect(rows.length).toBe(layout.owned.length);
    for (let k = 0; k < reserved; k++) {
      const filled = optionLine(view[0] as ViewPin, optionColumns(width), style, k);
      expect(filled, `the wrap has a line for its own row ${k}`).not.toBeNull();
      expect(between(rows[1 + k] ?? ""), `row ${k} at ${width}`).toBe(filled ?? "");
      expect(visibleWidth(rows[1 + k] ?? "")).toBe(width);
    }
  }
});

test("an entry wider than the row keeps its digit and cuts its label, at the narrowest frame", () => {
  // The rule the one-row drawer did not have: an entry that will not close inside the frame gets a row of its
  // own and gives its *label's* tail up, because the digit is the key the user presses and a row that lost it
  // would name an option no key answers.
  const view = [optioned(1, FOUR_OVER)];
  const { lines, layout } = framed(
    { pins: view, selection: 0, focused: false, replyHint: "", ageNow: NOW },
    NARROW,
    style,
    TERMINAL_ROWS,
  );
  const rows = inside(lines);
  const reserved = layout.owned.filter((entry) => isOptionRow(entry.row)).length;
  expect(reserved).toBe(FOUR_OVER.length);
  // One entry per row at this width, each opening with its own digit, and the widest of them cut rather than
  // dropped: the ellipsis is the wrap's, and the digit in front of it is the entry's position.
  for (let k = 0; k < reserved; k++) {
    const row = between(rows[1 + k] ?? "");
    expect(row.trimStart(), `row ${k} opens with its own digit`).toMatch(
      new RegExp(`^\\s*${k + 1} `),
    );
  }
  const joined = rows.join("\n");
  expect(joined).toContain(ELLIPSIS);
  for (const line of lines) expect(visibleWidth(line)).toBe(NARROW);
});

test("the reserved count and the drawn count agree for every width the builder closes at", () => {
  // The sweep's cheap half: the two halves of the frame ask the wrap the same question at the same width, so
  // they cannot disagree — asserted directly, over the range where a packing bug would start.
  for (const width of WIDTHS) {
    for (const options of [
      ["a", "b"],
      ["Passed on", "Not yet", "Escalated to the on-call", "Deferred to next quarter"],
      FOUR_LONG,
    ]) {
      const view = [optioned(9, options)];
      const { layout } = framed(
        { pins: view, selection: 0, focused: false, replyHint: "", ageNow: NOW },
        width,
        style,
        TERMINAL_ROWS,
      );
      const reserved = layout.owned.filter((entry) => isOptionRow(entry.row)).length;
      expect(reserved, `${options.length} options at ${width}`).toBe(
        optionRowCount(options, width, style),
      );
      // And the drawer has a line for each of them: no reserved row the wrap would answer blank.
      for (let k = 0; k < reserved; k++) {
        expect(optionLine(view[0] as ViewPin, optionColumns(width), style, k)).not.toBeNull();
      }
    }
  }
});
