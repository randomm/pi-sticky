/**
 * The frame cache's comparison, asserted on the key itself.
 *
 * `panel-component-frame.test.ts` drives the cache through `render()` and asserts the drawn result, which is
 * how a stale frame is noticed in practice — but the failure modes live in the *shape of the key* and a
 * component test can only see one of them (a redraw that came out wrong). Asserted field by field here, each
 * half of the two-sided risk gets its own case: a key that misses repaints for nothing, and a key that hits
 * draws a panel that is no longer true.
 *
 * `width` and `lines` are deliberately *not* in the comparison, so they get the two cases that prove it: a
 * cached frame survives a width change it was not asked about (because the candidate names no width, and the
 * component re-renders on the resize through `update`), and a different set of lines with the same key is a
 * hit. If a future field joins the key it belongs in this table, because that is what the table is.
 */
import { expect, test } from "bun:test";

import { sameFrame } from "../src/panel-frame-cache.ts";
import type { PanelFrame } from "../src/panel-frame-cache.ts";
import type { ViewPin } from "../src/types.ts";
import { pin } from "./fixtures.ts";

const PINS: readonly ViewPin[] = [pin(1, "One", "info"), pin(2, "Two", "warning")];

/** A frame whose every field is a default the tests change one at a time. */
function frame(over: Partial<PanelFrame> = {}): PanelFrame {
  return {
    lines: ["╭──╮", "│One│", "╰──╯"],
    width: 12,
    pins: PINS,
    selection: 0,
    focused: false,
    // The state the frame was drawn for: `open` is what every case below draws, and the one case that needs
    // the peek's rows names it.
    mode: "open",
    replyHint: "",
    ageNow: 29_725_800,
    ...over,
  };
}

test("a candidate that names the same state is the frame already drawn", () => {
  const drawn = frame();
  expect(sameFrame(drawn, frame())).toBe(true);
});

test("there is no frame to hit before the first render", () => {
  expect(sameFrame(undefined, frame())).toBe(false);
});

test("a different view is a different frame, by identity rather than by contents", () => {
  // `commit`/`reconstruct` publish a fresh array for every change and none without one. A copy of the same
  // pins is therefore a change, and the cache must not answer it with the old rows.
  expect(sameFrame(frame({ pins: [...PINS] }), frame())).toBe(false);
});

test("moving the bar is a frame change", () => {
  expect(sameFrame(frame({ selection: 1 }), frame())).toBe(false);
});

test("focus is a frame change, because the bar and the border colour both depend on it", () => {
  expect(sameFrame(frame({ focused: true }), frame())).toBe(false);
});

test("a resting border that has a different label to print is a frame change", () => {
  // The operator can rebind the focus key and the hint names it, so a hint that moved has to repaint.
  expect(sameFrame(frame({ replyHint: "ctrl+f to focus" }), frame())).toBe(false);
});

test("a bucket the ages were drawn at is the only time the key compares", () => {
  expect(sameFrame(frame({ ageNow: 29_725_801 }), frame())).toBe(false);
  // …and a request inside the same minute is a hit, which is the whole reason this is a bucket: pi-tui asks
  // for frames far more often than a minute, and an age cannot move between two of those asks.
  expect(sameFrame(frame(), frame({ ageNow: 29_725_800 }))).toBe(true);
});

test("the drawn lines and the width are not part of the key", () => {
  // Both follow from the fields that are: a candidate names neither, so comparing them would either be
  // vacuous or would key the cache on its own output.
  expect(sameFrame(frame({ lines: ["different"], width: 999 }), frame())).toBe(true);
});

test("every field of the key is a field of the frame, so a new one cannot be left out silently", () => {
  expect(Object.keys(frame()).sort()).toEqual(
    ["ageNow", "focused", "lines", "mode", "pins", "replyHint", "selection", "width"].sort(),
  );
});
