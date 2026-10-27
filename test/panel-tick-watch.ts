/**
 * The watched scheduler and the counting recorder the minute-hand lifecycle file needs.
 *
 * `panel-tick-lifecycle.test.ts` drives the hand through the extension's own session handlers, and two of
 * its cases cannot be done with the plain harness: a session's ownership of its `setInterval` is only
 * observable if the interval is *captured* rather than scheduled, and a rail re-aging is only observable as
 * a widget key being *written* — which the protected recorder does not count (see `recording-ui-extra.ts`).
 *
 * Both are fixtures rather than assertions, and they live here for the same reason `panel-tick-hand.ts`
 * holds the hand: a second copy would let two files watch the timer differently and pass anyway.
 */
import type { PanelContext } from "./panel-lifecycle-fixture.ts";
import { piContext } from "./pi-context.ts";
import { countingRecorder } from "./recording-ui-extra.ts";
import type { CountingRecorder } from "./recording-ui-extra.ts";
import type { RecordingUi } from "./recording-ui.ts";

/** One interval the suite has seen: the callback it was handed, the period, and whether it was cleared. */
export interface TimerRecord {
  fn: () => void;
  ms: number;
  cleared: boolean;
}

const realSetInterval = globalThis.setInterval;
const realClearInterval = globalThis.clearInterval;

/**
 * Replace the scheduler so an interval is captured and never armed, and report what was captured.
 *
 * Never scheduling is the point: a tick that fired during a test would ask for a frame the test is not
 * measuring, and the subject is the handle's lifetime, not the callback's work. The caller keeps the array,
 * so two cases in one file can watch independently, and `stopWatching()` restores the real scheduler for
 * every other file's `flush()` and settle loops.
 */
export function watchTimers(): TimerRecord[] {
  const seen: TimerRecord[] = [];
  globalThis.setInterval = ((fn: () => void, ms: number) => {
    const record: TimerRecord = { fn, ms, cleared: false };
    seen.push(record);
    return record as unknown as ReturnType<typeof setInterval>;
  }) as unknown as typeof setInterval;
  globalThis.clearInterval = ((handle: ReturnType<typeof setInterval>) => {
    const record = handle as unknown as TimerRecord;
    if (record && typeof record === "object" && "ms" in record) record.cleared = true;
  }) as unknown as typeof clearInterval;
  return seen;
}

/** Put the real scheduler back. Every caller runs this in `afterEach`. */
export function stopWatching(): void {
  globalThis.setInterval = realSetInterval;
  globalThis.clearInterval = realClearInterval;
}

/** The intervals `seen` holds that have not been cleared — the ones a live session still owns. */
export function liveTimers(seen: TimerRecord[]): TimerRecord[] {
  return seen.filter((timer) => !timer.cleared);
}

/** A lifecycle context whose recorder also counts how often each widget key was written. */
export type CountingPanelContext = PanelContext & {
  recorder: RecordingUi & Omit<CountingRecorder, "recorder">;
};

/**
 * A context like `contextWith`'s, counting widget writes.
 *
 * The harness file is protected and stays byte-identical to `main`, so the tally is wrapped around the
 * recorder (`countingRecorder`, `recording-ui-extra.ts`) and merged onto it *before* `piContext` builds the
 * context's bound `ui` — a member added afterwards would never reach the extension.
 */
export function countingContext(entries: readonly unknown[]): CountingPanelContext {
  const counting = countingRecorder();
  Object.assign(counting.recorder, counting);
  return piContext(entries, counting.recorder) as unknown as CountingPanelContext;
}

/**
 * `minutes` (and `seconds`) after `iso`: the one way these cases move a clock, so a bucket boundary is
 * arithmetical rather than whatever minute the run happened to fall in.
 */
export function later(iso: string, minutes: number, seconds = 0): string {
  return new Date(Date.parse(iso) + (minutes * 60 + seconds) * 1_000).toISOString();
}
