/**
 * The pins behind the rail samples in the README's **The rail** section, and the three parameters the
 * samples were taken at — so `doc-fact-rail.test.ts` compares each ```text block to what
 * `renderRailLines` emits for exactly those pins rather than to a hand-typed expectation.
 *
 * The ages are differences, not literals. `test/fixtures-age.ts` ships the bucket *edges* (`1m`, `1h`,
 * `1d`), and the samples read `3h` and `1d`, so the instants here are multiples of those edges taken
 * before `LATER` — the instant README:573 names for the rail and frame samples. A literal `"3h"` would
 * have been true only of the clock the run happened to read, which is the defect `fixtures-age.ts` was
 * written against.
 */
import { HOUR_BEFORE_NOW, MINUTE_BEFORE_NOW } from "./fixtures-age.ts";
import { LATER, NOW, pin, view } from "./fixtures.ts";

/** How many milliseconds one of `fixtures-age.ts`'s bucket edges spans. */
const MINUTE_MS = Date.parse(NOW) - Date.parse(MINUTE_BEFORE_NOW);
const HOUR_MS = Date.parse(NOW) - Date.parse(HOUR_BEFORE_NOW);
const DAY_MS = Date.parse(NOW) - Date.parse("2026-10-22T12:00:00.000Z");

/** `n` hours (or `n × 24` days, at `unit` = days) before the instant the samples are aged against. */
function agedBeforeLater(unit: "hours" | "days", n: number): string {
  const ms = (unit === "hours" ? HOUR_MS : DAY_MS) * n;
  return new Date(Date.parse(LATER) - ms).toISOString();
}

/** The width the README states for every rail sample: a 60-column terminal. */
export const RAIL_SAMPLE_WIDTH = 60;

/**
 * The age budget of every rail sample, `PI_STICKY_MAX_LINES` — so named because that is the env var the
 * README names for it, and the samples deliberately use 3 and 4 rather than the shipped default.
 */
export const PI_STICKY_MAX_LINES = "PI_STICKY_MAX_LINES";

/** The instant the README states its rail ages against: the same one the panel fixtures draw at. */
export const RAIL_SAMPLE_NOW = LATER;

/** The two pins of the first sample: one warning, one action. */
export const FIRST_SAMPLE_PINS = [
  pin(2, "CI is red on the replay branch", "warning", {
    createdAt: agedBeforeLater("hours", 3),
  }),
  pin(1, "Decide which provider to keep", "action", {
    createdAt: agedBeforeLater("days", 1),
  }),
];

/**
 * The four pins behind both `+<n> more · /pins` samples, named in the same order README:566-569 lists
 * them: `#4 warning` and `#2 warning` at `2h`/`3h`, `#3 action` and `#1 action` at `3h`/`1d`.
 */
export const MORE_SAMPLE_PINS = [
  pin(4, "Deploy is blocked on the flaky migration", "warning", {
    createdAt: agedBeforeLater("hours", 2),
  }),
  pin(2, "Restart the queue before the deadline", "warning", {
    createdAt: agedBeforeLater("hours", 3),
  }),
  pin(3, "Pick a provider for the staging box", "action", {
    createdAt: agedBeforeLater("hours", 3),
  }),
  pin(1, "Decide which provider to keep", "action", {
    createdAt: agedBeforeLater("days", 1),
  }),
];

/** The pins of the sample drawn at `PI_STICKY_MAX_LINES` 3: four pins, one row and the tail. */
export const THREE_LINE_SAMPLE_PINS = MORE_SAMPLE_PINS;

/** The pins of the sample drawn at `PI_STICKY_MAX_LINES` 4: the same four, two rows and the tail. */
export const FOUR_LINE_SAMPLE_PINS = MORE_SAMPLE_PINS;

/** The pins of the first sample as a view. */
export function firstSampleView() {
  return view(FIRST_SAMPLE_PINS);
}
