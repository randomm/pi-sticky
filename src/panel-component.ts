/**
 * The component pi-tui draws inside the pins overlay, and the keys it answers.
 *
 * The selection and the focus flag live in this closure, not in the deps object: they are view
 * state of one overlay instance, and a redraw that read them back from a fresh component would lose
 * the user's place. `update()` is what `redraw()` calls on the *open* panel — the view is replaced
 * in place and the TUI is asked for a frame, because pi never rebuilds an overlay it already has. A
 * view that no longer holds the selected pin re-clamps the selection, so a dismissal from `/unpin`
 * cannot leave the bar past the end.
 *
 * Keys reach this component only while the overlay holds focus (pi-tui routes input to the focused
 * component alone), which is why the hint line is drawn only while focused: an unfocused panel
 * advertising keys it cannot receive would be a lie. Kitty release and repeat events are swallowed,
 * so a held `j` moves once and a held `d` dismisses once.
 *
 * `Enter` submits nothing: it puts `Re #<id>: ` at offset 0 of the raw editor buffer and hands focus
 * back to the main editor. The marker replaces one that is already there and the rest of the draft
 * is kept verbatim; submitting it is the reply ticket's job.
 */
import { isKeyRelease, isKeyRepeat, matchesKey } from "@earendil-works/pi-tui";

import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import type { Component, KeyId, OverlayHandle, TUI } from "@earendil-works/pi-tui";

import { buildPanelLines } from "./panel-lines.ts";
import type { PanelContent } from "./panel-lines.ts";
import type { PanelStyle } from "./render.ts";
import type { PinView } from "./types.ts";

/** The keys that move the bar; `matchesKey` also takes the Kitty forms of each. */
const UP_KEYS: readonly KeyId[] = ["up", "k"];
const DOWN_KEYS: readonly KeyId[] = ["down", "j"];

/**
 * Shifted `D` is not a key id pi-tui defines, so it is recognised from the raw character; `BARE`
 * keeps an escape sequence that happens to end in `d` from reading as a press of it.
 */
const BARE = /^[a-zA-Z]$/;

/**
 * Colours for a component whose host has none to give and whose factory got no theme: the rail's
 * identity style has no `selected`, and a selected row drawn with no bar at all would look like a panel
 * whose keys do nothing. Exported because `PanelOwner` holds the same fallback for the same reason.
 */
export const NO_PANEL_COLOUR: PanelStyle = {
  header: (s) => s,
  marker: (_level, s) => s,
  dim: (s) => s,
  selected: (s) => s,
};

/** Rows to fall back to when neither the overlay bounds nor the terminal can be asked. */
const FALLBACK_ROWS = 24;

/**
 * The tallest panel ever drawn. A tall terminal is not a reason to lay out a thousand rows the
 * overlay clips away, and pi-tui's own `maxHeight` of `"100%"` keeps this above what it will draw.
 */
const MAX_PANEL_ROWS = 100;

/** One of `keys` pressed, whatever shape the terminal sent it in. */
function presses(data: string, keys: readonly KeyId[]): boolean {
  return keys.some((key) => matchesKey(data, key));
}

/** A press of `d` or `D`. */
function isDismissKey(data: string): boolean {
  return matchesKey(data, "d") || (BARE.test(data) && data.toLowerCase() === "d");
}

/**
 * `Re #12: ` at the front of a draft, replacing a marker that is already there. Anchored at offset 0
 * of the *raw* buffer: a leading space the user typed is part of the draft, not a marker to replace.
 */
export function replyMarker(text: string, id: number): string {
  return `Re #${id}: ${text.replace(/^Re #\d+: /, "")}`;
}

/** What the component reads from the extension, and what it calls back into. */
export interface PanelHost {
  getView(): PinView;
  /** The panel's colours; a host with none to give falls back to the colourless style below. */
  style(): PanelStyle | undefined;
  /** Ask for a frame after the view or the selection moved. */
  requestRender(): void;
  /** Record a dismissal of `id` as the user and redraw — `/unpin`'s path, not a second one. */
  dismiss(id: number): void;
  /** Hand focus back to whatever held it before the overlay took it. */
  unfocus(): void;
  /** Put `Re #<id>: ` at the front of the editor draft and focus the editor. */
  startReply(id: number): void;
}

/**
 * The overlay's component. pi-tui calls `render` with the overlay's resolved width, so the lines are
 * built for exactly that width and this class never guesses at padding.
 */
export class PanelComponent implements Component {
  #host: PanelHost;
  #tui: TUI | undefined;
  #theme: Theme | undefined;
  #handle: OverlayHandle | undefined;
  #focused = false;
  #selection = 0;
  #cachedWidth?: number;
  #cachedLines?: string[];

  constructor(host: PanelHost, tui?: TUI, theme?: Theme) {
    this.#host = host;
    this.#tui = tui;
    this.#theme = theme;
  }

  /** Called by the open/close logic as soon as pi hands the handle over. */
  setHandle(handle: OverlayHandle): void {
    this.#handle = handle;
  }

  /**
   * The style to draw with.
   *
   * The host's is the answer in normal operation — `PanelOwner` builds it from the theme pi handed
   * the factory. The component's own theme is consulted here as well, because the colours are what a
   * caller who built the component directly (a test of the drawing, or a host that hands the theme to
   * the component but keeps the style to itself) has actually supplied; and when neither has anything
   * to give, identity colours keep the frame plain rather than throwing on a missing `selected`.
   */
  #style(): PanelStyle {
    const fromHost = this.#host.style();
    if (fromHost) return fromHost;
    const theme = this.#theme;
    if (theme) {
      return {
        header: (text) => theme.bold(theme.fg("accent", text)),
        marker: (level, text) =>
          theme.fg(level === "warning" ? "warning" : level === "action" ? "accent" : "muted", text),
        dim: (text) => theme.fg("dim", text),
        selected: (text) => theme.inverse(text),
      };
    }
    return NO_PANEL_COLOUR;
  }

  /** The theme the factory was built with, for a host that colours itself. */
  theme(): Theme | undefined {
    return this.#theme;
  }

  /** Replace the view the panel draws; the selected pin is re-clamped to what is left. */
  update(): void {
    const pins = this.#host.getView().pins;
    if (this.#selection >= pins.length) this.#selection = Math.max(0, pins.length - 1);
    this.invalidate();
    this.#host.requestRender();
  }

  /** Focus model: the panel is interactive only while the handle's focus is held. */
  focus(): void {
    this.#focused = true;
    this.invalidate();
    this.#handle?.focus();
    this.#host.requestRender();
  }

  /** `Escape` and `Enter` both end the interaction; neither evicts the overlay. */
  unfocus(): void {
    this.#focused = false;
    this.invalidate();
    this.#handle?.unfocus();
    this.#host.requestRender();
  }

  isFocused(): boolean {
    return this.#focused;
  }

  /** Move the bar without a key, clamped to the pins that exist. */
  select(index: number): void {
    const last = this.#host.getView().pins.length - 1;
    this.#selection = Math.max(0, Math.min(index, last));
    this.invalidate();
    this.#host.requestRender();
  }

  get selection(): number {
    return this.#selection;
  }

  render(width: number): string[] {
    if (this.#cachedLines !== undefined && this.#cachedWidth === width) return this.#cachedLines;
    const content: PanelContent = {
      pins: this.#host.getView().pins,
      selection: this.#selection,
      focused: this.#focused,
    };
    const lines = buildPanelLines(content, width, this.#height(), this.#style());
    this.#cachedWidth = width;
    this.#cachedLines = lines;
    return lines;
  }

  invalidate(): void {
    this.#cachedWidth = undefined;
    this.#cachedLines = undefined;
  }

  handleInput(data: string): void {
    if (data === "" || isKeyRelease(data) || isKeyRepeat(data)) return;
    const pins = this.#host.getView().pins;
    if (matchesKey(data, "escape")) {
      this.unfocus();
      return;
    }
    if (matchesKey(data, "enter")) {
      const pin = pins[this.#selection];
      if (pin) this.#host.startReply(pin.id);
      this.unfocus();
      return;
    }
    if (isDismissKey(data)) {
      const pin = pins[this.#selection];
      // The host's dismissal redraws and `update()` re-clamps, so dismissing the last pin lands the
      // bar on the new last one rather than on a row that no longer exists.
      if (pin) this.#host.dismiss(pin.id);
      return;
    }
    const moved = presses(data, UP_KEYS) ? -1 : presses(data, DOWN_KEYS) ? 1 : 0;
    if (moved === 0) return;
    const next = this.#selection + moved;
    if (next < 0 || next >= pins.length) return;
    this.#selection = next;
    this.invalidate();
    this.#host.requestRender();
  }

  /**
   * Rows to draw: the terminal's own height, capped by the overlay's `maxHeight`. Deliberately *not*
   * `handle.getBounds()`: pi-tui computes the layout from `component.render(width)`, so reading the
   * bounds from the previous frame would make the panel's height depend on what it drew last frame
   * and a dismissed pin could leave a hole. `maxHeight` is `"100%"`, which pi-tui clamps to the
   * available rows, so filling the terminal is both the intent and the ceiling.
   */
  #height(): number {
    const rows = this.#tui?.terminal?.rows;
    const available = typeof rows === "number" && rows > 0 ? rows : FALLBACK_ROWS;
    return Math.min(available, MAX_PANEL_ROWS);
  }
}
