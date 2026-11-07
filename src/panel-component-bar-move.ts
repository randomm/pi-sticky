/**
 * The panel's bar: the two verbs that move it, and the pair of drawn keys that has to follow.
 *
 * `PanelComponent` owns the bar's cell (`panel-component-state.ts`), the frame (`panel-frame-cache.ts`) and the
 * pair the acting keys read (`panel-component-bar.ts`), and that file is at its 300-line limit. The bar's verbs
 * live here because a move is the one place all three have to be written in agreement: `selectBar()` moves the bar
 * and asks pi-tui for a frame, and an ordinary move drops the frame with the write, so the next frame records the
 * pair from its own rows and the two cannot disagree.
 *
 * A move over a frame **frozen over the view** (`PanelMemory.frozen`) is the exception, and the defect this file
 * exists for. `PanelComponent.update()` leaves those rows standing precisely because the view no longer holds
 * their bar, and `selectBar()` then re-sections the *new* order underneath a pair that still names the old one: the
 * marker follows the live order, the acting key follows the pair, and a `j` ends with a `d` dismissing the pin the
 * bar moved *off* — a `pi-sticky.user` entry that `reconstruct` re-applies session-wide.
 */
import type { PanelComponentState } from "./panel-component-state.ts";
import type { DrawnKeys, PanelMemory } from "./panel-frame-cache.ts";
import { clampSelection } from "./panel-frame-draw.ts";
import type { PanelHost } from "./panel-host.ts";
import type { PanelSections } from "./panel-sections.ts";
import type { ViewPin } from "./types.ts";

/**
 * The bar and everything a move writes with it, as one seam built by `PanelComponent` at each call so no cell is
 * held past a reload. The pair's setter is handed over rather than the cell itself, so the drawer stays the pair's
 * writer for every frame and a move is the only other door to it.
 */
export interface PanelBar {
  /** The bar and the focus flag, through the setters that invalidate the frame with the write. */
  state: PanelComponentState;
  /** The frame's memory, for the one question a move asks of it: is the frame frozen over the view. */
  memory: PanelMemory;
  /** The pins the panel draws — the flattened drawn order `selectBar()` clamps against. */
  pins: readonly ViewPin[];
  /** The pair as it stands, which a move may replace. */
  drawnKeys(): DrawnKeys | undefined;
  /** Replace the pair. */
  setDrawnKeys(pair: DrawnKeys | undefined): void;
  /** The host: who is told to redraw once the bar has moved. */
  host: PanelHost;
}

/**
 * Move the bar without a key, clamped to the pins that exist: the same `clampSelection` `render()` applies,
 * floored at zero, because `panel-input.ts` cannot index a negative one — and a non-integer answered with the
 * top row, since `Math.min`/`Math.max` both propagate `NaN` and a bar matching no row is a bar not drawn.
 */
export function selectBar(bar: PanelBar, index: number): void {
  const row = Number.isInteger(index) ? index : 0;
  bar.state.setSelection(Math.max(0, clampSelection(row, bar.pins.length)));
  bar.host.requestRender();
}

/**
 * The dispatcher's move: the bar to `liveIndex` and the keys' pair onto the pin that put there.
 *
 * One call for both writes because they must agree on the freeze, and the freeze has to be read **before** the
 * bar moves: `selectBar()` re-sections the live view and drops the frame with the write, so asking afterwards
 * would report the state the move itself created. `liveIndex` is the destination's row in the live order, where
 * the marker the user sees is drawn; the pair then follows the frame's `step`, which names the same pin, because
 * each drawn order is the same view sorted. The pair is read before the write for the same reason.
 */
export function moveBar(bar: PanelBar, frameIndex: number, liveIndex: number, step: number): void {
  const overView = bar.memory.frozen;
  const pair = bar.drawnKeys();
  // Settled, the frame's order *is* the live order and the caller's frame index is a live one; the pair is left
  // for the next frame to write from its own rows. Frozen, they are two different lists and only the live index
  // names the row the marker is drawn on.
  selectBar(bar, overView ? liveIndex : frameIndex);
  bar.setDrawnKeys(movedDrawnKeys(pair, overView, step));
}

/** Whether the frame is **frozen over the view** — the one state where the frame's order and the live one are
 * allowed to disagree, which is why a move asks it before writing. `PanelMemory.frozen`; its lifetime is
 * `panel-component-bar.ts`.
 */
export function frameOverView(bar: PanelBar): boolean {
  return bar.memory.frozen;
}

/**
 * The panel's drawn order — `PanelMemory.sectionsOf` behind the one call the component's two readers make.
 *
 * The memo is the memory's (`panel-frame-cache.ts`) and this sits beside the bar's verbs because they are the
 * readers that care about the *order*: `selectBar()` clamps against `flat`, and a bar clamped against anything else
 * is a bar the frame never drew. `order` travels with it because the frame's title counts levels off the same call,
 * which is what keeps one sectioning behind one frame.
 */
export function panelBarOrder(memory: PanelMemory, host: PanelHost): PanelSections {
  return memory.sectionsOf(host.getView().pins);
}

/**
 * The pair the move leaves behind, or `pair` when the move leaves the pair where it was.
 *
 * The pair moves by the frame's step and never by the live index the bar was given — re-resolving it against the
 * live list would be the original bug (a key acting on whatever pin had re-sorted into the bar's row) reached from
 * the other side. Outside the freeze it is left alone, because the next frame writes it from its own rows and a
 * pair advanced here would be a bar index no drawer ever painted a marker on. No bound is checked and none is
 * missing: `dispatchPanelKey` has already refused a step off either end of the frame's own rows, the bound the
 * user walked to, and a frozen pair deliberately sits outside the live list's range (`drawnKeysOf`,
 * `panel-component-bar.ts`). A pair with no frame is the never-drawn component, whose keys answer the live pins.
 */
function movedDrawnKeys(
  pair: DrawnKeys | undefined,
  overView: boolean,
  step: number,
): DrawnKeys | undefined {
  if (pair === undefined || !pair.hasFrame || !overView) return pair;
  return { hasFrame: true, pins: pair.pins, selection: pair.selection + step };
}
