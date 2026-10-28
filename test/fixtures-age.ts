/**
 * The age fixtures for the panel and the rail: instants a fixed distance before `NOW`, and the ages the
 * drawing prints for them.
 *
 * Kept out of `test/fixtures.ts` because that file is protected (it must stay byte-identical to
 * `origin/main`), and every fixture added by the age work belongs here rather than in it. The instants
 * themselves are the ones `fixtures.ts` exports: an age fixture is meaningless without the instant it is
 * aged against, so those are imported and not copied.
 */
import { formatPinAge } from "../src/time.ts";
import { LATER, NOW } from "./fixtures.ts";

/**
 * Instants a fixed distance before `NOW`, for the age the panel and the rail draw.
 *
 * An age is a *difference* between two instants, so an age fixture is an instant plus the instant it is
 * aged against — never a literal `"4m"`, which would be true only of the clock the run happens to read.
 * These are the bucket edges the formatter's boundaries are asserted at, computed from `NOW` so a change
 * to it moves every age fixture with it (and TZ-independently: a difference of instants is a difference of
 * milliseconds, whatever zone either one reads as).
 */
const shifted = (ms: number): string => new Date(Date.parse(NOW) - ms).toISOString();

/** One pin minute old at `NOW` — the smallest age past `now`. */
export const MINUTE_BEFORE_NOW = shifted(60_000);
/** One pin hour old at `NOW`. */
export const HOUR_BEFORE_NOW = shifted(3_600_000);
/** One pin day old at `NOW`. */
export const DAY_BEFORE_NOW = shifted(86_400_000);

/** The age of `NOW` at `LATER`, which is the age every panel fixture draws for a pin stamped `NOW`. */
export const NOW_AGE = formatPinAge(NOW, LATER);

/**
 * The age the *integration* rail draws: those harnesses run the extension on the clock `LATER` and seed
 * their pins at that same instant, so the pin is under a minute old and the rail answers `now`.
 *
 * Named rather than written inline because "the rail's age" is a fact about the harness — which instant it
 * runs at and which instant it stamps — and a literal `now` in an assertion does not say so.
 */
export const RAIL_AGE = formatPinAge(LATER, LATER);
