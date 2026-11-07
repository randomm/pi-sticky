/**
 * The keys act on the pin the **bar was drawn on**, never on whatever the live drawn order says now.
 *
 * `dispatchPanelKey` used to read `target.pins[target.selection]`, and `target.pins` was the *live* drawn
 * order — `PanelComponent.#drawn()` through the memo in `PanelMemory.sectionsOf` (`panel-frame-cache.ts`) —
 * while the bar the user aimed with is drawn from the memorised `PanelFrame.pins`/`.selection` that
 * `drawFrame` wrote (`panel-frame-draw.ts`). `PanelComponent.update()` drops that frame and only asks for a
 * render, so between the drop and the next frame request the keys resolved against a freshly re-sorted or
 * shortened order: `d` dismissed a pin nobody had the bar on, and the entry it appends reconstruct re-applies
 * session-wide. The frame-derived pair `PanelComponent.drawnKeys()` now answers every acting key, and a frame
 * whose row has no live pin any more is refused rather than guessed at.
 *
 * **The repro, and the trap in it.** Both cases below publish the stale view as a **fresh `ViewPin[]` array**
 * and call `update()` with **no `render()`** in between, and never `focus()`. Each step carries its weight:
 * an in-place mutation keeps the array's identity, `sectionsOf` memoises on that identity and nothing
 * re-sorts, so the published order would be the drawn one and the case would pass vacuously; a `render()`
 * writes a fresh frame and closes the window; and `focusPanel` runs `resetSelection()`, which drops the frame
 * and puts the bar back on the top-ranked row (`panel-component-focus.ts`) — again closing it. The REGROUP
 * fixture carries its `group` on a pin that is *not* the view's best-ranked pin, because a group section only
 * leads when its best pin is the best pin of the whole view (`compareSections`, `panel-sections.ts`) and an
 * already-ranked array is short-circuited by `alreadyDrawn` (`pin-order.ts`), so an ordered fixture moves
 * nothing.
 *
 * The `focusedHint` guard at the bottom is a **regression** guard, not the fix: it is D4's, and it fails
 * without the implementation for the same reason the keys do — the expectation names the frame the bar was
 * drawn from, and a component that drew it from the live order disagrees row for row.
 */
import { expect, test } from "bun:test";

import { PanelComponent } from "../src/panel-component.ts";
import { HINT } from "../src/panel-lines.ts";
import { optionHint } from "../src/panel-option-hint.ts";
import type { PanelStyle } from "../src/render.ts";
import type { PinLevel, ViewPin } from "../src/types.ts";
import { NOW, pin } from "./fixtures.ts";
import { createOverlayHandle } from "./harness.ts";
import { host } from "./panel-component-host.ts";
import { built } from "./panel-frame.ts";

/** The width every frame in this file is drawn and expected at — one constant, both sides of D4's equality. */
const WIDTH = 60;

/** The keys this file drives: the three that act on a pin, and the two that move the bar. */
const DISMISS = "d";
const REPLY = "\r";
const DOWN = "j";
const UP = "k";
/** The option the digit key answers, on the pin the bar is drawn on. */
const OPTION = "Ship it";

/** Colours that draw the bar: the identity style's `selected` would draw its row byte-identically. */
const BAR_STYLE: PanelStyle = {
  header: (text) => text,
  marker: (_level, text) => text,
  dim: (text) => text,
  selected: (text) => `${String.fromCharCode(0x1b)}[44m${text}`,
  border: (text) => text,
  borderFocused: (text) => text,
};

/** The selection marker the drawer puts in the marker column of the bar's row (#70 decision 2). */
const MARK = String.fromCodePoint(0x203a);

/** One pin of the fixture; `extra` carries the `group` a REGROUP publish and the options a digit need. */
const at = (id: number, text: string, level: PinLevel = "action", extra = {}): ViewPin => ({
  ...pin(id, text, level, { createdAt: NOW, ...extra }),
});

/** The same pin with the options every row of the fixture carries. */
const withOptions = (id: number, text: string, level: PinLevel = "action", extra = {}): ViewPin =>
  at(id, text, level, { options: [OPTION, "Hold off"], ...extra });

/** A component over three same-level `action` pins — ids 100, 97, 94, ranked newest id first. */
function component(pins: ViewPin[]) {
  const h = host(pins);
  h.stub.style = () => BAR_STYLE;
  const c = new PanelComponent(h.stub, h.tui);
  const handle = createOverlayHandle();
  handle.unfocus();
  c.setHandle(handle);
  return { c, h };
}

/**
 * The three fixture pins, drawn `100, 97, 94` — #100 a `warning`, so the two same-level `action` pins below
 * it can be re-ranked by a reply stamp. Every pin offers options, so a digit always has an answer to give and
 * the border's hint names the digit range.
 */
function view3(): ViewPin[] {
  return [
    withOptions(100, "First", "warning"),
    withOptions(97, "Second"),
    withOptions(94, "Third"),
  ];
}

/**
 * A REGROUP stale view: the same three ids in a genuinely different flat order — `100, 94, 97`.
 *
 * `panelSections` ranks its sections by their **best** pin (`compareSections`: level rank, then best id), so a
 * group only reorders the list when it takes the best pin of the level section it leaves. Here #100 and #94
 * share the group `Now` and #97 is left alone in the `action` section: the group leads on its best (`warning`)
 * pin and draws #94 second, so the row the bar was drawn on now names #94 — which is precisely what the keys
 * must not follow. A group on **one** pin, or on every pin, leaves the order alone (the sections still rank on
 * the same level and the same best id), and so does a plain re-ordering of the array, which `comparePins`
 * sorts back (`alreadyDrawn`, `pin-order.ts`) — the trap the first draft of this file fell into.
 */
function regrouped(): ViewPin[] {
  return [
    withOptions(100, "First", "warning", { group: "Now" }),
    withOptions(97, "Second"),
    withOptions(94, "Third", "action", { group: "Now" }),
  ];
}

/** The ids the drawn rows name, in the order the frame draws them. */
function drawnIds(c: PanelComponent): number[] {
  return c.render(WIDTH).flatMap((line) => {
    const match = /#(\d+) /.exec(line);
    return match === null ? [] : [Number(match[1])];
  });
}

/** The id on the row the bar sits on. Asserted to exist: the keys below address a pin. */
function idUnderBar(c: PanelComponent): number {
  const row = c.render(WIDTH).find((line) => line.includes(MARK));
  expect(row, "the frame drew no bar").toBeDefined();
  const match = /#(\d+)/.exec((row as string).slice((row as string).indexOf(MARK)));
  expect(match, `no id beside the bar in ${JSON.stringify(row)}`).not.toBeNull();
  return Number((match as RegExpExecArray)[1]);
}
/**
 The stale window's **frozen frame**, and what the panel is drawn from while it stands.
 *
 `PanelComponent.update()` lets the frame whose bar the view dropped stand where it is (a **frozen** frame,
 `PanelMemory.frozen`, `panel-frame-cache.ts`), and `drawFrame` hands those same lines back on every frame
 request (`panel-frame-draw.ts`). The frame is the panel the user is reading, so everything read off it — the
 keys' pair and this file's subject, the bottom border's option hint — is read from the frame and not from the
 view that moved under it: `panel-lines.ts` composes the border from `focusedHint(content.pins,
 content.selection, true)` over the frame's own pair, and a component that built it from the live order
 disagrees row for row. These are D4's regression guards.
 */

/**
 * The stale window, opened: render at the bar, publish a fresh array, `update()`, and **no** `render()`.
 *
 * Returns the component and the host with the frame of `at` still in the cache and the live view replaced.
 */
function stale(pins: ViewPin[], selection: number, staleView: ViewPin[]) {
  const { c, h } = component(pins);
  c.focus();
  c.select(selection);
  const underBar = idUnderBar(c);
  h.state.view = { pins: staleView, removed: [] };
  c.update();
  return { c, h, underBar };
}

test("the border of a stale window is the one drawn from the frame the bar was drawn from (D4)", () => {
  // The regression guard on `focusedHint`: `buildPanelLines` composes the bottom border from
  // `focusedHint(content.pins, content.selection, true)` (`panel-lines.ts`), and both come from the frame.
  // The expectation is the row built from the DRAWN pair by the very builder the component uses, compared
  // row for row — not a substring, not a literal.
  // The bar on #97 while the live view has dropped it: the frame is frozen over that publish, which is the
  // state the user is actually looking at — the rows pi-tui last drew, with the marker where they put it. (A
  // REGROUP keeps the bar's pin in the view, and there the panel is free to be re-laid out over the new order;
  // this guard is about the frame the border was drawn from, and only a dropped bar holds it in place.)
  const drawn = view3();
  const { c } = stale(drawn, 1, [at(100, "First"), at(94, "Third")]);
  const expected = built(
    { pins: drawn, selection: 1, focused: true, replyHint: "", ageNow: NOW },
    WIDTH,
    BAR_STYLE,
  ).at(-1);
  expect(c.render(WIDTH).at(-1)).toBe(expected);
  // …and the label is the option hint of the pin the bar was drawn on, so the row above is not the plain one
  // by accident. `optionHint` rather than `focusedHint`: the frame is drawn *focused*, which is what the panel
  // is while the user reads it, and `focusedHint`'s `true` is what that same frame hands the builder.
  // The label is cut by the border at this width, so the hint is asserted as the row contains it — and the
  // unfocused frame is the counterfactual: without the bar on an options-bearing pin the border says the plain
  // keys instead, so the row above is not that one by accident.
  expect(expected).toContain(optionHint(2).slice(0, optionHint(2).indexOf(" · ")));
  expect(expected).not.toBe(
    built(
      { pins: drawn, selection: 1, focused: false, replyHint: HINT, ageNow: NOW },
      WIDTH,
      BAR_STYLE,
    ).at(-1),
  );
});
