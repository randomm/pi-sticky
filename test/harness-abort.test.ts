/**
 * Tests for the harness rejecting a turn that pi records as not having completed: an aborted
 * stream, and every non-success value of pi's `StopReason` union. The exhausted faux queue,
 * extension errors and failing tool results live in `harness-errors.test.ts`; teardown
 * behaviour in `harness-teardown.test.ts`.
 */
import { expect, test } from "bun:test";
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
