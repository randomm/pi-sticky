/**
 * What the panel's bottom border says while the user is *not* in it.
 *
 * The focused frame has always carried the keys hint in its bottom border; the resting one carried
 * nothing, so the only way into the panel — the focus key — was invisible exactly when the user needed it
 * (issue #43, criterion 3.4). Three promises, one per actor:
 *
 * - the **drawer** draws whatever label the caller hands it, through the border's own label path
 *   (`borderLine` → `fitLabel` → `stripSequences`), and draws nothing but rule when handed `""`;
 * - the **label** is built from the resolved focus key by `replyHint`, which answers `""` for both the
 *   operator's `off` (`null`) and a config that never named one (`undefined`) — the border is then blank,
 *   not "no focus key", because a word that advertises an action nobody can take is the lie the focused
 *   hint already refuses;
 * - the **component** puts the two together: a focused panel still reads the keys hint, and an unfocused
 *   one reads `<focus key> to reply` — the label `dim`med like the focused hint is, never bordered, and
 *   `PanelStyle` gains no member for it.
 *
 * The half of the old `panel-lines.test.ts` case that said "no hint while unfocused" moved here too: a
 * bottom border cannot both be all rule and carry a label, so the two assertions live in different files
 * now.
 */
import { expect, test } from "bun:test";
import { visibleWidth } from "@earendil-works/pi-tui";

import { DEFAULT_CONFIG } from "../src/config.ts";
import { PanelComponent } from "../src/panel-component.ts";
import { replyHint } from "../src/panel-hint.ts";
import { FOCUS_KEY } from "../src/panel-keys.ts";
import { HINT } from "../src/panel-lines.ts";
import type { PanelStyle } from "../src/render.ts";
import type { StickyConfig, ViewPin } from "../src/types.ts";
import { pin } from "./fixtures.ts";
import { createOverlayHandle } from "./harness.ts";
import { host } from "./panel-component-host.ts";
import { built } from "./panel-frame.ts";

const style: PanelStyle = {
  header: (s) => s,
  marker: (_level, s) => s,
  dim: (s) => s,
  selected: (s) => `[${s}]`,
  border: (s) => s,
  borderFocused: (s) => s,
};

const one = (id: number, text: string): ViewPin => ({ ...pin(id, text, "info") });

const content = (pins: readonly ViewPin[], selection = 0, focused = false, replyHintText = "") => ({
  pins,
  selection,
  focused,
  replyHint: replyHintText,
});

/** Wide enough for the whole hint and the whole reply label, corners and margins included. */
const WIDE = 60;

// --- the label itself ---------------------------------------------------------

test("the resting label names the configured focus key and what pressing it gets", () => {
  expect(replyHint(DEFAULT_CONFIG)).toBe("ctrl+alt+p to reply");
  expect(replyHint({ ...DEFAULT_CONFIG, focusKey: "alt+j" })).toBe("alt+j to reply");
});

test("a focus key that is off, or never set, gives no label at all", () => {
  // Both silences, one answer: `null` is the operator's `off`, `undefined` a config that named nothing.
  expect(replyHint({ ...DEFAULT_CONFIG, focusKey: null })).toBe("");
  expect(replyHint({ ...DEFAULT_CONFIG, focusKey: undefined })).toBe("");
});

// --- the drawer ---------------------------------------------------------------

test("an unfocused panel draws the reply label in its bottom border", () => {
  const lines = built(content([one(1, "Decide X")], 0, false, "ctrl+alt+p to reply"), WIDE, style);
  const bottom = lines.at(-1) as string;
  expect(bottom.startsWith("╰")).toBe(true);
  expect(bottom).toContain("ctrl+alt+p to reply");
  // The rule still closes the border: a flush-right panel never ends in a blank.
  expect(bottom.endsWith("╯")).toBe(true);
  for (const line of lines) expect(visibleWidth(line)).toBe(WIDE);
});

test("an unfocused panel with no label to give draws nothing but rule", () => {
  // The `off` case as the user sees it: the border is the frame's own, and no placeholder word steps in.
  expect(built(content([one(1, "x")], 0, false, ""), 40, style).at(-1)).toBe(`╰${"─".repeat(38)}╯`);
});

test("the label is cut with the border's own policy rather than pushed past a corner", () => {
  // At the frame's floor there is no room for the label: `fitLabel` cuts it and the corners keep their
  // columns, which is the same promise the header and the focused hint live under.
  const lines = built(content([one(1, "x")], 0, false, "ctrl+alt+p to reply"), 30, style);
  const bottom = lines.at(-1) as string;
  expect(visibleWidth(bottom)).toBe(30);
  expect(bottom.startsWith("╰ ")).toBe(true);
  expect(bottom.endsWith("╯")).toBe(true);
});

test("a theme that smuggles an escape into the label gets nothing past the border's policy", () => {
  // The label is the caller's string and the theme styles it; `fitLabel` strips before it measures, so
  // an OSC 8 whose columns `visibleWidth` counts as *zero* cannot be padded across the chat behind a
  // flush-right panel.
  const painted: PanelStyle = { ...style, dim: (s) => `\u{1b}]8;;https://evil\u{1b}\\${s}` };
  const lines = built(content([one(1, "x")], 0, false, "ctrl+alt+p to reply"), WIDE, painted);
  expect(lines.at(-1)).not.toContain("\u{1b}");
  expect(lines.at(-1)).toContain("ctrl+alt+p to reply");
});

test("the reply label is drawn through the style's dim, the way the focused hint is", () => {
  // Which token the resting border's label is coloured with is a contract: `dim`, the one the focused hint
  // uses, and not the frame's `border`/`borderFocused` and not the header's accent. A recording `dim` is
  // the evidence — the same technique `panel-frame-theme.test.ts` uses for the glyphs.
  const asked: string[] = [];
  // The border glyphs go through `dim` too in this style, so the assertion is the *call*, not the bytes:
  // the label itself is what was asked to be dimmed, and a style that coloured it with `border` instead
  // would leave the label out of `asked` while still drawing a border.
  const painted: PanelStyle = {
    ...style,
    dim: (s) => {
      asked.push(s);
      return s;
    },
  };
  const lines = built(content([one(1, "x")], 0, false, "ctrl+alt+p to reply"), WIDE, painted);
  expect((lines.at(-1) as string).length).toBeGreaterThan(0);
  expect(asked).toContain("ctrl+alt+p to reply");
});

// --- the component ------------------------------------------------------------

/** A component over a recorded host that hands the label `replyHint` would build from `config`. */
function panel(config: StickyConfig, focused: boolean) {
  const h = host([one(1, "Decide X")]);
  h.stub.replyHint = () => replyHint(config);
  const c = new PanelComponent(h.stub, h.tui);
  const handle = createOverlayHandle();
  handle.unfocus();
  c.setHandle(handle);
  if (focused) c.focus();
  return { c, h };
}

test("the unfocused panel of a session with the default focus key reads '<focus key> to reply'", () => {
  const { c } = panel(DEFAULT_CONFIG, false);
  const lines = c.render(WIDE);
  expect(lines.at(-1)).toContain(`${FOCUS_KEY} to reply`);
  // ...and it is not the keys hint: those keys are not live from out here.
  expect(lines.some((line) => line.includes(HINT))).toBe(false);
});

test("focusing the panel swaps the resting label for the keys hint", () => {
  const { c } = panel(DEFAULT_CONFIG, false);
  expect(c.render(WIDE).at(-1)).toContain("to reply");
  c.focus();
  const focused = c.render(WIDE).at(-1) as string;
  expect(focused).toContain(HINT);
  expect(focused).not.toContain("to reply");
});

test("with the focus key off, the resting bottom border stays all rule", () => {
  // `PI_STICKY_FOCUS_KEY=off` reaches the component as `focusKey: null`; the border is then the frame's
  // own and says nothing, which is what `README.md`'s `off` row promises.
  const { c } = panel({ ...DEFAULT_CONFIG, focusKey: null }, false);
  expect(c.render(40).at(-1)).toBe(`╰${"─".repeat(38)}╯`);
});

test("a rebound focus key is named as the operator rebound it", () => {
  const { c } = panel({ ...DEFAULT_CONFIG, focusKey: "alt+shift+k" }, false);
  expect(c.render(WIDE).at(-1)).toContain("alt+shift+k to reply");
});

test("a label the host changes between frame requests costs a redraw, not a stale border", () => {
  // The frame cache is keyed on everything the frame is drawn from, and the resting label is one of
  // them. The host builds it from the configuration, so a `/reload` that rebounds the focus key (or
  // turns it `off`) has to reach the border: a cache that keyed on width, pins, bar and focus alone
  // would hand pi-tui the *old* label for a frame request that changed nothing the key named.
  const { c, h } = panel(DEFAULT_CONFIG, false);
  expect(c.render(WIDE).at(-1)).toContain("to reply");
  const cached = c.render(WIDE);
  expect(c.render(WIDE)).toBe(cached); // nothing changed: the cache keeps its fast path
  h.stub.replyHint = () => "";
  const rebound = c.render(WIDE);
  expect(rebound).not.toBe(cached);
  expect(rebound.at(-1)).toBe(`╰${"─".repeat(WIDE - 2)}╯`);
  expect(rebound.at(-1)).not.toContain("to reply");
});

test("a changed label reaches the frame through update(), not only through render()", () => {
  // `update()` is the member that compares the live host state and decides whether to invalidate; the
  // resting label is part of what it compares, so a redraw asked for after the label changed is not
  // answered with "same frame" and a border nobody drew.
  const { c, h } = panel(DEFAULT_CONFIG, false);
  c.render(WIDE);
  h.stub.replyHint = () => "alt+shift+k to reply";
  const before = h.state.renders;
  c.update();
  expect(h.state.renders).toBeGreaterThan(before);
  expect(c.render(WIDE).at(-1)).toContain("alt+shift+k to reply");
});

test("the label costs the pins no row: focused and resting differ only in the border", () => {
  // The hint owns a border row, never a content row — the promise the focused hint has always had, now
  // asserted across the two labels the resting frame can carry.
  const resting = built(
    content([one(1, "Decide X")], 0, false, "ctrl+alt+p to reply"),
    WIDE,
    style,
  );
  const blank = built(content([one(1, "Decide X")], 0, false, ""), WIDE, style);
  expect(resting).toHaveLength(blank.length);
  expect(resting.slice(0, -1)).toEqual(blank.slice(0, -1));
});
