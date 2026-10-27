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

test("each bucket turns at the boundary the panel promises, and only there", () => {
  // The four buckets are four `elapsed <` comparisons over the same instant, and a bucket that turned one
  // unit late or early would still draw *an* age — a panel where a 59-minute pin read `1h` looks alive. So
  // each pair below is the last instant of one bucket and the first of the next, both named, not inferred:
  // 59s is `now`, 60s is `1m`; 59m is `59m`, 60m is `1h`; 23h is `23h`, and 24h — the day the header calls
  // "25h is 1d" — is `1d`, with 48h the second day the panel names.
  const age = (ms: number): string =>
    formatPinAge(new Date(Date.parse(NOW) - ms).toISOString(), NOW);
  expect(age(59_000)).toBe("now");
  expect(age(60_000)).toBe("1m");
  expect(age(59 * 60_000)).toBe("59m");
  expect(age(60 * 60_000)).toBe("1h");
  expect(age(23 * 3_600_000)).toBe("23h");
  expect(age(25 * 3_600_000)).toBe("1d");
  expect(age(48 * 3_600_000)).toBe("2d");
});
