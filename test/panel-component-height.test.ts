/**
 * How tall the panel's component draws.
 *
 * The component sizes a frame from the terminal it was built with, and pi-tui computes the overlay's
 * layout from `component.render(width)` — so reading `handle.getBounds()` would make the height depend
 * on what the panel drew last frame and a dismissed pin could leave a hole. These are the two rules that
 * follow: a frame is as tall as its *content* (two border rows over the wrapped pin rows), and it is
 * never taller than half the terminal, which is the same ceiling the overlay's own `maxHeight` states.
 */
import { expect, test } from "bun:test";
import type { OverlayHandle, TUI } from "@earendil-works/pi-tui";

import { PanelComponent } from "../src/panel-component.ts";
import type { ViewPin } from "../src/types.ts";
import { createOverlayHandle, createStubTui } from "./harness.ts";
import { host, pins } from "./panel-component-host.ts";

/** A component over a recorded host, with a handle already released so the component's own flag rules. */
function component(pins: ViewPin[], tui?: TUI) {
  const h = host(pins);
  const c = new PanelComponent(h.stub, tui ?? h.tui);
  const handle = createOverlayHandle();
  handle.unfocus();
  c.setHandle(handle);
  return { c, handle, ...h };
}

test("a height comes from the terminal and is capped, so a very tall terminal is not laid out whole", () => {
  const tall = { requestRender: () => {}, terminal: { columns: 120, rows: 400 } } as unknown as TUI;
  // The frame is content-height, not ceiling-height: two border rows over the pin's own rows. A tall
  // terminal is no reason to lay out 200 rows the overlay clips, and a TUI that cannot be asked answers
  // with the fallback row count halved rather than zero, so a frame is still a frame.
  expect(component(pins("One"), tall).c.render(40)).toHaveLength(3);
  expect(component(pins("One"), {} as unknown as TUI).c.render(40)).toHaveLength(3);
  // The ceiling is what a long list is cut to, and it is half the terminal however tall it is.
  const many = pins(...Array.from({ length: 300 }, (_unused, i) => `Pin ${i + 1}`));
  expect(component(many, tall).c.render(40)).toHaveLength(200);
  expect(component(many, {} as unknown as TUI).c.render(40)).toHaveLength(12);
});

test("`theme()` reads back what was injected and `invalidate()` drops the cached frame", () => {
  const themed = new PanelComponent(host(pins("One")).stub, createStubTui(), undefined);
  expect(themed.theme()).toBeUndefined();
  themed.render(40);
  themed.invalidate();
  // The frame after an invalidate is laid out again rather than handed back from the last one, and an
  // identical request still costs nothing: the cache keeps its fast path.
  expect(themed.render(40)).toEqual(themed.render(40));
});

/** A handle that records the order of the focus calls a component makes on it. */
function trackingHandle() {
  const handle = createOverlayHandle();
  const calls: string[] = [];
  const track =
    (name: string, run: () => void): (() => void) =>
    () => {
      calls.push(name);
      run();
    };
  return {
    calls,
    handle: {
      ...handle,
      focus: track("focus", () => handle.focus()),
      unfocus: track("unfocus", () => handle.unfocus()),
    } as OverlayHandle,
  };
}

test("the component's focus and unfocus go straight to the handle it was given", () => {
  const c = new PanelComponent(host(pins("One")).stub);
  const tracker = trackingHandle();
  c.setHandle(tracker.handle);
  c.focus();
  c.unfocus();
  // The host's `unfocus` is the notification and the handle moving is the mechanism; the order matters.
  expect(tracker.calls).toEqual(["focus", "unfocus"]);
});
