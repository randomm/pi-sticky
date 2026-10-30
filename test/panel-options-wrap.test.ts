/**
 * The one packing that decides what a pin's options cost the frame, tested at the width rather than through a
 * frame (`panel-options-wrap.ts`).
 *
 * Three promises, and each is a different way the two halves of the frame used to disagree:
 *
 * 1. **The count and the rows are one answer.** `optionRowCount` is what the row table reserves and
 *    `drawOptionRows` is what the drawer fills; they are read from the same `pack`, so they cannot differ, and
 *    the test says so by comparing them rather than by remembering a number.
 * 2. **Entries pack whole, and only an entry too wide for the row is cut** — and the cut keeps the digit,
 *    because the digit is the key the user presses.
 * 3. **Every row closes at the width it was packed at.** The panel is flush right, so a short row lets the chat
 *    behind it show through; a row the wrap hands over at the wrong width is a row the drawer re-cuts, which is
 *    how a pin's characters used to go.
 *
 * `optionColumns` is exercised as the shared width: the row table asks the wrap for it, so the figure the
 * labels are packed at is the figure the frame draws between its gutters, not a number this file agrees with.
 */
import { describe, expect, test } from "bun:test";
import { visibleWidth } from "@earendil-works/pi-tui";

import { ELLIPSIS } from "../src/panel-frame.ts";
import { drawOptionRows, optionColumns, optionRowCount } from "../src/panel-options-wrap.ts";
import type { PanelStyle } from "../src/render.ts";
import { plainStyle } from "../src/render.ts";

/** Identity colours: a row is measured on what the panel asked for, never on a theme's bytes. */
const style: PanelStyle = {
  header: (s) => s,
  marker: (_level, s) => s,
  dim: (s) => s,
  selected: (s) => s,
  border: (s) => s,
  borderFocused: (s) => s,
};

const LONG = (head: string): string => `${head}${"z".repeat(24 - head.length)}`;
const FOUR_LONG = ["ab", "cd", "ef", "gh"].map((head) => LONG(`${head}_option_label`));

describe("the options packing", () => {
  test("the count is the number of rows the drawer produces, at every width", () => {
    // The identity the split used to allow to drift, stated as an identity rather than as a number: whatever
    // the labels and whatever the width, the figure the row table reserves is the figure the drawer fills.
    for (const width of [26, 33, 40, 60, 80, 120]) {
      for (const options of [[], ["a"], ["a", "b"], ["a", "b", "c"], FOUR_LONG]) {
        const reserved = optionRowCount(options, width, style);
        const rows = drawOptionRows(options, optionColumns(width), style);
        expect(rows.length, `${options.length} options at ${width}`).toBe(reserved);
        // And the count only ever grows with the labels: a pin with no options owns no rows at all, which is the
        // row table's signal to reserve nothing.
        if (options.length === 0) expect(reserved).toBe(0);
        else expect(reserved).toBeGreaterThanOrEqual(1);
      }
    }
  });

  test("entries pack whole: a row never opens with a half-label", () => {
    const options = ["alpha", "beta", "gamma", "delta"];
    for (let width = 24; width <= 60; width++) {
      const rows = drawOptionRows(options, optionColumns(width), style);
      for (const row of rows) {
        const content = row.trimEnd();
        // Every digit that appears on a row is followed by its whole label: an entry is packed together or it
        // is not packed, which is the difference between an option the user can answer and one they cannot.
        options.forEach((label, index) => {
          if (content.includes(`${index + 1} ${label.charAt(0)}`)) {
            expect(content, `${label} at ${width}`).toContain(`${index + 1} ${label}`);
          }
        });
      }
    }
  });

  test("an entry too wide for a row gets its own row, keeps its digit, and cuts its label", () => {
    // Past the stored bound (`pin-fields.ts` refuses an oversized entry, and the view is still built directly
    // by tests and future callers), an entry cannot close inside the inner width. The wrap's answer is a row of
    // its own with the *label* shortened, never the digit: the digit is the key the user presses.
    const over = `${FOUR_LONG[0]}${"over".repeat(3)}`;
    const rows = drawOptionRows([over, "a"], optionColumns(33), style);
    expect(rows.length).toBe(2);
    expect(rows[0]).toContain("1 ");
    expect(rows[0]).toContain(ELLIPSIS);
    expect(visibleWidth(rows[0] ?? "")).toBe(optionColumns(33));
    expect(rows[1]?.trimEnd()).toBe("2 a");
  });

  test("every row closes at exactly the width it was packed at, from one column up", () => {
    // The flush-right promise, at the packing rather than at the frame: a row that came back short would let
    // the chat behind the panel show through, and one that came back long would be re-cut by the drawer.
    for (let width = 1; width <= 70; width++) {
      for (const options of [[], ["a"], FOUR_LONG]) {
        for (const row of drawOptionRows(options, optionColumns(width), style)) {
          expect(visibleWidth(row), `${options.length} options at ${width}`).toBe(
            optionColumns(width),
          );
        }
      }
    }
  });

  test("no options, a zero width or a negative width own no rows at all", () => {
    // The three degenerate inputs the row table can hand the wrap. Each answers *no rows* rather than a row of
    // padding: a reserved row the wrap has nothing for is a row the window counts and the bar can sit on.
    expect(optionRowCount(undefined, 60, style)).toBe(0);
    expect(optionRowCount([], 60, style)).toBe(0);
    expect(optionRowCount(["a"], 0, style)).toBe(0);
    expect(optionRowCount(["a"], -10, style)).toBe(0);
    expect(drawOptionRows(["a"], 0, style)).toEqual([]);
  });

  test("optionColumns is the frame less the gutters, which is the width the builder draws at", () => {
    // The row table and the drawer both ask for this figure rather than subtracting it themselves; the frame
    // (`panel-lines.ts`) draws between the gutters at the same subtraction. One owner, so one source of truth.
    for (const width of [30, 33, 40, 60, 100]) {
      expect(optionColumns(width)).toBe(width - 4);
    }
  });

  test("a theme whose verbs add visible bytes still gets rows of exactly the inner width", () => {
    // The wrap measures with the theme's bytes in the row, not around them: a `header`/`dim` that wrote visible
    // bytes around a keycap would otherwise hand the frame a row wider than the columns it was given, and the
    // drawer's re-cut is where a label's characters used to go.
    const coloured: PanelStyle = {
      ...style,
      header: (s) => `H[${s}]`,
      dim: (s) => `D[${s}]`,
    };
    for (const width of [40, 60]) {
      for (const row of drawOptionRows(FOUR_LONG, optionColumns(width), coloured)) {
        expect(visibleWidth(row)).toBe(optionColumns(width));
      }
    }
  });

  test("a theme whose verbs add visible bytes reserves exactly the rows it can fill", () => {
    // The counting half of the same measurement. A `header`/`dim` that writes *visible* bytes — a box around the
    // keycap, padding inside the colour — charges columns the unthemed label never paid for, and a count taken
    // on the bare label while the rows are drawn themed left a row the packer reserved, the cut emptied and the
    // window still scrolled past: a counted row of pure padding, with no digit on it for the keys to answer.
    // So the count is taken through the style as well, and this says the two figures are one answer whatever
    // the theme wrote.
    const visibleBytes: PanelStyle = {
      ...style,
      header: (s) => `[${s}]`,
      dim: (s) => `<${s}>`,
    };
    // The labels the old asymmetry emptied: the unthemed `1 <label>` measured inside the row while the themed
    // `[1] <label>` did not, so the packer seated an entry the cut then refused, and a row of nothing was left
    // where a counted row had been. `word ` × 8/12 is the label that used to draw a wholly blank row.
    const cases: readonly (readonly string[])[] = [
      ["x".repeat(24), "word ".repeat(8)],
      ["word ".repeat(8)],
      ["word ".repeat(12)],
      ["word ".repeat(4), "word ".repeat(4), "word ".repeat(4)],
      ["x".repeat(24), "x".repeat(24), "word ".repeat(8), "b"],
      FOUR_LONG,
    ];
    for (const width of [33, 36, 40, 48, 60]) {
      for (const options of cases) {
        const reserved = optionRowCount(options, width, visibleBytes);
        const rows = drawOptionRows(options, optionColumns(width), visibleBytes);
        expect(rows.length, `${options.length} options at ${width}`).toBe(reserved);
        for (const [index, row] of rows.entries()) {
          expect(visibleWidth(row), `row ${index} at ${width}`).toBe(optionColumns(width));
          // A row the table counted is a row that names at least one option by its digit: a blank row is not a
          // row, and the bar, `d` and the digit keys would all index a row that answers nothing.
          expect(row.trimEnd(), `row ${index} at ${width} names an option`).not.toBe("");
          const digits = options.map((_label, i) => String(i + 1));
          expect(
            digits.some((digit) => row.includes(digit)),
            `row ${index} at ${width} carries a digit the user can press`,
          ).toBe(true);
        }
      }
    }
  });

  test("the count is always its own theme's answer, and one theme can never borrow another's rows", () => {
    // The reserve and the draw read one style, which is the agreement that matters. A theme that draws bytes
    // *spends* columns, so it can legitimately need **more** rows than an identity theme for the same labels —
    // one more entry split off its neighbour is one more row — and asserting `<=` here would be asserting that
    // the theme costs nothing. What the count may never do is answer one theme's packing with another theme's
    // row table: each theme's number is exactly the number of rows that same theme's drawer fills.
    const visibleBytes: PanelStyle = {
      ...style,
      header: (s) => `[${s}]`,
      dim: (s) => `<${s}>`,
    };
    const options = ["Passed on", "Not yet", "Escalated to the vendor today", "Deferred"];
    for (const width of [33, 40, 48, 60, 100]) {
      for (const theme of [style, visibleBytes]) {
        const reserved = optionRowCount(options, width, theme);
        const rows = drawOptionRows(options, optionColumns(width), theme);
        expect(reserved, `at ${width}`).toBe(rows.length);
        for (const [index, row] of rows.entries()) {
          expect(visibleWidth(row), `row ${index} at ${width}`).toBe(optionColumns(width));
          expect(row.trimEnd(), `row ${index} at ${width} names an option`).not.toBe("");
        }
      }
      // And the theme really is charged: drawing bytes around every cell cannot leave the row count untouched
      // at a width where the labels were already tight.
      const plain = optionRowCount(options, width, style);
      const themed = optionRowCount(options, width, visibleBytes);
      expect(themed, `at ${width}`).toBeGreaterThanOrEqual(plain);
      expect(plain, `at ${width}`).toBeGreaterThan(0);
    }
  });

  test("the digit names the position in the list, whatever row an entry landed on", () => {
    // The digit is the key the user presses, so entry *N* is drawn as `N` on whichever row the packing placed
    // it. A wrap that numbered the entries per row would send the answer to an option the user never saw.
    const rows = drawOptionRows(FOUR_LONG, optionColumns(60), style);
    const joined = rows.join("\n");
    FOUR_LONG.forEach((label, index) => {
      expect(joined).toContain(`${index + 1} ${label}`);
    });
  });
});
