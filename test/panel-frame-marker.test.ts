/**
 * The one marker policy of the panel, tested where it lives: `markerCell` (`panel-frame.ts`) is what both a
 * pin row (`panelPinRows`) and a section heading (`headingCell`) draw the level's glyph through, so a row and
 * its heading cannot each close the theme's `marker` to a different width. These cases are that helper's own
 * arithmetic — the padding branch, the cut branch, and the control characters that must not survive either.
 * `panel-section-headings.test.ts` is where the two call sites are compared to each other, and
 * `panel-lines-hostile.test.ts` is where the cut reaches a frame drawn through all six theme colours.
 *
 * Since #70 the cell is drawn *painted*: the theme's SGR survives, because the level's colour is what makes a
 * warning read as a warning at a glance, and it costs the frame no columns. Every *other* sequence is refused
 * there rather than reaching the row, and the cell's own width is charged to the plain glyph, so a theme
 * cannot buy columns for a marker by colouring it.
 *
 * Every escape below is spelled from code points. A literal escape written into a source file is rewritten on
 * the way into it, and a test that compares a helper's output against a rewritten literal compares against the
 * wrong string while still passing whenever the helper does the same rewriting — which is how an escape test
 * stops being one.
 */
import { expect, test } from "bun:test";

import { markerCell } from "../src/panel-frame.ts";

/** The plain glyph whose columns every case below is measured against — the warning level's own, one column. */
const ONE = "!";

/** The introducer, and one colour, spelled out. */
const E = String.fromCharCode(0x1b);
const SGR = `${E}[33m`;
const OSC = `${E}]0;evil${String.fromCharCode(0x07)}`;
const RESET = `${E}[0m`;

test("a marker whose wrapper fits is kept, and padded back to the glyph's own columns", () => {
  // The fitting branch returns the theme's string padded out to the glyph's column rather than short of it:
  // `padPlain` is what puts back the columns a colour did not cost and a one-character wrapper did.
  expect(markerCell("!", ONE)).toBe("!");
  expect(markerCell(`${SGR}!`, ONE)).toBe(`${SGR}!`);
  expect(markerCell(`${OSC}!`, ONE)).toBe("!");
  // The three shipped glyphs draw one column each (`MARKER`, `panel-rows.ts`), so a wrapper one character
  // wide fills the cell exactly and a wider one is what the next case cuts.
  for (const glyph of ["!", "?", "•"]) expect(markerCell("<", glyph)).toBe("<");
  // pi-tui's `truncateToWidth` injects a reset around the ellipsis it was not asked to draw; the cell pays
  // nothing for it.
  expect(markerCell(`<${RESET}`, ONE)).toBe(`<${RESET}`);
});

test("a marker whose wrapper draws more than the glyph is cut to the glyph's columns", () => {
  // The regression the pin row and the heading diverged over: `<m:*>` draws six columns in front of a
  // one-column glyph, so the cell keeps the first of them and the glyph gives way rather than the frame.
  expect(markerCell("<m:!>", ONE)).toBe("<");
  expect(markerCell("<m:!>", ONE)).not.toContain("<m:");
  expect(markerCell("<m:!>", ONE)).not.toContain("!");
});

test("a marker's escapes and control characters never reach the screen, whatever branch the width took", () => {
  // The cell carries the theme's colour and nothing else: no control character, from either branch, and no
  // escape sequence but the SGR the theme asked for. Both halves are spelled with the code points above, so
  // neither side of the comparison can be rewritten into agreement.
  const LF = String.fromCharCode(0x0a);
  const CR = String.fromCharCode(0x0d);
  const DEL = String.fromCharCode(0x7f);
  const NEL = String.fromCharCode(0x85);
  // A colour is the introducer plus `[`, its digits and the `m` — spelled from the code points of each part,
  // because a backslash-d-b-lacket written into a template has no backslash left in it by the time the
  // regular expression is built, and a pattern that does not match the escape it is named for makes an escape
  // assertion quietly vacuous.
  const OPEN = String.fromCharCode(0x5b);
  const COLOUR = new RegExp(`[${E}]${OPEN}[0-9;]*m`, "g");
  const PLAIN_ONE = String.fromCharCode(0x21);
  for (const marked of [
    `<${LF}${CR}${DEL}${NEL}>`,
    `${LF}${PLAIN_ONE}${CR}`,
    `${SGR}${LF}${PLAIN_ONE}${DEL}`,
    `${OSC}${PLAIN_ONE}`,
    `${SGR}${OSC}${LF}${CR}${DEL}${NEL}${PLAIN_ONE}`,
  ]) {
    const cell = markerCell(marked, ONE);
    expect(cell).not.toContain(LF);
    expect(cell).not.toContain(CR);
    expect(cell).not.toContain(DEL);
    expect(cell).not.toContain(NEL);
    // What is left once the colours are taken out must contain no introducer at all.
    // Take the colours out: what is left must carry no introducer, and no fragment of one either — a colour
    // whose introducer alone was stripped would leave its digits behind as text, which is the half-sequence
    // this assertion is for.
    const bare = cell.replace(COLOUR, "");
    expect(bare).not.toContain(E);
    expect(bare).not.toMatch(new RegExp(`${OPEN}\\[0-9;]*m`));
  }
  // ...and a marker whose wrapper drew *nothing* but controls is not cut at all: the controls go before the
  // width is measured, so a glyph that survived them keeps the column the plain glyph owns.
  expect(markerCell(`${LF}${CR}${DEL}${NEL}`, ONE)).toBe(" ");
  expect(markerCell(`${LF}${CR}${DEL}${NEL}${ONE}`, ONE)).toBe("!");
  // A colour is kept through a cut as well as through a fit — with its introducer, or not at all. What must
  // never reach the screen is a *half* of a sequence, which is what a control-stripped introducer is.
  expect(markerCell(SGR + String.fromCharCode(0x21), ONE)).toBe(SGR + String.fromCharCode(0x21));
});
