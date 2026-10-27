/**
 * The row table the panel's window is cut from: what each pin contributes to it, and the degenerate
 * cases the scroll window depends on — a pin with no text still owns a row, so the selection bar always
 * has something to sit on, and no pin is ever skipped when the table is built.
 *
 * The window itself, the gutters it is drawn between and the borders above and below it are
 * `panel-lines.test.ts`; this file is the table only.
 */
import { expect, test } from "bun:test";

import { buildPanelLines } from "../src/panel-lines.ts";
import { panelAllRows, panelLayout, panelPinRows } from "../src/panel-rows.ts";
import type { PanelStyle as RenderPanelStyle } from "../src/render.ts";
import type { ViewPin } from "../src/types.ts";
import { NOW, localTime, pin, view } from "./fixtures.ts";
import { TERMINAL_ROWS } from "./panel-hostile.ts";

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
});

test("an empty pin text still owns a row, so the bar has something to sit on", () => {
  const rows = panelPinRows(one(1, ""), 20, plainStyle);
  expect(rows).toHaveLength(1);
  expect(rows[0]?.text).not.toBe("");
  expect(rows[0]?.meta).toContain("#1");
});

test("a zero text width falls back to one row rather than none", () => {
  expect(panelPinRows(one(1, "text"), 0, plainStyle)).toHaveLength(1);
});

test("rows are built for every pin in order and no pin is skipped", () => {
  const pins = [one(1, "a"), one(2, "bb"), one(3, "ccc")];
  expect(panelAllRows(pins, 30, plainStyle).map((row) => row.meta)).toEqual([
    `#1 ${localTime(NOW)}`,
    `#2 ${localTime(NOW)}`,
    `#3 ${localTime(NOW)}`,
  ]);
});

test("the view a test builds with fixtures.ts draws like any other", () => {
  const pins = view([pin(1, "Decide X", "action")]).pins;
  const lines = buildPanelLines(
    content(pins, 0, true),
    40,
    plainStyle,
    panelLayout(pins, 40, TERMINAL_ROWS, 0, plainStyle),
  );
  expect(lines[0]).toContain("📌 Pinned for you (1)");
  expect(lines[1]).toContain("?");
  expect(lines[1]).toContain("Decide X");
});
