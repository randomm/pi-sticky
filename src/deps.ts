/**
 * The one object the wiring modules (`tool.ts`, `commands.ts`, `reminder.ts`) are handed.
 * `extension.ts` owns the live state and builds it; every other module reads through these
 * members, so nothing but the extension holds mutable state and a test can build the same
 * object by hand.
 *
 * Deliberately *not* the `StickyDeps` of docs/plan.md: that one declares `commit(next, via, ctx)`
 * and `setHidden(hidden, ctx)`, both of which went away with the footer-status hide mode and the
 * `pi-sticky.ui` entry (docs/research-summary.md section 4). There is no `via` because there is no
 * `pi-sticky.state` writer in this ticket: an agent change publishes its snapshot as the tool
 * result's `details` and a user change appends a `pi-sticky.user` entry, and both paths rebuild
 * with `reconstruct` rather than trusting a handed-in state.
 */
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import type { PinState, PinView, StickyConfig, UserAction } from "./types.ts";

export interface StickyDeps {
  /** Effective configuration, read once from the environment by `index.ts`. */
  config: StickyConfig;
  /** The injected clock: an ISO instant, never a model input. */
  now(): string;
  /** The live state, as the last rebuild left it. */
  getState(): PinState;
  /** The view every surface draws: the tool's listing, the rail, `/pins` and the reminder. */
  getView(): PinView;
  /** Rebuild state from the session and redraw. Without a live context it still rebuilds. */
  redraw(ctx?: ExtensionContext): void;
  /**
   * Adopt a snapshot the caller has just committed. Called by the tool with the state
   * `applyAction` produced *before* it asks for the redraw: the caller commits the snapshot (pi
   * appends the tool result after `execute` returns) and only a rebuild after that can see it, so
   * a redraw that rebuilt first would reset the pins to what the stale branch said.
   */
  commit(state: PinState): void;
  /** Record one of the user's actions as a `pi-sticky.user` entry. */
  appendUserAction(action: UserAction): void;
  /**
   * The user's panel-visibility choice, as the live flag the overlay's `visible()` reads every
   * frame. It is set without recording by the auto-show on a new pin and by `ctrl+alt+p`, and set
   * *and* recorded by an explicit toggle — which is what keeps a preference the user never made out
   * of the session file (persistence decision).
   */
  isPanelShown(): boolean;
  /** Change the live flag only, and redraw. Records nothing. */
  setPanelShown(shown: boolean): void;
  /** Append the `pi-sticky.ui` entry that makes a toggle survive a reload and a resume. */
  recordPanelShown(shown: boolean): void;
}

/**
 * A snapshot the caller may keep and mutate: `EMPTY_STATE` is frozen, so publishing it as a tool
 * result's `details` would hand pi a shared object that every later copy is made from.
 */
export function copyState(state: PinState): PinState {
  return {
    v: 1,
    nextId: state.nextId,
    pins: state.pins.map((pin) => ({ ...pin })),
    removed: state.removed.map((removal) => ({ ...removal })),
  };
}
