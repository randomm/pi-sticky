/**
 * Tests for the harness's construction and teardown paths that the happy-path tests never
 * reach: a failed build must not leak its temp directory, dispose must settle an in-flight
 * prompt before removing it, and it must also wait out the writes pi leaves running behind a
 * `void`ed provider refresh — which only shows up when harnesses overlap.
 */
import { expect, test } from "bun:test";
import { existsSync, readdirSync } from "node:fs";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { createHarness, reply } from "./harness.ts";

/** Harness temp directories currently present in the OS temp dir. */
function harnessDirs(): string[] {
  return readdirSync(tmpdir()).filter((name) => name.startsWith("pi-sticky-harness-"));
}

/**
 * Not an extension at all: pi throws part-way through loading it, which is the failure that
 * happens after `mkdtempSync()` has already created the harness directory. (A factory that
 * throws only from an event handler is not enough — pi folds that into `onError` and binding
 * still resolves, so the build would succeed.)
 */
const BROKEN_FACTORY = undefined as unknown as ExtensionFactory;

test("dispose() settles an in-flight prompt before removing the temp directory", async () => {
  const h = await createHarness();
  const dir = h.dir;
  expect(existsSync(dir)).toBe(true);
  h.script([reply("one"), reply("two")]);
  // Deliberately un-awaited: dispose must still leave nothing behind. `run()` resolves when
  // teardown wins the race — the assertion below is about the directory, not the verdict.
  const inFlight = h.run("a");
  await h.dispose();
  await inFlight.catch(() => undefined);
  expect(existsSync(dir)).toBe(false);
  await h.dispose();
  expect(existsSync(dir)).toBe(false);
});

test("run() after dispose() rejects and does not resurrect the temp directory", async () => {
  // pi's `void`ed provider refresh reaches FileAuthStorageBackend.withLockAsync(), which
  // calls ensureParentDir()/ensureFileExists() before anything else — so driving the session
  // after teardown re-creates the directory rmSync() just removed, and the prompt itself
  // resolves green because the faux queue is empty and pi reports that as an `error` turn
  // rather than a rejection. Both halves are asserted: the rejection, and the dir staying gone.
  const h = await createHarness();
  const dir = h.dir;
  h.script([reply("ok")]);
  await h.run("go");
  await h.dispose();
  expect(existsSync(dir)).toBe(false);
  await expect(h.run("after")).rejects.toThrow(
    "run() called after dispose(): the session and its temp dir are gone",
  );
  expect(existsSync(dir)).toBe(false);
  // The other session-driving methods are guarded the same way; script/appendScript/
  // summarizeWith only touch the faux queue, so they stay callable (asserted below).
  expect(() => h.branch()).toThrow(/after dispose/);
  expect(() => h.branchSnapshots()).toThrow(/after dispose/);
  h.script([reply("late")]);
  h.appendScript([reply("later")]);
  h.summarizeWith("summary");
  expect(h.faux.getPendingResponseCount()).toBe(3);
  expect(existsSync(dir)).toBe(false);
});

test("an extension command run after dispose() is refused too", async () => {
  // A command-only prompt appends no assistant turn, so without the guard it resolves green
  // while pi is already torn down — the shape a `/pins`-style command test would hit.
  const probe: ExtensionFactory = (pi: ExtensionAPI) => {
    pi.registerCommand("probe", { description: "Probe", handler: async () => {} });
  };
  const h = await createHarness({ factories: [probe] });
  const dir = h.dir;
  await h.run("/probe");
  await h.dispose();
  await expect(h.run("/probe")).rejects.toThrow(/after dispose/);
  expect(existsSync(dir)).toBe(false);
});

test("a failed harness creation removes its temp directory and reports why", async () => {
  const before = harnessDirs();
  const thrown = await createHarness({ factories: [BROKEN_FACTORY] }).then(
    () => undefined,
    (error: unknown) => error,
  );
  expect(thrown).toBeInstanceOf(Error);
  expect((thrown as Error).message).toMatch(/is not (an object|iterable|callable)/);
  // No harness directory survives the failed build.
  const leaked = harnessDirs().filter((dir) => !before.includes(dir));
  expect(leaked).toEqual([]);
  for (const dir of leaked) rmSync(join(tmpdir(), dir), { recursive: true, force: true });
});

/**
 * Regression guard for the cleanup race a sequential suite cannot see. `registerProvider()`
 * ends in `void ModelRuntime.refresh(...)`, which writes `auth.json` and `models-store.json`
 * under `agentDir` — inside the harness's temp dir — long after `abort()` has resolved. When a
 * harness is being built while another is disposed, that fire-and-forget write lands after
 * `rmSync()` and the directory survives: measured at roughly one disposal in five before the
 * settle in `disposeHarness()`, and never in sequential runs. Building several harnesses at
 * once is a plausible pattern for the later panel tests, so the leak is asserted here rather
 * than left to flake. Ten concurrent build/run/dispose cycles fail the assertion about half the
 * time without the settle (9 of 18 baseline runs) and have not passed green in 15 runs with it;
 * fewer trials pass the race by luck.
 */
test("overlapping harnesses leave no temp directory behind", async () => {
  const before = harnessDirs();
  const harnesses = await Promise.all(
    Array.from({ length: 10 }, async () => {
      const h = await createHarness();
      h.script([reply("ok")]);
      await h.run("go");
      return h;
    }),
  );
  await Promise.all(harnesses.map((h) => h.dispose()));
  // A grace period, so a leak that only needs longer to land still fails the assertion.
  await new Promise((resolve) => setTimeout(resolve, 250));
  const leaked = harnessDirs().filter((dir) => !before.includes(dir));
  for (const dir of leaked) rmSync(join(tmpdir(), dir), { recursive: true, force: true });
  expect(leaked).toEqual([]);
});
