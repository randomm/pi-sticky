/**
 * The one `ctx.ui.custom()` call the panel makes: building the overlay and its component, and reporting
 * the two ways that call can go wrong.
 *
 * `PanelOwner` decides *whether* a panel opens and when it closes; this file is the whole of *how* the
 * host is asked for it. The split is not ceremony — `custom()` is pi's call, its factory is pi's callback,
 * and its rejection is pi's failure, so the file that touches all three is the one that changes when pi
 * changes the overlay API. The owner keeps the session's decisions (close-before-open, the refusals, the
 * record's publication) and hands over only closures over a session it knows is still alive.
 *
 * Two things here are easy to get wrong and are the reason the call is not inlined at its caller:
 * - `ui.custom` is read at *call* time, never captured earlier: a host that installs its own `custom` per
 *   call has to be consulted now, or the panel opens on the `custom` from a moment ago and the swap is
 *   bypassed.
 * - A rejection must leave the published record forgotten (`onFailed`), because an invisible record keeps
 *   `isVisible()` answering true for an overlay that is not on screen — and must *not* clear a close
 *   failure the owner is still owed, since a wedged overlay stack makes the next open reject as well.
 *
 * Two more facts about the two failure reports:
 * - With no panel the rail keeps drawing, which is the fallback by design — but a poisoned overlay stack
 *   rejects *every* open from then on, and a rail that answers forever looks the same as a working one.
 * - An `Error` with an empty message still has to say something: `String(err)` keeps the class name rather
 *   than leaving the user with "pins panel unavailable: ".
 */
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import type { TUI } from "@earendil-works/pi-tui";

import type { PanelCallOptions, PanelRecord } from "./panel-call.ts";
import type { PanelComponent } from "./panel-component.ts";
import type { PanelWiring } from "./panel-deps.ts";
import type { GrantWindow } from "./panel-grant-window.ts";
import { panelCallOptions, panelFactory } from "./panel-overlay.ts";

/** What the owner hands the open: closures over its own live state, and the two reports it owes the user. */
export interface PanelOpenHooks {
  /** The TUI pi handed the factory — where a frame is requested from. */
  tui(): TUI | undefined;
  /** Record the TUI the factory was handed, so a later frame request has one. */
  onTui(tui: TUI): void;
  /** The component told the owner the interaction ended; the owner settles which surface owns the pins. */
  onUnfocus(): void;
  /** The owner's visibility answer — the same predicate pi asked before drawing this overlay. */
  panelVisible(): boolean;
  /** Hand the overlay handle to the component that has to release it. */
  onHandle(handle: Parameters<NonNullable<PanelCallOptions["onHandle"]>>[0]): void;
  /** The open rejected: forget the record and tell the user, once, why. */
  onFailed(reason: string): void;
  /** The overlay's per-frame question, answered and recorded by the owner (width, rail, visibility). */
  visible(columns: number, rows: number): boolean;
  /**
   * Open and close the owner's **grant window** around the handle's `focus()`, which the factory hands to the
   * host so the component's focus verb reaches it (see `PanelHost.beginGrant` and `panel-grant-window.ts`).
   */
  grants: GrantWindow;
}

/**
 * Ask the host for the panel's overlay, and let the record fill itself in as pi-tui builds the component.
 *
 * Not awaited by the caller and it does not throw: `custom()` is a promise, so the component arrives on a
 * later microtask, and every failure of the call ends in `onFailed` plus one notify line. The caller has
 * already published the record, which is what lets the rail decide in the same turn.
 */
export function openPanelOverlay(
  ctx: ExtensionContext,
  record: PanelRecord,
  wiring: PanelWiring,
  hooks: PanelOpenHooks,
): void {
  void ctx.ui
    .custom(
      panelFactory(record, wiring, {
        onTui: hooks.onTui,
        tui: hooks.tui,
        onUnfocus: hooks.onUnfocus,
        panelVisible: hooks.panelVisible,
        // The cell itself, read at *call* time: the component is the only thing that knows the peek and the
        // open frames are different sizes, and the cell is the extension's, not the component's.
        mode: () => wiring.deps.panelMode().mode(),
        interactiveOpen: () => wiring.deps.panelMode().interactiveOpen(),
        grants: hooks.grants,
      }),
      panelCallOptions(hooks.visible, hooks.onHandle),
    )
    .catch((err: unknown) => {
      hooks.onFailed(reasonOf(err));
    });
}

/** What a rejected `custom()` says about itself, for the one line the user is told. */
function reasonOf(err: unknown): string {
  return err instanceof Error && err.message !== "" ? err.message : String(err);
}

/**
 * The owner's half of the open: the closures `panelFactory` builds the overlay through.
 *
 * Kept here, beside the call they are handed to, rather than on the owner: every one is a closure over a
 * session the owner knows is still alive, and each reads the owner *now* rather than capturing a value — the
 * component outlives the microtask `custom()` resolves on, and a hidden panel can be focused a session later
 * than the object its factory was made over. `onFailed` is the one member that must not: it compares against
 * the record this open published, so a late failure of a superseded open cannot forget the panel in its place.
 */
export function ownerOpenHooks(
  owner: PanelHooksOwner,
  ctx: ExtensionContext,
  record: PanelRecord,
): PanelOpenHooks {
  return {
    tui: () => owner.tui(),
    onTui: (tui) => owner.rememberTui(tui),
    // The interaction ended: the earned open ends with it, and then the surfaces are settled. The ending goes
    // to the cell before the redraw rather than after, because `refresh()` is what asks the rail and the
    // overlay what the panel is doing — a rail reconsidered against the still-open answer is a rail that stood
    // down for pins it should have taken back.
    onUnfocus: () => {
      owner.endEarnedOpen();
      owner.refresh();
    },
    panelVisible: () => owner.isVisible(),
    onHandle: (handle) => owner.component()?.setHandle(handle),
    onFailed: (reason) => {
      owner.forget(record);
      ctx.ui.notify(`pins panel unavailable: ${reason}`, "warning");
    },
    visible: (columns, rows) => owner.frame(columns, rows),
    grants: owner.grants,
  };
}

/** What `ownerOpenHooks` reads of the owner: its live cells, each asked at the moment the host asks. */
export interface PanelHooksOwner {
  /** The TUI pi handed this panel's factory, which is where a frame is requested from. */
  tui(): TUI | undefined;
  rememberTui(tui: TUI): void;
  /** The overlay's component, read at the moment the host asks (also `KeyboardCells`' member). */
  component(): PanelComponent | undefined;
  endEarnedOpen(): void;
  refresh(): void;
  isVisible(): boolean;
  /** Forget the record only if it is still the one this open published. */
  forget(record: PanelRecord): void;
  /** The per-frame question: width, rail, visibility — answered and recorded by the owner. */
  frame(columns: number, rows: number): boolean;
  /** The depth counter, handed to the factory so it can bracket the handle's own `focus()`. */
  grants: GrantWindow;
}
