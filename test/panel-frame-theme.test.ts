/**
 * The panel's frame colours, asked of the theme.
 *
 * A recording theme is the only way to see which token the glyphs were asked for: `createPlainTheme`
 * is the identity, so the assertion here is on the *call*, not the bytes (the `test/widget.test.ts`
 * technique, applied to the panel's own style mapping). What the builder does with the answers — the
 * glyphs, the rule, the escape policy — is `panel-lines.test.ts` and `panel-lines-hostile.test.ts`.
 */
import { expect, test } from "bun:test";

import { buildPanelLines, panelLayout } from "../src/panel-lines.ts";
import { panelThemeStyle } from "../src/render.ts";
import type { ViewPin } from "../src/types.ts";
import { pin } from "./fixtures.ts";

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
 * The frame drawn exactly as the component draws it: `panelLayout` owns the row table *and* the height,
 * and the builder is handed both — no caller can size one frame and draw another.
 */
function built(
  c: ReturnType<typeof content>,
  width: number,
  height: number,
  styleOf: ReturnType<typeof panelThemeStyle>,
): string[] {
  return buildPanelLines(
    c,
    width,
    height,
    styleOf,
    panelLayout(c.pins, width, height, c.selection, styleOf),
  );
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
