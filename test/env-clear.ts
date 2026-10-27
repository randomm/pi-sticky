/**
 * One process-wide clear of the two variables that disable the extension, for the test files that
 * build it from `process.env` — which is every file that calls `createStickyExtension` with
 * `DEFAULT_CONFIG` or boots the panel through `panel-lifecycle-fixture.ts`.
 *
 * `readConfig` turns a non-empty `PI_ENSEMBLE_ROLE` or a truthy `PI_STICKY_DISABLE` into
 * `disabled: true`, and a disabled extension registers no tool, command, handler or shortcut at all.
 * The process running this suite is often itself a pi-rukas subagent with `PI_ENSEMBLE_ROLE` set, and
 * bun runs every test file in one process, so the ambient value has to go once, before any of those
 * module-scope `createStickyExtension(...)` calls runs — a per-test save/restore cannot reach a call
 * that already happened while the file was being imported.
 *
 * The variables are *deleted* and not restored: an operator's own shell is not the state under test,
 * and there is no test that wants the extension disabled. `test/config.test.ts` and
 * `test/index.test.ts` are the files that own those two variables as inputs, and both already force
 * them for their own duration; neither imports this file, and both pass either way.
 *
 * Import it for its side effect — `import "./env-clear.ts";` — in any file that reaches the extension
 * through the process environment.
 */
Reflect.deleteProperty(process.env, "PI_ENSEMBLE_ROLE");
Reflect.deleteProperty(process.env, "PI_STICKY_DISABLE");
