/**
 * The extension's minute hand, owned by one extension instance and started by one session.
 *
 * `PanelTick` (`panel-tick.ts`) is the timer; this is the small piece of *session* ownership around it —
 * the stop-and-start that a lifecycle edge performs, and the handle the surfaces are handed so a rail pi
 * removes can stop the hand that repaints it. Splitting it from `extension.ts` is not decoration: the
 * extension's job is state, drawing and pi's events, and a 300-line file cannot hold all three plus a
 * timer's lifecycle. What stays here is only what has to be read through the extension's live cells, which
 * is why the wiring is passed in rather than built here.
 */
import type { AgeClock } from "./panel-age.ts";
import { PanelTick } from "./panel-tick.ts";
import type { TickWiring } from "./panel-tick.ts";

/** The handle the surfaces hold: stop the minute hand that repaints them, safely, more than once. */
export type TickStop = () => void;

/**
 * The minute hand of the session currently on screen.
 *
 * It holds a `PanelTick` rather than being one because the tick belongs to *a* session, not to this
 * extension instance: every lifecycle edge that drops the session's other state (`session_tree`,
 * `session_shutdown`) stops it, and the next `session_start` hands out a fresh one. Its wiring is built by
 * the extension from live cells rather than from values, which is the same rule the overlay follows —
 * nothing that outlives a reload may be a value taken before it. Never started at construction: a session
 * starts it, and a session that never came up (a `print` run, an `rpc` one) never has one.
 */
export class SessionTick {
  #make: () => PanelTick;
  #tick: PanelTick | undefined;

  constructor(make: () => PanelTick) {
    this.#make = make;
  }

  /**
   * Begin keeping time for the session now on screen, replacing whatever this instance was holding.
   *
   * Called from `session_start`, and from nowhere else. A reload re-fires `session_start` over a session
   * that already had a timer, so the tick stopped here is the old session's and the one started is the new
   * one's — which is why a fresh instance is built rather than the held one restarted: a tick whose wiring
   * closed over the previous session's state has no correct thing left to redraw.
   */
  restart(): void {
    this.stop();
    this.#tick = this.#make();
    this.#tick.start();
  }

  /**
   * Stop keeping time. Safe when nothing was running — every lifecycle edge calls it, including the ones
   * where the session never started a timer, and the rail's `dispose` calls it for a surface pi removed.
   */
  stop(): void {
    this.#tick?.stop();
    this.#tick = undefined;
  }
}

/**
 * Build the minute hand of one session: the timer, and the handle that stops and restarts it.
 *
 * The two are constructed together because they have exactly one contract between them — the wiring the
 * timer reads must be read *at tick time*, through the caller's live cells, and never captured as values.
 * A tick built from values is a tick that outlives the session whose width, flag and pins it memorised, and
 * the callback it fires asks the wrong session to redraw. So the wiring is a parameter of the one function
 * that builds both halves, and the extension cannot accidentally supply one and not the other.
 */
export function createPanelTick(wiring: TickWiring, clock: AgeClock): SessionTick {
  return new SessionTick(() => new PanelTick(wiring, clock));
}
