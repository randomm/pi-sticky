/**
 * The witness half of `test/env-clear-coverage.test.ts`, kept in its own module so the scan that enforces
 * the rule fits inside the 300-line gate with its predicate, its helpers and this witness all in one
 * place. Nothing here enforces anything by reading files: it *runs* the rule and reports whether the
 * extension registered.
 *
 * `test/env-clear.ts` deletes the two variables that make `readConfig` report the extension disabled, and
 * a disabled `createStickyExtension` registers no tool, command, handler or shortcut at all. A test file
 * that builds its config from `process.env` and never imports the clear therefore asserts against an
 * empty recorder and still passes — bun runs every test file in one process, so whichever file imported
 * the clear first has already fixed `process.env` for the rest of the run, and whichever file *wrote* one
 * first can poison the rest of it.
 *
 * The environment here is *constructed*, not inherited: each round writes one variable with a value that
 * genuinely disables, and only the clear's own body may take it out again. The clear is re-entered under a
 * fresh query string because bun keys its module registry on the whole specifier, so a fresh one runs the
 * body rather than hitting the copy an earlier file imported — and `CLEARED_RUNS` proves that re-entry
 * actually happened instead of leaving the claim in a comment.
 */
import { expect } from "bun:test";

import { readConfig } from "../src/config.ts";
import { createStickyExtension } from "../src/extension.ts";
import type { StickyConfig } from "../src/types.ts";
import { TOOL_NAME } from "../src/types.ts";
import "./env-clear.ts";
import { CLEARED_RUNS } from "./env-clear.ts";
import { LATER } from "./fixtures.ts";
import { stubApi } from "./wiring-stubs.ts";

const CLEAR = "./env-clear.ts";

/** The clear's own side-effect import, which is the line every guarded file must also carry. */
const CLEAR_IMPORT = 'import "./env-clear.ts"';

/** The variables `test/env-clear.ts` owns. Add a delete there and this union is what must grow. */
export type ClearedVar = "PI_ENSEMBLE_ROLE" | "PI_STICKY_DISABLE";

/** A member of `DISABLE_VALUES` in `src/config.ts`, or any non-empty string for the role. */
type DisableValue = "1" | "true" | "yes" | "on" | (string & {});

/**
 * One entry per delete in the clear, each variable with a value that disables it. The key type is the only
 * compile-time link between this witness and those two lines: add a variable the clear deletes and this
 * list is what has to name it, or the clear goes untested for it. Exported for
 * `test/env-clear-coverage.test.ts`, which exempts this module on the strength of its own clear import.
 */
export const POISONED: readonly (readonly [ClearedVar, DisableValue])[] = [
  ["PI_ENSEMBLE_ROLE", "x" /* any non-empty string disables */],
  ["PI_STICKY_DISABLE", "1" /* a member of DISABLE_VALUES */],
];

/** One witness round, poison and clear both belonging to this module: see `witnessClear`. */
export async function witnessCleared(): Promise<void> {
  const saved: Partial<Record<ClearedVar, string>> = {};
  for (const [name] of POISONED) saved[name] = process.env[name];
  try {
    for (const [index, [name, value]] of POISONED.entries()) {
      await witnessClear(name, value, index + 1);
    }
  } finally {
    // Delete unconditionally — this module's poison is its own to clean, whatever the shell held — and
    // only then restore, or the reverse order would reinstate the poison for every file after it.
    for (const [name] of POISONED) clearEnv(name);
    for (const [name, value] of Object.entries(saved)) {
      if (value !== undefined) process.env[name] = value;
    }
  }
}

/**
 * One witness round: poison one variable, then re-enter the clear under a fresh specifier and assert that
 * *its body* took the variable out. `runs` is the re-entry index — one per round, from the loop, so the
 * module cache holds no more instances than `POISONED` has entries.
 */
async function witnessClear(name: ClearedVar, value: string, runs: number): Promise<void> {
  clearEnv(name);
  process.env[name] = value;
  expect(readConfig(process.env).disabled, `${name}=${value} disables`).toBe(true);
  expect(buildTool(readConfig(process.env)).tools, `${name} registers nothing`).toEqual([]);

  await import(`${CLEAR}?witness=${runs}`);
  // The re-entry has to have actually run, or the three assertions below only measure what some earlier
  // file's import cleared and the witness never witnessed anything.
  expect(
    CLEARED_RUNS[String(runs)],
    `re-entering ${CLEAR} under ?witness=${runs} ran its body again (bun must keep the query in the module registry key)`,
  ).toBe(1);
  expect(process.env[name], `${name} cleared by the clear`).toBeUndefined();
  expect(readConfig(process.env).disabled, `${name} cleared enables`).toBe(false);
  expect(buildTool(readConfig(process.env)).tools.map((tool) => tool.name)).toEqual([TOOL_NAME]);
}

/** Take one variable out of the environment the way `env-clear.ts` does: an assignment of `undefined`
 * would not do it — bun turns that into `"undefined"`, which `isDisabled` reads as truthy.
 */
function clearEnv(name: string): void {
  Reflect.deleteProperty(process.env, name);
}

/** Build the extension the way `src/index.ts` does — from a config read off the environment — and report
 * what it registered on a fresh stub. `DEFAULT_CONFIG` would not answer: it reflects no environment.
 */
function buildTool(config: StickyConfig): ReturnType<typeof stubApi> {
  const stub = stubApi();
  createStickyExtension(config, () => LATER)(stub.api);
  return stub;
}
