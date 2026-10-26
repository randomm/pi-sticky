/**
 * Tests for the two teardown/rejection contracts the happy paths cannot see: `dispose()` must
 * report a failing `session.dispose()` instead of swallowing it, and `run()` must still report
 * a run's extension errors when `session.prompt()` rejects rather than resolving.
 */
import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import type { ExtensionAPI, ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { createHarness, reply } from "./harness.ts";

test("dispose() reports a failing session.dispose() and still removes the temp dir", async () => {
  const h = await createHarness();
  const dir = h.dir;
  expect(existsSync(dir)).toBe(true);
  (h.session as unknown as { dispose(): void }).dispose = () => {
    throw new Error("DISPOSE-BOOM");
  };
  const thrown = await h.dispose().then(
    () => undefined,
    (error: unknown) => error,
  );
  // Teardown stays best-effort — rmSync ran — but the failure is not hidden.
  expect(existsSync(dir)).toBe(false);
  expect(thrown).toBeInstanceOf(AggregateError);
  const errors = (thrown as AggregateError).errors as Error[];
  expect(errors.map((error) => error.message)).toContain("DISPOSE-BOOM");
});

test("dispose() runs rmSync even when the recorder's teardown throws alongside the session", async () => {
  const h = await createHarness();
  const dir = h.dir;
  const session = h.session as unknown as { dispose(): void };
  session.dispose = () => {
    throw new Error("DISPOSE-BOOM");
  };
  h.ui.dispose = () => {
    throw new Error("UI-BOOM");
  };
  const thrown = await h.dispose().then(
    () => undefined,
    (error: unknown) => error,
  );
  expect(existsSync(dir)).toBe(false);
  expect((thrown as AggregateError).errors.map((error) => (error as Error).message)).toEqual([
    "UI-BOOM",
    "DISPOSE-BOOM",
  ]);
});

test("run() reports the run's extension errors when session.prompt() rejects", async () => {
  const boom: ExtensionFactory = (pi: ExtensionAPI) => {
    pi.on("input", () => {
      throw new Error("INPUT-BOOM");
    });
  };
  const h = await createHarness({ factories: [boom] });
  try {
    h.script([reply("ok")]);
    // The prompt rejects after the handler already recorded an extension error. Without the
    // `finally`-style collection in run() this rejection would carry no trace of that error.
    const session = h.session as unknown as {
      prompt(text: string, options?: unknown): Promise<void>;
    };
    const real = session.prompt.bind(session);
    session.prompt = async (text: string, options?: unknown) => {
      await real(text, options);
      throw new Error("PROMPT-BOOM");
    };
    const thrown = await h.run("go").then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(thrown).toBeInstanceOf(Error);
    // A single error of the run becomes the plain `Error` `runFailure()` builds for one — an
    // `AggregateError` with `errors` only when the run produced several — with the rejection
    // itself kept as its `cause`.
    const failure = thrown as Error;
    expect(failure.message).toContain("INPUT-BOOM");
    expect(failure.message).toContain("input");
    expect((failure.cause as Error).message).toBe("PROMPT-BOOM");
    // The error also remains assertable on the harness itself.
    expect(h.errors.map((error) => error.error)).toContain("INPUT-BOOM");
  } finally {
    await h.dispose();
  }
});

test("run() rethrows the original rejection unchanged when the run recorded no errors", async () => {
  const h = await createHarness();
  try {
    h.script([reply("ok")]);
    const session = h.session as unknown as {
      prompt(text: string, options?: unknown): Promise<void>;
    };
    const real = session.prompt.bind(session);
    session.prompt = async (text: string, options?: unknown) => {
      await real(text, options);
      throw new Error("PROMPT-BOOM");
    };
    const thrown = await h.run("go").then(
      () => undefined,
      (error: unknown) => error,
    );
    // Nothing to report beyond the rejection itself, so it is the rejection: same identity.
    expect((thrown as Error).message).toBe("PROMPT-BOOM");
    expect((thrown as Error & { errors?: unknown[] }).errors).toBeUndefined();
  } finally {
    await h.dispose();
  }
});
