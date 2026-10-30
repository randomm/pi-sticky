/**
 * Mode cells in the three states a `RailGuard` key can tell apart, built through the cell's own verbs.
 *
 * The guard's frame term (`panel-rail.ts`) reads the cell, so a case that pins that term has to *move* it,
 * and a hand-built `{ mode }` stub would let such a case pass on a mode the cell could never answer — an
 * `open` with no earned open behind it, say, which is a state `panel-mode.ts` cannot be put into at all. So
 * these builders walk the cell with `settle`/`autoOpen`/`endEarnedOpen` exactly as the extension does, and
 * both of the files that drive the frame term take their cells from here rather than each inventing its own.
 */
import type { PanelMode, PanelModeState } from "../src/panel-mode.ts";
import { createPanelMode } from "../src/panel-mode.ts";

/**
 * A cell in one named frame.
 *
 * `settle` alone cannot produce the `open` or the boundary's `hidden` — it keeps an earned open, it never
 * earns or forgets one — which is why each state is reached by the verbs that actually put a cell there:
 * an auto-show over the user's own hide for the frame, and a show/close pair with nothing earned for the
 * panel a session leaves behind (`forgetEarnedOpen` lands in the same state and is the one `extension.ts`
 * calls; `settle` is the pair the cell exposes publicly).
 */
export function cell(mode: PanelMode): PanelModeState {
  const c = createPanelMode({ panel: "peek" });
  c.settle(false); // the user's `/pins hide`, which is where an auto-show starts
  if (mode === "hidden") {
    c.settle(true); // shown, and resting in its configured frame: no earned open at all
    c.settle(false); // …and the user closed it again, which is what `forgetEarnedOpen` also leaves
    return c;
  }
  c.autoOpen("autoshow"); // …and the blocker that earned the full frame over the hide
  return c;
}

/** The peek a frame ends in: that same auto-show, after the interaction that earned it was over. */
export const PEEK = (): PanelModeState => {
  const c = cell("open");
  c.endEarnedOpen();
  return c;
};
