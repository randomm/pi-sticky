/**
 * The panel's minute hand: one guarded timer that asks for a redraw while a surface is drawn.
 *
 * A pin's age is drawn, not stored, so the only way a panel the user left open re-ages itself is for
 * something to ask for a frame. That something is this object: a `setInterval` at a whole minute, owned by
 * the extension instance, started when a session starts and cleared at every boundary that could otherwise
 * leave it running against a session that is gone — the same rule the overlay follows (`session_start`,
 * `session_tree`, `session_shutdown`, and each surface's own `dispose`: `RailComponent.dispose` stops the
 * hand that repaints it, and `PanelComponent.dispose` does the same for the overlay). A timer captured
 * before a reload is a handle into a dead session, and the callback it fires reaches the redraw of the
 * session that replaced it — the class of bug AGENTS.md states as never reusing a context.
 *
 * Two rules make it cheap rather than a background repaint:
 *
 * - **Only while a surface is drawn.** `drawn` is the same disjunction the two surfaces already use to
 *   decide who owns the pins — the terminal's width, the user's flag and the pin count, through
 *   `panelIsVisible`/`panelHasRoom`. No panel and no rail means no timer, so a print or JSON session, an
 *   rpc session with nothing pinned, or a user who hid the panel at a narrow terminal never pays for a
 *   callback. It is deliberately *not* `PanelOwner.isVisible()` alone: that reads the persisted flag, and a
 *   rail over a hidden panel is a drawn surface the flag knows nothing about.
 * - **Only when a drawn byte actually moved.** The minute is read through `minute`, which advances with the
 *   clock, and a tick whose minute did not advance installs nothing and requests no frame. `RailGuard`'s key
 *   and `PanelComponent`'s frame cache both compare by value, so a tick that changed nothing costs a
 *   comparison; a tick that changed the age from `3m` to `4m` costs one widget install and one frame.
 *
 * The interval is never started twice: `start` clears what it was holding first, which is what makes a
 * `session_start` on a live session (a reload) a restart rather than a second timer over the same session.
 */

import type { AgeClock } from "./panel-age.ts";

import { panelHasRoom, panelIsVisible } from "./panel-geometry.ts";

/** How often the age is asked whether it moved: a whole minute, the coarsest bucket the age is drawn at. */
export const TICK_INTERVAL_MS = 60_000;

/** What the extension gives the tick: the two questions it asks and the one thing it does. */
export interface TickWiring {
  /** The width pi-tui last stated, in the same terms both surfaces measure the boundary against. */
  columns(): number;
  /** The user's panel flag and the pins, exactly as the rail's handoff reads them. */
  shown(): boolean;
  pinCount(): number;
  /** The instant the ages are drawn against, read at tick time; the extension's own clock. */
  now(): string;
  /** Ask both surfaces to draw: the extension's own `redrawAll`, which reaches the rail and the frame. */
  redraw(): void;
}

/** Whether a minute hand is needed at all: the panel has room *or* the rail is the only surface left. */
function surfaceDrawn(columns: number, shown: boolean, pinCount: number): boolean {
  if (pinCount <= 0) return false;
  return panelIsVisible(columns, shown, pinCount) || !panelHasRoom(columns);
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
   * Called from `session_start`, and from nowhere else: `session_tree` and `session_shutdown` stop it, and
   * the next `session_start` starts the one that belongs to the session now on screen. Idempotent — a
   * reload fires `session_start` again over a session that already had a timer, and a second interval on
   * the same session would ask for two redraws a minute.
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
   * Safe when nothing is running — every lifecycle edge calls it, including the ones where the session never
   * started a timer. The bucket goes with the timer: the next session's first tick is that session's first
   * frame, and a minute left over from the branch the user just left would make it draw nothing.
   */
  stop(): void {
    if (this.#handle !== undefined) clearInterval(this.#handle);
    this.#handle = undefined;
    this.#minute = undefined;
  }

  /** Whether a surface of this session's is on the screen right now — the same terms both surfaces use. */
  #drawn(): boolean {
    const wiring = this.#wiring;
    return surfaceDrawn(wiring.columns(), wiring.shown(), wiring.pinCount());
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
