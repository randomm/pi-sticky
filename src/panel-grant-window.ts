/**
 * Whether a focus grant is in flight, on the stack.
 *
 * pi-tui's `OverlayHandle.focus()` asks the overlay's own `visible()` *before* it honours the ask
 * (`tui.js:430-436`), and for the panel that callback is `PanelOwner.#visible` — the per-frame reconciliation
 * point. Asking pi where the keystrokes go from inside the ask answers "not focused" about a keyboard that is
 * one statement from being granted, and then releases it: a panel that can never be focused, which is the
 * lockout's opposite and entirely self-inflicted. So the owner records that a grant is under way, and the
 * frame path stays quiet while it is.
 *
 * A **depth counter** and not a boolean, because the ask is not one call deep: the visibility callback the
 * overlay was opened with is the extension's own, and anything it reaches — pi-tui's guards, a test's handle
 * model — may ask it again before the outer ask returns. A boolean would close the window at the bottom of the
 * innermost question and re-open the same trap one frame later.
 *
 * `end()` never goes below zero: the ask is wrapped in a `finally`
 * (`panel-component-focus.ts`), so a throw on the way out closes it once, and a stray `end()` must not leave
 * the window shut for grants that were never made.
 */
export interface GrantWindow {
  /** Open the window: called around a handle's `focus()`. */
  begin(): void;
  /** Close one layer of it, on every path out of the ask. */
  end(): void;
  /** Whether any grant is still on the stack. */
  active(): boolean;
}

/** A grant window nobody has used yet. */
export function createGrantWindow(): GrantWindow {
  let depth = 0;
  return {
    begin: () => {
      depth += 1;
    },
    end: () => {
      depth = Math.max(0, depth - 1);
    },
    active: () => depth > 0,
  };
}
