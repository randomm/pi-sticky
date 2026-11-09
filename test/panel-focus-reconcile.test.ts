/**
 * Reconciling the extension's focus flag with pi's focused component (D4, D5, D7).
 *
 * `PanelComponent.isFocused()` is a flag this extension set. pi decides where a keystroke goes, and it decides
 * it in exactly one place — pi-tui routes every byte to its own `focusedComponent`. The lockout is what the two
 * answers look like when they disagree:
 *
 * - **flag down, pi up** — the swallow-everything case. The panel answers no keys and no verb of the
 *   extension's can release it, because every release is gated on a flag that already says released.
 * - **flag up, pi down** — a modal the extension believes in and the terminal does not: the dispatcher keeps
 *   answering keys for a frame pi is not routing to, and the user's Escape goes nowhere.
 *
 * Both halves are asserted here against a harness in which a handle's answer *is* pi's cell, so neither is
 * constructible except as a real disagreement: `ui-stubs.ts`'s `showOverlay` hands back a handle that reads
 * and writes the same cell `getFocusedComponent()` answers, and `panel-handle.ts`'s model does the same for
 * the keyboard tests. A fixture whose handle and focus cell were two separate beliefs could not test this at
 * all — it would only ever assert what it had just set.
 *
 * The per-frame rule is asserted too, and it is a *cost* rule with a correctness consequence: `visible()` runs
 * on every composite, so the frame path asks nothing while the flag is down. And the grant guard is the one
 * thing that keeps the ask from releasing the keyboard it is in the middle of making: pi-tui calls the
 * overlay's own `visible()` *inside* `focus()` (`tui.js:430-436`), where pi's cell still holds the previous
 * keystroke's owner.
 */
import { expect, test } from "bun:test";

import type { Component, TUI } from "@earendil-works/pi-tui";

import { piCanAnswer, reconcileFocus } from "../src/panel-focus-reconcile.ts";
import { createStubTui } from "./ui-stubs.ts";

/** A component the stub TUI can hold, with its identity intact. */
const component: Component = { render: () => [], invalidate: () => {} };

/** A target whose verdict and release are both recorded. */
function target(granted: boolean) {
  const calls: string[] = [];
  return {
    calls,
    target: { granted: () => granted, release: () => void calls.push("release") },
  };
}

test("pi's answer stands: a panel pi routes to keeps the keyboard", () => {
  const tui = createStubTui();
  tui.setFocus(component);
  const t = target(true);
  expect(reconcileFocus(tui, t.target)).toBe(true);
  expect(t.calls).toEqual([]);
});

test("a panel pi does not route to is released, and the release is the component's own ending", () => {
  const tui = createStubTui();
  const t = target(false);
  expect(reconcileFocus(tui, t.target)).toBe(true);
  expect(t.calls).toEqual(["release"]);
});

test("a TUI that cannot answer is a skip, never a verdict of 'not focused'", () => {
  // The distinction is the whole of the safe default: an unavailable reader must not take the keyboard from a
  // panel pi really is routing to, and so the answer is "nothing was asked", reported to the caller.
  const t = target(false);
  expect(reconcileFocus(undefined, t.target)).toBe(false);
  expect(t.calls).toEqual([]);
  // A TUI without the reader at all: pi-tui declares `getFocusedComponent()` on `TuiBase`, not on the `TUI`
  // interface the overlay factory is handed, so "this TUI cannot answer" is a state the extension reaches and
  // must never read as a verdict.
  const mute = {} as unknown as TUI;
  const t2 = target(false);
  expect(reconcileFocus(mute, t2.target)).toBe(false);
  expect(t2.calls).toEqual([]);
  expect(piCanAnswer(mute)).toBe(false);
  expect(piCanAnswer(createStubTui())).toBe(true);
});

test("the verdict is read at the moment of the answer, not captured on the way in", () => {
  // pi-tui reaches the overlay's `visible()` *inside* the `focus()` ask, and the harness models that; a
  // reconciliation that read the grant before the ask would report the previous keystroke's owner.
  const tui = createStubTui();
  let granted = false;
  const calls: string[] = [];
  const started = reconcileFocus(tui, {
    granted: () => granted,
    release: () => void calls.push("release"),
  });
  expect([started, calls]).toEqual([true, ["release"]]);
  // The same question, once pi has granted it, is answered the other way.
  tui.setFocus(component);
  granted = true;
  expect(reconcileFocus(tui, { granted: () => granted, release: () => calls.push("again") })).toBe(
    true,
  );
  expect(calls).toEqual(["release"]);
});

test("the answer is pi's cell read through the handle, and the two cannot disagree in this harness", () => {
  // The handle `showOverlay` hands back writes the same cell `getFocusedComponent()` reads (tui.js:467:
  // `focusedComponent === component`). A fixture where those were two variables could not express the
  // disagreement this module exists to detect, so the construction is the assertion.
  const tui = createStubTui();
  const handle = tui.showOverlay(component);
  // The stub TUI's cell starts on its editor, which is what `nonCapturing` shows leaves: shown, unfocused.
  expect([handle.isFocused(), tui.getFocusedComponent()]).toEqual([false, tui.editorComponent]);
  handle.focus();
  expect([handle.isFocused(), tui.getFocusedComponent() === component]).toEqual([true, true]);
  const t = target(handle.isFocused());
  expect(reconcileFocus(tui, t.target)).toBe(true);
  expect(t.calls).toEqual([]);
  handle.unfocus();
  expect(
    reconcileFocus(tui, { granted: () => handle.isFocused(), release: () => t.calls.push("r") }),
  ).toBe(true);
  expect(t.calls).toEqual(["r"]);
});
