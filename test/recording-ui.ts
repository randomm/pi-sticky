/**
 * Recording implementation of pi's ExtensionUIContext for the SDK test harness.
 *
 * Every call the extension makes through `ctx.ui` is captured here instead of drawn, so
 * tests assert on widget content, status text, notifications, editor text and `custom()`
 * components without a terminal. `renderWidget()` replays a recorded widget factory at a
 * given width and `lastCustom()` replays the component from `custom()` and drives its
 * keyboard handler; `custom()` promises resolve immediately, so a test that awaits an
 * overlay call cannot hang.
 */
import type {
  AutocompleteProviderFactory,
  ExtensionUIContext,
  ExtensionUIDialogOptions,
  KeybindingsManager,
  TerminalInputHandler,
  Theme,
  WidgetPlacement,
} from "@earendil-works/pi-coding-agent";
import type { Component, OverlayHandle, OverlayOptions, TUI } from "@earendil-works/pi-tui";
import { KeybindingsManager as TuiKeybindingsManager } from "@earendil-works/pi-tui";
import { disposeCustomCalls, disposeWidgetEntry } from "./component-dispose.ts";
import type {
  CustomOptions,
  RecordedCustomCall,
  RecordedNotification,
  RecordedWidget,
  WidgetFactory,
} from "./recorded-ui-types.ts";
import { createOverlayHandle, createPlainTheme, createStubTui } from "./ui-stubs.ts";

/** pi's editor factory type, reached through the UI context so no deep import is needed. */
type EditorFactory = Parameters<ExtensionUIContext["setEditorComponent"]>[0];

/**
 * pi's `custom()` is generic over the result type and the package root exports neither its
 * factory nor its options type, so the recording class declares the same shape with `T` free
 * (the extension-author pattern). Deriving it with `Parameters<ReturnType<...>>` would collapse
 * `done` to `never`, because instantiating the generic at its own constraint collapses `T`.
 * `KeybindingsManager` is imported type-only from the coding-agent package, so this resolves to
 * pi's subclass exactly as the interface declares it.
 */
type CustomComponent = Component & { dispose?: () => void };
type CustomFactory<T> = (
  tui: TUI,
  theme: Theme,
  keybindings: KeybindingsManager,
  done: (result: T) => void,
) => CustomComponent | Promise<CustomComponent>;
/** The component a `custom()` factory returns; exported so tests can type their fixtures. */
export type { CustomComponent };

/**
 * ExtensionUIContext that records everything the extension asks the UI to do and can
 * replay components at a width. Dialogs resolve to canned answers recorded in `dialogs`.
 */
export class RecordingUi implements ExtensionUIContext {
  readonly widgets = new Map<string, RecordedWidget>();
  readonly statuses = new Map<string, string>();
  readonly notifications: RecordedNotification[] = [];
  readonly customCalls: RecordedCustomCall[] = [];
  readonly terminalInputs: TerminalInputHandler[] = [];
  readonly workingMessages: (string | undefined)[] = [];
  readonly titles: string[] = [];
  /** Answers the dialogs hand back, in call order; anything left over resolves undefined. */
  readonly dialogAnswers: unknown[] = [];
  readonly dialogCalls: { kind: string; title: string }[] = [];

  #editorText = "";
  #editorComponent: EditorFactory | undefined;
  #lastCustom: RecordedCustomCall | undefined;
  readonly theme: Theme = createPlainTheme();

  // --- dialogs ---------------------------------------------------------------

  async select(title: string, _options: string[], _opts?: ExtensionUIDialogOptions) {
    this.#recordDialog("select", title);
    return this.#nextAnswer<string>();
  }

  async confirm(title: string, _message: string, _opts?: ExtensionUIDialogOptions) {
    this.#recordDialog("confirm", title);
    return this.#nextAnswer<boolean>() ?? false;
  }

  async input(title: string, _placeholder?: string, _opts?: ExtensionUIDialogOptions) {
    this.#recordDialog("input", title);
    return this.#nextAnswer<string>();
  }

  async editor(title: string, _prefill?: string) {
    this.#recordDialog("editor", title);
    return this.#nextAnswer<string>();
  }

  notify(message: string, type?: "info" | "warning" | "error"): void {
    this.notifications.push({ message, type });
  }

  onTerminalInput(handler: TerminalInputHandler): () => void {
    this.terminalInputs.push(handler);
    return () => {
      const index = this.terminalInputs.indexOf(handler);
      if (index >= 0) this.terminalInputs.splice(index, 1);
    };
  }

  // --- status, working indicator, chrome ------------------------------------

  setStatus(key: string, text: string | undefined): void {
    if (text === undefined) this.statuses.delete(key);
    else this.statuses.set(key, text);
  }

  setWorkingMessage(message?: string): void {
    this.workingMessages.push(message);
  }

  setWorkingVisible(_visible: boolean): void {}
  setWorkingIndicator(_options?: { frames?: string[]; intervalMs?: number }): void {}
  setHiddenThinkingLabel(_label?: string): void {}
  setFooter(_factory: Parameters<ExtensionUIContext["setFooter"]>[0]): void {}
  setHeader(_factory: Parameters<ExtensionUIContext["setHeader"]>[0]): void {}
  addAutocompleteProvider(_factory: AutocompleteProviderFactory): void {}

  setTitle(title: string): void {
    this.titles.push(title);
  }

  // --- widgets ---------------------------------------------------------------

  setWidget(
    key: string,
    content: string[] | WidgetFactory | undefined,
    options?: { placement?: WidgetPlacement },
  ): void {
    // pi disposes the component a key previously held before installing the new one, in
    // either placement; the recorder does the same so a test can assert on teardown.
    this.#disposeWidget(key);
    if (content === undefined) return;
    this.widgets.set(key, {
      content,
      placement: options?.placement ?? "aboveEditor",
    });
  }

  /**
   * Dispose every recorded component and forget the widgets: what pi's interactive mode does
   * in `clearExtensionWidgets()` / `resetExtensionUI()`, and what the harness calls on
   * `dispose()` so a panel's teardown code runs in tests.
   *
   * Idempotent: a component is disposed at most once per key and per `custom()` call, so a
   * repeated `dispose()` cannot double-dispose a component whose teardown is not reentrant.
   */
  dispose(): void {
    for (const key of [...this.widgets.keys()]) this.#disposeWidget(key);
    disposeCustomCalls(this.customCalls);
  }

  /** Dispose and drop the component registered under `key`, whatever its placement. */
  #disposeWidget(key: string): void {
    const widget = this.widgets.get(key);
    if (!widget) return;
    this.widgets.delete(key);
    disposeWidgetEntry(widget, (factory) => factory(createStubTui(), this.theme));
  }

  // --- custom components -----------------------------------------------------

  async custom<T>(factory: CustomFactory<T>, options?: CustomOptions): Promise<T> {
    const tui = createStubTui();
    const theme = this.theme;
    // pi hands extensions its own KeybindingsManager subclass; it is not exported from the
    // package root, so the harness passes the pi-tui base it extends, which carries the
    // lookup members a component actually uses. The cast narrows it to the declared type.
    const keybindings = new TuiKeybindingsManager({}) as unknown as KeybindingsManager;
    const call: RecordedCustomCall = { result: undefined, options };
    this.customCalls.push(call);
    this.#lastCustom = call;
    let settled = false;
    const done = (result: T) => {
      if (settled) return;
      settled = true;
      call.result = result;
      resolve(result);
    };
    let resolve!: (result: T) => void;
    const promise = new Promise<T>((res) => {
      resolve = res;
    });
    const handle = createOverlayHandle();
    call.handle = handle;
    options?.onHandle?.(handle);
    // The test-host's close hook, if the extension declared one: it is handed the same `done`, so a
    // host that observes the close and a host that resolves the promise are the same callback. pi calls
    // neither (see `PanelTestHooks`), which is why the recorder is the only environment where that
    // half of the close path runs at all.
    options?.onClose?.(done as (result: unknown) => void);
    const component = await factory(tui, theme, keybindings, done);
    call.component = component;
    // A factory that never calls done() still must not hang the harness: resolve undefined.
    return Promise.race([
      promise,
      new Promise<T>((res) => queueMicrotask(() => res(undefined as T))),
    ]);
  }

  /** Number of `custom()` calls made so far. */
  get customCount(): number {
    return this.customCalls.length;
  }

  /** Replay the widget registered under `key` at `width`, one line per row. */
  renderWidget(key: string, width: number): string[] {
    const widget = this.widgets.get(key);
    if (!widget) return [];
    if (Array.isArray(widget.content)) return widget.content;
    return widget.content(createStubTui(), this.theme).render(width);
  }

  /** Render the component most recently returned by a `custom()` factory, or undefined. */
  lastCustom():
    | { render: (width: number) => string[]; sendInput: (data: string) => void }
    | undefined {
    const component = this.#lastCustom?.component;
    if (!component) return undefined;
    return {
      render: (width: number) => component.render(width),
      sendInput: (data: string) => component.handleInput?.(data),
    };
  }

  // --- editor ----------------------------------------------------------------

  setEditorText(text: string): void {
    this.#editorText = text;
  }

  getEditorText(): string {
    return this.#editorText;
  }

  pasteToEditor(text: string): void {
    this.#editorText += text;
  }

  setEditorComponent(factory: EditorFactory | undefined): void {
    this.#editorComponent = factory;
  }

  getEditorComponent(): EditorFactory | undefined {
    return this.#editorComponent;
  }

  // --- themes and tool expansion --------------------------------------------

  getAllThemes(): { name: string; path: string | undefined }[] {
    return [];
  }

  getTheme(_name: string): Theme | undefined {
    return this.theme;
  }

  setTheme(_theme: string | Theme): { success: boolean; error?: string } {
    return { success: true };
  }

  getToolsExpanded(): boolean {
    return false;
  }

  setToolsExpanded(_expanded: boolean): void {}

  // --- helpers ---------------------------------------------------------------

  #recordDialog(kind: string, title: string): void {
    this.dialogCalls.push({ kind, title });
  }

  #nextAnswer<T>(): T | undefined {
    const value = this.dialogAnswers.shift();
    return value === undefined ? undefined : (value as T);
  }
}
