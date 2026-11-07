/**
 * What the drawn frame still answers: the bar the keys may act on, and the bar `update()` may not move.
 *
 * `PanelComponent` holds the frame pi-tui last drew (`panel-frame-cache.ts`) and the pair the keys read
 * (`drawnKeys()` below). Both are one snapshot of one view and one bar, and the view is republished underneath
 * them: `update()` re-sections the new list and may leave the frame standing, so "is the bar still a row the
 * panel draws?" has to be asked of the *frame* and not of the live order. The defect this answers was a key
 * that resolved `pins[selection]` over the live array and acted on whatever pin had re-sorted into the row
 * (`panel-stale-frame-keys.test.ts`).
 *
 * Every comparison here is by pin **id** and not by identity: `ViewPin`s are copied on every rebuild of the
 * view, so an identity test would report a frame whose pins had not moved at all as one that had, freezing a
 * panel that was still exactly what the user was looking at.
 *
 * Three members, three questions, one frame:
 *
 * - `frameAnswersBar` is the freeze's test. It answers for a bar the frame drew whether or not the view still
 *   holds it, because a bar the view dropped is a bar the user is still looking at, and the frame is owed the
 *   screen until the user moves or the focus goes (`PanelComponent.update()`);
 * - `drawnKeysOf` is the keys' test. It withholds a bar the view has dropped: the row is not one the panel
 *   draws any more, so there is no pin to dismiss, reply to, or answer, and the key is refused
 *   (`panel-input.ts`);
 * - `frameDrawOf` hands the drawer the pair's cell, so the reading is taken in the same pass that lays the
 *   rows out (`panel-frame-draw.ts`) rather than after anything has moved.
 */
import type { DrawnKeys, PanelFrame } from "./panel-frame-cache.ts";
import type { PanelDraw } from "./panel-frame-draw.ts";
import type { PanelSections } from "./panel-sections.ts";
import type { PanelStyle } from "./render.ts";
import type { ViewPin } from "./types.ts";

/**
 * Whether the drawn frame still describes the panel on screen: its own rows carry the pin its `selection`
 * names, and that pin either still lives in the view or has left it altogether — a bar still sitting on a row
 * it was drawn on, either way. A bar that names no row of its own (a frame drawn without a marker, or at an
 * index its rows do not carry) is not a bar the frame answers, and the caller goes about its clamp.
 */
export function frameAnswersBar(frame: PanelFrame | undefined, view: readonly ViewPin[]): boolean {
  if (frame === undefined) return false;
  const bar = frame.pins[frame.selection];
  if (bar === undefined) return false;
  return view.some((pin) => pin.id === bar.id) || !frame.pins.some((pin) => pin.id === bar.id);
}

/**
 * What the keys read for a frame already drawn: its own drawn order and the row it drew its marker on, or the
 * refusal of a bar the view no longer draws.
 *
 * A refused bar's index is put off *both* ends of the frame's rows — the one state no move can pass, since
 * below the first row there is nothing above to go to and above the last nothing below. `-1` would have been
 * the friendlier spelling and is the wrong one: `k` from it lands on row 0, a row the frame may well draw and
 * the user may well have meant.
 */
export function drawnKeysOf(frame: PanelFrame, view: readonly ViewPin[]): DrawnKeys {
  const pins = frame.pins;
  const bar = pins[frame.selection];
  const held = bar !== undefined && view.some((pin) => pin.id === bar.id);
  return { hasFrame: true, pins, selection: held ? frame.selection : pins.length + 1 };
}

/** The pair of a component pi-tui has never rendered: the live pins and the bar as they are now. */
export function liveKeys(pins: readonly ViewPin[], selection: number): DrawnKeys {
  return { hasFrame: false, pins, selection };
}

/** What one frame request is built from, as the component answers it. */
export interface FrameRequest {
  /** The sectioning the rows are laid out over — the same memo the keys index. */
  sections: PanelSections;
  /** The width pi-tui asked for, which is also the width the frame's lines are cut at. */
  width: number;
  /** The colours, resolved by the component. */
  style: PanelStyle;
  /** The terminal's *height*, or `undefined` for a component built without a TUI. */
  terminalRows: number | undefined;
  /** The cell the drawer records the keys' pair into. */
  setDrawnKeys: (pair: DrawnKeys) => void;
}

/**
 * The component's answer to one frame request, in the shape the drawer reads.
 *
 * `recordDrawn` is a closure over the component's cell rather than a field, so the pair is recorded in the
 * same breath as the frame the rows came from: after a clamp, an `update()` or an invalidation has moved
 * anything, it is too late to ask the cache what the user was looking at. It is also the pair's **only
 * writer** in the extension — the miss in `drawFrame` is the one thing that changes what is on the screen.
 */
export function frameDrawOf(request: FrameRequest): PanelDraw {
  return {
    sections: request.sections,
    width: request.width,
    style: request.style,
    terminalRows: request.terminalRows,
    recordDrawn: (pair) => request.setDrawnKeys(pair),
  };
}
