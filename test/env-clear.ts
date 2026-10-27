/**
 * One process-wide clear of the two variables that disable the extension, for the test files that
 * build it from `process.env` — which is every file that calls `createStickyExtension` with
 * `DEFAULT_CONFIG` or boots the panel through `panel-lifecycle-fixture.ts`.
 *
 * `readConfig` turns a non-empty `PI_ENSEMBLE_ROLE` or a truthy `PI_STICKY_DISABLE` into
 * `disabled: true`, and `createStickyExtension` returns early on a disabled config: no tool, command,
 * handler or shortcut at all. A test that builds its config from `process.env` and never imports this
 * file can therefore be handed a silent extension and still pass, because bun runs every test file in
 * one process and whichever file imported the clear first has already fixed `process.env` for the rest of
 * the run — run that file alone under a pi-rukas role and nothing is registered.
 *
 * **Both** variables are deleted, and that is not cosmetic. Bun hoists a file's imports above its own
 * top-level statements, so the order that decides `process.env` for the rest of the run is the order the
 * clears are *imported* in, not the order the writes are written in — and a file that never imports this
 * one can still write a variable. `test/config.test.ts` writes `PI_STICKY_DISABLE` at test scope, and an
 * assertion that throws before its `finally` leaves the write standing for every file that runs after
 * it. Clearing only the role therefore leaves the whole suite free to go green on an extension that
 * registered nothing: `PI_STICKY_DISABLE=1 bun test` reads as 806 passing tests, all of them asserting
 * against an empty recorder.
 *
 * The variables are *deleted* and not restored: an operator's own shell is not the state under test,
 * and there is no test that wants the extension disabled. `test/env-clear-coverage.test.ts` asserts that
 * the environment the clear leaves behind enables the extension, which is the mechanical half of this
 * paragraph — delete either line below and that test is the one that fails.
 *
 * Import it for its side effect — the line is exactly `import "./env-clear.ts";`, the pattern
 * `test/env-clear-coverage.test.ts` matches — in any file that reaches the extension through the
 * process environment. A file that imports `integration-support`, `panel-lifecycle-fixture` or
 * `tool-harness` is covered by that helper's own import instead. That check is the mechanical form of
 * the rule; this header is documentation, not enforcement.
 *
 * `test/config.test.ts` and `test/index.test.ts` are the files that own those two variables as inputs,
 * and both force them for their own duration; neither imports this file, and both pass either way. The
 * files that *observe* the variables instead — this one, and `test/env-clear-coverage.test.ts`, which
 * builds the extension straight from `process.env` — do import it, so neither is at the mercy of what
 * an earlier file in the same process left behind.
 */

/**
 * How many times this body has run, keyed by the query string of the specifier that ran it. Purely for
 * `test/env-clear-coverage.test.ts`: the witness re-enters this module under a fresh `?witness=N` and must
 * be able to tell a real re-run from a cache hit, so the mechanism it depends on is asserted rather than
 * assumed. The counter lives on `globalThis` because a re-entered module gets a fresh module instance.
 */
const registryKey = "pi-sticky.test.env-clear.runs";
const registry = globalThis as Record<string, unknown>;
if (!(registryKey in registry)) registry[registryKey] = {};

/** Re-entry counts, keyed by query string. */
export const CLEARED_RUNS: Record<string, number> = registry[registryKey] as Record<string, number>;

// `import.meta.query` is not in bun's published types, so the query comes off the module URL instead.
const query = new URL(import.meta.url).searchParams.get("witness") ?? "";
CLEARED_RUNS[query] = (CLEARED_RUNS[query] ?? 0) + 1;

Reflect.deleteProperty(process.env, "PI_ENSEMBLE_ROLE");
Reflect.deleteProperty(process.env, "PI_STICKY_DISABLE");
