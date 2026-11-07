/**
 * Negative control for the error assertions the A2 spike test in `test/spike.test.ts` now makes
 * in place of its old string check over the whole serialised request: `h.errors` can only be
 * non-empty if the channel it reads is real, so this file drives a failure through the one
 * channel pi 1.3.0 actually reports — a throwing `registerCommand` handler — and shows the
 * collector records it as `extensionPath: "command:probe"`.
 *
 * Without this, A2's `expect(h.errors).toEqual([])` would be indistinguishable from an
 * assertion on a list nothing can ever put anything into. The sibling positive case (a clean
 * run leaves `h.errors` empty) already lives in `test/harness-errors.test.ts`.
 */
import { expect, test } from "bun:test";
import type { ExtensionAPI, ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { createHarness } from "./harness.ts";

const throwingProbe: ExtensionFactory = (pi: ExtensionAPI) => {
  pi.registerCommand("probe", {
    description: "Throw",
    handler: async () => {
      throw new Error("COMMAND-BOOM");
    },
  });
};

test("a throwing /probe handler reaches h.errors as command:probe while pi itself resolves the command", async () => {
  // pi 1.3.0 wraps `await command.handler(...)` in a try/catch and reports the failure through
  // the extension runner (`emitError({ extensionPath: "command:<name>", event: "command" })`),
  // then returns "handled", so `session.prompt()` itself resolves: the rejection asserted below
  // is the *harness's* verdict on errors it collected during the run, not pi failing the command.
  // A control that expected pi to reject would be asserting something pi does not do.
  const h = await createHarness({ factories: [throwingProbe] });
  try {
    const thrown = await h.run("/probe").then(
      () => undefined,
      (error: unknown) => error,
    );
    // Not the faux queue: the rejection is the harness's verdict on the error it collected for
    // the throwing handler, which is the record asserted on below.
    expect((thrown as Error).message).toContain("COMMAND-BOOM");
    const reported = h.errors.filter((error) => error.extensionPath === "command:probe");
    expect(reported).toHaveLength(1);
    expect(reported[0]?.event).toBe("command");
    expect(reported[0]?.error).toBe("COMMAND-BOOM");
  } finally {
    await h.dispose();
  }
});

test("a throwing pi.events.on handler is swallowed to console.error, out of h.errors' reach", async () => {
  // The other half of why A2's `h.errors` assertion is scoped the way it is. pi 1.3.0's event
  // bus (`core/event-bus.js`) wraps every `pi.events.on` handler in a try/catch that writes to
  // `console.error` and resolves, so such a throw reaches neither `h.errors` nor `h.run()`'s
  // rejection: A2 cannot assert on it, and `h.errors` staying empty there is not evidence that
  // the bus handler ran. The Error pi handed over arrives as its second console argument, so
  // that is the one carrying the message. A rejecting `h.run()` needs a different channel
  // entirely — a throwing `pi.on("before_agent_start")` handler, which the runner reports as an
  // extension error during the run and `harness.ts`'s `run()` turns into a `runFailure()` — and
  // that case is covered by `test/harness-errors.test.ts`, so it is not repeated here.
  const originalConsoleError = console.error;
  const captured: unknown[][] = [];
  console.error = (...args: unknown[]) => {
    captured.push(args);
  };
  try {
    const busProbe: ExtensionFactory = (pi: ExtensionAPI) => {
      pi.events.on("probe-bus", () => {
        throw new Error("BUS-BOOM");
      });
      pi.registerCommand("probe", {
        description: "Emit on the bus",
        handler: async () => {
          pi.events.emit("probe-bus", { n: 1 });
        },
      });
    };
    const h = await createHarness({ factories: [busProbe] });
    try {
      await h.run("/probe");
      expect(h.errors).toEqual([]);
      const logged = captured.map((args) => JSON.stringify(args.map(String))).join("\n");
      expect(logged).toContain("Event handler error (probe-bus)");
      expect(logged).toContain("BUS-BOOM");
    } finally {
      await h.dispose();
    }
  } finally {
    console.error = originalConsoleError;
  }
});
