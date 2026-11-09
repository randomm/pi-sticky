/**
 * A panel's component, with a keyboard this file can read — and the one place that models pi's overlay stack.
 *
 * The keyboard tests need three things the boot's recorder cannot answer for, so they live beside each other
 * here rather than in `panel-lifecycle-fixture.ts` (which is at the file-size limit): a handle the test holds,
 * the component of the overlay *on screen now* reached through it, and — since the input lockout — an answer
 * to "what does pi believe about focus" that is not the extension's own.
 *
 * **The overlay-stack model, and why it is in one place.** pi-tui's handle is not a flag: `focus()` returns
 * without taking anything from an entry that has left `overlayStack` or whose `visible()` answers false
 * (tui.js:431-436), and `isFocused()` answers `focusedComponent === component` (tui.js:467) — pi's focus cell,
 * which only `setFocus` writes. The recorder's own handle starts focused and grants every ask, and the handle
 * this file used to build modelled only the `visible()` half: a test that "focused" a panel whose entry pi had
 * popped read `true` through it, which is the exact state the lockout lives in. So the fixture below models
 * the whole pair, and the stub TUI (`ui-stubs.ts`) shares its cells:
 *
 * - the entry's membership in the stack, with `hide()` and `setHidden(true)` taking it out or quieting it;
 * - pi's focus cell, which `focus()` writes only when the stack and `visible()` both allow it, and which
 *   `unfocus()` moves back to what pi would fall back to — the topmost other visible overlay, or the
 *   component focused before this overlay was shown;
 * - `isFocused()` derived from the cell and nothing else, so the handle and the TUI's `getFocusedComponent()`
 *   are two readings of one fact and cannot disagree.
 *
 * A case that wants a hostile host (a release that throws, an ask that is never granted) narrows one member of
 * the pair the fixtures hand it, which is how the pre-existing keyboard cases were written.
 *
 * The accessor: the overlay's component changes whenever a panel goes out of sight and back — a hide, a
 * focus-key open, a settle — so a test that cached the component across one of those asserts on a dead one.
 */
import type { Component, OverlayHandle } from "@earendil-works/pi-tui";

import type { PanelComponent } from "../src/panel-component.ts";
import { panelComponent } from "./panel-lifecycle-fixture.ts";
import type { Booted } from "./panel-lifecycle-fixture.ts";

/** What the stack and the focus cell are, as far as these fixtures are concerned. */
export type FocusCell = Component | null;

/** The pair the fixtures share with the stub TUI: pi's focus cell, and who was focused before the panel. */
export interface OverlayModel {
  /** pi's routing answer: the component keystrokes go to, or `null` for the editor-equivalent. */
  focus(): FocusCell;
  /** What `isFocused()` and `getFocusedComponent()` are both derived from. */
  setFocus(cell: FocusCell): void;
  /** Who `unfocus()` falls back to — pi's `entry.preFocus`, which is the editor in a real session. */
  preFocus(): FocusCell;
  setPreFocus(cell: FocusCell): void;
  /** Whether this overlay's entry is still on pi's stack. */
  onStack(): boolean;
  setOnStack(value: boolean): void;
  /** Whether the entry is hidden (`setHidden(true)` / `hide()`), which pi treats as not drawn. */
  hidden(): boolean;
  setHidden(value: boolean): void;
  /** The question pi asks before it grants a focus ask. */
  visible(): boolean;
  /** Move focus the way `hideOverlay()` does: the cell leaves the panel, the entry stays or goes as told. */
  pop(): void;
  /** The other overlays pi could fall back to. No fixture has a second overlay, so the answer is nobody's. */
  otherVisible(): FocusCell;
}

/**
 * The model behind one overlay, with the two no-op guards pi-tui's `OverlayHandle.focus()` obeys.
 *
 * `visible` is the owner's `visible()` — pi's question, not the test's belief — and `preFocus` starts at
 * `editor`, the component pi had focused before the overlay was shown.
 */
export function overlayModel(
  visible: () => boolean,
  editor: Component | null = null,
): OverlayModel {
  const cells: {
    focus: FocusCell;
    preFocus: FocusCell;
    onStack: boolean;
    hidden: boolean;
  } = { focus: editor, preFocus: editor, onStack: true, hidden: false };
  return {
    focus: () => cells.focus,
    setFocus: (cell) => {
      cells.focus = cell;
    },
    preFocus: () => cells.preFocus,
    setPreFocus: (cell) => {
      cells.preFocus = cell;
    },
    onStack: () => cells.onStack,
    setOnStack: (value) => {
      cells.onStack = value;
      // Pi drops a hidden entry's focus on the floor with it (`setHidden`/`hide` both do this), and an entry
      // that has left the stack is not something `focus()` may answer for afterwards.
      if (!value) cells.focus = cells.preFocus;
    },
    hidden: () => cells.hidden,
    setHidden: (value) => {
      cells.hidden = value;
    },
    visible: () => !cells.hidden && visible(),
    pop: () => {
      // pi's `resetExtensionUI` / `hideOverlay`: the entry leaves the stack, it stops being drawn, and any
      // focus it held goes with it — which is the whole reason a panel can be left believing it has a
      // keyboard. All three, in one place, so no caller can pop half an entry.
      cells.onStack = false;
      cells.hidden = true;
      cells.focus = cells.preFocus;
    },
    otherVisible: () => null,
  };
}

/** What `panelHandle` hands back: pi's handle, and the cells its answers are derived from. */
export interface HeldHandle {
  handle: OverlayHandle;
  /** Whether pi-tui would route a keystroke to the overlay — `isFocused()`'s own source. */
  held: () => boolean;
  /** The model, so a case can pop the entry the way pi's `resetExtensionUI()` does. */
  model: OverlayModel;
}

/**
 * A pi-tui overlay handle built from the shared model.
 *
 * `component` is the overlay's own component, which `isFocused()` compares against — the same expression pi
 * uses, so a handle that reports focus while pi's cell says otherwise is not constructible here.
 */
export function overlayHandleFrom(model: OverlayModel, component: Component): HeldHandle {
  return {
    handle: {
      hide: () => {
        model.pop();
        if (model.focus() === component) model.setFocus(model.preFocus());
      },
      setHidden: (value: boolean) => {
        if (model.hidden() === value) return;
        model.setHidden(value);
        if (value && model.focus() === component) model.setFocus(model.otherVisible());
      },
      isHidden: () => model.hidden(),
      focus: () => {
        // pi's two guards, both silent: off the stack, or not visible, and the ask is dropped. The visibility
        // answer is taken **before the stack is consulted at all** and never re-read: in pi-tui it is
        // `isOverlayVisible(entry)`, evaluated once and in front of `setFocus` (`tui.js:430-436`). That
        // callback is the owner's, and the owner reconciles the keyboard inside it — so every extra read of
        // it is another chance to ask the extension about a state this very call is in the middle of changing.
        const drawn = model.visible();
        if (!drawn || !model.onStack()) return;
        model.setFocus(component);
      },
      unfocus: () => {
        if (model.focus() !== component) return;
        model.setFocus(model.otherVisible() ?? model.preFocus());
      },
      isFocused: () => model.focus() === component,
      getBounds: () => undefined,
    } as unknown as OverlayHandle,
    held: () => model.focus() === component,
    model,
  };
}

/**
 * A pi-tui overlay handle the test holds: focus is pi's cell, the two verbs move it, and the two silent
 * guards pi-tui imposes on a `focus()` ask are modelled rather than granted. Without them the handle
 * reported a keyboard pi had thrown away — the one state the focus bugs left behind.
 */
export function panelHandle(visible?: () => boolean): HeldHandle {
  // No component yet: `withHandle` builds the pair over the component it just found on screen, which is the
  // only component the handle may ever be focused *for*. `visible` is optional because some cases hand the
  // handle to a component they built themselves, with no installed overlay to ask — and an absent question
  // grants, which is the older, unconditional shape those cases were written against.
  return overlayHandleFrom(overlayModel(visible ?? (() => true)), placeholder);
}

/** The handle's own identity until a component is known; replaced by `withHandle` before any assertion. */
const placeholder: Component = { render: () => [], invalidate: () => {} };

/**
 * The component of the overlay on screen now, with a fresh released handle handed to it.
 *
 * Throws rather than answering `undefined`: every caller of this is a keyboard test, and a panel with no
 * component on screen is the case where its assertions would all pass vacuously.
 */
export function onScreen(booted: Booted): PanelComponent {
  const c = panelComponent(booted.ctx.recorder.customCalls.at(-1));
  if (!c) throw new Error("no panel component on screen to take the keyboard");
  return c;
}

/**
 * The overlay's own `visible()` — pi-tui's question, asked of the callback this extension installed.
 *
 * pi-tui consults it before it honours a `handle.focus()` and before it composites a frame, so reading the
 * installed callback is how a test asks what pi would have answered rather than what the extension believes.
 * Throws rather than answering `false`: an overlay opened without one is a fixture that lost the thing it was
 * meant to read, not a panel pi would refuse to draw.
 */
export function overlayVisible(booted: Booted, columns = 120): boolean {
  const options = booted.ctx.recorder.customCalls.at(-1)?.options?.overlayOptions;
  const visible = typeof options === "function" ? undefined : options?.visible;
  if (!visible) throw new Error("the panel's overlay was opened without a visible() callback");
  return visible(columns, 24);
}

/**
 * The component on screen now, with a handle a case can make hostile.
 *
 * The default `unfocus` is the honest one — it moves the focus cell, the way pi-tui's does. A case that needs
 * a host which throws on the release supplies its own, and then reads `held()` to check the flag came down
 * anyway.
 */
export function withHandle(
  booted: Booted,
  unfocus?: () => void,
): Booted & { c: PanelComponent; held: () => boolean; visible(): boolean; model: OverlayModel } {
  const c = onScreen(booted);
  const model = overlayModel(() => overlayVisible(booted));
  const hh = overlayHandleFrom(model, c);
  if (unfocus) hh.handle.unfocus = unfocus;
  c.setHandle(hh.handle);
  return {
    ...booted,
    c,
    held: hh.held,
    model,
    visible: () => overlayVisible(booted),
  };
}
