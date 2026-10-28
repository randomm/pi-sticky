/**
 * The heading rows the panel draws between its level sections.
 *
 * Three things are pinned down here and nowhere else. The three strings are fixed — a heading the model
 * could word is a heading a pin could forge, so the test reads the strings themselves rather than a
 * rendering. Each row splits its glyph from its word, because `panel-rows.ts` colours a pin row's marker
 * through `style.marker(level, glyph)` and a heading whose glyph was baked into the text could not be
 * coloured at all. And the row is padded to the text column its section's pins are laid out at, measured
 * rather than counted, so the heading's word lines up with the pin text under it.
 */
import { expect, test } from "bun:test";
import { visibleWidth } from "@earendil-works/pi-tui";

import { stripSequences } from "../src/escape.ts";
import { panelPinRows } from "../src/panel-rows.ts";
import { headingCell, headingRow } from "../src/panel-section-headings.ts";
import { panelSections } from "../src/panel-sections.ts";
import type { SectionKind } from "../src/panel-sections.ts";
import type { PanelStyle as RenderPanelStyle } from "../src/render.ts";
import { LATER } from "./fixtures.ts";
import { levelPin, mixedView } from "./panel-sections-fixture.ts";

/** Identity colours: the heading's glyph comes back as the character the row table asked for. */
const style: RenderPanelStyle = {
  header: (s) => s,
  marker: (_level, s) => s,
  dim: (s) => s,
  selected: (s) => `[${s}]`,
  border: (s) => s,
  borderFocused: (s) => s,
};

/** The cell of `kind` padded to `textWidth`, as the row table asks for it. */
function cellOf(kind: SectionKind, textWidth: number): string {
  return headingCell(headingRow(sectionOfKind(kind)), textWidth, style, kind);
}

/** The one section of `kind` the mixed view produces, which is the section the headings are read off. */
function sectionOfKind(kind: SectionKind) {
  const section = panelSections(mixedView()).order.find((candidate) => candidate.kind === kind);
  if (section === undefined) throw new Error(`the fixture holds no ${kind} section`);
  return section;
}

const KINDS: readonly SectionKind[] = ["warning", "action", "info"];

test("the three headings are the fixed strings the user is taught to read", () => {
  // The three strings live in the module's table and reach the screen only through `headingRow`, so the
  // strings are pinned by what the row prints: glyph and word spelled out per kind, and nothing derived from
  // a pin. A heading the model could word would be a heading a pin could forge. The glyph is the level's own
  // — the one the pin rows under the heading carry — so a heading says the same thing as its rows.
  const heads: Record<SectionKind, string> = {
    warning: "! Warnings",
    action: "? Needs you",
    info: "• FYI",
  };
  for (const kind of KINDS) {
    const row = headingRow(sectionOfKind(kind));
    expect(`${row.mark} ${row.label}`).toBe(heads[kind]);
  }
});

test("a heading row carries its glyph apart from its word, for the marker colour", () => {
  const marks: Record<SectionKind, string> = { warning: "!", action: "?", info: "•" };
  const labels: Record<SectionKind, string> = {
    warning: "Warnings",
    action: "Needs you",
    info: "FYI",
  };
  for (const kind of KINDS) {
    const row = headingRow(sectionOfKind(kind));
    expect(row.mark).toBe(marks[kind]);
    expect(row.label).toBe(labels[kind]);
    // The glyph is the head of the heading, split from the word at its one space: a heading whose glyph was
    // baked into its text could not be coloured through `style.marker` the way a pin row's marker is.
    expect(row.mark.length).toBeGreaterThan(0);
    expect(row.label.startsWith(row.mark)).toBe(false);
    // The word follows the glyph at the cell's one space, spelled the way `headingCell` joins it.
    expect(` ${row.mark} ${row.label}`).toBe(headingCell(row, 30, style, kind).trimEnd());
  }
});

test("a heading never reads a pin's text (untrusted input)", () => {
  // A pin worded like a heading must not become one: the strings come from this module's table, and the
  // section's pins are counted, never quoted.
  const sections = panelSections(mixedView());
  const forged = "⚠ Warnings";
  const withForgedText = sections.flat.map((pin) => ({ ...pin, text: forged }));
  const heading = headingRow(sectionOfKind("warning")).label;
  expect(heading).toBe("Warnings");
  expect(headingRow({ kind: "info", pins: withForgedText }).label).toBe("FYI");
});

test("the heading cell fills the text column its section's pins are laid out at", () => {
  const row = headingRow(sectionOfKind("action"));
  for (const textWidth of [30, 40, 60]) {
    const cell = headingCell(row, textWidth, style, "action");
    expect(visibleWidth(cell)).toBe(textWidth);
    expect(cell.startsWith(" ? Needs you")).toBe(true);
    expect(cell.trimEnd()).toBe(" ? Needs you");
  }
});

test("a heading is measured with visibleWidth, so a CJK label would cost what it draws", () => {
  // The three shipped headings are all narrow, so a heading padded by `string.length` would still land on
  // the right width by luck. The case that separates measuring from counting is a label whose glyphs draw
  // wider than one column — `padPlain` measures with `visibleWidth`, which is the function the drawer
  // measures every drawn line with, so the heading cannot claim columns the frame has already sold to the
  // chat behind it. The claim is checked against `visibleWidth` itself, not a hard-coded column count that
  // would rot if pi-tui's table changed.
  const width = 24;
  const wide = { mark: "决", label: "决定" };
  const cell = headingCell(wide, width, style, "info");
  expect(visibleWidth(cell)).toBe(width);
  expect(cell.length).toBeLessThan(width);
  // ...and the row is still cut, not spilled: one CJK column gives way to the cut's ellipsis, so the
  // heading never draws past the column the frame set aside for it.
  const narrow = headingCell(wide, 6, style, "info");
  expect(visibleWidth(narrow)).toBeLessThanOrEqual(6);
  expect(visibleWidth(narrow)).toBeGreaterThan(0);
});

test("a heading cell never goes negative when the frame leaves it no room", () => {
  expect(visibleWidth(cellOf("info", 0))).toBe(0);
  expect(visibleWidth(cellOf("info", -4))).toBe(0);
});

test("a heading's glyph is its level's MARKER, coloured through the theme's marker", () => {
  // One level→glyph table for the whole panel: the heading over a section and the rows under it draw the
  // same glyph, and both ask `style.marker` for it. `action` is byte-identical either way (`?`), so
  // `warning` and `info` are the two kinds this case can see change — which is why the comparison is made
  // against `panelPinRows`' own row rather than against a literal.
  const asked: string[] = [];
  const recording: RenderPanelStyle = {
    ...style,
    marker: (level, s) => {
      asked.push(`${level}:${s}`);
      return s;
    },
  };
  for (const kind of KINDS) headingCell(headingRow(sectionOfKind(kind)), 30, recording, kind);
  expect(asked).toEqual(["warning:!", "action:?", "info:•"]);

  // The byte the heading opens with is the byte the pin row of the same level opens with — marker and the
  // three columns that open a row, compared before either string reaches its own word.
  const prefixOf = (text: string): string => text.slice(0, 3);
  for (const kind of KINDS) {
    const cell = headingCell(headingRow(sectionOfKind(kind)), 30, style, kind);
    const pinRow = panelPinRows(levelPin(1, "x", kind), 30, style, LATER)[0]?.text ?? "";
    expect(prefixOf(cell)).toBe(prefixOf(pinRow));
  }
});

test("a theme whose marker adds visible bytes still draws the heading at the frame's width", () => {
  // A `marker` that wraps the glyph rather than colouring it must not be allowed to widen the row: the
  // heading is padded to the column the layout gave it, and the bytes the theme added are refused rather
  // than counted — the same policy `glyph` (`panel-frame.ts`) applies to a corner or a gutter, which is what
  // keeps a row of the frame at the width the overlay was given.
  const wrapping: RenderPanelStyle = {
    ...style,
    marker: (_level, s) => `<m:\u{1b}[31m${s}\u{1b}[0m>`,
  };
  for (const kind of KINDS) {
    const cell = headingCell(headingRow(sectionOfKind(kind)), 30, wrapping, kind);
    expect(visibleWidth(cell)).toBe(30);
    expect(cell).not.toContain("<m:");
    expect(stripSequences(cell)).not.toContain("\u{1b}");
  }
  // The plain glyph under the wrapper is what the cell keeps, so the level still reads.
  expect(headingCell(headingRow(sectionOfKind("warning")), 30, wrapping, "info")).toContain(
    "Warnings",
  );
});

test("a cut heading cell carries no escape bytes of its own at any width", () => {
  // The cell is returned to its caller, which pads and joins it — so it must be safe at *this* boundary, the
  // way `glyph` (`panel-frame.ts`) returns one. `truncateToWidth` injects a reset around its ellipsis, and a
  // theme whose `marker` added visible bytes forces the cut branch at a narrow column: without the strip the
  // cell reached the frame carrying `\u001b[0m` for nothing to consume.
  const wrapping: RenderPanelStyle = { ...style, marker: (_level, s) => `<m:${s}>` };
  for (const kind of KINDS) {
    for (const textWidth of [1, 2, 3, 5, 6, 7, 12, 30]) {
      const cell = headingCell(headingRow(sectionOfKind(kind)), textWidth, wrapping, kind);
      expect(stripSequences(cell)).not.toContain("\u{1b}");
      expect(visibleWidth(cell)).toBeLessThanOrEqual(textWidth);
    }
  }
});

test("a theme whose marker adds visible bytes cuts the pin row's marker the same way", () => {
  // One marker policy for the whole panel, so that the glyph the heading draws and the glyph the row under it
  // draws are the same bytes. Before the row cut its marker the two diverged — the heading drew ` < ` and the
  // pin row ` <m` — and the divergence reached the screen, because each string is closed to the width by
  // itself and neither one measures the other's marker.
  const wrapping: RenderPanelStyle = { ...style, marker: (_level, s) => `<m:${s}>` };
  for (const kind of KINDS) {
    const cell = headingCell(headingRow(sectionOfKind(kind)), 30, wrapping, kind);
    const rows = panelPinRows(levelPin(1, "text", kind), 30, wrapping, LATER);
    expect(rows[0]?.text.slice(0, 3)).toBe(cell.slice(0, 3));
    // ...and neither string carries the wrapper's bytes.
    for (const drawn of [cell, rows[0]?.text ?? ""]) expect(drawn).not.toContain("<m:");
  }
});
