/**
 * The harness's own contract, asserted so the lockout tests cannot be vacuous (D7).
 *
 * Every focus assertion in this suite means something only because a handle's answer **is** pi's answer: in
 * pi-tui `OverlayHandle.isFocused()` is `focusedComponent === component` (`tui.js:467`) and `focus()` is a
 * no-op from an entry off the stack or one whose `visible()` answers false (`tui.js:430-436`). Those two facts
 * are why the bug this issue fixes was invisible to a suite whose fixture handle simply remembered a boolean:
 * a test could set the flag, ask for focus, and read back a grant pi had never made.
 *
 * So this file does not test the extension. It tests the *fixture*, in the only way that keeps the fixture
 * honest: it tries to construct each of the three impossible states and asserts that it cannot.
 */
import { expect, test } from "bun:test";

import type { Component } from "@earendil-works/pi-tui";

import { overlayHandleFrom, overlayModel } from "./panel-handle.ts";
import { createOverlayHandle, createStubTui } from "./ui-stubs.ts";

const newComponent = (): Component => ({ render: () => [], invalidate: () => {} });

test("a handle cannot report focus while pi's cell says otherwise", () => {
  const tui = createStubTui();
  const component = newComponent();
  const handle = tui.showOverlay(component);
  expect([handle.isFocused(), tui.getFocusedComponent()]).toEqual([false, tui.editorComponent]);
  handle.focus();
  expect([handle.isFocused(), tui.getFocusedComponent()]).toEqual([true, component]);
  // Move pi's cell the way pi itself would (a click elsewhere, an overlay pop) and the handle's answer moves
  // with it: there is one cell, so there is one answer.
  tui.setFocus(tui.editorComponent as unknown as Component);
  expect(handle.isFocused()).toBe(false);
});

test("a handle cannot grant focus to an entry pi has popped", () => {
  const component = newComponent();
  const model = overlayModel(() => true);
  const { handle, held } = overlayHandleFrom(model, component);
  handle.focus();
  expect(held()).toBe(true);
  model.pop();
  handle.focus();
  expect(held(), "the fixture granted a focus pi's stack would have refused").toBe(false);
});

test("a handle cannot grant focus to an entry pi is not drawing", () => {
  const component = newComponent();
  // The owner's own `visible()`, which is what pi asks: `false` is "not drawn", and the ask is dropped.
  const model = overlayModel(() => false);
  const { handle, held } = overlayHandleFrom(model, component);
  handle.focus();
  expect(held(), "the fixture granted a focus to an overlay pi would not draw").toBe(false);
  expect(handle.isFocused()).toBe(false);
});

test("hiding an overlay pi had focused moves the focus, as pi's own setHidden does", () => {
  const component = newComponent();
  const model = overlayModel(() => true);
  const { handle, held } = overlayHandleFrom(model, component);
  handle.focus();
  handle.setHidden(true);
  expect([held(), handle.isHidden()]).toEqual([false, true]);
});

test("the component-level handle stays released until asked, and refuses only when hidden", () => {
  // `createOverlayHandle` is the fixture for a component test with no overlay on any stack. It still starts
  // released (a `nonCapturing` show never took the keyboard) and still drops the ask from a hidden entry —
  // the two guards that make a false "the panel let go" assertion impossible.
  const handle = createOverlayHandle();
  expect(handle.isFocused()).toBe(false);
  handle.focus();
  expect(handle.isFocused()).toBe(true);
  handle.setHidden(true);
  expect(handle.isFocused()).toBe(false);
  handle.focus();
  expect(handle.isFocused(), "a hidden handle granted a focus").toBe(false);
  handle.setHidden(false);
  handle.focus();
  expect(handle.isFocused()).toBe(true);
  handle.hide();
  expect([handle.isHidden(), handle.isFocused()]).toEqual([true, false]);
});

test("the stub TUI's focus cell is one place, written only by setFocus", () => {
  const tui = createStubTui();
  const a = newComponent();
  const b = newComponent();
  tui.setFocus(a);
  expect(tui.getFocusedComponent()).toBe(a);
  tui.setFocus(b);
  expect(tui.getFocusedComponent()).toBe(b);
  tui.setFocus(null);
  expect(tui.getFocusedComponent()).toBeNull();
  // An overlay's handle is the only other writer, and it writes the same cell (case one above).
  const handle = tui.showOverlay(a);
  handle.focus();
  expect(tui.getFocusedComponent()).toBe(a);
  handle.unfocus();
  expect(tui.getFocusedComponent()).toBe(tui.editorComponent);
});
