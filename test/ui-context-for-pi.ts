/**
 * Adapting `RecordingUi` to what pi's extension runner actually hands extensions.
 *
 * pi's `ExtensionRunner.wrapUIPromptContext` (core/extensions/runner.js) returns
 * `{ ...uiContext, select, confirm, input, editor, custom }`. Object spread copies **own
 * enumerable properties only**, so a class instance loses every prototype method: passing
 * `RecordingUi` directly leaves `ctx.ui.setWidget`, `setStatus`, `notify`,
 * `setEditorText`/`getEditorText`/`pasteToEditor`, `setTitle`, `onTerminalInput`, the theme
 * members and more — 22 of the 27 `ExtensionUIContext` members — `undefined` on the context
 * extensions see. A call then throws a TypeError that pi folds into a tool error result while
 * `session.prompt()` still resolves, so a test would assert on a recorder that stayed empty.
 * Only `select`/`confirm`/`input`/`editor`/`custom` survive, because the runner re-adds those
 * five explicitly, and `hasUI` stays true because the runner compares against its own no-op
 * object rather than the caller's.
 *
 * The fix is a plain object with each method bound to the recorder, so `this` still points at
 * the store. Test-only helpers (`renderWidget`, `lastCustom`, `customCalls`, …) are not
 * forwarded; tests read them from `h.ui`.
 */
import type { ExtensionUIContext, Theme } from "@earendil-works/pi-coding-agent";
import type { RecordingUi } from "./recording-ui.ts";

/**
 * Every method member of `ExtensionUIContext`. The type is the source of truth: a member
 * missing from this list makes the object literal below fail to compile, so the list cannot
 * silently drift when pi adds a UI member.
 */
const UI_METHODS = [
  "select",
  "confirm",
  "input",
  "notify",
  "onTerminalInput",
  "setStatus",
  "setWorkingMessage",
  "setWorkingVisible",
  "setWorkingIndicator",
  "setHiddenThinkingLabel",
  "setWidget",
  "setFooter",
  "setHeader",
  "setTitle",
  "custom",
  "pasteToEditor",
  "setEditorText",
  "getEditorText",
  "editor",
  "addAutocompleteProvider",
  "setEditorComponent",
  "getEditorComponent",
  "getAllThemes",
  "getTheme",
  "setTheme",
  "getToolsExpanded",
  "setToolsExpanded",
] as const satisfies readonly (keyof ExtensionUIContext)[];

/** Every member pi's spread keeps from a class instance: just the data properties. */
const UI_DATA_MEMBERS = ["theme"] as const satisfies readonly (keyof ExtensionUIContext)[];

/**
 * A plain object carrying every `ExtensionUIContext` member as an own property, bound to
 * `ui`, suitable for `bindExtensions({ uiContext })`.
 */
export function uiContextForPi(ui: RecordingUi): ExtensionUIContext {
  const source = ui as unknown as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const name of UI_METHODS) {
    const member = source[name];
    if (typeof member === "function") {
      out[name] = (member as (...args: unknown[]) => unknown).bind(ui);
    }
  }
  for (const name of UI_DATA_MEMBERS) {
    out[name] = ui[name] as Theme;
  }
  return out as unknown as ExtensionUIContext;
}

/** The member names forwarded to pi — exported so tests can assert on the shape. */
export const FORWARDED_UI_MEMBERS: readonly string[] = [
  ...UI_METHODS,
  ...UI_DATA_MEMBERS,
] as readonly string[];
