/**
 * The `render()` half of the panel's frame cache: the key, the hit, and the frame a miss lays out.
 *
 * `PanelComponent` keeps the memorised frame (`PanelMemory`, `panel-frame-cache.ts`); this module is what
 * asks for one. The two entry points that need to know whether a repaint is owed must build the key the
 * same way (`panel-component-frame.ts` says why), so the *read* of the live state lives here too: the
 * view's sections, the resting label, the state and the age instant are all read once per frame, and all
 * four are part of the key. Width alone cannot tell a swapped view from an unchanged one, and `update()`
 * is not called on pi-tui's own frame requests.
 *
 * Three constraints this file owns:
 * - The drawn array is the key rather than the view's own, and it is the same array every time for a view
 *   that has not moved — that is what keeps the cache's fast path alive through the sectioning.
 * - The key carries the age *bucket* and the rows the *instant* it fell in: two redraws inside one minute
 *   are the same frame, and the frame that is built still ages every row at one named instant.
 * - The bar is re-clamped *before* the layout runs, so a redraw that found the view swapped under a stale
 *   selection cannot draw a bar past the end of the list it just rebuilt.
 */
import { ageBucket } from "./panel-age.ts";
import { ageInstant, frameMode } from "./panel-component-frame.ts";
import type { OpenFrame } from "./panel-component-open.ts";
import { buildOpenLines } from "./panel-component-open.ts";
import type { PanelFrame, PanelMemory } from "./panel-frame-cache.ts";
import type { PanelHost } from "./panel-host.ts";
import type { PanelMode } from "./panel-mode.ts";
import { buildPeekLines } from "./panel-peek.ts";
import type { PanelSections } from "./panel-sections.ts";
import type { PanelStyle } from "./render.ts";

/** What one `render()` of one component asks the frame builders for. */
export interface PanelDraw {
  /** The sections drawn from — the same object the rows, the bar and the keys index. */
  sections: PanelSections;
  /** The width pi-tui asked the overlay for. */
  width: number;
  /** The colours the component resolved on its first draw. */
  style: PanelStyle;
  /** The open frame's terminal height, or `undefined` for a component built without a TUI. */
  terminalRows: number | undefined;
}

/** The two bits of state the frame is drawn from, read through the component that owns them. */
export interface PanelDrawState {
  /** The selected pin's index in the drawn order. */
  selection(): number;
  /** Whether the overlay holds the keyboard, which decides the bar, the hint and the border colour. */
  focused(): boolean;
}

/** Everything one frame needs, read from the host once: the label, the state, the age instant and its bucket. */
interface FrameKey {
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
 */
export function drawFrame(
  memory: PanelMemory,
  host: PanelHost,
  draw: PanelDraw,
  state: PanelDrawState,
): string[] {
  const key = frameKey(host);
  const cached = memory.frame;
  if (frameHit(cached, draw, key)) return cached.lines;
  const selection = clamp(state.selection(), draw.sections.flat.length);
  const lines =
    key.mode === "peek"
      ? buildPeekLines(
          { sections: draw.sections, ageNow: key.ageNow, replyHint: key.replyHint },
          draw.width,
          draw.style,
        )
      : buildOpenLines(draw.terminalRows, openFrame(draw, state, key, selection));
  memory.frame = frameOf(lines, draw, key, state.focused(), selection);
  return lines;
}

/** Read the host's three contributions once, so the key and the rows cannot name two different instants. */
function frameKey(host: PanelHost): FrameKey {
  const ageNow = ageInstant(host);
  return { replyHint: host.replyHint(), mode: frameMode(host), ageNow, ageKey: ageBucket(ageNow) };
}

/** Whether the cached frame is the one this width, this view and this key would draw. */
function frameHit(
  cached: PanelFrame | undefined,
  draw: PanelDraw,
  key: FrameKey,
): cached is PanelFrame {
  return (
    cached !== undefined &&
    cached.width === draw.width &&
    cached.pins === draw.sections.flat &&
    cached.replyHint === key.replyHint &&
    cached.mode === key.mode &&
    cached.ageNow === key.ageKey
  );
}

/** The open frame's layout arguments, over the content's drawn order. */
function openFrame(
  draw: PanelDraw,
  state: PanelDrawState,
  key: FrameKey,
  selection: number,
): OpenFrame {
  return {
    content: {
      // The *drawn order* — what `selection` indexes — and the sections the title's counts are read off.
      pins: draw.sections.flat,
      selection,
      focused: state.focused(),
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

/** The frame to memorise: the lines, and everything the next one is compared against. */
function frameOf(
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

/** The bar kept inside the list that exists. */
function clamp(selection: number, count: number): number {
  return selection >= count ? Math.max(0, count - 1) : selection;
}
