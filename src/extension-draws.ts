/**
 * The two draws every change ends in: the rail, then the panel.
 *
 * One idiom, one fixed order, one call site each — which is the point. Everything that can change what the
 * rail shows (a commit, a toggle, a dismissal, a rebuild, a frame) reaches `drawRail` through here, so the
 * handoff is written in exactly one place and the live `panel` is read off the instance's cells rather than
 * closed over: the owner's wiring is built from `drawRail`, so the two are mutually recursive and only a cell
 * breaks the cycle (`session-surfaces.ts`).
 *
 * Two rules the pair imposes:
 * - The visibility flag is *not* an argument to either. `panel.isVisible()` already folds it in, so a copy
 *   here could only be one the caller forgot to pass.
 * - The rail's teardown is reported, not obeyed: pi replaces the key's component on every install, so a
 *   surface going away re-asks the hand rather than stopping it — stopping it here would stop the minute on
 *   the tick that re-ages this very rail.
 *
 * One rule about what they do *not* do, and it is a constraint rather than an omission: `drawRail` runs
 * through `RailGuard.consider`'s `redraw` callback, which that guard invokes detached and cannot report on
 * (`panel-rail.ts`), so a throw from here escapes the frame or the refresh that asked for the draw. Nothing
 * in this module catches, and nothing here may throw beyond `ctx.ui.setWidget` — which pi tolerates — so the
 * cells it reads stay plain reads of what the instance holds. `test/panel-rail-guard.test.ts` drives the
 * guard's own paths; a failure of this rule would be a refresh that died with the rail half-installed.
 */
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import type { AgeClock } from "./panel-age.ts";
import type { PanelOwner } from "./panel.ts";
import type { PinView, StickyConfig } from "./types.ts";
import type { LiveRail } from "./widget.ts";
import { drawPins } from "./widget.ts";

/** The two surfaces of one session, both read at draw time through the cells that hold them. */
export interface DrawCells {
  view(): PinView;
  config: StickyConfig;
  clock: AgeClock;
  /** The live context, for a redraw that came with no context of its own. */
  live(): ExtensionContext | undefined;
  /**
   * The owner, read per boundary rather than taken once: `extension.ts` holds it in a field that
   * `session_shutdown` closes and a later session replaces, so the read has to happen at the draw — which
   * is a different reason from the `live()` cell beside it, whose value can become `undefined` outright.
   */
  owner(): PanelOwner | undefined;
  /** The instance's live rail, so its teardown reports itself to the right hand (`widget.ts`). */
  rail: LiveRail;
  /** A surface's teardown: the hand re-asks whether either surface is still drawn. */
  surfaceGone(): void;
}

/** The pair of draws, over one instance's cells. */
export interface SurfaceDraws {
  /**
   * Install the rail for the current view and the open panel, at the context that asked.
   *
   * Part of the seam, not just this module's private half: the extension hands it to the panel's wiring as
   * `redrawRail` and to the minute's hand, so the owner and the tick ask the rail from here too.
   */
  drawRail(ctx?: ExtensionContext): void;
  /** Draw both surfaces — the one idiom every change ends in. */
  redrawAll(ctx?: ExtensionContext): void;
}

/** Build the pair. Nothing here holds state: both draws read the cells at call time. */
export function createSurfaceDraws(cells: DrawCells): SurfaceDraws {
  function drawRail(ctx?: ExtensionContext): void {
    if (ctx)
      drawPins(
        ctx,
        cells.view(),
        cells.config,
        cells.owner(),
        cells.clock,
        cells.surfaceGone,
        cells.rail,
      );
  }
  // `ctx` is the context of the event, tool call or command that asked; without one the live context of the
  // last `session_start` draws, and without that either nothing draws and the next start will.
  return {
    drawRail,
    redrawAll: (ctx) => {
      drawRail(ctx ?? cells.live());
      cells.owner()?.refresh();
    },
  };
}
