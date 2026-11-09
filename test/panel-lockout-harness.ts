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
        // The registration hands back an unsubscribe, exactly as pi's contract does — the three containment
        // files never take it back off (the hatch's own unsubscribe is asserted in
        // `panel-escape-hatch.test.ts`), so it is recorded and left alone rather than stubbed.
        onTerminalInput: (h: (d: string) => Answer) => {
          listeners.push(h);
          return () => {};
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

/**
 * A handle built the way pi-tui's is: `isFocused()` and `unfocus()` are both readings of pi's one focus cell
 * (`tui.js:467`), so the handle cannot report a keyboard pi's cell denies. Only the members these cases read are
 * built — the two focus readings, and the `focus()` ask that writes the cell — because a fixture member nothing
 * asks is a count, not a fact (`ui-stubs.ts`'s `showOverlay` is the handle for a case that needs the whole one).
 */
export function piHandle(component: Component, tui: StubTui): OverlayHandle {
  const focused = () => tui.getFocusedComponent() === component;
  return {
    isFocused: focused,
    unfocus: () => {
      if (focused()) tui.setFocus(tui.editorComponent);
    },
    // The ask `c.focus()` reaches: it writes pi's cell, and it is the same cell `isFocused()` reads, so a case
    // cannot leave the two disagreeing by construction — only by moving the component's flag afterwards, which
    // is the disagreement these cases are about.
    focus: () => {
      tui.setFocus(component);
    },
  } as unknown as OverlayHandle;
}

/**
 * A handle whose release is hostile: the one member the containment cases need to throw.
 *
 * Built the way pi-tui's is in every other respect (see `piHandle`): the two members are one focus cell read two
 * ways, so a handle that reported a keyboard pi's cell denies is not constructible here. Unlike pi-tui's own
 * release — which returns the moment the component is not the focused one (`tui.js:438-441`) — this one throws
 * whatever the cell says, because a release that returns early is a release that was never asked and the
 * containment never runs. Every ask throws — the hatch and the reconciliation each ask the handle twice, and a
 * fixture that let the second ask succeed would hide an uncontained second release.
 */
export function hostileUnfocus(component: Component, tui: StubTui): OverlayHandle {
  const focused = () => tui.getFocusedComponent() === component;
  return {
    isFocused: focused,
    // The release always throws — there is no "succeeds after a first failure" branch, because every case that
    // arms this handle wants the throw and none ever reached a fall-through (pi-tui's own idempotent early
    // return, `tui.js:438-441`, is not what these cases model). So `always` does not choose *whether* it throws,
    // it only documents whether the throw is meant to survive the **repeated** asks a containment makes: the
    // hatch and the reconciliation each ask the handle twice, and a case must know its fixture throws both times
    // rather than quietly succeeding on the second and hiding an uncontained release.
    unfocus: () => {
      throw new Error("the handle's unfocus threw");
    },
    // The ask these cases reach by calling `c.focus()`: it writes pi's cell, which is what puts the panel in the
    // state the reconciliation is then asked about. It is not a fairytale grant — the cell is the same one
    // `isFocused()` reads, so a case that wants a refused ask uses `panel-handle.ts`'s model instead.
    focus: () => {
      tui.setFocus(component);
    },
  } as unknown as OverlayHandle;
}
