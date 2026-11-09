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
import { focusPanel, panelFocusCells, unfocusPanel } from "./panel-component-focus.ts";
import type { PanelComponentState } from "./panel-component-state.ts";
import { createPanelComponentState } from "./panel-component-state.ts";
import { applyViewMove } from "./panel-component-view-move.ts";
import { PanelMemory, sameFrame } from "./panel-frame-cache.ts";
import type { DrawnKeys, PanelFrame } from "./panel-frame-cache.ts";
import { drawFrame } from "./panel-frame-draw.ts";
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

  /** The handle pi handed this overlay, for the one reader that is not the component itself: the escape hatch. */
  handle(): OverlayHandle | undefined {
    return this.#handle;
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
   * Replace the view the panel draws, re-clamping the bar to what is left — or leaving the frame standing over
   * the view that dropped it. The decision and its writes are `applyViewMove`'s
   * (`panel-component-view-move.ts`), over the four outcomes of `viewMoveOf` (`panel-frame-cache.ts`).
   */
  update(): void {
    applyViewMove({
      memory: this.#memory,
      state: this.#state,
      host: this.#host,
      livePins: () => this.#host.getView().pins,
      drawnOrder: () => this.pins,
      drawnKeys: () => this.#drawnKeys,
      setDrawnKeys: (pair) => {
        this.#drawnKeys = pair;
      },
      invalidate: () => this.invalidate(),
    });
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

  /** The collaborators a focus change needs — assembled by `panelFocusCells` (`panel-component-focus.ts`). */
  #interactive(): PanelFocus {
    return panelFocusCells({
      state: this.#state,
      handle: () => this.#handle,
      host: this.#host,
      tui: () => this.#tui,
    });
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
