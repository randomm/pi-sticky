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
});
