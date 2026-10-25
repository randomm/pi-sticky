/**
 * Tests for the harness's construction and teardown paths that the happy-path tests never
 * reach: a failed build must not leak its temp directory, and dispose must settle an
 * in-flight prompt before removing it.
 */
import { expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";
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
  // Deliberately un-awaited: dispose must still leave nothing behind.
  const inFlight = h.run("a");
  await h.dispose();
  await inFlight.catch(() => undefined);
  expect(existsSync(dir)).toBe(false);
  await h.dispose();
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

test("the harness module sets PI_OFFLINE before any session is built", () => {
  const source = readFileSync(join(import.meta.dir, "harness.ts"), "utf8");
  const lines = source.split("\n");
  const assignment = lines.findIndex((line) => line.includes('process.env.PI_OFFLINE = "1"'));
  expect(assignment).toBeGreaterThan(-1);
  // Module scope: no leading indentation, and above createHarness().
  expect(lines[assignment]?.startsWith(" ")).toBe(false);
  const create = lines.findIndex((line) => line.includes("export async function createHarness"));
  expect(assignment).toBeLessThan(create);
});
