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
import type { PanelDeps, PanelWiring } from "../src/panel-deps.ts";
import { TerminalWidth } from "../src/panel-width.ts";
import { PanelOwner } from "../src/panel.ts";
import { plainStyle } from "../src/render.ts";
import type { PanelStyle } from "../src/render.ts";
import type { PinView } from "../src/types.ts";
import { pin } from "./fixtures.ts";
import { createPlainTheme, createStubTui } from "./harness.ts";
import { contextWith, flush } from "./panel-lifecycle-fixture.ts";

/** A host with nothing to give but the pins: the shape a caller outside `PanelOwner` builds. */
function handHostStub(): PanelHost {
  return {
    getView: () => ONE,
    style: () => undefined,
    requestRender: () => {},
    dismiss: () => {},
    unfocus: () => {},
    startReply: () => {},
  };
}

/** The identity style, plus the bar the panel needs and `plainStyle` has no opinion about. */
const panelStyle: PanelStyle = { ...plainStyle, selected: (text) => text };

const EMPTY: PinView = { pins: [], removed: [] };
const ONE: PinView = { pins: [pin(1, "Decide X")], removed: [] };

/** The wiring, with the two decisions the test wants to watch: what the rail was told, and the view. */
function wiring(
  ctx: Parameters<PanelOwner["open"]>[0],
  opts: { view?: PinView; shown?: boolean; custom?: unknown } = {},
) {
  const railDraws: number[] = [];
  const state = { view: opts.view ?? ONE, shown: opts.shown ?? true };
  const deps: PanelDeps = {
    getView: () => state.view,
    isPanelShown: () => state.shown,
    setPanelShown: (shown) => {
      state.shown = shown;
    },
    recordPanelShown: () => {},
    dismiss: () => {},
    startReply: () => {},
  };
  const terminal = new TerminalWidth();
  const panel = new PanelOwner({
    deps,
    terminal,
    themeStyle: () => panelStyle,
    redrawRail: () => railDraws.push(1),
  });
  // A context built for a test has a recorder's `custom`; the override is what makes it fail.
  if (opts.custom !== undefined) {
    (ctx as unknown as { ui: Record<string, unknown> }).ui.custom = opts.custom;
  }
  return { panel, terminal, railDraws, state, ctx };
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
