/**
 * The escape hatch: the one keystroke path that does not go through the panel's own dispatcher (D2, D3).
 *
 * pi-tui runs `ctx.ui.onTerminalInput` listeners *before* it routes a byte to the focused component, and a
 * listener may `{ consume: true }`. That is the only way out of a panel pi still routes to when the component
 * holding pi's focus is not the one the extension last built — the state a reload, a session switch or a tree
 * navigation leaves behind, and the state the lockout report describes. The focus shortcut cannot answer it
 * (pi dispatches extension shortcuts from the editor's handler, and the editor does not have the focus) and
 * neither can the dispatcher (its keys arrive through the component that is the problem).
 *
 * Three things are asserted, in this order, because they are three ways to break a hatch:
 *
 * 1. it opens when pi holds the panel and nothing else does;
 * 2. it stays shut when pi does not — every other byte, and every keystroke while the editor has the focus,
 *    reaches pi's routing untouched, because a hatch that misfires *consumes* a byte the user meant for the
 *    editor;
 * 3. the gate is **pi's** answer, not the extension's flag: a panel whose flag says resting while pi still
 *    routes to it is exactly the case the hatch exists for, so a listener that read the flag would be blind
 *    here.
 */
import { expect, test } from "bun:test";

import type { Component, OverlayHandle } from "@earendil-works/pi-tui";

import { registerEscapeHatch } from "../src/panel-escape-hatch.ts";
import type { HatchKeyboard } from "../src/panel-escape-hatch.ts";

/** The keystroke answer pi's own listener contract accepts. */
type Answer = { consume: true } | undefined;

/** A ui whose only member the hatch uses is the listener registry, which hands back an unsubscribe. */
function ui() {
  const listeners: ((data: string) => Answer)[] = [];
  return {
    // pi declares `onTerminalInput` over its full context; the hatch calls it through a projection typed as
    // that context's `ui`, which is what the extension hands it.
    ctx: {
      // pi's own contract: the registration hands back the way to take it off again, and the extension's
      // `session_shutdown` is what calls it.
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
    listeners,
    /** Press a key at pi's earliest point: what the terminal hands pi, before it routes anything. */
    press: (data: string) => listeners.map((h) => h(data)),
    count: () => listeners.length,
  };
}

/** A keyboard whose pi-answer and release are both driven by the test. */
function keyboard(held = true) {
  const calls: string[] = [];
  const cell = { held };
  const kb: HatchKeyboard = { isFocused: () => cell.held, release: () => calls.push("release") };
  return {
    kb,
    calls,
    set: (value: boolean) => {
      cell.held = value;
    },
  };
}

test("Escape and Ctrl+C release a panel pi is routing to, and consume the byte", () => {
  for (const data of ["\x1b", "\x03", "\x1b[99;5u", "\x1b[27;5;99~"]) {
    const ui_ = ui();
    const k = keyboard(true);
    registerEscapeHatch(ui_.ctx as never, () => k.kb);
    expect(ui_.press(data), `${JSON.stringify(data)} was not consumed`).toEqual([
      { consume: true },
    ]);
    expect(k.calls, `${JSON.stringify(data)} did not release the panel`).toEqual(["release"]);
  }
});

test("every other byte reaches pi's routing untouched", () => {
  const ui_ = ui();
  const k = keyboard(true);
  registerEscapeHatch(ui_.ctx as never, () => k.kb);
  // The keys the panel itself owns, plus typing, plus the Ctrl+C *release* and *repeat* forms the gate refuses.
  for (const data of [
    "d",
    "j",
    "1",
    "\r",
    "\x1b[B",
    "hello",
    "\x1b[99;5:3u",
    "\x1b[200~\x03\x1b[201~",
  ]) {
    expect([data, ui_.press(data)]).toEqual([data, [undefined]]);
  }
  expect(k.calls).toEqual([]);
});

test("nothing is consumed when the editor has the focus — the hatch answers pi, not the flag", () => {
  const ui_ = ui();
  const k = keyboard(false);
  registerEscapeHatch(ui_.ctx as never, () => k.kb);
  expect(ui_.press("\x1b")).toEqual([undefined]);
  expect(ui_.press("\x03")).toEqual([undefined]);
  expect(k.calls).toEqual([]);
});

test("no panel at all: the listener exists and consumes nothing", () => {
  const ui_ = ui();
  registerEscapeHatch(ui_.ctx as never, () => undefined);
  expect(ui_.press("\x1b")).toEqual([undefined]);
  expect(ui_.press("\x03")).toEqual([undefined]);
});

test("the keyboard is read per keystroke, so a replaced owner is the one released", () => {
  // The owner is replaced at every session boundary. A closure over the owner this call saw would keep
  // watching — and releasing — a panel the user already left.
  const ui_ = ui();
  const first = keyboard(true);
  const second = keyboard(true);
  let current: HatchKeyboard | undefined = first.kb;
  registerEscapeHatch(ui_.ctx as never, () => current);
  current = second.kb;
  expect(ui_.press("\x1b")).toEqual([{ consume: true }]);
  expect([first.calls, second.calls]).toEqual([[], ["release"]]);
});

test("unsubscribing takes the hatch away, so a shutdown leaves no listener behind", () => {
  const ui_ = ui();
  const k = keyboard(true);
  const off = registerEscapeHatch(ui_.ctx as never, () => k.kb);
  expect(ui_.count()).toBe(1);
  off();
  expect(ui_.count()).toBe(0);
  // The byte the user is now typing belongs to pi's routing alone.
  expect(ui_.press("\x03")).toEqual([]);
  expect(k.calls).toEqual([]);
});

test("the release happens before the consume, so the key does not also land on the editor", () => {
  // Order is the point: a `{ consume: true }` returned *without* releasing leaves the panel focused and the
  // byte swallowed — the user's exit pressed and nothing happened; and a release that let the byte through
  // would clear the draft with pi's own Ctrl+C binding on the way out of a lockout.
  const ui_ = ui();
  const order: string[] = [];
  const kb: HatchKeyboard = {
    isFocused: () => true,
    release: () => order.push("release"),
  };
  registerEscapeHatch(ui_.ctx as never, () => kb);
  const [answer] = ui_.press("\x03");
  order.push(answer?.consume ? "consumed" : "passed-through");
  expect(order).toEqual(["release", "consumed"]);
});

/**
 * The state the hatch is for, on the real component: pi routes to a component the extension no longer holds.
 *
 * `panel-handle.ts`'s model is pi's focus cell; the extension's is the component it last built. A reload
 * clears pi's overlays and the extension's record, and if the *old* component is still the focused one pi
 * keeps routing to it — nothing the extension builds any more can release it.
 */
test("a component the extension has forgotten is still releasable through the hatch", () => {
  const ui_ = ui();
  const component: Component = { render: () => [], invalidate: () => {} };
  const cell: { focused: Component | null } = { focused: component };
  const handle = {
    isFocused: () => cell.focused === component,
    unfocus: () => {
      if (cell.focused === component) cell.focused = null;
    },
  } as unknown as OverlayHandle;
  const released: string[] = [];
  const kb: HatchKeyboard = {
    isFocused: () => handle.isFocused(),
    release: () => {
      handle.unfocus();
      released.push("released");
    },
  };
  registerEscapeHatch(ui_.ctx as never, () => kb);
  expect(ui_.press("\x1b")).toEqual([{ consume: true }]);
  expect([cell.focused === component, released]).toEqual([false, ["released"]]);
  // And it is idempotent from here: pi is not routing to it, so the next Escape is the user's.
  expect(ui_.press("\x1b")).toEqual([undefined]);
  expect(released).toEqual(["released"]);
});
