/**
 * HIGH 2 of issue #98: the two releases that hand the keyboard back must keep their own failures inside.
 *
 * Both are containment gaps rather than wrong verdicts, and both leave the same thing on screen: pi routing
 * keys to a panel that will never release it.
 *
 * 1. **The escape hatch calls `release()` unguarded.** pi-tui runs `onTerminalInput` listeners with no
 *    try/catch (`tui.js` `handleTerminalInput` calls `listener(current)` and reads `result?.consume` with
 *    nothing around it that catches), so a release that throws escapes the listener: pi never gets an answer
 *    for the byte, the byte is routed to the component it was already routing to, and the lockout survives its
 *    own escape hatch. `containKey` (`panel-input.ts`), `hidePanel` (`panel-user-verbs.ts`) and
 *    `releaseKeysOutsideScreen` (`panel-owner-keyboard.ts`) all contain the identical ending — the flag down
 *    first, then a swallowed best-effort release — and the hatch is the last line, so it must do the same.
 * 2. **The owner's reconciliation releases unguarded too**, from `#frame`, `close()` and the rebuild, none of
 *    which sits under `containKey`'s try. There it is the *handle* that has to throw: `unfocusPanel`
 *    (`panel-component-focus.ts`) already swallows a throw from everything else in the ending, so a fixture
 *    whose only hostile member is the host would pass before and after that containment, and prove nothing.
 *
 * pi's focus cell is always one cell read two ways (`panel-lockout-harness.ts`, over `ui-stubs.ts`), never a
 * second belief: a handle that reported focus independently of what pi's cell says cannot express the states
 * these cases are about.
 */
import { expect, test } from "bun:test";

import type { Component } from "@earendil-works/pi-tui";

import { PanelComponent } from "../src/panel-component.ts";
import { registerEscapeHatch } from "../src/panel-escape-hatch.ts";
import type { HatchKeyboard } from "../src/panel-escape-hatch.ts";
import { createGrantWindow } from "../src/panel-grant-window.ts";
import { ownerKeyboard, reconcilePanelFocus } from "../src/panel-owner-keyboard.ts";
import { host as panelHost } from "./panel-component-host.ts";
import {
  RELEASE_KEYS,
  cellsOf,
  hostileUnfocus,
  keyboardOf,
  piHandle,
  terminal,
} from "./panel-lockout-harness.ts";
import type { StubTui } from "./ui-stubs.ts";
import { createStubTui } from "./ui-stubs.ts";

// --- the escape hatch ----------------------------------------------------------------------------------

test("a release that throws is contained, and the byte is still consumed", () => {
  // The failing test. The hatch's `held.release()` is unguarded, so the throw escapes the listener and pi-tui
  // never receives an answer for the byte. A hatch that throws is a hatch that did not fire, on the one path
  // whose whole job is firing when nothing else can.
  const t = terminal();
  const kb: HatchKeyboard = {
    isFocused: () => true,
    release: () => {
      throw new Error("the handle's unfocus threw");
    },
  };
  registerEscapeHatch(t.ctx as never, () => kb);
  for (const data of RELEASE_KEYS) {
    const pressed = (() => {
      try {
        return t.press(data)[0];
      } catch {
        return "escaped the listener";
      }
    })();
    expect([JSON.stringify(data), pressed], `${JSON.stringify(data)} did not consume`).toEqual([
      JSON.stringify(data),
      { consume: true },
    ]);
  }
});

test("the hatch takes the panel out of the key path even when the release throws", async () => {
  // Containing the throw without moving the flag is the useless half of the containment — and this case finds
  // it is already in place. `unfocusPanel` (`panel-component-focus.ts`) moves the flag first and *apart* from
  // the ending, and wraps the handle's `unfocus()` in its own `try`, so a hostile handle cannot leave the panel
  // focused even before the hatch contains anything. The case is therefore a guard on two things at once: the
  // order the hatch depends on (flag down, and the ending reached), and the consume-and-gate pair below — a
  // release that throws inside the listener must still answer `{ consume: true }`, or the byte goes straight
  // back to the panel pi was already routing to.
  const t = terminal();
  const tui = createStubTui();
  const h = panelHost([]);
  const c = new PanelComponent(h.stub, tui);
  const component = { render: () => [], invalidate: () => {} } as Component;
  c.setHandle(hostileUnfocus(component, tui));
  tui.setFocus(component);
  c.focus();
  expect([c.isFocused(), tui.getFocusedComponent()]).toEqual([true, component]);

  registerEscapeHatch(t.ctx as never, () => keyboardOf(c));
  expect(t.press("\x03")).toEqual([{ consume: true }]);
  // pi-tui's `unfocus()` *is* its `setFocus`, and `setFocus` runs its overlay-focus restore machinery before it
  // writes the cell (`tui.js:258-315`) — so a release may throw part-way and leave the cell where it was. That
  // is the state this case is about, and it is why the containment is not enough on its own: the flag has to go
  // down whatever the handle did, so the dispatcher, the reconciliation and the hatch's own gate all stop
  // treating the panel as holding a keyboard.
  expect(c.isFocused()).toBe(false);
  // The second press is answered too: pi's cell is still on a panel whose release threw, so the hatch's gate is
  // still open, and a release that threw once must not throw the answer out of the second keystroke either.
  expect(t.press("\x03")).toEqual([{ consume: true }]);
});

test("the hatch's gate still keeps a quiet panel out of the way when the release would throw", () => {
  // The containment must not widen the hatch: a panel pi is not routing to consumes nothing, throw or no throw.
  const t = terminal();
  const kb: HatchKeyboard = {
    isFocused: () => false,
    release: () => {
      throw new Error("must never be reached");
    },
  };
  registerEscapeHatch(t.ctx as never, () => kb);
  for (const data of RELEASE_KEYS) expect([data, t.press(data)]).toEqual([data, [undefined]]);
});

// --- the owner's own reconciliation --------------------------------------------------------------------

test("reconcilePanelFocus contains a release that throws", () => {
  // A throw out of the per-frame path is an `extension_error` on every render, and a panel pi still routes to
  // because the release never finished.
  //
  // The state that *asks* for a release is the opposite of the obvious one: `reconcileFocus` releases when pi
  // says the overlay does **not** hold the keyboard (`panel-focus-reconcile.ts`,
  // `if (!target.granted()) target.release()`). pi's own `unfocus()` is then what the throw has to survive — it
  // returns the moment the component is not the focused one (`tui.js:438-441`), which is precisely why the
  // handle is asked a second time by the containment: the first call is the one that threw.
  const tui = createStubTui();
  const h = panelHost([]);
  const c = new PanelComponent(h.stub, tui);
  const component = { render: () => [], invalidate: () => {} } as Component;
  // The throw has to be the *handle's*: the reconciliation's release is the component's own ending, and
  // `unfocusPanel` keeps the owner's settle and the frame request inside its own `try` — a fixture whose only
  // hostile member was the host passed with this containment absent and proved nothing.
  const handle = hostileUnfocus(component, tui);
  c.setHandle(handle);
  c.focus();
  // The disagreement this reconciliation exists for: the component's flag says focused while pi's cell has moved
  // on — a reload, a tree navigation, another extension's overlay, or an ask pi answered and then withdrew. The
  // flag is what makes the per-frame path ask at all, and pi's "no" is what makes it release.
  tui.setFocus(tui.editorComponent);
  expect([c.isFocused(), handle.isFocused()]).toEqual([true, false]);

  expect(() => reconcilePanelFocus(cellsOf(c, tui))).not.toThrow();
  // The release ran to its end: the flag is down and pi's cell — the half the throwing handle never moved — is
  // off the panel, which is the assertion this containment exists for. With both cells consistent, the per-frame
  // path stops asking, the dispatcher hands every key back, and the hatch has nothing left to release. A
  // containment that swallowed the throw and moved only the flag would leave pi routing every byte to a panel
  // this extension no longer treats as focused — a silent lockout, and one no frame ever asks about again — while
  // a case that read the flag alone would call it green.
  expect([c.isFocused(), tui.getFocusedComponent()]).toEqual([false, tui.editorComponent]);
});

/** The cells the escape hatch's reader is handed, over a component and a TUI the test owns. */
function kbCells(component: PanelComponent | undefined, tui: StubTui) {
  return { component: () => component, tui: () => tui, grants: createGrantWindow() };
}

test("the owner's keyboard answers with the handle, not the component's flag", () => {
  // `ownerKeyboard` is the one door the hatch still has on a panel the extension has stopped tracking, so its
  // gate must be **pi's** answer. A reader that returned the component's flag would be blind in exactly the
  // case the hatch exists for, and the two cells disagree here on purpose: the flag is up, pi's cell is elsewhere.
  const tui = createStubTui();
  const h = panelHost([]);
  const c = new PanelComponent(h.stub, tui);
  const component = { render: () => [], invalidate: () => {} } as Component;
  // The honest handle: this case asks what the reader *reports* and that its release is the component's own
  // ending, so the release has to be able to land. `hostileUnfocus` is the other file's fixture — it throws on
  // the first ask by design, which is the containment cases' premise, not this one's.
  c.setHandle(piHandle(component, tui));
  // The disagreement is built by the two verbs that are *not* each other: `focus()` takes the flag **and**
  // pi's cell (the handle's ask), so the flag is then forced back down on its own — the state a reload, another
  // extension or a withdrawn ask leaves behind, and the one the hatch's gate must not be blind to.
  c.focus();
  c.setFocused(false);

  const kb = ownerKeyboard(kbCells(c, tui));
  expect([kb?.isFocused(), c.isFocused()], "the gate read the flag, not pi's cell").toEqual([
    true,
    false,
  ]);
  // And the release is the component's own ending, not a flag write the hatch does not own: it takes pi's cell
  // back to the editor, which is what `release: () => component.unfocus()` is for.
  kb?.release();
  expect(tui.getFocusedComponent()).toBe(tui.editorComponent);
});

test("the owner's keyboard reports a refusal, so a panel pi never granted keeps its gate shut", () => {
  // The mirror case, and the one that makes the row above a reading rather than a tautology: pi's cell is
  // elsewhere while nothing has been asked of the handle, so the answer is no and the hatch consumes nothing.
  const tui = createStubTui();
  const h = panelHost([]);
  const c = new PanelComponent(h.stub, tui);
  const component = { render: () => [], invalidate: () => {} } as Component;
  c.setHandle(piHandle(component, tui));
  expect(ownerKeyboard(kbCells(c, tui))?.isFocused()).toBe(false);
});

test("the owner's keyboard is nothing at all when no panel is drawn", () => {
  // The hatch must consume nothing for a panel that does not exist: `undefined` (rather than a keyboard whose
  // `isFocused()` would throw on a missing handle) is what lets the listener answer the byte to pi untouched.
  const tui = createStubTui();
  expect(ownerKeyboard(kbCells(undefined, tui))).toBeUndefined();
  // A component whose overlay factory has not handed over a handle is the same refusal — nothing to ask.
  const h = panelHost([]);
  const bare = new PanelComponent(h.stub, tui);
  expect(ownerKeyboard(kbCells(bare, tui))).toBeUndefined();
});

test("a release that throws twice still leaves the panel out of the key path", () => {
  // The second `catch` — the one that swallows the *re-ask*. `always` makes every ask of this handle throw,
  // so neither the component's ending nor the containment's second ask of pi's door can finish. What the
  // owner owes the user is the one state the extension can still produce: its flag down, and no throw out of
  // the reconciliation that `#frame` would pay for on every render.
  const tui = createStubTui();
  const h = panelHost([]);
  const c = new PanelComponent(h.stub, tui);
  const component = { render: () => [], invalidate: () => {} } as Component;
  c.setHandle(hostileUnfocus(component, tui));
  c.focus();
  // The disagreement the reconciliation is asked about: the flag up, pi's cell elsewhere.
  tui.setFocus(tui.editorComponent);
  // `hostileUnfocus`'s first ask always throws, so neither of the containment's two asks can finish. The cell
  // pi would have moved is therefore still on the editor, and that is the state the case ends in — a release
  // that could not be completed at all, contained.
  expect([c.isFocused(), c.handle()?.isFocused()]).toEqual([true, false]);

  expect(() => reconcilePanelFocus(cellsOf(c, tui))).not.toThrow();
  expect(c.isFocused(), "the re-ask threw and the flag was left up").toBe(false);
  expect(tui.getFocusedComponent(), "pi still routes to a panel nothing can release").toBe(
    tui.editorComponent,
  );
});
