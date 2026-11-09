/**
 * Whether a **hidden** panel can still hold the keyboard, and whether the two releases the user has reach it
 * (issue #98, lens 3).
 *
 * The claim under test: pi still routes bytes to an overlay whose entry is hidden, so a panel whose own flag
 * is down and which pi still focuses is never released — the hatch only fires on `handle.isFocused()` and the
 * per-frame reconciliation only runs while the component's flag is up, so both are blind to the same state.
 *
 * The first thing this file settles is what pi really does, because the claim's premise is a fact about
 * pi-tui and not about this extension. Three of its members matter:
 *
 * - `setHidden(true)` (`tui.js:407-421`) *does* move the focus cell off the overlay it hides, but only when
 *   `this.focusedComponent === component` at that moment — and `setFocus` then runs the whole overlay-focus
 *   restore machinery, which can put the cell straight back on the same component (`restore-overlay`,
 *   `tui.js:287-292` and `resolveBlockedOverlayFocusResume`). pi's focus is therefore not a fact a caller may
 *   assume: it is a cell, and the cell can name an overlay whose `hidden` flag is set.
 * - `handleTerminalInput` (`tui.js:720-727`) re-checks the *focused* overlay's visibility, but it asks
 *   `options.visible(terminal.columns, terminal.rows)` (`isOverlayVisible`, `tui.js:543-550`) — the extension's
 *   own callback. A hidden entry whose callback still answers true is "visible" to that guard, so the byte
 *   reaches `focusedComponent.handleInput` (`tui.js:750-756`) and the panel swallows it.
 * - The hatch's gate is the same cell, read through the handle (`panel-escape-hatch.ts`, `ownerKeyboard`).
 *
 * So the reproductions below build pi's shape rather than assume it: a cell that names the panel, a `visible()`
 * that has stopped answering true (which is what a hide is to this extension — `PanelOwner.isVisible()` reads
 * the mode cell), and the release path driven both ways. The final case is the one that decides the lens's
 * claim: **the state must be reachable through the extension's own verbs**, because a state the extension can
 * only reach by moving pi's cell by hand is the harness's, not the product's.
 */
import { expect, test } from "bun:test";

import type { Component, OverlayHandle, TUI } from "@earendil-works/pi-tui";

import type { PanelComponent } from "../src/panel-component.ts";
import { registerEscapeHatch } from "../src/panel-escape-hatch.ts";
import { createGrantWindow } from "../src/panel-grant-window.ts";
import { reconcileOnFrame } from "../src/panel-owner-keyboard.ts";
import type { KeyboardCells } from "../src/panel-owner-keyboard.ts";
import { onScreen, overlayModel, overlayVisible } from "./panel-handle.ts";
import { blockedAction } from "./panel-lifecycle-autoshow-fixture.ts";
import type { Booted } from "./panel-lifecycle-fixture.ts";
import { createStubTui } from "./ui-stubs.ts";

/** Escape, and Ctrl+C in each of the three spellings a terminal sends (`panel-keys.ts`). */
const RELEASE_KEYS = ["\x1b", "\x03", "\x1b[99;5u", "\x1b[27;5;99~"];

/** The keys the panel owns, which must never reach the editor while the panel holds the keyboard. */
const PANEL_KEYS = ["d", "j", "1", "\r"];

/** A ui that registers hatch listeners the way pi-tui runs them. */
function terminal() {
  const listeners: ((data: string) => { consume?: true } | undefined)[] = [];
  return {
    ctx: {
      ui: {
        onTerminalInput: (h: (d: string) => { consume?: true } | undefined) => {
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

/**
 * The keyboard pair the extension hands the hatch — `ownerKeyboard` (`panel-owner-keyboard.ts`), spelled the
 * same way, over the component the booted extension built.
 */
function keyboardOf(c: PanelComponent) {
  const handle = c.handle();
  return handle ? { isFocused: () => handle.isFocused(), release: () => c.unfocus() } : undefined;
}

/**
 * The booted panel, hidden, with pi's focus cell still naming its component.
 *
 * `model.hidden` is set by the extension's own hide (`/pins hide` → `hidePanel`), and the `visible()` the
 * handle consults is the installed overlay callback — which the hidden mode cell answers false for. So the
 * overlay is hidden *and* pi is not drawing it, and the only thing left to establish per case is where pi's
 * one focus cell points.
 *
 * `tui` is the stub the extension's own frames are requested on, with the same single focus cell its overlay
 * handle writes: the reconciliation asks pi through it, so a case that asserted against a second TUI would be
 * asking a different pi than the extension is.
 */
async function hiddenWithPiFocused(): Promise<
  Booted & {
    c: PanelComponent;
    model: ReturnType<typeof overlayModel>;
    held: () => boolean;
    tui: ReturnType<typeof createStubTui>;
    visible(): boolean;
  }
> {
  const booted = await blockedAction("Decide the provider");
  await booted.stub.commands.get("pins")?.handler("hide", booted.ctx);
  const c = onScreen(booted);
  const tui = createStubTui();
  const model = overlayModel(() => overlayVisible(booted));
  const component = c as unknown as Component;
  const handle = {
    isFocused: () => tui.getFocusedComponent() === component,
    unfocus: () => {
      if (tui.getFocusedComponent() === component) tui.setFocus(tui.editorComponent);
    },
    focus: () => {
      if (model.visible() && model.onStack()) tui.setFocus(component);
    },
    hide: () => model.pop(),
    setHidden: (value: boolean) => {
      model.setHidden(value);
      if (value && tui.getFocusedComponent() === component) tui.setFocus(tui.editorComponent);
    },
    isHidden: () => model.hidden(),
    getBounds: () => undefined,
  } as unknown as OverlayHandle;
  c.setHandle(handle);
  // The state the lens describes: pi's cell names the panel, the panel's own flag says resting, and the
  // overlay is no longer drawn.
  //
  // The one thing the harness *cannot* reproduce is the premise behind it. This extension never calls
  // `handle.setHidden()` at all — it opens one overlay for the session's life and answers frames through the
  // overlay's `visible()` (`panel-overlay.ts`, `PanelOwner.#frame`) — so pi's own `setHidden(true)`
  // (`tui.js:407-421`, which moves the focus cell when it hides the focused overlay) is not a path the
  // product walks. pi would therefore not have hidden this entry, and the state below is built by moving pi's
  // cell directly: it is a harness state, reachable in production only by something outside this extension
  // (a reload, another extension, a future pi) leaving the cell on a component whose entry stopped drawing.
  model.setHidden(true);
  tui.setFocus(component);
  c.setFocused(false);
  return {
    ...booted,
    c,
    model,
    tui,
    held: () => tui.getFocusedComponent() === component,
    visible: () => overlayVisible(booted),
  };
}

/** The cells `reconcileOnFrame` reads, over the TUI this extension's overlay answers on. */
function frameCells(c: PanelComponent, tui: TUI): KeyboardCells {
  return { component: () => c, tui: () => tui, grants: createGrantWindow() };
}

test("pi's focus cell can name a hidden overlay whose visible() answers false — pi's guard does not catch it", async () => {
  // The premise, asserted rather than assumed: `handleTerminalInput` re-checks only `options.visible`
  // (`tui.js:720-727`, `tui.js:543-550`), which is the *extension's* callback. An extension that has stopped
  // drawing an overlay it once focused is therefore not protected by pi's own re-check, and the byte would be
  // handed to `focusedComponent.handleInput` (`tui.js:750-756`).
  const s = await hiddenWithPiFocused();
  expect([s.model.hidden(), s.visible(), s.c.isFocused(), s.held()]).toEqual([
    true, // the entry is hidden
    false, // and this extension would not draw it
    false, // the component's own flag says resting
    true, // pi's cell still names it
  ]);
});

test("the escape hatch releases a hidden panel pi still routes to, for every release key", async () => {
  // The reproductions. `isFocused()` is pi's answer, not the flag, so the hatch's gate does open on a hidden
  // panel — which is what makes this case a guard and not a fix, provided the release lands. What the fix has
  // to guarantee is that a *hidden* panel pi still focuses ends the way a shown one does: pi's cell moved off
  // it, and the byte consumed.
  for (const data of RELEASE_KEYS) {
    const s = await hiddenWithPiFocused();
    const t = terminal();
    registerEscapeHatch(t.ctx as never, () => keyboardOf(s.c));
    expect([data, t.press(data)[0]], `${JSON.stringify(data)} was not consumed`).toEqual([
      data,
      { consume: true },
    ]);
    expect([data, s.held()], `${JSON.stringify(data)} left pi routing to the hidden panel`).toEqual(
      [data, false],
    );
  }
});

test("the per-frame path never releases a hidden panel pi still routes to, so the hatch is the only way out", async () => {
  // The lens's claim, stated precisely — and half of it is pi's, which is why no `src` change follows.
  //
  // **What is true:** `reconcileOnFrame` gates on the component's flag (`panel-owner-keyboard.ts`), so with the
  // flag down it asks pi nothing and the panel keeps the keyboard across any number of frames. That is the D4
  // rule, taken for cost reasons, and it is safe only while the hatch works — which the second half of this
  // case pins.
  //
  // **What is not pi's behaviour:** the hidden half. This extension never hides the overlay — it answers
  // `visible()` — so pi's `setHidden(true)`, the member that *does* move the focus cell off the overlay it
  // hides (`tui.js:407-421`), never runs. pi's own re-check on the input path (`tui.js:720-727`) asks
  // `options.visible()`, this extension's callback, and a hidden panel answers it false — so pi itself would
  // redirect the focus away before it routed the byte (`tui.js:728-731`). The lens's "pi still routes keys to
  // it" therefore needs a cell pi would not have left, which the fixture above supplies directly.
  const s = await hiddenWithPiFocused();
  const cells = frameCells(s.c, s.tui);
  reconcileOnFrame(cells);
  reconcileOnFrame(cells);
  expect(
    s.held(),
    "the per-frame path released a panel whose flag is down (it must not ask at all)",
  ).toBe(true);

  const t = terminal();
  registerEscapeHatch(t.ctx as never, () => keyboardOf(s.c));
  expect(t.press("\x03")).toEqual([{ consume: true }]);
  expect(s.held(), "the frame path muted the release and the hatch missed it too").toBe(false);
});

test("no panel key reaches the editor while a hidden panel holds pi's focus, and all of them after the release", async () => {
  // The behavioural half of the same state: while pi routes to the hidden panel, its keys are swallowed by the
  // component (`panel-input.ts` hands them back because the panel is not on screen — and hands them back *to
  // nothing*, since pi never saw them); after the release they are the editor's.
  const s = await hiddenWithPiFocused();
  const t = terminal();
  registerEscapeHatch(t.ctx as never, () => keyboardOf(s.c));
  for (const key of PANEL_KEYS) {
    const before = s.stub.entries.length;
    s.c.handleInput(key);
    expect([key, s.stub.entries.length - before]).toEqual([key, 0]);
  }
  // The dispatcher's own guard for a panel that is not on screen hands the keyboard back (`panel-input.ts`
  // `isVisible()`): the *first* byte pi routes to a hidden panel releases it, which is a third way out of the
  // state besides the hatch and the rebuild's release. So the hatch is never asked about a panel the user has
  // already left — pi's gate, and it is the editor's byte from there.
  expect(s.held()).toBe(false);
  expect(t.press("\x1b")).toEqual([undefined]);
  expect(s.held()).toBe(false);
  // pi's routing has moved, so the editor answers the bytes the panel once owned: the component still holds
  // them (`panel-input.ts` drops an unclaimed key and never forwards it), but they reach no session state — no
  // dismissal, no `Re #1:` draft in the editor.
  const editorBefore = s.ctx.recorder.getEditorText();
  const entriesBefore = s.stub.entries.length;
  for (const key of PANEL_KEYS) s.c.handleInput(key);
  expect([s.stub.entries.length - entriesBefore, s.ctx.recorder.getEditorText()]).toEqual([
    0,
    editorBefore,
  ]);
});

test("the extension's own verbs cannot leave a hidden panel holding pi's focus — the state is the harness's", async () => {
  // The claim's reachability test, and the reason the cases above are guards rather than a bug report. Every
  // extension path that hides the panel ends the interaction first: `/pins hide` and the toggle reach
  // `hidePanel`, which releases the component (`panel-user-verbs.ts`), and a release on a panel pi had focused
  // moves pi's cell back to the pre-overlay component. So after the user's own hide the cell no longer names
  // the panel, and the disagreement these cases construct by hand is not one the shipped verbs produce.
  const booted = await blockedAction("Decide the provider");
  const before = onScreen(booted);
  const tui = createStubTui();
  const model = overlayModel(() => overlayVisible(booted));
  const component = before as unknown as Component;
  const handle = {
    isFocused: () => tui.getFocusedComponent() === component,
    unfocus: () => {
      if (tui.getFocusedComponent() === component) tui.setFocus(tui.editorComponent);
    },
    focus: () => {
      if (model.visible() && model.onStack()) tui.setFocus(component);
    },
    hide: () => model.pop(),
    // pi's own `setHidden(true)` moves the cell off the overlay it hides; nothing calls it, so the model's
    // hidden flag is left to the `visible()` the mode cell answers for (see `hiddenWithPiFocused`).
    setHidden: () => {},
    isHidden: () => model.hidden(),
    getBounds: () => undefined,
  } as unknown as OverlayHandle;
  before.setHandle(handle);
  before.focus();
  expect([before.isFocused(), tui.getFocusedComponent() === component]).toEqual([true, true]);

  await booted.stub.commands.get("pins")?.handler("hide", booted.ctx);
  // Flag down, pi's cell off the panel, and nothing drawn — the state the shipped verbs leave, which is not the
  // disagreement the cases above build by hand.
  expect([
    before.isFocused(),
    tui.getFocusedComponent() === component,
    before.handle()?.isFocused(),
  ]).toEqual([false, false, false]);
  expect(booted.panel.mode()).toBe("hidden");
});
