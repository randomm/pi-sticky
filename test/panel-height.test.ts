/**
 * The ceiling and the counted height of one frame, as two pure numbers.
 *
 * `panelMaxRows` is the tallest frame pi may ever draw and `panelFrameRows` is the height a given set of
 * rows comes to. The two promises that matter are that the ceiling is *half the terminal* and no more —
 * so a frame is never taller than the terminal it is drawn in — and that a terminal which cannot be asked
 * answers with the fallback rather than with zero rows and no panel at all.
 *
 * The component's side of it — a frame is as tall as its content, and a resize lays out at the width just
 * asked for — is `panel-component-height.test.ts`; the builder's refusal of a height it cannot close is
 * `panel-lines.test.ts`, and the refusal of a theme whose glyphs are not one column each is
 * `panel-frame-theme.test.ts`.
 */
import { expect, test } from "bun:test";

import { BORDER_ROWS, panelFrameRows, panelMaxRows } from "../src/panel-height.ts";

/** Rows assumed when neither the overlay's bounds nor the terminal can be asked. */
const FALLBACK_ROWS = 24;

/** The row counts that are not a terminal: nothing stated, zero, or not a positive finite number. */
const UNASKABLE: (number | undefined)[] = [undefined, 0, Number.NaN, Number.POSITIVE_INFINITY];

test("the ceiling is half the terminal, floored, and never more than the terminal itself", () => {
  expect(panelMaxRows(40)).toBe(20);
  // An odd row count leaves the extra row to the transcript, it does not round the panel up.
  expect(panelMaxRows(41)).toBe(20);
  expect(panelMaxRows(400)).toBe(200);
  // The floor the old implementation kept (`Math.max(3, …)`) is what let a frame claim more rows than a
  // short terminal had, so a small terminal is capped to half of itself however small that is.
  expect(panelMaxRows(5)).toBe(2);
  expect(panelMaxRows(3)).toBe(1);
  for (const rows of [1, 2, 3, 5, 40, 400]) {
    expect(panelMaxRows(rows)).toBeLessThanOrEqual(rows);
  }
});

test("a terminal that cannot be asked answers with the fallback halved, not with zero", () => {
  for (const rows of UNASKABLE) {
    expect(panelMaxRows(rows)).toBe(FALLBACK_ROWS / 2);
  }
});

test("the counted height is the frame over the rows, cut to the ceiling and never below a closed box", () => {
  expect(panelFrameRows(1, 40)).toBe(1 + BORDER_ROWS);
  expect(panelFrameRows(18, 40)).toBe(20);
  // Past the ceiling the frame is the ceiling: the window scrolls, the box does not grow.
  expect(panelFrameRows(100, 40)).toBe(20);
  // No padding to the ceiling: two pins are four rows and the prompt stays visible beside them.
  expect(panelFrameRows(2, 400)).toBe(4);
  // The degenerate case stays a *closed* frame — two borders and nothing between them — which the
  // builder then refuses to draw (`panel-lines.test.ts`).
  expect(panelFrameRows(0, 40)).toBe(BORDER_ROWS);
  expect(panelFrameRows(0, 5)).toBe(BORDER_ROWS);
  // A ceiling below the frame's floor comes back as the floor, so the answer is always a whole box:
  // `panelMaxRows` has no minimum of its own any more, so a short terminal really does say two rows.
  expect(panelFrameRows(100, 5)).toBe(BORDER_ROWS);
  for (const rows of UNASKABLE) {
    expect(panelFrameRows(100, rows)).toBe(FALLBACK_ROWS / 2);
  }
});
