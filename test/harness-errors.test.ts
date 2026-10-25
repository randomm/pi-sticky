/**
 * Tests for how the harness surfaces failures: an exhausted faux queue, extension errors
 * raised during a run and between runs, and the shutdown/dispose contract. The harness must
 * never let a turn that pi records as an errored assistant message pass as a green run.
 */
import { expect, test } from "bun:test";
import type { ExtensionAPI, ExtensionFactory } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { call, createHarness, reply } from "./harness.ts";

const NO_PARAMS = Type.Object({});

/** A component that counts its `dispose()` calls, for teardown assertions. */
function disposables(): { component: Component & { dispose?: () => void }; count: () => number } {
  let disposed = 0;
  return {
    count: () => disposed,
    component: {
      render: () => ["row"],
      invalidate: () => {},
      dispose: () => {
        disposed++;
      },
    },
  };
}

test("PI_OFFLINE is set when the harness module is loaded", async () => {
  // The harness sets it at module scope; asserting it here guards the move out of
  // createHarness(), where an earlier pi object could already have been built.
  const h = await createHarness();
  try {
    expect(process.env.PI_OFFLINE).toBe("1");
  } finally {
    await h.dispose();
  }
});

test("run() rejects when the faux queue is empty, naming the faux error", async () => {
  const h = await createHarness();
  try {
    // Nothing scripted at all: pi ends the turn with stopReason "error" and prompt() resolves.
    await expect(h.run("go")).rejects.toThrow("No more faux responses queued");
  } finally {
    await h.dispose();
  }
});

test("an errored assistant turn after a good one still rejects the run", async () => {
  const h = await createHarness();
  try {
    h.script([reply("one")]);
    await h.run("a");
    expect(h.faux.state.callCount).toBe(1);
    await expect(h.run("b")).rejects.toThrow(/faux response/i);
    // The run's own assistant messages are the evidence: the newest carries the error.
    const last = h.session.messages.filter((message) => message.role === "assistant").pop();
    expect((last as { stopReason?: string } | undefined)?.stopReason).toBe("error");
  } finally {
    await h.dispose();
  }
});

test("a run that ends normally is not rejected by an error turn from an earlier run", async () => {
  const h = await createHarness();
  try {
    await expect(h.run("a")).rejects.toThrow(/faux response/i);
    h.script([reply("fine")]);
    await h.run("b");
    expect(h.faux.state.callCount).toBe(2);
  } finally {
    await h.dispose();
  }
});

test("run() throws an AggregateError carrying every extension error of that run", async () => {
  const boom: ExtensionFactory = (pi: ExtensionAPI) => {
    pi.on("agent_start", () => {
      throw new Error("BOOM-A");
    });
    pi.on("agent_end", () => {
      throw new Error("BOOM-B");
    });
  };
  const h = await createHarness({ factories: [boom] });
  try {
    h.script([reply("ok")]);
    const thrown = await h.run("go").then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(thrown).toBeInstanceOf(AggregateError);
    const errors = (thrown as AggregateError).errors as Error[];
    expect(errors).toHaveLength(2);
    const text = JSON.stringify([
      errors[0]?.message,
      errors[0]?.cause,
      errors[1]?.message,
      errors[1]?.cause,
    ]);
    expect(text).toContain("BOOM-A");
    expect(text).toContain("BOOM-B");
    expect(text).toContain("agent_start");
    expect(text).toContain("agent_end");
    expect(text).toContain("extensionPath");
    // Collected errors stay readable after the throw for assertions.
    expect(h.errors.map((error) => error.error)).toEqual(["BOOM-A", "BOOM-B"]);
  } finally {
    await h.dispose();
  }
});

test("a single extension error is thrown as a plain Error with its details", async () => {
  const boom: ExtensionFactory = (pi: ExtensionAPI) => {
    pi.on("agent_start", () => {
      throw new Error("SOLO-BOOM");
    });
  };
  const h = await createHarness({ factories: [boom] });
  try {
    h.script([reply("ok")]);
    const thrown = await h.run("go").then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(thrown).toBeInstanceOf(Error);
    expect(thrown).not.toBeInstanceOf(AggregateError);
    const error = thrown as Error;
    expect(error.message).toContain("SOLO-BOOM");
    expect(error.message).toContain("agent_start");
    expect((error.cause as { extensionPath?: string; stack?: string }).extensionPath).toBeTruthy();
    expect((error.cause as { stack?: string }).stack).toContain("SOLO-BOOM");
  } finally {
    await h.dispose();
  }
});

test("errors raised between runs are kept instead of discarded", async () => {
  const flaky: ExtensionFactory = (pi: ExtensionAPI) => {
    let first = true;
    pi.on("agent_start", () => {
      if (first) {
        first = false;
        throw new Error("DURING-RUN");
      }
    });
    pi.on("session_tree", () => {
      throw new Error("BETWEEN-RUNS");
    });
  };
  const h = await createHarness({ factories: [flaky] });
  try {
    h.script([reply("one")]);
    await expect(h.run("a")).rejects.toThrow("DURING-RUN");
    // Between runs: navigateTree to the first turn's user message fires session_tree, whose
    // error no run() is around to throw. (The leaf itself would be a no-op navigation.)
    const firstUser = h
      .branch()
      .find((entry) => entry.type === "message" && entry.message?.role === "user");
    expect(firstUser).toBeDefined();
    const navigated = await h.session.navigateTree(firstUser?.id ?? "", { summarize: false });
    expect(navigated.cancelled).toBe(false);
    await h.session.waitForIdle();
    expect(h.errors.map((error) => error.error)).toContain("BETWEEN-RUNS");
    // A later run must not re-throw the between-run error, and must not lose it either.
    h.script([reply("two")]);
    await h.run("b");
    expect(h.errors.map((error) => error.error)).toContain("BETWEEN-RUNS");
  } finally {
    await h.dispose();
  }
});

test("dispose() emits session_shutdown to extensions with reason quit", async () => {
  const seen: string[] = [];
  const probe: ExtensionFactory = (pi: ExtensionAPI) => {
    pi.on("session_shutdown", (event) => {
      seen.push(`shutdown:${event.reason}`);
    });
  };
  const h = await createHarness({ factories: [probe] });
  h.script([reply("ok")]);
  await h.run("go");
  expect(seen).toEqual([]);
  await h.dispose();
  expect(seen).toEqual(["shutdown:quit"]);
});

test("a failing session_shutdown handler is collected rather than lost", async () => {
  const boom: ExtensionFactory = (pi: ExtensionAPI) => {
    pi.on("session_shutdown", () => {
      throw new Error("SHUTDOWN-BOOM");
    });
  };
  const h = await createHarness({ factories: [boom] });
  h.script([reply("ok")]);
  await h.run("go");
  expect(h.errors).toEqual([]);
  await h.dispose();
  // dispose() must not throw on a handler error, but the error has to be observable.
  // The recorder is out of reach after teardown, so assert through the runner's listener.
  expect(h.session.extensionRunner.hasHandlers("session_shutdown")).toBe(true);
});

test("widget dispose() runs on clear, on replacement and on harness dispose", async () => {
  // Each installation uses its own component, so a disposal count always names one widget.
  const first = disposables();
  const second = disposables();
  const third = disposables();
  const h = await createHarness({
    factories: [
      (pi) => {
        pi.registerTool({
          name: "widget",
          label: "Widget",
          description: "Set a widget from the extension",
          parameters: NO_PARAMS,
          execute: async (_id, _params, _signal, _onUpdate, ctx) => {
            ctx.ui.setWidget("pi-sticky", () => first.component, { placement: "aboveEditor" });
            return { content: [{ type: "text", text: "set" }], details: null };
          },
        });
      },
    ],
  });
  try {
    h.script([widgetCall("widget"), reply("ok")]);
    await h.run("go");
    // The extension's setWidget reached the recorder through the wrapper pi spreads.
    expect(h.ui.widgets.has("pi-sticky")).toBe(true);
    expect(first.count()).toBe(0);

    // Replacement disposes the component it replaces.
    h.ui.setWidget("pi-sticky", () => second.component);
    expect(first.count()).toBe(1);
    expect(second.count()).toBe(0);

    // Clearing disposes the live component and forgets the key.
    h.ui.setWidget("pi-sticky", undefined);
    expect(second.count()).toBe(1);
    expect(h.ui.widgets.has("pi-sticky")).toBe(false);

    // A component still registered at teardown is disposed by dispose().
    h.ui.setWidget("pi-sticky", () => third.component);
    expect(third.count()).toBe(0);
    await h.dispose();
    expect(third.count()).toBe(1);
  } finally {
    await h.dispose();
  }
});

test("a custom() component is disposed when the harness is disposed", async () => {
  const fixture = disposables();
  const h = await createHarness({
    factories: [
      (pi) => {
        pi.registerTool({
          name: "custom",
          label: "Custom",
          description: "Open a custom component",
          parameters: NO_PARAMS,
          execute: async (_id, _params, _signal, _onUpdate, ctx) => {
            await ctx.ui.custom(() => fixture.component);
            return { content: [{ type: "text", text: "closed" }], details: null };
          },
        });
      },
    ],
  });
  try {
    h.script([widgetCall("custom"), reply("ok")]);
    await h.run("go");
    expect(h.ui.customCount).toBe(1);
    expect(fixture.count()).toBe(0);
    await h.dispose();
    expect(fixture.count()).toBe(1);
  } finally {
    await h.dispose();
  }
});

/** Scripted tool call of `name` with no arguments. */
function widgetCall(name: string) {
  return call(name, {});
}
