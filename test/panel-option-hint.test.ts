/**
 * What the focused panel's bottom border says about the option keys (`src/panel-option-hint.ts`).
 *
 * A digit the user cannot read is a digit they will not press, and the bottom border is the only place the
 * panel names its keys — so a selected pin with options has to see them there, with the real count, and a pin
 * without options must keep the plain hint untouched. Three promises, one per actor:
 *
 * - the **label** is `optionHint`: `1–N answer · ` in front of `HINT`, `""` outside the 2–4 range a pin may
 *   store (`MIN_OPTIONS`/`MAX_OPTIONS`, `pin-fields.ts`) — a border cannot advertise digits no pin answers;
 * - the **drawer** puts it in the bottom border through the same `borderLine`/`fitLabel` path as every other
 *   label, so an over-long option hint is cut with `…` rather than pushed past a corner;
 * - the **selection** is what decides it: the option keys are live for the pin under the bar and no other, and
 *   while the panel is unfocused they are live for nobody.
 *
 * `panel-lines.test.ts` owns the frame itself; `panel-reply-hint.test.ts` owns the resting border's label.
 */
import { expect, test } from "bun:test";
import { visibleWidth } from "@earendil-works/pi-tui";

import { HINT } from "../src/panel-lines.ts";
import { optionHint } from "../src/panel-option-hint.ts";
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

/** Room for the longest option hint — `1–4 answer · ` in front of `HINT` — plus its margins and corners. */
const WIDE = 72;

const FOUR = ["Passed on", "Not yet", "Escalated", "Deferred"];

test("the label names the real count, and says nothing about options a pin cannot have", () => {
  expect(optionHint(2)).toBe(`1\u20132 answer \u00b7 ${HINT}`);
  expect(optionHint(3)).toBe(`1\u20133 answer \u00b7 ${HINT}`);
  expect(optionHint(4)).toBe(`1\u20134 answer \u00b7 ${HINT}`);
  // Five is past `MAX_OPTIONS`, and a count with no digit to name is a label with nothing to add: `""`, so
  // the caller keeps the plain hint. `optionHint(1)` is the one spelling this module does answer — a pin
  // cannot store a one-entry list (`MIN_OPTIONS` is 2), and the keys are drawn for whatever the list holds.
  expect(optionHint(5)).toBe("");
  expect(optionHint(0)).toBe("");
  expect(optionHint(1)).toBe(`1 answer \u00b7 ${HINT}`);
});

for (const count of [2, 3, 4]) {
  test(`a focused panel whose pin has ${count} options names 1\u2013${count} in its border`, () => {
    const lines = built(
      content([one(1, "Decide X", { options: FOUR.slice(0, count) })], 0, true),
      WIDE,
      style,
    );
    expect(lines.at(-1)).toContain(`1\u2013${count} answer \u00b7 ${HINT}`);
    // The rule, not blanks, closes the border on the hint's right — the panel is flush right.
    expect(lines.at(-1)?.startsWith(`╰ ${optionHint(count)} `)).toBe(true);
    for (const line of lines) expect(visibleWidth(line)).toBe(WIDE);
  });
}

test("a pin with no options keeps the plain hint, and so does an unfocused panel with one", () => {
  const plain = built(content([one(1, "Decide X")], 0, true), WIDE, style);
  expect(plain.at(-1)).toContain(HINT);
  expect(plain.at(-1)).not.toContain("answer");

  const answered = [one(1, "plain"), one(2, "answered", { options: ["Yes", "No"] })];
  expect(built(content(answered, 0, false), WIDE, style).at(-1)).not.toContain("answer");
});

test("the option hint follows the pin under the bar, not the first pin of the view", () => {
  // The keys are live for one pin at a time, so a border that read the view's head would advertise digits
  // the bar cannot answer. Ranked newest-id-first, so bar position 0 is `answered` and position 1 is `plain`.
  const answered = [one(1, "plain"), one(2, "answered", { options: ["Yes", "No"] })];
  expect(built(content(answered, 0, true), WIDE, style).at(-1)).toContain("1\u20132 answer");
  expect(built(content(answered, 1, true), WIDE, style).at(-1)).toContain(`╰ ${HINT} `);
  expect(built(content(answered, 1, true), WIDE, style).at(-1)).not.toContain("answer");
});

test("an option hint too long for the border is cut like every other label, not pushed past a corner", () => {
  // `fitLabel` owns the cut; the case lives here because the option hint runs up to twelve columns longer
  // than `HINT`, so it is the label that reaches the cut first.
  for (const width of [30, 36, 42]) {
    const lines = built(content([one(1, "Decide X", { options: FOUR })], 0, true), width, style);
    for (const line of lines) expect(visibleWidth(line)).toBe(width);
    expect(lines.at(-1)?.startsWith("╰ ")).toBe(true);
    expect(lines.at(-1)?.endsWith("╯")).toBe(true);
    // The digit range is the part the user needs, and it leads the label: the ellipsis falls over the tail
    // of the plain hint instead.
    expect(lines.at(-1)).toContain("1\u20134 answer");
    expect(lines.at(-1)).not.toContain(HINT);
  }
});
