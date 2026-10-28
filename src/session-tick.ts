import type { AgeClock } from "./panel-age.ts";
/**
 * The extension's minute hand, owned by one extension instance and started by one session.
 *
 * `PanelTick` (`panel-tick.ts`) is the timer; this is the small piece of *session* ownership around it —
 * the stop-and-start a lifecycle edge performs, and the handle the surfaces are handed so a surface pi
 * removes can say so. Splitting it from `extension.ts` is not decoration: the extension's job is state,
 * drawing and pi's events, and a 300-line file cannot hold all three plus a timer's lifecycle. What stays
 * here is only what has to be read through the extension's live cells, which is why the wiring is built from
 * the cells a caller hands over (`createSessionTick`) rather than from values. Two decisions live on the
 * handle rather than on the tick, because both are facts about *the session* rather than about the minute:
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
import type { TickGuard } from "./panel-tick-guard.ts";
import { createTickGuard } from "./panel-tick-guard.ts";
import { PanelTick } from "./panel-tick.ts";
import type { TickWiring } from "./panel-tick.ts";

/** The handle the surfaces hold: say the hand is no longer wanted, safely, more than once. */
export type TickStop = () => void;

/** How a session's minute hand is built: with *this session's* containment in hand. */
export type MakeTick = (guard: TickGuard) => PanelTick;

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
  #make: MakeTick;
  #drawn: () => boolean;
  #tick: PanelTick | undefined;
  /**
   * This session's report memory — the one copy, and the one its tick was built with.
   *
   * Held here rather than inside `PanelTick` because the memory is a fact about the session: it is opened
   * with the hand and dropped with it. `restart` builds it *before* `#make` so the pair cannot disagree, and
   * `stop` clears it — a hand must never inherit a silence another session earned.
   */
  #guard: TickGuard | undefined;

  constructor(make: MakeTick, drawn: () => boolean) {
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
    // A new session is a new host, so a failure the previous one reported does not speak for this one: the
    // guard is built here rather than cleared at the tick, which cannot tell a first failure from the
    // hundredth minute of the same one. Built *before* the hand and passed into it, because the two are one
    // pair: a tick that built its own would give this session a second memory that `stop()` and `forget()`
    // never reach, and the silence it earned would outlive every boundary.
    this.#guard = createTickGuard();
    if (!DRAWING_MODES.includes(mode)) return;
    this.#tick = this.#make(this.#guard);
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
   *
   * The guard's memory goes with the tick. `stop()` is the one member every edge reaches (`restart` calls
   * it first, `surfaceGone` calls it when neither surface is drawn, `session_shutdown` calls it outright),
   * so clearing here is what guarantees no hand — the next session's or a later one in the same process —
   * inherits a silence this session earned. `restart` then builds the fresh guard, and hands it to the tick.
   */
  stop(): void {
    this.#tick?.stop();
    this.#tick = undefined;
    this.#guard?.forget();
    this.#guard = undefined;
  }
}

/**
 * What the extension hands the minute hand: its live cells, never their values.
 *
 * The five reads of `TickWiring` (`panel-tick.ts`) plus the hand's own condition, all reached through the
 * cells the extension declares — which is the rule the whole extension follows: nothing that outlives a
 * reload may be a value taken before it, and a wiring of values is a timer that asks the session it was
 * built in to redraw. `notify` is asked for here rather than left optional at the call site because a wiring
 * without it can be contained but never *reported*: the guard asks the wiring whether the user can be told,
 * and a wiring that never offers a way to tell them leaves a broken minute silently unfixed.
 */
export interface TickCells {
  /** The extension's `redrawAll`, at whatever context is still live — the one thing the hand *does*. */
  redraw(): void;
  /** Whether either surface is drawn, as the owner that installs them answers it. */
  drawn(): boolean;
  /** How many pins there are; none means neither surface draws and no hand is worth keeping. */
  pinCount(): number;
  /** Whether the live session's ui can be told one line, or has already gone. */
  notify?(message: string, type?: "info" | "warning" | "error"): void;
}

/**
 * The minute hand of one extension instance, wired to its live cells.
 *
 * The one place the wiring and the clock meet: both read the extension's *own* clock — the instant the ages
 * are drawn at and the instant the frame is aged against must not disagree — and both read the surfaces
 * through one cell. Spelled here rather than as a literal in `extension.ts` so the extension carries the
 * cells and this file carries the shape of what a hand is allowed to ask about them.
 *
 * The timer and the handle are built together because they have exactly one contract between them: the wiring
 * the timer reads must be read *at tick time*, through these cells and never captured as values. The guard is
 * *not* built here — `SessionTick.restart` builds one per session and passes it to the factory below, so the
 * hand and the memory that decides whether its failure is told are one pair; a guard built here would be a
 * second one per session, and the session's own `forget()` would reset a memory no tick reads.
 */
export function createSessionTick(cells: TickCells, clock: AgeClock): SessionTick {
  const wiring: TickWiring = {
    pinCount: cells.pinCount,
    panelDrawn: cells.drawn,
    now: clock,
    redraw: cells.redraw,
    notify: cells.notify,
  };
  return new SessionTick((guard) => new PanelTick(wiring, clock, guard), cells.drawn);
}
