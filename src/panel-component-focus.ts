/**
 * Taking and releasing the panel's focus — the two verbs, and the order each one does its three effects in.
 *
 * `PanelComponent` holds the focus flag; pi's `OverlayHandle` holds the real focus; the host is who has to
 * be told either way. The three cannot move independently: a flag that said "focused" while the handle said
 * otherwise is a component that answers keys pi is not routing to it, and a handle that took focus while the
 * component's frame still said "resting" is a panel drawn without its keys hint. So the two verbs live here,
 * beside the order they impose, and the component keeps the frame and the selection.
 *
 * Focus belongs to the *open* panel alone (U11). The peek is a three-row
 * notice with no bar, no window and no keys, so a peek that took focus would route keystrokes to a frame
 * with no answer for them and leave the user typing into nothing. The focus key and Enter-from-a-key both
 * reach the panel through `focus()`, which makes opening the act that keys become live — and what this file
 * guarantees is that the mode the component reads is `open` by the time a key can arrive, because pi-tui
 * only routes input to a focused overlay and a peek is never focused.
 */
import type { OverlayHandle, TUI } from "@earendil-works/pi-tui";

import { reconcileFocus } from "./panel-focus-reconcile.ts";
import type { PanelHost } from "./panel-host.ts";

/** What a focus change is allowed to move, and nothing else. */
export interface PanelFocusState {
  /** Record the focus flag and drop the memorised frame with it (`PanelComponent.setFocused`). */
  setFocused(focused: boolean): void;
  /**
   * Put the bar back on the top-ranked pin and drop the memorised frame with it.
   *
   * On the *focus-taking* verb alone. `setFocused` is not enough and is not what to hang this on:
   * `containKey` (`panel-input.ts`) and `hidePanel` (`panel-user-verbs.ts`) move the flag directly as an
   * escape hatch when a host throws, and a panel the user never got to see must not lose its place on their
   * account — only a session that *begins* resets it (`focusPanel` below).
   */
  resetSelection(): void;
}

/** The three collaborators one focus change involves. */
export interface PanelFocus {
  /** The component's focus flag, through the one setter that invalidates with it. */
  state: PanelFocusState;
  /** pi's handle, absent until the host hands it over — a component pi never finished building. */
  handle: OverlayHandle | undefined;
  /** The host: who redraws, and who decides what an unfocused panel means for the rail. */
  host: PanelHost;
  /**
   * Whether the handle arrived, which decides whether an ask is even possible.
   *
   * A component whose factory has not handed over a handle has *nothing to reconcile against*: reading that
   * as a refusal would take the flag from a panel whose overlay is still being built, which is a state the
   * focus key and every component-level test live in.
   */
  asked: boolean;
  /**
   * Open and close the host's grant window, which the focus verb wraps around the handle's `focus()`
   * (see `PanelHost.beginGrant`).
   */
  beginGrant(): void;
  endGrant(): void;
  /**
   * The TUI to ask, read at the reconciliation itself rather than captured with the rest of the pair.
   *
   * `focusPanel` can be reached a session later than the object this pair was built over — a hidden panel the
   * focus key raises again — and a TUI from the session before is a stale one.
   */
  tui(): TUI | undefined;
}

/** What the component hands the assembly of that pair: the same cells, read live. */
export interface PanelFocusCells {
  state: PanelFocusState;
  /** Read at assembly, so a handle that arrives later is the one the pair carries. */
  handle(): OverlayHandle | undefined;
  host: PanelHost;
  /** The TUI, read at the reconciliation itself — see `PanelFocus.tui`. */
  tui(): TUI | undefined;
}

/**
 * Assemble the pair a focus change is allowed to move.
 *
 * Lives here, beside what the two verbs read, rather than in the component: the component is a keyboard, a
 * frame and a bar, and the meaning of `asked` — no handle, nothing to reconcile — belongs to the verbs that act
 * on it. Every member is read at the moment the verb asks, never captured with the pair.
 */
export function panelFocusCells(cells: PanelFocusCells): PanelFocus {
  const handle = cells.handle();
  return {
    state: cells.state,
    handle,
    host: cells.host,
    asked: handle !== undefined,
    beginGrant: () => cells.host.beginGrant?.(),
    endGrant: () => cells.host.endGrant?.(),
    tui: cells.tui,
  };
}

/**
 * Take the focus: the bar back at the top, then the flag, then the handle, then a frame.
 *
 * The selection is reset *first*, before the flag moves, because `d` and `Enter` address `pins[selection]`:
 * a bar the user could not see — the colours failed them, or they left the panel three rows deep and came
 * back — must never act on a pin nobody chose. Losing the place is the cheaper loss, and this is the one
 * place the reset lives: the two direct `setFocused(false)` escape hatches (`containKey`, `hidePanel`) and
 * `unfocusPanel` below are deliberately reset-free, so a throwing host or a hide cannot spend a selection the
 * user was working with.
 *
 * The flag is set *before* the handle moves so the frame pi-tui requests on the strength of the handle
 * already reads the focused colours and the keys hint; a handle that focused first could be drawn by a
 * frame request that came from elsewhere in between, in resting colours.
 *
 * Reconciliation runs *after* the ask, which is what makes the flag a report rather than a hope:
 * `OverlayHandle.focus()` returns without taking anything from an overlay whose entry has left pi's stack or
 * whose `visible()` answers false (tui.js:431-436), so a flag set over a refused ask describes a keyboard
 * nobody granted — and the dispatcher keeps answering keys for it. A component whose ask was never even
 * *made* (no handle yet: the factory has not run) is the same state, and is answered the same way. The
 * release below is the component's own ending and so is idempotent in pi — `unfocus()` returns when the
 * component is not the focused one — which is what lets it stand for both halves of the disagreement.
 * `panel-focus-reconcile.ts` owns the question.
 */
export function focusPanel(target: PanelFocus): void {
  target.state.resetSelection();
  target.state.setFocused(true);
  // The grant is in flight for as long as the ask is on the stack: pi-tui's `OverlayHandle.focus()` asks the
  // overlay's own `visible()` before it honours the ask (`tui.js:431-436`), and that callback is the owner's
  // per-frame reconciliation point. Asking pi *there* reads the focus cell before the grant lands and releases
  // the keyboard the ask is in the middle of taking. `panel.ts` reads this cell and skips that one frame.
  target.beginGrant();
  try {
    target.handle?.focus();
  } finally {
    target.endGrant();
  }
  // Asked after the render request so the frame the user is promised exists before the flag is corrected:
  // a release below invalidates it anyway, and a refused ask must not leave the colours it just asked for
  // standing on screen. A component whose handle never arrived has *nothing to ask* — see `asked`.
  const asked = target.asked;
  const tui = target.tui();
  target.host.requestRender();
  // The release is the same ending a throwing host throws out of `unfocus()`, and it has to be contained the
  // same way (`containKey`, `panel-input.ts`): the flag is the one thing this extension owns and the one
  // thing a throw must not survive, so it goes down before the handle is touched and a second throw is
  // swallowed with the first. A user whose keystrokes reach nothing is the failure this protects against;
  // a rail that did not get its settle is the lesser loss, and the next draw reconsiders it.
  if (asked)
    reconcileFocus(tui, {
      granted: () => target.handle?.isFocused() ?? false,
      release: () => releaseRefused(target),
    });
}

/** Contained release of a reconciliation's verdict: the flag first, the handle second, neither able to escape. */
function releaseRefused(target: PanelFocus): void {
  target.state.setFocused(false);
  try {
    target.handle?.unfocus();
  } catch {
    /* The handle may be gone; the flag above already took the panel out of the key path. */
  }
  try {
    target.host.unfocus();
    target.host.requestRender();
  } catch {
    /* Same: the ending is best-effort once the flag is down. */
  }
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
  // the interaction actually ends (U12). Focus is the only way in — the focus key and Enter-from-a-key — so
  // a panel the user focused and then left is the case the rule is about, and a keystroke into a peek already
  // arrives through here via the key dispatcher.
  target.host.unfocus();
  target.host.requestRender();
}
