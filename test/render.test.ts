import { describe, expect, test } from "bun:test";
import { visibleWidth } from "@earendil-works/pi-tui";

import {
  orderPins,
  plainStyle,
  renderList,
  renderPinsText,
  renderRailLines,
} from "../src/render.ts";
import { formatLocalTime } from "../src/time.ts";
import type { PinLevel, PinView, ViewPin } from "../src/types.ts";
import {
  HOUR_BEFORE_NOW,
  LATER,
  LATER_TIME,
  MINUTE_BEFORE_NOW,
  NOW,
  NOW_TIME,
  localTime,
  pin,
  view,
} from "./fixtures.ts";

const FIXED_TIME = (iso: string): string => (iso === NOW ? NOW_TIME : LATER_TIME);

const rail = (view: PinView, width: number, maxLines: number): string[] =>
  renderRailLines(view, width, { maxLines, style: plainStyle, formatTime: FIXED_TIME });

/** The rail as the product draws it: no `formatTime`, and the instant the caller names. */
const railAt = (view: PinView, width: number, maxLines: number, now: string): string[] =>
  renderRailLines(view, width, { maxLines, style: plainStyle, now });

describe("orderPins", () => {
  test("warning comes before action, action before info", () => {
    const ordered = orderPins([
      pin(1, "fact", "info"),
      pin(2, "decide", "action"),
      pin(3, "danger", "warning"),
    ]);
    expect(ordered.map((p) => p.id)).toEqual([3, 2, 1]);
  });

  test("within a level a replied pin sinks below an unreplied one", () => {
    const ordered = orderPins([
      { ...pin(1, "old", "info"), repliedAt: LATER },
      pin(2, "fresh", "info"),
    ]);
    expect(ordered.map((p) => p.id)).toEqual([2, 1]);
  });

  test("within a level and reply state the newest id is first", () => {
    const ordered = orderPins([pin(1, "a"), pin(3, "c"), pin(2, "b")]);
    expect(ordered.map((p) => p.id)).toEqual([3, 2, 1]);
  });

  test("does not reorder the array it was given", () => {
    const input = [pin(1, "a", "info"), pin(2, "b", "warning")];
    const before = input.map((p) => p.id);
    orderPins(input);
    expect(input.map((p) => p.id)).toEqual(before);
  });

  test("an empty view orders to nothing", () => {
    expect(orderPins([])).toEqual([]);
  });
});

describe("renderList", () => {
  test("counts against the limit and names both numbers with nothing pinned", () => {
    expect(renderList(view(), 5)).toBe("Pinned for the user now (0 of 5):");
  });

  test("lists every pin in rank order with its level", () => {
    const text = renderList(
      view([pin(1, "fact"), pin(2, "danger", "warning"), pin(3, "decide", "action")]),
      5,
    );
    expect(text.split("\n")).toEqual([
      "Pinned for the user now (3 of 5):",
      "#2 [warning] danger",
      "#3 [action] decide",
      "#1 [info] fact",
    ]);
  });

  test("a replied pin says the user replied and when", () => {
    const text = renderList(view([{ ...pin(1, "a"), repliedAt: LATER }]), 5);
    expect(text).toContain(`(replied by the user at ${LATER_TIME})`);
  });

  test("lists more pins than the rail could show", () => {
    const many = Array.from({ length: 9 }, (_, i) => pin(i + 1, `p${i}`));
    const lines = renderList(view(many), 5).split("\n");
    expect(lines).toHaveLength(10);
  });
});

describe("renderRailLines", () => {
  test("an empty view draws nothing", () => {
    expect(rail(view(), 60, 8)).toEqual([]);
  });

  test("a non-positive width or budget draws nothing", () => {
    const withPin = view([pin(1, "a")]);
    expect(rail(withPin, 0, 8)).toEqual([]);
    expect(rail(withPin, 60, 0)).toEqual([]);
    expect(rail(withPin, -1, 8)).toEqual([]);
  });

  test("line one is the header with the count", () => {
    const lines = rail(view([pin(1, "a"), pin(2, "b")]), 60, 8);
    expect(lines[0]).toContain("Pinned for you");
    expect(lines[0]).toContain("(2)");
  });

  test("the hint appears when the width allows it", () => {
    const lines = rail(view([pin(1, "a")]), 60, 8);
    expect(lines[0]).toContain("/pins");
  });

  test("the hint is dropped when the header would not fit with it", () => {
    // Narrow enough that "… · /pins" cannot fit, but the header alone can.
    const lines = rail(view([pin(1, "a")]), 22, 8);
    expect(lines[0]).not.toContain("/pins");
    expect(lines[0]).toContain("Pinned for you");
  });

  test("a budget of one draws the header alone, and offers the hint only if a row follows", () => {
    const lines = rail(view([pin(1, "a")]), 30, 1);
    expect(lines).toHaveLength(1);
    // With no row to draw, the header with the hint is the only thing that has to fit.
    expect(lines[0]).toContain("/pins");
  });

  test("one row per pin in rank order", () => {
    const lines = rail(view([pin(1, "fact"), pin(2, "danger", "warning")]), 60, 8);
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain("danger");
    expect(lines[2]).toContain("fact");
  });

  test("a row names the id, the age and the marker", () => {
    // The rail draws an *age*, not the clock time (`/pins` and the model listing keep `HH:MM`). The instant
    // is named by the test and the pin's own `createdAt` is a minute before it, so the row must read `1m`
    // rather than whatever the machine's zone says `NOW` is.
    const [_, first] = railAt(
      view([pin(1, "check", "warning", { createdAt: MINUTE_BEFORE_NOW })]),
      60,
      8,
      NOW,
    );
    expect(first).toContain("#1");
    expect(first).toContain(" 1m ");
    expect(first).toContain("!");
  });

  test("the info marker is the bullet and the action marker is a question mark", () => {
    const [, info] = rail(view([pin(1, "fact", "info")]), 60, 8);
    const [, action] = rail(view([pin(1, "decide", "action")]), 60, 8);
    expect(info).toContain("•");
    expect(action).toContain("?");
  });

  test("a replied pin is marked and the reply time is not repeated in the rail", () => {
    const [, line] = rail(view([{ ...pin(1, "a"), repliedAt: LATER }]), 60, 8);
    expect(line).toContain("↩");
    expect(line).not.toContain("replied by the user");
  });

  test("a +N more row replaces the last slot when the pins do not all fit", () => {
    const many = Array.from({ length: 6 }, (_, i) => pin(i + 1, `p${i}`, "info"));
    const lines = rail(view(many), 60, 3);
    expect(lines).toHaveLength(3);
    expect(lines[2]).toContain("+4 more");
    // Only two pins are drawn, so the sixth is not among them.
    expect(lines[1]).toContain("p5");
  });

  test("the +N more row is not drawn when everything fits", () => {
    const lines = rail(view([pin(1, "a"), pin(2, "b")]), 60, 8);
    expect(lines.some((l) => l.includes("more"))).toBe(false);
  });

  test("a budget of two with three pins shows one pin and the more row", () => {
    const lines = rail(view([pin(1, "a"), pin(2, "b"), pin(3, "c")]), 60, 2);
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain("+2 more");
  });

  test("the plain style leaves a row as the text it was given", () => {
    // plainStyle is the identity, so a row is the pin's own text and the theme is left to the
    // component tests that own it.
    const lines = rail(view([pin(1, "keep this")]), 60, 8);
    expect(lines[1]).toInclude("keep this");
  });
  test("the style is applied to the header, the marker and the dim parts", () => {
    const calls: string[] = [];
    const recording = {
      header: (s: string) => {
        calls.push(`header:${s}`);
        return s;
      },
      marker: (level: PinLevel, s: string) => {
        calls.push(`marker:${level}:${s}`);
        return s;
      },
      dim: (s: string) => {
        calls.push(`dim:${s}`);
        return s;
      },
    };
    renderRailLines(view([pin(1, "a", "warning")]), 60, {
      maxLines: 8,
      style: recording,
      formatTime: FIXED_TIME,
    });
    expect(calls.some((c) => c.startsWith("header:"))).toBe(true);
    expect(calls).toContain("marker:warning:!");
    expect(calls.some((c) => c.startsWith(`dim:${NOW_TIME}`))).toBe(true);
  });

  test("the default formatter is the age, read at the instant the caller named", () => {
    // No `formatTime` is the product's path, and the product draws an age: a pin one hour old reads `1h`
    // at the named instant, which is the shape the tick re-ages through. A caller that names no instant
    // gets the real one, so a fresh pin reads `now`.
    const aged = renderRailLines(view([pin(1, "a", "info", { createdAt: HOUR_BEFORE_NOW })]), 60, {
      maxLines: 8,
      style: plainStyle,
      now: NOW,
    });
    expect(aged[1]).toContain(" 1h ");
    const fresh = renderRailLines(view([pin(1, "a", "info", { createdAt: NOW })]), 60, {
      maxLines: 8,
      style: plainStyle,
      // The same instant, so the age is under a minute. A caller that named *no* instant gets `--` rather
      // than a reading of the wall clock, which `renderRailLines`'s own note on `now` is about.
      now: NOW,
    });
    expect(fresh[1]).toContain(" now ");
    const unnamed = renderRailLines(view([pin(1, "a", "info", { createdAt: NOW })]), 60, {
      maxLines: 8,
      style: plainStyle,
    });
    expect(unnamed[1]).toContain(" -- ");
  });

  test("a pin whose text carries newlines still draws exactly one rail row", () => {
    // A pin text comes from a model. A newline in it would otherwise push the rail past its
    // budget and print a line the rail never accounted for (a `# fake header` in the transcript).
    const lines = rail(view([pin(1, "a\n\n# fake header\nb")]), 60, 8);
    expect(lines).toHaveLength(2);
    for (const line of lines) expect(line).not.toInclude("\n");
    expect(lines[1]).toInclude("a # fake header b");
  });

  test("every break shape collapses to a space, not only the one the sanitizer leaves", () => {
    // The rail's one-line guarantee is its own. The sanitizer maps all six break shapes to LF, but
    // `renderRailLines` is also called with views built directly, so CR, U+0085, U+2028 and U+2029
    // have to collapse here too rather than smuggle a second terminal line past the budget.
    const cp = (...codes: number[]): string => String.fromCodePoint(...codes);
    const breaks = [cp(0x0a), cp(0x0d), cp(0x85), cp(0x2028), cp(0x2029)];
    // `a<break>b` only: a run of breaks collapses to ONE space, so a two-break text draws `a  b`.
    for (const brk of breaks) {
      for (const text of [`a${brk}b`, `a${brk}c${brk}b`]) {
        const lines = rail(view([pin(1, text)]), 60, 8);
        expect(lines).toHaveLength(2);
        for (const line of lines) {
          for (const forbidden of breaks) expect(line).not.toInclude(forbidden);
          expect(visibleWidth(line)).toBeLessThanOrEqual(60);
        }
        // One space per break, whatever the break was.
        expect(lines[1]).toInclude(text.replace(new RegExp(`[${breaks.join("")}]`, "g"), " "));
      }
    }
  });

  test("ordering in the rail matches orderPins", () => {
    const input: ViewPin[] = [
      pin(1, "fact"),
      pin(2, "danger", "warning"),
      pin(3, "decide", "action"),
    ];
    const lines = rail(view(input), 60, 8);
    expect(lines[1]).toContain("danger");
    expect(lines[2]).toContain("decide");
    expect(lines[3]).toContain("fact");
  });
});
