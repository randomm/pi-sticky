/**
 * The peek refuses keys, and the open panel keeps accepting them (`src/panel-input.ts`).
 *
 * `dispatchPanelKey` gates on the host's *state*, not only on its visibility: a peek is three rows with no
 * bar, so there is nothing for `d`, Enter or an arrow to address, and the only honest answer to a keystroke
 * that reaches one is to hand the focus back to the editor. Both halves are asserted here because the gate
 * has two ways to go wrong — a peek that dismisses a pin the user never saw a bar on, and a host with no
 * mode cell (`undefined`) refusing the keys of an ordinary open panel.
 *
 * The component is driven with the focus pi-tui would have given it, and the host's `unfocus` is counted:
 * that member is the owner's only notice that the interaction ended, so the assertion is about the round
 * trip rather than about a flag on the component.
 */
import { expect, test } from "bun:test";

import { PanelComponent } from "../src/panel-component.ts";
import type { PanelMode } from "../src/panel-mode.ts";
import { createOverlayHandle } from "./harness.ts";
import { host, pins } from "./panel-component-host.ts";

/** A component over a host that reports `mode` (or no state at all), with the handle already released. */
function at(mode: PanelMode, texts: string[] = ["Decide X", "Watch out"]) {
  const h = host(pins(...texts));
  h.stub.mode = () => mode;
  const c = new PanelComponent(h.stub, h.tui);
  const handle = createOverlayHandle();
  handle.unfocus();
  c.setHandle(handle);
  return { c, ...h };
}

test("a keystroke into the peek hands the focus back instead of acting on a row", () => {
  const { c, state } = at("peek");
  c.focus();
  const dismissalsBefore = state.dismissals.length;

  // `d` is the panel's dismiss key and Enter its reply key; neither has a row in a three-frame peek.
  c.handleInput?.("d");
  c.handleInput?.("\r");
  c.handleInput?.("\x1b[B");

  expect(state.dismissals).toHaveLength(dismissalsBefore);
  expect(state.replies).toEqual([]);
  // Every one of them ended the interaction, which is the whole answer a peek can give.
  expect(state.unfocusCalls).toBe(3);
  expect(c.isFocused()).toBe(false);
});

test("the open panel still takes its keys when the host reports its state", () => {
  const { c, state } = at("open");
  c.focus();
  c.handleInput?.("d");
  // The bar starts on the last pin (`panel-component.ts` clamps it there), and `d` addressed it — the
  // gate let the key through.
  expect(state.dismissals).toEqual([2]);
  // …and dismissed without ending the interaction, so the bar stays where the user left it.
  expect(state.unfocusCalls).toBe(0);
});

test("a hidden panel refuses its keys whatever the mode says", () => {
  // `isVisible()` is the gate in front of the mode's one, and a hidden panel is not on screen at all.
  const { c, state } = at("open");
  state.visible = false;
  c.focus();
  c.handleInput?.("d");
  expect(state.dismissals).toEqual([]);
  expect(state.unfocusCalls).toBe(1);
});
