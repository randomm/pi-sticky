/**
 * The two clocks a pin is drawn with: the moment it happened, and how long ago that was.
 *
 * `formatLocalTime` lives here rather than in render.ts because the state reducer names a
 * user removal by its local time and render.ts is about drawing, not about clocks.
 * `formatPinAge` sits beside it because the two answer the same question about the same stamp —
 * "what does the panel say next to this pin" — and the surfaces disagree about which answer:
 * the panel and the rail draw the age, `/pins` and the model listing draw the clock time.
 */

/** The age a stamp older than a day is drawn as; `d` for days. */
const DAY = 86_400_000;
const HOUR = 3_600_000;
const MINUTE = 60_000;

/** What `formatLocalTime` answers for a stamp it cannot read, and `formatPinAge` for a missing one. */
const UNUSABLE = "--:--";
const NO_AGE = "--";

/** Local time as `HH:MM`, ASCII digits and a colon in any locale; `--:--` if unusable. */
export function formatLocalTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return UNUSABLE;
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}

/**
 * How old `iso` is at `now`, as the panel and the rail draw it: `now` under a minute, then `4m`,
 * `3h`, `2d`. A stamp the age does not reach is read at the hour; 25h is `1d` and 48h is `2d`.
 *
 * `now` is an argument rather than a call to the wall clock, which is what lets a test assert an
 * age from two instants instead of a literal, and lets the drawing read the age at draw time. An absent
 * `now` is `--` like an absent stamp: the formatter never reaches a clock of its own, so every age on
 * screen is one some caller named.
 * A stamp in the future is `now` — a clock that runs ahead of the one that stamped the pin has
 * no other honest answer, and `src/action.ts` only requires the stamp to parse. A stamp that
 * does not parse at all, or is absent, is `--`, the age's own version of `formatLocalTime`'s
 * `--:--`: both are drawn with, and neither may print an empty column.
 */
export function formatPinAge(iso: string | undefined, now: string | undefined): string {
  // A caller that named no instant asked for the age of nothing, and `Date.parse(undefined)` is NaN, which
  // is this formatter's own answer — no wall clock is reached for here, both because an age drawn from two
  // instants the caller named must not depend on a third it did not, and because the rail's tests assert on
  // an age rather than on whatever minute the run happens to fall in.
  if (iso === undefined || now === undefined) return NO_AGE;
  const then = Date.parse(iso);
  const at = Date.parse(now);
  if (Number.isNaN(then) || Number.isNaN(at)) return NO_AGE;
  const elapsed = at - then;
  if (elapsed < MINUTE) return "now";
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)}m`;
  if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)}h`;
  return `${Math.floor(elapsed / DAY)}d`;
}
