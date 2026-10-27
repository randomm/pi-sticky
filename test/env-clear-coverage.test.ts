/**
 * `test/env-clear.ts` deletes `PI_ENSEMBLE_ROLE` and `PI_STICKY_DISABLE`. `readConfig` turns either into
 * `disabled: true`, and `createStickyExtension` returns early on a disabled config: no tool, command,
 * handler or shortcut is registered at all. A file that builds its config from `process.env` — the way
 * `src/index.ts` does — and never imports the clear would therefore assert against an empty recorder, and
 * still pass: bun runs every test file in one process, in lexicographic module-scope order, so whichever
 * file imported the clear first has already fixed `process.env` for the rest of the run — and whichever
 * file *wrote* one first can poison the rest of it. Run an unguarded file alone under an ambient pi-rukas
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
 * predicate on synthetic source so the check cannot pass by matching nothing. The file then witnesses the
 * clear itself: it puts both disable variables into `process.env` and then re-enters `env-clear.ts` under a
 * fresh query string, which bun treats as a new module and runs the body again. A clear that loses one of
 * its two lines leaves the suite red on an extension that registered nothing, in an operator's shell and in
 * a clean one.
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

/** The helper modules that clear the environment for every file that imports them. */
const HELPERS = ["integration-support", "panel-lifecycle-fixture", "tool-harness"];

/**
 * An import of one of the helpers that clear the environment themselves, generated from `HELPERS` so the
 * guarded set has exactly one source: a name added to `HELPERS` with no pattern behind it guards nothing.
 * The `(?!type\s)` is the point: a type-only import is elided at runtime, so its module body — and the
 * `env-clear.ts` import at the top of it — never runs, and a file guarded only by one is unguarded. A
 * `(?:type\s+)?` would have admitted it; the negative lookahead rejects it without rejecting the
 * multi-line value imports real files use (see `panel-lifecycle-toggles.test.ts`), and the rejection is
 * proved on synthetic source below. The alternation is `HELPERS.join("|")`, so a helper that joins the
 * guarded set is guarded the moment it joins the list, and one that drops out stops matching at once.
 */
const HELPER = new RegExp(
  `^\\s*import\\s+(?!type\\s)[^;]*?from\\s+["']\\./(${HELPERS.join("|")})\\.ts["'];`,
  "m",
);

/**
 * A file counts as guarded when it clears the environment itself, or imports a helper that does for
 * real: `HELPER` rejects a `import type` form, which bun elides, so such a file is only guarded if it
 * also carries its own `import "./env-clear.ts"`.
 */
function guarded(source: string): boolean {
  return CLEARS.test(source) || HELPER.test(source);
}

/**
 * The three files that own the two variables rather than observe them: `test/index.test.ts` and
 * `test/config.test.ts` force and restore them per case, so they must not be cleared — and neither
 * reaches the extension through the ambient environment anyway. This file witnesses the clear itself,
 * constructing the environment it asserts on, so it is exempt for the same reason. None of the three
 * builds the extension off `process.env`.
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
  return Object.keys(sources)
    .filter((name) => !EXEMPT.includes(name))
    .filter((name) => BUILDS.test(sources[name] ?? ""))
    .filter((name) => !guarded(sources[name] ?? ""));
}

/** One helper import with the given prefix, e.g. `import type { Booted } from "…";`. */
function helperImport(prefix: string, helper: string): string {
  return `import ${prefix}{ Booted } from "./${helper}.ts";`;
}

test("every test file that builds the extension clears the disable variables", () => {
  const sources = Object.fromEntries(testSources().map((name) => [name, read(name)]));
  expect(unprotected(sources)).toEqual([]);
});

test("the scan sees the files it guards, so it cannot pass by matching nothing", () => {
  // A scan that reports nothing — because its pattern drifted, or because it stopped reading the
  // directory at all — is a green light over an unguarded suite, so the positives are asserted here
  // and not assumed. `env-clear.ts` is the clear itself rather than a consumer of it, so what the scan
  // must find on disk is the import in each of the three helpers it treats as a guard.
  for (const helper of HELPERS) {
    expect(read(`${helper}.ts`), `${helper} clears the environment`).toContain(
      'import "./env-clear.ts";',
    );
  }
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

  // A *type-only* helper import is the hole `HELPER` must not fall into: bun elides it, so the helper's
  // module body — and the `env-clear.ts` import at the top of it — never runs. Each helper gets its own
  // offender, so the pattern cannot pass by only ever rejecting one of the three names.
  for (const helper of HELPERS) {
    const typeOnlyHelper = offending.replace(
      'import { stubApi } from "./wiring-stubs.ts";',
      helperImport("type ", helper),
    );
    expect(HELPER.test(typeOnlyHelper), `HELPER rejects a type-only ${helper}`).toBe(false);
    expect(unprotected({ "offending.test.ts": typeOnlyHelper })).toEqual(["offending.test.ts"]);
    expect(
      unprotected({
        "offending.test.ts": `${typeOnlyHelper}\nimport "./env-clear.ts";`,
      }),
    ).toEqual([]);
  }

  expect(unprotected({ "innocent.test.ts": 'import { NOW } from "./fixtures.ts";' })).toEqual([]);
});

test("importing the clear leaves an environment that enables the extension", () => {
  // What the clear leaves in `process.env` for every file that imports it, asserted on the verdict
  // `readConfig` reaches there rather than on the raw variables (an operator's shell may hold one
  // legitimately, and `toBeUndefined()` on the variable would be green either way).
  expect(
    readConfig(process.env).disabled,
    "the clear leaves an environment that enables the extension",
  ).toBe(false);
});

test("the clear is what makes an extension built from the environment register the tool", async () => {
  // The witness for the rule, in the file that enforces it, and the reason the rule is worth having:
  // `readConfig` reads `process.env` when `createStickyExtension` is *called*, so with either variable in
  // the environment the extension registers no tool at all — and a test that never checks registration
  // still passes while asserting against an empty recorder.
  //
  // The environment is *constructed*, not inherited. Both variables are written here and then taken out by
  // the clear itself, re-entered under a query string: bun keys its module registry on the whole specifier,
  // so a fresh one runs `env-clear.ts`'s body again instead of hitting the copy some earlier file already
  // imported. Delete one of the clear's two lines and that variable is still poisoned at the assertions
  // below, `readConfig` reports the extension disabled, and the tool list comes back empty. That holds in a
  // shell holding neither variable, which is the point — the witness used to read whatever an earlier file's
  // import had left behind, so it went on passing with the clear gutted.
  //
  // The query string is what makes this work and cannot be a plain `import`: the body runs once per process,
  // so the clear's own two deletes are the only code here that can empty the environment, and both are
  // needed — hence the per-variable halves below rather than one delete at the end.
  const savedRole = process.env.PI_ENSEMBLE_ROLE;
  const savedDisable = process.env.PI_STICKY_DISABLE;
  let reentries = 0;
  try {
    for (const [name, value] of POISONED) {
      // One variable at a time, so the failure names the line that went missing: with the clear's delete for
      // `name` removed, only this round goes red. Both values are ones `isDisabled` honours, so the clear is
      // emptying something that genuinely disables — `readConfig` and `buildTool` are asked of the same
      // environment the clear was just handed.
      clearEnv(name);
      process.env[name] = value;
      expect(readConfig(process.env).disabled, `${name}=${value} disables`).toBe(true);
      expect(buildTool(readConfig(process.env)).tools, `${name} registers nothing`).toEqual([]);

      await import(`./env-clear.ts?witness=${++reentries}`);
      expect(process.env[name], `${name} cleared by the clear`).toBeUndefined();
      expect(readConfig(process.env).disabled, `${name} cleared enables`).toBe(false);
      expect(buildTool(readConfig(process.env)).tools.map((tool) => tool.name)).toEqual([
        TOOL_NAME,
      ]);
    }
  } finally {
    // Delete unconditionally and only then restore what the shell actually held. The reverse order —
    // restore, or restore-only — would reinstate this test's own poison, or whatever an earlier file
    // leaked, for every file that runs after it in the same process.
    clearEnv("PI_ENSEMBLE_ROLE");
    clearEnv("PI_STICKY_DISABLE");
    if (savedRole !== undefined) process.env.PI_ENSEMBLE_ROLE = savedRole;
    if (savedDisable !== undefined) process.env.PI_STICKY_DISABLE = savedDisable;
  }
});

/**
 * The two variables the clear owns, each with a value that disables: a member of `DISABLE_VALUES` in
 * `src/config.ts` for `PI_STICKY_DISABLE`, any non-empty string for `PI_ENSEMBLE_ROLE`.
 */
const POISONED: readonly (readonly [string, string])[] = [
  ["PI_ENSEMBLE_ROLE", "x"],
  ["PI_STICKY_DISABLE", "1"],
];

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
