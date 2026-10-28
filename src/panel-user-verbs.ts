/**
 * The panel's user verbs: show, hide, toggle and the focus shortcut, over the owner's wiring.
 *
 * `PanelOwner` is the overlay's lifecycle; these four are what the `/pins` commands and the two shortcuts
 * reach, and they move no overlay at all — they move the mode cell, record the user's choice through the
 * deps, and tell the component about the keyboard. Split from the owner for that reason: the record, the
 * open call and the close are one job, and the verbs are another that happens to be asked of the same
 * object.
 *
 * Two rules the verbs own, and the reason neither is a bare call into the mode cell:
 *
 * - **A refusal still records the user's intent.** `/pins show` is an explicit request, so the flag moves
 *   and the next `session_start` honours the choice even in a terminal that cannot draw it.
 *   `focusFromShortcut` answers the same refusal the other way, by design: focusing is not a statement about
 *   whether the panel should *stay* open, so a refusal there changes nothing at all.
 * - **The focus key's frame is the point of the key.** A move that only *shows* the panel rests it where the
 *   operator's configuration says — under `PI_STICKY_PANEL=peek`, the three-row peek — and a focused peek
 *   answers no key: no bar, no `d`, an `Enter` that would put a reply marker beside a list nothing is
 *   selected in. So the cell is asked for the outright earned open, `autoOpen`, and only then does the
 *   component take the keyboard. The earned open ends the way an auto-show's does (`panel-mode.ts`).
 *
 * `refresh()` is asked for after `autoOpen` and not left to the extension's own setters: a rail still
 * standing over the pins the panel has just taken is the pins drawn twice.
 */
import type { HostContext } from "./context.ts";
import type { PanelComponent } from "./panel-component.ts";
import type { PanelWiring } from "./panel-deps.ts";
import { judgeColumns } from "./panel-geometry.ts";
import { refusalToShow } from "./panel-refusals.ts";

/**
 * What the four verbs need of the owner: its wiring, its component, and the way to settle both surfaces.
 *
 * `refresh()` is a member rather than the wiring's own `redrawRail` because the verbs that move the cell
 * also move what the *component* draws, and only the owner can tell the two surfaces about both.
 */
export interface PanelVerbCells {
  wiring: PanelWiring;
  /** The open panel's component, or `undefined` when none is drawn. */
  component(): PanelComponent | undefined;
  /** Tell the component the view changed and ask for the rail to be reconsidered. */
  refresh(): void;
}

/**
 * Show the panel as the user's choice: say so once at a dead end, and record the entry either way.
 *
 * Takes the context projection rather than pi's whole command context: all a refusal needs is the `ui` to
 * notify, and a caller holding a command context satisfies the projection anyway. The width is the owner's
 * own reading, so the refusal and the overlay's `visible()` cannot disagree about the terminal.
 */
export function showPanel(cells: PanelVerbCells, ctx: HostContext | undefined): void {
  refuse(cells, ctx);
  cells.wiring.deps.recordPanelShown(true);
}

/** Hide the panel. Silent — a hide has no dead end to warn about — and always records. */
export function hidePanel(cells: PanelVerbCells): void {
  cells.wiring.deps.recordPanelShown(false);
  cells.component()?.unfocus();
}

/** Whichever way a toggle lands it was the user's choice, so it is recorded either way. */
export function togglePanel(cells: PanelVerbCells, ctx: HostContext | undefined): void {
  if (cells.wiring.deps.panelMode().shown()) hidePanel(cells);
  else showPanel(cells, ctx);
}

/**
 * Put the panel in the open frame and give it the keyboard, recording nothing: reading a pin is not a
 * preference about whether the panel stays open.
 *
 * The refusal is checked *before* the cell moves, so a shortcut that cannot be honoured leaves the panel
 * exactly as it was — the half of the rule `showPanel` does the opposite of.
 */
export function focusFromShortcut(cells: PanelVerbCells, ctx: HostContext | undefined): void {
  if (refuse(cells, ctx)) return;
  cells.wiring.deps.panelMode().autoOpen();
  cells.refresh();
  cells.component()?.focus();
}

/**
 * Tell the user once that this terminal cannot draw the panel, when that is the answer.
 *
 * One line for the two verbs that ask, so they cannot drift to two different refusals. It reports whether it
 * spoke, which is what lets `focusFromShortcut` stop and `showPanel` carry on and record anyway.
 */
function refuse(cells: PanelVerbCells, ctx: HostContext | undefined): boolean {
  const refusal = refusalToShow(
    judgeColumns(cells.wiring.terminal.status()),
    cells.wiring.deps.getView(),
  );
  if (refusal === undefined) return false;
  ctx?.ui.notify(refusal, "warning");
  return true;
}
