/**
 * The one marker policy of the panel, tested where it lives: `markerCell` (`panel-frame.ts`) is what both a
 * pin row (`panelPinRows`) and a section heading (`headingCell`) draw the level's glyph through, so a row and
 * its heading cannot each close the theme's `marker` to a different width. These three cases are that helper's
 * own arithmetic — the padding branch, the cut branch, and the control characters that must not survive
 * either. `panel-section-headings.test.ts` is where the two call sites are compared to each other, and
 * `panel-lines-hostile.test.ts` is where the cut reaches a frame drawn through all six theme colours.
 */
import { expect, test } from "bun:test";

import { markerCell } from "../src/panel-frame.ts";

/** The plain glyph whose columns every case below is measured against — the warning level's own, one column. */
const ONE = "!";

test("a marker whose wrapper fits is kept, and padded back to the glyph's own columns", () => {
  // The fitting branch returns the theme's string padded out to the glyph's column rather than short of it:
  // `padPlain` is what puts back the columns a colour did not cost and a one-character wrapper did. The
  // escape bytes go on both branches, so the SGR below is refused while the glyph it coloured is kept.
  expect(markerCell("!", ONE)).toBe("!");
  expect(markerCell("\u{1b}[33m!", ONE)).toBe("!");
  // The three shipped glyphs draw one column each (`MARKER`, `panel-rows.ts`), so a wrapper one character
  // wide fills the cell exactly and a wider one is what the next case cuts.
  for (const glyph of ["!", "?", "•"]) expect(markerCell("<", glyph)).toBe("<");
  expect(markerCell("<\u{1b}[0m", ONE)).toBe("<");
});

test("a marker whose wrapper draws more than the glyph is cut to the glyph's columns", () => {
  // The regression the pin row and the heading diverged over: `<m:*>` draws six columns in front of a
  // one-column glyph, so the cell keeps the first of them and the glyph gives way rather than the frame.
  expect(markerCell("<m:!>", ONE)).toBe("<");
  expect(markerCell("<m:!>", ONE)).not.toContain("<m:");
  expect(markerCell("<m:!>", ONE)).not.toContain("!");
});

test("a marker's escapes and control characters never reach the screen, whatever branch the width took", () => {
  // The cell is returned to its caller unpainted, the way `glyph` returns one, so the cut is not the only
  // door: a `marker` that folded a line break around the glyph would put an LF on the panel on the *fitting*
  // branch too, where nothing between the gutters consumes it and the frame's rows come apart.
  const LF = String.fromCharCode(0x0a);
  const CR = String.fromCharCode(0x0d);
  const DEL = String.fromCharCode(0x7f);
  const NEL = String.fromCharCode(0x85);
  for (const marked of [`<${LF}${CR}${DEL}${NEL}>`, `${LF}!${CR}`, `\u{1b}[1m${LF}!${DEL}`]) {
    const cell = markerCell(marked, ONE);
    expect(cell).not.toContain(LF);
    expect(cell).not.toContain(CR);
    expect(cell).not.toContain(DEL);
    expect(cell).not.toContain(NEL);
    expect(cell).not.toContain("\u{1b}");
  }
  // ...and a marker whose wrapper drew *nothing* but controls is not cut at all: the controls go before the
  // width is measured, so a glyph that survived them keeps the column the plain glyph owns.
  expect(markerCell(`${LF}${CR}${DEL}${NEL}`, ONE)).toBe(" ");
  expect(markerCell(`${LF}${CR}${DEL}${NEL}${ONE}`, ONE)).toBe("!");
});
