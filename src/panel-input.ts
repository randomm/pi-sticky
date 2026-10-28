/**
 * The panel's key dispatch, apart from the component that owns the handle and the frame cache.
 *
 * One function, one `switch` in disguise: the bar moves, the selected pin is dismissed or answered, and
 * the interaction ends. `PanelComponent.handleInput` wraps the call in the try that keeps a throwing host
 * out of pi-tui's key path, and hands it a small surface of the component — read the pins, move the bar,
 * ask the host — so the keys stay testable without an overlay, a handle or a theme in the room.
 *
 * The panel owns the keyboard only while it is *on screen*, and only while it is the *open* panel. pi-tui
 * routes input to the focused component alone but asks the overlay whether to draw it, and the two answers
 * can disagree — a pin removed from under an open overlay, a hide, a terminal that narrowed past the
 * panel's boundary. And the peek is drawn without being interactive at all: three rows, no bar, nothing a
 * key could address. Either way a key has no visible answer, so it is handed back: `unfocus()` puts the
 * focus where the user is typing and tells the owner to settle the rail.
 */
import { isKeyRelease, isKeyRepeat, matchesKey } from "@earendil-works/pi-tui";

import type { KeyId } from "@earendil-works/pi-tui";

import type { PanelHost } from "./panel-host.ts";
import { isDismissKey, isSubmitKey, presses } from "./panel-keys.ts";
import type { PanelMode } from "./panel-mode.ts";
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
  /** Move the focus flag and drop the memorised frame — the half of `unfocus()` the guard below needs. */
  setFocused(focused: boolean): void;
}

/** What the dispatch asks the host to do about a pin. */
export interface PanelKeyHost {
  /** Whether the panel is on screen — the gate every key passes through. */
  isVisible(): boolean;
  /**
   * Which of the three states the panel is in. Only `open` has rows a key can address, so `peek` and
   * `hidden` both hand the focus back: a peek is three rows with no bar, nothing to dismiss and nothing to
   * answer, and a hidden panel is not on screen at all. The same reading `PanelComponent` gives the frame,
   * so the drawing and the keys cannot disagree about one host.
   */
  mode(): PanelMode;
  /** Record a dismissal of `id`; the host redraws, and the bar re-clamps. */
  dismiss(id: number): void;
  /** Put `Re #<id>: ` in the editor and start the reply flow. */
  startReply(id: number): void;
}

/**
 * One key, dispatched. A key the panel does not own, a release, a repeat and an empty buffer each do
 * nothing; a key into a panel that is not on screen — or is drawn as its peek — hands the focus back.
 *
 * The bar stops at both ends of the list rather than wrapping, because a selection that wrapped off the
 * bottom would leave the user looking for a pin they had just scrolled out of.
 */
export function dispatchPanelKey(data: string, target: PanelKeyTarget, host: PanelKeyHost): void {
  if (data === "" || isKeyRelease(data) || isKeyRepeat(data)) return;
  // `hidden` and `peek` both end the interaction rather than act: in the first case the user cannot see the
  // panel at all, and in the second it is three rows with nothing for a key to address. Either way the focus
  // is where the user is not, and the editor is where they are.
  if (!host.isVisible() || host.mode() === "peek") {
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
 * whole dispatch means no future key handler can escape it.
 *
 * The key that fails also *ends* the interaction, by the same `unfocus()` a refused key takes: a focused
 * panel is a modal the user has no way out of but the focus key, so leaving one on screen after its dispatch
 * threw would strand it over the transcript. The flag is cleared first, and apart from that call, because
 * `unfocus()` is itself one of the members that can throw: a component that moved its flag before it reached
 * the host stops answering keys even when the ending never completes, which is the state the user can live
 * with. A second throw cannot strand the panel, and is swallowed with the first.
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
    // The flag moves on its own, before the ending is attempted: `unfocus()` is itself a host-facing path,
    // and the one thing a failed key may not leave behind is a panel that still believes it is focused.
    component.setFocused(false);
    try {
      component.unfocus();
    } catch {
      /* The ending may be what threw; the flag above already took the panel out of the key path. */
    }
  }
}
