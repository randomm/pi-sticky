/**
 * What the extension's `StickyDeps` object is made of, away from the extension that owns the state.
 *
 * `extension.ts` holds the live state and the few things the deps reach into it for; this module closes
 * over those and hands back the object the tool, the commands and the reminder are handed. It exists so the
 * extension carries the *cells* and this file carries the *shape*: the commit path's ordering rule, the
 * auto-show that rides a redraw, and the panel's one-cell access pattern are three rules with reasons
 * attached, and none of them is about owning state.
 *
 * Two constraints the closures impose, both of them the reason this is a builder rather than a literal:
 * - `commit` writes the commit ledger *before* it replaces `state`, so the commit the ledger counts is the
 *   one the branch cannot be read for yet (`session-commits.ts`).
 * - `redraw` draws and does *not* rebuild: the change that asked for it is not on the session yet, and a
 *   rebuild would read the branch without it and put the pins back.
 *
 * Everything the object reads out of the extension is a cell read at call time, never a value taken at build
 * time — which is the rule the whole extension follows, and the reason a reload, a resume or `/tree` lands
 * on the right answer without a special case here.
 */
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import type { StickyDeps } from "./deps.ts";
import type { PanelComponent } from "./panel-component.ts";
import type { PanelModeState } from "./panel-mode.ts";
import { earnedOpenCells } from "./panel-transience.ts";
import type { CommitLedger } from "./session-commits.ts";
import type { PinState, PinView, StickyConfig, UserAction } from "./types.ts";

/** What the extension supplies; everything else in the returned object is this module's own. */
export interface ExtensionDepsCells {
  config: StickyConfig;
  /** The extension's clock — the one source of time, so the panel, the rail and a pin's stamp agree. */
  now(): string;
  /** The panel's mode cell, shared by reference with every surface. */
  panel: PanelModeState;
  /** The ledger of commits the branch cannot be read for (`session-commits.ts`). */
  commits: CommitLedger;
  /** The live state and view, read at call time through the extension's own cells. */
  state(): PinState;
  view(): PinView;
  /** Publish a rebuilt state and view as the live ones (the only writer besides `commit`). */
  publish(rebuilt: { state: PinState; view: PinView }): void;
  /** Adopt a committed snapshot as the live state and view. */
  commit(next: PinState): void;
  /** The extension's `redrawAll`: the rail, then the panel, at whichever context is still live. */
  redraw(ctx?: ExtensionContext): void;
  /** The open panel's component, or `undefined` when no panel is drawn. */
  component(): PanelComponent | undefined;
  /** Append the `pi-sticky.user` entry that is a user's action, then rebuild and redraw. */
  appendUserAction(action: UserAction): void;
}

/**
 * The `StickyDeps` of one extension instance, over the cells it owns.
 *
 * Annotated as `StickyDeps` rather than spread at the construction site, so a member the deps gain (or drop)
 * is a compile error at this literal rather than at some consumer forty lines away.
 */
export function createExtensionDeps(cells: ExtensionDepsCells): StickyDeps {
  return {
    config: cells.config,
    // The one cell, handed to every surface through deps: the overlay, the rail and the component all read
    // the same object, so the frame drawn and the pins the rail stands down for cannot disagree about one
    // view.
    panelMode: () => cells.panel,
    now: cells.now,
    getState: cells.state,
    getView: cells.view,
    commit: (next, affected) => {
      // The ledger is written before `state` is replaced, so the commit it counts is the one the branch
      // cannot be read for yet (U8, narrowed by U11). *Every* commit is noted, including one that added no
      // pin: an `update` that promotes a pin to `action` is exactly the commit U11 says must reach the
      // level test, and a length comparison would have dropped it before it got there.
      cells.commits.note(affected, next.pins);
      cells.commit(next);
    },
    redraw: (ctx) => {
      // Draw what the live state says, and *not* rebuild: the change that asked for this is not on
      // the session yet (pi appends the tool result only after `execute` returns), so a rebuild would
      // read the branch without it and put the pins back. The auto-show comes first — see
      // `session-commits.ts`, and `panel-autoshow.ts` for the rule and the levels that count.
      cells.commits.autoShow(cells.panel, cells.view());
      cells.redraw(ctx);
    },
    ...earnedOpenCells({
      panel: cells.panel,
      component: cells.component,
      redraw: () => cells.redraw(),
    }),
    appendUserAction: cells.appendUserAction,
  };
}
