/**
 * The extension's own lifecycle: who owns the state, when it is re-read from the session, and what
 * happens to the context kept for redraws. These use a recorded `ExtensionAPI` rather than a
 * session, because the point is which pi member is called with what — the harness covers the
 * end-to-end behaviour in `integration.test.ts`.
 */
import { expect, test } from "bun:test";
import type { ExtensionContext, SessionEntry } from "@earendil-works/pi-coding-agent";

import { DEFAULT_CONFIG, readConfig } from "../src/config.ts";
import { createStickyExtension } from "../src/extension.ts";
import { KEY, TOOL_NAME, USER_TYPE } from "../src/types.ts";
import { LATER, NOW } from "./fixtures.ts";
import "./env-clear.ts";
import { piContext } from "./pi-context.ts";
import { RecordingUi } from "./recording-ui.ts";
import { stubApi } from "./wiring-stubs.ts";

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
 * a test can read the drawn rows with `renderWidget` exactly as an integration test does — the one
 * builder the extension-driven tests share (see `pi-context.ts`), read here with the recorder exposed
 * as the recorder itself rather than as `uiForPi`'s wrapper.
 */
function contextWith(entries: unknown[]): ExtensionContext & { ui: RecordingUi } {
  const ui = new RecordingUi();
  return piContext(entries, ui) as unknown as ExtensionContext & { ui: RecordingUi };
}

function boot(entries: unknown[] = []) {
  const stub = stubApi();
  createStickyExtension(DEFAULT_CONFIG, () => LATER)(stub.api);
  const ctx = contextWith(entries);
  stub.emit("session_start", { reason: "startup" }, ctx);
  return { stub, ctx };
}

test("the suite's ambient environment leaves the extension enabled", () => {
  // M11. The one thing this file cannot establish for itself: whether `env-clear.ts` had already emptied
  // the environment by the time its module-scope builders ran. `env-clear-coverage.test.ts` is where that
  // is witnessed; this case only reads what it finds, which is why it fails on its own under an ambient
  // disable rather than passing on a recorder that registered nothing.
  expect(readConfig(process.env).disabled).toBe(false);
  const { stub } = boot();
  expect(stub.tools).toHaveLength(1);
  expect([...stub.commands.keys()].sort()).toEqual(["pins", "unpin"]);
  expect(stub.handlers.size).toBeGreaterThan(0);
});

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
      "input",
      "session_compact",
      "session_shutdown",
      "session_start",
      "session_tree",
      "turn_end",
    ].sort(),
  );
});

/**
 * The commit-before-append window: `execute` adopts the new state, pi appends the tool result only
 * afterwards, and if that append never lands (an aborted turn) memory runs ahead of the session.
 * `turn_end` is the first point after every append of the turn, so it is where the two are reconciled.
 */
test("a state committed without a matching tool result on the branch is reconciled away at turn_end", async () => {
  const stub = stubApi();
  createStickyExtension(DEFAULT_CONFIG, () => LATER)(stub.api);
  // The branch holds nothing: pi never appended the result that carried this snapshot.
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
  await tool.execute("c1", { action: "pin", text: "Decide X" }, undefined, undefined, ctx);
  // Committed, so the rail shows it — until the turn ends and the session gets a vote.
  expect(ctx.ui.widgets.has(KEY)).toBe(true);

  stub.emit("turn_end", { turnIndex: 0, toolResultEntryIds: [] }, ctx);

  expect(ctx.ui.widgets.has(KEY)).toBe(false);
  // The tool reads its own state back through deps, so the pin is gone from that too: an `unpin`
  // after this point cannot record a dismissal against a pin the session never held.
  const list = await tool.execute("c2", { action: "list" }, undefined, undefined, ctx);
  expect(list.content[0]?.text).toContain("Pinned for the user now (0 of");
});

test("turn_end keeps a pin whose tool result is on the branch, and clears only the gone ones", async () => {
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
  await tool.execute("c1", { action: "pin", text: "Kept" }, undefined, undefined, ctx);
  // The append landed: the branch now carries the snapshot the tool published.
  const appended = [
    pinEntry([{ id: 1, uid: "aaaa1111", text: "Kept", level: "info", createdAt: LATER }], 2),
  ] as unknown as SessionEntry[];
  ctx.sessionManager.getBranch = () => appended;
  ctx.sessionManager.getEntries = () => appended;

  stub.emit("turn_end", { turnIndex: 0, toolResultEntryIds: [] }, ctx);

  const lines = ctx.ui.renderWidget(KEY, 80);
  expect(lines[0]).toContain("📌 Pinned for you (1)");
  expect(lines[1]).toContain("Kept");
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
