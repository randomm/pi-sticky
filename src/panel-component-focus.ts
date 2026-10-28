/**
 * Taking and releasing the panel's focus — the two verbs, and the order each one does its three effects in.
 *
 * `PanelComponent` holds the focus flag; pi's `OverlayHandle` holds the real focus; the host is who has to
 * be told either way. The three cannot move independently: a flag that said "focused" while the handle said
 * otherwise is a component that answers keys pi is not routing to it, and a handle that took focus while the
 * component's frame still said "resting" is a panel drawn without its keys hint. So the two verbs live here,
 * beside the order they impose, and the component keeps the frame and the selection.
 *
 * Focus belongs to the *open* panel alone (operator resolution 2 of pins v2-4). The peek is a three-row
 * notice with no bar, no window and no keys, so a peek that took focus would route keystrokes to a frame
 * with no answer for them and leave the user typing into nothing. The focus key and Enter-from-a-key both
 * reach the panel through `focus()`, which makes opening the act that keys become live — and what this file
 * guarantees is that the mode the component reads is `open` by the time a key can arrive, because pi-tui
 * only routes input to a focused overlay and a peek is never focused.
 */
import type { OverlayHandle } from "@earendil-works/pi-tui";

import type { PanelHost } from "./panel-host.ts";

/** What a focus change is allowed to move, and nothing else. */
export interface PanelFocusState {
  /** Record the focus flag and drop the memorised frame with it (`PanelComponent.setFocused`). */
  setFocused(focused: boolean): void;
}

/** The three collaborators one focus change involves. */
export interface PanelFocus {
  /** The component's focus flag, through the one setter that invalidates with it. */
  state: PanelFocusState;
  /** pi's handle, absent until the host hands it over — a component pi never finished building. */
  handle: OverlayHandle | undefined;
  /** The host: who redraws, and who decides what an unfocused panel means for the rail. */
  host: PanelHost;
}

/**
 * Take the focus: the flag first, then the handle, then a frame.
 *
 * The flag is set *before* the handle moves so the frame pi-tui requests on the strength of the handle
 * already reads the focused colours and the keys hint; a handle that focused first could be drawn by a
 * frame request that came from elsewhere in between, in resting colours.
 */
export function focusPanel(target: PanelFocus): void {
  target.state.setFocused(true);
  target.handle?.focus();
  target.host.requestRender();
}

/**
 * Release the focus, and end the interaction.
 *
 * `Escape` and `Enter` both come here and neither evicts the overlay: the handle is released, the *host* is
 * told (only the owner can decide what an unfocused panel means for the rail, and it can decide only if the
 * ending reaches it), and only then is a frame requested — so the frame the user sees next is the one the
 * owner settled, with the rail back on screen if the owner decided the pins belong there.
 */
export function unfocusPanel(target: PanelFocus): void {
  target.state.setFocused(false);
  target.handle?.unfocus();
  // The ending of a *transient* open, announced here rather than in `pi.on("input")` because this is where
  // the interaction actually ends (operator resolution 2 of pins v2-4). Focus is the only way in — the focus
  // key and Enter-from-a-key — so a panel the user focused and then left is the case the rule is about, and
  // a keystroke into a peek already arrives through here via the key dispatcher. The host decides what that
  // means for the rail; this file only says the interaction is over.
  target.host.unfocus();
  target.host.requestRender();
}
