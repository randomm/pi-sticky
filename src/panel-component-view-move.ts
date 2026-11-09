/**
 * The panel component's own teardown: what `update()` does when the view moves under a frame it drew, and what
 * `dispose()` leaves standing.
 *
 * Split from `panel-component.ts` because the component is the object pi-tui holds — host, theme, memory, the
 * pair the keys read — and this is a decision rather than a member: one question over the frame, the bar's row
 * and the focus flag, and the writes that follow. The judgement itself (`viewMoveOf`, `panel-frame-cache.ts`)
 * lives with the memory it reads; this file is the half that acts.
 *
 * Cheap when nothing changed, which matters because `refresh()` calls `update()` on **every** redraw: a
 * byte-identical view must cost a comparison, not a layout pass.
 */
import { frameAnswersBar } from "./panel-component-bar.ts";
import { frameCandidate } from "./panel-component-frame.ts";
import type { PanelComponentState } from "./panel-component-state.ts";
import type { DrawnKeys, PanelFrame, PanelMemory } from "./panel-frame-cache.ts";
import { sameFrame, viewMoveOf } from "./panel-frame-cache.ts";
import { clampSelection } from "./panel-frame-draw.ts";
import type { PanelHost } from "./panel-host.ts";
import type { ViewPin } from "./types.ts";

/** What the update needs of the component; every reader is called at the moment the decision is made. */
export interface ViewMoveCells {
  memory: PanelMemory;
  state: PanelComponentState;
  host: PanelHost;
  /** The view *now* — `PanelHost.getView()`, read once for the keep test. */
  livePins(): readonly ViewPin[];
  /** The component's flattened, drawn order — its `pins`, sections and all. */
  drawnOrder(): readonly ViewPin[];
  /** The keys' pair, which only the drawer writes. */
  drawnKeys(): DrawnKeys | undefined;
  /** Move the keys' pair, which the component alone owns — `undefined` drops it with the frame. */
  setDrawnKeys(pair: DrawnKeys | undefined): void;
  /** The way to drop the frame and the memoised order together (the component's own `invalidate()`). */
  invalidate(): void;
}

/**
 * The view changed; bring the panel to what the user should now be looking at.
 *
 * Four outcomes (`viewMoveOf`), and the writes below are the whole of each: a freeze writes nothing at all,
 * which is the point of it — the memory's drawn order has to stay the array those rows were laid out over,
 * because the move guard in `panel-input.ts` reads that array and re-sectioning it would have a key refuse a
 * row the frame really drew.
 */
export function applyViewMove(cells: ViewMoveCells): void {
  const { memory, state, host } = cells;
  const frame: PanelFrame | undefined = memory.frame;
  const move = viewMoveOf(
    frame,
    frameAnswersBar(frame, cells.livePins()),
    cells.drawnKeys()?.selection === frame?.selection,
    state.focused,
  );

  if (move === "keep") {
    host.requestRender();
    return;
  }
  if (move === "freeze") {
    // Set here, on the way to `drawFrame`, and not read off the frame: see `viewMoveOf`.
    memory.frozen = true;
    // No re-sectioning and no redraw — the next request hits the cache, and the freeze is what stops a
    // repaint (the minute over, a theme change) from drawing a view the user is not looking at.
    return;
  }
  if (move === "settle") {
    // The bar comes home first, through the same clamp every other entry point uses: the frozen marker indexes
    // *its* rows and the frame is about to be replaced by one drawn over a shorter view. Writing the pair
    // clears the frame with it, as the state's setters do — a pair left behind after its frame is gone would
    // have the next key answer a bar nobody drew.
    cells.setDrawnKeys(undefined);
    memory.invalidateFrame();
    memory.frozen = false;
    host.requestRender();
    return;
  }

  const pins = cells.drawnOrder();
  // The clamp moves the bar through the state's own setter, so the frame cannot outlive the selection — and it
  // is the same clamp `render()` applies, so the two entry points cannot disagree about the floor.
  const selection = clampSelection(state.selection, pins.length);
  if (selection !== state.selection) state.setSelection(selection);
  // One comparison, through the cache's own test, over the candidate `panel-component-frame.ts` spells with the
  // very builder `render()` memorises: `width` and `lines` are the two members `sameFrame` ignores, which is
  // what lets a redraw (not a resize) hit.
  if (sameFrame(memory.frame, frameCandidate(pins, state.focused, selection, host))) return;
  cells.invalidate();
  host.requestRender();
}
