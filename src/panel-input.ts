/**
 * The panel's key dispatch, apart from the component that owns the handle and the frame cache.
 *
 * One function, one `switch` in disguise: the bar moves, the selected pin is dismissed or answered, and
 * the interaction ends. `PanelComponent.handleInput` wraps the call in the try that keeps a throwing host
 * out of pi-tui's key path, and hands it a small surface of the component — read the pins, move the bar,
 * ask the host — so the keys stay testable without an overlay, a handle or a theme in the room.
 *
 * The panel owns the keyboard only while it is *on screen*. pi-tui routes input to the focused component
 * alone but asks the overlay whether to draw it, and the two answers can disagree — a pin removed from
 * under an open overlay, a hide, a terminal that narrowed past the panel's boundary. A key into a panel
 * nobody can see has no visible answer, so it is handed back: `unfocus()` puts the focus where the user
 * is typing and tells the owner to settle the rail.
 */
import { isKeyRelease, isKeyRepeat, matchesKey } from "@earendil-works/pi-tui";

import type { KeyId } from "@earendil-works/pi-tui";

import type { PanelHost } from "./panel-host.ts";
import { isDismissKey, isSubmitKey, presses } from "./panel-keys.ts";
import type { ViewPin } from "./types.ts";

/** The keys that move the bar; `matchesKey` also takes the Kitty forms of each. */
const UP_KEYS: readonly KeyId[] = ["up", "k"];
const DOWN_KEYS: readonly KeyId[] = ["down", "j"];

/** What the dispatch needs of the component: the bar, and the ways to change what is drawn. */
export interface PanelKeyTarget {
  /** The pins the panel is drawing, in the order it draws them. */
  readonly pins: readonly ViewPin[];
  /** The selected *pin* index, not a row index: a pin that wraps owns several rows. */
  readonly selection: number;
  /** Move the bar and ask for a frame. */
  select(index: number): void;
  /** End the interaction: the handle, the owner, and a frame. */
  unfocus(): void;
}

/** What the dispatch asks the host to do about a pin. */
export interface PanelKeyHost {
  /** Whether the panel is on screen — the gate every key passes through. */
  isVisible(): boolean;
  /** Record a dismissal of `id`; the host redraws, and the bar re-clamps. */
  dismiss(id: number): void;
  /** Put `Re #<id>: ` in the editor and start the reply flow. */
  startReply(id: number): void;
}

/**
 * One key, dispatched. A key the panel does not own, a release, a repeat and an empty buffer each do
 * nothing; a key into a panel that is not on screen hands the focus back.
 *
 * The bar stops at both ends of the list rather than wrapping, because a selection that wrapped off the
 * bottom would leave the user looking for a pin they had just scrolled out of.
 */
export function dispatchPanelKey(data: string, target: PanelKeyTarget, host: PanelKeyHost): void {
  if (data === "" || isKeyRelease(data) || isKeyRepeat(data)) return;
  if (!host.isVisible()) {
    target.unfocus();
    return;
  }
  const pins = target.pins;
  if (matchesKey(data, "escape")) {
    target.unfocus();
    return;
  }
  const pin = pins[target.selection];
  if (isSubmitKey(data)) {
    // Enter both answers the pin and ends the interaction: the user reads the reply in the editor, so a
    // panel still holding focus over it would be in the way.
    if (pin) host.startReply(pin.id);
    target.unfocus();
    return;
  }
  if (isDismissKey(data)) {
    // The host's dismissal redraws and the component re-clamps, so dismissing the last pin lands the bar
    // on the new last one rather than on a row that no longer exists.
    if (pin) host.dismiss(pin.id);
    return;
  }
  const moved = presses(data, UP_KEYS) ? -1 : presses(data, DOWN_KEYS) ? 1 : 0;
  if (moved === 0) return;
  const next = target.selection + moved;
  if (next < 0 || next >= pins.length) return;
  target.select(next);
}

/**
 * One key, dispatched, with anything it throws turned into a notice.
 *
 * pi-tui calls a component's `handleInput` from its input handler with no try/catch of its own, so anything
 * that escaped — a host whose overlay handle throws on `unfocus()`, a deps callback reading a context whose
 * session is gone — would surface as an `extension_error` out of the terminal's key path. One try around the
 * whole dispatch means no future key handler can escape it, and a key that fails does nothing, which is the
 * safe answer for a panel whose destructive keys are gated on a bare press anyway.
 *
 * A function beside the dispatcher rather than a `try` inside the component because the guard is about the
 * dispatch, not about the component: it belongs where the keys are, and the component is left with the one
 * line that hands pi-tui its callback.
 */
export function containKey(
  data: string,
  component: PanelKeyTarget,
  host: PanelKeyHost & Pick<PanelHost, "notify">,
): void {
  try {
    dispatchPanelKey(data, component, host);
  } catch {
    host.notify("A panel key could not be handled.", "warning");
  }
}
