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
 * Every member of pi's `ExtensionUIContext`, keyed by name, with how the wrapper builds it:
 * `"method"` for a function bound to the recorder, `"data"` for a value copied across.
 *
 * This map is the single source of truth and is exhaustive **in both directions** at compile
 * time: it is typed `Record<keyof ExtensionUIContext, MemberKind>`, so a member pi adds is a
 * missing key (compile error) and a member pi drops is an extra key (compile error). The
 * wrapper below iterates its keys, so it can never forward something the type does not
 * declare, and a member declared here but absent from the recorder fails the `satisfies`
 * check on `RecordingUi`.
 */
const UI_MEMBERS = {
  select: "method",
  confirm: "method",
  input: "method",
  notify: "method",
  onTerminalInput: "method",
  setStatus: "method",
  setWorkingMessage: "method",
  setWorkingVisible: "method",
  setWorkingIndicator: "method",
  setHiddenThinkingLabel: "method",
  setWidget: "method",
  setFooter: "method",
  setHeader: "method",
  setTitle: "method",
  custom: "method",
  pasteToEditor: "method",
  setEditorText: "method",
  getEditorText: "method",
  editor: "method",
  addAutocompleteProvider: "method",
  setEditorComponent: "method",
  getEditorComponent: "method",
  theme: "data",
  getAllThemes: "method",
  getTheme: "method",
  setTheme: "method",
  getToolsExpanded: "method",
  setToolsExpanded: "method",
} as const satisfies Record<keyof ExtensionUIContext, "method" | "data">;

/**
 * Compile-time proof that the recorder implements what the map claims. `RecordingUi` must be
 * assignable to a shape whose `"method"` members are callable: a recorder that drops one is a
 * type error here, not an `undefined` in front of an extension. The check lives in a type
 * position, so nothing is constructed when this module is imported.
 */
type MemberMap = typeof UI_MEMBERS;
type RequiredMembers = {
  [K in keyof MemberMap as MemberMap[K] extends "method" ? K : never]: () => unknown;
};
type DataMembers = {
  [K in keyof MemberMap as MemberMap[K] extends "data" ? K : never]: unknown;
};
type Assert<Checks extends readonly true[]> = Checks;
export type UiMembersMatchRecorder = Assert<
  [
    RecordingUi extends RequiredMembers ? true : false,
    RecordingUi extends DataMembers ? true : false,
  ] extends readonly true[]
    ? true
    : never
>;

/**
 * A plain object carrying every `ExtensionUIContext` member as an own property, bound to
 * `ui`, suitable for `bindExtensions({ uiContext })`.
 */
export function uiContextForPi(ui: RecordingUi): ExtensionUIContext {
  const source = ui as unknown as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [name, kind] of Object.entries(UI_MEMBERS)) {
    const member = source[name];
    out[name] =
      kind === "method" && typeof member === "function"
        ? (member as (...args: unknown[]) => unknown).bind(ui)
        : (member as Theme);
  }
  return out as unknown as ExtensionUIContext;
}

/** The member names forwarded to pi — exported so tests can assert on the shape. */
export const FORWARDED_UI_MEMBERS: readonly string[] = Object.keys(UI_MEMBERS);
