/**
 * What a border does when it has more to say than the frame has room for.
 *
 * The frame's promise is that it closes — corners, label, rule, at every size the builder draws at — and
 * the label is the only part of it that comes from outside (the header's count, the keys hint). So the
 * label is what gives way: cut with `…`, never pushed past a corner, never carrying an escape of the
 * builder's own making onto the screen. And below the size at which a box *can* close, the builder draws
 * nothing at all: an open frame is worse than no frame, because the panel is flush right and the chat
 * behind it would show through the gap.
 *
 * As the component draws it: `panelLayout` owns the row table *and* the frame height, and the builder is
 * handed both (`built` below), so no test sizes one frame and draws another.
 */
import { expect, test } from "bun:test";
import { visibleWidth } from "@earendil-works/pi-tui";

import { HINT, buildPanelLines } from "../src/panel-lines.ts";
import { panelLayout } from "../src/panel-rows.ts";
import type { PanelStyle as RenderPanelStyle } from "../src/render.ts";
import type { ViewPin } from "../src/types.ts";
import { pin } from "./fixtures.ts";
import { TERMINAL_ROWS, offenders } from "./panel-hostile.ts";

const style: RenderPanelStyle = {
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

/** A frame drawn at the height the caller asked for, with the row table `panelLayout` built for it. */
type PanelContent = ReturnType<typeof content>;

/**
 * The frame drawn exactly as the component draws it: `panelLayout` owns the row table *and* the height it
 * is `TERMINAL_ROWS` tall, and the builder is handed both — no caller can size one frame and draw another.
 */
function built(c: PanelContent, width: number, s: RenderPanelStyle): string[] {
  return buildPanelLines(c, width, s, panelLayout(c.pins, width, TERMINAL_ROWS, c.selection, s));
}

/** A frame the given width, with one pin, in whichever focus state the caller asked for. */
function frameOf(width: number, focused = false): string[] {
  return built(content([one(1, "Decide X")], 0, focused), width, style);
}

/** Every line the same visible width, or the panel would composite over the chat behind it. */
function expectUniformWidth(lines: string[], width: number): void {
  for (const line of lines) expect(visibleWidth(line)).toBe(width);
}

/** The smallest width at which the builder closes a frame at all (see `panel-lines.ts`). */
const MIN_FRAME_WIDTH = 30;

/** The hint is long; the widths that assert on it must be long enough to draw it whole. */
const HINT_WIDTH = 60;

test("a header or hint too long for the frame is cut with an ellipsis and the corners still close", () => {
  // The hint is 45 columns, so a 30-column frame has no room for it: the rule goes first and then the
  // hint itself is cut, while both corners keep the columns they were promised.
  const narrow = frameOf(MIN_FRAME_WIDTH, true);
  const last = narrow.length - 1;
  expectUniformWidth(narrow, MIN_FRAME_WIDTH);
  expect(narrow[last]?.startsWith("╰ ")).toBe(true);
  expect(narrow[last]?.includes("…")).toBe(true);
  expect(narrow[last]?.endsWith(" ╯")).toBe(true);
  expect(offenders(narrow[last] as string)).toEqual([]);
  // And at a width the hint fits in, the rule is what shrinks rather than the hint losing a character.
  const roomy = frameOf(HINT_WIDTH, true);
  expect(roomy.at(-1)).toContain(HINT);
  expect(roomy.at(-1)?.endsWith("╯")).toBe(true);

  const many = built(
    content(Array.from({ length: 9 }, (_u, i) => one(i + 1, "x"))),
    MIN_FRAME_WIDTH,
    style,
  );
  expect(many[0]).toContain("📌 Pinned for you (9)");
  expectUniformWidth(many, MIN_FRAME_WIDTH);
  expect(many[0]?.startsWith("╭")).toBe(true);
  expect(many[0]?.endsWith("╮")).toBe(true);
});

test("a frame too narrow to close draws nothing at all", () => {
  // Never an open box: below the overlay's own minWidth there is no inner width to lay out. The rows
  // half of the same refusal — a terminal with no room for both borders — is
  // `panel-lines.test.ts`, where the layout is sized against a terminal too short to halve into a box.
  for (const width of [1, 12, 20, MIN_FRAME_WIDTH - 1]) {
    expect(built(content([one(1, "x")]), width, style)).toEqual([]);
  }
});
