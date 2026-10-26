/**
 * `cut` is the only thing standing between a rail line and a terminal the rail does not own, and
 * pi-tui's `truncateToWidth` does not keep its own width promise once the text is hostile.
 *
 * Two shapes break it, both found by running the function rather than reading it:
 *
 * - An OSC or APC sequence with no terminator anywhere. pi-tui's `ansiCodeLength` returns 0 for
 *   those, so its scanner treats the introducer as one printable column and swallows the payload
 *   that follows as text; the line measures to the width on the way out, but the *payload is
 *   printed*, because a real terminal treats that introducer as the start of a string.
 * - A truncated escape kept at the cut boundary: `truncateToWidth` copies escape bytes verbatim, so
 *   a `ESC G` whose payload was cut away leaves a live introducer in the line.
 *
 * So both branches of `cut` have to end with something that measures to the width by itself: the
 * plain branch strips, and the styled branch — which may not strip, because the theme's own bytes
 * were asked for — falls back to the escape-stripped text when the styled cut overshot.
 */
import { describe, expect, test } from "bun:test";
import { visibleWidth } from "@earendil-works/pi-tui";

import { type Style, plainStyle, renderList, renderRailLines } from "../src/render.ts";
import type { PinLevel, PinView } from "../src/types.ts";
import { pin, view } from "./fixtures.ts";

const cp = (...codes: number[]): string => String.fromCodePoint(...codes);
const ESC = cp(0x1b);
const BEL = cp(0x07);
const WIDTHS = Array.from({ length: 40 }, (_, i) => i + 1);

const rail = (v: PinView, width: number, style: Style): string[] =>
  renderRailLines(v, width, { maxLines: 8, style });

/** A style that colours nothing: the line the rail builds is exactly what `cut` receives. */
const identity: Style = { header: (s) => s, marker: (_l, s) => s, dim: (s) => s };

/** A style that wraps everything it is given in SGR, as a theme-backed one does. */
const sgr: Style = {
  header: (s) => `${ESC}[1m${s}${ESC}[0m`,
  marker: (_l: PinLevel, s) => `${ESC}[31m${s}${ESC}[0m`,
  dim: (s) => `${ESC}[2m${s}${ESC}[0m`,
};

/**
 * Pin text that never went through the sanitizer — a view built directly, which the rail promises
 * to survive. Each entry is either an unterminated string introducer, a Kitty prefix, or pi-tui's
 * own injected reset-plus-ellipsis planted where a cut finds it.
 */
const HOSTILE = [
  `a${ESC}Gf=1;d=AAAA${BEL}b`, // Kitty graphics prefix
  `${ESC}]8;;http://evil`, // unterminated OSC 8, no terminator at all
  `${ESC}]8;;http://evil${ESC}\\label${ESC}]8;;${ESC}\\`, // a full hyperlink pair
  `x${ESC}[0m\u{2026}${ESC}[0m${ESC}Xq`, // pi-tui's cut marker, then a bare ESC
  `${ESC}_pi:c${BEL}${ESC}_pi:d`, // two pi-tui private APC markers
  `a${ESC}${cp(0xdc41)}b`, // a bare ESC that pairs with a lone surrogate
  `${ESC}[2J${ESC}[31mred`, // erase screen, then an SGR
];

describe("cut keeps every line within the width, whatever the text claims", () => {
  test.each(HOSTILE.map((text) => [text]))("a hostile pin draws no over-wide line (%#)", (text) => {
    // The two styles that may never strip: the identity style, which is a styled caller that added
    // nothing, and an SGR theme, which added bytes of its own that the rail must not remove.
    for (const style of [identity, sgr, plainStyle]) {
      for (const width of WIDTHS) {
        for (const line of rail(view([pin(1, text)]), width, style)) {
          expect(visibleWidth(line)).toBeLessThanOrEqual(width);
        }
      }
    }
  });

  test("the plain branch strips after the cut, so nothing printable survives in a line", () => {
    // `visibleWidth` cannot see the difference between a payload pi-tui measured as text and one it
    // measured as a sequence — both can print. The plain branch does not rely on the measurement:
    // whatever survives it is a string with no escape byte in it at all.
    for (const text of HOSTILE) {
      for (const width of WIDTHS) {
        for (const line of rail(view([pin(1, text)]), width, plainStyle)) {
          expect(line).not.toInclude(ESC);
          expect(visibleWidth(line)).toBeLessThanOrEqual(width);
        }
      }
    }
  });

  test("a styled rail keeps the theme's own sequences when the line fits", () => {
    // The fallback must not become a strip: the caller asked for the colour, and a row that fits
    // keeps it. Only a line the cut actually overshot is redrawn from the stripped text.
    const lines = rail(view([pin(1, "short")]), 60, sgr);
    expect(lines[0]).toInclude(`${ESC}[1m`);
    expect(lines[1]).toInclude(`${ESC}[31m`);
    expect(lines[1]).toInclude(`${ESC}[2m`);
  });

  test("a hostile pin drawn through the reducer's own text still lists cleanly", () => {
    // renderList has no width to hold, but it is the surface the model reads back, so the same
    // hostile view is asserted here too: no over-wide rail, and no break smuggled into a listing.
    for (const text of HOSTILE) {
      const v = view([pin(1, text)]);
      expect(renderList(v, 5)).not.toInclude("\n\n");
      for (const width of [10, 15, 20]) {
        for (const line of rail(v, width, plainStyle))
          expect(visibleWidth(line)).toBeLessThanOrEqual(width);
      }
    }
  });
});
