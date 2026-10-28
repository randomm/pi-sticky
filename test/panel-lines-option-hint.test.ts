/**
 * The focused frame's bottom border over a pin that carries `options` (`src/panel-option-hint.ts`).
 *
 * The plain hint (`HINT`, `panel-lines.ts`) names the keys every panel answers. A pin with options answers
 * more of them — `1` to `N` each fill the editor with that option's reply — and a key the user cannot read
 * is a key they will not press, so the focused border names the digit range with the real count. That label
 * is the longest one the border ever carries, which makes these cases the ones that reach `fitLabel`'s cut
 * first: the two promises this file owns are that the *count* is spelled per pin and that the frame still
 * closes at every size the builder draws at.
 *
 * Split out of `panel-lines.test.ts` for the project's 300-line limit — the frame's own promises (uniform
 * width, the header, the highlight) stay there, and a fourth file, `panel-option-hint.test.ts`, owns the
 * label and its selection rule rather than the drawn frame.
 */
import { expect, test } from "bun:test";
import { visibleWidth } from "@earendil-works/pi-tui";

import { ELLIPSIS } from "../src/panel-frame.ts";
import { PANEL_MIN_FRAME_COLUMNS } from "../src/panel-geometry.ts";
import { HINT } from "../src/panel-lines.ts";
import { optionHint } from "../src/panel-option-hint.ts";
import { MAX_OPTIONS } from "../src/pin-fields.ts";
import type { PanelStyle } from "../src/render.ts";
import type { ViewPin } from "../src/types.ts";
import { LATER, pin } from "./fixtures.ts";
import { built } from "./panel-frame.ts";

/** Identity colours, so a drawn line can be compared to what was asked for. */
const style: PanelStyle = {
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

/** What a test writes to ask for a frame; `built` adds the sections the frame's title prints. */
const content = (pins: readonly ViewPin[], selection = 0, focused = false) => ({
  pins,
  selection,
  focused,
  replyHint: "",
  ageNow: LATER,
});

/** The option labels one pin may carry, long enough that a narrow border has to cut the hint. */
const OPTIONS = ["Passed on", "Not yet", "Escalated", "Deferred"];

/** Room for the longest option hint — `1–4 answer · ` in front of `HINT` — plus its margins and corners. */
const WIDE = 72;

/** Every line the same visible width, or the panel would composite over the chat behind it. */
function expectUniformWidth(lines: string[], width: number): void {
  for (const line of lines) expect(visibleWidth(line)).toBe(width);
}

for (const count of [2, 3, MAX_OPTIONS]) {
  test(`the focused border names 1\u2013${count} when the pin under the bar has ${count} options`, () => {
    // The per-count spelling is asserted on the *drawn* border, not on the label the builder was handed:
    // `optionHint` composes the text and `borderLine` puts it in the rule, and the two together are what the
    // user reads. Byte-for-byte, so a border that renamed the range or dropped the separator is caught here.
    const lines = built(
      content([one(1, "Decide X", { options: OPTIONS.slice(0, count) })], 0, true),
      WIDE,
      style,
    );
    expect(lines.at(-1)).toContain(`╰ ${optionHint(count)} `);
    expect(lines.at(-1)).toContain(`1\u2013${count} answer \u00b7 ${HINT}`);
    expectUniformWidth(lines, WIDE);
  });
}

test("the option hint costs the plain hint nothing, and a pin without options keeps it byte-for-byte", () => {
  // The same frame drawn both ways: the option label is `1–N answer · ` in *front of* `HINT`, so the keys the
  // plain border already named survive it whole — and a pin that stores no list draws the plain hint with
  // nothing added, not a hint padded out for digits that answer nothing.
  const plain = built(content([one(1, "Decide X")], 0, true), WIDE, style);
  const answered = built(
    content([one(1, "Decide X", { options: OPTIONS.slice(0, 2) })], 0, true),
    WIDE,
    style,
  );
  // The unfocused-with-no-label case is spelled out in `panel-lines.test.ts`; this is the focused one, so
  // the rule's length is the frame's width minus the corners and the hint's own columns.
  expect(plain.at(-1)).toBe(`╰ ${HINT} ${"─".repeat(WIDE - 4 - visibleWidth(HINT))}╯`);
  expect(answered.at(-1)).toContain(HINT);
  expect(answered.at(-1)).toContain("answer");
  expectUniformWidth(plain, WIDE);
  expectUniformWidth(answered, WIDE);
});

test("a frame of every option count closes at every width the builder draws at", () => {
  // The option hint is the longest label the border ever carries — `1–4 answer · ` in front of `HINT` — so
  // it is the label that reaches the cut first. The box has to close at every size regardless: the panel is
  // flush right, and a border that gave up a column lets the chat show through.
  for (const count of [2, 3, MAX_OPTIONS]) {
    const pins = [one(1, "Decide X", { options: OPTIONS.slice(0, count) })];
    for (const width of [PANEL_MIN_FRAME_COLUMNS, 33, 40, 46, 52, 60, WIDE, 100]) {
      const lines = built(content(pins, 0, true), width, style);
      expectUniformWidth(lines, width);
      expect(lines.at(-1)?.startsWith("╰ ")).toBe(true);
      expect(lines.at(-1)?.endsWith("╯")).toBe(true);
      // The digits lead the label, so whatever the cut takes, the range the user needs is what survives.
      expect(lines.at(-1)).toContain(`1\u2013${count} answer`);
    }
  }
});

test("an option hint too long for the border is cut with the border's own ellipsis", () => {
  // The cut belongs to `fitLabel` (`panel-border.ts`); this pins that the option hint goes through it like
  // every other label — measured, then cut, never padded past a corner by the builder.
  const lines = built(
    content([one(1, "Decide X", { options: OPTIONS })], 0, true),
    PANEL_MIN_FRAME_COLUMNS,
    style,
  );
  expect(lines.at(-1)).toContain(ELLIPSIS);
  expect(lines.at(-1)).not.toContain(HINT);
  expectUniformWidth(lines, PANEL_MIN_FRAME_COLUMNS);
});
