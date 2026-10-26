/**
 * The extension's own lifecycle: who owns the state, when it is re-read from the session, and what
 * happens to the context kept for redraws. These use a recorded `ExtensionAPI` rather than a
 * session, because the point is which pi member is called with what — the harness covers the
 * end-to-end behaviour in `integration.test.ts`.
 */
import { expect, test } from "bun:test";
import type { ExtensionContext, SessionEntry } from "@earendil-works/pi-coding-agent";

import { DEFAULT_CONFIG } from "../src/config.ts";
import { createStickyExtension } from "../src/extension.ts";
import { KEY, TOOL_NAME, USER_TYPE } from "../src/types.ts";
import { LATER, NOW } from "./fixtures.ts";
import { RecordingUi } from "./recording-ui.ts";
import { stubApi, uiForPi } from "./wiring-stubs.ts";

/** A branch entry holding a `pin_for_user` snapshot, in the shape pi stores it. */
function pinEntry(
  pins: { id: number; uid: string; text: string; level: string; createdAt: string }[],
  nextId: number,
): unknown {
  return {
    type: "message",
    message: {
      role: "toolResult",
      toolCallId: "call-1",
      toolName: TOOL_NAME,
      content: [{ type: "text", text: "ok" }],
      details: {
        v: 1,
        pins: pins.map((pin) => ({ ...pin, source: "agent", updatedAt: pin.createdAt })),
        nextId,
        removed: [],
      },
      isError: false,
      timestamp: 0,
    },
  };
}

function userEntry(uid: string, at: string): unknown {
  return { type: "custom", customType: USER_TYPE, data: { v: 1, uid, action: "dismiss", at } };
}

/**
 * A context whose session manager returns these entries and whose ui is the harness recorder, so
 * a test can read the drawn rows with `renderWidget` exactly as an integration test does. The
 * recorder is a class, so it is handed over through `uiForPi`'s own-property wrapper — the same
 * shape pi's spread produces.
 */
function contextWith(entries: unknown[]): ExtensionContext & { ui: RecordingUi } {
  const ui = new RecordingUi();
  // Cast at the seam: the extension only reads entries through `getBranch`/`getEntries`, whose
  // return type pi spells `SessionEntry[]`; the entries built above are those shapes, and the
  // harness's own `SessionEntryLike` is the same structural subset spelled for tests.
  const branch = entries as SessionEntry[];
  const ctx = {
    hasUI: true,
    mode: "tui",
    ui: uiForPi(ui),
    sessionManager: { getBranch: () => branch, getEntries: () => branch },
  };
  return { ...ctx, ui } as unknown as ExtensionContext & { ui: RecordingUi };
}

function boot(entries: unknown[] = []) {
  const stub = stubApi();
  createStickyExtension(DEFAULT_CONFIG, () => LATER)(stub.api);
  const ctx = contextWith(entries);
  stub.emit("session_start", { reason: "startup" }, ctx);
  return { stub, ctx };
}

test("a disabled config registers nothing at all", () => {
  const stub = stubApi();
  createStickyExtension({ ...DEFAULT_CONFIG, disabled: true })(stub.api);
  expect(stub.tools).toEqual([]);
  expect([...stub.commands.keys()]).toEqual([]);
  expect([...stub.handlers.keys()]).toEqual([]);
});

test("an enabled config registers the tool, both commands and the lifecycle handlers", () => {
  const { stub } = boot();
  expect(stub.tools.map((tool) => tool.name)).toEqual([TOOL_NAME]);
  expect([...stub.commands.keys()].sort()).toEqual(["pins", "unpin"]);
  expect([...stub.handlers.keys()].sort()).toEqual(
    [
      "before_agent_start",
      "session_compact",
      "session_shutdown",
      "session_start",
      "session_tree",
    ].sort(),
  );
});

test("session_start rebuilds the rail from the branch snapshot", () => {
  const { ctx } = boot([
    pinEntry([{ id: 1, uid: "aaaa1111", text: "Decide X", level: "info", createdAt: LATER }], 2),
  ]);
  const lines = ctx.ui.renderWidget(KEY, 80);
  expect(lines[0]).toContain("📌 Pinned for you (1)");
  expect(lines[1]).toContain("• #1");
  expect(lines[1]).toContain("Decide X");
});

test("an empty branch draws no rail: the key is cleared, not filled with nothing", () => {
  const { ctx } = boot([
    pinEntry([{ id: 1, uid: "aaaa1111", text: "Gone", level: "info", createdAt: LATER }], 2),
  ]);
  expect(ctx.ui.widgets.has(KEY)).toBe(true);

  // The same session with the snapshot no longer on the branch (`/tree` back before it).
  const ctx2 = contextWith([]);
  const stub = stubApi();
  createStickyExtension(DEFAULT_CONFIG, () => LATER)(stub.api);
  ctx2.sessionManager.getBranch = () => [];
  ctx2.sessionManager.getEntries = () => [];
  stub.emit("session_start", { reason: "startup" }, ctx2);
  expect(ctx2.ui.widgets.has(KEY)).toBe(false);
});

test("a user dismissal in the entries hides its pin at session_start", () => {
  const entries = [
    pinEntry([{ id: 1, uid: "aaaa1111", text: "Decide X", level: "info", createdAt: LATER }], 2),
    userEntry("aaaa1111", LATER),
  ];
  const { ctx } = boot(entries);
  expect(ctx.ui.widgets.has(KEY)).toBe(false);
});

test("session_tree redraws from the new branch", () => {
  const { stub, ctx } = boot([]);
  const later = pinEntry(
    [{ id: 2, uid: "bbbb2222", text: "Later pin", level: "warning", createdAt: LATER }],
    3,
  );
  const laterBranch = [later] as unknown as SessionEntry[];
  ctx.sessionManager.getBranch = () => laterBranch;
  ctx.sessionManager.getEntries = () => laterBranch;

  stub.emit("session_tree", { newLeafId: "x", oldLeafId: null }, ctx);
  const lines = ctx.ui.renderWidget(KEY, 80);
  expect(lines.some((line) => line.includes("Later pin"))).toBe(true);
});

test("after shutdown the kept context is dropped, and a fresh start draws again", () => {
  const stub = stubApi();
  createStickyExtension(DEFAULT_CONFIG, () => LATER)(stub.api);
  const entries = [
    pinEntry([{ id: 1, uid: "aaaa1111", text: "Decide X", level: "info", createdAt: LATER }], 2),
  ];
  const ctx = contextWith(entries);
  stub.emit("session_start", { reason: "startup" }, ctx);
  expect(ctx.ui.widgets.has(KEY)).toBe(true);

  stub.emit("session_shutdown", { reason: "quit" }, ctx);

  // A dropped context is never used again: this recorder throws on any member access pi-sticky
  // might ask of it, so a leak of the old context fails the test rather than drawing silently.
  const dead = new Proxy(
    {},
    {
      get: () => {
        throw new Error("used a dropped context");
      },
    },
  );
  expect(() => stub.emit("before_agent_start", { systemPrompt: "p" }, dead)).not.toThrow();

  // The next session's own `session_start` draws from its own context, empty until it reads them.
  const next = contextWith(entries);
  next.sessionManager.getBranch = () => [];
  next.sessionManager.getEntries = () => [];
  stub.emit("session_start", { reason: "new" }, next);
  expect(next.ui.widgets.has(KEY)).toBe(false);
});

test("the tool draws without a context of its own: it uses the one session_start left", () => {
  const stub = stubApi();
  createStickyExtension(DEFAULT_CONFIG, () => LATER)(stub.api);
  const ctx = contextWith([]);
  stub.emit("session_start", { reason: "startup" }, ctx);

  const tool = stub.tools[0] as {
    execute: (
      id: string,
      args: unknown,
      signal: undefined,
      onUpdate: undefined,
      ctx: unknown,
    ) => Promise<{ content: { text: string }[] }>;
  };
  // pi hands `execute` a tool context; the rail must come from it, not from the old one.
  const toolCtx = contextWith([]);
  return tool
    .execute("c1", { action: "pin", text: "Decide X" }, undefined, undefined, toolCtx)
    .then(() => {
      expect(toolCtx.ui.widgets.has(KEY)).toBe(true);
    });
});

test("the clock is the only source of time: a pin is stamped with what it returns", async () => {
  const stub = stubApi();
  createStickyExtension(DEFAULT_CONFIG, () => NOW)(stub.api);
  const ctx = contextWith([]);
  stub.emit("session_start", { reason: "startup" }, ctx);

  const tool = stub.tools[0] as {
    execute: (
      id: string,
      args: unknown,
      signal: undefined,
      onUpdate: undefined,
      ctx: unknown,
    ) => Promise<{ content: { text: string }[]; details: { pins: { createdAt: string }[] } }>;
  };
  const result = await tool.execute(
    "c1",
    { action: "pin", text: "Decide X" },
    undefined,
    undefined,
    ctx,
  );
  expect(result.details.pins[0]?.createdAt).toBe(NOW);
});
