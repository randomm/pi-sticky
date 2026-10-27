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
 * wiring that cannot answer (`noNotify`) is answered with silence: an age that stops moving is visible on the
 * screen, and a warning the user cannot see is not worth a throw from inside the catch.
 *
 * One report per failure, remembered across failures rather than across ticks: a clock that throws on every
 * minute says so once for the session rather than putting the same line in the transcript sixty times an
 * hour, and a minute that recovers and breaks again is a new failure worth saying so about again.
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

/**
 * Run one tick, and turn anything it throws into one notice.
 *
 * A function beside the tick rather than a `try` inside `tick()` because the guard is about the *dispatch*
 * — what the interval is allowed to let escape — and `tick()`'s own body is the two rules about a drawn
 * surface and a moved minute, which read better for naming nothing about hosts. It takes the tick rather
 * than a closure so the retry rule stays visible here: nothing between this call and the assignment in
 * `tick()` can record the minute of a frame that was never drawn.
 */
export function containTick(tick: PanelTick, wiring: TickWiring): void {
  try {
    tick.tick();
  } catch {
    // Reported at most once for a failure that repeats: the state is the guard's, and a minute that threw
    // the same way twice has told the user once. Read before the report so a `notify` that itself throws
    // leaves the line owed rather than a fresh one owed every tick.
    if (warned) return;
    warned = true;
    notifiable(wiring)?.notify(FAILED, "warning");
  }
}

/** Whether the current failure has already been reported; cleared by `forgetTickWarning`. */
let warned = false;

/**
 * Forget that a failure was reported, so the next one is reported again.
 *
 * Called at the session boundaries by the owner of the hand (`session-tick.ts`): a new session is a new
 * host, and a warning the user was told in the session they just left must not be held against the one
 * they are in. Silencing is not the point — one line per failure, not one per minute, is.
 */
export function forgetTickWarning(): void {
  warned = false;
}
