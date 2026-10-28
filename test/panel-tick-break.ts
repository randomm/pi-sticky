/**
 * A session whose host refuses every rail frame after the first one, and the hand the extension armed for it.
 *
 * `panel-tick-lifecycle.test.ts` asks what a session does when a minute could not be drawn, and the only
 * honest way to ask it is to break the real thing: the extension's own `createStickyExtension`, its own
 * `session_start`, and the `setInterval` callback that watch captured. A case that built a `PanelTick` and
 * handed it a guard would assert that a guard can be built — not that a session has exactly one, which is
 * the thing `SessionTick` owns.
 *
 * The failure is armed *after* the first frame, so the minute the session drew cleanly is not the minute
 * under test: the report is owed by a minute that had already drawn once and then could not. The throw sits
 * on `setWidget` rather than on the tick's own `redraw` because the extension's `redrawAll` reaches it
 * through `drawRail` → `drawPins` — the frame a real minute asks for, with the panel's owner, the rail guard
 * and the recorder all in the way of it.
 *
 * It lives beside `panel-tick-watch.ts` for the same reason the watch does: a second copy of this boot is
 * how two files end up breaking a session in two different ways and both passing.
 */
import "./env-clear.ts";

import { DEFAULT_CONFIG } from "../src/config.ts";
import { createStickyExtension } from "../src/extension.ts";
import { LATER } from "./fixtures.ts";
import { PINNED, flush } from "./panel-lifecycle-fixture.ts";
import type { TimerRecord } from "./panel-tick-watch.ts";
import { countingContext, later, liveTimers } from "./panel-tick-watch.ts";
import { stubApi } from "./wiring-stubs.ts";

/** What `breakingSession` hands back: the report the session made, and the means of breaking the next one. */
export interface BreakingSession {
  /** Every line the session's ui was told, in order. */
  notes(): string[];
  /** Move the clock the extension ages against, by whole minutes from the boot instant. */
  at(minutes: number): void;
  /** The hand the session on screen owns — the one `SessionTick` armed, and the only thing a case fires. */
  hand(): TimerRecord;
  /** Make the host refuse every frame from now on. */
  fail(): void;
  /**
   * Drop the session and start another over the same entries, leaving the host broken.
   *
   * `session_shutdown` fires first because that is the boundary the hand's memory is cleared at, and the
   * recorder is emptied across it: a report the *previous* session made must not be counted as this one's,
   * which is the half a guard that outlived its session would otherwise pass off as correct.
   */
  boundary(event: string, payload: unknown): Promise<void>;
}

/**
 * Boot a pinned session whose rail frames throw from here on, and take the hand it armed.
 *
 * `timers` is the array the *caller's* `watchTimers()` captured — this fixture only reads the live hand out
 * of it and never installs a watch of its own, so the case that owns the `afterEach(stopWatching)` stays the
 * only one that touches the scheduler.
 */
export async function breakingSession(
  timers: TimerRecord[],
  started: string = LATER,
): Promise<BreakingSession> {
  let clock = started;
  let broken = false;
  const stub = stubApi();
  createStickyExtension(DEFAULT_CONFIG, () => clock)(stub.api);
  const ctx = countingContext(PINNED, {
    setWidget() {
      if (broken) throw new Error("host refused the rail");
    },
  } as never);
  stub.emit("session_start", { reason: "startup" }, ctx);
  await flush();
  const first = liveTimers(timers).at(-1);
  if (!first) throw new Error("the session has no hand to break");
  // The first minute draws, and it draws well: the report the cases assert is owed by a minute that failed,
  // not by a session that never drew at all.
  first.fn();
  return {
    notes: () => ctx.recorder.notifications.map((note) => note.message),
    at: (minutes: number) => {
      clock = later(started, minutes);
    },
    fail: () => {
      broken = true;
    },
    hand: () => {
      const hand = liveTimers(timers).at(-1);
      if (!hand) throw new Error("the session has no live hand");
      return hand;
    },
    boundary: async (event: string, payload: unknown) => {
      stub.emit("session_shutdown", { reason: "quit" }, ctx);
      ctx.recorder.notifications.length = 0;
      broken = false;
      stub.emit(event, payload, ctx);
      await flush();
      broken = true;
    },
  };
}
