/**
 * The row table the panel's window is cut from: what each pin contributes to it, and the degenerate
 * cases the scroll window depends on — a pin with no text still owns a row, so the selection bar always
 * has something to sit on, and no pin is ever skipped when the table is built.
 *
 * The window itself, the gutters it is drawn between and the borders above and below it are
 * `panel-lines.test.ts`; this file is the table only.
 */
import { expect, test } from "bun:test";

import { panelAllRows, panelPinRows } from "../src/panel-rows.ts";
import type { PanelStyle as RenderPanelStyle } from "../src/render.ts";
import type { ViewPin } from "../src/types.ts";
import { NOW_AGE } from "./fixtures-age.ts";
import { LATER, NOW, pin, view } from "./fixtures.ts";
import { built } from "./panel-frame.ts";

const plainStyle: RenderPanelStyle = {
  header: (s) => s,
  marker: (_level, s) => s,
  dim: (s) => s,
  selected: (s) => `[${s}]`,
  border: (s) => s,
  borderFocused: (s) => s,
};

const one = (id: number, text: string, extra: Partial<ViewPin> = {}): ViewPin => ({
  ...pin(id, text, "info", extra),
  ...extra,
});

const content = (pins: readonly ViewPin[], selection = 0, focused = false) => ({
  pins,
  selection,
  focused,
  // Required by `PanelContent`; these cases are about the rows, not the resting label.
  replyHint: "",
  ageNow: LATER,
});

test("an empty pin text still owns a row, so the bar has something to sit on", () => {
  const rows = panelPinRows(one(1, ""), 20, plainStyle);
  expect(rows).toHaveLength(1);
  expect(rows[0]?.text).not.toBe("");
  expect(rows[0]?.tail).toContain("#1");
});

test("a zero text width falls back to one row rather than none", () => {
  expect(panelPinRows(one(1, "text"), 0, plainStyle)).toHaveLength(1);
});

test("rows are built for every pin in order and no pin is skipped", () => {
  const pins = [one(1, "a"), one(2, "bb"), one(3, "ccc")];
  // The drawn tail, not the bare `#id`: `panelPinRows` stamps it through `panel-tail.ts`, and that string is
  // both what the row prints and what the reserve measures. A short text fits one row, so the id and the age
  // share the first row's tail; `plainStyle.dim` is identity, so the only difference from the undimmed
  // spelling is the leading space the tail carries into its own columns.
  expect(panelAllRows(pins, 30, plainStyle, LATER).map((row) => row.tail)).toEqual([
    ` #1 ${NOW_AGE}`,
    ` #2 ${NOW_AGE}`,
    ` #3 ${NOW_AGE}`,
  ]);
});

test("the view a test builds with fixtures.ts draws like any other", () => {
  const pins = view([pin(1, "Decide X", "action")]).pins;
  const lines = built(content(pins, 0, true), 40, plainStyle);
  // One action pin, so the title names the level rather than a bare count: `needs you` is what an action
  // costs the user, and it is the whole reason the counts replaced the old `(1)`.
  expect(lines[0]).toContain("📌 Pinned · 1 needs you");
  expect(lines[1]).toContain("?");
  expect(lines[1]).toContain("Decide X");
});
