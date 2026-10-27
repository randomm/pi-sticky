/**
 * The component pi-tui draws inside the pins overlay, and the keys it answers.
 *
 * The pins are ranked on the way in (`RankedPins`, `panel-ranked.ts`) and this class is the only reader of
 * that order: the frame, the bar, the clamp, the scroll window and the two destructive keys all index the
 * same array, which is what makes the pin under the bar the pin `d` dismisses.
 *
 * The selection and the focus flag live here, not in the deps object: they are view state of one overlay
 * instance, and a redraw that read them back from a fresh component would lose the user's place. `update()`
 * is what `redraw()` calls on the *open* panel — the view is replaced in place and the TUI is asked for a
 * frame, because pi never rebuilds an overlay it already has. A view that no longer holds the selected pin
 * re-clamps the selection, so a dismissal from `/unpin` cannot leave the bar past the end.
 *
 * Keys reach this component only while the overlay holds focus (pi-tui routes input to the focused
 * component alone), which is why the keys hint is drawn only while focused — in the bottom border, and
 * only there. While the panel rests, that same border carries the label the host's `replyHint()` gives
 * (`panel-hint.ts`), so the key that opens the panel is legible from the editor; the host decides it has
 * nothing to say and the border is plain rule. Kitty release and repeat events are swallowed, so a held
 * `j` moves once and a held `d` dismisses once.
 *
 * `Enter` submits nothing: it puts `Re #<id>: ` at offset 0 of the raw editor buffer and hands focus back
 * to the main editor. The marker replaces one already there and the rest of the draft is kept verbatim;
 * submitting it is the reply ticket's job.
 */
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { Component, OverlayHandle, TUI } from "@earendil-works/pi-tui";

import { ageAt, ageBucket } from "./panel-age.ts";
import { PanelMemory, sameFrame } from "./panel-frame-cache.ts";
import type { PanelFrame } from "./panel-frame-cache.ts";
import { NO_PANEL_COLOUR } from "./panel-host.ts";
import type { PanelHost } from "./panel-host.ts";
import { containKey } from "./panel-input.ts";
import { buildPanelLines } from "./panel-lines.ts";
import type { PanelContent } from "./panel-lines.ts";
import { panelLayout } from "./panel-rows.ts";
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
  /** The draw-order memo, owned by this component alone: a shared one is process state, not a cache. */
  /**
   * What the component has memorised: the last frame and the order its rows were built in, in one object so
   * `invalidate()` cannot leave a "same frame" verdict behind against a cache it has just dropped, nor an
   * order behind against a dropped frame. See `PanelMemory` (`panel-frame-cache.ts`).
   *
   * `update()` compares the live view, bar and focus against it to decide whether a redraw costs a layout
   * pass, and `render()` compares the *pins* against it for the same reason in the other direction:
   * `render()` is what pi-tui calls on its own schedule, and an overlay that was not sent an `update()` can
   * be asked for a frame after the view was swapped under it. A stale frame drawn at the width the cache was
   * keyed on is the old view's pins still on the user's screen.
   */
  #memory = new PanelMemory();

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
   * The style to draw with, resolved once: the host's if it has one, else the mapping its own theme implies
   * (through `panelThemeStyle`, the very mapping the rail builds, so one mapping colours both surfaces),
   * else identity colours — which keep the frame plain rather than throwing on a missing `selected`.
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
   * Replace the view the panel draws, re-clamping the selected pin to what is left.
   *
   * Cheap when nothing changed: `refresh()` calls this on every redraw — including the ones a read-only
   * `/pins` or a per-frame rail handoff triggers — and an invalidate that repaints a byte-identical view
   * costs a full layout pass over every pin for no visible reason.
   */
  update(): void {
    const pins = this.#ranked();
    if (this.#selection >= pins.length) this.#selection = Math.max(0, pins.length - 1);
    if (this.#sameFrame(pins)) return;
    this.invalidate();
    this.#host.requestRender();
  }

  /** Whether the frame cached right now is the frame the view, bar, focus, resting label and age would draw. */
  #sameFrame(pins: readonly ViewPin[]): boolean {
    return sameFrame(this.#memory.frame, this.#candidate(pins));
  }

  /**
   * Everything the frame the component would draw right now depends on, read once.
   *
   * A method rather than five arguments at each call site because `update()` and `render()` ask the same
   * question at different moments, and a candidate the two built differently is a cache that hits for one
   * and misses for the other.
   */
  #candidate(pins: readonly ViewPin[]): PanelFrame {
    return {
      lines: [],
      width: 0,
      pins,
      selection: this.#selection,
      focused: this.#focused,
      replyHint: this.#host.replyHint(),
      ageNow: this.#ageBucket(),
    };
  }

  /**
   * The instant this frame ages its pins at: the host's clock when it has one, else this instant.
   *
   * Read once per entry point — not per row — so every age in one frame agrees, and read at draw time
   * rather than stored on the component: a component lives across the minute its own rows are aged in.
   */
  #ageNow(): string {
    const clock = this.#host.ageNow;
    return ageAt(clock === undefined ? undefined : () => clock());
  }

  /** The minute `#ageNow()` falls in — the figure the frame cache and the tick's minute hand both compare. */
  #ageBucket(): number {
    return ageBucket(this.#ageNow());
  }

  /**
   * The panel's own teardown, called by pi inside the host's `close()` — the same path
   * `panel-close.ts` documents, which fires `done()` and *then* `component.dispose?.()`.
   *
   * The one place the panel tells the extension that its surface is going away. The minute's redraw belongs
   * to a drawn panel, and a component pi has popped is not drawn: without this the timer would keep asking
   * a closed overlay for a frame until the next session boundary cleared it. Optional on `PanelHost` for
   * the same reason `ageNow` is: a hand-built host has no tick to stop.
   */
  dispose(): void {
    this.#memory.invalidate();
    this.#host.onDispose?.();
  }

  /** Focus model: the panel is interactive only while the handle's focus is held. */
  focus(): void {
    this.#focused = true;
    this.invalidate();
    this.#handle?.focus();
    this.#host.requestRender();
  }

  /**
   * `Escape` and `Enter` both end the interaction; neither evicts the overlay. The handle moves here and
   * the host is told, in that order: only the owner can decide what an unfocused panel means for the rail,
   * and it can do that only if the interaction ending reaches it.
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
    const last = this.#ranked().length - 1;
    const row = Number.isInteger(index) ? index : 0;
    this.#selection = Math.max(0, Math.min(row, last));
    this.invalidate();
    this.#host.requestRender();
  }

  get selection(): number {
    return this.#selection;
  }

  /** The pins the panel is drawing, ranked: the array the bar is drawn over *is* the array the keys index. */
  get pins(): readonly ViewPin[] {
    return this.#ranked();
  }

  /**
   * The pins the panel draws, in the order it draws them. The ranking and its memo are
   * `RankedPins` (`panel-ranked.ts`); the reason this component is the only reader of that order — the
   * destructive keys index the very array the bar is drawn over — is stated there.
   */
  #ranked(): readonly ViewPin[] {
    return this.#memory.orderOf(this.#host.getView().pins);
  }

  render(width: number): string[] {
    // The live view, the resting label and the age instant are read here and are part of the cache key, not
    // just of the frame: width alone cannot tell a swapped view from an unchanged one, and `update()` — the
    // member that used to be the only change test — is not called on pi-tui's own frame requests. The ranked
    // array is the key rather than the view's own, and it is the same array every time for a view that
    // has not moved, so the cache's fast path survives the ranking. The label is read here for the same
    // reason it is drawn here: a frame that did not name it would keep the old one on screen after the
    // operator rebound the focus key.
    const pins = this.#ranked();
    const replyHint = this.#host.replyHint();
    const ageNow = this.#ageNow();
    // The cache key carries the *bucket*, and the content carries the instant: two redraws in one minute
    // are the same frame, and the frame that is built still ages every row at one named instant.
    const ageKey = ageBucket(ageNow);
    const frame = this.#memory.frame;
    if (
      frame !== undefined &&
      frame.width === width &&
      frame.pins === pins &&
      frame.replyHint === replyHint &&
      frame.ageNow === ageKey
    )
      return frame.lines;
    // A view that no longer holds the selected pin re-clamps the bar *before* the frame is laid out, so
    // a redraw that found the swap cannot draw a bar past the end of the list it just rebuilt.
    if (this.#selection >= pins.length) this.#selection = Math.max(0, pins.length - 1);
    // The focused frame's hint is the panel's own keys; the resting one's is the label read above.
    const content: PanelContent = {
      pins,
      selection: this.#selection,
      focused: this.#focused,
      replyHint,
      ageNow,
    };
    // One layout pass at the width pi-tui just handed over: the row table it builds is what both the
    // frame's height and the drawn window come from, so a pin is wrapped once per frame and a resize
    // sizes the box at the width it is drawn at rather than the last cached one. `panelLayout` owns the
    // height; the builder draws the lines it counted.
    const layout = panelLayout(
      pins,
      width,
      this.#tui?.terminal?.rows,
      this.#selection,
      this.#styleOf(),
      ageNow,
    );
    const lines = buildPanelLines(content, width, this.#styleOf(), layout);
    this.#memory.frame = {
      lines,
      width,
      pins,
      selection: this.#selection,
      focused: this.#focused,
      replyHint,
      ageNow: ageKey,
    };
    return lines;
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
