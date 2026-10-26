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
 *
 * The panel's visibility flag is deliberately absent from this object: its *storage* is a `PanelDeps`
 * concern, and the three modules this object is handed to read none of it (see `panel-deps.ts`).
 *
 * `redraw` takes `Notifier`, and `rebuild` takes `RebuildContext` — projections of pi's context, in both
 * cases the members the callee actually uses — because the callers hold three different shapes (a tool
 * context, a command context, the live context) and none of them needs to name the whole interface to
 * ask for a frame or a re-read.
 */
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import type { Notifier, RebuildContext } from "./commands.ts";
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
  /**
   * Redraw every surface from the live state. `ctx` is the context the change came from — the tool
   * call's or the command's — and the one the rail is drawn through; without it the live context of the
   * last `session_start` is used, and without that either the rebuild still happens and nothing draws.
   */
  redraw(ctx?: Notifier): void;
  /**
   * The visibility the session file asks for: the last `pi-sticky.ui` entry, else shown.
   *
   * A dep rather than a direct call of `initialShown(ctx)` from `rebuild`, because the context a rebuild
   * is handed is the projection above and `initialShown` asks it through the same two members — so the
   * one place that reads the session for the user's choice stays in `panel-deps.ts` and this object says
   * what a rebuild is allowed to ask.
   */
  shownFrom(ctx: RebuildContext): boolean;
  /**
   * Adopt a snapshot the caller has just committed. Called by the tool with the state
   * `applyAction` produced *before* it asks for the redraw: the caller commits the snapshot (pi
   * appends the tool result after `execute` returns) and only a rebuild after that can see it, so
   * a redraw that rebuilt first would reset the pins to what the stale branch said.
   */
  commit(state: PinState): void;
  /** Record one of the user's actions as a `pi-sticky.user` entry. */
  appendUserAction(action: UserAction): void;
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
