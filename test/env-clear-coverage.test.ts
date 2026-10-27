/**
 * `test/env-clear.ts` deletes `PI_ENSEMBLE_ROLE` and `PI_STICKY_DISABLE`. `readConfig` turns either into
 * `disabled: true`, and `createStickyExtension` returns early on a disabled config: no tool, command,
 * handler or shortcut is registered at all. A file that builds its config from `process.env` — the way
 * `src/index.ts` does — and never imports the clear would therefore assert against an empty recorder, and
 * still pass: bun runs every test file in one process, in lexicographic module-scope order, so whichever
 * file imported the clear first has already fixed `process.env` for the rest of the run — and whichever
 * file *wrote* one first can poison the rest of it.
 *
 * Most test files pass the `DEFAULT_CONFIG` constant instead, which reflects no environment at all; the
 * imports are kept because the rule has to be mechanical to hold: "every file that builds the extension
 * imports the clear, itself or through a helper that does", so it cannot rot file by file the way the
 * hand-maintained list in `env-clear.ts` did — three files had all drifted when this was written.
 *
 * Same shape as `file-size.test.ts`: read files off disk, assert on the set, and prove the predicate on
 * synthetic source so the check cannot pass by matching nothing. The file then witnesses the clear itself:
 * it poisons both disable variables and re-enters `env-clear.ts` under a fresh query string, which must
 * make bun run the body again. A clear that loses a line leaves the suite red, in any shell.
 */
/**
 * The witness half of this guard lives in `test/env-clear-witness.ts`: it runs the rule rather than
 * reading files, and separating the two keeps the scan, its predicate and its helpers in one file inside
 * the 300-line gate.
 */
import { afterAll, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { readConfig } from "../src/config.ts";
import { POISONED, witnessCleared } from "./env-clear-witness.ts";

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
 * guarded set has exactly one source. The `(?!type\s)` is the point: a type-only import is elided at
 * runtime, so its module body — and the clear's own import at the top of it — never runs, and a file
 * guarded only by one is unguarded (proved on synthetic source below).
 */
const HELPER = new RegExp(
  `^\\s*import\\s+(?!type\\s)[^;]*?from\\s+["']\\./(${HELPERS.map(escapeRegExp).join("|")})\\.ts["'];`,
  "m",
);

/** Names reach a generated pattern as data, never as syntax. */
function escapeRegExp(name: string): string {
  return name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** A file counts as guarded when it clears the environment itself, or imports a helper that does for real
 * (an `import type` does not — bun elides it). See `unprotected`. */
function guarded(source: string): boolean {
  return CLEARS.test(source) || HELPER.test(source);
}

/** The two files that own the two variables rather than observe them — `test/index.test.ts` and
 * `test/config.test.ts` force and restore them per case, so they must not be cleared, and neither reaches
 * the extension through the ambient environment; their cleanup discipline keeps the run un-poisoned.
 */
const OWNERS = ["index.test.ts", "config.test.ts"];

/**
 * Files the scan must not require a clear of: the two owners above, the clear itself, this file, and
 * `env-clear-witness.ts` — the three that witness the clear on an environment they construct rather than
 * inherit, and which import it for their own sake rather than guarding a build.
 */
const EXEMPT = [...OWNERS, "env-clear.ts", "env-clear-coverage.test.ts", "env-clear-witness.ts"];

/** Helper modules live at the top of `test/`; everything below it is a test file or a fixture. Recursive,
 * as in `file-size.test.ts`, so a test file under `test/<subdir>/` cannot hide from the scan.
 */
function testSources(): string[] {
  return readdirSync(TEST_DIR, { encoding: "utf8", recursive: true })
    .filter((name) => name.endsWith(".ts"))
    .filter((name) => name.endsWith(".test.ts") || !name.includes("/"))
    .sort();
}

function read(name: string): string {
  return readFileSync(join(TEST_DIR, name), "utf8");
}

/**
 * Files that build the extension without the clear, directly or through a helper. A file guarded only by
 * an `import type` of a helper still lands here: bun elides that form, so the helper's body — and the
 * clear's two deletes at the top of it — never run.
 */
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
  // A scan that reports nothing — a drifted pattern, or a directory it stopped reading — is a green light
  // over an unguarded suite, so the positives are asserted here and not assumed. Helpers are derived from
  // disk, not trusted to the list: a file that clears the environment and exports something is a helper
  // whether or not someone added its name to `HELPERS`. A witness module that imports the clear for its
  // own sake is not a helper, so the derived set excludes the modules the scan already exempts.
  const sources = Object.fromEntries(testSources().map((name) => [name, read(name)]));
  const clearing = Object.keys(sources)
    .filter((name) => !EXEMPT.includes(name))
    .filter(
      (name) => CLEARS.test(sources[name] ?? "") && /(^|\n)export\s/.test(sources[name] ?? ""),
    )
    .map((name) => name.replace(/\.ts$/, ""));
  expect(clearing.sort()).toEqual([...HELPERS].sort());

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
  // The owners are exempt on the strength of their own cleanup, so a finally that merely restored —
  // and left the write standing for every file after it — has to be visible here.
  for (const name of OWNERS) {
    expect(read(name), `${name} deletes what it forces`).toContain(
      "Reflect.deleteProperty(process.env",
    );
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

test("the clear leaves an environment that enables the extension", () => {
  // Asserted on a scrubbed copy, so this answers one question — are the clear's two deletes enough to
  // leave a config that registers? — instead of reporting what an earlier file happened to leave in
  // `process.env`, which is `test/extension.test.ts`'s question and hostage to module order.
  expect(
    readConfig({ ...process.env, PI_ENSEMBLE_ROLE: undefined, PI_STICKY_DISABLE: undefined })
      .disabled,
    "the clear's deletes leave an environment that enables the extension",
  ).toBe(false);
});

test("the clear is what makes an extension built from the environment register the tool", async () => {
  // The witness for the rule, and the reason the rule is worth having: `readConfig` reads `process.env`
  // when `createStickyExtension` is *called*, so with either variable in the environment the extension
  // registers no tool at all, and a test that never checks registration still passes against an empty
  // recorder. `test/env-clear-witness.ts` poisons one variable per round, so the failure names the clear's
  // line that went missing.
  await witnessCleared();
});

afterAll(() => {
  // The last line of defence against a leak from an exempt file: a finally that only restores has left a
  // disable variable standing, and every file after it would go green on an extension that registered
  // nothing. The owners legitimately put the shell's own values back, so the claim is made on their source:
  // the cleanup in their `finally` must delete every variable it forces and only then restore it, never
  // restore alone. Sliced at the `finally`, because the forcing loop above it deletes as a matter of course
  // and a check that read the whole file would be satisfied by that alone.
  for (const name of OWNERS) {
    const source = read(name);
    const cleanup = source.slice(source.indexOf("} finally {"));
    expect(cleanup, `${name} deletes what it forces before restoring it`).toMatch(
      /if \(value === undefined\) Reflect\.deleteProperty\(process\.env, key\);\s*\n\s*else process\.env\[key\] = value;/,
    );
  }
});
