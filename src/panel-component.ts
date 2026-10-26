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

import type { Theme } from "@earendil-works/pi-coding-agent";
import type { Component, KeyId, OverlayHandle, TUI } from "@earendil-works/pi-tui";

import { isDismissKey, isSubmitKey } from "./panel-keys.ts";
import { buildPanelLines } from "./panel-lines.ts";
import type { PanelContent } from "./panel-lines.ts";
import { panelThemeStyle } from "./render.ts";
import type { PanelStyle } from "./render.ts";
import type { PinView, ViewPin } from "./types.ts";

/** The keys that move the bar; `matchesKey` also takes the Kitty forms of each. */
const UP_KEYS: readonly KeyId[] = ["up", "k"];
const DOWN_KEYS: readonly KeyId[] = ["down", "j"];

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

/**
 * `Re #12: ` at the front of a draft, replacing a marker that is already there. Anchored at offset 0
 * of the *raw* buffer: a leading space the user typed is part of the draft, not a marker to replace.
 */
export function replyMarker(text: string, id: number): string {
  return `Re #${id}: ${text.replace(/^Re #\d+: /, "")}`;
}

/**
 * What the component reads from the extension, and what it calls back into.
 *
 * `unfocus` is the one member the component never calls *itself* — it releases its own overlay handle —
 * and the one the extension must still be told: a panel the user has left with `Escape` or `Enter`
 * keeps owning the pins until the owner is asked again, and the owner is the only thing that can put
 * them back on the rail. The round trip is the notification, not a way to move the handle.
 */
export interface PanelHost {
  getView(): PinView;
  /** The panel's colours; a host with none to give falls back to the colourless style below. */
  style(): PanelStyle | undefined;
  /** Ask for a frame after the view or the selection moved. */
  requestRender(): void;
  /** Record a dismissal of `id` as the user and redraw — `/unpin`'s path, not a second one. */
  dismiss(id: number): void;
  /** Tell the owner the interaction ended, so it can settle which surface owns the pins. */
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
  /**
   * The colours this component draws with, resolved once: the host's if it has any, else the mapping its
   * own theme implies, else the identity style. Like `RailComponent`, which builds `themeStyle(theme)` in
   * its constructor — the two surfaces are meant to be coloured alike, and they are not if one resolves
   * per frame and the other per construction. Built lazily because a test hands the theme to some
   * components and not to others.
   */
  #style: PanelStyle | undefined;
  #handle: OverlayHandle | undefined;
  #focused = false;
  #selection = 0;
  #cachedWidth?: number;
  #cachedLines?: string[];
  /** What the cached frame was drawn from, so a redraw that changed nothing costs nothing. */
  #drawnPins: readonly ViewPin[] | undefined;
  #drawnSelection = 0;
  #drawnFocused = false;

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
   * The style to draw with, resolved once on first use.
   *
   * The host's is the answer in normal operation — `PanelOwner` builds it from the theme pi handed
   * the factory. The component's own theme is consulted as well, because the colours are what a
   * caller who built the component directly (a test of the drawing, or a host that hands the theme to
   * the component but keeps the style to itself) has actually supplied — and it goes through
   * `panelThemeStyle`, the very mapping the rail's sibling surface uses, so one mapping colours both
   * and cannot invent a second shade for the selection bar. When neither has anything to give,
   * identity colours keep the frame plain rather than throwing on a missing `selected`.
   */
  #styleOf(): PanelStyle {
    if (this.#style === undefined) {
      this.#style = this.#host.style() ?? (this.#theme && panelThemeStyle(this.#theme));
    }
    return this.#style ?? NO_PANEL_COLOUR;
  }

  /** The theme the factory was built with, for a host that colours itself. */
  theme(): Theme | undefined {
    return this.#theme;
  }

  /**
   * Replace the view the panel draws; the selected pin is re-clamped to what is left.
   *
   * Cheap when nothing changed: `refresh()` calls this on every redraw, including the ones a read-only
   * `/pins` or a per-frame rail handoff triggers, and an invalidate that repaints a byte-identical view
   * costs a full layout pass over every pin for no visible reason. The pins array is the change test
   * because both `commit` and `reconstruct` publish a *fresh* array, so an identical reference is a
   * view that really was not replaced.
   */
  update(): void {
    const pins = this.#host.getView().pins;
    if (this.#selection >= pins.length) this.#selection = Math.max(0, pins.length - 1);
    if (this.#sameFrame(pins)) return;
    this.invalidate();
    this.#host.requestRender();
  }

  /** Whether the frame cached right now is the frame the view, bar and focus would draw. */
  #sameFrame(pins: readonly ViewPin[]): boolean {
    return (
      this.#cachedLines !== undefined &&
      this.#drawnPins === pins &&
      this.#drawnSelection === this.#selection &&
      this.#drawnFocused === this.#focused
    );
  }

  /** Focus model: the panel is interactive only while the handle's focus is held. */
  focus(): void {
    this.#focused = true;
    this.invalidate();
    this.#handle?.focus();
    this.#host.requestRender();
  }

  /**
   * `Escape` and `Enter` both end the interaction; neither evicts the overlay.
   *
   * The handle moves here and the host is told, in that order: the owner decides what an unfocused panel
   * means for the rail, and it can only do that if the interaction ending reaches it.
   */
  unfocus(): void {
    this.#focused = false;
    this.invalidate();
    this.#handle?.unfocus();
    this.#host.unfocus();
    this.#host.requestRender();
  }

  isFocused(): boolean {
    return this.#focused;
  }

  /**
   * Move the bar without a key, clamped to the pins that exist.
   *
   * The clamp is only meaningful for a whole row number: `Math.min`/`Math.max` both propagate `NaN`, so
   * a non-integer in would leave a selection that matches no row and silently draws no bar at all. A
   * value that is not an integer is answered with the top row, which is the one row that always exists.
   */
  select(index: number): void {
    const last = this.#host.getView().pins.length - 1;
    const row = Number.isInteger(index) ? index : 0;
    this.#selection = Math.max(0, Math.min(row, last));
    this.invalidate();
    this.#host.requestRender();
  }

  get selection(): number {
    return this.#selection;
  }

  render(width: number): string[] {
    if (this.#cachedLines !== undefined && this.#cachedWidth === width) return this.#cachedLines;
    const pins = this.#host.getView().pins;
    const content: PanelContent = {
      pins,
      selection: this.#selection,
      focused: this.#focused,
    };
    const lines = buildPanelLines(content, width, this.#height(), this.#styleOf());
    this.#cachedWidth = width;
    this.#cachedLines = lines;
    this.#drawnPins = pins;
    this.#drawnSelection = this.#selection;
    this.#drawnFocused = this.#focused;
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
    if (isSubmitKey(data)) {
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
