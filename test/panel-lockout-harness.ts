/**
 * The shared harness for the two issue #98 containment files: the pieces a keyboard case needs that
 * `panel-handle.ts` and `ui-stubs.ts` do not already give it.
 *
 * Both files drive the same two things — pi's `onTerminalInput` listener contract, and a pi-shaped overlay
 * handle whose release can be made hostile — so both read them from here rather than each carrying a copy that
 * can quietly drift from the other. As in `panel-handle.ts`, pi's focus is **one cell read two ways**:
 * `isFocused()` and `unfocus()` are both readings of the stub TUI's `getFocusedComponent()` (`tui.js:467`), so a
 * handle that reported a keyboard pi's cell denies is not constructible here.
 */
import type { Component, OverlayHandle } from "@earendil-works/pi-tui";

import type { PanelComponent } from "../src/panel-component.ts";
import type { HatchKeyboard } from "../src/panel-escape-hatch.ts";
import { createGrantWindow } from "../src/panel-grant-window.ts";
import type { KeyboardCells } from "../src/panel-owner-keyboard.ts";
import type { StubTui } from "./ui-stubs.ts";

/** The keystroke answer pi's own listener contract accepts. */
export type Answer = { consume: true } | undefined;

/** Every byte the hatch answers: Escape, and Ctrl+C in each of its three terminal spellings (`panel-keys.ts`). */
export const RELEASE_KEYS = ["\x1b", "\x03", "\x1b[99;5u", "\x1b[27;5;99~"];

/**
 * A ui that registers listeners the way pi-tui runs them.
 *
 * The modelled fact is an absence: `handleTerminalInput` calls `listener(current)` and reads `result?.consume`
 * with no try/catch anywhere above it, so a listener that throws takes the whole input path with it.
 */
export function terminal() {
  const listeners: ((data: string) => Answer)[] = [];
  return {
    ctx: {
      ui: {
        onTerminalInput: (h: (d: string) => Answer) => {
          listeners.push(h);
          return () => {
            const index = listeners.indexOf(h);
            if (index >= 0) listeners.splice(index, 1);
          };
        },
      },
    },
    press: (data: string) => listeners.map((h) => h(data)),
  };
}

/** The cells the owner's reconciliation reads, over a component and a TUI the test owns. */
export function cellsOf(component: PanelComponent, tui: StubTui): KeyboardCells {
  return { component: () => component, tui: () => tui, grants: createGrantWindow() };
}

/** `ownerKeyboard`'s pair, spelled the same way (`panel-owner-keyboard.ts`). */
export function keyboardOf(c: PanelComponent): HatchKeyboard | undefined {
  const handle = c.handle();
  return handle ? { isFocused: () => handle.isFocused(), release: () => c.unfocus() } : undefined;
}

const noop = (): void => {};

/**
 * A handle built the way pi-tui's is: `isFocused()` and `unfocus()` are both readings of pi's one focus cell
 * (`tui.js:467`), so the handle cannot report a keyboard pi's cell denies. `beforeFocus` and
 * `beforeGrantCheck` are the seams that make the *ask* hostile — pi reads the entry's visibility inside the ask
 * (`tui.js:430-436`), and that callback is the owner's, so it is host code that can throw out of it.
 */
export function piHandle(
  component: Component,
  tui: StubTui,
  beforeFocus: () => void = noop,
  beforeGrantCheck: () => void = noop,
): OverlayHandle {
  return {
    isFocused: () => tui.getFocusedComponent() === component,
    unfocus: () => {
      if (tui.getFocusedComponent() === component) tui.setFocus(tui.editorComponent);
    },
    focus: () => {
      beforeFocus();
      beforeGrantCheck();
      tui.setFocus(component);
    },
    hide: () => {},
    setHidden: () => {},
    isHidden: () => false,
    getBounds: () => undefined,
  } as unknown as OverlayHandle;
}

/**
 * `piHandle` with the release hostile: the one member the containment cases need to throw.
 *
 * Unlike pi-tui's own — which returns the moment the component is not the focused one (`tui.js:438-441`) — this
 * one throws whatever the cell says, because a release that returns early is a release that was never asked and
 * the containment never runs. `always` is what makes the difference visible: a case that wants pi's idempotence
 * after the first failure leaves it out, and reads the second ask as the honest one.
 */
export function hostileUnfocus(
  component: Component,
  tui: StubTui,
  always?: () => boolean,
): OverlayHandle {
  const handle = piHandle(component, tui);
  let asked = false;
  handle.unfocus = () => {
    if (!asked || always?.()) throw new Error("the handle's unfocus threw");
    asked = true;
    if (tui.getFocusedComponent() === component) tui.setFocus(tui.editorComponent);
  };
  return handle;
}
