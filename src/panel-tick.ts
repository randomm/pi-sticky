/**
 * The panel's minute hand: one guarded timer that asks for a redraw while a surface is drawn.
 *
 * A pin's age is drawn, not stored, so the only way a panel the user left open re-ages itself is for
 * something to ask for a frame. That something is this object: a `setInterval` at a whole minute, owned by
 * the extension instance, started when a session starts and cleared at every boundary that could otherwise
 * leave it running against a session that is gone — the same rule the overlay follows (`session_start`,
 * `session_tree`, `session_shutdown`, and each surface's own `dispose`, which *reports* itself: pi disposes
 * a rail component every time it replaces that same widget, so a surface's teardown asks the hand whether
 * either surface is still drawn rather than stopping it outright). A timer captured before a reload is a
 * handle into a dead session, and the callback it fires reaches the redraw of the session that replaced it
 * — the class of bug AGENTS.md states as never reusing a context.
 *
 * Two rules make it cheap rather than a background repaint:
 *
 * - **Only while a surface is drawn** (`surfaceDrawn`). The owner that publishes the overlay and installs
 *   the rail answers for both, so the hand's condition cannot drift from what the user is shown. It is
 *   deliberately not a width read straight from `TerminalWidth`: an unstated terminal is *guessed* wide so
 *   the panel stays reachable, and a predicate built on the guess would run a timer for a rail no host ever
 *   installed — an `rpc` session, or a hand-built lifecycle context, both look wide and draw no overlay.
 * - **Only when a drawn byte actually moved.** The minute is read through `minute`, which advances with the
 *   clock, and a tick whose minute did not advance installs nothing and requests no frame. `RailGuard`'s key
 *   and `PanelComponent`'s frame cache both compare by value, so a tick that changed nothing costs a
 *   comparison; a tick that changed the age from `3m` to `4m` costs one widget install and one frame.
 *
 * The interval is never started twice: `start` clears what it was holding first, which is what makes a
 * `session_start` on a live session (a reload) a restart rather than a second timer over the same session.
 */

import type { AgeClock } from "./panel-age.ts";

/** How often the age is asked whether it moved: a whole minute, the coarsest bucket the age is drawn at. */
export const TICK_INTERVAL_MS = 60_000;

/** What the extension gives the tick: the two questions it asks and the one thing it does. */
export interface TickWiring {
  /** How many pins there are — no pins means neither surface draws, and no hand is worth keeping. */
  pinCount(): number;
  /** Whether the panel or the rail is on the screen, as the owner that installs them answers it. */
  panelDrawn(): boolean;
  /** The instant the ages are drawn against, read at tick time; the extension's own clock. */
  now(): string;
  /** Ask both surfaces to draw: the extension's own `redrawAll`, which reaches the rail and the frame. */
  redraw(): void;
}

/**
 * The two surfaces, as the object that installs them describes them — the overlay it published and the
 * rail it wrote. `PanelOwner` hands these over rather than answering here: it holds the record that says
 * whether an overlay was ever opened, and the mode is read from the live session, neither of which this
 * module can see.
 */
export interface TickSurfaces {
  /** The panel's own verdict: room, the user's flag, pins, and an overlay that was actually opened. */
  panelVisible(): boolean;
  /** Whether the session runs in `rpc`, where the rail is a string array and nothing competes with it. */
  rpc(): boolean;
  /** The pins, as both surfaces read them. */
  pinCount(): number;
}

/**
 * Whether the rail is on screen, in the terms `drawPins` actually draws in.
 *
 * `drawPins` installs the rail in `tui` when the panel does not own the pins, and unconditionally in `rpc`;
 * those two answers are what a caller that has to know about the rail — the minute's hand, chiefly — has to
 * be given. Spelled here rather than derived from a width by that caller because the width is a *guess*
 * when pi-tui has never stated one (`panel-width.ts` guesses wide so the panel stays reachable), and a hand
 * that read the guess alone would keep a timer running for a rail no host ever installed.
 */
export function railDrawn(
  surfaces: Pick<TickSurfaces, "rpc" | "pinCount" | "panelVisible">,
): boolean {
  if (surfaces.pinCount() === 0) return false;
  return surfaces.rpc() || !surfaces.panelVisible();
}

/**
 * Whether either of the two surfaces is on the screen: the overlay that was published, or the rail that
 * was written.
 *
 * The one question the minute's hand asks. Composed here, from the owner's two verdicts, rather than left
 * to the caller to join: a hand that asked only the panel would stop re-aging a surface the user is looking
 * at, which is the failure this module's header names, and a hand that asked only the width would ask a
 * number the host never stated.
 */
export function surfaceDrawn(surfaces: TickSurfaces): boolean {
  return surfaces.panelVisible() || railDrawn(surfaces);
}

export class PanelTick {
  #wiring: TickWiring;
  #clock: AgeClock;
  #handle: ReturnType<typeof setInterval> | undefined;
  /** The bucket the last tick drew; `undefined` until the first tick, so the first one always draws. */
  #minute: number | undefined;

  constructor(wiring: TickWiring, clock: AgeClock) {
    this.#wiring = wiring;
    this.#clock = clock;
  }

  /**
   * Begin keeping time for this session, replacing any timer this instance already held.
   *
   * Called by the session boundaries, and from nowhere else: a surface's own teardown may only stop a hand.
   * Idempotent — a reload fires `session_start` again over a session that already had a timer, and a second
   * interval on the same session would ask for two redraws a minute.
   */
  start(): void {
    this.stop();
    // Bound, not passed bare: `setInterval` invokes its callback detached, and `this` is what the tick reads
    // its wiring through.
    this.#handle = setInterval(() => this.tick(), TICK_INTERVAL_MS);
  }

  /**
   * Stop keeping time and forget the last minute drawn.
   *
   * Safe when nothing was running — every lifecycle edge calls it, including the ones where the session never
   * started a timer. The bucket goes with the timer: the next session's first tick is that session's first
   * frame, and a minute left over from the branch the user just left would make it draw nothing.
   */
  stop(): void {
    if (this.#handle !== undefined) clearInterval(this.#handle);
    this.#handle = undefined;
    this.#minute = undefined;
  }

  /** Whether a surface of this session's is on the screen right now, asked of the owner that installs them. */
  #drawn(): boolean {
    const wiring = this.#wiring;
    if (wiring.pinCount() <= 0) return false;
    return wiring.panelDrawn();
  }

  /**
   * One minute's work, and only the work a minute can cause: nothing while both surfaces are idle, and
   * nothing when the age the frame draws has not moved.
   *
   * Read as the two rules the module header states. The first is asked of the live view every tick rather
   * than remembered from the last one, because the moment the answer changes — a pin arrives, the panel is
   * hidden, the terminal narrows past the boundary — is the moment a timer should start or stop existing,
   * and a tick is a cheap place to notice.
   *
   * A clock that cannot be read is the third case: no age can be drawn from an unusable stamp, so the tick
   * owes no frame — and it must not *remember* the unreadable minute either, which is why the `NaN` test
   * stays beside the equality rather than being hoisted above `#drawn()`. Hoisting it changes behaviour when
   * the wiring's `now` and the tick's `clock` are different sources (which no extension does, and a test
   * can): the drawn check would be skipped and the frame owed for a surface that is not on screen.
   */
  tick(): void {
    if (!this.#drawn()) return;
    const minute = Math.floor(Date.parse(this.#clock()) / TICK_INTERVAL_MS);
    if (Number.isNaN(minute) || minute === this.#minute) return;
    this.#minute = minute;
    this.#wiring.redraw();
  }
}
