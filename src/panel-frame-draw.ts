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
 * the sections, the width, the colours and the age instant — not of the bar or the focus — but the layout
 * (`panelLayoutSections`) is handed the selection to size the scroll window, and `buildPanelLines` re-measures
 * the id/age reserve while it draws. So moving the bar re-wraps every pin rather than re-cutting the one
 * gutter glyph that changed: once per keypress today, and once per frame while something else animates the
 * terminal. Fixing it means caching the row table beside the lines in `PanelFrame` and re-running only
 * `buildPanelLines` when the two fields that did not enter the table are what moved — a change to the layout
 * seam, not to this file, and deliberately not made here.
 */
import { ageAt, ageBucket } from "./panel-age.ts";
import type { OpenFrame } from "./panel-component-open.ts";
import { buildOpenLines } from "./panel-component-open.ts";
import type { PanelComponentState } from "./panel-component-state.ts";
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

/** Everything one frame needs from the host, read once: the label, the mode, the age instant and its bucket. */
export interface FrameKey {
  replyHint: string;
  mode: PanelMode;
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
  const candidate = frameOf([], draw, key, focused, selection);
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
      : buildOpenLines(draw.terminalRows, openFrame(draw, key, selection, focused));
  memory.frame = frameOf(lines, draw, key, focused, selection);
  return lines;
}

/** The frame to memorise, or to compare against: the lines, and everything the next frame is read against. */
export function frameOf(
  lines: string[],
  draw: PanelDraw,
  key: FrameKey,
  focused: boolean,
  selection: number,
): PanelFrame {
  return {
    lines,
    width: draw.width,
    pins: draw.sections.flat,
    selection,
    focused,
    replyHint: key.replyHint,
    mode: key.mode,
    ageNow: key.ageKey,
  };
}

/**
 * Read the host's contributions once — the label, the mode and the age instant — so the key and the rows
 * cannot name two different instants. Both cache entry points ask for this key: `update()`'s candidate
 * (`panel-component-frame.ts`) must read the host the same way or the two halves of the key can drift.
 */
export function frameKey(host: PanelHost): FrameKey {
  const clock = host.ageNow;
  const ageNow = ageAt(clock === undefined ? undefined : () => clock());
  return { replyHint: host.replyHint(), mode: host.mode(), ageNow, ageKey: ageBucket(ageNow) };
}

/** The open frame's layout arguments, over the content's drawn order. */
function openFrame(draw: PanelDraw, key: FrameKey, selection: number, focused: boolean): OpenFrame {
  return {
    content: {
      // The *drawn order* — what `selection` indexes — and the sections the title's counts are read off.
      pins: draw.sections.flat,
      selection,
      focused,
      replyHint: key.replyHint,
      sections: draw.sections.order,
      ageNow: key.ageNow,
    },
    sections: draw.sections,
    width: draw.width,
    style: draw.style,
    ageNow: key.ageNow,
  };
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
