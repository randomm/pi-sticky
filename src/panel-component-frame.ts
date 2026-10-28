/**
 * The candidate frame: everything the panel's next frame depends on, built in the one place both callers
 * of the cache ask for it.
 *
 * `PanelComponent` caches the frame it drew (`panel-frame-cache.ts`) and asks this whether the cached one is
 * still the frame it would draw. Two entry points ask that question — `update()`, which the extension's
 * `redraw()` calls, and `render()`, which pi-tui calls on every frame request (`panel-frame-draw.ts`) — and
 * the whole correctness of the cache is that the two build the key *identically*. A candidate one of them
 * built differently is a cache that hits for one caller and silently misses for the other, which is invisible
 * until someone notices a redraw that repaints a byte-identical panel or a frame that never updates.
 *
 * So the candidate is built here, from the three things the component holds and the three the host supplies,
 * rather than at either call site. `lines` and `width` are named but never compared (`sameFrame` ignores
 * them): a candidate has no lines to name before it is built, and its width is the width the caller asked
 * for, which follows from the rest.
 *
 * The age is the odd member of the key: the *minute* rather than the instant, because pi-tui asks for frames
 * far more often than the ages on screen can move, and a key of raw instants misses every time. `ageInstant`
 * is the other half of the same seam — the instant that minute was read at, which is what the rows themselves
 * print — so the key and the content come from one read of one clock.
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
 * hand — `update()` from the component's own drawn order, `render()` from the sectioning it is about to lay
 * out — and reading it twice would make the identity comparison compare two reads of the host instead of the
 * one array the frame is built from.
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
    ageNow: ageBucket(ageInstant(host)),
  };
}

/** The instant the host's clock says it is — what the rows age against, and what the bucket is taken from. */
export function ageInstant(host: PanelHost): string {
  const clock = host.ageNow;
  return ageAt(clock === undefined ? undefined : () => clock());
}

/** The minute `ageInstant` falls in — the figure the frame cache and the tick's minute hand both compare. */
export function ageBucketOf(host: PanelHost): number {
  return ageBucket(ageInstant(host));
}
