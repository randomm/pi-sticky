/**
 * The panel's frame colours, asked of the theme.
 *
 * A recording theme is the only way to see which token the glyphs were asked for: `createPlainTheme`
 * is the identity, so the assertion here is on the *call*, not the bytes (the `test/widget.test.ts`
 * technique, applied to the panel's own style mapping). The second half of the file is the other half
 * of the frame's promise: every glyph of it — four corners, two gutters, the rule — has to measure one
 * column through the theme, and a style that puts *visible* bytes around any one of them is asking for
 * a frame wider than the overlay was given, so the builder draws nothing. What the builder does with the
 * answers it accepts — the glyphs, the rule, the escape policy — is `panel-lines.test.ts` and
 * `panel-lines-hostile.test.ts`.
 */
import { expect, test } from "bun:test";

import { panelThemeStyle } from "../src/render.ts";
import type { PanelStyle as RenderPanelStyle } from "../src/render.ts";
import type { ViewPin } from "../src/types.ts";
import { pin } from "./fixtures.ts";
import { built as builtFrame } from "./panel-frame.ts";

const one = (id: number, text: string, extra: Partial<ViewPin> = {}): ViewPin => ({
  ...pin(id, text, "info", extra),
  ...extra,
});

const content = (pins: readonly ViewPin[], selection = 0, focused = false) => ({
  pins,
  selection,
  focused,
});

/**
 * The frame drawn exactly as the component draws it — `panel-frame.ts`'s `built`, with the terminal named
 * rather than assumed: the frame is as tall as its pins until `panelLayout` cuts it at the terminal's
 * half, so a test that asks for `height` rows passes a terminal of at least `2 × height` rows. The pins
 * of these tests are one row each, so two rows of frame is three.
 */
function built(
  c: ReturnType<typeof content>,
  width: number,
  height: number,
  styleOf: ReturnType<typeof panelThemeStyle> | RenderPanelStyle,
): string[] {
  return builtFrame(c, width, styleOf, height * 2);
}

/** A theme that records the tokens it was asked for and colours nothing, so a call is the evidence. */
function recordingTheme(asked: string[]) {
  return {
    bold: (s: string) => s,
    fg: (token: string, s: string) => {
      asked.push(token);
      return s;
    },
    bg: (_token: string, s: string) => s,
    getBgAnsi: () => "bg",
    inverse: (s: string) => s,
  } as unknown as Parameters<typeof panelThemeStyle>[0];
}

test("the frame's colours come from the theme, and the focused frame asks for the accent", () => {
  const asked: string[] = [];
  const styleOf = panelThemeStyle(recordingTheme(asked));
  const pins = [one(1, "Decide X")];
  built(content(pins, 0, false), 40, 3, styleOf);
  expect(asked).toContain("border");
  expect(asked).not.toContain("borderAccent");

  asked.length = 0;
  built(content(pins, 0, true), 40, 3, styleOf);
  expect(asked).toContain("borderAccent");
  // The hint is dimmed, not accented, and the header keeps its own accent bold: `border` is never asked
  // for in a focused frame, and `borderAccent` is asked for only by the frame's own glyphs.
  expect(asked).not.toContain("border");
  expect(asked.filter((token) => token === "borderAccent").length).toBeGreaterThan(0);
  expect(asked).toContain("accent");
});

test("a theme that colours the selection nothing falls back to inverse", () => {
  const theme = recordingTheme([]);
  const colourless = panelThemeStyle({
    ...theme,
    getBgAnsi: () => "",
    inverse: (s: string) => `i:${s}`,
  } as unknown as Parameters<typeof panelThemeStyle>[0]);
  // The bar is still visible against the panel's own background, and a frame whose theme gives it no
  // colour at all is still a frame: the glyph comes back as the character the builder asked for.
  expect(colourless.selected("x")).toBe("i:x");
  expect(colourless.border("x")).toBe("x");
});

/**
 * A style that wraps one frame glyph in visible bytes and colours nothing else.
 *
 * The six glyphs the frame draws itself, each named the way `panel-frame.ts` names it, so a guard that
 * measures only two of them fails for the four it skipped. `marker` is the tell that the refusal came
 * from the frame and not from a cut elsewhere: a drawn row carries it, a frame that drew nothing carries
 * nothing at all.
 */
function wrappingStyle(token: string, glyphText: string): RenderPanelStyle {
  const wrap = (s: string) => (s === glyphText ? `[${s}]` : s);
  return {
    header: (s) => s,
    marker: (_level, s) => `<m:${s}>`,
    dim: (s) => s,
    selected: (s) => s,
    border: token === "border" ? wrap : (s) => s,
    borderFocused: token === "borderFocused" ? wrap : (s) => s,
  };
}

test("a theme whose corner is not one column draws no frame, and the rail keeps the pins", () => {
  // The check used to measure the gutter and the rule only, so a style that wrapped *corners* in visible
  // bytes slipped past it and asked for a frame two columns wider than the overlay — the corners are
  // drawn at the far right of a flush-right panel, where the columns belong to the chat behind it.
  // Drawing nothing is the honest answer, and "nothing" means no row at all: no header, no pin, no
  // marker. The pins are still the rail's to show.
  for (const glyphText of ["╭", "╮", "╰", "╯"]) {
    for (const token of ["border", "borderFocused"]) {
      const pins = [one(1, "Decide X")];
      const styleOf = wrappingStyle(token, glyphText);
      expect(built(content(pins, 0, token === "borderFocused"), 40, 4, styleOf)).toEqual([]);
      // And the same style with the wrapping glyph left alone is a frame: the refusal is the glyph's,
      // not a size or an empty view answering for it.
      expect(built(content(pins, 0, false), 40, 3, wrappingStyle(token, ""))).toHaveLength(3);
    }
  }
});

test("a theme whose gutter or rule is not one column draws no frame either", () => {
  // The two the guard already measured, pinned per focus state so neither border member is exempt.
  for (const glyphText of ["│", "─"]) {
    for (const token of ["border", "borderFocused"]) {
      const pins = [one(1, "Decide X")];
      expect(
        built(content(pins, 0, token === "borderFocused"), 40, 4, wrappingStyle(token, glyphText)),
      ).toEqual([]);
    }
  }
});

test("a theme that only colours the frame still draws it, because colour costs no columns", () => {
  // The other side of the same guard: what a real theme does to a glyph is wrap it in SGR bytes, which
  // `visibleWidth` does not count, and the frame must still close.
  const pins = [one(1, "Decide X")];
  const coloured: RenderPanelStyle = {
    header: (s) => s,
    marker: (_level, s) => s,
    dim: (s) => s,
    selected: (s) => s,
    border: (s) => `\u{1b}[2m${s}`,
    borderFocused: (s) => `\u{1b}[1m${s}`,
  };
  expect(built(content(pins, 0, false), 40, 3, coloured)).toHaveLength(3);
  expect(built(content(pins, 0, true), 40, 3, coloured)).toHaveLength(3);
});
