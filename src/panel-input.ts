/**
 * The panel's key dispatch, apart from the component that owns the handle and the frame cache.
 *
 * One function, one `switch` in disguise: the bar moves, the selected pin is dismissed or answered, and
 * the interaction ends. `PanelComponent.handleInput` wraps the call in the try that keeps a throwing host
 * out of pi-tui's key path, and hands it a small surface of the component — read the pins, move the bar,
 * ask the host — so the keys stay testable without an overlay, a handle or a theme in the room.
 *
 * The panel owns the keyboard only while it is *on screen* and the open *takes keys* — the host's
 * `interactiveOpen()`, the one answer the gate reads. pi-tui routes input to the focused component alone but
 * asks the overlay whether to draw it, and the two answers can disagree: a pin removed from under an open
 * overlay, a hide, a terminal that narrowed past the panel's boundary, or an open that ended under
 * `PI_STICKY_PANEL=open`, where the frame stays the full one. And the peek is drawn without being interactive
 * at all: three rows, no bar, nothing a key could address. Either way a key has no visible answer, so it is
 * handed back: `unfocus()` puts the focus where the user is typing and tells the owner to settle the rail.
 *
 * The fallthrough is the other half of that promise. A key the panel does not answer is not the panel's key
 * to keep: every unclaimed byte except Ctrl+C is dropped (the panel is a modal and stray letters must not
 * reach the editor under it), and Ctrl+C — the key a user presses when a modal will not let go — *ends* the
 * interaction instead. `isCtrlCPress` (`panel-keys.ts`) is a closed set of literal bytes, so a release, a
 * repeat or a paste-shaped payload containing 0x03 stays inert like any other unclaimed key.
 */
import { isKeyRelease, isKeyRepeat, matchesKey } from "@earendil-works/pi-tui";

import type { KeyId } from "@earendil-works/pi-tui";

import type { DrawnKeys } from "./panel-frame-cache.ts";
import type { PanelHost } from "./panel-host.ts";
import {
  isCtrlCPress,
  isDismissKey,
  isSubmitKey,
  optionKeyPressed,
  presses,
} from "./panel-keys.ts";
import type { PanelMode } from "./panel-mode.ts";
import type { ViewPin } from "./types.ts";

/** The keys that move the bar; `matchesKey` also takes the Kitty forms of each. */
const UP_KEYS: readonly KeyId[] = ["up", "k"];
const DOWN_KEYS: readonly KeyId[] = ["down", "j"];

/**
 * What the dispatch needs of the component: the frame's bar, and the ways to change what is drawn.
 *
 * `drawnKeys()` is where every key resolves the pin it acts on. `pins` and `selection` stay the *live* read —
 * `PanelComponent.pins` is the order the next frame is drawn from and `select()` clamps to it — but a key that
 * indexed them could act on a pin the bar was never drawn on, because `update()` drops the frame and only
 * asks pi-tui for one: until that request arrives the screen still shows the frame's rows.
 */
export interface PanelKeyTarget {
  /** The pins the panel is drawing, in the order it draws them. Live, and not what the keys index. */
  readonly pins: readonly ViewPin[];
  /** The selected *pin* index, not a row index: a pin that wraps owns several rows. */
  readonly selection: number;
  /**
   * The pins and the bar **as the last frame drew them**, with `hasFrame` saying whether one was ever drawn.
   *
   * `hasFrame: false` names the fallback — the live pins, which is all a focused-but-never-rendered component
   * can answer with, and what the focus key reaches, since `focusPanel` only requests a frame. Once a frame has
   * been drawn its pair is the only thing a key may act on: a row of it the view no longer holds is answered
   * with a `selection` that names no pin, and the key is refused rather than re-resolved to whatever the live
   * order now holds at that index — the same wrong pin the fallback would hand out.
   */
  drawnKeys(): DrawnKeys;
  /**
   * Move the bar and ask for a frame. The never-drawn component's move — it has no frame to keep the pair of.
   */
  select(index: number): void;
  /**
   * The move, in one call: the bar and the keys' pair, both written from one reading of the freeze. A move may
   * not write one without the other — the acting keys read the pair, so a bar moved alone leaves `d` answering
   * the row the marker just left. `frameIndex` is the destination's row in the frame the bar was drawn from and
   * `liveIndex` its row in the live order; `panel-component-bar-move.ts` says which of the two the bar takes and
   * why the pair then follows the frame's `step` rather than either index.
   */
  moveTo(frameIndex: number, liveIndex: number, step: number): void;
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
   * Which of the three states the panel is in: **the frame to draw**. This dispatcher never reads it and must
   * not — the peek and the hidden panel it refuses are exactly the two states with no rows, and under
   * `PI_STICKY_PANEL=open` the frame is the full one even when nothing in it is addressable. Declared so one
   * host answers the drawing and the keys, which is the point of the seam; the keys' own question is below.
   */
  mode(): PanelMode;
  /**
   * Whether the open takes keys. The gate below asks this and not `mode()`: the frame says what a shown
   * panel draws, which under `PI_STICKY_PANEL=open` is the full panel even once the open has ended — and a
   * `d` answered there dismisses a pin from a frame the user has already left. The frame's legend is drawn
   * from this same answer (`keysLive`, `panel-frame-draw.ts`), so the border never advertises a key refused
   * here.
   */
  interactiveOpen(): boolean;
  /** Record a dismissal of `id`; the host redraws, and the bar re-clamps. */
  dismiss(id: number): void;
  /**
   * Put `Re #<id>: ` in the editor and start the reply flow. `answer` is the text of the option the user
   * chose by digit, which the host puts after the marker; without it the draft carries only the marker.
   */
  startReply(id: number, answer?: string): void;
}

/**
 * One key, dispatched. A key the panel does not own, a release, a repeat and an empty buffer each do
 * nothing; a key into a panel that is not on screen — or into one the key gate has stopped answering —
 * hands the focus back.
 *
 * The bar stops at both ends of the list rather than wrapping, because a selection that wrapped off the
 * bottom would leave the user looking for a pin they had just scrolled out of — and the ends it stops at, and
 * the pin every acting key addresses, are the **drawn frame's**. `target.drawnKeys()` is the pair the marker
 * the user aimed with was painted on; the live drawn order may have been re-sorted or shortened since, and a
 * key that followed it would dismiss or answer a pin nobody selected. A frame row the view no longer holds
 * addresses nothing, so its key is refused: nothing asked of the host, no interaction ended, and the bar left
 * where the frame drew it — which is why a refusal may not go through `select()` either, since every bar write
 * drops the frame the guard reads.
 */
export function dispatchPanelKey(data: string, target: PanelKeyTarget, host: PanelKeyHost): void {
  if (data === "" || isKeyRelease(data) || isKeyRepeat(data)) return;
  // The gate is the host's *key* answer and not its frame: a panel pi-tui is still drawing may be one the
  // cell has stopped treating as open (`PI_STICKY_PANEL=open`, `panel-mode.ts`), and a hidden panel is not on
  // screen at all. Either way the focus is where the user is not, and the editor is where they are. This gate
  // and the Escape branch below both return before any acting pin is resolved or refused.
  if (!host.isVisible() || !host.interactiveOpen()) {
    target.unfocus();
    return;
  }
  if (matchesKey(data, "escape")) {
    target.unfocus();
    return;
  }
  const drawn = target.drawnKeys();
  // `hasFrame` false is the never-drawn component: its pair is the live pins and the bar as they are now, so a
  // row the frame never drew is not a row to refuse. With a frame, the pair is the screen the user aimed at,
  // and the `selection` outside it that `PanelComponent.drawnKeys()` answers for a dropped row names no pin —
  // which is what the four branches below turn into a refusal.
  const pins = drawn.pins;
  const pin = drawn.hasFrame ? pins[drawn.selection] : target.pins[target.selection];
  if (isSubmitKey(data)) {
    // Enter both answers the pin and ends the interaction: the user reads the reply in the editor, so a
    // panel still holding focus over it would be in the way. With no pin to answer there is no draft to
    // write, and ending the interaction would be an effect the refused key still had.
    if (!pin) return;
    host.startReply(pin.id);
    target.unfocus();
    return;
  }
  if (isDismissKey(data)) {
    // The host's dismissal redraws and the component re-clamps, so dismissing the last pin lands the bar
    // on the new last one rather than on a row that no longer exists.
    if (pin) host.dismiss(pin.id);
    return;
  }
  const digit = optionKeyPressed(data);
  if (digit !== undefined) {
    // One of the options the selected pin offers, answered by *position* — the position the keycap row drew
    // that digit over (`panel-options-row.ts`). Past the pin's list there is no option to name, and a digit
    // on a pin without options names none either: both do nothing, and the interaction stays where it was.
    const answer = pin?.options?.[digit - 1];
    if (pin && answer !== undefined) {
      host.startReply(pin.id, answer);
      // Like Enter: the answer is read in the editor, so the panel lets go of the keyboard.
      target.unfocus();
    }
    return;
  }
  const step = presses(data, UP_KEYS) ? -1 : presses(data, DOWN_KEYS) ? 1 : 0;
  if (step === 0) {
    // The one unclaimed key the panel does not keep. pi-tui routes *every* byte to the focused component,
    // Ctrl+C included, and pi binds Ctrl+C on the editor (`app.clear`): while the panel holds the focus the
    // user's own exit is unreachable, so the key that is supposed to interrupt has to be the one unclaimed
    // byte that ends the modal. It is not forwarded — pi-tui has already routed this byte here — it releases,
    // and the *next* press arrives at the editor.
    if (isCtrlCPress(data)) target.unfocus();
    return;
  }
  // The bar stays where the frame drew it while the frame's own row is on screen: the pair *is* the bar for a
  // panel the user has seen, so a move is asked for only when it has somewhere to go. Both bounds and the
  // destination are the frame's — a frame of three rows is three rows the user can walk to, whatever the view
  // …and a row the view has dropped is no row to stop on. The bar itself is not moved until that is
  // known, because `select()` writes the state, every state write drops the frame, and a refused key would
  // otherwise have spent the frame it was refused for. A refusal is the whole of the key's effect: it writes
  // neither the state nor the pair, so the panel keeps drawing those rows and keeps answering the bar the user
  // aimed at, and it is the focus (`panel-component-focus.ts`) or an accepted move that ends the frame.
  const from = drawn.hasFrame ? drawn.selection : target.selection;
  const next = from + step;
  if (next < 0 || next >= pins.length) return;
  const destination = pins[next];
  if (destination === undefined) return;
  if (drawn.hasFrame) {
    // Settled: the frame's own row, and a pin the view still holds — `drawnKeys()` already refused a row the
    // view dropped, so the destination here is one the user can act on. The bar moves by the **frame's** index,
    // never by a live one: `select()` clamps against the live list, so a frame with more rows than the view has
    // pins would clamp the frame's last row onto the view's last and leave the user with a bar the frame never
    // drew, and any index read off the live order instead of the frame's own step lands the marker a row away
    // from where the user aimed it.
    const stepped = target.selection + step;
    if (stepped < 0 || !target.pins.some((live) => live.id === destination.id)) return;
    // …but a frame **frozen over the view** (`frameOverView()`) is the one case where the frame's index is not an
    // index into what `select()` is about to clamp against: `update()` left those rows standing over a view that
    // dropped their bar and returned without re-sectioning, so the live list is the *new* order. Writing the
    // frame's index there parks the marker on the pin the bar moved off while the acting key follows the pair to
    // another — so for that one frame the bar goes to the destination's **live** index, which is where the marker
    // the user sees is drawn, and the pair is advanced by the frame's step: the same pin in both orders, because
    // each is the view sorted. One coordinate, whichever way the two orders came apart.
    target.moveTo(stepped, target.pins.indexOf(destination), step);
    return;
  }
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
 * The report is contained the way `createTickGuard` (`panel-tick-guard.ts`) contains its own: `notify` is a
 * member of the same host that just threw, so a session whose ui has gone fails there too, and a notice that
 * escapes would leave the panel focused *and* put the throw in pi's key path — the two things the catch is
 * here to prevent. The report is best-effort; ending the interaction is what the guard owes the user.
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
    // Contained in its own `try`, as the tick guard contains its report: `notify` belongs to the host that
    // just threw, and a warning the user never sees is not worth a throw out of the key path.
    try {
      host.notify("A panel key could not be handled.", "warning");
    } catch {
      /* The report failed; the ending below is still owed. */
    }
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
