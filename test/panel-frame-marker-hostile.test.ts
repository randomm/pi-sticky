/**
 * The hostile theme `marker`, swept twice: once through `markerCell` on both of its branches, and once
 * through a whole frame drawn at every width the overlay can be handed (#70).
 *
 * The cut branch used to measure on the theme's bytes with every sequence gone and then re-attach its
 * colours *out of the theme's raw string*, one code unit at a time. `stripNonSgr` is a sequence pass, so a
 * byte it neither keeps nor recognises — a C1 that is not one of the scanner's six introducers, half a
 * surrogate pair — survived both passes, and the re-attach copied it back onto the row under the colour of a
 * marker that did. `drawnOffenders` (`panel-hostile.ts`) is the SGR-tolerant sweep the panel's frames are held
 * to, and a bare C1 or a lone surrogate is exactly what it names, so it is asserted alongside `byteScan`
 * below, written from the ranges themselves rather than from the classifier certifying itself.
 *
 * Every width is swept, not one: which branch the bytes take depends on the width the row was laid out at,
 * and a fix that held only on the branch a single fixture exercised would be invisible in a one-width test.
 * `panel-frame-marker.test.ts` is the cell's own arithmetic; this file is the same bytes where a user sees
 * them.
 */
import { expect, test } from "bun:test";

import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

import { themeBytes } from "../src/escape-sgr.ts";
import { containsNonSgr } from "../src/escape.ts";
import { glyph, markerCell } from "../src/panel-frame.ts";
import type { PanelStyle } from "../src/render.ts";
import type { ViewPin } from "../src/types.ts";
import { LATER, pin } from "./fixtures.ts";
import {
  BEL,
  C1,
  E,
  HOSTILE_MARKER,
  ONE,
  OVERFLOW,
  SGR,
  byteScan,
} from "./panel-frame-marker-fixture.ts";
import { built } from "./panel-frame.ts";
import { drawnOffenders } from "./panel-hostile.ts";

/** pi-tui wraps the ellipsis of every cut in a reset of its own, even when the caller asked for none. */
const INJECTED = new RegExp(`${E}\\[[0-9;]*m`, "g");

/** Every width from a wide panel down to the frame's own floor (`PANEL_MIN_FRAME_COLUMNS`). */
const WIDTHS = [120, 100, 80, 60, 45, 38, 34, 30];

test("a hostile marker's cell carries no bare control, no non-SGR sequence and no half a pair", () => {
  // Both branches of the width — the fitting one and the cutting one — since the bug lived in the cut's
  // re-attach, and three readings of the same cell: a sweep written from the byte ranges, the SGR-tolerant
  // sweep the frame files defer to, and the classifier that sweep defers to.
  for (const marker of HOSTILE_MARKER) {
    for (const text of [`${ONE}${OVERFLOW}`, ONE, OVERFLOW, ""]) {
      const marked = marker(text);
      const cell = markerCell(marked, ONE);
      expect(byteScan(cell), JSON.stringify(marked)).toEqual([]);
      expect(drawnOffenders(cell), JSON.stringify(marked)).toEqual([]);
      expect(containsNonSgr(cell), JSON.stringify(marked)).toBe(false);
      expect(visibleWidth(cell), JSON.stringify(marked)).toBe(1);
    }
  }
});

test("a hostile marker drawn through a whole frame leaks nothing at any width", () => {
  // The same bytes through the path a user sees: the row table stamps the marker into the row and the drawer
  // exchanges it for the selection marker on the bar's row, both through `markerCell`. A cell clean in
  // isolation and dirty in a row is the failure this sweep is for, and the width is re-asserted on every line
  // because a smuggled byte that bought a column opens a flush-right frame.
  const view: ViewPin[] = [pin(1, "a first pin long enough to be cut"), pin(2, "b second")];
  for (const marker of HOSTILE_MARKER) {
    let keptColour = false;
    const style: PanelStyle = {
      header: (s) => s,
      marker: (_level, s) => marker(s),
      dim: (s) => s,
      selected: (s) => `${E}[44m${s}`,
      border: (s) => s,
      borderFocused: (s) => s,
    };
    for (const width of WIDTHS) {
      for (const focused of [false, true]) {
        for (const selection of [0, 1]) {
          const lines = built(
            { pins: view, selection, focused, replyHint: "f to reply", ageNow: LATER },
            width,
            style,
          );
          // A frame the drawer refused draws no lines at all, and there is nothing to sweep in that case.
          if (lines.length === 0) continue;
          // The colour the theme asked for survived on at least one of the widths this marker is drawn at —
          // asserted across the sweep rather than per frame, because a marker whose wrapper is all bytes and
          // no glyph (`(s) => ESC[33m<control>AAAA`, with `s` dropped) legitimately keeps no colour and draws
          // a blank cell, which is the cell's own rule and not a leak.
          for (const line of lines) {
            expect(byteScan(line), `@${width}`).toEqual([]);
            expect(drawnOffenders(line), `@${width}`).toEqual([]);
            expect(containsNonSgr(line), `@${width}`).toBe(false);
            expect(visibleWidth(line), `@${width}`).toBe(width);
          }
          if (lines.some((line) => line.includes(SGR))) keptColour = true;
        }
      }
    }
    // The colour the theme asked for survives on *some* frame in the sweep — but only for the shapes that ask
    // for it. `markerCell` keeps a colour the cut can afford: a wrapper whose visible bytes already fill the
    // glyph's one column (`ESC [ 33 m` SI, the glyph, `AAAA`) is cut to nothing and its cell draws blank with
    // no colour to show, which is the cell's own rule rather than a leak. The shapes that leave the glyph a
    // column of its own (`ESC [ 33 m` DCS8, the glyph, `AAAA`) keep it, and those have to be coloured somewhere
    // — a sweep that never saw one would also pass for a cell that dropped every colour the theme wrote.
    // The predicate asks the cell itself whether it kept any of the theme's colour for the glyph, rather than
    // whether the theme wrote one: a wrapper whose visible bytes already fill the glyph's column is cut to
    // nothing and its cell legitimately draws blank.
    if (markerKeepsColour(marker)) {
      expect(keptColour, "a marker that wraps the glyph in colour had none drawn anywhere").toBe(
        true,
      );
    }
  }
});

/**
 * Does the cell for the plain glyph keep any of the colour the theme wrote? `markerCell` is the only reader
 * of that question — a wrapper whose visible bytes already fill the glyph's column is cut to nothing and its
 * cell legitimately draws blank — so the witness below asks it rather than guessing from the input.
 */
function markerKeepsColour(marker: (text: string) => string): boolean {
  return markerCell(marker(ONE), ONE).includes(SGR);
}

test("the glyph path keeps a hostile frame's corners at one column", () => {
  // The corners and the peek's gutter go through `glyph` rather than `markerCell`, and `glyph` is the same
  // promise minus the re-attach: whatever the theme's `border` writes around a corner character, the drawn
  // result is that one glyph and no escape byte, so a frame's box cannot be widened by a hostile border.
  for (const marker of HOSTILE_MARKER) {
    for (const corner of ["╭", "╮", "│", " "]) {
      const drawn = glyph((text) => marker(text), corner);
      expect(byteScan(drawn), JSON.stringify(corner)).toEqual([]);
      expect(drawnOffenders(drawn), JSON.stringify(corner)).toEqual([]);
      expect(containsNonSgr(drawn), JSON.stringify(corner)).toBe(false);
      // One column even for a corner that draws nothing: `padPlain` pads the cell to the column the frame
      // paid for, so a blank gutter is a blank column and never a missing one.
      expect(visibleWidth(drawn), JSON.stringify(corner)).toBe(Math.max(visibleWidth(corner), 1));
    }
  }
});

test("a dim whose wrapper draws more than the stamp is cut, and the frame still closes", () => {
  // The shape the reserve/cut pair is for: `widestStampColumns` charges the theme's own bytes to the tail, and
  // `drawnTail` cuts it to what the row can spend, so a `dim` that wrote `AAAA` around every stamp cannot open
  // a row past the frame's width. The tail's colour survives; its padding does not.
  const view: ViewPin[] = [pin(1, "a first pin long enough to be cut"), pin(2, "b second")];
  const style: PanelStyle = {
    header: (s) => s,
    marker: (_level, s) => s,
    dim: (s) => `${OVERFLOW}${SGR}${s}${OVERFLOW}`,
    selected: (s) => `${E}[44m${s}`,
    border: (s) => s,
    borderFocused: (s) => s,
  };
  for (const width of WIDTHS) {
    for (const focused of [false, true]) {
      const lines = built(
        { pins: view, selection: 0, focused, replyHint: "f to reply", ageNow: LATER },
        width,
        style,
      );
      if (lines.length === 0) continue;
      for (const line of lines) {
        expect(byteScan(line), `@${width}`).toEqual([]);
        expect(drawnOffenders(line), `@${width}`).toEqual([]);
        expect(visibleWidth(line), `@${width}`).toBe(width);
      }
      // The stamp is drawn inside the padding the theme asked for, so the theme's bytes reach the row too —
      // what the cut owns is that the row never spends more columns than the frame was given.
      expect(lines.join("")).toContain("#1");
    }
  }
});

test("a frame whose border theme writes visible bytes around a glyph is refused, not drawn", () => {
  // The promise behind `glyph`'s cut, and the reason it is a cut rather than a strip: a theme that wraps a
  // corner in bytes the terminal *draws* is asking for a box wider than the overlay was handed, and the drawer
  // refuses the whole frame (`frameIsOneColumn`, `panel-border.ts`) rather than padding a row over the chat
  // behind a flush-right panel. So the two halves are asserted together — a hostile border that still draws a
  // byte is the one shape that must produce no lines at all, while the same bytes refused *as sequences* are
  // the case where the frame is drawn and only the bytes are gone.
  const view: ViewPin[] = [pin(1, "a first pin long enough to be cut"), pin(2, "b second")];
  const colour = (s: string): string => `${SGR}${s}`;
  const refused = (s: string): string => `${SGR}${s}${E}]0;owned${BEL}`;
  const content = (focused: boolean) => ({
    pins: view,
    selection: 0,
    focused,
    replyHint: "f to reply",
    ageNow: LATER,
  });
  // Refused as sequences: the frame is drawn, and none of the bytes reach it.
  const drawn = built(content(true), 60, {
    header: colour,
    marker: colour,
    dim: colour,
    selected: colour,
    border: refused,
    borderFocused: refused,
  });
  expect(drawn.length).toBeGreaterThan(0);
  for (const line of drawn) {
    expect(byteScan(line)).toEqual([]);
    expect(drawnOffenders(line)).toEqual([]);
    expect(visibleWidth(line)).toBe(60);
  }
  expect(drawn.join("")).not.toContain(`${E}]`);
  // Written as visible bytes: the box would overrun, so nothing is drawn at all.
  const visible = (s: string): string => `${SGR}${OVERFLOW}${s}${OVERFLOW}`;
  for (const focused of [false, true]) {
    expect(
      built(content(focused), 60, {
        header: colour,
        marker: colour,
        dim: colour,
        selected: colour,
        border: visible,
        borderFocused: visible,
      }),
      `focused=${focused}`,
    ).toEqual([]);
  }
});
