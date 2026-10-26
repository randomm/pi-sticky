/**
 * The panel's component: its keys, its focus, and what it asks the host to do. No session and no
 * terminal — a hand-built host records the callbacks and a hand-built `{ requestRender }` TUI
 * records the frames, which is the only way the redraw path is observable at all (the harness's
 * recorder builds its stub TUI inside `custom()` and keeps no reference to it).
 *
 * The focus model is the part worth reading twice: the overlay is `nonCapturing` for its whole life,
 * so `handleInput` is only ever reached while `focus()` has been held, and `Escape` is the only key
 * that lets go. `createOverlayHandle()` starts focused, so a test that cares about the handle's own
 * flag calls `unfocus()` first — what is asserted here is the *component's* flag, which drives the
 * hint line.
 */
import { expect, test } from "bun:test";
import type { OverlayHandle, TUI } from "@earendil-works/pi-tui";

import { PanelComponent, replyMarker } from "../src/panel-component.ts";
import type { PanelHost } from "../src/panel-component.ts";
import type { PanelStyle } from "../src/render.ts";
import type { PinView, ViewPin } from "../src/types.ts";
import { NOW, pin } from "./fixtures.ts";
import { createOverlayHandle, createStubTui } from "./harness.ts";

/** Colours that do nothing but are a complete `PanelStyle`, including the bar. */
const style: PanelStyle = {
  header: (s) => s,
  marker: (_level, s) => s,
  dim: (s) => s,
  selected: (s) => `[${s}]`,
};

/**
 * The Kitty protocol's release and repeat forms of `d`, and the two arrows in the byte sequences a
 * terminal really sends: `matchesKey` recognises the arrows only in those forms, so a test that
 * typed "down" would be asserting on a key press no terminal delivers.
 */
const RELEASE = "\x1b[100;3:3u";
const REPEAT = "\x1b[100;3:2u";
const DOWN = "\x1b[B";
const UP = "\x1b[A";

/** A host that records every callback, over a view the test owns. */
function host(pins: ViewPin[] = []) {
  const state = {
    view: { pins, removed: [] } as PinView,
    renders: 0,
    dismissals: [] as number[],
    replies: [] as number[],
    unfocused: 0,
  };
  const tui = { requestRender: () => void state.renders++ } as unknown as TUI;
  const stub: PanelHost = {
    getView: () => state.view,
    style: () => style,
    requestRender: () => void state.renders++,
    dismiss: (id) => void state.dismissals.push(id),
    unfocus: () => void state.unfocused++,
    startReply: (id) => void state.replies.push(id),
  };
  return { stub, state, tui };
}

/** Wide enough that the hint line is drawn whole rather than cut to an ellipsis. */
const HINT_WIDTH = 48;

const pins = (...texts: string[]): ViewPin[] =>
  texts.map((text, i) => ({ ...pin(i + 1, text, "info", { createdAt: NOW }) }));

function component(pins: ViewPin[], tui?: TUI) {
  const h = host(pins);
  const c = new PanelComponent(h.stub, tui ?? h.tui);
  const handle = createOverlayHandle();
  handle.unfocus();
  c.setHandle(handle);
  return { c, handle, ...h };
}

test("render draws the header, the pins and — while focused — the hint", () => {
  const { c } = component(pins("Decide X", "Watch out"));
  expect(c.render(40)[0]).toContain("📌 Pinned for you (2)");
  expect(c.render(40).some((line) => line.includes("Watch out"))).toBe(true);
  expect(c.render(HINT_WIDTH).some((line) => line.includes("Esc back"))).toBe(false);
  c.focus();
  expect(c.render(HINT_WIDTH).some((line) => line.includes("Esc back"))).toBe(true);
});

test("render caches its lines until the view, the selection or the focus changes", () => {
  const { c, state } = component(pins("One"));
  const first = c.render(40);
  // Same width, same view: the very same array, not a copy of it.
  expect(c.render(40)).toBe(first);
  // A redraw invalidates the cache, which is what lets `redraw()` repaint an open overlay.
  c.update();
  expect(c.render(40)).not.toBe(first);
  state.view = { pins: pins("Other"), removed: [] };
  c.update();
  expect(c.render(40).some((line) => line.includes("Other"))).toBe(true);
});

test("a redraw asks for a frame, which is the only way an open overlay is repainted", () => {
  const { c, state } = component(pins("One"));
  const before = state.renders;
  c.update();
  expect(state.renders).toBe(before + 1);
});

test("focus and unfocus move the handle and ask for a frame each", () => {
  const { c, handle, state } = component(pins("One"));
  expect(c.isFocused()).toBe(false);
  expect(handle.isFocused()).toBe(false);
  const before = state.renders;
  c.focus();
  expect(c.isFocused()).toBe(true);
  expect(handle.isFocused()).toBe(true);
  c.unfocus();
  expect(c.isFocused()).toBe(false);
  expect(handle.isFocused()).toBe(false);
  expect(state.renders).toBe(before + 2);
});

test("up and down and j and k move the selection, and each move asks for a frame", () => {
  const { c, state } = component(pins("One", "Two", "Three"));
  const before = state.renders;
  c.handleInput("j");
  expect(c.selection).toBe(1);
  c.handleInput(DOWN);
  expect(c.selection).toBe(2);
  c.handleInput("k");
  expect(c.selection).toBe(1);
  c.handleInput(UP);
  expect(c.selection).toBe(0);
  // One frame per move, plus one for `select`-free input handling: the count is the moves.
  expect(state.renders).toBe(before + 4);
});

test("the selection stops at both ends instead of wrapping", () => {
  const { c } = component(pins("One", "Two"));
  c.handleInput("k");
  expect(c.selection).toBe(0);
  c.handleInput("j");
  c.handleInput("j");
  expect(c.selection).toBe(1);
});

test("a key the panel does not own is swallowed and moves nothing", () => {
  const { c, state } = component(pins("One", "Two"));
  const before = state.renders;
  c.handleInput("x");
  c.handleInput("q");
  expect(c.selection).toBe(0);
  expect(state.renders).toBe(before);
});

test("an empty buffer, a release and a repeat each do nothing", () => {
  const { c, state } = component(pins("One", "Two"));
  const before = state.renders;
  for (const data of ["", RELEASE, REPEAT]) c.handleInput(data);
  expect(c.selection).toBe(0);
  expect(state.dismissals).toEqual([]);
  expect(state.renders).toBe(before);
});

test("Escape hands focus back and evokes nothing else", () => {
  const { c, handle, state } = component(pins("One"));
  c.focus();
  c.handleInput("\x1b");
  expect(c.isFocused()).toBe(false);
  expect(handle.isFocused()).toBe(false);
  expect(state.dismissals).toEqual([]);
  expect(state.replies).toEqual([]);
});

test("d dismisses the selected pin through the host, and an empty selection dismisses nothing", () => {
  const { c, state } = component(pins("One", "Two"));
  c.handleInput("d");
  expect(state.dismissals).toEqual([1]);
  c.handleInput("j");
  c.handleInput("D");
  expect(state.dismissals).toEqual([1, 2]);
});

test("after a dismissal the selection is clamped to the pins that are left", () => {
  const { c, state } = component(pins("One", "Two", "Three"));
  c.select(2);
  // The host's dismissal removes the pin and the extension calls update(), which is the clamp.
  state.view = { pins: pins("One", "Two"), removed: [] };
  c.update();
  expect(c.selection).toBe(1);
});

test("an update with no pins left parks the bar at zero rather than past the end", () => {
  const { c } = component(pins("One"));
  c.select(0);
  const view = { pins: [], removed: [] } as PinView;
  const h = host([]);
  h.state.view = view;
  const fresh = new PanelComponent({ ...h.stub, getView: () => view });
  fresh.select(0);
  fresh.update();
  expect(fresh.selection).toBe(0);
  // Nothing pinned draws nothing: the overlay's frame is the prompt around it, and the panel is not
  // opened for a view with no pins in it. `selection` is still parked rather than left past the end, so
  // a pin arriving into the empty view is selected at the top rather than past what is drawn.
  expect(fresh.render(40)).toEqual([]);
});

test("Enter asks for a reply on the selected pin and lets go of the focus", () => {
  const { c, handle, state } = component(pins("One", "Two"));
  c.focus();
  c.handleInput("j");
  c.handleInput("\r");
  expect(state.replies).toEqual([2]);
  expect(c.isFocused()).toBe(false);
  expect(handle.isFocused()).toBe(false);
});

test("Enter with no pin to reply to still lets go of the focus", () => {
  const { c, state } = component([]);
  c.focus();
  c.handleInput("\r");
  expect(state.replies).toEqual([]);
  expect(c.isFocused()).toBe(false);
});

test("a height comes from the terminal and is capped, so a very tall terminal is not laid out whole", () => {
  const tall = { requestRender: () => {}, terminal: { columns: 120, rows: 400 } } as unknown as TUI;
  const { c } = component(pins("One"), tall);
  // Header + 98 rows + hint, clipped to the panel's own ceiling of 100.
  expect(c.render(40)).toHaveLength(100);
});

test("a TUI with no usable terminal falls back to 24 rows", () => {
  const { c } = component(pins("One"), {} as unknown as TUI);
  expect(c.render(40)).toHaveLength(24);
});

test("select() clamps to the pins that exist", () => {
  const { c } = component(pins("One", "Two"));
  c.select(99);
  expect(c.selection).toBe(1);
  c.select(-5);
  expect(c.selection).toBe(0);
});

test("invalidate() drops the cache and the theme can be read back", () => {
  const h = host(pins("One"));
  const c = new PanelComponent(h.stub, createStubTui(), undefined);
  expect(c.theme()).toBeUndefined();
  c.render(40);
  c.invalidate();
  expect(c.render(40)).toEqual(c.render(40));
});

test("the reply marker replaces one that is already there and keeps the draft verbatim", () => {
  expect(replyMarker("how about the blue one", 3)).toBe("Re #3: how about the blue one");
  expect(replyMarker("Re 7: keep this", 3)).toBe("Re #3: Re 7: keep this");
  // A marker the user typed by hand, at column 0, is replaced; anywhere else it is content.
  expect(replyMarker("Re #9: draft", 4)).toBe("Re #4: draft");
  expect(replyMarker("Re #x: not a marker", 4)).toBe("Re #4: Re #x: not a marker");
  expect(replyMarker("  Re #1: indented", 4)).toBe("Re #4:   Re #1: indented");
});

/** A handle that records the calls a component makes, so focus is asserted on the handle too. */
function trackingHandle() {
  const handle = createOverlayHandle();
  const calls: string[] = [];
  return {
    calls,
    handle: {
      ...handle,
      focus: () => {
        calls.push("focus");
        handle.focus();
      },
      unfocus: () => {
        calls.push("unfocus");
        handle.unfocus();
      },
    } as OverlayHandle,
  };
}

test("the component's focus and unfocus go straight to the handle it was given", () => {
  const h = host(pins("One"));
  const c = new PanelComponent(h.stub);
  const tracker = trackingHandle();
  c.setHandle(tracker.handle);
  c.focus();
  c.unfocus();
  expect(tracker.calls).toEqual(["focus", "unfocus"]);
});
