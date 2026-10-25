/**
 * Coverage for the parts of the harness that later tickets lean on but the spike tests do
 * not reach: the command-context actions an extension can call, `appendScript`,
 * `messageText` for both content shapes, and the stub TUI / overlay handle members a panel
 * component calls.
 */
import { expect, test } from "bun:test";
import type { ExtensionAPI, ExtensionFactory } from "@earendil-works/pi-coding-agent";
import {
  createHarness,
  createOverlayHandle,
  createStubTui,
  messageText,
  reply,
} from "./harness.ts";

test("messageText joins text blocks and passes string content through", () => {
  expect(messageText({ role: "user", content: "plain", timestamp: 0 } as never)).toBe("plain");
  expect(
    messageText({
      role: "user",
      content: [
        { type: "text", text: "one" },
        { type: "image", data: "aGk=", mimeType: "image/png" },
      ],
      timestamp: 0,
    } as never),
  ).toBe("one");
});

test("harness appendScript queues on top of the scripted responses", async () => {
  const h = await createHarness();
  try {
    h.script([reply("first")]);
    h.appendScript([reply("second")]);
    expect(h.faux.getPendingResponseCount()).toBe(2);
    await h.run("a");
    expect(h.faux.getPendingResponseCount()).toBe(1);
    await h.run("b");
    expect(h.faux.getPendingResponseCount()).toBe(0);
    expect(h.requests).toHaveLength(2);
  } finally {
    await h.dispose();
  }
});

test("command context actions reach the session through the harness", async () => {
  const seen: string[] = [];
  const probe: ExtensionFactory = (pi: ExtensionAPI) => {
    pi.registerCommand("probe", {
      description: "Exercise the command context",
      handler: async (_args, ctx) => {
        seen.push(`idle:${ctx.isIdle()}`);
        seen.push(`mode:${ctx.mode}`);
        // The navigation actions are the ones a panel or reply flow needs; the ones the
        // harness does not wire to real session control report a no-op cancellation.
        // `nope` is not an entry, so the session-control stubs report a no-op while the
        // real navigateTree would reject an unknown id: target the current leaf, which pi
        // treats as a no-op navigation returning { cancelled: false }.
        seen.push(`fork:${(await ctx.fork("nope")).cancelled}`);
        seen.push(`new:${(await ctx.newSession()).cancelled}`);
        seen.push(`switch:${(await ctx.switchSession("nope")).cancelled}`);
        seen.push(
          `navigate:${(await ctx.navigateTree(ctx.sessionManager.getLeafId() ?? "")).cancelled}`,
        );
        await ctx.waitForIdle();
      },
    });
  };
  const h = await createHarness({ factories: [probe] });
  try {
    await h.run("/probe");
    // The harness routes navigateTree to the real session and stubs the session-control
    // actions, which report a no-op ({ cancelled: false }) rather than replacing the session.
    expect(seen).toEqual([
      "idle:true",
      "mode:tui",
      "fork:false",
      "new:false",
      "switch:false",
      "navigate:false",
    ]);
    // Commands consume the prompt, so no model request was made.
    expect(h.requests).toHaveLength(0);
    // Commands run through the bound UI, so a widget set from one is recorded.
    h.ui.setWidget("pi-sticky", ["from command"]);
    expect(h.ui.renderWidget("pi-sticky", 40)).toEqual(["from command"]);
  } finally {
    await h.dispose();
  }
});

test("stub TUI satisfies the members a widget or panel factory calls", async () => {
  const h = await createHarness();
  try {
    const tui = createStubTui();
    const disposals: string[] = [];
    // The stub reports a fixed geometry so a widget renders at a known width, and starts
    // with no children until a factory adds one.
    expect(tui.children).toEqual([]);
    expect(tui.terminal.columns).toBe(80);
    expect(tui.terminal.rows).toBe(24);

    const child = { render: () => ["x"], invalidate: () => disposals.push("invalidate") };
    tui.addChild(child);
    expect(tui.children).toContain(child);
    tui.removeChild(child);
    tui.clear();
    tui.setFocus(child);
    tui.start();
    tui.stop();
    tui.renderNow();
    tui.requestRender();
    tui.setShowHardwareCursor(true);
    tui.setClearOnShrink(true);
    expect(tui.getShowHardwareCursor()).toBe(false);
    expect(tui.getClearOnShrink()).toBe(false);
    expect(tui.hasOverlay()).toBe(false);

    const handle = tui.showOverlay(child);
    handle.focus();
    expect(handle.isFocused()).toBe(true);
    handle.setHidden(true);
    expect(handle.isHidden()).toBe(true);
    handle.unfocus();
    expect(handle.isFocused()).toBe(false);
    handle.hide();
    tui.hideOverlay();

    const unsubscribe = tui.addInputListener(() => undefined);
    unsubscribe();
    tui.removeInputListener(() => undefined);
    tui.onTerminalColorSchemeChange(() => {});
    tui.setTerminalColorSchemeNotifications(true);
    const colors = await tui.queryTerminalColors({ timeoutMs: 1 });
    // The stub reports no scheme, so both colours come back unset rather than as an RgbColor.
    expect(colors.foreground).toBeUndefined();
    expect(colors.background).toBeUndefined();
    expect(tui.render(80)).toEqual([]);
    child.invalidate();
    expect(disposals).toEqual(["invalidate"]);
  } finally {
    await h.dispose();
  }
});

test("overlay handle records focus and visibility transitions", () => {
  const handle = createOverlayHandle();
  expect(handle.isFocused()).toBe(true);
  expect(handle.isHidden()).toBe(false);
  handle.setHidden(true);
  expect(handle.isHidden()).toBe(true);
  handle.setHidden(false);
  expect(handle.isHidden()).toBe(false);
  handle.unfocus();
  expect(handle.isFocused()).toBe(false);
  handle.focus();
  expect(handle.isFocused()).toBe(true);
  expect(handle.getBounds()).toBeUndefined();
  handle.hide();
  expect(handle.isHidden()).toBe(true);
  expect(handle.isFocused()).toBe(false);
});

test("harness surfaces extension errors raised during a run", async () => {
  const boom: ExtensionFactory = (pi: ExtensionAPI) => {
    pi.on("agent_start", () => {
      throw new Error("PROBE-BOOM");
    });
  };
  const h = await createHarness({ factories: [boom] });
  try {
    h.script([reply("ok")]);
    await expect(h.run("go")).rejects.toThrow("PROBE-BOOM");
  } finally {
    await h.dispose();
  }
});

test("a later run does not re-throw an error from an earlier one", async () => {
  let failOnce = true;
  const boom: ExtensionFactory = (pi: ExtensionAPI) => {
    pi.on("agent_start", () => {
      if (failOnce) {
        failOnce = false;
        throw new Error("FIRST-BOOM");
      }
    });
  };
  const h = await createHarness({ factories: [boom] });
  try {
    h.script([reply("one")]);
    await expect(h.run("go")).rejects.toThrow("FIRST-BOOM");
    // The stale error must not fail a run in which nothing went wrong.
    h.script([reply("two")]);
    await h.run("again");
    expect(h.faux.state.callCount).toBe(2);
  } finally {
    await h.dispose();
  }
});

test("harness disposes the session and removes its temp directory", async () => {
  const h = await createHarness();
  const dir = h.dir;
  expect(dir).toContain("pi-sticky-harness-");
  await h.dispose();
  // A second dispose must not throw on the missing directory.
  await h.dispose();
});
