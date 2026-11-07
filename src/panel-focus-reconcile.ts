/**
 * Reconciling the component's focus flag with what pi granted.
 *
 * `PanelComponent.isFocused()` reads a flag this extension set; pi decides where a keystroke goes, and it
 * decides it in one place — pi-tui routes every byte, Ctrl+C included, to its own focused component. The
 * lockout is what the two answers look like when they disagree: a panel whose flag says *resting* while pi
 * still routes to it swallows everything with nothing left to release it, and a panel whose flag says
 * *focused* over an ask pi never granted is a modal the extension believes in and the terminal does not.
 *
 * So the flag is not kept as a belief. At each reconciliation point it is asked one question, read through
 * the handle pi built for this very overlay: are you the component I am routing to? In pi-tui that answer is
 * literally `focusedComponent === component` (`tui.js:467`) — pi's own expression, read on the object pi
 * paired with this component, which is why the handle carries the answer rather than a reference the
 * extension holds alongside it. A "no" is answered by the component's own release, the same verb `Escape`
 * reaches, which moves the flag, the handle and the owner's settle together — so reconciliation never writes
 * a flag it does not own.
 *
 * The TUI is what decides whether the question may be asked at all, and it is **re-read from the owner's live
 * cell at every point**, never captured: a TUI from a session pi has torn down is a stale object, and so is
 * anything read out of it. `getFocusedComponent()` is declared on pi-tui's `TuiBase` (`tui.d.ts:301`) and not
 * on the `TUI` interface the overlay factory is handed, which is what the one cast in this file is for: it is
 * the gate that says whether pi can answer, and a TUI that cannot answer is the skip case, never a verdict of
 * "not focused". A panel left standing on a session whose TUI is gone is the escape hatch's case
 * (`panel-escape-hatch.ts`), not this module's.
 *
 * The per-frame rule (D4): a panel whose flag is already down is **not asked at all**. pi-tui consults the
 * overlay's `visible()` on every composite, so a reconciliation that read pi there would spend a question and
 * a frame on a resting panel on every single render. The flag-gated no-op is asserted at that one call site,
 * where it is a contract; the other points ask on the record's presence, because they are exactly the points
 * at which the flag is legitimately down while pi's focus is not.
 */
import type { TUI } from "@earendil-works/pi-tui";

/** pi-tui's `TuiBase` declares the reader; the `TUI` interface the factory is handed does not. */
interface FocusReader {
  getFocusedComponent(): unknown;
}

/**
 * What a reconciliation point hands the oracle: the overlay whose flag is in question, and its own ending.
 *
 * `granted()` is the handle's answer — in pi-tui, `focusedComponent === component` (`tui.js:467`) — read
 * *through pi*: a handle that reports focus while pi's focus cell says otherwise is not constructible in the
 * harness (`panel-handle.ts`, `ui-stubs.ts`). `release()` is `unfocusPanel`: the flag, the handle and the
 * owner's settle as one verb, so reconciliation never writes a flag it does not own.
 */
export interface FocusReconcileTarget {
  /** Whether pi routes keystrokes to this overlay, read through the handle pi built for it. */
  granted(): boolean;
  /** End the interaction the way `Escape` ends it. */
  release(): void;
}

/**
 * One reconciliation: pi's answer stands, the flag follows it.
 *
 * Returns whether pi was asked at all, which is how the per-frame path proves that a resting panel costs no
 * question and no frame. Releasing a panel pi has already left is the cheap half of the disagreement, and it
 * is idempotent in pi — `unfocus()` returns when the component is not the focused one — which is what lets one
 * verb answer both halves.
 */
export function reconcileFocus(tui: TUI | undefined, target: FocusReconcileTarget): boolean {
  if (!piCanAnswer(tui)) return false;
  if (!target.granted()) target.release();
  return true;
}

/**
 * Whether pi can answer at all through this TUI — asked before the answer, so a TUI with no reader reports
 * "nothing asked" rather than "not focused".
 */
export function piCanAnswer(tui: TUI | undefined): boolean {
  if (!tui) return false;
  // The one narrow cast, for the member `TuiBase` declares and `TUI` does not.
  const reader = tui as Partial<FocusReader>;
  return typeof reader.getFocusedComponent === "function";
}
