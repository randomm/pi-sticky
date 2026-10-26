/**
 * Tests for the harness's teardown contract: `dispose()` runs pi's shutdown path, disposes
 * every recorded component, and reaches `session.dispose()` even when an extension's own
 * teardown code throws. A run's failure detection lives in `harness-errors.test.ts`.
 */
import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import type { ExtensionAPI, ExtensionFactory } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { disposeWidgetEntry } from "./component-dispose.ts";
import { call, createHarness, createPlainTheme, createStubTui, reply } from "./harness.ts";
import type { RecordedWidget } from "./recorded-ui-types.ts";

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
  // dispose() must not throw on a handler error, and the error has to stay observable: pi
  // routes a throwing event handler to the bound onError, which the collector records under
  // its event, so the test can name it afterwards.
  expect(h.errors.map((error) => error.error)).toEqual(["SHUTDOWN-BOOM"]);
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
    h.script([call("widget", {}), reply("ok")]);
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
    h.script([call("custom", {}), reply("ok")]);
    await h.run("go");
    expect(h.ui.customCount).toBe(1);
    expect(fixture.count()).toBe(0);
    await h.dispose();
    expect(fixture.count()).toBe(1);
  } finally {
    await h.dispose();
  }
});

test("dispose() runs session teardown even when a widget factory throws", async () => {
  let shutdowns = 0;
  const probe: ExtensionFactory = (pi: ExtensionAPI) => {
    pi.on("session_shutdown", () => {
      shutdowns++;
    });
  };
  const h = await createHarness({ factories: [probe] });
  h.script([reply("ok")]);
  await h.run("go");
  // RecordingUi.dispose() has to replay this factory to reach the component pi built; the
  // throw must not abort teardown before session.dispose() runs.
  h.ui.setWidget("boom", () => {
    throw new Error("FACTORY-BOOM");
  });
  const dir = h.dir;
  await expect(h.dispose()).resolves.toBeUndefined();
  expect(shutdowns).toBe(1);
  expect(existsSync(dir)).toBe(false);
  // pi's own teardown ran: `AgentSession.dispose()` invalidates the extension runner, so the
  // captured context reports itself stale — the same check pi makes before every pi API call.
  // (Had session.dispose() been skipped, this would not throw.)
  expect(() =>
    (h.session.extensionRunner as unknown as { assertActive(): void }).assertActive(),
  ).toThrow(/stale/);
});

test("dispose() bounds a session.abort() that never settles and still removes the temp dir", async () => {
  // pi's abort() ends in `await waitForIdle()`, and an execute() that never settles keeps the
  // agent run active forever, so an unbounded await here would wedge teardown — and with it the
  // test. The bound in disposeHarness() is what makes this call return.
  let entered = false;
  let release: () => void = () => {};
  const never = new Promise<void>((resolve) => {
    release = resolve;
  });
  const hung: ExtensionFactory = (pi: ExtensionAPI) => {
    pi.registerTool({
      name: "hang",
      label: "Hang",
      description: "An execute() that never returns",
      parameters: NO_PARAMS,
      execute: async () => {
        entered = true;
        await never;
        return { content: [{ type: "text", text: "never" }], details: null };
      },
    });
  };
  const h = await createHarness({ factories: [hung] });
  const dir = h.dir;
  try {
    h.script([call("hang", {}), reply("ok")]);
    const started = h.run("go");
    // The run is genuinely mid-execute() before teardown starts, so the abort really is
    // waiting on the hung tool rather than on a turn that had already finished.
    const deadline = Date.now() + 5000;
    while (!entered && Date.now() < deadline) await new Promise((r) => setTimeout(r, 10));
    expect(entered).toBe(true);
    const disposed = h.dispose();
    // Well inside the test's 10 s: the abort bound is 2 s, so the wait is the bound plus teardown.
    const thrown = await disposed.then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(thrown).toBeInstanceOf(AggregateError);
    expect((thrown as AggregateError).errors.map((error) => (error as Error).message)).toEqual([
      "session.abort() did not settle within 2000ms",
    ]);
    expect(existsSync(dir)).toBe(false);
    release();
    await started.catch(() => undefined);
  } finally {
    release();
    await h.dispose().catch(() => undefined);
  }
}, 10000);

test("disposeWidgetEntry survives a throwing factory and stays idempotent", () => {
  const widget: RecordedWidget = {
    content: () => {
      throw new Error("FACTORY-BOOM");
    },
    placement: "aboveEditor",
  };
  let built = 0;
  expect(() =>
    disposeWidgetEntry(widget, (factory) => {
      built++;
      return factory(createStubTui(), createPlainTheme());
    }),
  ).not.toThrow();
  expect(built).toBe(1);
  // Already flagged as disposed, so a second call does not replay the factory again.
  disposeWidgetEntry(widget, (factory) => factory(createStubTui(), createPlainTheme()));
  expect(built).toBe(1);
});
