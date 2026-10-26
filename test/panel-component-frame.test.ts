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
};

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
  c.focus();
  c.select(2);
  expect(c.render(40).join("\n")).toContain("[ • Dismissed");
  // The view swapped under a panel nobody sent `update()` for — a rebuild that published a fresh array
  // while the overlay was not redrawn. Asked again at the *same* width, a frame cache keyed on the width
  // alone hands the old view's lines back, dismissed pin and all, with the bar on a row of a list that no
  // longer has it.
  (view as unknown as { pins: ViewPin[] }).pins = pins("One", "Two");
  const text = c.render(40).join("\n");
  expect(text).not.toContain("Dismissed");
  // ...and the bar the component was holding past the end of the new view does not survive the redraw:
  // it lands on the last row that does exist.
  expect(text).toContain("[ • Two");
  expect(c.selection).toBe(1);
  // A frame request that changed nothing still costs nothing: the cache keeps its fast path.
  const cached = c.render(40);
  expect(c.render(40)).toBe(cached);
});
