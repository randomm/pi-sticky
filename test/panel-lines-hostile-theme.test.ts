/**
 * What the frame draws when the *theme* is the thing carrying the bytes: a border label the caller supplied,
 * and a colour spelled in its 8-bit form.
 *
 * `panel-lines-hostile.test.ts` is the frame against a hostile *pin* and a theme that smuggles in its 7-bit
 * spellings. These two cases came out of the #70 review and ask the two questions that file's fixtures could
 * not: whether a border label's *own* bytes can reach a border column now that the theme's colour is allowed
 * there, and whether a colour written with `CSI8` (U+009B) — an introducer to the scanner and a *printable
 * character* to `visibleWidth` — can buy the flush-right frame columns it did not pay for.
 *
 * Both are frame-level, so both draw through the same `built` and the same width sweeps as the sibling file,
 * and each row is read by the sweep that fits its bytes: `offenders` where nothing coloured the line,
 * `drawnOffenders` where the theme's colour is legitimately on it.
 */
import { expect, test } from "bun:test";

import type { PanelStyle as RenderPanelStyle } from "../src/render.ts";
import { built } from "./panel-frame.ts";
import { BEL, ESC, MIN_FRAME_WIDTH, ST, drawnOffenders, offenders } from "./panel-hostile.ts";
import { expectUniformWidth, one, plain } from "./panel-lines-hostile-fixture.ts";

/** What a test writes to ask for a frame; `built` adds the sections the frame's title prints. */
function content(
  pins: Parameters<typeof built>[0]["pins"],
  selection = 0,
  focused = false,
  replyHint = "",
) {
  return { pins, selection, focused, replyHint, ageNow: "2026-10-23T14:30:00.000Z" };
}

/**
 * Every SGR parameter run on `line` that does not begin with its own introducer — the bytes a strip which
 * removed an introducer and left the parameters behind would print. A colour drawn whole is not among them:
 * each `…m` here is read backwards for the `ESC [` that must stand in front of it.
 */
function orphanedSgr(line: string): string[] {
  const OPEN = `${ESC}[`;
  const bad: string[] = [];
  for (const match of line.matchAll(/(?:[0-9;]+m)/g)) {
    const at = match.index ?? 0;
    if (line.slice(Math.max(0, at - OPEN.length), at) !== OPEN) bad.push(match[0]);
  }
  return bad;
}

test("a hostile border label draws as text, and a themed one keeps only its colour", () => {
  // The bottom border's label is the caller's `replyHint` — the one label the panel does not compose. The
  // operator's environment feeds it (`PI_STICKY_FOCUS_KEY`), and `parseKeyIdStrict` rejects an ESC in that
  // value, so no escape is reachable through it today. This is the safety net for the day that changes: the
  // label's *own* bytes never reach a border column, and the only escape a border row may carry is the
  // theme's colour — so the guarantee is the strip, not an absence of colour.
  const hostileLabel = `deploy${ESC}[31m${"x".repeat(60)}failed`;
  const escapers: Array<[string, RenderPanelStyle, boolean, string?]> = [
    // A pass-through theme: whatever survives the label's own strip is what the row draws, and it is colour
    // free — so this is the frame the unconditional sweep applies to.
    ["plain", plain, false],
    // A theme that wraps rather than colours, so `visibleWidth` charges its bytes and the label is cut. Its
    // tag is drawn bytes, not an escape, so the unconditional sweep still holds.
    ["wrapped", { ...plain, dim: (s) => `<d:t>${s}</d:t>` }, false],
    // A theme that colours the label — the bytes that must still be there, and the reason this row is swept
    // by the SGR-tolerant sweep rather than the unconditional one (#70: the theme's colour is drawn).
    ["coloured", { ...plain, dim: (s) => `${ESC}[2m${s}` }, true],
    // A theme that smuggles: its non-SGR sequence is refused whatever the label did, and its colour happens
    // to be the very parameters the label carried — so those bytes can only be named here as the *theme's*
    // colour, never as something the label smuggled past its own strip.
    [
      "smuggling",
      { ...plain, dim: (s) => `${ESC}]0;pwn${BEL}${ESC}[31m${s}${ST}` },
      true,
      `${ESC}[31m`,
    ],
  ];
  for (const [name, style, themed, themeOwns] of escapers) {
    for (const width of [MIN_FRAME_WIDTH, 33, 60, 120]) {
      // The *unfocused* frame is the one that draws the caller's hint: while focused the border carries the
      // panel's own `focusedHint` instead (`panel-lines.ts`).
      const lines = built(content([one(1, "Decide X")], 0, false, hostileLabel), width, style);
      expectUniformWidth(lines, width);
      const bottom = lines[lines.length - 1] ?? "";
      for (const line of lines) {
        if (themed) expect(drawnOffenders(line), `${name} @${width}`).toEqual([]);
        else expect(offenders(line), `${name} @${width}`).toEqual([]);
      }
      // The label's own escape is gone — named for the styles whose theme does not emit that very colour
      // itself — and so is any fragment of it: an SGR is drawn with its introducer or not at all, so a `31m`
      // standing alone on the row is the half-sequence a strip which took only the introducer leaves behind.
      // A *complete* `ESC [ … m` is not what that last question asks: that is the theme's colour, which this
      // row is allowed to draw.
      if (themeOwns === undefined) {
        expect(bottom, `${name} @${width}`).not.toContain(`${ESC}[31m`);
      }
      expect(orphanedSgr(bottom), `${name} @${width}`).toEqual([]);
      expect(bottom, `${name} @${width}`).toContain("deploy");
    }
  }
  // ...and the colour the theme asked for is still drawn on that row, so the sweep above is not the accident
  // of a style that coloured nothing.
  const coloured = built(content([one(1, "Decide X")], 0, false, hostileLabel), 60, {
    ...plain,
    dim: (s) => `${ESC}[2m${s}`,
  });
  expect(coloured[coloured.length - 1] ?? "").toContain(`${ESC}[2m`);
});

test("a theme that colours with an 8-bit introducer costs the frame no columns", () => {
  // pi's own `theme.fg` emits `ESC [ … m`, so the 7-bit fixtures of the sibling file cover the shipped theme;
  // this is the third-party theme that spells the same colour with `CSI8` (U+009B). The introducer is a
  // *printable* character to `visibleWidth`, so a keeping pass drew it and its parameters — four columns
  // where a colour costs none — and `frameIsOneColumn`, which measures the theme's `border` before its bytes
  // are drawn, could not see it: the corner it guarded is drawn from the coloured string afterwards. Every
  // member is spelled the 8-bit way at once here: the corners, the gutter, the marker, the bar, the tail and
  // both labels.
  const CSI8 = String.fromCharCode(0x9b);
  const paint = (text: string) => `${CSI8}31m${text}`;
  const eightBit: RenderPanelStyle = {
    header: paint,
    marker: (_level, text) => paint(text),
    dim: paint,
    selected: paint,
    border: paint,
    borderFocused: paint,
  };
  for (const focused of [false, true]) {
    for (const width of [MIN_FRAME_WIDTH, 40, 60, 120]) {
      const lines = built(content([one(1, "Decide X")], 0, focused, "f to reply"), width, eightBit);
      expectUniformWidth(lines, width);
      for (const line of lines) {
        // The unconditional sweep is the one that names a C1 byte, and a line drawn under an all-8-bit theme
        // must still carry none: the introducer is refused wherever a colour is kept.
        expect(offenders(line), `@${width}`).toEqual([]);
        expect(drawnOffenders(line), `@${width}`).toEqual([]);
        // Not its parameters either: a refused introducer that left `31m` behind would print, and nothing on
        // a row drawn under a theme whose every colour is 8-bit has earned an SGR of its own.
        expect(line, `@${width}`).not.toMatch(/\d+m/);
      }
    }
  }
});
