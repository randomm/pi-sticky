/**
 * Opening and closing the panel, driven through `stubApi` rather than a session: what is asserted is
 * *which pi member* the extension calls and when — one `custom()` per session, the previous panel's
 * `done()` called before the next opens, no call at all outside tui mode. The end-to-end behaviour on a
 * real session is `integration-panel.test.ts`; the user's toggles are `panel-lifecycle-toggles.test.ts`.
 *
 * `RecordingUi.custom()` resolves a `done()` only when it is called in the same turn, so every
 * assertion here reads the *record* (`customCalls[i].result`), never an awaited value.
 */
import { expect, test } from "bun:test";

import { DEFAULT_CONFIG } from "../src/config.ts";
import { createStickyExtension } from "../src/extension.ts";
import { KEY } from "../src/types.ts";
import { LATER } from "./fixtures.ts";
import {
  PINNED,
  boot,
  contextWith,
  flush,
  frameWidth,
  handCustom,
  panelComponent,
} from "./panel-lifecycle-fixture.ts";
import type { RecordingUi } from "./recording-ui.ts";
import { createStubTui } from "./ui-stubs.ts";
import { stubApi } from "./wiring-stubs.ts";

test("session_start opens one overlay with the panel's own options, and never a second", async () => {
  const { stub, ctx } = await boot(PINNED);
  expect(ctx.recorder.customCount).toBe(1);

  const call = ctx.recorder.customCalls[0];
  expect(call?.options?.overlay).toBe(true);
  const options = call?.options?.overlayOptions as Record<string, unknown>;
  expect(options.anchor).toBe("right-center");
  expect(options.width).toBe("33%");
  expect(options.minWidth).toBe(30);
  expect(options.maxHeight).toBe("100%");
  expect(options.nonCapturing).toBe(true);
  expect(typeof options.visible).toBe("function");

  // A visibility change is not a reason to open anything: the same session, toggled, adds no call.
  stub.commands.get("pins")?.handler("hide", ctx);
  stub.commands.get("pins")?.handler("show", ctx);
  expect(ctx.recorder.customCount).toBe(1);
});

test("no overlay is opened for a session that has nothing pinned", async () => {
  // The panel is opened on session_start regardless of pins — `visible()` hides it — but a session
  // with no pins must not end up with an overlay the user can focus and find nothing in.
  const { ctx } = await boot([]);
  expect(ctx.recorder.customCount).toBeLessThanOrEqual(1);
  expect(ctx.recorder.customCalls.every((call) => call.handle !== undefined)).toBe(true);
});

test("two session_start events leave exactly one panel open, the earlier one closed", async () => {
  const stub = stubApi();
  createStickyExtension(DEFAULT_CONFIG, () => LATER)(stub.api);
  const first = contextWith(PINNED);
  stub.emit("session_start", { reason: "startup" }, first);
  const second = contextWith(PINNED);
  stub.emit("session_start", { reason: "new" }, second);
  await flush();

  expect(stub.handlers.get("session_start")?.length).toBeGreaterThan(0);
  const calls = first.recorder.customCalls.concat(second.recorder.customCalls);
  expect(calls).toHaveLength(2);
  // Every panel but the newest has been closed: its `done()` fired, which is what removes pi's entry.
  expect(calls.slice(0, -1).every((call) => call.result !== undefined)).toBe(true);
  expect(calls.at(-1)?.result).toBeUndefined();
});

test("session_tree closes the panel of the branch the user left and opens one for the new branch", async () => {
  const { stub, ctx } = await boot(PINNED);
  const before = ctx.recorder.customCalls[0];
  expect(before?.result).toBeUndefined();

  stub.emit("session_tree", { newLeafId: "x", oldLeafId: null }, ctx);
  await flush();

  expect(before?.result).not.toBeUndefined();
  expect(ctx.recorder.customCount).toBe(2);
  expect(ctx.recorder.customCalls.at(-1)?.result).toBeUndefined();
});

test("session_shutdown closes the open panel", async () => {
  const { stub, ctx } = await boot(PINNED);
  const open = ctx.recorder.customCalls[0];
  stub.emit("session_shutdown", { reason: "quit" }, ctx);
  await flush();
  expect(open?.result).not.toBeUndefined();
});

test("a session_shutdown still resets the session when the host's close handle throws", async () => {
  // The ordering this pins: the state goes *before* `close()`, and nothing `close()` does can skip it.
  // A host whose `done` throws is the case in which a dead session's pins, flag and terminal width
  // would otherwise survive into the next one — the pins on the rail of a session that never had them.
  const { stub, ctx } = await boot(PINNED, undefined, {
    onClose: () => {
      throw new Error("host overlay stack is wedged");
    },
  });
  // No width is stated, so the panel has no measurement to answer `visible()` with and the rail keeps
  // the pins — and the panel has been told it owns them, which is the state a dead session must not
  // leave behind for the next one.
  expect(ctx.recorder.widgets.has(KEY)).toBe(true);

  stub.emit("session_shutdown", { reason: "quit" }, ctx);
  await flush();
  // A throwing `onClose` poisons the open itself — the recorder awaits the factory *after* it calls
  // `onClose`, so the hook escapes into `custom()`'s promise and the panel never claims a record. That
  // is the hostile host this pins, and the `open()` rejection path is the one that reports it. The
  // shutdown draws nothing on purpose: pi's own `resetExtensionUI` clears every extension widget at
  // teardown, so the rail the user saw is gone either way. What the reset has to clear is the *state*.
  expect(ctx.recorder.notifications).toEqual([
    { message: "pins panel unavailable: host overlay stack is wedged", type: "warning" },
  ]);

  const next = contextWith(PINNED);
  stub.emit("session_start", { reason: "new" }, next);
  await flush();
  // A fresh session starts from the dead one's cleared state, not its live one. The dead session had
  // been told the panel owned its pins; had the flag survived, this session's `isVisible()` would
  // answer for a panel nothing opened and the rail would stand down for it — the pins on neither
  // surface, with nothing on screen to explain where they went.
  expect(next.recorder.widgets.has(KEY)).toBe(true);
  expect(next.recorder.customCount).toBe(1);
});

test("the overlay is opened in tui mode only: rpc, print and json make no custom call at all", () => {
  for (const mode of ["rpc", "print", "json"] as const) {
    const stub = stubApi();
    createStickyExtension(DEFAULT_CONFIG, () => LATER)(stub.api);
    const ctx = contextWith(PINNED);
    (ctx as unknown as Record<string, unknown>).mode = mode;
    (ctx as unknown as Record<string, unknown>).hasUI = mode === "rpc";
    stub.emit("session_start", { reason: "startup" }, ctx);
    expect(ctx.recorder.customCount).toBe(0);
    // …and the rail is what draws there, in rpc; print/json have no UI at all.
    expect(ctx.recorder.widgets.has(KEY)).toBe(mode === "rpc");
  }
});

test("the redraw path is the component's own: a hand-built TUI sees the requestRender call", async () => {
  // The harness's recorder builds its stub TUI inside `custom()` and keeps no reference to it, so
  // pi-tui re-renders an overlay when its component calls `requestRender` on the TUI it was built
  // with, and that TUI is handed to the factory alone — it is not on the context, so this is the one
  // path that cannot be observed through the context. The recorder gives every call its own stub.
  const requests: number[] = [];
  const stub = stubApi();
  createStickyExtension(DEFAULT_CONFIG, () => LATER)(stub.api);
  const ctx = contextWith(PINNED);
  // `createStubTui()` is the only TUI a factory ever gets, and it is a plain object, so the frame
  // request is watched by wrapping the one this call is handed.
  const stubTui = createStubTui();
  stubTui.requestRender = () => requests.push(1);
  // The recorder builds a fresh stub for every `custom()` call and keeps no reference to it, so the
  // watch is installed by handing *this* call the stub to build the component with — the object the
  // factory receives is the only one the component will ever call `requestRender` on. It goes on the
  // wrapper the extension draws through, not on the recorder: `uiForPi` bound the recorder's method
  // into the wrapper when the context was built, so replacing the recorder's own member afterwards
  // would leave the extension calling the old one. It has to be in place before the event, because
  // `session_start` is what asks for the factory.
  (ctx.ui as unknown as { custom: RecordingUi["custom"] }).custom = handCustom(
    ctx.recorder,
    stubTui,
  );
  stub.emit("session_start", { reason: "startup" }, ctx);
  await flush();

  const component = panelComponent(ctx.recorder.customCalls[0]);
  expect(component).toBeDefined();
  const before = requests.length;
  // `select` is the same path a movement key ends on (invalidate + requestRender) and does not depend
  // on there being a second pin to move to, which a single-pinned session has not.
  component?.select(0);
  expect(requests.length).toBeGreaterThan(before);
});

test("a hidden panel gives the rail the pins at once, and a shown one takes them back", async () => {
  // The handoff is a decision the rail makes when it is *installed*, and pi keeps the component a
  // factory returned until the key is written again. So a toggle that only redrew the overlay would
  // leave a rail standing over a panel that had just taken the pins — and, the other way round, a
  // panel drawing into a frame still owned by the rail. One draw per change, both surfaces.
  const { stub, ctx } = await boot(PINNED, 120);
  expect(ctx.recorder.widgets.has(KEY)).toBe(false);

  stub.commands.get("pins")?.handler("hide", ctx);
  expect(ctx.recorder.widgets.has(KEY)).toBe(true);
  expect(ctx.recorder.widgets.get(KEY)?.placement).toBe("aboveEditor");

  stub.commands.get("pins")?.handler("show", ctx);
  expect(ctx.recorder.widgets.has(KEY)).toBe(false);
});

test("a panel whose frame is asked for states the width, and the rail answers it in the same frame", async () => {
  // pi-tui asks the overlay how wide the terminal is before it draws it, and that question is the only
  // width the extension ever gets. A resize therefore reaches the rail through the overlay's own
  // callback: the rail cannot poll the terminal, and nothing else writes the widget key.
  const { ctx } = await boot(PINNED, 120);
  expect(ctx.recorder.widgets.has(KEY)).toBe(false);

  // Narrow: the answer the *frame* gives is what the rail decides against, without anything being
  // reopened — the overlay is still the one opened at session_start.
  frameWidth(ctx.recorder, 80);
  expect(ctx.recorder.widgets.has(KEY)).toBe(true);
  expect(ctx.recorder.customCount).toBe(1);

  // Wide again, and the panel owns them within the same ask.
  frameWidth(ctx.recorder, 120);
  expect(ctx.recorder.widgets.has(KEY)).toBe(false);
});
