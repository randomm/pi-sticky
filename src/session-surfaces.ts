/**
 * The two cells one extension instance owns about *what it has on screen*.
 *
 * Both are per-instance state and both exist to keep a fact from becoming process-global, which is the class
 * of defect each one was extracted from:
 *
 * - `rail` is the instance's live rail (see `LiveRail`, `widget.ts`). A `static` on `RailComponent` was one
 *   cell for every extension instance in the process, so one instance's rail answered a teardown in another's
 *   session — a rail replaced in one silenced the other's report, and a teardown in one was read as a surface
 *   going away in a session whose rail was still drawn.
 * - `panel` is the single cell the panel owner is kept in. It is here rather than beside the other cells
 *   because the owner's wiring is built from the extension's own `drawRail`, so the two are mutually
 *   recursive: only a cell breaks the cycle, and a cell typed `| undefined` makes the ordering something the
 *   compiler checks rather than a comment.
 *
 * `surfacesDrawn` is the minute hand's one question over both surfaces, answered by the owner that *installs*
 * them (`PanelOwner.isAnySurfaceVisible`, `panel.ts`) — never by a width `TerminalWidth` had to guess, since
 * an unstated terminal is guessed wide on purpose (`panel-width.ts`) and a timer would then run for a surface
 * no host ever installed. Read through the cell at call time, so the answer is *now* and not the frame the
 * owner opened on, and `false` when no owner exists at all: no owner means no surface, and the hand owes no
 * frame.
 */
import type { PanelOwner } from "./panel.ts";
import type { LiveRail } from "./widget.ts";
import { createLiveRail } from "./widget.ts";

/** The cells one extension instance owns about its two surfaces. */
export interface SessionSurfaces {
  /** The instance's live rail: `drawPins` names it at install, `RailComponent.dispose` consults it. */
  rail: LiveRail;
  /** The panel owner, or `undefined` until the instance has built one. */
  panel: { current: PanelOwner | undefined };
  /** Whether either surface is on the screen — the minute hand's one question. */
  surfacesDrawn(): boolean;
}

/** Build the cells for one extension instance. Called once, where the instance's other cells are built. */
export function createSessionSurfaces(): SessionSurfaces {
  const rail = createLiveRail();
  const panel: { current: PanelOwner | undefined } = { current: undefined };
  return {
    rail,
    panel,
    surfacesDrawn: () => panel.current?.isAnySurfaceVisible() ?? false,
  };
}
