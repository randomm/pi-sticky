/**
 * Tests for the harness rejecting a turn that pi records as not having completed: an aborted
 * stream, and every non-success value of pi's `StopReason` union. The exhausted faux queue,
 * extension errors and failing tool results live in `harness-errors.test.ts`; teardown
 * behaviour in `harness-teardown.test.ts`.
 */
import { expect, test } from "bun:test";
import type { ExtensionAPI, ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { assertTurnSucceeded } from "./harness-run.ts";
import { createHarness, reply } from "./harness.ts";

/**
 * A provider whose stream stays open until the request's signal aborts, then reports the
 * stream-level failure pi's real providers raise for a cancelled request: an `error` event
 * whose reason is `"aborted"` and whose message carries `stopReason: "aborted"`.
 *
 * The faux provider schedules its chunks on microtasks, so it cannot be caught mid-stream by
 * a test that merely calls `abort()` — by the time the test resumes the reply has already
 * finished. Replacing `streamSimple` here is what makes the abort land *inside* the stream:
 * the generator holds the first `start` event, waits for the abort event, and only then ends
 * the stream. Nothing is timed, so the test cannot flake.
 */
function abortableStream(h: { faux: { provider: unknown } }): void {
  const provider = h.faux.provider as Record<string, unknown>;
  const inner = provider.streamSimple as (
    model: never,
    context: never,
    options?: unknown,
  ) => AsyncIterable<unknown> & { result(): Promise<unknown> };
  provider.streamSimple = (model: never, context: never, options?: unknown) => {
    const stream = inner(model, context, options);
    return {
      async *[Symbol.asyncIterator]() {
        const iterator = stream[Symbol.asyncIterator]();
        // Let pi receive the real "start" event, so the run is genuinely mid-stream.
        await iterator.next();
        const signal = (options as { signal?: AbortSignal }).signal;
        await new Promise<void>((resolve) => {
          if (signal?.aborted) resolve();
          else signal?.addEventListener("abort", () => resolve(), { once: true });
        });
        yield {
          type: "error",
          reason: "aborted",
          error: {
            role: "assistant",
            content: [],
            api: "faux",
            provider: "faux",
            model: "faux-1",
            stopReason: "aborted",
            errorMessage: "Request was aborted",
            timestamp: Date.now(),
          },
        };
      },
      result: () => stream.result(),
    };
  };
}

test("assertTurnSucceeded does not fall back to the transcript before `since`", () => {
  // An error turn from an earlier run is outside the run's slice, so it cannot fail this one:
  // the slice is authoritative, and a run that appended nothing is green whatever the older
  // transcript holds.
  const turn = (stopReason: string) => ({ role: "assistant", stopReason, errorMessage: "WHY" });
  expect(() => assertTurnSucceeded([turn("error"), turn("stop")], 1)).not.toThrow();
  // The run appended nothing and the only turn in the transcript is older than it: green.
  expect(() => assertTurnSucceeded([turn("error")], 1)).not.toThrow();
  // A branch that shrank under the run (navigateTree) is treated as an empty slice.
  expect(() => assertTurnSucceeded([turn("error")], 7)).not.toThrow();
});

test("a command-only run is green after an earlier run ended in an error turn", async () => {
  const probe: ExtensionFactory = (pi: ExtensionAPI) => {
    pi.registerCommand("probe", { description: "Probe", handler: async () => {} });
  };
  const h = await createHarness({ factories: [probe] });
  try {
    // Run 1: nothing queued, so pi ends the turn with stopReason "error" and the run rejects.
    await expect(h.run("go")).rejects.toThrow("No more faux responses queued");
    // Run 2: a registered extension command consumes the prompt, appends nothing, and makes
    // no model request. It must resolve green even though the newest assistant turn in the
    // transcript is the error turn from run 1.
    await h.run("/probe");
    expect(h.faux.state.callCount).toBe(1);
    expect(h.requests).toHaveLength(1);
  } finally {
    await h.dispose();
  }
});

test("a run whose transcript shrank under it does not throw", async () => {
  // A branch shrink — navigateTree, or a reload that rebuilds the transcript — can leave
  // fewer messages than the count `run()` recorded when it began, so `since > messages.length`.
  // The unit assertion pins the contract; the harness-level half is that a run after a shrink
  // still reports green rather than reading a stale slice.
  const turn = (stopReason: string) => ({ role: "assistant", stopReason, errorMessage: "WHY" });
  expect(() => assertTurnSucceeded([turn("error")], 4)).not.toThrow();
  expect(() => assertTurnSucceeded([], 4)).not.toThrow();

  const h = await createHarness();
  try {
    h.script([reply("one")]);
    await h.run("a");
    const firstUser = h
      .branch()
      .find((entry) => entry.type === "message" && entry.message?.role === "user");
    expect(firstUser).toBeDefined();
    const navigated = await h.session.navigateTree(firstUser?.id ?? "", { summarize: false });
    expect(navigated.cancelled).toBe(false);
    await h.session.waitForIdle();
    h.script([reply("two")]);
    await h.run("b");
    expect(h.faux.state.callCount).toBe(2);
    // The shrink half, forced: pi keeps the full agent transcript after a navigation, so the
    // `since > length` shape is produced here by dropping it back to one message, which is
    // what a rebuild does to the finalized transcript.
    const before = h.session.messages.length;
    (h.session as unknown as { agent: { state: { messages: unknown[] } } }).agent.state.messages =
      h.session.messages.slice(0, 1);
    expect(h.session.messages.length).toBeLessThan(before);
    h.script([reply("three")]);
    await h.run("c");
    expect(h.faux.state.callCount).toBe(3);
  } finally {
    await h.dispose();
  }
});

test("run() rejects when the turn is aborted mid-stream", async () => {
  const h = await createHarness();
  try {
    abortableStream(h);
    h.script([reply("partial reply")]);
    // Deliberately un-awaited: the rejection is asserted on the promise below, not by awaiting
    // it in the finally block, where a second failure would escape the test.
    const inFlight = h.run("go");
    // The run is in flight: the provider is holding the stream open.
    await new Promise((resolve) => setTimeout(resolve, 2));
    expect(h.session.isIdle).toBe(false);
    await h.session.abort();
    await expect(inFlight).rejects.toThrow(/aborted/);
    // pi recorded the aborted turn, which is the evidence the rejection names.
    const turn = h.session.messages.filter((m) => m.role === "assistant").pop();
    expect((turn as { stopReason?: string } | undefined)?.stopReason).toBe("aborted");
  } finally {
    await h.dispose();
  }
});

test("assertTurnSucceeded rejects every non-success stopReason in the run's slice", () => {
  const turn = (stopReason: string) => ({ role: "assistant", stopReason, errorMessage: "WHY" });
  // Every value pi's StopReason union can hold that means the turn did not complete: an error,
  // an abort, and a turn still "pending" because its stream never reached a terminal event.
  for (const stopReason of ["error", "aborted", "pending"]) {
    expect(() => assertTurnSucceeded([turn(stopReason)], 0)).toThrow(new RegExp(stopReason));
    expect(() => assertTurnSucceeded([turn(stopReason)], 0)).toThrow("WHY");
  }
  // The completed ones — including pi's "deferred" stop, whose response the model still owes
  // — and a run that appended nothing, stay green.
  for (const stopReason of ["stop", "length", "toolUse", "deferred"]) {
    expect(() => assertTurnSucceeded([turn(stopReason)], 0)).not.toThrow();
  }
  expect(() => assertTurnSucceeded([], 0)).not.toThrow();
  // An aborted turn from an earlier run cannot fail this one.
  expect(() => assertTurnSucceeded([turn("aborted"), turn("stop")], 1)).not.toThrow();
});
