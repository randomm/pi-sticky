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
 * 4. **The row keeps its tail.** A pin whose text wraps in the open panel still shows its `#id` in the peek,
 *    and a pin the open panel gives a whole `#id <age>` stamp keeps it whole: the peek pays the open panel's
 *    tail reserve and cuts its *text*, never its stamp.
 *
 * Style is the identity one throughout: a coloured border would wrap each glyph in visible bytes, and the
 * builder's answer to that is no rows at all — asserted separately at the end.
 */
import { expect, test } from "bun:test";

import { visibleWidth } from "@earendil-works/pi-tui";

import { META_SEPARATOR_COLUMNS, widestMetaColumns } from "../src/panel-frame-geometry.ts";
import { NO_PANEL_COLOUR } from "../src/panel-host.ts";
import { buildPeekLines } from "../src/panel-peek.ts";
import type { PeekContent } from "../src/panel-peek.ts";
import { panelSections } from "../src/panel-sections.ts";
import { GUTTER_COLUMNS, drawnTail, fullStamp, idStamp } from "../src/panel-tail.ts";
import type { PanelStyle } from "../src/render.ts";
import { plainStyle } from "../src/render.ts";
import type { ViewPin } from "../src/types.ts";
import { NOW } from "./fixtures.ts";
import {
  BREAKS,
  assertNoForgery,
  foldedHostileFields,
  linesOf,
  withHostileFields,
} from "./panel-hostile-fields.ts";
import { levelPin, mixedView } from "./panel-sections-fixture.ts";

/** The identity frame: no member wraps anything in visible bytes, so every frame below closes. */
const identity: PanelStyle = { ...plainStyle, ...NO_PANEL_COLOUR };

const WIDTH = 40;

/**
 * The tail the peek's row ends with for `pin` at `width`: `drawnTail`'s own answer, measured over a view of
 * `pin` alone. Spelled through the product's own functions rather than padded by hand so the assertion says
 * "the row ends in the drawn tail" and rots with the geometry, not with the machine's clock.
 */
function peekTail(pin: ViewPin, stamped: string, width: number): string {
  const inner = width - GUTTER_COLUMNS;
  return drawnTail(
    stamped,
    widestMetaColumns([pin], identity.dim, NOW),
    inner,
    META_SEPARATOR_COLUMNS,
  );
}

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

test("a pin whose text wraps still shows its #id in the peek", () => {
  // The open panel lays this text out over several rows, so `panelPinRows`' first row carries the id *alone*
  // and its age lives on the row below — which is why the assertion is the id and not the pair. The peek
  // draws that same first row: a peek that joined text-and-tail and let `fitLine` cut the pair spent the
  // row's last columns on an ellipsis and lost the `#id` with them, so the tail is what distinguishes the
  // fix from the bug.
  for (const width of [60, 120]) {
    const long = levelPin(1, "a".repeat(400), "warning");
    const lines = buildPeekLines(content([long]), width, identity);
    expect(lines).toHaveLength(3);
    for (const line of lines) expect(line).toHaveLength(width);
    // The row's content between its two gutters, which is what `pinRow` filled with text-then-tail.
    const row = (lines[1] ?? "").slice(2, -2);
    // `drawnTail`'s own answer for the id's stamp: the reserve it pads into is the view's, so the row ends
    // with the id in exactly the columns the open frame charged for the tail — no ellipsis, no truncation.
    const tail = peekTail(long, idStamp(long, identity.dim), width);
    expect(row.endsWith(tail)).toBe(true);
    expect(row).toContain("#1");
  }
});

test("a pin that fits one row shows its whole stamp — id and age — in the peek", () => {
  // The other half of the tail: a pin the open panel gives a one-row `#id <age>` pair keeps that pair whole
  // at the end of the peek's row, so the two surfaces say the same thing about the same pin.
  const short = levelPin(7, "Decide X", "action");
  const lines = buildPeekLines(content([short]), 120, identity);
  const row = (lines[1] ?? "").slice(2, -2);
  expect(visibleWidth(row)).toBe(120 - GUTTER_COLUMNS);
  expect(row.endsWith(peekTail(short, fullStamp(short, identity.dim, NOW), 120))).toBe(true);
  expect(row).toContain("#7");
});

test("a peek row whose text is short keeps the tail padded to its reserve", () => {
  // The reserve is the view's, so a wide id costs the *text* its columns and never the id: at 120 columns
  // this text has room to spare, and the row still closes at exactly the width it was given.
  const wide = levelPin(123456, "short", "action");
  const rows: readonly ViewPin[] = [wide];
  const lines = buildPeekLines(content(rows), 120, identity);
  const row = lines[1] ?? "";
  expect(visibleWidth(row)).toBe(120);
  expect(row).toContain("#123456");
});

test("a border that paints visible bytes answers with no rows at all", () => {
  const painted: PanelStyle = { ...identity, border: (s) => `[${s}]` };
  expect(buildPeekLines(content([levelPin(1, "x", "info")]), WIDTH, painted)).toEqual([]);
});

test("a hostile group and hostile options forge no row and no reply line in the peek", () => {
  // The peek's restraint (`panel-fields-restraint.test.ts`) is that it draws neither field; this is the other
  // direction — that a field it does not draw also cannot reach its rows. The sweep splits the peek's three
  // rows on every break shape, so a group name that came back as a row of its own is a fourth row and is
  // refused, and no row may open with the invented pin or the invented reply.
  for (const width of [30, 40, 60, 120]) {
    const pin = withHostileFields(levelPin(1, "Decide X", "warning"), "\n", foldedHostileFields());
    const lines = buildPeekLines(content([pin]), width, identity);
    // Always three rows: title, the one pin, the hint — whatever the fields claim to be.
    expect(lines).toHaveLength(3);
    for (const line of lines) expect(visibleWidth(line)).toBe(width);
    expect(linesOf(lines.join("\n"))).toHaveLength(3);
    // The genuine row is the peek's own pin; nothing else in three rows is a row at all. The peek draws
    // neither field, so it owes no evidence that one was printed — that restraint is the sibling file's
    // subject; what this sweep holds the peek to is that a field it refuses still forges nothing.
    assertNoForgery(lines, /! Decide X/, false);
    // And the peek drew neither field, so the forgery is absent from its rows entirely.
    const body = lines.join("\n");
    expect(body).not.toContain("approved");
    expect(body).not.toContain("Replying");
  }
});

test("a peek row never breaks for a field that carries a break, whatever its shape", () => {
  // The raw shape, with the break still in it. The peek folds its own row and draws no field at all, so the
  // break cannot reach the screen whichever shape it was: three rows, none of them carrying a break, at every
  // width the peek closes at.
  for (const brk of BREAKS) {
    for (const width of [30, 40, 120]) {
      const pin = withHostileFields(levelPin(1, "Decide X", "warning"), brk);
      const lines = buildPeekLines(content([pin]), width, identity);
      expect(lines).toHaveLength(3);
      for (const line of lines) expect(visibleWidth(line)).toBe(width);
      for (const line of lines) {
        for (const shape of BREAKS) expect(line).not.toInclude(shape);
      }
    }
  }
});

test("the bottom border says nothing when the focus key is off", () => {
  const lines = buildPeekLines(content([levelPin(1, "x", "info")], ""), WIDTH, identity);
  // The border is still drawn — a peek with no bottom border is a peek that does not close — but it carries
  // no key the operator turned off.
  expect(lines).toHaveLength(3);
  expect(text(lines)[2]?.trim()).toBe("");
});
