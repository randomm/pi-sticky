/**
 * The panel owner on its own, with no extension and no session: the two members the wiring is allowed
 * to ask and nobody else calls, plus the half of `open()` that a working host never shows — a host
 * whose `custom()` rejects must leave the panel closed rather than claimed, and the component that
 * colours itself from the theme its host handed it rather than from a style it was never given.
 *
 * These are the pieces `panel-lifecycle.test.ts` cannot reach: it drives the extension, so every panel
 * it opens is one the extension opened, and every promise `custom()` returns is one its recorder
 * settles. A hand-built wiring can fail.
 */
import { expect, test } from "bun:test";

import type { Theme } from "@earendil-works/pi-coding-agent";
import { PanelComponent } from "../src/panel-component.ts";
import type { PanelHost } from "../src/panel-component.ts";
import { PanelOwner } from "../src/panel.ts";
import type { PinView } from "../src/types.ts";
import { NOW, pin } from "./fixtures.ts";
import { createPlainTheme, createStubTui } from "./harness.ts";
import { contextWith, flush } from "./panel-lifecycle-fixture.ts";
import { ONE } from "./panel-owner-wiring.ts";
import { wiring } from "./panel-owner-wiring.ts";

/** Nothing pinned: the view a test hands the owner when the answer must be "not on screen". */
const EMPTY: PinView = { pins: [], removed: [] };

/** A host with nothing to give but the pins: the shape a caller outside `PanelOwner` builds. */
function handHostStub(): PanelHost {
  return {
    getView: () => ONE,
    style: () => undefined,
    requestRender: () => {},
    dismiss: () => {},
    unfocus: () => {},
    startReply: () => {},
    notify: () => {},
  };
}

test("a host whose custom() rejects leaves no panel claimed, so the rail keeps drawing", async () => {
  const ctx = contextWith([]);
  const h = wiring(ctx, {
    custom: () => Promise.reject(new Error("host overlay stack full")),
  });

  h.panel.open(ctx);
  await flush();

  // Closed, not merely invisible: had the record survived, the rail would have stood down for a panel
  // that is not on screen and the pins would be on neither surface.
  // Closed, not merely invisible: the record is gone, so the rail has no panel to stand down for. Had
  // it survived, the pins would have been drawn by neither surface.
  expect(h.panel.component()).toBeUndefined();
});

test("a host with no custom() at all opens nothing and still leaves the rail in charge", () => {
  const ctx = contextWith([]);
  // `null`, not `undefined`: clearing the member would only ask the recorder's `custom` (the override
  // is `??`-guarded), and the branch this covers is a context that has no such member to call.
  const h = wiring(ctx, { custom: null });
  h.panel.open(ctx);
  expect(h.panel.component()).toBeUndefined();
  // And closing that nothing is safe — the close path must not invent a `done()` to fire.
  h.panel.close();
  expect(h.panel.component()).toBeUndefined();
});

test("isVisible is the panel's own answer, and the rail's redraw is the wiring's job", async () => {
  const ctx = contextWith([]);
  const h = wiring(ctx, { view: EMPTY });
  h.terminal.note(120);

  // Nothing pinned: the panel is not on screen even open, even shown, even wide.
  h.panel.open(ctx);
  await flush();
  // A record exists (the panel is open) yet nothing would be drawn: `component()` proves the first,
  // `isVisible()` the second, and the gap between them is the whole reason they are two questions.
  expect(h.panel.component()).toBeDefined();
  expect(h.panel.isVisible()).toBe(false);

  // Pins arrive, the user's flag is kept: the answer follows the view, through the same wiring, with
  // nothing rebuilt — which is why the rail holds the owner rather than a function captured at open.
  h.state.view = ONE;
  expect(h.panel.isVisible()).toBe(true);
  h.state.shown = false;
  expect(h.panel.isVisible()).toBe(false);

  // Every change that can move the pins asks for the rail to be reinstalled: `refresh()` is the seam,
  // and the owner does not draw the rail itself, it announces that the answer may have changed.
  const before = h.railDraws.length;
  h.panel.refresh();
  expect(h.railDraws.length).toBeGreaterThan(before);

  // `component()` is the open panel's component, once its factory has run, and undefined before.
  expect(h.panel.component()).toBeDefined();
  h.panel.close();
  expect(h.panel.component()).toBeUndefined();
});

test("a close whose host handle throws still resets the owner, and reports the reason once", async () => {
  // The two halves of the fix this pins: `close()` must not let a host's throw skip the reset (the
  // dead panel would keep owning the pins from `isVisible()`), and it must not drop the reason either
  // — an overlay pi never popped is the one case the owner's answer stops matching the screen.
  const ctx = contextWith([]);
  const h = wiring(ctx);
  h.terminal.note(120); // a wide terminal, so the open panel really does own the pins
  h.panel.open(ctx);
  await flush();
  expect(h.panel.isVisible()).toBe(true);

  // The host's close handle is what `close()` fires second; making it throw is the host refusing to
  // release the entry, and the factory's own `done` has already resolved the call by then.
  const call = ctx.recorder.customCalls.at(-1);
  const hostClose = (call?.options as { onClose?: (c: (r: unknown) => void) => void } | undefined)
    ?.onClose;
  expect(hostClose).toBeFunction();
  // `onClose` is the handle that *rewrites* `record.done`, so a hook that throws before handing back a
  // working close is the wedged host: `close()` fires the recorded handle, which is the one the hook
  // installed, and that one throws.
  hostClose?.(() => {
    throwWith("overlay stack wedged");
  });
  expect(() => h.panel.close()).not.toThrow();
  // Reset, not half-closed: the record is gone, so there is no panel for the rail to stand down for.
  expect(h.panel.component()).toBeUndefined();
  expect(h.panel.isVisible()).toBe(false);

  // …and the next open says so, once, in the only place with a ui to say it to.
  h.panel.open(ctx);
  await flush();
  expect(ctx.recorder.notifications.filter((n) => n.message.includes("did not close")).length).toBe(
    1,
  );
  // Told once, not on every frame or every open afterwards.
  h.panel.open(ctx);
  await flush();
  expect(ctx.recorder.notifications.filter((n) => n.message.includes("did not close")).length).toBe(
    1,
  );
});

test("a same-count change of *which* pins the view holds still reinstalls the rail", async () => {
  // `RailComponent` snapshots the view it was built with, so a key that counted pins alone would keep
  // drawing the previous view after a `/unpin 1` immediately followed by a pin of the same level: same
  // count, different pins, and a rail nobody asked to redraw.
  const ctx = contextWith([]);
  const h = wiring(ctx);
  h.terminal.note(120);
  h.panel.open(ctx);
  await flush();
  // The first redraw establishes the answer; everything after it is compared against that.
  h.panel.refresh();
  const installed = h.railDraws.length;
  expect(installed).toBeGreaterThan(0);

  h.state.view = { pins: [pin(1, "Decide X")], removed: [] };
  h.panel.refresh();
  // A *fresh* array of identical pins still counts as the same view: what the key must catch is a view
  // that draws differently, not one that was merely re-published — and `commit`/`reconstruct` publish a
  // fresh array on every change, which is exactly the case that must stay free.
  expect(h.railDraws.length).toBe(installed);

  // …and the reply suffix the rail dims a pin with is a drawn change, so a same-id/same-stamp view
  // whose pin now reads as replied is not the frame the installed component drew.
  h.state.view = {
    pins: [{ ...pin(1, "Decide X"), repliedAt: NOW }],
    removed: [],
  };
  h.panel.refresh();
  expect(h.railDraws.length).toBe(installed + 1);

  // Same width, same flag, same count — different pins, which is the case the count cannot see.
  h.state.view = { pins: [pin(7, "Something else")], removed: [] };
  h.panel.refresh();
  expect(h.railDraws.length).toBe(installed + 2);
  // …and a frame that changed nothing after it costs nothing again.
  h.panel.refresh();
  expect(h.railDraws.length).toBe(installed + 2);
});
function throwWith(message: string): never {
  throw new Error(message);
}

test("focus reaches the open component, and a panel with no component is a no-op", async () => {
  const ctx = contextWith([]);
  const h = wiring(ctx);
  h.panel.open(ctx);
  await flush();
  const component = h.panel.component();
  expect(component?.isFocused()).toBe(false);
  h.panel.focus();
  expect(component?.isFocused()).toBe(true);
  // After the close there is nothing to focus, and no throw about it: an Escape that raced the close
  // must not surface as an extension error.
  h.panel.close();
  h.panel.focus();
  expect(h.panel.component()).toBeUndefined();
});

test("a host that keeps the style to itself gets the component coloured from its own theme", () => {
  // `PanelOwner` hands the component the style it built from pi's theme, so this branch is the one a
  // direct caller takes: the component was given a theme and no style, and must colour itself from that
  // theme rather than draw plain — and must not fall through to `NO_PANEL_COLOUR`, whose missing
  // `selected` mapping is exactly what a bare `Style` has not got. `createPlainTheme()` is the identity
  // on purpose: what distinguishes the two paths is not the bytes but *which mapping answered*.
  const theme = createPlainTheme();
  const marked: string[] = [];
  const markingTheme = {
    ...theme,
    bold: (text: string) => {
      marked.push(text);
      return text;
    },
  } as unknown as Theme;

  const coloured = new PanelComponent(handHostStub(), createStubTui(), markingTheme);
  expect(coloured.theme()).toBe(markingTheme);
  expect(coloured.render(40).join("\n")).toContain("Decide X");
  // The header went through the theme's own `bold`: the theme was consulted, not skipped.
  expect(marked.some((text) => text.includes("Pinned for you"))).toBe(true);

  // The same component with no theme anywhere answers from the identity style rather than throwing,
  // which is the other half of the branch: a caller with nothing to give still gets a frame.
  const plain = new PanelComponent(handHostStub(), createStubTui(), undefined);
  expect(plain.theme()).toBeUndefined();
  expect(plain.render(40).join("\n")).toContain("Decide X");
});
