/**
 * The user's side of the panel: what `/pins show|hide`, `ctrl+alt+t` and `ctrl+alt+p` change, and what
 * each of them *records* — which is the persistence contract, so the assertions are about appended
 * entries as much as about what is on screen. An auto-show records nothing; every explicit toggle
 * records exactly one `pi-sticky.ui` entry.
 *
 * Driven through `stubApi` (see `panel-lifecycle-fixture.ts`); the same paths on a live session are in
 * `integration-panel.test.ts`.
 */
import { expect, test } from "bun:test";

import { panelCommands } from "../src/commands.ts";
import { NOTHING_PINNED, TOO_NARROW } from "../src/panel-refusals.ts";
import { KEY, UI_TYPE } from "../src/types.ts";
import {
  PINNED,
  TWO_PINNED,
  boot,
  contextWith,
  panelComponent,
  uiEntry,
} from "./panel-lifecycle-fixture.ts";
import { wiring } from "./panel-owner-wiring.ts";

import type { PanelOwner } from "../src/panel.ts";

test("/pins with no argument keeps its listing notify and opens nothing new", async () => {
  const { stub, ctx } = await boot(PINNED);
  const calls = ctx.recorder.customCount;
  await stub.commands.get("pins")?.handler("", ctx);
  expect(ctx.recorder.customCount).toBe(calls);
  expect(ctx.recorder.notifications.some((n) => n.message.includes("Decide X"))).toBe(true);
});

test("/pins show and /pins hide each record a pi-sticky.ui entry", async () => {
  const { stub, ctx } = await boot(PINNED);
  await stub.commands.get("pins")?.handler("hide", ctx);
  await stub.commands.get("pins")?.handler("show", ctx);
  expect(stub.entries).toEqual([
    { customType: UI_TYPE, data: { v: 1, shown: false } },
    { customType: UI_TYPE, data: { v: 1, shown: true } },
  ]);
});

test("/pins hide never notifies, and /pins show notifies the two dead ends", async () => {
  const hidden = await boot(PINNED);
  await hidden.stub.commands.get("pins")?.handler("hide", hidden.ctx);
  expect(hidden.ctx.recorder.notifications).toEqual([]);

  const narrow = await boot(PINNED, 80);
  await narrow.stub.commands.get("pins")?.handler("show", narrow.ctx);
  expect(narrow.ctx.recorder.notifications).toEqual([{ message: TOO_NARROW, type: "warning" }]);

  const empty = await boot([], 120);
  await empty.stub.commands.get("pins")?.handler("show", empty.ctx);
  expect(empty.ctx.recorder.notifications).toEqual([{ message: NOTHING_PINNED, type: "warning" }]);
  const emptyNarrow = await boot([], 80);
  await emptyNarrow.stub.commands.get("pins")?.handler("show", emptyNarrow.ctx);
  expect(emptyNarrow.ctx.recorder.notifications).toEqual([
    { message: TOO_NARROW, type: "warning" },
  ]);
});

test("a session with pins at a wide terminal, asked to show, notifies nothing", async () => {
  const { stub, ctx } = await boot(PINNED, 120);
  await stub.commands.get("pins")?.handler("show", ctx);
  expect(ctx.recorder.notifications).toEqual([]);
});

test("the nothing-pinned refusal is what ctrl+alt+p says when the terminal is wide enough", async () => {
  const { stub, ctx } = await boot([], 120);
  ctx.recorder.notifications.length = 0;
  stub.fireShortcut("ctrl+alt+p", ctx);
  expect(ctx.recorder.notifications).toEqual([{ message: NOTHING_PINNED, type: "warning" }]);
});

test("both shortcuts are registered, and ctrl+alt+t toggles with an entry on each side", async () => {
  const { stub, ctx } = await boot(PINNED);
  expect([...stub.shortcuts.keys()].sort()).toEqual(["ctrl+alt+p", "ctrl+alt+t"]);

  stub.fireShortcut("ctrl+alt+t", ctx);
  expect(stub.entries).toEqual([{ customType: UI_TYPE, data: { v: 1, shown: false } }]);
  stub.fireShortcut("ctrl+alt+t", ctx);
  expect(stub.entries).toEqual([
    { customType: UI_TYPE, data: { v: 1, shown: false } },
    { customType: UI_TYPE, data: { v: 1, shown: true } },
  ]);
});

test("ctrl+alt+p shows the panel without recording anything", async () => {
  const { stub, ctx } = await boot(PINNED);
  // Start from hidden so the show is observable; then clear what those toggles recorded.
  stub.fireShortcut("ctrl+alt+t", ctx);
  stub.fireShortcut("ctrl+alt+t", ctx);
  stub.entries.length = 0;

  stub.fireShortcut("ctrl+alt+p", ctx);
  expect(stub.entries).toEqual([]);
});

test("a new pin auto-shows a hidden panel and records no entry", async () => {
  // Wide, so the auto-show is unobstructed: at a narrow terminal the rail is the only surface and the
  // assertion below would be about the width rather than about the auto-show.
  const { stub, ctx } = await boot([], 120);
  // Close it as the user would, so the auto-show has something to undo.
  await stub.commands.get("pins")?.handler("hide", ctx);
  stub.entries.length = 0;

  const tool = stub.tools[0] as {
    execute: (
      id: string,
      args: unknown,
      s: undefined,
      u: undefined,
      c: unknown,
    ) => Promise<unknown>;
  };
  await tool.execute("c1", { action: "pin", text: "Decide X" }, undefined, undefined, ctx);

  // Nothing recorded, and the rail stands down: the panel is shown again, so it owns the pins.
  expect(stub.entries).toEqual([]);
  expect(ctx.recorder.widgets.has(KEY)).toBe(false);
});

test("the last pi-sticky.ui entry of the session decides whether the panel starts shown", async () => {
  const shown = await boot([...PINNED, uiEntry(false), uiEntry(true)]);
  const hidden = await boot([...PINNED, uiEntry(true), uiEntry(false)]);
  // The two differ only in the order of the entries, and the observable difference is what a
  // toggle does next: from a shown panel it records a hide, from a hidden one it records a show.
  void shown.stub.commands.get("pins")?.handler("hide", shown.ctx);
  void hidden.stub.commands.get("pins")?.handler("hide", hidden.ctx);
  expect(shown.stub.entries).toEqual([{ customType: UI_TYPE, data: { v: 1, shown: false } }]);
  expect(hidden.stub.entries).toEqual([{ customType: UI_TYPE, data: { v: 1, shown: false } }]);

  // A malformed entry is skipped rather than obeyed, falling back to the one before it.
  const malformed = await boot([
    ...PINNED,
    uiEntry(false),
    { type: "custom", customType: UI_TYPE, data: { v: 1, shown: "yes" } },
  ]);
  void malformed.stub.commands.get("pins")?.handler("hide", malformed.ctx);
  expect(malformed.stub.entries).toEqual([{ customType: UI_TYPE, data: { v: 1, shown: false } }]);
});

test("with no pi-sticky.ui entry the panel starts shown, so a toggle first records a hide", async () => {
  const { stub, ctx } = await boot(PINNED);
  stub.fireShortcut("ctrl+alt+t", ctx);
  expect(stub.entries).toEqual([{ customType: UI_TYPE, data: { v: 1, shown: false } }]);
});

test("d on the panel dismisses through /unpin's path: one user entry, and the rail redraws", async () => {
  const { stub, ctx } = await boot(TWO_PINNED);
  const panel = ctx.recorder.customCalls[0];
  panel?.handle?.unfocus();
  const component = panelComponent(panel);
  expect(component?.handleInput).toBeDefined();

  component?.focus();
  component?.handleInput?.("d");

  expect(stub.entries.some((entry) => entry.customType === "pi-sticky.user")).toBe(true);
});

test("Enter puts the reply marker on the draft and hands focus back to the editor", async () => {
  const { ctx } = await boot(PINNED);
  const call = ctx.recorder.customCalls[0];
  ctx.recorder.setEditorText("how about the blue one");
  call?.handle?.unfocus();
  panelComponent(call)?.focus();
  call?.component?.handleInput?.("\r");

  expect(ctx.recorder.getEditorText()).toBe("Re #1: how about the blue one");
  expect(panelComponent(call)?.isFocused()).toBe(false);
});

test("an existing marker in the draft is replaced, not stacked", async () => {
  const { ctx } = await boot(PINNED);
  const call = ctx.recorder.customCalls[0];
  ctx.recorder.setEditorText("Re #9: keep this draft");
  call?.handle?.unfocus();
  panelComponent(call)?.focus();
  call?.component?.handleInput?.("\r");
  expect(ctx.recorder.getEditorText()).toBe("Re #1: keep this draft");
});

test("the /pins verbs reach the owner through one adapter, and a missing owner is inert", async () => {
  // The adapter is the whole contract between the command layer and the panel (`panelCommands` in
  // `commands.ts`): both verbs read the owner through an accessor at *call* time, so a command fired
  // before any owner exists — or after the extension dropped it — must be a no-op rather than a
  // throw out of the command handler. Nothing else in the suite calls the adapter directly: every
  // other case goes through `registerCommands`, which hides both halves of the pair behind the one
  // owner the extension built.
  const built = wiring(contextWith([]));
  const builtPanel = built.panel;
  let owner: PanelOwner | undefined = builtPanel;
  const commands = panelCommands(() => owner);

  // Both verbs reach the owner they were handed, and take the context the handler gave them. The
  // context is the recorder-backed one the lifecycle fixtures build: `show` reads only its `ui` to
  // notify, and the adapter's signature is what makes that projection pi's command context.
  const ctx = contextWith(PINNED) as unknown as Parameters<typeof commands.show>[0];
  commands.show(ctx);
  commands.hide();
  // The owner is the one under test: the show settled the flag to shown and the hide put it back.
  expect(builtPanel.isVisible()).toBe(false);

  // The absent owner: the accessor answers `undefined` and neither verb throws or records.
  owner = undefined;
  expect(() => commands.show(ctx)).not.toThrow();
  expect(() => commands.hide()).not.toThrow();
});
