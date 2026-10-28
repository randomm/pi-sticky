/**
 * The peek's three rows: the counts title, the best-ranked pin cut to one line, and the border carrying the
 * focus key (`src/panel-peek.ts`).
 *
 * Three promises the drawing is written around, one test each:
 *
 * 1. **The title and the row come from the one sectioning.** `buildPeekLines` reads the counts out of
 *    `content.sections` rather than grouping the view again, so a peek cannot disagree with the open panel
 *    it is a rest state of — the numbers the peek prints are the numbers the headings under them were
 *    grouped from.
 * 2. **The row is the best-ranked pin, not the first pinned.** `PanelSections.flat` leads with the section
 *    of the most urgent level and the newest id within it; the peek draws `flat[0]`, the same pin the open
 *    panel leads with and the bar starts on.
 * 3. **Every row closes at the width it was given.** The frame's own escape policy applies — a smuggled
 *    escape must not buy free columns and let the chat behind the panel show through a flush-right border.
 *
 * Style is the identity one throughout: a coloured border would wrap each glyph in visible bytes, and the
 * builder's answer to that is no rows at all — asserted separately at the end.
 */
import { expect, test } from "bun:test";

import { NO_PANEL_COLOUR } from "../src/panel-host.ts";
import { buildPeekLines } from "../src/panel-peek.ts";
import type { PeekContent } from "../src/panel-peek.ts";
import { panelSections } from "../src/panel-sections.ts";
import type { PanelStyle } from "../src/render.ts";
import { plainStyle } from "../src/render.ts";
import { NOW } from "./fixtures.ts";
import { levelPin, mixedView } from "./panel-sections-fixture.ts";

/** The identity frame: no member wraps anything in visible bytes, so every frame below closes. */
const identity: PanelStyle = { ...plainStyle, ...NO_PANEL_COLOUR };

const WIDTH = 40;

/** The content of one peek: sections derived from `pins` the way the component derives them. */
function content(
  pins: PeekContent["sections"]["flat"],
  replyHint = "ctrl+alt+p to reply",
): PeekContent {
  return { sections: panelSections(pins), ageNow: NOW, replyHint };
}

/** The rows stripped of their border glyphs, so an assertion reads what the peek *says*. */
const text = (lines: string[]): string[] => lines.map((line) => line.replace(/[─╭╮╰╯│]/g, ""));

test("the peek is three rows: the counts title, one pin, the hint", () => {
  const lines = buildPeekLines(content([levelPin(1, "Decide X", "action")]), WIDTH, identity);
  expect(lines).toHaveLength(3);
  for (const line of lines) expect(line).toHaveLength(WIDTH);
  expect(text(lines)[0]).toContain("Pinned");
  expect(text(lines)[1]).toContain("Decide X");
  expect(text(lines)[1]).toContain("#1");
  expect(text(lines)[2]).toContain("ctrl+alt+p to reply");
});

test("an empty view draws no rows, not a box asserting its own emptiness", () => {
  expect(buildPeekLines(content([]), WIDTH, identity)).toEqual([]);
});

test("the frame's own minimums answer with no rows", () => {
  // Too narrow for a closed box, or too short for three rows: the open builder's rule, borrowed.
  expect(buildPeekLines(content([levelPin(1, "x", "info")]), 29, identity)).toEqual([]);
});

test("the row is the best-ranked pin, not the first of the view", () => {
  // The view leads with an info pin; the drawn order leads with the newest warning, which is the pin the
  // open panel puts at the top and starts the bar on.
  const lines = buildPeekLines(content(mixedView()), WIDTH, identity);
  expect(text(lines)[1]).toContain("warn two");
  expect(text(lines)[1]).not.toContain("note one");
});

test("the title counts come from the sectioning it was handed", () => {
  const identity = { ...plainStyle, ...NO_PANEL_COLOUR };
  const sections = panelSections(mixedView());
  // The title truncates at the frame's width, so the test that says "the peek reads the sectioning it was
  // given rather than grouping the view again" has to be written at a width that closes — 80 columns, where
  // all three segments of this view fit. Asserted as the digits, in order: the nouns are
  // `panel-frame-title.ts`'s subject, and this one is about which grouping produced the counts.
  const wide =
    text(buildPeekLines({ sections, ageNow: NOW, replyHint: "" }, 80, identity))[0] ?? "";
  const title = (wide.match(/\d+/g) ?? []).map(Number);
  expect(title).toEqual(sections.order.map((section) => section.pins.length));
});

test("a pin whose text carries an escape buys no columns", () => {
  const smuggled = levelPin(1, "x\u001B]0;evil\u0007y".repeat(30), "info");
  const lines = buildPeekLines(content([smuggled]), WIDTH, identity);
  // A cut that still measured too wide is cut again from the stripped text: the row must close.
  for (const line of lines) expect(line).toHaveLength(WIDTH);
  expect(text(lines).join("\n")).not.toContain("\u001B");
});

test("a long pin is cut to one row however it would have wrapped", () => {
  const long = levelPin(1, "a".repeat(400), "warning");
  const lines = buildPeekLines(content([long]), WIDTH, identity);
  expect(lines).toHaveLength(3);
  for (const line of lines) expect(line).toHaveLength(WIDTH);
});

test("a border that paints visible bytes answers with no rows at all", () => {
  const painted: PanelStyle = { ...identity, border: (s) => `[${s}]` };
  expect(buildPeekLines(content([levelPin(1, "x", "info")]), WIDTH, painted)).toEqual([]);
});

test("the bottom border says nothing when the focus key is off", () => {
  const lines = buildPeekLines(content([levelPin(1, "x", "info")], ""), WIDTH, identity);
  // The border is still drawn — a peek with no bottom border is a peek that does not close — but it carries
  // no key the operator turned off.
  expect(lines).toHaveLength(3);
  expect(text(lines)[2]?.trim()).toBe("");
});
