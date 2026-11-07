/**
 The two states in which a panel key is **not** refused, and what it does instead.
 *
 `panel-stale-frame-keys.test.ts` drives the stale window — the frame the user was shown while the view moved
 under it — and the keys that answer it. This file drives the two neighbours of that window, where no frame
 is standing in the way: a component pi-tui has **never rendered** (`drawnKeys()` reports `hasFrame` false and
 the keys fall back to the live pins, `panel-component.ts`), and a panel the host has **hidden or put into the
 peek**, where `panel-input.ts`'s gate and its Escape branch hand the keyboard back before any acting pin is
 resolved — refused or not. Both are the counterfactuals that stop "refuse everything" from passing.
 */

import { expect, test } from "bun:test";

import { PanelComponent } from "../src/panel-component.ts";
import type { PanelStyle } from "../src/render.ts";
import type { PinLevel, ViewPin } from "../src/types.ts";
import { NOW, pin } from "./fixtures.ts";
import { createOverlayHandle } from "./harness.ts";
import { host } from "./panel-component-host.ts";

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
test("a never-drawn component still acts on the live pins", () => {
  // The fallback half of the rule: `focusPanel` only asks for a render, so the first keystroke after the
  // focus key arrives while the component has never memorised a frame. It must keep working exactly as it
  // did — which is also what stops "refuse everything" from passing this file.
  const { c, h } = component(view3());
  c.focus();
  expect(drawnIds(c), "the component drew before pi-tui asked").not.toHaveLength(0);
  const underBar = idUnderBar(c);
  c.handleInput(DISMISS);
  expect(h.state.dismissals).toEqual([underBar]);
});

test("a fresh frame: after an explicit render the same key is not refused", () => {
  // The control for the SHRUNK case above — the same publish, the same key, with a `render()` between the
  // two. The frame now describes the live view, so the key answers the pin under its own bar.
  const { c, h } = component(view3());
  c.focus();
  c.select(1);
  const underBar = idUnderBar(c);
  h.state.view = { pins: [at(100, "First"), at(94, "Third")], removed: [] };
  // The user, and not the clock: the frame is frozen against a publish that dropped the bar's pin, and the one
  // thing that ends a freeze is the user acting on the panel they were shown. `unfocus`/`focus` is how the panel
  // is left and taken up again — `focusPanel` drops the frame and re-homes the bar on the best-ranked row
  // (`panel-component-focus.ts`) — so the frame asserted on below is written over the view that answered.
  // `c.render()` alone would not settle it: the panel is still frozen, and answering from the frozen frame is
  // what the freeze is for.
  c.unfocus();
  c.focus();
  // The bar is where re-focusing put it, on the view that survived — the best-ranked of the two, not whatever
  // row the frozen frame's marker sat on.
  expect(
    c.pins.map((pin) => pin.id),
    "the settled panel draws the view that answered",
  ).toEqual([100, 94]);
  const settled = c.pins[c.selection]?.id;
  expect(settled, "the settled panel drew no bar on the row it selected").toBeDefined();
  expect(idUnderBar(c), "the redraw left no bar on the row it drew").toBe(settled as number);
  // The key answers the row the bar is on now — the settled frame's own bar, not the pin the frozen frame had
  // marked (`underBar`, which is the row the user was looking at *before* they left the panel).
  c.handleInput(DISMISS);
  expect(h.state.dismissals).toEqual([settled as number]);
});

test("the gate and Escape still run first, with their current effect", () => {
  // A hidden panel and a peek hand the keyboard back on every key, refused or not (`panel-input.ts`'s gate
  // and Escape branch, both before any acting pin is resolved).
  for (const state of [{ visible: false }, { mode: "peek" }] as const) {
    for (const key of [DISMISS, REPLY, "1", DOWN, "escape"]) {
      const { c, h } = component(view3());
      c.focus();
      c.select(1);
      idUnderBar(c);
      h.state.view = { pins: [at(100, "First"), at(94, "Third")], removed: [] };
      c.update(); // a stale frame too: the gate must answer before the refusal is even considered
      Object.assign(h.state, state);
      const renders = h.state.renders;
      c.handleInput(key);
      expect(h.state.dismissals, `${key} into ${JSON.stringify(state)} dismissed`).toEqual([]);
      expect(h.state.unfocusCalls, `${key} into ${JSON.stringify(state)} was not handed back`).toBe(
        1,
      );
      expect(h.state.renders, `${key} did not ask for the settled frame`).toBe(renders + 1);
    }
  }
});
