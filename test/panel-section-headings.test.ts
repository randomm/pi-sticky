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

import { headingCell, headingRow } from "../src/panel-section-headings.ts";
import { panelSections } from "../src/panel-sections.ts";
import type { SectionKind } from "../src/panel-sections.ts";
import { mixedView } from "./panel-sections-fixture.ts";

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
  // a pin. A heading the model could word would be a heading a pin could forge.
  const heads: Record<SectionKind, string> = {
    warning: "⚠ Warnings",
    action: "? Needs you",
    info: "· FYI",
  };
  for (const kind of KINDS) {
    const row = headingRow(sectionOfKind(kind));
    expect(`${row.mark} ${row.label}`).toBe(heads[kind]);
  }
});

test("a heading row carries its glyph apart from its word, for the marker colour", () => {
  const marks: Record<SectionKind, string> = { warning: "⚠", action: "?", info: "·" };
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
    const cell = headingCell(row, textWidth);
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
  const cell = headingCell(wide, width);
  expect(visibleWidth(cell)).toBe(width);
  expect(cell.length).toBeLessThan(width);
  // The guard the other half of the file depends on: a label wider than the column is cut, not spilled.
  const narrow = headingCell(wide, 6);
  expect(visibleWidth(narrow)).toBe(6);
});

test("a heading cell never goes negative when the frame leaves it no room", () => {
  expect(visibleWidth(headingCell(headingRow(sectionOfKind("info")), 0))).toBe(0);
  expect(visibleWidth(headingCell(headingRow(sectionOfKind("info")), -4))).toBe(0);
});
