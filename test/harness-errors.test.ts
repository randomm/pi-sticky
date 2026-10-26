/**
 * Tests for how the harness surfaces failures: an exhausted faux queue, extension errors
 * raised during a run and between runs, and a tool whose `execute()` fails. The harness must
 * never let a turn that pi records as an error pass as a green run; aborted turns and the
 * stopReason matrix live in `harness-abort.test.ts`, teardown in `harness-teardown.test.ts`.
 */
import { expect, test } from "bun:test";
import type { ExtensionAPI, ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { call, createHarness, reply } from "./harness.ts";

const NO_PARAMS = Type.Object({});

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

test("run() rejects when a tool's execute() throws", async () => {
  // pi turns a throwing execute() into a toolResult with isError: true and does not route it
  // through onError, so neither the errored turn nor the error collector would see it.
  const boom: ExtensionFactory = (pi: ExtensionAPI) => {
    pi.registerTool({
      name: "boom",
      label: "Boom",
      description: "Throw from execute",
      parameters: NO_PARAMS,
      execute: async () => {
        throw new Error("TOOL-BOOM");
      },
    });
  };
  const h = await createHarness({ factories: [boom] });
  try {
    h.script([call("boom", {}), reply("recovered")]);
    const thrown = await h.run("go").then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(thrown).toBeInstanceOf(Error);
    const message = (thrown as Error).message;
    // Names the tool and carries the text pi handed back, so the failure is diagnosable.
    expect(message).toContain("errored tool result");
    expect(message).toContain("boom");
    expect(message).toContain("TOOL-BOOM");
    // pi recorded the failure on the branch as an error result.
    const results = h
      .branch()
      .filter((entry) => entry.type === "message" && entry.message?.role === "toolResult");
    expect(results).toHaveLength(1);
  } finally {
    await h.dispose();
  }
});

test("a tool result that reports a failure without throwing fails the run too", async () => {
  // A tool may return a failed result explicitly rather than throwing; same channel, same
  // verdict, so a test cannot mistake a failed tool call for a green run.
  const failing: ExtensionFactory = (pi: ExtensionAPI) => {
    pi.registerTool({
      name: "fails",
      label: "Fails",
      description: "Return a failed result",
      parameters: NO_PARAMS,
      execute: async () => ({
        content: [{ type: "text", text: "NO-SUCH-PIN" }],
        details: null,
        isError: true,
      }),
    });
  };
  const h = await createHarness({ factories: [failing] });
  try {
    h.script([call("fails", {}), reply("ok")]);
    await expect(h.run("go")).rejects.toThrow(/NO-SUCH-PIN/);
  } finally {
    await h.dispose();
  }
});

test("a successful tool result does not fail the run", async () => {
  const good: ExtensionFactory = (pi: ExtensionAPI) => {
    pi.registerTool({
      name: "good",
      label: "Good",
      description: "Succeed",
      parameters: NO_PARAMS,
      execute: async () => ({ content: [{ type: "text", text: "fine" }], details: null }),
    });
  };
  const h = await createHarness({ factories: [good] });
  try {
    h.script([call("good", {}), reply("ok")]);
    await h.run("go");
    expect(h.errors).toEqual([]);
  } finally {
    await h.dispose();
  }
});
