/**
 * The component pi-tui draws inside the pins overlay, and the keys it answers.
 *
 * The pins are ordered on the way in — level sections, and `orderPins` within each — by `panelSections`,
 * held by `PanelMemory` (`panel-frame-cache.ts`), and this class is the only reader of that order: the
 * frame, the bar, the scroll window and the two destructive keys all index the same flattened
 * array, which is what makes the pin under the bar the pin `d` dismisses. The selection itself lives in
 * `panel-component-state.ts`, which is also what invalidates the frame whenever it moves.
 *
 * What is left here is the object pi-tui holds: the host, the theme it colours itself with, the memory, and
 * the members the host and the key dispatcher call. Everything about *drawing* — the cache key, the hit, the
 * rows, the frame's content — is `panel-frame-draw.ts`; the two focus verbs are `panel-component-focus.ts`'s
 * and the keys are dispatched by `panel-input.ts`. This class hands pi-tui its callbacks and owns the state
 * those three read.
 *
 * Keys reach this component only while the overlay holds focus (pi-tui routes input to the focused
 * component alone), which is why the keys hint is drawn only while focused — in the bottom border, and
 * only there. While the panel rests, that same border carries the label the host's `replyHint()` gives
 * (`panel-hint.ts`). Kitty release and repeat events are swallowed, so a held `j` moves once and a held `d`
 * dismisses once.
 *
 * `Enter` submits nothing: it puts `Re #<id>: ` at offset 0 of the raw editor buffer and hands focus back
 * to the main editor. The marker replaces one already there and the rest of the draft is kept verbatim.
 */
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { Component, OverlayHandle, TUI } from "@earendil-works/pi-tui";

import type { PanelFocus } from "./panel-component-focus.ts";
import { focusPanel, unfocusPanel } from "./panel-component-focus.ts";
import { frameCandidate } from "./panel-component-frame.ts";
import type { PanelComponentState } from "./panel-component-state.ts";
import { createPanelComponentState } from "./panel-component-state.ts";
import { PanelMemory, sameFrame } from "./panel-frame-cache.ts";
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
  #state = createPanelComponentState(() => this.#memory.invalidateFrame());

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
   */ #styleOf(): PanelStyle {
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
   * Replace the view the panel draws, re-clamping the selected pin to what is left.
   *
   * Cheap when nothing changed: `refresh()` calls this on every redraw — including the ones a read-only
   * `/pins` or a per-frame rail handoff triggers — and an invalidate that repaints a byte-identical view
   * costs a full layout pass over every pin for no visible reason.
   */
  update(): void {
    const pins = this.#drawn();
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
   * documents, which fires `done()` and *then* `component.dispose?.()`.
   *
   * The one place the panel tells the extension that its surface is going away: the minute's redraw belongs
   * to a drawn panel, and a component pi has popped is not drawn. Optional on `PanelHost` for the same
   * reason `ageNow` is — a hand-built host has no tick to stop.
   */
  dispose(): void {
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
   * key's host call threw and the panel may not be left holding the keyboard. The focus verbs move the same
   * flag through `#interactive()`'s `state` (`panel-component-focus.ts`) as part of taking or ending the
   * interaction; the two are not interchangeable entry points, and this is the one that only moves the flag.
   */
  setFocused(focused: boolean): void {
    this.#state.setFocused(focused);
  }

  /**
   * Move the bar without a key, clamped to the pins that exist.
   *
   * The clamp is only meaningful for a whole row number: `Math.min`/`Math.max` both propagate `NaN`, so
   * a non-integer in would leave a selection that matches no row and silently draws no bar at all. A
   * value that is not an integer is answered with the top row, which is the one row that always exists.
   */
  select(index: number): void {
    const last = this.#drawn().length - 1;
    const row = Number.isInteger(index) ? index : 0;
    this.#state.setSelection(Math.max(0, Math.min(row, last)));
    this.#host.requestRender();
  }

  get selection(): number {
    return this.#state.selection;
  }

  /** The three things a focus change needs: the flag's cell, the handle, and the host. */
  #interactive(): PanelFocus {
    return { state: this.#state, handle: this.#handle, host: this.#host };
  }

  /**
   * The pins the panel draws — `#sections()`'s flattened list, the array the bar is drawn over *is* the
   * array the keys index. The memo, and why this component is its only reader, are `panel-frame-cache.ts`.
   */
  #drawn(): readonly ViewPin[] {
    return this.#sections().flat;
  }

  /**
   * The sections the panel draws from (`PanelMemory.sectionsOf`): the order the keys index *and* the
   * grouping the frame's counts come from, so one call answers both for one frame.
   */
  #sections(): PanelSections {
    return this.#memory.sectionsOf(this.#host.getView().pins);
  }

  /** The pins the panel is drawing, in the order it draws them. See `#drawn` for that order. */
  get pins(): readonly ViewPin[] {
    return this.#drawn();
  }

  /** The frame for this width: `panel-frame-draw.ts` compares the key and, on a miss, lays the rows out. */
  render(width: number): string[] {
    return drawFrame(this.#memory, this.#host, this.#drawFor(width), this.#state);
  }

  /**
   * What one frame is built from (`PanelDraw`): the sectioning, the width pi-tui asked for, and this
   * component's colours. `terminalRows` is a *height* — what the component's TUI stated, or `undefined` for
   * a component built without one, which is the case the layout's fallback ceiling answers for.
   */
  #drawFor(width: number): PanelDraw {
    return {
      sections: this.#sections(),
      width,
      style: this.#styleOf(),
      terminalRows: this.#tui?.terminal?.rows,
    };
  }

  /** Forget the memorised frame and the memorised order together (`PanelMemory`). */
  invalidate(): void {
    this.#memory.invalidate();
  }

  /**
   * The one key dispatch, contained — the guard is `containKey` (`panel-input.ts`), and the reason a key
   * that throws is swallowed there rather than here is stated with it.
   */
  handleInput(data: string): void {
    containKey(data, this, this.#host);
  }
}
