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

/** Overlay handle that tracks visibility and focus without a terminal. */
export function createOverlayHandle(): OverlayHandle {
  let hidden = false;
  let focused = true;
  return {
    hide: () => {
      hidden = true;
      focused = false;
    },
    setHidden: (value: boolean) => {
      hidden = value;
    },
    isHidden: () => hidden,
    focus: () => {
      focused = true;
    },
    unfocus: () => {
      focused = false;
    },
    isFocused: () => focused,
    getBounds: () => undefined,
  };
}

/** Stub TUI passed to widget and component factories; renders are requested by the test. */
export function createStubTui(): TUI {
  const noop = () => {};
  const children: Component[] = [];
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
    setFocus: noop,
    showOverlay: () => createOverlayHandle(),
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
  return stub as unknown as TUI;
}

/** A fixed set of lines as a Component, for tests that need one without a factory. */
export function linesComponent(lines: string[]): Component & { dispose?: () => void } {
  return { render: () => lines, invalidate: () => {} };
}
