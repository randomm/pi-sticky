/**
 * The `render()` half of the panel's frame cache: the frame builder, the hit, and the rows a miss lays out.
 *
 * `PanelComponent` keeps the memorised frame (`PanelMemory`, `panel-frame-cache.ts`); this module is what
 * asks for one. The two entry points that need to know whether a repaint is owed must build their frame the
 * same way (`panel-frame-cache.ts` says why), so the *read* of the live state lives here too: the view's
 * sections, the resting label, the mode, the bar and the focus and the age instant are each read once per
 * frame, and all but the age instant are part of the key — the second constraint below says why the instant
 * is not. Width alone cannot tell a swapped view from an unchanged one, and `update()` is not called on
 * pi-tui's own frame requests.
 *
 * Three constraints this file owns:
 * - The drawn array is the key rather than the view's own, and it is the same array every time for a view
 *   that has not moved — that is what keeps the cache's fast path alive through the sectioning.
 * - The key carries the age *bucket* and the rows the *instant* it fell in: two redraws inside one minute
 *   are the same frame, and the frame that is built still ages every row at one named instant.
 * - The bar is re-clamped *before* the layout runs, so a redraw that found the view swapped under a stale
 *   selection cannot draw a bar past the end of the list it just rebuilt. The clamp is written back through
 *   the state's own setter (`PanelFrameState`) whenever it actually moved, so the component cannot be left
 *   holding an index its own frame did not draw — the keys index the bar, and a bar past the end silently
 *   dismisses nothing. A clamp that did not move the bar writes nothing: the setter drops the frame with the
 *   write, and dropping the frame the hit is about to return would pay a layout for a byte that did not move.
 *
 * `frameOf` is exported because `update()`'s candidate (`panel-component-frame.ts`) is spelled by it too:
 * one builder for both the memorised frame and the frame it is compared against is what keeps the two entry
 * points of the cache comparing the same fields. `PanelDraw` and `FrameKey` travel with it for the same
 * reason — they are the shape of its arguments, not this file's business alone.
 *
 * What this file does **not** own is the cost of a miss. The row table a frame is cut from is a function of
 * the sections, the width, the colours and the age instant — and of the one pin the layout expands, which is
 * read out of this module's own `expandedPinOf` call. The bar moves re-wraps every pin rather than cutting
 * back the one
 * gutter glyph that changed: once per keypress today, and once per frame while something else animates the
 * terminal. Fixing it means caching the row table beside the lines in `PanelFrame` and re-running only
 * `buildPanelLines` when only the fields that did not enter the table moved — a change to the layout
 * seam, not to this file, and deliberately not made here.
 *
 * The one term of the key whose *value* is computed rather than read is the expansion, and its producer is
 * named: `expandedPinOf` (`panel-expand.ts`), called once per frame by `drawFrame` and handed to the frame it
 * builds, to the open frame's table and to the cache's term alike. The compiler guarantees one field list;
 * each term's agreement with the drawing rule that produced it is a property of this producer, and this is
 * where that property lives and is tested.
 */
import { ageAt, ageBucket } from "./panel-age.ts";
import type { OpenFrame } from "./panel-component-open.ts";
import { buildOpenLines } from "./panel-component-open.ts";
import type { PanelComponentState } from "./panel-component-state.ts";
import { expandedPinOf } from "./panel-expand.ts";
import type { PanelFrame, PanelMemory } from "./panel-frame-cache.ts";
import { sameFrame } from "./panel-frame-cache.ts";
import type { PanelHost } from "./panel-host.ts";
import type { PanelMode } from "./panel-mode.ts";
import { buildPeekLines } from "./panel-peek.ts";
import type { PanelSections } from "./panel-sections.ts";
import type { PanelStyle } from "./render.ts";

/**
 * The half of the component's state a frame is drawn from, and the one way it may be written.
 *
 * `PanelComponentState` is the only implementation the extension has, and this names it rather than two
 * bare getters: the bar and the flag are written only through setters that drop the memorised frame with
 * the write, and a look-alike carrying just the values would let a frame be keyed on a bar no setter can
 * move — the stale bar `panel-component-state.ts` exists to make unrepresentable.
 */
export type PanelFrameState = Pick<
  PanelComponentState,
  "selection" | "focused" | "setSelection" | "setFocused"
>;

/** What one frame is drawn from: the sectioning, the width asked for, the colours and the terminal height. */
export interface PanelDraw {
  /** The sections drawn from — the same object the rows, the bar and the keys index. */
  sections: PanelSections;
  /** The width pi-tui asked the overlay for. */
  width: number;
  /** The colours the component resolved on its first draw. */
  style: PanelStyle;
  /** The open frame's terminal height. `undefined` means no TUI to ask (`panelMaxRows`'s fallback). */
  terminalRows: number | undefined;
}

/**
 * Everything one frame needs from the host, read once: the label, the two answers the cell gives about the
 * panel, the age instant and its bucket.
 *
 * `mode` and `keys` are read together here, from one cell, because they are the two halves of one question
 * (`panel-mode.ts`): which frame to draw, and whether that frame may name the keys. Reading them apart is
 * what let a frame under `PI_STICKY_PANEL=open` advertise `d` after the keystroke that would have pressed it
 * was refused.
 */
export interface FrameKey {
  replyHint: string;
  /** The frame to draw — the peek's three rows or the open panel's box. */
  mode: PanelMode;
  /** Whether the drawn frame may advertise the keys — the gate `dispatchPanelKey` obeys, not the frame. */
  keys: boolean;
  /** The instant every age in the frame is stamped at. */
  ageNow: string;
  /** The minute `ageNow` falls in — what the key compares, since the ages move once a minute at most. */
  ageKey: number;
}

/**
 * The frame for this instant: the cached lines when the key still describes the panel, the drawn ones when
 * it does not — and the memorised frame replaced in the same breath as the miss.
 *
 * The frame the next render will be compared against is built here by `frameOf`, the same builder that
 * spells the memorised one, and compared by `sameFrame` — the very test `update()` asks — so the two entry
 * points cannot drift to two field lists, and so a bar or a focus move is a miss rather than a stale frame.
 * The width is compared apart from `sameFrame` because a candidate has no lines to name and takes its width
 * from the request: `update()` must ignore it (`refresh()` runs on every frame and a redraw is not a resize),
 * while a frame request at a new width is a different frame.
 */
export function drawFrame(
  memory: PanelMemory,
  host: PanelHost,
  draw: PanelDraw,
  state: PanelFrameState,
): string[] {
  const key = frameKey(host);
  const selection = clampSelection(state.selection, draw.sections.flat.length);
  const focused = state.focused;
  const expanded = expandedPinOf(draw.sections.flat, key.mode, key.keys, focused, selection);
  const candidate = frameOf([], draw, key, focused, selection, expanded);
  const cached = memory.frame;
  // The width is compared here and not in `sameFrame` because it is the one thing a candidate cannot name:
  // `update()` must ignore it (a redraw is not a resize), while this caller knows the width it was asked for.
  if (cached && sameFrame(cached, candidate) && cached.width === draw.width) return cached.lines;
  // Past the hit there is no way back, so the clamp is a write like any other — through the setter that
  // drops the frame with it, and only when the bar actually moved. The component must not keep a selection
  // its own rows did not draw, since the keys index the bar and not the frame; a hit needs no write because
  // the cached lines were themselves built at the clamped index.
  if (selection !== state.selection) state.setSelection(selection);
  // The candidate is built before its rows, so the comparison cannot be skipped: the layout runs whenever
  // the key says the panel moved, and the peek's three rows cost the peek what they always cost.
  const lines =
    key.mode === "peek"
      ? buildPeekLines(
          { sections: draw.sections, ageNow: key.ageNow, replyHint: key.replyHint },
          draw.width,
          draw.style,
        )
      : buildOpenLines(draw.terminalRows, openFrame(draw, key, selection, focused, expanded));
  memory.frame = frameOf(lines, draw, key, focused, selection, expanded);
  return lines;
}

/**
 * The frame to memorise, or to compare against: the lines, and everything the next frame is read against.
 *
 * `expanded` is the value `expandedPinOf` (`panel-expand.ts`) answered for this frame — a term of the key, and
 * deliberately not re-derived here from `mode`/`keys`/`focused`/`pins`/`selection`: a frame's key that computes
 * a term is a key that can disagree with the table the same frame was drawn from.
 */
export function frameOf(
  lines: string[],
  draw: PanelDraw,
  key: FrameKey,
  focused: boolean,
  selection: number,
  /** The index `expandedPinOf` answered for this frame — a term of the key, never re-derived from it. */
  expanded: number | undefined,
): PanelFrame {
  return {
    lines,
    width: draw.width,
    pins: draw.sections.flat,
    selection,
    focused,
    // The pin whose entry this frame's row table expanded, handed in rather than read back off the fields
    // above.
    expanded,
    replyHint: key.replyHint,
    mode: key.mode,
    keys: key.keys,
    ageNow: key.ageKey,
  };
}

/**
 * Read the host's contributions once — the label, the two answers the cell gives, and the age instant — so
 * the key and the rows cannot name two different instants or two different states. Both cache entry points
 * ask for this key: `update()`'s candidate (`panel-component-frame.ts`) must read the host the same way or
 * the two halves of the key can drift.
 */
export function frameKey(host: PanelHost): FrameKey {
  const clock = host.ageNow;
  const ageNow = ageAt(clock === undefined ? undefined : () => clock());
  return {
    replyHint: host.replyHint(),
    mode: host.mode(),
    keys: host.interactiveOpen(),
    ageNow,
    ageKey: ageBucket(ageNow),
  };
}

/** The open frame's layout arguments, over the content's drawn order. */
function openFrame(
  draw: PanelDraw,
  key: FrameKey,
  selection: number,
  focused: boolean,
  expanded: number | undefined,
): OpenFrame {
  return {
    content: {
      // The *drawn order* — what `selection` indexes — and the sections the title's counts are read off.
      pins: draw.sections.flat,
      selection,
      // The bar, the frame's colours and the keys legend all answer the gate rather than the flag alone: a
      // frame the dispatcher will refuse is a resting frame however pi-tui routed to it, and must not
      // advertise keys no keystroke reaches (`panel-input.ts`).
      focused: keysLive(key, focused),
      replyHint: key.replyHint,
      sections: draw.sections.order,
      ageNow: key.ageNow,
    },
    // The pin whose entry the row table expands, from the same call that built the frame it is drawn into:
    // the table grows the pin the bar, `d` and `Enter` index, or none at all.
    expanded,
    sections: draw.sections,
    width: draw.width,
    style: draw.style,
    ageNow: key.ageNow,
  };
}

/**
 * Whether this frame draws as one the user is in: the component's flag, and the gate the dispatcher obeys.
 *
 * Both, not either. The flag is the only fact that knows the user is *looking at* the frame (an unfocused
 * panel that highlighted its top row would claim the bar sits where the user is not); the gate is the only
 * fact that knows a keystroke would be answered. Under `PI_STICKY_PANEL=open` they come apart — the cell
 * keeps answering `open` from the resting mode after the earned open ended — and the honest frame is the
 * resting one: no bar, the focus key in the border, and no keys advertised.
 */
function keysLive(key: FrameKey, focused: boolean): boolean {
  return focused && key.keys;
}

/**
 * The bar kept inside the list that exists — the clamp spelled once, for all three entry points.
 *
 * `render()` needs it before the layout (a redraw that found the view swapped under a stale selection must
 * not draw a bar past the end) and `update()` before the comparison (a redraw of a view that shrank has to
 * see the bar it is about to move). It moves an index at or past the end onto the last row that exists — the
 * floor `Math.max` is for, since an empty list has no last row — and leaves every other number alone, which
 * is what main did: a value below zero or not a whole number is not this clamp's to answer, and `select()`
 * is the entry point that does (it refuses a non-integer by answering the top row).
 *
 * Three copies in three files is the drift this rule exists to prevent.
 */
export function clampSelection(selection: number, count: number): number {
  return selection >= count ? Math.max(0, count - 1) : selection;
}
