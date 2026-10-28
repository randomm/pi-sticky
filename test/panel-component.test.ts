/**
 * The panel's component: its keys, its focus, and what it asks the host to do. No session and no
 * terminal — a hand-built host records the callbacks and a `{ requestRender }` TUI records the frames,
 * which is the only way the redraw path is observable at all (the harness's recorder builds its stub TUI
 * inside `custom()` and keeps no reference to it).
 *
 * The focus model is the part worth reading twice: the overlay is `nonCapturing` for its whole life, so
 * `handleInput` is only reached while `focus()` has been held, and `Escape` is the only key that lets go
 * — `createOverlayHandle()` starts focused, so a test that cares about the handle's own flag calls
 * `unfocus()` first; what is asserted here is the *component's* flag, which drives the hint line.
 */ import { expect, test } from "bun:test";
import type { OverlayHandle, TUI } from "@earendil-works/pi-tui";

import { PanelComponent } from "../src/panel-component.ts";
import type { PinView, ViewPin } from "../src/types.ts";
import { createOverlayHandle } from "./harness.ts";
import { host, pins } from "./panel-component-host.ts";
import { HOSTILE_KEY_INPUTS } from "./panel-hostile.ts";

// The Kitty protocol's release and repeat forms of `d`, and the two arrows in the byte sequences a
// terminal really sends: `matchesKey` recognises the arrows only in those forms, so a test that typed
// "down" would be asserting on a key press no terminal delivers.
const RELEASE = "\x1b[100;3:3u";
const REPEAT = "\x1b[100;3:2u";
const DOWN = "\x1b[B";
const UP = "\x1b[A";

/** Wide enough that the hint line is drawn whole rather than cut to an ellipsis: the hint, its two
 * margins and the two corners, which is all the bottom border asks for. */
const HINT_WIDTH = 48;
/** A width that leaves room for the whole hint *inside* the bottom border, corners and margins included. */
const HINT_ROOM = HINT_WIDTH + 4;

/** A component over a recorded host, with a handle already released so the component's own flag rules. */
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
  expect(c.render(40)[0]).toContain("📌 Pinned · 2");
  expect(c.render(40).some((line) => line.includes("Watch out"))).toBe(true);
  // The hint lives in the bottom border, which is drawn at the full width: a frame narrower than the
  // hint cuts it, so the whole hint only appears at a width that has room for it beside the corners.
  expect(c.render(HINT_ROOM).some((line) => line.includes("Esc back"))).toBe(false);
  c.focus();
  expect(c.render(HINT_ROOM).some((line) => line.includes("Esc back"))).toBe(true);
});

test("render caches its lines until the view, the selection or the focus changes", () => {
  const { c, state } = component(pins("One"));
  const first = c.render(40);
  // Same width, same view: the very same array, not a copy of it.
  expect(c.render(40)).toBe(first);
  // `refresh()` calls `update()` on every frame, including the ones a read-only `/pins` triggers, so a
  // redraw of a view that has not moved must cost nothing. A *new* array of equal pins is the change
  // test firing the other way: `commit`/`reconstruct` publish a fresh array, so identity is the test.
  c.update();
  expect(c.render(40)).toBe(first);
  state.view = { pins: pins("One"), removed: [] };
  c.update();
  expect(c.render(40)).not.toBe(first);
  state.view = { pins: pins("Other"), removed: [] };
  const before = state.renders;
  c.update();
  // ...and a redraw that does repaint asks the TUI for the frame — the only way an open overlay moves.
  expect(state.renders).toBe(before + 1);
  expect(c.render(40).some((line) => line.includes("Other"))).toBe(true);
});

test("focus and unfocus move the handle and ask for a frame each", () => {
  const { c, handle, state } = component(pins("One"));
  const before = state.renders;
  expect([c.isFocused(), handle.isFocused()]).toEqual([false, false]);
  c.focus();
  expect([c.isFocused(), handle.isFocused()]).toEqual([true, true]);
  c.unfocus();
  expect([c.isFocused(), handle.isFocused()]).toEqual([false, false]);
  expect(state.renders).toBe(before + 2);
  // The host was told, once, and only by the unfocus: the component moves its own handle, so this round trip
  // is the only thing that puts the pins back on the rail (`panel-host.ts`).
  expect(state.unfocusCalls).toBe(1);
});

test("up and down and j and k move the selection, and each move asks for a frame", () => {
  const { c, state } = component(pins("One", "Two", "Three"));
  const before = state.renders;
  for (const [data, want] of [
    ["j", 1],
    [DOWN, 2],
    ["k", 1],
    [UP, 0],
  ] as const) {
    c.handleInput(data);
    expect(c.selection).toBe(want);
  }
  // One frame per move: the count is the moves, which is what makes the panel feel immediate.
  expect(state.renders).toBe(before + 4);
});

test("a key the panel does not own is swallowed, and the selection stops at both ends", () => {
  const { c, state } = component(pins("One", "Two"));
  const before = state.renders;
  for (const data of ["x", "q"]) c.handleInput(data);
  expect([c.selection, state.renders]).toEqual([0, before]);
  // The bar stops at both ends rather than wrapping.
  c.handleInput("k");
  expect(c.selection).toBe(0);
  c.handleInput("j");
  c.handleInput("j");
  c.handleInput("j");
  expect(c.selection).toBe(1);
});

test("an empty buffer, a release, a repeat and an unowned key each do nothing", () => {
  const { c, state } = component(pins("One", "Two"));
  const before = state.renders;
  for (const data of ["", RELEASE, REPEAT, "x", "q"]) c.handleInput(data);
  expect([c.selection, state.dismissals, state.renders]).toEqual([0, [], before]);
});

test("Escape hands focus back and evokes nothing else", () => {
  const { c, handle, state } = component(pins("One"));
  c.focus();
  c.handleInput("\x1b");
  expect([c.isFocused(), handle.isFocused(), state.dismissals, state.replies]).toEqual([
    false,
    false,
    [],
    [],
  ]);
});

test("d dismisses the selected pin through the host, and an empty selection dismisses nothing", () => {
  const { c, state } = component(pins("One", "Two"));
  // The pins are drawn ranked — same level, same reply state, newest id first — so index 0 is `Two`, and
  // the bar's index is the *drawn* list's (`PanelMemory.sectionsOf(...).flat`). Before that, `d` here dismissed the pin
  // the user was not looking at.
  c.handleInput("d");
  expect(state.dismissals).toEqual([2]);
  // The remaining pin is `One`; a second `d` (after the bar moves) answers it.
  c.handleInput("j");
  c.handleInput("D");
  expect(state.dismissals).toEqual([2, 1]);
});

/**
 * The sweep in `panel-hostile.ts` (`HOSTILE_KEY_INPUTS`) holds inputs that end in a key the panel owns
 * without being that key. None is a bare press, so none may dismiss or reply: the gate is `isBarePress`
 * in `src/panel-keys.ts`, consulted *before* `matchesKey`, which is why widening pi-tui's own sequence
 * table could not let one through.
 */
test("no escape sequence that merely ends in d, D or a carriage return dismisses or replies", () => {
  // Nothing dismissed, nothing replied — and nothing moved, so the payload is not navigation either.
  for (const data of HOSTILE_KEY_INPUTS) {
    const { c, state } = component(pins("One", "Two"));
    c.handleInput(data);
    expect([state.dismissals, state.replies, c.selection]).toEqual([[], [], 0]);
  }
});

test("a selection that is not a whole row number lands on the top row, and the bar survives", () => {
  const { c } = component(pins("One", "Two", "Three"));
  // Whole numbers clamp to the pins that exist; a selection that is not a whole number must not leave
  // the bar on no row at all (`Math.min`/`Math.max` both propagate NaN, and a fractional index used to
  // be coerced only by luck).
  c.select(99);
  expect(c.selection).toBe(2);
  c.select(-5);
  expect(c.selection).toBe(0);
  for (const bad of [Number.NaN, 1.5, -4]) {
    c.select(2);
    c.select(bad);
    expect(c.selection).toBe(0);
  }
  c.select(1);
  expect(c.render(40).join("\n").includes("Two")).toBe(true);
});

test("after a dismissal the selection is clamped to the pins that are left", () => {
  const { c, state } = component(pins("One", "Two", "Three"));
  c.select(2);
  // The host's dismissal removes the pin and the extension calls update(), which is the clamp. An update
  // that leaves nothing parks the bar at zero rather than past the end, so a pin arriving into the empty
  // view is selected at the top — and draws nothing (the overlay's frame is the prompt around it).
  state.view = { pins: pins("One", "Two"), removed: [] };
  c.update();
  expect(c.selection).toBe(1);
  const empty = { pins: [], removed: [] } as PinView;
  const fresh = new PanelComponent({ ...host([]).stub, getView: () => empty });
  fresh.select(0);
  fresh.update();
  expect([fresh.selection, fresh.render(40)]).toEqual([0, []]);
});

test("Enter asks for a reply on the selected pin and lets go of the focus", () => {
  const { c, handle, state } = component(pins("One", "Two"));
  c.focus();
  // Ranked: index 0 is `Two`, so one move down lands on `One` — the pin the reply names.
  c.handleInput("j");
  c.handleInput("\r");
  expect(state.replies).toEqual([1]);
  expect([c.isFocused(), handle.isFocused()]).toEqual([false, false]);
});

test("Enter with no pin to reply to still lets go of the focus", () => {
  const { c, state } = component([]);
  c.focus();
  c.handleInput("\r");
  expect([state.replies, c.isFocused()]).toEqual([[], false]);
});
