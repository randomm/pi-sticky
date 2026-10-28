/**
 * The minute's hand, contained: what a tick is allowed to cost the host when it throws.
 *
 * `PanelTick` (`panel-tick.ts`) runs detached. `setInterval` invokes its callback with no caller above it,
 * so anything that escaped — a `panelDrawn` reading a context whose session is gone, a clock that throws,
 * a `redraw` reaching a widget whose host has torn down — would be an uncaught exception in pi's own process
 * rather than a minute that did not draw. Nothing about a pin's age is worth that: the safe answer is the
 * one `containKey` (`panel-input.ts`) gives a key that fails, a minute that did nothing.
 *
 * The rule that makes "did nothing" recoverable rather than silent: **the failed minute is not recorded.**
 * `PanelTick.tick()` records the minute it drew *before* it asks for the frame, so a throw leaves the bucket
 * behind and the next tick finds the minute moved and draws again. Containment must therefore swallow the
 * throw and stop, never redraw from the catch — a redraw there would retry the throwing host inside the same
 * tick, and a host that throws on every frame would throw once per tick forever with the age never moving.
 *
 * The report is best-effort and exactly one line. There is no ui to hand it to: the tick's wiring is read at
 * tick time and `notify` belongs to `PanelDeps` (`panel-deps.ts`), which the hand is deliberately not given —
 * it would be a second way for a dead session's context to be reached. So the guard *asks* the wiring, and a
 * wiring whose `notify` is absent is answered with silence: an age that stops moving is visible on the
 * screen, and a warning the user cannot see is not worth a throw from inside the catch.
 *
 * One report per failure, remembered across failures rather than across ticks: a clock that throws on every
 * minute says so once for the session rather than putting the same line in the transcript sixty times an
 * hour, and a minute that recovers and breaks again is a new failure worth saying so about again.
 *
 * **The memory belongs to one session, never to the module.** `SessionTick` (`session-tick.ts`) owns one
 * guard per session, and `restart()` throws the guard away at the boundary: a module-level flag would let
 * one session's broken clock hold its silence over every other session in the process — two extension
 * instances, or the session after a reload, none of them a host that failed. The `catch` is the other half
 * of the containment: it contains *its own report* as well, so a `notify` that throws cannot reach pi's
 * process and cannot leave the guard holding a line the user was never told.
 */
import type { PanelTick } from "./panel-tick.ts";
import type { TickWiring } from "./panel-tick.ts";

/** What the guard says when a minute could not be drawn and a ui could be reached. */
const FAILED = "The pins panel could not be redrawn; it will try again next minute.";

/** The shape of a wiring that can be reported through: `notify` present, and callable. */
interface Notifiable extends TickWiring {
  notify(message: string, type?: "info" | "warning" | "error"): void;
}

/** Whether this wiring can be reported through, asked rather than assumed: `notify` is optional. */
function notifiable(wiring: TickWiring): Notifiable | undefined {
  return typeof wiring.notify === "function" ? (wiring as Notifiable) : undefined;
}

/** What one session's guard does: contain a tick, and forget that it ever reported. */
export interface TickGuard {
  /** Run one tick of `tick`, and turn anything it throws into at most one notice for this session. */
  contain(tick: PanelTick, wiring: TickWiring): void;
  /** Forget the report this guard made, so the next failure is reported again. */
  forget(): void;
}

/**
 * Build the containment for **one** session's minute hand.
 *
 * A factory rather than a pair of functions because the one piece of state — has this session's failure
 * been told — must have exactly one owner, and the only object that knows where a session's boundaries are
 * is `SessionTick`, which builds a guard in `restart()` and drops the previous one there.
 *
 * `contain` is a function beside the tick rather than a `try` inside `tick()` because the guard is about the
 * *dispatch* — what the interval is allowed to let escape — and `tick()`'s own body is the two rules about a
 * drawn surface and a moved minute, which read better for naming nothing about hosts. It takes the tick
 * rather than a closure so the retry rule stays visible here: nothing between this call and the assignment
 * in `tick()` can record the minute of a frame that was never drawn.
 */
export function createTickGuard(): TickGuard {
  let warned = false;
  return {
    contain(tick: PanelTick, wiring: TickWiring): void {
      try {
        tick.tick();
      } catch {
        // Reported at most once for a failure that repeats, for *this* session: a minute that threw the same
        // way twice has told the user once. Set before the report, so a `notify` that itself throws cannot
        // put the same line in the transcript every minute — the containment of the report is what the inner
        // `try` is for, and it stops there: a warning the user cannot see is not worth a throw.
        if (warned) return;
        warned = true;
        try {
          notifiable(wiring)?.notify(FAILED, "warning");
        } catch {
          // The report failed, not the minute: nothing left to do but stop, which is what the guard is.
        }
      }
    },
    forget(): void {
      warned = false;
    },
  };
}
