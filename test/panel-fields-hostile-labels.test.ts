/**
 * The optional fields (`group`, `options`) drawn as *hostile text*: a name or a label the model filled with
 * an escape sequence, and the two things that must hold whatever pi-tui's measurement says about it.
 *
 * Split out of `panel-fields-frame.test.ts` when that file reached the 300-line ceiling; the frame it draws
 * and the helpers it draws with are the same. What is specific to these cases is `UNTRUSTED` below — the one
 * class of sequence whose width the two sides of the stack disagree about, which is why the assertions are
 * made on `visibleWidth` rather than on the string's length.
 */
import { expect, test } from "bun:test";

import { visibleWidth } from "@earendil-works/pi-tui";

import type { PanelStyle } from "../src/render.ts";
import type { ViewPin } from "../src/types.ts";
import { LATER } from "./fixtures.ts";
import { built } from "./panel-frame.ts";
import { levelPin } from "./panel-sections-fixture.ts";

/** Identity colours with a bar visible in the drawn string. */
const style: PanelStyle = {
  header: (s) => s,
  marker: (_level, s) => s,
  dim: (s) => s,
  selected: (s) => `[${s}]`,
  border: (s) => s,
  borderFocused: (s) => s,
};

const WIDTH = 60;

/** `levelPin` plus the fields under test. */
const pin = (
  id: number,
  level: ViewPin["level"],
  extra: Partial<Pick<ViewPin, "group" | "options" | "compact">> = {},
): ViewPin => ({ ...levelPin(id, `pin ${id}`, level), ...extra });

test("a group whose name is hostile text draws as text and closes at the width", () => {
  const hostile = pin(1, "info", { group: "\u001b[31mred\u001b[0m # heading\nsecond line" });
  const rows = built(
    { pins: [hostile], selection: 0, focused: true, replyHint: "", ageNow: LATER },
    WIDTH,
    style,
  ).slice(1, -1);
  expect(rows).toHaveLength(2);
  for (const row of rows) expect(visibleWidth(row)).toBe(WIDTH);
  const heading = rows[0] ?? "";
  expect(heading).not.toContain("\u001b");
  // The break is folded into the heading's own line rather than becoming a second row of the frame: the
  // builder hands each line to `fitLine` and cannot tell a folded name from a short one.
  expect(heading).toContain("red # heading second line");
});

/**
 * Sequences that are an *escape* to the panel's own policy (`stripSequences`, `escape.ts`) and printable
 * columns to pi-tui's `visibleWidth` — the one class of text a width measured on the raw string cannot be
 * trusted for. Each is padded with the word that must not reach the screen: a cut that trusted pi-tui's
 * measurement would print the payload, and a row that trusted nothing would spill its column.
 */
const UNTRUSTED = [
  ["unterminated OSC", "\u001b]8;;http://evil"],
  ["OSC without its BEL", "\u001b]2;a title"],
  ["unterminated DCS", "\u001bP++++"],
  ["lone introducer", "\u001b_"],
] as const;

test("a group name whose escapes the terminal counts as printable cannot widen the frame", () => {
  for (const [name, sequence] of UNTRUSTED) {
    const rows = built(
      {
        pins: [pin(1, "info", { group: `G${sequence}${"PAYLOAD".repeat(20)}` })],
        selection: 0,
        focused: true,
        replyHint: "",
        ageNow: LATER,
      },
      WIDTH,
      style,
    ).slice(1, -1);
    // The heading owns one row whatever the sequence did to the measurement, and it closes at the width.
    expect(rows, name).toHaveLength(2);
    for (const row of rows) expect(visibleWidth(row), name).toBe(WIDTH);
    expect(rows.join(""), name).not.toContain("PAYLOAD");
    // The name is still the name: what the cut removes is the sequence and its payload, not the group.
    expect(rows[0] ?? "", name).toContain("G");
  }
});

test("an option carrying an escape buys no free columns", () => {
  const smuggled = `a\u001b[1m${"x".repeat(200)}\u001b[0m`;
  const pins = [pin(1, "info", { options: [smuggled, "b"] })];
  const lines = built(
    { pins, selection: 0, focused: true, replyHint: "", ageNow: LATER },
    60,
    style,
  );
  for (const row of lines) expect(visibleWidth(row)).toBe(60);
});

/** An option label whose escape pi-tui counts as printable, padded with the word that must not be drawn. */
const hostileOption = (sequence: string): string => `o${sequence}${"PAYLOAD".repeat(20)}`;

test("an option whose escapes the terminal counts as printable cannot widen the frame", () => {
  for (const [name, sequence] of UNTRUSTED) {
    const lines = built(
      {
        pins: [pin(1, "info", { options: [hostileOption(sequence), "b"] })],
        selection: 0,
        focused: true,
        replyHint: "",
        ageNow: LATER,
      },
      WIDTH,
      style,
    );
    // The frame is the same number of rows it would be for a clean label — an escape buys a row neither by
    // widening one nor by splitting one — and none of its rows prints the sequence's payload.
    expect(lines, name).toHaveLength(4);
    for (const row of lines) expect(visibleWidth(row), name).toBe(WIDTH);
    expect(lines.join(""), name).not.toContain("PAYLOAD");
  }
});
