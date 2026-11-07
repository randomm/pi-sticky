/**
 * The component pi-tui draws inside the pins overlay, and the keys it answers.
 *
 * The pins are ordered on the way in — level sections, and `orderPins` within each — by `panelSections`,
 * held by `PanelMemory` (`panel-frame-cache.ts`), and this class is the only reader of that order: the
 * frame, the bar, the scroll window and the two destructive keys all index the same flattened
 * array, which is what makes the pin under the bar the pin `d` dismisses. The selection itself lives in
 * `panel-component-state.ts`, which is also what invalidates the frame whenever it moves.
 *
 * What is left here is the object pi-tui holds: the host, the theme it colours itself with, the memory, the
 * pair the keys read, and the members the host and the key dispatcher call. Drawing is `panel-frame-draw.ts`;
 * what the frame still answers about the bar (`frameAnswersBar`, `drawnKeysOf`, the freeze `update()` sets) is
 * `panel-component-bar.ts`; the bar's verbs and the drawn order they clamp to are
 * `panel-component-bar-move.ts`; focus is `panel-component-focus.ts`' and the keys are `panel-input.ts`'s.
 *
 * Keys reach this component only while the overlay holds focus (pi-tui routes input to the focused
 * component alone), which is why the keys hint is drawn only while focused — in the bottom border, and
 * only there. While the panel rests, that same border carries the label the host's `replyHint()` gives
 * (`panel-hint.ts`). Kitty release and repeat events are swallowed, so a held `j` moves once and a held `d`
 * dismisses once.
 *
 * `Enter` submits nothing: it puts `Re #<id>: ` at offset 0 of the raw editor buffer and hands focus back
 * to the main editor. The marker replaces one already there and the rest of the draft is kept verbatim.
 * Keys `1` to `MAX_OPTIONS` (`pin-fields.ts`) do the same for one of the selected pin's `options`, with that
 * option's text after the marker; like `Enter`, they send nothing — the user presses Enter.
 */
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { Component, OverlayHandle, TUI } from "@earendil-works/pi-tui";

import { moveBar, panelBarOrder, selectBar } from "./panel-component-bar-move.ts";
import type { PanelBar } from "./panel-component-bar-move.ts";
import { drawnKeysOf, frameAnswersBar, frameDrawOf, liveKeys } from "./panel-component-bar.ts";
import type { PanelFocus } from "./panel-component-focus.ts";
import { focusPanel, unfocusPanel } from "./panel-component-focus.ts";
import { frameCandidate } from "./panel-component-frame.ts";
import type { PanelComponentState } from "./panel-component-state.ts";
import { createPanelComponentState } from "./panel-component-state.ts";
import { PanelMemory, sameFrame } from "./panel-frame-cache.ts";
import type { DrawnKeys, PanelFrame } from "./panel-frame-cache.ts";
import { clampSelection, drawFrame } from "./panel-frame-draw.ts";
import type { PanelDraw } from "./panel-frame-draw.ts";
import { NO_PANEL_COLOUR } from "./panel-host.ts";
import type { PanelHost } from "./panel-host.ts";
import { containKey } from "./panel-input.ts";
import type { PanelSections } from "./panel-sections.ts";
import { panelThemeStyle } from "./render.ts";
import type { PanelStyle } from "./render.ts";
import type { ViewPin } from "./types.ts";

/**
 * The overlay's component. pi-tui calls `render` with the overlay's resolved width, so the lines are
 * built for exactly that width and this class never guesses at padding.
 */
export class PanelComponent implements Component {
  #host: PanelHost;
  #tui: TUI | undefined;
  #theme: Theme | undefined;
  /** Colours resolved on first draw by `#styleOf`; identity colours if nothing supplies them. */
  #style: PanelStyle | undefined;
  #handle: OverlayHandle | undefined;
  /**
   * What the component has memorised — last frame and drawn order in one object, so `invalidate()` drops
   * both. `PanelMemory` (`panel-frame-cache.ts`) owns the key it obeys and why the halves clear together.
   */
  #memory = new PanelMemory();
  /**
   * The bar and the focus flag, and the invalidation that has to follow either write. The state is handed
   * the frame's door only (`invalidateFrame`), not the memory: moving the bar or taking the keyboard changes
   * no sectioning, so it must not pay for a re-sort of a view that did not move.
   */
  #state = createPanelComponentState(() => this.invalidateFrame());
  /**
   * What the last frame drew its bar on, as the keys read it. One writer — the drawer's `recordDrawn` — and no
   * door that clears it with the frame: its lifetime is the overlay's, and the screen keeps those rows until
   * pi-tui asks for new ones. See `panel-component-bar.ts`.
   */
  #drawnKeys: DrawnKeys | undefined;

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
   * The style to draw with, resolved on first use: the host's if it has one, else the mapping its own theme
   * implies — through `panelThemeStyle`, the very mapping the rail builds, so one mapping colours both
   * surfaces — else the identity style, which keeps the frame plain rather than throwing on a missing
   * `selected`. Lazy because a test hands the theme to some components and not to others.
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
   * Replace the view the panel draws, re-clamping the bar to what is left — or leaving the frame over the view
   * that dropped it (`panel-component-bar.ts`). Cheap when nothing changed: `refresh()` calls this on every
   * redraw, and repainting a byte-identical view costs a layout pass for nothing.
   */
  update(): void {
    const frame = this.#memory.frame;
    // So long as the frame describes what pi-tui is showing, this call must not touch it: `#sections()` below
    // has already re-sectioned the *new* view, and the clamp after it clamps to *that* list's length, which would
    // slide the bar off the row the overlay is still drawing. The two readings of "does the frame still answer the bar'"
    // are `panel-component-bar.ts`'s; what this call adds is the freeze's own condition, below.
    if (frameAnswersBar(frame, this.#host.getView().pins)) {
      this.#host.requestRender();
      return;
    }
    // The frame's bar is a pin this view no longer holds. It keeps standing until the panel settles, which is
    // this call's judgement alone:
    //
    // - **still the bar the user was shown** (it never moved, and the panel still has the keyboard): those rows
    //   are what the user is reading, the frame's `selection` indexes *its* rows so there is nothing to clamp it
    //   to, and `drawnKeys()` keeps refusing that row. Freeze, and leave the screen as pi-tui drew it;
    // - **the bar moved, or the panel lost focus while it stood**: the interaction opened over those rows has
    //   ended — answered, refused or left — and a frame is not owed a second life. Without this the panel would
    //   be stranded drawing rows of a view nobody is looking at. A *refused* move is not that news: it has no
    //   effect to settle, and the pair is left alone (`panel-input.ts` answers the row the user aimed at).
    if (frame !== undefined) {
      // The freeze, set here on the way to `drawFrame` rather than read off the frame: `invalidateFrame()` is the
      // user's door and clears it whenever the bar or the focus moves, so a frame frozen at an earlier publish
      // cannot outlive a keystroke that moved the marker off its row.
      if (this.#drawnKeys?.selection === frame.selection && this.#state.focused) {
        this.#memory.frozen = true;
        // No re-sectioning and no redraw: the memory's drawn order has to stay the array these rows were laid
        // out over, because the move guard in `panel-input.ts` reads that array and re-sectioning it would have
        // a key refuse a row the frame really drew. The next request hits the cache; the freeze is what stops a
        // repaint (the minute over, a theme change) from drawing a view the user is not looking at.
        return;
      }
      // Settle on the view that answered. The bar comes home first, through the same clamp every other entry
      // point uses: the frozen marker indexes *its* rows and the frame is about to be replaced by one drawn over
      // a shorter view. Writing it drops the frame and the pair together, as the state's setters do — a pair left
      // behind after its frame is gone would have the next key answer a bar nobody drew.
      this.#drawnKeys = undefined;
      this.#memory.invalidateFrame();
      this.#memory.frozen = false;
      this.#host.requestRender();
      return;
    }
    const pins = this.pins;
    // The clamp moves the bar through the state's own setter, so the frame cannot outlive the selection —
    // and it is the same clamp `render()` applies, so the two entry points cannot disagree about the floor.
    const selection = clampSelection(this.#state.selection, pins.length);
    if (selection !== this.#state.selection) this.#state.setSelection(selection);
    // One comparison, through the cache's own test, over the candidate `panel-component-frame.ts` spells
    // with the very builder `render()` memorises: `width` and `lines` are the two members `sameFrame`
    // ignores, which is what lets a redraw (not a resize) hit.
    if (
      sameFrame(
        this.#memory.frame,
        frameCandidate(pins, this.#state.focused, selection, this.#host),
      )
    ) {
      return;
    }
    this.invalidate();
    this.#host.requestRender();
  }

  /**
   * The panel's own teardown, called by pi inside the host's `close()` — the same path `panel-close.ts`
   * documents, which fires `done()` and *then* `component.dispose?.()`. The one place the panel tells the
   * extension its surface is going away: the minute's redraw belongs to a drawn panel, and a component pi has
   * popped is not drawn. Optional on `PanelHost` for the same reason `ageNow` is.
   */
  dispose(): void {
    // The keys' pair is deliberately **not** cleared here: the next `render()` replaces it with one that is
    // drawn. See `panel-component-bar.ts` for the pair's lifetime.
    this.#memory.invalidate();
    this.#host.onDispose?.();
  }

  /** Focus and the end of the interaction: the order the three effects go in is `panel-component-focus.ts`. */
  focus(): void {
    focusPanel(this.#interactive());
  }

  unfocus(): void {
    unfocusPanel(this.#interactive());
  }

  isFocused(): boolean {
    return this.#state.focused;
  }

  /**
   * Set the focus flag and drop the frame: the dispatcher's door, the one `containKey`'s catch calls when a
   * key's host call threw and the panel may not hold the keyboard. The focus verbs move the same flag as part
   * of taking or ending the interaction; this one only moves the flag.
   */
  setFocused(focused: boolean): void {
    this.#state.setFocused(focused);
  }

  /** The bar's verbs and the cells they move, all in `panel-component-bar-move.ts` — which also owns the pair a
   * move has to carry with the bar. `bar()` is built per call so no cell outlives a reload. */
  select(index: number): void {
    selectBar(this.bar(), index);
  }

  moveTo(frameIndex: number, liveIndex: number, step: number): void {
    moveBar(this.bar(), frameIndex, liveIndex, step);
  }

  bar(): PanelBar {
    return {
      state: this.#state,
      memory: this.#memory,
      pins: this.pins,
      host: this.#host,
      drawnKeys: () => this.#drawnKeys,
      setDrawnKeys: (pair) => {
        this.#drawnKeys = pair;
      },
    };
  }

  get selection(): number {
    return this.#state.selection;
  }

  /** The three things a focus change needs: the flag's cell, the handle, and the host. */
  #interactive(): PanelFocus {
    return { state: this.#state, handle: this.#handle, host: this.#host };
  }

  /**
   * The sections the panel draws from — `panelBarOrder` (`panel-component-bar-move.ts`), beside the verbs that
   * clamp the bar to that order. The memo is the memory's, `panel-frame-cache.ts`.
   */
  #sections(): PanelSections {
    return panelBarOrder(this.#memory, this.#host);
  }

  /** The pins the panel is drawing, in the order it draws them — `#sections()` flattened. */
  get pins(): readonly ViewPin[] {
    return this.#sections().flat;
  }

  /** The keys' pair — the cell `panel-component-bar.ts` explains, written only by the drawer. */
  drawnKeys(): DrawnKeys {
    const frame = this.#memory.frame;
    // The never-drawn component: `focusPanel` only asks pi-tui for a frame, so the first keystroke after the
    // focus key arrives with no frame to answer from, and the live pins are the only answer there is.
    return frame === undefined
      ? liveKeys(this.pins, this.selection)
      : drawnKeysOf(frame, this.#host.getView().pins);
  }

  /** The frame for this width: `panel-frame-draw.ts` compares the key and, on a miss, lays the rows out. */
  render(width: number): string[] {
    return drawFrame(this.#memory, this.#host, this.#drawFor(width), this.#state);
  }

  /** What one frame is built from — the five answers of `frameDrawOf` (`panel-component-bar.ts`). */
  #drawFor(width: number): PanelDraw {
    return frameDrawOf({
      sections: this.#sections(),
      width,
      style: this.#styleOf(),
      terminalRows: this.#tui?.terminal?.rows,
      setDrawnKeys: (pair) => {
        this.#drawnKeys = pair;
      },
    });
  }

  /** Forget the memorised frame and the memoised order. The keys' pair outlives both — `panel-component-bar.ts`. */
  invalidate(): void {
    this.#memory.invalidate();
  }

  /**
   * Drop the memorised frame, keeping the memoised order — the door the state's writes are handed, and the one
   * that ends a freeze. The keys' pair is deliberately **not** dropped with it.
   */
  invalidateFrame(): void {
    this.#memory.invalidateFrame();
  }

  /** The one key dispatch, contained — the guard is `containKey` (`panel-input.ts`), which says why. */
  handleInput(data: string): void {
    containKey(data, this, this.#host);
  }
}
