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
 * **Both** variables are deleted, and that is not cosmetic. Bun runs test-file module scopes in
 * lexicographic order in one process and an env write in one file is visible to every file after it, so
 * a file that sorts earlier than this one and writes `PI_STICKY_DISABLE` — `test/config.test.ts` does,
 * at test scope — decides whether the extension registers anything for the rest of the run. Clearing
 * only the role leaves the whole suite free to go green on an extension that registered nothing.
 *
 * The variables are *deleted* and not restored: an operator's own shell is not the state under test,
 * and there is no test that wants the extension disabled.
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
Reflect.deleteProperty(process.env, "PI_ENSEMBLE_ROLE");
Reflect.deleteProperty(process.env, "PI_STICKY_DISABLE");
