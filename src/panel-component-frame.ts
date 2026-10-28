/**
 * The frame key: everything the panel's next frame depends on, read in one place.
 *
 * `PanelComponent` caches the frame it drew (`panel-frame-cache.ts`) and asks this whether the cached one is
 * still the frame it would draw. Two entry points ask that question — `update()`, which the extension's
 * `redraw()` calls, and `render()`, which pi-tui calls on every frame request — and the whole correctness of
 * the cache is that the two build the key *identically*. A candidate one of them built differently is a cache
 * that hits for one caller and silently misses for the other, which is invisible until someone notices a
 * redraw that repaints a byte-identical panel or a frame that never updates.
 *
 * So the candidate is built here, from the three things the component holds and the three the host supplies,
 * rather than at either call site. `lines` and `width` are named but never compared (`sameFrame` ignores
 * them): a candidate has no lines to name before it is built, and its width is the width the caller asked
 * for, which follows from the rest.
 */
import { ageAt, ageBucket } from "./panel-age.ts";
import type { PanelFrame } from "./panel-frame-cache.ts";
import type { PanelHost } from "./panel-host.ts";
import type { PanelMode } from "./panel-mode.ts";
import type { ViewPin } from "./types.ts";

/**
 * The state the next frame would be drawn for.
 *
 * Read beside the label and the age rather than cached on the component: the two frames of one view are not
 * the same bytes, so a key that did not name the state could answer an auto-open with the peek's three rows.
 */
export function frameMode(host: PanelHost): PanelMode {
  return host.mode();
}

/**
 * The frame-shaped read of "right now": the pins by identity, the bar and focus by value, and the label,
 * state and age-minute the host is asked for at this instant.
 *
 * `pins` is passed in rather than read from the host because both callers already have the drawn array in
 * hand — `update()` from `#drawn()`, `render()` from the sectioning it is about to lay out — and reading it
 * twice would make the identity comparison compare two reads of the host instead of the one array the frame
 * is built from.
 */
export function frameCandidate(
  pins: readonly ViewPin[],
  focused: boolean,
  selection: number,
  host: PanelHost,
): PanelFrame {
  return {
    lines: [],
    width: 0,
    pins,
    selection,
    focused,
    replyHint: host.replyHint(),
    mode: frameMode(host),
    // The bucket, not the instant: pi-tui asks for a frame far more often than the ages on screen change,
    // and a key of raw instants misses every time (`panel-frame-cache.ts`'s `ageNow`).
    ageNow: ageBucketOf(host),
  };
}

/** The minute the host's clock says it is — the figure the frame cache compares, not the instant it renders. */
export function ageBucketOf(host: PanelHost): number {
  return ageBucket(ageAt(host.ageNow === undefined ? undefined : () => host.ageNow?.()));
}
