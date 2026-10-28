/**
 * The two surfaces a session draws, reduced to what a minute hand may ask about them.
 *
 * `PanelTick` runs while *a surface is drawn*, and only `PanelOwner` knows whether it published an overlay
 * or wrote a rail. It cannot hand that over as a boolean, though: the hand asks between frames — after a
 * toggle, a resize, a pin, a dismissal — so an answer taken once is an answer about the frame the owner was
 * built in, which is the branch the user left. A projection of readers is what keeps every answer *now*.
 *
 * It lives beside the hand rather than in `panel.ts` because the halves of the rule have different owners:
 * the *inputs* are the owner's (a record, a mode, a view, all read through its wiring) and the *rule* over
 * them is the tick's — the panel, or the rail when the panel does not hold the pins, and never a width read
 * from a holder that guesses (`panel-width.ts`). Putting the rule in the owner would make the panel file
 * answer a question only the timer asks, and leave one decision split across two files.
 */
import type { PanelWiring } from "./panel-deps.ts";
import { railDrawn } from "./panel-tick.ts";
import type { TickSurfaces } from "./panel-tick.ts";

/**
 * Whether either surface the owner installs is on screen — the hand's one question.
 *
 * `panelVisible` is the owner's own verdict (`PanelOwner.isVisible`: room, the user's flag, pins, and an
 * overlay that was actually *published*, which is what a mode with no overlay never has) and not a
 * re-derivation of it here. The mode comes from the live context through the wiring, and the pins from the
 * live view, for the reason the hand's own wiring reads them the same way: nothing that outlives a reload
 * may be a value taken before it.
 */
export function ownerHasSurface(panel: { isVisible(): boolean }, wiring: PanelWiring): boolean {
  const surfaces: TickSurfaces = {
    panelVisible: () => panel.isVisible(),
    rpc: () => wiring.rpc(),
    pinCount: () => wiring.deps.getView().pins.length,
  };
  return surfaces.panelVisible() || railDrawn(surfaces);
}
