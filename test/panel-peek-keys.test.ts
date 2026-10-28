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
import type { PanelHost } from "../src/panel-host.ts";
import type { PanelMode } from "../src/panel-mode.ts";
import { createOverlayHandle } from "./harness.ts";
import { host, pins } from "./panel-component-host.ts";

/** A component over a host that reports `mode` (or no state at all), with the handle already released. */
function at(
  mode: PanelMode,
  texts: string[] = ["Decide X", "Watch out"],
  overrides: Partial<PanelHost> = {},
) {
  const h = host(pins(...texts));
  h.stub.mode = () => mode;
  // Replaced on the stub *before* the component is built: the component keeps the host object and reads its
  // members off it, so a case that wants one to throw patches this, not the `state` it records into.
  Object.assign(h.stub, overrides);
  const c = new PanelComponent(h.stub, h.tui);
  const handle = createOverlayHandle();
  handle.unfocus();
  c.setHandle(handle);
  /** Replace one host member after the fact — for the rare case that must observe it rather than record it. */
  const patch = (member: Partial<PanelHost>) => Object.assign(h.stub, member);
  return { c, patch, ...h };
}

test("a keystroke into the peek hands the focus back instead of acting on a row", () => {
  const { c, state } = at("peek");
  c.focus();
  const dismissalsBefore = state.dismissals.length;

  // `d` is the panel's dismiss key and Enter its reply key; neither has a row in a three-frame peek. The
  // digits are the panel's option keys and have no row either — a peek draws no options and no bar.
  c.handleInput?.("d");
  c.handleInput?.("\r");
  c.handleInput?.("1");
  c.handleInput?.("\x1b[B");

  expect(state.dismissals).toHaveLength(dismissalsBefore);
  expect(state.replies).toEqual([]);
  // Every one of them ended the interaction, which is the whole answer a peek can give.
  expect(state.unfocusCalls).toBe(4);
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

test("a key whose host throws still ends the interaction", () => {
  // `containKey` is what keeps a throwing host out of pi-tui's key path, and a notice is only half the
  // answer: a panel the user opened with the focus key would otherwise sit there focused, with the escape
  // routes (`Escape`, `Enter`, a keystroke into a peek) all reachable only through the member that just
  // threw. So the catch ends the interaction by the same `unfocus()` a refused key takes.
  const { c, state } = at("open", ["Decide X", "Watch out"], {
    dismiss: () => {
      throw new Error("host session is gone");
    },
  });
  c.focus();

  c.handleInput?.("d");

  expect(c.isFocused()).toBe(false);
  // The ending reached the owner — which is what puts the pins back on the rail — and no pin was dismissed.
  expect(state.unfocusCalls).toBe(1);
  expect(state.dismissals).toEqual([]);
});

test("a key whose host throws on the notice too still ends the interaction", () => {
  // The report is best-effort and the ending is not: `notify` belongs to the same host whose `dismiss` just
  // threw, so a session whose ui has gone fails on the report as well — and a `notify` that escaped the
  // catch would strand the panel focused *and* put the throw in pi's key path, the two things the guard is
  // here to prevent. Same shape as the tick guard containing its own report (`panel-tick-guard.ts`).
  const { c, state } = at("open", ["Decide X", "Watch out"], {
    dismiss: () => {
      throw new Error("host session is gone");
    },
    notify: () => {
      throw new Error("ui context is gone");
    },
  });
  c.focus();

  // Nothing escapes `handleInput` — pi-tui has no `try` of its own around this call.
  expect(() => c.handleInput?.("d")).not.toThrow();

  expect(c.isFocused()).toBe(false);
  expect(state.unfocusCalls).toBe(1);
  expect(state.dismissals).toEqual([]);
});

test("a key whose host throws is reported once, in the words the guard spells", () => {
  // The notice is the user's only evidence that the key they pressed was refused rather than obeyed, and
  // until now no test read it: `containKey` swallows the throw, so the sole observable was this line.
  const { c, patch } = at("open", ["Decide X", "Watch out"], {
    dismiss: () => {
      throw new Error("host session is gone");
    },
  });
  const notices: string[] = [];
  patch({ notify: (message, type) => void notices.push(`${type}:${message}`) });
  c.focus();
  c.handleInput?.("d");
  expect(notices).toEqual(["warning:A panel key could not be handled."]);
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
