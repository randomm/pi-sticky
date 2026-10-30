/**
 * The peek's half of compact expand-on-select: a surface with no bar expands nothing.
 *
 * #63 gave the *open* frame an expansion — the pin under its bar draws its full entry — and left the two
 * resting surfaces alone. `PeekContent` is `{ sections, ageNow, replyHint }` (`panel-peek.ts`): no selection
 * and no focus at all, so there is no "selected pin in the peek" for the rule to reach, and `peekPinRow`
 * calls the row table with no expansion signal whatsoever. That makes the collapsed peek a structural
 * consequence rather than a branch, which is exactly why it needs a regression test: a peek that ever grew a
 * selection and handed it down would draw a tall frame the drawer still measures as three rows.
 *
 * The pair is the same wrapping compact pin drawn by the peek and by an open frame whose bar rests on it:
 * one cut row here, the whole entry there. The difference is the frame, not the flag.
 */
import { expect, test } from "bun:test";

import { NO_PANEL_COLOUR } from "../src/panel-host.ts";
import { buildPeekLines } from "../src/panel-peek.ts";
import { panelSections } from "../src/panel-sections.ts";
import type { PanelStyle } from "../src/render.ts";
import { plainStyle } from "../src/render.ts";
import type { ViewPin } from "../src/types.ts";
import { NOW } from "./fixtures.ts";
import { framed } from "./panel-frame.ts";
import { levelPin } from "./panel-sections-fixture.ts";

/** The identity frame: no member wraps anything in visible bytes, so every frame below closes. */
const identity: PanelStyle = { ...plainStyle, ...NO_PANEL_COLOUR };

const WIDTH = 40;

/** A compact pin whose text no frame leaves on one row, and whose options buy rows of their own. */
const compactPin = (): ViewPin => ({
  ...levelPin(1, "a".repeat(400), "warning"),
  compact: true,
  options: ["a", "b"],
});

const peekOf = (pins: readonly ViewPin[]): string[] =>
  buildPeekLines(
    { sections: panelSections(pins), ageNow: NOW, replyHint: "ctrl+alt+p to reply" },
    WIDTH,
    identity,
  );

/** The open frame the component would draw for `pins` with the bar on `selection`, focused. */
const openOf = (pins: readonly ViewPin[], selection: number) =>
  framed({ pins, selection, focused: true, replyHint: "", ageNow: NOW }, WIDTH, identity, 100)
    .layout.owned;

test("the peek draws a compact pin as one cut row, with no selection to expand", () => {
  const lines = peekOf([compactPin()]);
  // Three rows whatever the pin carries: the two borders and one row, which is what makes a peek a peek and
  // not a shrunken panel.
  expect(lines).toHaveLength(3);
  for (const line of lines) expect(line).toHaveLength(WIDTH);
  // The row is *cut*: the ellipsis is the collapsed entry's own byte, and the tail of a 400-character text
  // appears nowhere in a three-row frame. A peek that had expanded the pin would print it and break its own
  // row count.
  const body = lines.map((line) => line.replace(/[─╭╮╰╯│]/g, "")).join("\n");
  expect(body).toContain("…");
  expect(body).not.toContain("a".repeat(120));
  // …and no row of the peek is one of the pin's options: the digits the open panel answers are not keys the
  // peek can be asked for, so the options rows belong to the frame that takes keys.
  expect(body).not.toMatch(/\b1 a\b/);
});

test("the same compact pin is one row in the peek and the whole entry under the panel's bar", () => {
  const pin = compactPin();
  const peekRows = peekOf([pin]).filter((line) => line.includes("#1"));
  expect(peekRows).toHaveLength(1);
  // The open frame's table, drawn through the component's own pair: the pin under the bar owns more of its
  // text rows than the peek's one, and its options rows besides. Same pin, same width, same instant — the
  // only thing that differs is the frame the pin is drawn in.
  const atBar = openOf([pin], 0).filter((entry) => entry.pin === 0);
  expect(atBar.filter((entry) => entry.row.kind === undefined).length).toBeGreaterThan(1);
  expect(atBar.filter((entry) => entry.row.kind === "options").length).toBeGreaterThan(0);
  // …and the same open view with the bar parked past the end of the list — the coordinate an unfocused panel
  // carries — is the collapsed entry again, which is the peek's answer reached by the other road.
  const nowhere = openOf([pin], 1).filter((entry) => entry.pin === 0);
  expect(nowhere.filter((entry) => entry.row.kind === undefined)).toHaveLength(1);
});
