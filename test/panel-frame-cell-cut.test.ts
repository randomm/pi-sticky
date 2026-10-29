/**
 * The cut half of `markerCell` (#70), where a leak sweep cannot see it.
 *
 * `panel-frame-marker-hostile.test.ts` sweeps hostile markers for bytes that must not reach the screen. That
 * question is answered by a cell that dropped *everything* as well as by one that kept the right bytes, so it
 * cannot see the two things the cut is actually for: the cell is charged to the **colour-free** form
 * (`themeMeasure`), because a colour draws no column and a cut that counted on a form carrying one spends the
 * glyph's column on the theme's padding; and every byte it emits comes from the form this file's policy
 * vouched for, never from the theme's raw string, which is where a refused byte used to ride in on the
 * column of a colour that survived.
 *
 * Each case therefore reads three things at once: the glyph is drawn, the theme's colour is drawn *over* it,
 * and the bytes it was wrapped in are not drawn at all.
 */
import { expect, test } from "bun:test";

import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

import { themeBytes, themeMeasure } from "../src/escape-sgr.ts";
import { containsNonSgr } from "../src/escape.ts";
import { markerCell } from "../src/panel-frame.ts";
import { BEL, C1, E, ONE, OVERFLOW, SGR, byteScan } from "./panel-frame-marker-fixture.ts";
import { drawnOffenders } from "./panel-hostile.ts";

/** pi-tui closes every cut with a reset of its own, even when the caller asked for no ellipsis. */
const INJECTED = new RegExp(`${E}\\[[0-9;]*m`, "g");

test("the cut keeps the glyph's own column and re-attaches the colour over it", () => {
  // Each half of `closedCell` needs a witness that says *why* the bytes are where they are, because "no
  // leaks" alone is satisfied by a cell that dropped everything:
  //
  //  1. the cut runs over `themeMeasure(plain)` — the form with the colours taken out too — so its offsets
  //     land inside the coloured form at the start of a kept colour, and the cell keeps the glyph it was
  //     charged for. Measuring on the coloured form instead spends the column on the wrapper's bytes;
  //  2. the bytes come from `themeBytes(marked)`, never the theme's raw string — the old cut branch copied
  //     units out of the raw string and put a refused byte on the row on the colour's column. That the
  //     colour is still *there* is what stops a future "fix" answering the leak by dropping it.
  const marker = (text: string): string => `${SGR}${text}${BEL}`;
  const cell = markerCell(marker(ONE), ONE);
  expect(visibleWidth(cell), JSON.stringify(cell)).toBe(1);
  expect(cell, "the wrapper's visible bytes were drawn in the glyph's place").toContain(ONE);
  expect(cell, "the theme's colour was dropped rather than refused").toContain(SGR);
  expect(cell).not.toContain(BEL);
  // The colour re-attached *over* the glyph rather than emitted somewhere in the cell: a walk that lost the
  // offsets would still put both bytes out and answer the two reads above.
  expect(cell.indexOf(SGR)).toBeLessThan(cell.indexOf(ONE));
  // The padding branch is the other half of the same promise: a wrapper the theme could afford leaves the
  // whole marker drawn, colour and all, and the cell is padded to the glyph's column rather than cut.
  const room = (text: string): string => `${SGR}${text}`;
  const kept = markerCell(room(ONE), ONE);
  expect(visibleWidth(kept)).toBe(1);
  expect(kept).toContain(ONE);
  expect(kept).toContain(SGR);
  // The cut branch's other witness: a wrapper with visible bytes *before* the glyph is the shape where
  // measuring on the coloured form and measuring on the colour-free one disagree about what occupies the
  // glyph's column, and the cell has to answer with the glyph.
  expect(markerCell(`${SGR}${ONE}${OVERFLOW}`, ONE)).toContain(ONE);
});

test("the cut counts columns on the colour-free form, so a colour never buys the row one", () => {
  // What `themeMeasure` is for, and the reason the cut does not simply count on the string it emits from: a
  // colour draws no column, so a cut that counted on a form still carrying it would bill the row for bytes the
  // terminal spends nothing on, and hand `keepColours` offsets that no longer land where the glyph is.
  //
  // The witness is a marker whose colour is written *after* visible bytes, which is the one position where the
  // two forms disagree about what occupies the glyph's column: counted on the coloured form, the wrapper's
  // padding is cut at the colour and the glyph never reaches the row at all.
  const marker = (text: string): string => `${OVERFLOW}${SGR}${text}`;
  const marked = marker(ONE);
  const wrapperWidth = OVERFLOW.length + 1;
  const markedWidth = visibleWidth(marked);
  expect(markedWidth, "the theme's colour was not the thing under test").toBe(wrapperWidth);
  const measured = themeMeasure(marked);
  expect(measured, "the measuring form still carried the colour").not.toContain(SGR);
  const cut = truncateToWidth(measured, 1, "").replace(INJECTED, "");
  const measuredWidth = visibleWidth(cut);
  expect(measuredWidth, `the measuring form cut to ${JSON.stringify(cut)}`).toBeLessThanOrEqual(1);
  const cell = markerCell(marked, ONE);
  expect(visibleWidth(cell), JSON.stringify(cell)).toBe(1);
  // Whatever the cell drew, every column of it is a column a terminal draws: a colour kept out of the count
  // must not have been kept in the cell either.
  const spent = visibleWidth(cell.replace(new RegExp(`${E}\\[[0-9;]*m`, "g"), ""));
  expect(spent, `an uncounted byte is on the row: ${JSON.stringify(cell)}`).toBe(1);
  expect(byteScan(cell), JSON.stringify(marked)).toEqual([]);
  expect(containsNonSgr(cell), JSON.stringify(marked)).toBe(false);
  // Where the glyph does reach the row, the colour reaches it too: the measuring pass refuses a colour
  // because a colour costs no column, and the cell is what puts it back.
  const painted = markerCell(`${SGR}${ONE}${BEL}`, ONE);
  expect(painted, "the theme's colour did not reach the row").toContain(SGR);
});

test("the cell closes the width the panel paid for, whatever the theme wrote", () => {
  // The other half of `closedCell`: `padPlain` pads, and only this cut closes. For every byte a theme can
  // write around the glyph — the whole Latin-1 band, the introducers, an astral glyph and each half of a
  // surrogate pair, in front of the glyph and behind it — whatever `markerCell` hands back measures the
  // glyph's own columns and carries nothing the policy refused. Width is the assertion a leak sweep does not
  // make, and a cell that overran its columns would take a flush-right panel over the chat beside it.
  const shapes: string[] = [];
  for (let code = 0; code < 0x100; code++) {
    if (code === 0x1b || code === 0x09) continue;
    shapes.push(String.fromCharCode(code));
  }
  shapes.push(
    C1(0x9b),
    C1(0x90),
    C1(0x9d),
    "\u{1f600}",
    String.fromCharCode(0xd83d),
    String.fromCharCode(0xdc00),
  );
  for (const shape of shapes) {
    for (const wrapper of [
      (s: string) => `${SGR}${shape}${s}${OVERFLOW}`,
      (s: string) => `${SGR}${s}${shape}${OVERFLOW}`,
      (s: string) => `${SGR}${shape}${s}`,
      (s: string) => `${SGR}${s}${shape}`,
      (s: string) => `${shape}${SGR}${s}${OVERFLOW}${E}[0m`,
    ]) {
      const marked = wrapper(ONE);
      const kept = visibleWidth(themeBytes(marked));
      const cell = markerCell(marked, ONE);
      expect(visibleWidth(cell), `${kept} kept from ${JSON.stringify(marked)}`).toBe(1);
      expect(byteScan(cell), JSON.stringify(marked)).toEqual([]);
      expect(containsNonSgr(cell), JSON.stringify(marked)).toBe(false);
    }
  }
});

test("a cut cell carries no half a surrogate pair, on either side of the walk", () => {
  // The policy *was* not a surrogate pass: `stripNonSgr` handed a lone half through and `visibleWidth`
  // charges it nothing, so a cell that kept one measured the width it owed while handing the terminal a
  // character it cannot draw. Both sides of the offset walk are swept — the cut's own byte
  // (`truncateToWidth` spends a column on it) and the byte the walk reached in the coloured form, which is
  // the one the review's leak rode in on — and the walk is asserted against **both** readings of the cell.
  //
  // Which reading names what was measured against the pre-diff cell, and the two are not interchangeable:
  //
  //  - the *padding* branch copied the raw string, so it is where a half reaches the screen, and there
  //    `drawnOffenders` does name it — it is the assertion that discriminates on this diff, and the one a
  //    future swap of `byteScan` for the shared sweep would have to keep;
  //  - the *cut* branch drops the half along with every other byte past the glyph's column, so both reads
  //    come back clean there whatever the cell did, and `byteScan` is the only one that would have named a
  //    half in any form: `offenders` (`panel-hostile.ts`) sees one, while `containsNonSgr` — which
  //    `drawnOffenders` also asks — reads the surrogate band as printable. A classifier must not certify its
  //    own blind spot, so the scan written from the ranges stays file-local *and* the shared sweep stays
  //    asserted beside it rather than instead of it.
  //
  // The class is also held at the row level now: the filter lives in `themeBytes`, the policy every theme-byte
  // surface shares, and `panel-lines-hostile-theme.test.ts` sweeps it through a whole frame — which is where
  // a guard kept only in this cell would have left `header`, `dim` and `selected` still drawing the half.
  const halves = [
    String.fromCharCode(0xd800),
    String.fromCharCode(0xdc00),
    String.fromCharCode(0xdfff),
  ];
  const pairs = ["\u{1f600}", "\u{1f4a1}", "\u{1f1fa}\u{1f1f8}"];
  for (const bad of halves) {
    for (const wrapper of [
      (s: string) => `${SGR}${bad}${s}${OVERFLOW}`,
      (s: string) => `${SGR}${s}${bad}${OVERFLOW}`,
      (s: string) => `${SGR}${bad}${s}`,
      (s: string) => `${SGR}${s}${bad}`,
      (s: string) => `${SGR}${pairs[0]}${bad}${s}${OVERFLOW}`,
      (s: string) => `${SGR}${s}${pairs[0]}${bad}${OVERFLOW}`,
      (s: string) => `${SGR}${pairs[0]}${s}${pairs[1]}${bad}${OVERFLOW}`,
    ]) {
      const marked = wrapper(ONE);
      const cell = markerCell(marked, ONE);
      const why = `lone pair in ${JSON.stringify(cell)} from ${JSON.stringify(marked)}`;
      expect(byteScan(cell), why).toEqual([]);
      expect(visibleWidth(cell), JSON.stringify(marked)).toBe(1);
      expect(drawnOffenders(cell), JSON.stringify(marked)).toEqual([]);
    }
  }
  // The padding branch, spelled out so the discriminating assertion is not buried in the loop above: a
  // marker the cut never touches is emitted whole, so this is the branch on which a half the policy handed
  // back actually reaches the screen — and the one on which `drawnOffenders` names it. It is the read that
  // discriminates on this diff: the *cut* branch drops the half along with every other byte past the glyph's
  // column, so a cell whose only defence were that drop answers `[]` to both sweeps there and is caught by
  // neither. Here the cell must draw the glyph and its colour and neither half.
  for (const bad of halves) {
    for (const marked of [`${SGR}${bad}${ONE}`, `${SGR}${ONE}${bad}`]) {
      const cell = markerCell(marked, ONE);
      const why = `padding branch kept a half: ${JSON.stringify(marked)} -> ${JSON.stringify(cell)}`;
      expect(drawnOffenders(cell), why).toEqual([]);
      expect(byteScan(cell), why).toEqual([]);
      expect(visibleWidth(cell), why).toBe(1);
      // Not a cell that simply drew nothing: the glyph and the theme's colour are both there, so the two
      // sweeps above are read on a cell that kept what it should and dropped only the half.
      expect(cell, why).toContain(ONE);
      expect(cell, why).toContain(SGR);
    }
  }
  // An astral glyph the cut keeps stays whole: a pair kept is one column, and a pair dropped is none, but a
  // pair cut down the middle is the byte above.
  for (const pair of pairs) {
    const cell = markerCell(`${SGR}${pair}${OVERFLOW}`, ONE);
    expect(byteScan(cell), JSON.stringify(pair)).toEqual([]);
    expect(visibleWidth(cell), JSON.stringify(pair)).toBe(1);
  }
});

test("a cell keeps the colour it can afford, and spends no column on one it cannot", () => {
  // The re-attach is why the cell is *painted*: the level's colour is what makes a warning read as a warning
  // at a glance, and a cut measured on the colour-free form only keeps it if the bytes put back survive the
  // walk whole. Read both branches against the same colour, because only one of them walks `keepColours`:
  //
  //  - a marker that fits the glyph's column is padded, and every attribute the theme wrote is emitted in the
  //    order it wrote them — a walk that copied one code unit at a time would print `[33m` where a colour was
  //    supposed to cost nothing, and a walk that dropped the colours would leave the warning uncoloured;
  //  - a marker the cut had to close is drawn plain: the columns the theme wrote are gone and the colours that
  //    stood over them went with them, which is the cell's own rule, not a leak. `keepColours` is the walk that
  //    decides, and this is where its decision is pinned.
  const painted = markerCell(`${E}[1m${SGR}${ONE}${BEL}`, ONE);
  expect(visibleWidth(painted), JSON.stringify(painted)).toBe(1);
  expect(painted, "an attribute the theme wrote was lost").toContain(`${E}[1m`);
  expect(painted, "the level's colour was lost").toContain(SGR);
  const first = painted.indexOf(`${E}[1m`);
  expect(first, "the colours were emitted out of the order the theme wrote").toBeLessThan(
    painted.indexOf(SGR),
  );
  expect(painted).not.toContain(BEL);

  const cutCell = markerCell(`${SGR}${ONE}${OVERFLOW}`, ONE);
  expect(visibleWidth(cutCell), JSON.stringify(cutCell)).toBe(1);
  expect(cutCell, JSON.stringify(cutCell)).toBe(ONE);
  expect(cutCell).not.toContain(SGR);
  // The two cells are the same glyph at two widths of the same marker: the difference between them is the
  // cut, and nothing else — same theme, same policy, same one column.
  expect(visibleWidth(markerCell(`${SGR}${ONE}`, ONE))).toBe(visibleWidth(cutCell));
});

test("the measuring form is the colour-free form the policy defines, not the sequence-free one", () => {
  // The cell's cut is charged to `themeMeasure`, and the one thing that form must do beyond the drawn policy
  // is take the **colours** out too: a colour costs the terminal nothing, so counting it would bill the row
  // for bytes that draw no column and hand `keepColours` offsets that no longer land where the glyph is.
  // `stripSequences` is the other half of that distinction — it removes the colours and leaves the rest of
  // the walk alone — so the two forms are compared against each other here, at the byte level, on the shapes
  // the panel is drawn with.
  const shapes = [
    `${SGR}${ONE}${OVERFLOW}`,
    `${E}[1m${SGR}${OVERFLOW}${ONE}${BEL}${OVERFLOW}`,
    `${SGR}${E}]0;evil${BEL}${ONE}`,
    `${E}[38;5;33m${ONE}${OVERFLOW}`,
    `${C1(0x9b)}2J${SGR}${ONE}${OVERFLOW}`,
    `${SGR}${"\u{1f600}".repeat(3)}${ONE}${OVERFLOW}`,
  ];
  for (const marked of shapes) {
    const measured = themeMeasure(marked);
    // No colour survives the measuring form, in any of its spellings: 7-bit, 8-bit, or one written after a
    // refused sequence. `visibleWidth` charges them nothing, so a form that kept one would be counted short
    // of what it draws.
    const shape = JSON.stringify(marked);
    expect(measured, `a colour was left in the measure of ${shape}`).not.toContain(E);
    // And what the measure keeps is what the drawn form keeps, minus the colours — the pair the cell reads
    // with, so the two cannot disagree about how many columns there are to re-attach a colour over.
    const kept = themeBytes(marked);
    const plainKept = kept.replace(new RegExp(`${E}\\[[0-9;]*m`, "g"), "");
    expect(measured, `the measure drew bytes the drawn policy refused: ${shape}`).toBe(plainKept);
  }
});

test("a cell drawn with an 8-bit colour in its wrapper spends no column on it, either branch", () => {
  // `themeMeasure` and `themeBytes` are the two forms every cell is read through, and an 8-bit `CSI8` is the
  // byte that tells them apart: the drawn policy refuses it — U+009B is a *character* a terminal draws and
  // `visibleWidth` charges a column for, and a pass that emits what it keeps cannot keep it — while the
  // measuring pass must agree that nothing is left to count. A cell that kept the introducer would be a row
  // wider than the panel, on the branch that pads as much as on the one that cuts.
  const CSI8 = C1(0x9b);
  for (const marked of [
    `${SGR}${CSI8}33m${ONE}${OVERFLOW}`,
    `${CSI8}33m${ONE}${OVERFLOW}`,
    `${SGR}${ONE}${CSI8}2J`,
    `${CSI8}2J${SGR}${ONE}`,
  ]) {
    const cell = markerCell(marked, ONE);
    expect(visibleWidth(cell), JSON.stringify(marked)).toBe(1);
    expect(byteScan(cell), JSON.stringify(marked)).toEqual([]);
    expect(drawnOffenders(cell), JSON.stringify(marked)).toEqual([]);
    const introduces = cell.includes(CSI8);
    expect(introduces, `an 8-bit introducer was drawn for ${JSON.stringify(marked)}`).toBe(false);
    // Whatever the cell drew, it drew it in columns: no byte on it is charged for nothing.
    const spent = visibleWidth(cell.replace(new RegExp(`${E}\\[[0-9;]*m`, "g"), ""));
    expect(spent, JSON.stringify(cell)).toBe(1);
  }
});
