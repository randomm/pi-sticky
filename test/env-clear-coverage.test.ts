/**
 * `test/env-clear.ts` deletes `PI_ENSEMBLE_ROLE` and `PI_STICKY_DISABLE`. `readConfig` turns either into
 * `disabled: true`, and `createStickyExtension` returns early on a disabled config: no tool, command,
 * handler or shortcut is registered at all. A file that builds its config from `process.env` — the way
 * `src/index.ts` does — and never imports the clear would therefore assert against an empty recorder, and
 * still pass: bun runs every test file in one process, so whichever file imported the clear first has
 * already fixed `process.env` for the rest of the run. Run that same file alone under an ambient pi-rukas
 * role and nothing is registered.
 *
 * Most test files pass the `DEFAULT_CONFIG` constant instead, which reflects no environment at all; those
 * imports are kept because a file that ever reads a config off `process.env` must not have to remember to
 * add the import later, and because the rule has to be mechanical to hold.
 *
 * The rule is "every file that builds the extension imports the clear, itself or through a helper that
 * does" — mechanical, so it cannot rot file by file the way the hand-maintained list in `env-clear.ts`
 * did. `test/reminder.test.ts`, `test/panel-lifecycle.test.ts` and `test/panel-reply.test.ts` were the
 * files that had drifted when this was written.
 *
 * Same shape as `file-size.test.ts`: read files off disk, assert on the set, and prove the
 * predicate on synthetic source so the check cannot pass by matching nothing.
 */
import { expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { readConfig } from "../src/config.ts";
import { createStickyExtension } from "../src/extension.ts";
import type { StickyConfig } from "../src/types.ts";
import { TOOL_NAME } from "../src/types.ts";
import { LATER } from "./fixtures.ts";
import { stubApi } from "./wiring-stubs.ts";

const ROOT = join(import.meta.dir, "..");
const TEST_DIR = join(ROOT, "test");

/** What a test builds the extension with: the factory itself, or the lifecycle fixture's wrapper. */
const BUILDS = /createStickyExtension\(|\bboot\(/;

/** Bare side-effect import of the clear. */
const CLEARS = /^\s*import\s+["']\.\/env-clear\.ts["'];?\s*$/m;

/** An import of one of the helpers that clear the environment themselves. */
const HELPER =
  /^\s*import\s+(?:type\s+)?[^;]*?from\s+["']\.\/(integration-support|panel-lifecycle-fixture|tool-harness)\.ts["'];/m;

/**
 * These two own the two variables as *inputs*: `test/index.test.ts` and `test/config.test.ts` force
 * and restore them per case, so they must not be cleared — and neither reaches the extension through
 * the ambient environment anyway.
 */
const EXEMPT = ["index.test.ts", "config.test.ts", "env-clear.ts", "env-clear-coverage.test.ts"];

function testSources(): string[] {
  return readdirSync(TEST_DIR, { encoding: "utf8" })
    .filter((name) => name.endsWith(".ts"))
    .sort();
}

function read(name: string): string {
  return readFileSync(join(TEST_DIR, name), "utf8");
}

/** Files that build the extension without the clear, directly or through a helper. */
function unprotected(sources: Record<string, string>): string[] {
  const guarded = (source: string): boolean => CLEARS.test(source) || HELPER.test(source);
  return Object.keys(sources)
    .filter((name) => !EXEMPT.includes(name))
    .filter((name) => BUILDS.test(sources[name] ?? ""))
    .filter((name) => !guarded(sources[name] ?? ""));
}

test("every test file that builds the extension clears the disable variables", () => {
  const sources = Object.fromEntries(testSources().map((name) => [name, read(name)]));
  expect(unprotected(sources)).toEqual([]);
});

test("the scan sees the files it guards, so it cannot pass by matching nothing", () => {
  // A scan that reports nothing — because its pattern drifted, or because it stopped reading the
  // directory at all — is a green light over an unguarded suite, so the positives are asserted here
  // and not assumed. `env-clear.ts` itself is the other half of the rule, so it must contain the very
  // import statement the predicate looks for.
  expect(read("env-clear.ts")).toContain('import "./env-clear.ts";');
  const sources = Object.fromEntries(testSources().map((name) => [name, read(name)]));
  const building = Object.keys(sources).filter((name) => BUILDS.test(sources[name] ?? ""));
  for (const name of [
    "panel-lifecycle.test.ts",
    "panel-reply.test.ts",
    "reminder.test.ts",
    "commands.test.ts",
    "panel-lifecycle-toggles.test.ts",
  ]) {
    expect(building, `scan finds ${name}`).toContain(name);
  }
  for (const name of [
    "panel-lifecycle-toggles.test.ts",
    "panel-close.test.ts",
    "tool-guards-bare-id.test.ts",
  ]) {
    expect(HELPER.test(sources[name] ?? ""), `${name} via a helper`).toBe(true);
  }
  // And the files this fix added the import to must be *guarded*, i.e. absent from the offenders.
  expect(unprotected(sources)).toEqual([]);
});

test("the predicate flags a file that builds the extension without the clear", () => {
  const offending = [
    'import { expect, test } from "bun:test";',
    'import { DEFAULT_CONFIG } from "../src/config.ts";',
    'import { createStickyExtension } from "../src/extension.ts";',
    'import { stubApi } from "./wiring-stubs.ts";',
    "const extension = createStickyExtension(DEFAULT_CONFIG, () => NOW);",
    'test("registers", () => expect(stubApi()).toBeDefined());',
  ].join("\n");
  expect(unprotected({ "offending.test.ts": offending })).toEqual(["offending.test.ts"]);

  // The same source with the import, and the same source reaching the extension through a helper that
  // imports it, are both clean — and a file that builds nothing is ignored whatever it imports.
  const withClear = offending.replace(
    'import { stubApi } from "./wiring-stubs.ts";',
    'import { stubApi } from "./wiring-stubs.ts";\nimport "./env-clear.ts";',
  );
  expect(unprotected({ "offending.test.ts": withClear })).toEqual([]);

  const viaHelper = offending.replace(
    'import { stubApi } from "./wiring-stubs.ts";',
    'import { boot } from "./panel-lifecycle-fixture.ts";',
  );
  expect(unprotected({ "offending.test.ts": viaHelper })).toEqual([]);

  const bootsViaHelper =
    'import { boot } from "./panel-lifecycle-fixture.ts";\ntest("b", () => boot());';
  expect(unprotected({ "offending.test.ts": bootsViaHelper })).toEqual([]);

  expect(unprotected({ "innocent.test.ts": 'import { NOW } from "./fixtures.ts";' })).toEqual([]);
});

test("the clear is what makes an extension built from the environment register the tool", () => {
  // The witness for the rule, in the file that enforces it, and the reason the rule is worth having:
  // `readConfig` reads `process.env` when `createStickyExtension` is *called*, so with either variable
  // in the environment the extension registers no tool at all — and a test that never checks
  // registration still passes while asserting against an empty recorder.
  //
  // Both variables are forced here rather than merely observed, because `env-clear.ts` deletes them at
  // import: reading them would be a tautology. Each is set on its own, so the refusal is attributable
  // to that one variable, and each is restored afterwards for the rest of the suite.
  const savedRole = process.env.PI_ENSEMBLE_ROLE;
  const savedDisable = process.env.PI_STICKY_DISABLE;
  try {
    process.env.PI_ENSEMBLE_ROLE = "developer";
    expect(readConfig(process.env).disabled, "a pi-rukas role disables").toBe(true);
    expect(buildTool(readConfig(process.env)).tools).toEqual([]);
    clearEnv("PI_ENSEMBLE_ROLE");

    process.env.PI_STICKY_DISABLE = "1";
    expect(readConfig(process.env).disabled, "PI_STICKY_DISABLE disables").toBe(true);
    expect(buildTool(readConfig(process.env)).tools).toEqual([]);
    clearEnv("PI_STICKY_DISABLE");

    // With neither set — the state `env-clear.ts` leaves every other test file in — the same pair of
    // calls enables the extension and registers the tool, which is what those files read their
    // assertions from.
    expect(readConfig(process.env).disabled, "a cleared environment enables").toBe(false);
    expect(buildTool(readConfig(process.env)).tools.map((tool) => tool.name)).toEqual([TOOL_NAME]);
  } finally {
    if (savedRole !== undefined) process.env.PI_ENSEMBLE_ROLE = savedRole;
    if (savedDisable !== undefined) process.env.PI_STICKY_DISABLE = savedDisable;
  }
});

/**
 * Take one variable out of the environment the way `env-clear.ts` does. An assignment of `undefined`
 * would not do it — bun turns that into the string `"undefined"`, which `isDisabled` reads as truthy.
 */
function clearEnv(name: string): void {
  Reflect.deleteProperty(process.env, name);
}

/**
 * Build the extension the way `src/index.ts` does — from a config read off the environment — and report
 * what it registered on a fresh stub. `DEFAULT_CONFIG` would not answer the question: it is a constant
 * that reflects no environment, and it is what most test files build with.
 */
function buildTool(config: StickyConfig): ReturnType<typeof stubApi> {
  const stub = stubApi();
  createStickyExtension(config, () => LATER)(stub.api);
  return stub;
}
