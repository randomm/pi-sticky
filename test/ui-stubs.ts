/**
 * Stand-in `Theme` and `TUI` for rendering recorded components in tests.
 *
 * pi's exported `theme` is a globalThis proxy that throws until `initTheme()` runs, and a
 * real `TUI` needs a terminal, so the harness builds its own. The theme returns its text
 * unchanged, which keeps drawn lines comparable to the requested width; the TUI accepts the
 * calls a component or widget factory makes (`requestRender`, focus, overlay) and does
 * nothing, since the test asks the component for its lines directly.
 */
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { Component, OverlayHandle, TUI } from "@earendil-works/pi-tui";

/** Colourless theme: every style call hands back the text it was given. */
export function createPlainTheme(): Theme {
  const identity = (text: string) => text;
  return {
    name: "recording-plain",
    mode: "truecolor",
    fg: (_token: unknown, text: string) => text,
    bg: (_token: unknown, text: string) => text,
    style: (text: string) => text,
    bold: identity,
    italic: identity,
    underline: identity,
    inverse: identity,
    dim: identity,
    strikethrough: identity,
    getFgAnsi: () => "",
    getBgAnsi: () => "",
    colors: {},
    appearance: "dark",
  } as unknown as Theme;
}

/**
 * Overlay handle that tracks visibility and focus without a terminal.
 *
 * Starts **released** and **shown**, which is what an overlay opened `nonCapturing` actually is: pi never
 * took the keyboard, so a test that reads `isFocused()` before anything asked has read pi's answer and not
 * a fixture's hope. A handle that starts focused makes every "the panel let go" assertion vacuous — it was
 * never holding anything.
 *
 * The two no-op guards pi-tui imposes on a `focus()` ask (tui.js:431-436) are not modelled here, and that is
 * the difference between this handle and `panel-handle.ts`'s: this one is for a component test that has no
 * overlay to be on or off a stack, while a keyboard test that has to be able to *lose* a focus ask uses the
 * stack model. Use that one when the question is whether pi granted the keyboard.
 */
export function createOverlayHandle(): OverlayHandle {
  let hidden = false;
  let focused = false;
  return {
    hide: () => {
      hidden = true;
      focused = false;
    },
    setHidden: (value: boolean) => {
      hidden = value;
      if (value) focused = false;
    },
    isHidden: () => hidden,
    focus: () => {
      // pi-tui drops the ask from an entry it is not drawing; so does this.
      if (!hidden) focused = true;
    },
    unfocus: () => {
      focused = false;
    },
    isFocused: () => focused,
    getBounds: () => undefined,
  };
}

/**
 * Stub TUI passed to widget and component factories; renders are requested by the test.
 *
 * The two focus members are a **cell**, not no-ops: `setFocus` writes it and `getFocusedComponent()` reads
 * it, so `panel-focus-reconcile.ts` has a pi to reconcile against and a test can assert where the keystrokes
 * would actually have gone. An editor component is installed as the initial focus, the way pi has its editor
 * focused before an overlay is shown — which is what makes "the panel gave the keyboard back" an observable
 * fact rather than the absence of a flag. `showOverlay` shares the cell with the handle it returns for the
 * same reason: a stub whose handle and focus cell are two separate beliefs cannot detect the disagreement
 * this issue is about.
 */
/** The stub, with the two members only the fixtures reach: pi's focus reader, and its editor. */
export interface StubTui extends TUI {
  /** pi-tui declares this on `TuiBase` (`tui.d.ts:301`) and the `TUI` interface does not carry it. */
  getFocusedComponent(): Component | null;
  /** The component pi had focused before any overlay took the keyboard. */
  editorComponent: Component;
}

export function createStubTui(): StubTui {
  const noop = () => {};
  const children: Component[] = [];
  /** What pi's `focusedComponent` is: written by `setFocus`, read by `getFocusedComponent()`. */
  const editor: Component = { render: () => [], invalidate: () => {} };
  let focusCell: Component | null = editor;
  const stub: Record<string, unknown> = {
    mode: "test",
    children,
    terminal: { columns: 80, rows: 24 },
    fullRedraws: 0,
    // pi-tui's Container concatenates its children's lines, and the composite widgets a
    // factory builds rely on that, so the stub does the same rather than returning nothing.
    render: (width: number) => {
      const lines: string[] = [];
      for (const child of children) lines.push(...child.render(width));
      return lines;
    },
    invalidate: () => {
      for (const child of children) child.invalidate?.();
    },
    addChild: (component: Component) => {
      children.push(component);
    },
    removeChild: (component: Component) => {
      const index = children.indexOf(component);
      if (index >= 0) children.splice(index, 1);
    },
    clear: () => {
      children.length = 0;
    },
    getShowHardwareCursor: () => false,
    setShowHardwareCursor: noop,
    getClearOnShrink: () => false,
    setClearOnShrink: noop,
    setFocus: (component: Component | null) => {
      focusCell = component;
    },
    getFocusedComponent: () => focusCell,
    /** The component pi had focused before any overlay took the keyboard — its editor. */
    editorComponent: editor,
    showOverlay: (component: Component) => {
      // `nonCapturing` is what the panel opens with, so showing does not steal the focus; the handle obeys
      // the same two guards pi-tui's does and answers `isFocused()` from the cell above.
      let hidden = false;
      let onStack = true;
      const grant = () => onStack && !hidden;
      return {
        hide: () => {
          onStack = false;
          hidden = true;
          if (focusCell === component) focusCell = editor;
        },
        setHidden: (value: boolean) => {
          if (hidden === value) return;
          hidden = value;
          if (value && focusCell === component) focusCell = editor;
        },
        isHidden: () => hidden,
        focus: () => {
          if (!grant()) return;
          focusCell = component;
        },
        unfocus: () => {
          if (focusCell !== component) return;
          focusCell = editor;
        },
        isFocused: () => focusCell === component,
        getBounds: () => undefined,
      } as unknown as OverlayHandle;
    },
    hideOverlay: noop,
    hasOverlay: () => false,
    start: noop,
    stop: noop,
    renderNow: noop,
    requestRender: noop,
    addInputListener: () => noop,
    removeInputListener: noop,
    onTerminalColorSchemeChange: () => noop,
    setTerminalColorSchemeNotifications: noop,
    // A stubbed terminal never replies to an OSC 10/11 query, so no colours are reported.
    queryTerminalColors: async () => ({}),
  };
  return stub as unknown as StubTui;
}

/** A fixed set of lines as a Component, for tests that need one without a factory. */
export function linesComponent(lines: string[]): Component & { dispose?: () => void } {
  return { render: () => lines, invalidate: () => {} };
}
