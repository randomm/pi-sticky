/**
 * The instant the panel measures a pin's age against, held in one place.
 *
 * A pin's age is not state: it is drawn, from the pin's own `createdAt`, at the moment the frame is built
 * (operator decision, pins v2-2). What the frame *cannot* know on its own is what "now" is — the extension
 * owns the only clock (`clock()` in `extension.ts`), the component draws on pi-tui's schedule, and a test
 * needs the two to be the same instant or an assertion about `4m` is an assertion about the wall clock.
 *
 * So the age is read through one member rather than taken from `new Date()` at three call sites, and that
 * member is optional rather than required: a caller with no clock of its own (a drawing test, a direct
 * builder) gets the real instant, and a caller with one gets *its* instant, which is the whole seam a tick
 * re-ages through. `ageBucket` is the other half of the same seam — the minute an age was drawn at, which
 * is what both the tick and the frame cache compare, so "has the age moved?" is one question with one
 * answer rather than two that drift.
 */
import { TICK_INTERVAL_MS } from "./panel-tick.ts";

/** Reads the current instant as an ISO stamp — the shape every `createdAt` in the state already has. */
export type AgeClock = () => string;

/** Reads the current instant, or says nothing at all: what a host that has no clock of its own answers. */
export type AgeClockOrSilence = () => string | undefined;

/** The instant `now` is read at when the caller has no clock: this one, from the host's wall clock. */
export function ageAt(now: AgeClockOrSilence | undefined): string {
  if (now === undefined) return new Date().toISOString();
  // Called as a member of its own object rather than passed detached: a clock built from a host's own state
  // (`ageNow: () => this.clock()` in a test host) reads that state through `this`, and a detached reference
  // would arrive with no receiver for it.
  const instant = now();
  return instant === undefined ? new Date().toISOString() : instant;
}

/**
 * The bucket an age is drawn at: the whole minute the instant falls in, or `NaN` for an instant that does
 * not parse.
 *
 * The age a frame draws changes once a minute, so a frame cache keyed on the raw instant misses on every
 * redraw — pi-tui asks for a frame far more often than a pin's age changes, and each miss is a full layout
 * pass over every pin. Keyed on the bucket instead, a redraw inside the same minute is the same frame, and
 * the tick's own minute hand and the cache agree on when a byte can actually have moved. `NaN` compares
 * unequal to everything, including itself, which is the right answer for a clock that cannot be read: the
 * frame is rebuilt rather than believed.
 */
export function ageBucket(iso: string): number {
  return Math.floor(Date.parse(iso) / TICK_INTERVAL_MS);
}
