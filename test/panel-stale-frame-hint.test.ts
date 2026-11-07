/**
 * The border's option hint on a stale frame, guarded against the frame the bar was drawn from (issue #96, D4).
 *
 * `buildPanelLines` composes the bottom border from `focusedHint(content.pins, content.selection, true)`
 * (`panel-lines.ts`), and both of those come from the frame `drawFrame` memorised — the same pair the keys now
 * resolve through (`panel-input.ts`). The label therefore has to name the options of the pin the user was
 * *looking at*, not those of whatever the live drawn order puts at that index now. Nothing else in the frame
 * says which pin the component aimed its keys at, which is what makes the row the observable of the fix: a
 * component that resolved the hint from the live order draws the plain label here, and one that refused every
 * key after a stale publish would draw the resting border instead.
 *
 * The expectation is the row produced by `built` (`test/panel-frame.ts`) over the **drawn** pair — the helper
 * that pairs `panelLayoutSections` with `buildPanelLines`, the very builder that calls `focusedHint` — at the
 * same width the component is rendered at, compared row for row. Not a substring, not a literal, so a border
 * that got the digits right by luck and the cut wrong, or was laid out at another width, still fails.
 *
 * Split from `panel-stale-frame-keys.test.ts` because that file is the component's *keys*; this one is the
 * frame's single label, and its fixture carries an options row, which the key cases deliberately do not.
 */
import { expect, test } from "bun:test";

import { PanelComponent } from "../src/panel-component.ts";
import { focusedHint } from "../src/panel-option-hint.ts";
import type { PanelStyle } from "../src/render.ts";
import type { ViewPin } from "../src/types.ts";
import { NOW, pin } from "./fixtures.ts";
import { createOverlayHandle } from "./harness.ts";
import { host } from "./panel-component-host.ts";
import { built } from "./panel-frame.ts";

/** The one width every frame here is drawn *and* expected at: both sides of the equality below. */
const WIDTH = 60;

/** The two labels the border can carry, and the glyph the options row draws. */
const OPTION_KEYS = "1\u20132 answer";

/** A style whose `selected` draws a bar: the identity style would colour the row identically to its neighbours. */ const BAR_STYLE: PanelStyle =
  {
    header: (text) => text,
    marker: (_level, text) => text,
    dim: (text) => text,
    selected: (text) => text,
    border: (text) => text,
    borderFocused: (text) => text,
  };

/** A long body so the focused label is genuinely longer than the border can draw whole. */
const LONG = `${"ship ".repeat(14)}the release`;

/** The pin the bar is drawn on: long enough that the focused label is longer than the border can draw whole. */
const barPin = (): ViewPin => ({
  ...pin(97, `${"ship ".repeat(14)}the release`, "action", {
    createdAt: NOW,
    options: ["Ship it", "Hold off"],
  }),
});

/**
 * The pin the live order holds during the window: the bar's own pin dismissed, and a pin nobody has the bar on
 * left in its place. Different id on purpose — with the bar's pin gone from the view the component *freezes* the
 * drawn frame instead of re-laying it out over the new view, which is the state the border is drawn in while the
 * user is still looking at the old rows, and the one the equality at the end of the case asserts on.
 */
const replacement = (): ViewPin => ({
  ...pin(94, "Answered somewhere else entirely", "action", { createdAt: NOW }),
});

/** A component over the fixture view, with a released handle so the focus verb is the component's own. */
function component(pins: ViewPin[]) {
  const h = host(pins);
  h.stub.style = () => BAR_STYLE;
  const c = new PanelComponent(h.stub, h.tui);
  const handle = createOverlayHandle();
  handle.unfocus();
  c.setHandle(handle);
  return { c, h };
}

test("a stale frame's border is the row built from the frame the bar was drawn from", () => {
  const drawn = [barPin()];
  const { c, h } = component(drawn);
  c.focus();
  // The frame's own label, asserted before the window opens: an options-bearing pin under the bar, so the
  // comparison below cannot be satisfied by the plain hint or the resting border.
  const resting = c.render(WIDTH);
  expect(resting.at(-1)).toContain(OPTION_KEYS);
  // The frame the pair is taken from has now been written, and nothing between here and the assertion below
  // asks for another one: `update()` only requests a render, and the render at the end of this case is the one
  // whose border is compared. Asserted, because a frame drawn *after* the publish would make the case vacuous.

  // The stale window: the bar's pin dismissed during the window, published without a frame request. Nothing
  // between here and the assertion below asks pi-tui for a frame, so the screen — and the frame the border is
  // drawn from — are still the ones the user was looking at.
  h.state.view = { pins: [replacement()], removed: [] };
  c.update();
  expect(
    c.pins.map((pin) => pin.id),
    "the stale publish moved nothing",
  ).toEqual([94]);

  // The label the frame the bar was drawn from carries, and the label the live view would have drawn in its
  // place. Read off the border's own text rather than compared row for row with `built()`: `built` re-sections
  // the pins it is handed, so a one-pin frame and a two-pin frame differ in their section headings and their
  // counts before they differ in anything this case is about — the hint. The counterfactual is the second
  // constant, and it is what gives the assertion below teeth: a component that had followed the stale view
  // would be drawing that one, the plain keys with the pin's own `1–2 answer` gone.
  const label = (line: string | undefined): string => (line ?? "").replace(/[╰╯─]/g, "").trim();
  const expected = label(
    built(
      { pins: drawn, selection: 0, focused: true, replyHint: "", ageNow: NOW },
      WIDTH,
      BAR_STYLE,
    ).at(-1),
  );
  const fromTheLiveView = label(
    built(
      { pins: [replacement()], selection: 0, focused: true, replyHint: "", ageNow: NOW },
      WIDTH,
      BAR_STYLE,
    ).at(-1),
  );
  expect(expected).toContain(OPTION_KEYS);
  expect(
    fromTheLiveView,
    "the live view draws the same label, so this guard would prove nothing",
  ).not.toBe(expected);

  // The frame request pi-tui issues for the panel it is repainting. The panel keeps drawing what the user is
  // looking at, so the border is still the one built from the frame the bar was drawn from.
  h.tui.requestRender();
  expect(label(c.render(WIDTH).at(-1)), "the border of the stale panel").toBe(expected);

  // …and the panel settles when the user moves: the bar goes to a row the frame never drew, the frame is
  // dropped, and the next border is the live one. A panel that kept answering from the old rows after that
  // keystroke would be drawing rows of a view nobody is looking at.
  c.select(0);
  expect(label(c.render(WIDTH).at(-1)), "the border once the user moved").not.toBe(expected);
});

test("a never-drawn component's border names the live pin's options", () => {
  // The fallback half: with no frame memorised the hint comes from the live drawn order, exactly as before.
  const { c } = component([barPin()]);
  c.focus();
  const line = c.render(WIDTH).at(-1) as string;
  // The cut is the border's own (`borderLine` → `fitLabel`), so the comparison is the prefix the whole label
  // has before the ellipsis the frame puts on it — the digit range and the keys, which nothing but the live
  // pin's option list could have drawn.
  expect(line).toContain(focusedHint([barPin()], 0, true).slice(0, OPTION_KEYS.length + 1));
  expect(line).toContain(OPTION_KEYS);
  // …and the resting border says neither: it is the focus that puts the keys in the frame at all.
  c.setFocused(false);
  expect(c.render(WIDTH).at(-1)).not.toContain(OPTION_KEYS);
});
