/**
 * The extension's minute hand, owned by one extension instance and started by one session.
 *
 * `PanelTick` (`panel-tick.ts`) is the timer; this is the small piece of *session* ownership around it —
 * the stop-and-start a lifecycle edge performs, and the handle the surfaces are handed so a surface pi
 * removes can say so. Splitting it from `extension.ts` is not decoration: the extension's job is state,
 * drawing and pi's events, and a 300-line file cannot hold all three plus a timer's lifecycle. What stays
 * here is only what has to be read through the extension's live cells, which is why the wiring is passed in
 * rather than built here. Two decisions live on the handle rather than on the tick, because both are facts
 * about *the session* rather than about the minute:
 *
 * - **Which modes get a hand at all** (`restart`). `print` and `json` draw nothing and `rpc` draws no
 *   overlay, so a minute callback there is a cost with no drawn byte at the other end of it. It cannot be
 *   inferred from the wiring's width either: an unstated terminal is guessed *wide* on purpose
 *   (`panel-width.ts`), so a width-only predicate would happily start a timer in a print run.
 * - **Which surfaces are still on screen** (`surfaceGone`). A hand belongs to a drawn surface, and the only
 *   witness to a surface going away without a session boundary is that surface's own `dispose`. It stops
 *   the hand when the owner says neither surface is drawn, and never starts one: a teardown that could
 *   rebuild a hand would re-arm the clock the surface just asked to stop.
 */
import type { AgeClock } from "./panel-age.ts";
import { PanelTick } from "./panel-tick.ts";
import type { TickWiring } from "./panel-tick.ts";

/** The handle the surfaces hold: say the hand is no longer wanted, safely, more than once. */
export type TickStop = () => void;

/**
 * The modes that draw a surface the hand repaints.
 *
 * `print` and `json` have no UI at all and `rpc` has no overlay, so a minute callback there asks for a
 * frame of nothing. Spelled as a list rather than inferred from the wiring's width because a hand-built or
 * unstated terminal is guessed *wide* on purpose (`panel-width.ts`) — a predicate that asked only the width
 * would start a timer in a mode that cannot draw one.
 */
const DRAWING_MODES: readonly string[] = ["tui", "rpc"];

/**
 * The minute hand of the session currently on screen.
 *
 * It holds a `PanelTick` rather than being one because the tick belongs to *a* session, not to this
 * extension instance: every lifecycle edge that drops the session's other state (`session_tree`,
 * `session_shutdown`) stops it, and the next `session_start` hands out a fresh one. Its wiring is built by
 * the extension from live cells rather than from values, which is the same rule the overlay follows —
 * nothing that outlives a reload may be a value taken before it. Never started at construction: a session
 * starts it, and a session that never came up (a `print` run) never has one.
 */
export class SessionTick {
  #make: () => PanelTick;
  #drawn: () => boolean;
  #tick: PanelTick | undefined;

  constructor(make: () => PanelTick, drawn: () => boolean) {
    this.#make = make;
    this.#drawn = drawn;
  }

  /**
   * Begin keeping time for the session now on screen, replacing whatever this instance was holding.
   *
   * Called by `session_start` and `session_tree`, through `drawSession`, and from nowhere else — a surface's
   * own teardown may only *stop* a hand (`surfaceGone`). A reload re-fires `session_start` over a session
   * that already had a timer, so the tick stopped here is the old session's and the one started is the new
   * one's — which is why a fresh instance is built rather than the held one restarted: a tick whose wiring
   * closed over the previous session's state has no correct thing left to redraw.
   *
   * `mode` decides whether a hand is started at all: a session in a mode with no surface to re-age gets
   * none. It is an argument rather than a closed-over value for the same reason as the wiring — the mode
   * belongs to the context of the event that asked, not to the moment this handle was built.
   */
  restart(mode: string): void {
    this.stop();
    if (!DRAWING_MODES.includes(mode)) return;
    this.#tick = this.#make();
    this.#tick.start();
  }

  /**
   * A surface of this session's was torn down, and says so.
   *
   * Reported rather than obeyed as a stop, because the reporter is one surface and the hand belongs to
   * both: pi disposes a rail component every time it *replaces* that same widget, so a dispose that stopped
   * the hand outright would stop the minute on the very tick whose job was to re-age this rail. What the
   * report does is ask the question again of the owner that installs both surfaces, and stop only when it
   * says neither one is drawn — which is the case a component's teardown is the only witness to, since
   * `session_shutdown` clears the widget without asking the extension.
   *
   * It never *starts* a hand: the boundaries are what hand one out, and a teardown that could rebuild one
   * would re-arm the clock the surface just asked to stop (the last dismissal empties the view, and the
   * widget clear that follows would put a timer back over a screen that draws nothing).
   */
  surfaceGone(): void {
    if (!this.#drawn()) this.stop();
  }

  /**
   * Stop keeping time. Safe when nothing was running — every lifecycle edge calls it, including the ones
   * where the session never started a timer.
   */
  stop(): void {
    this.#tick?.stop();
    this.#tick = undefined;
  }
}

/**
 * Build the minute hand of one session: the timer, and the handle that starts, stops and restarts it.
 *
 * The two are constructed together because they have exactly one contract between them — the wiring the
 * timer reads must be read *at tick time*, through the caller's live cells, and never captured as values.
 * A tick built from values is a tick that outlives the session whose width, flag and pins it memorised, and
 * the callback it fires asks the wrong session to redraw. So the wiring is a parameter of the one function
 * that builds both halves, and the extension cannot accidentally supply one and not the other. `drawn` is a
 * parameter for the same reason: it is the extension's own disjunction over the two surfaces, read when the
 * handle asks and never remembered.
 */
export function createPanelTick(
  wiring: TickWiring,
  clock: AgeClock,
  drawn: () => boolean,
): SessionTick {
  return new SessionTick(() => new PanelTick(wiring, clock), drawn);
}
