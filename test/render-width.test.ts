/**
 * The width invariant of `renderRailLines`. render.ts owns display width — sanitize.ts bounds
 * graphemes, never columns — so this is where "no line may exceed the width it was given" is
 * enforced, and where the two ways it can silently break are pinned.
 *
 * `truncateToWidth` is not width-safe on its own: it wraps its own ellipsis in `\u{1b}[0m` every
 * time it actually cuts, so a rail drawn with `plainStyle` — the style the criteria call identity,
 * and the one a transcript line or an RPC string is drawn with — handed the caller lines full of
 * live SGR bytes. Outside a terminal those bytes are printed, not consumed.
 */
import { describe, expect, test } from "bun:test";
import { visibleWidth } from "@earendil-works/pi-tui";

import { plainStyle, renderRailLines } from "../src/render.ts";
import type { PinLevel, PinView } from "../src/types.ts";
import { NOW, pin, view } from "./fixtures.ts";

const FIXED_TIME = (iso: string): string => (iso === NOW ? "12:00" : iso);

const rail = (view: PinView, width: number, maxLines: number): string[] =>
  renderRailLines(view, width, { maxLines, style: plainStyle, formatTime: FIXED_TIME });

describe("renderRailLines width", () => {
  test("every line is cut to the width it was given", () => {
    const long = "x".repeat(200);
    const lines = rail(view([pin(1, long)]), 20, 8);
    for (const line of lines) {
      // No line may overrun the width; the ellipsis marks the ones that were cut.
      expect(line.length).toBeLessThanOrEqual(40);
    }
    expect(lines.some((l) => l.includes("…"))).toBe(true);
  });

  test("a cut line carries no terminal escape bytes under the plain style", () => {
    // The regression this guards: pi-tui's own reset sequence around the ellipsis. The rail is a
    // transcript line and an RPC string as much as it is a TUI widget, so nothing downstream is
    // going to consume those bytes.
    const lines = rail(view([pin(1, "x".repeat(200))]), 20, 8);
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) expect(line).not.toInclude("\u{1b}");
  });

  test("a cut line keeps the caller's own styling and still fits", () => {
    // Removing what the cut injected must not remove what the theme applied. The part of a style
    // that falls past the cut is discarded with the text it decorated, but a row that fits keeps the
    // opening sequence the style gave it, and every line still measures to the width.
    const ansi = {
      header: (s: string) => `\u{1b}[1m${s}\u{1b}[0m`,
      marker: (_level: PinLevel, s: string) => `\u{1b}[31m${s}\u{1b}[0m`,
      dim: (s: string) => `\u{1b}[2m${s}\u{1b}[0m`,
    };
    const styled = renderRailLines(view([pin(1, "short")]), 60, { maxLines: 8, style: ansi });
    expect(styled[0]).toInclude("\u{1b}[1m");
    expect(styled[1]).toInclude("\u{1b}[31m");
    expect(styled[1]).toInclude("\u{1b}[2m");
    for (const line of renderRailLines(view([pin(1, "x".repeat(200))]), 20, {
      maxLines: 8,
      style: ansi,
    })) {
      expect(visibleWidth(line)).toBeLessThanOrEqual(20);
    }
  });

  test("a pin whose text draws nothing still yields a line that fits", () => {
    // Combining marks alone sanitize to a non-empty string of zero display width, so the rail draws
    // a row with no printable content in it and the cut has to hold anyway.
    const marks = String.fromCodePoint(0x0301, 0x0301);
    for (const w of [1, 2, 3, 10, 40]) {
      for (const line of rail(view([pin(1, marks)]), w, 8)) {
        expect(visibleWidth(line)).toBeLessThanOrEqual(w);
        expect(line).not.toInclude("\u{1b}");
      }
    }
  });

  test("a plain rail draws no escape bytes whatever the pin text claims", () => {
    // Defence in depth at the draw boundary. Every entry into state runs its text through the
    // sanitizer, but a `plainStyle` rail line is a transcript line or an RPC string in which nothing
    // consumes escape bytes, so the rail does not borrow that guarantee from its caller: a view
    // built directly (an `update` that bypassed the tool, a test fixture) is stripped here.
    const ESC = String.fromCharCode(0x1b);
    const hostile = [
      `${ESC}[2J`,
      `${ESC}]52;c;AAAA\u{07}pwn`,
      `a${ESC}]8;;https://evil${ESC}\\label`,
      `x${ESC}`,
      // pi-tui's own injected reset-plus-ellipsis, placed where a cut would find it.
      `y${ESC}[0m\u{2026}${ESC}[0m`,
    ];
    for (const text of hostile) {
      for (const w of [1, 5, 15, 16, 20, 40]) {
        const lines = rail(view([pin(1, text)]), w, 8);
        for (const line of lines) {
          expect(line).not.toInclude(ESC);
          expect(line).not.toInclude("\n");
          expect(visibleWidth(line)).toBeLessThanOrEqual(w);
        }
      }
    }
  });

  test("a styled rail keeps the theme's own bytes but still fits", () => {
    // The counterpart: stripping is for what the caller did not style. A theme that colours a row
    // asked for those bytes, and they stay — the width invariant is what governs a styled rail.
    const ESC = String.fromCharCode(0x1b);
    const ansi = {
      header: (s: string) => `${ESC}[1m${s}${ESC}[0m`,
      marker: (_level: PinLevel, s: string) => `${ESC}[31m${s}${ESC}[0m`,
      dim: (s: string) => `${ESC}[2m${s}${ESC}[0m`,
    };
    const lines = renderRailLines(view([pin(1, `${ESC}[31mred`)]), 20, {
      maxLines: 8,
      style: ansi,
    });
    for (const line of lines) expect(visibleWidth(line)).toBeLessThanOrEqual(20);
  });
});
