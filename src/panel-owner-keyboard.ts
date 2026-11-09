/**
 * The owner's side of the keyboard: what the escape hatch may ask of the open panel, and the two questions
 * pi is asked about the focus.
 *
 * Lives beside the owner rather than inside it because the file is the owner's *keyboard surface* — the
 * members `panel-escape-hatch.ts` and `session-rebuild.ts` reach through it, and the reconciliation the
 * frame, the close and the rebuild all hand to `panel-focus-reconcile.ts`. The owner keeps the record, the
 * width and the rail; a caller that wants the keyboard comes here.
 *
 * Two of the three read **pi**, not the extension's own flag:
 *
 * - `keyboard()` answers with the handle's own verdict, which in pi-tui is `focusedComponent === component`
 *   (`tui.js:467`). The hatch must not read the component's flag: that flag is the thing under suspicion in a
 *   lockout, so a hatch that read it would be blind in exactly the case it exists for.
 * - `reconcile()` asks the same question and lets the component's own ending answer a "no". It is asked on the
 *   owner's **record**, not on the flag: `close()`, `open()` and a rebuild all reach states in which the flag
 *   is legitimately down while pi's focus is still on the component, and a reconciliation that read the flag
 *   first would refuse to ask the only question that detects it. The per-frame caller (`PanelOwner.#visible`)
 *   is the exception and the only one — it runs on every frame, so it asks nothing while the flag is down.
 * - `beginGrant`/`endGrant` are a **depth counter**, not a boolean. pi-tui's `OverlayHandle.focus()` asks this
 *   overlay's own `visible()` *inside* the ask (`tui.js:430-436`) — and that callback is the owner's
 *   per-frame reconciliation point. Asking pi there reads the focus cell before the grant has landed and
 *   releases the keyboard the ask is in the middle of taking, which is the lockout's opposite and
 *   self-inflicted. The window is open for the whole of the ask, including whatever the callback walks.
 */
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";

import type { HostContext } from "./context.ts";
import type { PanelComponent } from "./panel-component.ts";
import type { PanelWiring } from "./panel-deps.ts";
import type { HatchKeyboard } from "./panel-escape-hatch.ts";
import { reconcileFocus } from "./panel-focus-reconcile.ts";
import type { GrantWindow } from "./panel-grant-window.ts";
import { focusFromShortcut, hidePanel, showPanel, togglePanel } from "./panel-user-verbs.ts";

/** What the owner has to say about the keyboard, and the only reader of its record for that question. */
export interface KeyboardCells {
  /** The component of the overlay on screen now, or `undefined` before its factory ran or after the close. */
  component(): PanelComponent | undefined;
  /** The TUI pi handed the factory, read at the moment the question is asked. */
  tui(): TUI | undefined;
  /** Whether the owner is in the middle of asking for the keyboard (`panel-grant-window.ts`). */
  grants: GrantWindow;
}

/**
 * What the escape hatch needs of the open panel: pi's own answer for whether this overlay holds the keyboard,
 * and the verb that gives it back. `undefined` when none is open, and the hatch then consumes nothing.
 * `release()` is the component's own ending, so the flag, the handle and the owner's settle move together
 * rather than the hatch writing a flag it does not own.
 */
export function ownerKeyboard(cells: KeyboardCells): HatchKeyboard | undefined {
  const component = cells.component();
  const handle = component?.handle();
  return component && handle
    ? { isFocused: () => handle.isFocused(), release: () => component.unfocus() }
    : undefined;
}

/**
 * One reconciliation: ask pi where the keystrokes go, and let the component's own ending answer a "no".
 *
 * The release is `PanelComponent.unfocus()` — the verb `Escape` reaches — so the flag, the handle and the
 * owner's settle move as one action. A component with no handle yet is skipped: the overlay is still being
 * built, which is the state every open passes through.
 */
export function reconcilePanelFocus(cells: KeyboardCells): void {
  const component = cells.component();
  if (!component?.isFocused()) return;
  const handle = component.handle();
  if (!handle) return;
  reconcileFocus(cells.tui(), {
    // Read *at the verdict*, not captured on the way in: the answer must describe the focus as it stands once
    // the ask has returned, not the keystroke before it.
    granted: () => handle.isFocused(),
    // Contained, because this caller has no try above it: `#frame` runs it inside a composite, `close()` runs
    // it from `session_start`/`session_tree`/`session_shutdown` and the rebuild from a turn boundary, none of
    // which is `containKey`. `unfocus()` is the member most likely to throw — the handle, the owner's settle
    // (`onUnfocus`), a frame request on a TUI whose session is gone — and a throw out of the per-frame path is
    // an `extension_error` on every render, while a throw out of a boundary leaves the extension holding the
    // dead session's state.
    //
    // The handle is then asked **again**, and that second ask is the substance of this containment rather than
    // its form. `unfocusPanel` (`panel-component-focus.ts`) moves the flag down as its first statement and
    // reaches the handle only after it, so the throw arrives with the flag already false: a `catch` that only
    // wrote the flag — the shape `hidePanel` and `releaseKeysOutsideScreen` below use, where it is the whole
    // guarantee because *they* are the ones holding the flag — would here write a cell that already said what
    // it says and stop. The consequence is not cosmetic: pi's cell still names a panel this extension no longer
    // treats as focused, so every byte keeps going to a component nobody draws, `reconcileOnFrame` gates on the
    // flag and never asks again, and the dispatcher has handed its own release back. The handle is pi's only
    // door to that cell, and `unfocus()` is idempotent (`tui.js:463-466`, returns when the component is not the
    // focused one), so asking it again is safe — and a second throw is swallowed with the first, leaving the
    // flag down, which is still the state the user can live with.
    release: () => {
      try {
        component.unfocus();
      } catch {
        component.setFocused(false);
        try {
          component.handle()?.unfocus();
        } catch {
          /* The cell may be unreachable; the flag above already took the panel out of this extension's path. */
        }
      }
    },
  });
}

/**
 * The per-frame question, asked only when it is worth a question. Two gates, both about cost:
 *
 * - **A grant in flight** — `panel-grant-window.ts`: pi-tui reaches this callback from inside the `focus()`
 *   ask, where pi's cell still describes the *previous* keystroke.
 * - **A resting panel** — this runs on every composite, and a panel whose flag is down holds no keyboard the
 *   user cannot reach. The other points (`close()`, `open()`, `releaseKeys()`) deliberately do *not* read the
 *   flag: those are exactly the states in which it is legitimately down while pi's focus is not.
 */
export function reconcileOnFrame(cells: KeyboardCells): void {
  if (cells.grants.active()) return;
  if (!cells.component()?.isFocused()) return;
  reconcilePanelFocus(cells);
}

/**
 * Take the keyboard back from a panel the owner is not drawing — the one place that does, since the owner
 * installed the overlay and is the only reader of its component and of what its frame answers for `visible()`.
 * pi stops routing keys to an overlay once that answer goes false, so the release is asked when the component
 * still holds the flag over a frame nobody draws; it runs at the end of every rebuild.
 *
 * The release's guard is the *screen*, and the reconciliation after it is the half that guard cannot see: a
 * component whose flag is already down while pi still routes to it — the swallow-everything state — so pi is
 * asked whatever the flag answered. The ending is contained the way `hidePanel` contains the same one: the
 * flag is what this extension owns and what a throw must not survive, and the rebuild has no ui to report to.
 */
export function releaseKeysOutsideScreen(cells: KeyboardCells, onScreen: () => boolean): void {
  const component = cells.component();
  if (!component) return;
  if (component.isFocused() && !onScreen()) {
    try {
      component.unfocus();
    } catch {
      component.setFocused(false);
    }
  }
  reconcilePanelFocus(cells);
}

/**
 * The owner's user verbs, dispatched over the cells below.
 *
 * `panel-user-verbs.ts` decides what a keystroke does; these four lines are what the owner says when the user
 * asks, so the owner itself keeps one line per verb.
 */

/** `/pins show`. */
export function ownerShow(cells: OwnerVerbCells, ctx: HostContext | undefined): void {
  showPanel(cells, ctx);
}

/** `/pins hide`, and the toggle's other half. */
export function ownerHide(cells: OwnerVerbCells): void {
  hidePanel(cells);
}

/** `/pins` with no argument, and `ctrl+alt+t`. */
export function ownerToggle(cells: OwnerVerbCells, ctx: HostContext | undefined): void {
  togglePanel(cells, ctx);
}

/** `ctrl+alt+p`: bring the panel up and take the keyboard, even from hidden. */
export function ownerFocus(cells: OwnerVerbCells, ctx: HostContext | undefined): void {
  focusFromShortcut(cells, ctx);
}

/**
 * The four readers the user's verbs need of the owner, spelled in one place.
 *
 * Two of them are the owner's own answers — the width it was last told, and the settle-everything `refresh()`
 * — and a pair assembled here rather than at each call site is what keeps a refusal, the rail's key and the
 * overlay on screen agreeing about the terminal. `panel-user-verbs.ts` takes the pair and decides what the
 * user's keystroke does with it.
 */
export interface OwnerVerbCells {
  wiring: PanelWiring;
  /** The open panel's component, or `undefined` when none is drawn. */
  component(): PanelComponent | undefined;
  /** Tell the component the view changed and ask for the rail to be reconsidered. */
  refresh(): void;
  /** How wide this terminal is, in the owner's own reading — the figure `isVisible()` measures against. */
  columns(): number;
}
