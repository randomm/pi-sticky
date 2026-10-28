/**
 * `createPanelWiring`: the panel's own deps object, built and driven directly.
 *
 * Every other test reaches the panel's deps through `createStickyExtension`, which wires them to a
 * session and never lets a test hand the panel a host of its own — so the members this file owns, the
 * editor-draft path and the notify passthrough, were reached by no test at all. Both are guarded
 * against a host that throws: pi-tui calls the panel's key dispatch with no try/catch of its own, so a
 * throw escaping `startReply` would surface as an `extension_error` out of the terminal's keys rather
 * than as a key that did nothing.
 */
import { expect, test } from "bun:test";

import { DEFAULT_CONFIG } from "../src/config.ts";
import type { HostContext } from "../src/context.ts";
import type { StickyDeps } from "../src/deps.ts";
import { createPanelWiring, initialShown } from "../src/panel-deps.ts";
import type { PanelWiringParts } from "../src/panel-deps.ts";
import { createPanelMode } from "../src/panel-mode.ts";
import { UI_TYPE } from "../src/types.ts";
import type { PinView } from "../src/types.ts";
import { ONE } from "./panel-owner-wiring.ts";

/** A sticky deps object with nothing behind it but the view the panel draws. */
function stickyDeps(view: PinView = ONE): StickyDeps {
  return {
    config: DEFAULT_CONFIG,
    now: () => "2026-01-01T00:00:00.000Z",
    getState: () => ({ v: 1, pins: [], removed: [], nextId: 1 }),
    getView: () => view,
    redraw: () => {},
    commit: () => {},
    appendUserAction: () => {},
  } as unknown as StickyDeps;
}

/** A terminal holder of the same shape the extension hands the wiring, without a frame to measure. */
const terminal = { note: () => {} } as unknown as PanelWiringParts["terminal"];

/** One `pi-sticky.ui` entry as the session stores it. */
const uiEntry = (shown: boolean): unknown => ({
  type: "custom",
  customType: UI_TYPE,
  data: { v: 1, shown },
});

/**
 * A `live()` context that records the draft it is asked to write, or throws the way a session whose
 * context is gone does. `mode`/`hasUI` are the two guards `startReply` reads before it touches the ui.
 */
function editorHost(
  opts: { throws?: boolean; text?: string; hasUI?: boolean; mode?: string } = {},
) {
  const calls: { set?: string; notified?: string } = {};
  const ui = {
    getEditorText: () => {
      if (opts.throws) throw new Error("session is gone");
      return opts.text ?? "how about the blue one";
    },
    setEditorText: (text: string) => {
      calls.set = text;
    },
    notify: (message: string, type?: "info" | "warning" | "error") => {
      calls.notified = `${type}:${message}`;
    },
  };
  const live = { hasUI: opts.hasUI ?? true, mode: opts.mode ?? "tui", ui };
  return { live, calls };
}

/** The wiring under test, over the parts a session would supply. */
function panelWiring(parts: Partial<PanelWiringParts> = {}) {
  const notify: string[] = [];
  const rails: number[] = [];
  return {
    notify,
    rails,
    wiring: createPanelWiring({
      deps: stickyDeps(),
      terminal,
      isPanelShown: () => true,
      // The mode cell the wiring hands the owner: a peek is what the extension's own cell answers by
      // default, so the fixture takes the same one the extension builds rather than a hand-rolled stand-in.
      panelMode: () => createPanelMode(DEFAULT_CONFIG),
      setPanelShown: () => {},
      recordPanelShown: () => {},
      dismiss: () => {},
      notify: (message, type) => void notify.push(`${type}:${message}`),
      live: () => undefined,
      redrawRail: () => void rails.push(1),
      onDispose: () => {},
      rpc: () => false,
      ...parts,
    }),
  };
}

/** The parts' `live` member, spelled for a hand-built context. */
const livesAs = (live: unknown): PanelWiringParts["live"] =>
  (() => live) as PanelWiringParts["live"];

test("the wiring hands the panel the members the extension's deps object does not carry", () => {
  const { wiring } = panelWiring();
  expect(wiring.deps.isPanelShown()).toBe(true);
  expect(typeof wiring.redrawRail).toBe("function");
  expect(typeof wiring.themeStyle).toBe("function");
  // The sticky half is *shared*, not copied: the flag and the view are one cell, and a copy of it is how
  // a new pin used to auto-show a panel nothing asked about.
  expect(wiring.deps.getView()).toBe(ONE);
  expect(wiring.deps.config).toBe(DEFAULT_CONFIG);
});

test("startReply puts the marker at the front of the draft the live context holds", () => {
  const host = editorHost();
  const { wiring } = panelWiring({ live: livesAs(host.live) });
  wiring.deps.startReply(3);
  expect(host.calls.set).toBe("Re #3: how about the blue one");
});

test("startReply replaces a marker the draft already carries and keeps the rest verbatim", () => {
  const host = editorHost({ text: "Re #9: keep this draft" });
  const { wiring } = panelWiring({ live: livesAs(host.live) });
  wiring.deps.startReply(4);
  expect(host.calls.set).toBe("Re #4: keep this draft");
});

test("a host with no editor to write to is a reply that does nothing, not a throw", () => {
  // `print` and `json` have no UI at all and rpc has no editor; `startReply` is reached from a key, so
  // the answer has to be silence rather than an `extension_error` out of the terminal's input path.
  for (const live of [
    undefined,
    { hasUI: false, mode: "tui", ui: {} },
    { hasUI: true, mode: "rpc", ui: {} },
  ]) {
    const { wiring } = panelWiring({ live: livesAs(live) });
    expect(() => wiring.deps.startReply(1)).not.toThrow();
  }
});

test("a draft the host refuses to read is reported once and swallowed", () => {
  const host = editorHost({ throws: true });
  const { wiring } = panelWiring({ live: livesAs(host.live) });
  expect(() => wiring.deps.startReply(1)).not.toThrow();
  expect(host.calls.notified).toBe("warning:Could not start a reply from the panel.");
});

test("the panel's one notify line reaches the extension's notify, with its type", () => {
  const { wiring, notify } = panelWiring();
  wiring.deps.notify("A panel key could not be handled.", "warning");
  expect(notify).toEqual(["warning:A panel key could not be handled."]);
});

test("the rail's redraw member is the one the wiring was handed", () => {
  // `panel.ts` hands the rail guard an arrow that calls exactly this member and the guard is its only
  // caller; `panel-rail.test.ts` is where *when* it fires is asserted.
  const { wiring, rails } = panelWiring();
  wiring.redrawRail();
  expect(rails).toEqual([1]);
});

test("the panel's own toggles are the extension's, passed through unchanged", () => {
  const shown: boolean[] = [];
  const recorded: boolean[] = [];
  const { wiring } = panelWiring({
    setPanelShown: (value) => void shown.push(value),
    recordPanelShown: (value) => void recorded.push(value),
  });
  wiring.deps.setPanelShown(false);
  wiring.deps.recordPanelShown(true);
  expect(shown).toEqual([false]);
  expect(recorded).toEqual([true]);
});

test("initialShown reads the last ui entry on the branch, and defaults to shown", () => {
  // The read half of the pair the toggles above write to; the malformed-entry cases are in
  // `state-guards.test.ts`. A session with no entry at all is shown, so a first run has a panel.
  const ctx = (entries: unknown[]): HostContext =>
    ({ sessionManager: { getEntries: () => entries } }) as unknown as HostContext;
  expect(initialShown(ctx([]))).toBe(true);
  expect(initialShown(ctx([uiEntry(false)]))).toBe(false);
  expect(initialShown(ctx([uiEntry(false), uiEntry(true)]))).toBe(true);
});
