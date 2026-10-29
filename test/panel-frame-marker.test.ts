/**
 * The one marker policy of the panel, tested where it lives: `markerCell` (`panel-frame.ts`) is what both a
 * pin row (`panelPinRows`) and a section heading (`headingCell`) draw the level's glyph through, so a row and
 * its heading cannot each close the theme's `marker` to a different width. These cases are that helper's own
 * arithmetic — the padding branch, the cut branch, and the control characters that must not survive either.
 * `panel-section-headings.test.ts` is where the two call sites are compared to each other, and
 * `panel-lines-hostile.test.ts` is where the cut reaches a frame drawn through all six theme colours, and
 * `panel-frame-marker-hostile.test.ts` is where the same helper is swept against a hostile `marker` both in
 * isolation and through a whole frame at every width.
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

import { visibleWidth } from "@earendil-works/pi-tui";
import { containsNonSgr } from "../src/escape.ts";
import { glyph, markerCell } from "../src/panel-frame.ts";

/** The plain glyph whose columns every case below is measured against — the warning level's own, one column. */
const ONE = "!";

/** The introducer, and one colour, spelled out. */
const E = String.fromCharCode(0x1b);
const SGR = `${E}[33m`;
const OSC = `${E}]0;evil${String.fromCharCode(0x07)}`;
const RESET = `${E}[0m`;
const BEL = String.fromCharCode(0x07);
const DEL = String.fromCharCode(0x7f);
const LF = String.fromCharCode(0x0a);
const CR = String.fromCharCode(0x0d);
const NEL = String.fromCharCode(0x85);

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

test("a bare control between two colours dies on both branches of the width", () => {
  // The arrangement a hostile `theme.marker` writes — `ESC [ 33 m` BEL `ESC [ 0 m` around the glyph — and
  // the one case the two passes used to disagree about. `stripNonSgr` is a *sequence* pass and a bare BEL,
  // CR, VT, BS, FF or DEL is not a sequence, so it passed straight through; the control pass that removes
  // it ran on the cut *before* the colours were re-attached out of the coloured string, which copied each
  // one back out. So the fitting branch leaked whatever it was given, and the cut branch leaked anything
  // that stood after a kept colour. `main` dropped controls on both branches, and this file's header
  // promises they go on both.
  const CR = String.fromCharCode(0x0d);
  const VT = String.fromCharCode(0x0b);
  const BS = String.fromCharCode(0x08);
  const FF = String.fromCharCode(0x0c);
  const NUL = String.fromCharCode(0x00);
  const CONTROLS = [NUL, BEL, BS, VT, FF, CR, DEL];
  for (const control of CONTROLS) {
    for (const marked of [
      // Fitting branch: the wrapper draws nothing but the control, so the cell is padded, never cut.
      `${control}${ONE}`,
      `${SGR}${control}${ONE}`,
      // Cutting branch: visible bytes past the glyph's one column, with the control after a kept colour —
      // the exact offset `keepColours` used to copy verbatim out of the coloured string.
      `${SGR}${control}PK`,
      `${SGR}${control}<m:!>`,
      `${SGR}${ONE}${control}PK`,
      // Both spellings of colour at once, so the refused one going must not carry the drawable one with it.
      `${SGR}${OSC}${control}${ONE}`,
    ]) {
      const cell = markerCell(marked, ONE);
      for (const stray of CONTROLS) {
        expect(cell, `${JSON.stringify(marked)} -> ${JSON.stringify(cell)}`).not.toContain(stray);
      }
      expect(visibleWidth(cell), JSON.stringify(marked)).toBe(1);
      // The classifier the frame sweeps defer to must name the byte, not certify it: asserted on the
      // *input* rather than the cell, which is clean by the time this loop reads it.
      if (control !== LF && control !== CR && control !== VT && control !== FF && control !== NEL) {
        // Break shapes are folded before a row is drawn (`foldBreaks`), so only the non-break controls are
        // the classifier's business.
        expect(containsNonSgr(marked), JSON.stringify(marked)).toBe(true);
      }
    }
  }
});

test("an 8-bit colour never buys a marker cell columns, on either branch of the width", () => {
  // The class the 7-bit fixtures could not catch. `CSI8` is U+009B — an introducer to the scanner, and a
  // *printable character* to `visibleWidth`. A keep-vote that asked the scanner "is this a CSI closed by
  // `m`" and nothing more emitted it verbatim, so a one-column marker cell came back as four columns
  // (`U+009B` plus the three characters `31m`) and the flush-right frame paid for a colour it did not draw.
  // The cell is therefore held to the plain glyph's width over both branches — the fitting one and the
  // cutting one — and to carrying no C1 byte at all, whatever the theme spelled its colour with.
  const CSI8 = String.fromCharCode(0x9b);
  const EIGHT_BIT = `${CSI8}31m`;
  const EIGHT_BIT_TRUE = `${CSI8}38;2;1;2;3m`;
  for (const marked of [
    `${EIGHT_BIT}${ONE}`,
    `${EIGHT_BIT}XYZ${ONE}`,
    `${EIGHT_BIT_TRUE}${ONE}`,
    // Both spellings of the same idea at once: the refused one goes and the drawable one stays.
    `${EIGHT_BIT}${SGR}${ONE}`,
    // A refused 8-bit run in front of *visible* bytes, so the cell is cut and the colours are re-attached:
    // the branch that used to copy the introducer back out of the coloured string one character at a time.
    `<>${EIGHT_BIT}31m${ONE}`,
    `<${CSI8}2J${ONE}`,
  ]) {
    const cell = markerCell(marked, ONE);
    expect(visibleWidth(cell), JSON.stringify(marked)).toBe(1);
    // No C1 control survives — the introducer itself, and none of the parameters left behind when it goes.
    for (let i = 0; i < cell.length; i++) {
      const code = cell.charCodeAt(i);
      expect(code >= 0x80 && code <= 0x9f, `C1 at ${i} of ${JSON.stringify(cell)}`).toBe(false);
    }
    // And no *half* of a sequence: what is left once the drawable colours are removed carries no introducer
    // and no orphaned parameters.
    const bare = cell.replace(new RegExp(`[${E}]${String.fromCharCode(0x5b)}[0-9;]*m`, "g"), "");
    expect(bare).not.toContain(E);
    expect(bare).not.toMatch(/[0-9;]*m/);
  }
  // The one-column promise the whole frame rests on, for the same bytes through the *glyph* path: a corner
  // that drew four columns would push the box past the width the overlay was given.
  expect(visibleWidth(glyph((text) => `${EIGHT_BIT}${text}`, ONE))).toBe(1);
  expect(glyph((text) => `${EIGHT_BIT}${text}`, ONE)).toBe(ONE);
});
