/**
 * The one object the wiring modules (`tool.ts`, `commands.ts`, `reminder.ts`) are handed.
 * `extension.ts` owns the live state and builds it; every other module reads through these
 * members, so nothing but the extension holds mutable state and a test can build the same
 * object by hand.
 *
 * Deliberately *not* the `StickyDeps` of docs/plan.md — that block is historical, and *the interface
 * here is authoritative for the shape of this object* (docs/plan.md is kept for history only). Its
 * `StickyDeps` declares `commit(next, via, ctx)` and `setHidden(hidden, ctx)`, both of which went
 * away with the footer-status hide mode and the
 * `pi-sticky.ui` entry (docs/research-summary.md section 4). There is no `via` because there is no
 * `pi-sticky.state` writer in this ticket: an agent change publishes its snapshot as the tool
 * result's `details` and a user change appends a `pi-sticky.user` entry, and both paths rebuild
 * with `reconstruct` rather than trusting a handed-in state.
 *
 * The panel's visibility flag is deliberately absent from this object: its *storage* is a `PanelDeps`
 * concern, and the three modules this object is handed to read none of it (see `panel-deps.ts`).
 *
 * `redraw` is the one member that takes a context, and it takes pi's whole `ExtensionContext`: drawing
 * goes through `ui.setWidget` and is asked by callers that hold a real context (a tool's, a command's,
 * the live one), so the one place that would accept a narrower projection is the one place that has to
 * widen it again. `HostContext` is the projection for the members that genuinely do not need more.
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
  /**
   * Redraw every surface from the live state. `ctx` is the context the change came from — the tool
   * call's or the command's, both of which are full pi contexts — and the one the rail is drawn through;
   * without it the live context of the last `session_start` is used, and without that either the rebuild
   * still happens and nothing draws.
   */
  redraw(ctx?: ExtensionContext): void;
  /**
   * Adopt a snapshot the caller has just committed. Called by the tool with the state
   * `applyAction` produced *before* it asks for the redraw: the caller commits the snapshot (pi
   * appends the tool result after `execute` returns) and only a rebuild after that can see it, so
   * a redraw that rebuilt first would reset the pins to what the stale branch said.
   *
   * `affected` is the ids that very call answered for — the reducer's own `affected` list, handed over
   * rather than guessed at. The panel asks one question about a commit ("did it touch a pin the user must
   * act on?", `panel-autoshow.ts`) and the answer is about those ids: a `count`-shaped proxy is wrong for
   * both cases the criterion names — an `update` keeps the id it was given, and the drawn order ranks by
   * reply state, so "the newest pin" is not "the pin the commit touched". Required because there is exactly
   * one caller and it holds the reducer's own answer: `list` publishes no snapshot and so commits nothing.
   */
  commit(state: PinState, affected: readonly number[]): void;
  /** Record one of the user's actions as a `pi-sticky.user` entry. */
  appendUserAction(action: UserAction): void;
  /**
   * End an earned open and settle both surfaces: the panel returns to what the user's own verbs chose and
   * the rail takes the pins back. The one move the reply handler makes on a submitted message
   * (`panel-transience.ts`), and the reason it is a member rather than the handler reaching the cell and the
   * redraw separately — those two have an order, and only the extension knows it.
   */
  endEarnedOpen(): void;
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
