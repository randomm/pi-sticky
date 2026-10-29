/**
 * The panel component's *frame cache*: what one `render()` hands back for a width, and when the next
 * call has to lay the panel out again. Split from `panel-component.test.ts` along that seam — the keys,
 * the focus model and the reply marker are asserted there; this file is the cache alone.
 *
 * `render()` is the cache pi-tui reads, and its key has to name *everything* the frame is drawn from.
 * Width alone was not enough: `update()` is the only member that compares the live view, and pi-tui
 * asks an open overlay for a frame on its own schedule, so a view swapped between the two — a rebuild
 * that published a fresh array while the overlay was not redrawn — left `render()` handing back the
 * lines of the old view at the width the cache was keyed on, dismissed pin and all.
 */
import { expect, test } from "bun:test";

import { PanelComponent } from "../src/panel-component.ts";
import type { PanelStyle } from "../src/render.ts";
import type { ViewPin } from "../src/types.ts";
import { NOW, pin } from "./fixtures.ts";
import { createOverlayHandle } from "./harness.ts";
import { host, pins } from "./panel-component-host.ts";

// The bar is the only thing that says which row the component thinks is selected: the plain style's
// `selected` is the identity, so a row the bar sits on is byte-identical to one it is not, and the
// selection could not be asserted on at all.
const BAR_STYLE: PanelStyle = {
  header: (text) => text,
  marker: (_level, text) => text,
  dim: (text) => text,
  selected: (text) => `[${text}]`,
  border: (text) => text,
  borderFocused: (text) => text,
};

// The frame is four columns wide — a gutter and its space on each side — so a component test that
// asserts on a drawn row asks for four columns more than the builder spec does, and the bar still reads
// against the inner columns rather than the frame.

/** A component over a recorded host whose frame cache may hold a view nobody asked for. */
function staleFrameComponent(pins: ViewPin[]) {
  const h = host(pins);
  h.stub.style = () => BAR_STYLE;
  const view = h.state.view;
  const c = new PanelComponent(h.stub, h.tui);
  const handle = createOverlayHandle();
  handle.unfocus();
  c.setHandle(handle);
  return { c, view };
}

test("a view swap without an update() rebuilds the frame at the same width", () => {
  const { c, view } = staleFrameComponent(pins("One", "Two", "Dismissed"));
  // Focused, because the bar is the only thing that says which row the component thinks is selected —
  // the plain style colours nothing, so an unfocused panel hands back identical lines whatever the bar.
  // The bar is indexed into the *ranked* list (newest id first among equal pins), so `select(0)` is the
  // last-pinned pin — the one this test removes.
  c.focus();
  c.select(0);
  // The bar sits inside the gutters, so the drawn row opens with the gutter, its space, and then the bar —
  // and the bar's own row carries the selection marker in the marker cell, not the level's glyph (#70
  // decision 2), which is what tells a user where the bar is when the theme gives them no colour.
  expect(c.render(44).join("\n")).toContain(`│ [${String.fromCodePoint(0x203a)} Dismissed`);
  // The view swapped under a panel nobody sent `update()` for — a rebuild that published a fresh array
  // while the overlay was not redrawn. Asked again at the *same* width, a frame cache keyed on the width
  // alone hands the old view's lines back, dismissed pin and all, with the bar on a row of a list that no
  // longer has it.
  (view as unknown as { pins: ViewPin[] }).pins = pins("One", "Two");
  const text = c.render(44).join("\n");
  expect(text).not.toContain("Dismissed");
  // ...and the bar the component was holding past the end of the new view does not survive the redraw:
  // it lands on the last row that does exist — index 0 of the two-pin ranked list, which is the newest id.
  expect(text).toContain(`│ [${String.fromCodePoint(0x203a)} Two`);
  expect(c.selection).toBe(0);
  // A frame request that changed nothing still costs nothing: the cache keeps its fast path.
  const cached = c.render(44);
  expect(c.render(44)).toBe(cached);
});

test("a render() alone pulls an out-of-range bar back onto the list it just drew", () => {
  // The clamp used to be local to `drawFrame`, so the *component* kept an index its own rows did not draw
  // whenever the view swapped without an `update()` — and `panel-input.ts` reads `pins[target.selection]`, so
  // `d` and Enter then resolved to `undefined` and did nothing at all, with the user looking at a bar that
  // answered no key. The clamp now goes back through the state's setter.
  const h = host(pins("One", "Two", "Three"));
  const c = new PanelComponent(h.stub, h.tui);
  const handle = createOverlayHandle();
  handle.unfocus();
  c.setHandle(handle);
  c.focus();
  c.select(2);
  expect(c.selection).toBe(2);
  h.state.view = { pins: pins("One"), removed: [] };
  // `render()` is the only thing that ran: no `update()`, and pi-tui asks for frames on its own schedule.
  c.render(44);
  expect(c.selection).toBe(0);
  // …and the frame the cache now holds is the one the bar sits on, so the next request is a hit rather than
  // a second layout for the byte the clamp just moved.
  const clamped = c.render(44);
  expect(c.render(44)).toBe(clamped);
  // An empty view lands the bar at its floor rather than below it, which is the case `Math.max` is for.
  c.select(2);
  h.state.view = { pins: [], removed: [] };
  c.render(44);
  expect(c.selection).toBe(0);
});
