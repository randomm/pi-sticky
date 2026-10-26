/**
 * Where the pins are drawn. One entry point decides the mode, so nothing else in the extension
 * has to know that RPC drops component widgets and print has no UI at all.
 *
 * The rail is the above-editor strip: `📌 Pinned for you (n)` and one row per pin. In `tui` it
 * is a component so it can carry theme colours; in `rpc` a plain string array, because pi's RPC
 * mode ignores component widgets. `print` and `json` have no UI — the state still travels in the
 * tool result's `details`, which is where a headless run reads it.
 *
 * The rail is redrawn by *re-installing* it: pi's `setExtensionWidget` builds the component from
 * the factory on every call and replaces the component the key held, disposing the old one. So a
 * redraw passes a fresh factory closed over the fresh view rather than mutating a component pi
 * may have thrown away — which is also what survives pi clearing extension widgets on `/new`,
 * `/reload` and resume: the next `session_start` installs the rail again from the rebuilt state.
 *
 * The theme-backed `Style` is built inside the factory from the `theme` pi hands it, never from a
 * theme captured earlier, so a theme change colours the rail the next time it draws. And the
 * empty case clears the key instead of installing a factory, because `renderRailLines` returns
 * nothing for an empty view and an empty component is not the same as no widget at all.
 */
import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";

import { type Style, plainStyle, renderRailLines } from "./render.ts";
import { KEY } from "./types.ts";
import type { PinLevel, PinView, StickyConfig } from "./types.ts";

/** pi's RPC rail is a fixed 100 columns; pi caps a string widget at 10 lines. */
const RPC_WIDTH = 100;
const RPC_MAX_LINES = 10;

/** The rail's colours: accent header, one token per level, dim timestamps. */
function themeStyle(theme: Theme): Style {
  return {
    header: (s) => theme.bold(theme.fg("accent", s)),
    marker: (level: PinLevel, s) =>
      theme.fg(level === "warning" ? "warning" : level === "action" ? "accent" : "muted", s),
    dim: (s) => theme.fg("dim", s),
  };
}

/** The component the TUI rail draws from; caches its lines until `invalidate()`. */
class RailComponent implements Component {
  #view: PinView;
  #config: StickyConfig;
  #style: Style;
  #cachedWidth?: number;
  #cachedLines?: string[];

  constructor(view: PinView, config: StickyConfig, theme: Theme) {
    this.#view = view;
    this.#config = config;
    this.#style = themeStyle(theme);
  }

  render(width: number): string[] {
    if (this.#cachedLines !== undefined && this.#cachedWidth === width) return this.#cachedLines;
    const lines = renderRailLines(this.#view, width, {
      maxLines: this.#config.maxWidgetLines,
      style: this.#style,
    });
    this.#cachedWidth = width;
    this.#cachedLines = lines;
    return lines;
  }

  invalidate(): void {
    this.#cachedWidth = undefined;
    this.#cachedLines = undefined;
  }
}

export function drawPins(ctx: ExtensionContext, view: PinView, config: StickyConfig): void {
  if (!ctx.hasUI) return;
  if (view.pins.length === 0) {
    ctx.ui.setWidget(KEY, undefined);
    return;
  }
  if (ctx.mode === "tui") {
    ctx.ui.setWidget(KEY, (tui: TUI, theme: Theme) => new RailComponent(view, config, theme), {
      placement: "aboveEditor",
    });
    // A component widget gets no terminal height and pi does not poll it, so the redraw itself
    // has to ask for the frame; the TUI the factory was built with is the live one.
    return;
  }
  if (ctx.mode === "rpc") {
    ctx.ui.setWidget(
      KEY,
      renderRailLines(view, RPC_WIDTH, {
        maxLines: Math.min(RPC_MAX_LINES, config.maxWidgetLines),
        style: plainStyle,
      }),
      { placement: "aboveEditor" },
    );
  }
}
