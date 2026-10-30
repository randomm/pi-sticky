/**
 * The candidate frame: the panel's next frame, spelled by the one builder the cache has.
 *
 * `PanelComponent` caches the frame it drew (`panel-frame-cache.ts`) and asks whether the cached one is
 * still the frame it would draw. Two entry points ask that question — `update()`, which the extension's
 * `redraw()` calls, and `render()`, which pi-tui calls on every frame request — and the whole correctness of
 * the cache is that the two compare *the same fields*. They do because both hand `sameFrame` a frame built
 * by `frameOf` (`panel-frame-draw.ts`): `render()` builds its candidate and its memorised frame with that
 * call, and `update()` asks this one, which delegates to the same function. A field added to the key is one
 * edit in `frameOf`, not two hand-written field lists that can drift until someone notices a redraw that
 * repaints a byte-identical panel or a frame that never updates.
 *
 * `lines` and `width` come back named but never compared (`sameFrame` ignores them): a candidate has no
 * lines to name before it is built, and its width is the width the caller asked for, which follows from the
 * rest — except at `render()`, the one caller that knows the width it was given and compares it too.
 *
 * The age is the odd member of the key: the *minute* rather than the instant, because pi-tui asks for frames
 * far more often than the ages on screen can move, and a key of raw instants misses every time. The instant
 * is read in the same breath as the bucket, so a candidate's minute and the rows' ages cannot come from two
 * reads of one clock — and the read itself is `frameKey` (`panel-frame-draw.ts`), the same one `render()`
 * asks for, so the key cannot drift in the half that is not the frame's field list.
 */
import { expandedPinOf } from "./panel-expand.ts";
import type { PanelFrame } from "./panel-frame-cache.ts";
import { frameKey, frameOf } from "./panel-frame-draw.ts";
import type { PanelDraw } from "./panel-frame-draw.ts";
import { NO_PANEL_COLOUR } from "./panel-host.ts";
import type { PanelHost } from "./panel-host.ts";
import type { PanelSections } from "./panel-sections.ts";
import type { ViewPin } from "./types.ts";

/** The sections a candidate names: the drawn order, and no grouping for it, which `sameFrame` never reads. */
function candidateSections(pins: readonly ViewPin[]): PanelSections {
  return { order: [], flat: pins };
}

/**
 * The frame-shaped read of "right now": the pins by identity, the bar and focus by value, and the label,
 * mode and age-minute the host is asked for at this instant.
 *
 * `pins` is passed in rather than read from the host because the caller already has the drawn array in
 * hand — `update()` from the component's own drawn order — and reading it twice would make the identity
 * comparison compare two reads of the host instead of the one array the frame is built from.
 *
 * The members a candidate cannot mean anything by carry the values they are never read at: no colours (a
 * candidate colours nothing) and no terminal (a candidate sizes nothing).
 */
export function frameCandidate(
  pins: readonly ViewPin[],
  focused: boolean,
  selection: number,
  host: PanelHost,
): PanelFrame {
  const key = frameKey(host);
  const draw = candidateDraw(pins);
  // The expansion term is computed by the same predicate `render()` asks, over the same five inputs — the
  // candidate's pins, mode, key gate, focus and bar. A candidate that left it out, or re-derived it, would be a
  // second spelling of a rule the frame has already settled, and would disagree with its own fields. What it
  // does *not* buy is a case the key would otherwise miss: the predicate is a pure function of those five
  // fields, all of which `sameFrame` compares (`panel-frame-cache.ts`, the `expanded` member doc).
  return frameOf(
    [],
    draw,
    key,
    focused,
    selection,
    expandedPinOf(pins, key.mode, key.keys, focused, selection),
  );
}

/** The candidate's stand-in for "what one frame is drawn from": the drawn order, and nothing drawn at. */
function candidateDraw(pins: readonly ViewPin[]): PanelDraw {
  return {
    sections: candidateSections(pins),
    width: 0,
    style: NO_PANEL_COLOUR,
    terminalRows: undefined,
  };
}
