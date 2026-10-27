/**
 * The two clocks a pin is drawn with, tested at the formatter rather than through a surface.
 *
 * `formatLocalTime` and `formatPinAge` (`time.ts`) are the only things that spell a pin's stamp, and the
 * surfaces disagree about which one they draw: the panel and the rail age, `/pins` and the model listing
 * tell the time. Both live here rather than in `render.test.ts` because they are clocks, not drawing — and
 * because the assertions have to be computed the way the implementation computes them, so neither rots when
 * the suite runs in a zone that is not UTC.
 */
import { describe, expect, test } from "bun:test";

import { formatLocalTime, formatPinAge } from "../src/time.ts";
import { HOUR_BEFORE_NOW, MINUTE_BEFORE_NOW, NOW, NOW_TIME, localTime } from "./fixtures.ts";

describe("formatLocalTime", () => {
  test("renders the local hours and minutes of the instant, zero-padded", () => {
    // A literal `04:05` here is only the reading under TZ=UTC; `formatLocalTime` deliberately reads
    // the local clock, so the expectation is computed the same way the implementation does, and the
    // padding and shape have to hold in whatever zone the run happens to be in.
    expect(formatLocalTime("2026-10-23T04:05:00.000Z")).toBe(localTime("2026-10-23T04:05:00.000Z"));
    expect(formatLocalTime(NOW)).toBe(NOW_TIME);
  });

  test("is ASCII digits and a colon", () => {
    expect(formatLocalTime(NOW)).toMatch(/^[0-9]{2}:[0-9]{2}$/);
  });

  test("an unusable instant is --:--", () => {
    expect(formatLocalTime("not a date")).toBe("--:--");
    expect(formatLocalTime("")).toBe("--:--");
  });
});

test("an age is read at the instant it is drawn at, and at no other", () => {
  // The age is a function of two instants, both supplied: a caller that names neither gets `--` rather
  // than a reading of the wall clock, because every age on screen must be one some caller named — the
  // seam the tick's minute hand re-ages through, and the reason a test can assert `4m` at all.
  expect(formatPinAge(NOW, NOW)).toBe("now");
  expect(formatPinAge(MINUTE_BEFORE_NOW, NOW)).toBe("1m");
  expect(formatPinAge(HOUR_BEFORE_NOW, NOW)).toBe("1h");
  expect(formatPinAge(undefined, NOW)).toBe("--");
  expect(formatPinAge(NOW, undefined)).toBe("--");
  expect(formatPinAge("not a date", NOW)).toBe("--");
  expect(formatPinAge("2026-10-23T12:00:01.000Z", "2026-10-23T11:00:00.000Z")).toBe("now");
});
