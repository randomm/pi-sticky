/**
 * The row table the panel's window is cut from: what each pin contributes to it, and the degenerate
 * cases the scroll window depends on — a pin with no text still owns a row, so the selection bar always
 * has something to sit on, and no pin is ever skipped when the table is built.
 *
 * The window itself, the gutters it is drawn between and the borders above and below it are
 * `panel-lines.test.ts`; this file is the table only.
 */
import { expect, test } from "bun:test";

import { widestMetaColumns } from "../src/panel-frame-geometry.ts";
import { panelAllRows, panelPinRows } from "../src/panel-rows.ts";
import type { PanelStyle as RenderPanelStyle } from "../src/render.ts";
import type { ViewPin } from "../src/types.ts";
import { NOW_AGE } from "./fixtures-age.ts";
import { LATER, NOW, pin, view } from "./fixtures.ts";
import { built } from "./panel-frame.ts";
import { innerAt } from "./panel-rows-frame.ts";
/** What a test writes to ask for a frame; `drawnFrame` adds the sections the frame's title prints. */
function content(
  pins: readonly ViewPin[],
  selection = 0,
  focused = false,
  replyHint = "",
  ageNow = LATER,
) {
  return { pins, selection, focused, replyHint, ageNow };
}

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

test("an empty pin text still owns a row, so the bar has something to sit on", () => {
  const rows = panelPinRows(
    one(1, ""),
    20,
    plainStyle,
    widestMetaColumns([one(1, "")], plainStyle.dim, LATER),
    innerAt(20),
    LATER,
    // Rows built outside a frame: no bar, so no expansion.
    undefined,
  );
  expect(rows).toHaveLength(1);
  expect(rows[0]?.text).not.toBe("");
  expect(rows[0]?.tail).toContain("#1");
});

test("a zero text width falls back to one row rather than none", () => {
  expect(
    panelPinRows(
      one(1, "text"),
      0,
      plainStyle,
      widestMetaColumns([one(1, "text")], plainStyle.dim, LATER),
      innerAt(0),
      LATER,
      // Rows built outside a frame: no bar, so no expansion.
      undefined,
    ),
  ).toHaveLength(1);
});

test("rows are built for every pin in order and no pin is skipped", () => {
  const pins = [one(1, "a"), one(2, "bb"), one(3, "ccc")];
  // The drawn tail, not the bare `#id`: `panelPinRows` stamps it through `panel-tail.ts`, and that string is
  // both what the row prints and what the reserve measures. A short text fits one row, so the id and the age
  // share the first row's tail; `plainStyle.dim` is identity, so the only difference from the undimmed
  // spelling is the leading space the tail carries into its own columns.
  expect(
    panelAllRows(pins, 30, plainStyle, undefined, undefined, LATER).map((row) => row.tail),
  ).toEqual([` #1 ${NOW_AGE}`, ` #2 ${NOW_AGE}`, ` #3 ${NOW_AGE}`]);
});

test("the view a test builds with fixtures.ts draws like any other", () => {
  const pins = view([pin(1, "Decide X", "action")]).pins;
  const lines = built(content(pins, 0, true), 40, plainStyle);
  // One action pin, so the title names the level rather than a bare count: `needs you` is what an action
  // costs the user, and it is the whole reason the counts replaced the old `(1)`.
  expect(lines[0]).toContain("📌 Pinned · 1 needs you");
  // The pin is the bar's row, so its level glyph has given its column to the selection marker (#70 decision
  // 2) — the mark that survives a terminal with no colours. The level's own glyph is what an *unfocused* row
  // of the same pin draws, which is the next assertion below and the case `panel-lines.test.ts` sweeps.
  expect(lines[1]).toContain(String.fromCodePoint(0x203a));
  expect(lines[1]).toContain("Decide X");
  expect(built(content(pins, 0, false), 40, plainStyle)[1]).toContain("?");
});
