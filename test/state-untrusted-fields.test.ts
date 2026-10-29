/**
 * What a session file is allowed to say about the three fields pins v2-5 added — `group`, `options` and
 * `compact` — as `reconstruct` reads them back.
 *
 * Split out of `state-untrusted.test.ts` because these fields are a different promise from pin text: a
 * snapshot shapes them, the reader re-cleans each one through `cleanPinText` (a rebuild has no config, so
 * there is no budget), and the value is dropped outright rather than stored when cleaning empties it —
 * `isPinState` refuses `group: ""` and a `""` among the options, and a snapshot it refuses is *skipped*,
 * which loses every pin on the branch rather than one field.
 *
 * The digit edge is the regression this file exists for. The class that spells "edge whitespace" is built
 * at runtime from numeric code points, and one of those numbers is CR — 0x0d. Written as the *number*
 * rather than the character, the class contains the characters "1" and "3", so a group lost a digit on
 * every read and an all-digit option cleaned to `""` until the list fell under `MIN_OPTIONS` and the whole
 * `options` key vanished. The suite's own ISO stamp ends in `Z`, which is why no fixture showed it.
 */
import { describe, expect, test } from "bun:test";

import { renderRailLines } from "../src/rail-lines.ts";
import { plainStyle, renderList, renderPinsText } from "../src/render.ts";
import { cleanPinText } from "../src/sanitize.ts";
import { isPinState } from "../src/state-guards.ts";
import { reconstruct } from "../src/state.ts";
import { formatLocalTime } from "../src/time.ts";
import type { PinState } from "../src/types.ts";
import { DIGIT_GROUP, DIGIT_OPTIONS, NOW_DIGIT, digitState } from "./digit-fixtures.ts";
import { NOW, customEntry, localTime, pin, state, toolResultEntry, view } from "./fixtures.ts";
import { offenders } from "./panel-hostile.ts";
import { drawn, drawnBreaks } from "./state-untrusted-drawn.ts";
import { ESC, HOSTILE_PIN_TEXT, cp } from "./state-untrusted-hostile.ts";

describe("reconstruct cleans the three optional fields of an untrusted snapshot", () => {
  test("a snapshot's group and options cannot carry escapes into state or the view", () => {
    // The same promise pin text makes: a session file shapes these fields, a rebuild cleans them, and no
    // surface draws them yet — so the assert is on the state and the view rather than on a rendered row.
    const polluted: PinState = {
      v: 1,
      pins: [
        {
          ...pin(1, "a", "warning"),
          group: HOSTILE_PIN_TEXT,
          options: [`${ESC}[2Jyes`, `${cp(0x202e)}no`, `${cp(0xdc00)}maybe`],
          compact: true,
        },
      ],
      nextId: 10,
      removed: [],
    };
    for (const entry of [customEntry(polluted), toolResultEntry(polluted)]) {
      const result = reconstruct([entry], []);
      expect(result.state.pins[0]?.group).toBe(cleanPinText(HOSTILE_PIN_TEXT));
      expect(result.state.pins[0]?.options).toEqual(["yes", "no", "maybe"]);
      expect(result.view.pins[0]?.group).toBe(cleanPinText(HOSTILE_PIN_TEXT));
      expect(offenders(result.state.pins[0]?.group ?? "x")).toEqual([]);
      for (const option of result.state.pins[0]?.options ?? []) {
        expect(offenders(option)).toEqual([]);
      }
      expect(result.state.pins[0]?.compact).toBe(true);
    }
  });

  test("a snapshot's digit-edged group, options and timestamps survive reconstruct whole", () => {
    // Strings whose last character is a digit, the shape no fixture had. `copyPin`/`copyRemoval` re-run
    // `cleanPinText` on every read, so an edge class carrying "1" and "3" truncated the group one digit
    // per pass, emptied the digit-only options until the list fell under MIN_OPTIONS and the key
    // disappeared, and shortened the stamp the user-removal refusal prints. `offenders` names escapes,
    // C1s, RLO and surrogates, so the break shapes these strings travel through are swept by its partner.
    const digits = digitState();
    const digitTexts = drawn(digits);
    let readBack: ReturnType<typeof reconstruct> | undefined;
    for (const entry of [customEntry(digits), toolResultEntry(digits)]) {
      const result = reconstruct([entry], []);
      readBack = result;
      for (const pins of [result.state.pins, result.view.pins]) {
        expect(pins[0]?.text).toBe("Ship 1");
        expect(pins[0]?.group).toBe(DIGIT_GROUP);
        expect(pins[0]?.options).toEqual(DIGIT_OPTIONS);
      }
      expect(result.state.pins[0]?.createdAt).toBe(NOW_DIGIT);
      expect(result.state.pins[0]?.updatedAt).toBe(NOW_DIGIT);
      expect(result.state.removed[0]?.at).toBe(NOW_DIGIT);
    }
    for (const text of digitTexts) {
      expect(offenders(text)).toEqual([]);
      expect(drawnBreaks(text)).toEqual([]);
    }
    // Drawn, not merely stored: a field the surfaces never show is a field nobody would have missed. The
    // `/pins` text draws the stamp as `formatLocalTime`'s local `HH:MM`, not as the ISO string, so it is
    // checked as drawn rather than by slicing the stamp — and a stamp the clock cannot read would draw
    // `--:--`. The rail is not part of this: it draws an *age* (`formatPinAge`), and `renderList` draws no
    // time at all, so neither can confirm a stamp was read as the instant it names.
    expect(digitTexts.some((text) => text.includes(DIGIT_GROUP))).toBe(true);
    // The clock of the instant the fixture *means* — `NOW`, the shared stamp `NOW_DIGIT` was cut from —
    // against what the surface drew for the digit-edged one. The two sides are deliberately different
    // strings: comparing `NOW_DIGIT` with the column drawn from `NOW_DIGIT` would be true whatever the
    // fixture said, and an assertion that cannot fail is not a guard. So a fixture that lost its zone
    // designator — and is then read as local time, moving the hour in every zone but UTC — is caught here.
    for (const text of drawnClocks(digits)) {
      expect(text.includes(localTime(NOW)), text).toBe(true);
    }
    // And the fixture still names one instant with `NOW`, which is what the line above is entitled to
    // expect of it: `NOW_DIGIT` is `NOW` with a digit cut in before the `Z`, not a different time.
    expect(Date.parse(NOW_DIGIT)).toBe(Date.parse(NOW));
    // Both digit-edged stamps still read as clocks: `formatLocalTime` answers the sentinel `--:--` for a
    // stamp `new Date` cannot parse, and the rail's age and the removal refusal both go through it. An
    // edge cleaner that rewrote the stamp's tail would leave the stored string equal and every column
    // above dead, so the drawn form is asserted too — against `NOW`, for the same reason as above.
    expect(formatLocalTime(NOW_DIGIT)).toBe(localTime(NOW));
    const removalStamp = readBack?.state.removed[0]?.at;
    expect(removalStamp ? formatLocalTime(removalStamp) : "").toBe(localTime(NOW));
    expect(digitTexts.some((text) => text.includes("--:--"))).toBe(false);
  });

  test("a combining-mark flood in a group is capped, not carried, by read-back", () => {
    // Six marks on one base, past what the sanitizer keeps: the rebuild answers with the four it caps
    // to, which is the same pass pin text goes through and the reason a hostile file cannot widen a
    // future row past what the surface can measure.
    const flood = `e${cp(0x301, 0x301, 0x301, 0x301, 0x301, 0x301)}`;
    const result = reconstruct(
      [
        customEntry({
          v: 1,
          pins: [{ ...pin(1, "a", "info", { group: flood }) }],
          nextId: 2,
          removed: [],
        }),
      ],
      [],
    );
    expect(result.state.pins[0]?.group).toBe(cleanPinText(flood));
    expect((result.state.pins[0]?.group ?? "").length).toBeLessThan(flood.length);
  });

  test("drawn() refuses a snapshot no reader would accept", () => {
    // The premise of every sweep above: a snapshot `isPinState` refuses is *skipped* by `reconstruct`, so
    // a state no reader could produce would sweep three clean rows of an empty board and every assertion
    // would pass on nothing. The helper is the one place that says so, and it says it by refusing. Each
    // shape below carries a pin, so a skip is a silent empty board rather than a legitimately empty one.
    for (const unreadable of refusedShapes()) {
      expect(isPinState(unreadable), JSON.stringify(unreadable)).toBe(false);
      expect(() => drawn(unreadable), JSON.stringify(unreadable)).toThrow("no reader");
    }
  });

  test("drawn() refuses a rebuild that kept pins and drew none of them", () => {
    // The other way a sweep can pass on nothing: an empty state is itself a state the guard above accepts,
    // so that guard cannot tell a board with nothing on it from one the helper failed to draw. Every pin is
    // drawn under its own `#<id>` by all three surfaces, so a rebuild that kept pins and drew no row for
    // them has to be refused rather than handed back as a sweep of two header lines.
    const kept = state([pin(1, "a"), pin(2, "b")], 3);
    const empty = state([], 3);
    expect(isPinState(kept)).toBe(true);
    expect(isPinState(empty)).toBe(true);
    // What a real board hands a sweep: a row carrying each pin's marker on every surface, against the two
    // header lines an empty board draws. The marker is what the guard reads — each of the three surfaces
    // puts `#<id>` at the head of a pin's row, so an id missing from all of them is a pin nobody shows.
    const rows = drawn(kept).filter((text) => text.includes("#1") && text.includes("#2"));
    expect(rows).toHaveLength(2);
    expect(drawn(empty)).toHaveLength(2);
    // The line-count half: no surface drew a row, so the sweep is shorter than the one-line-per-pin floor
    // its callers write their assertions against.
    expect(() => drawnHidingRows(kept, false)).toThrow("the sweep would pass on nothing");
    // The marker half: a rail that drew a row for one pin and nothing for the other clears the line-count
    // floor, so the id is what says a pin went undrawn.
    expect(() => drawnHidingRows(kept, true, 1)).toThrow("drew no #2");
  });
});

/** The rail budget `drawn` asks for: its header plus one row per pin, capped at seven rows. */
const RAIL_BUDGET = 8;

/**
 * The surface that draws a stamp as a clock: `renderPinsText` puts `formatLocalTime(createdAt)` on the row
 * (render.ts, pinsTextRow). `renderList` is excluded — `modelRow` carries no time at all — and so is the
 * rail, which draws an *age*; a sweep that included either could satisfy a clock assertion with a line that
 * shows no hour. Unlike `drawn`, this one draws the **fixture** state rather than a rebuild of it: the
 * assertion it feeds compares the stored stamp with the column drawn for it, and reading that pair out of
 * one rebuild would compare each string with itself.
 */
function drawnClocks(state: PinState): string[] {
  if (!isPinState(state)) {
    throw new Error("drawnClocks() was handed a state no reader would accept");
  }
  const lines = [renderPinsText(view(state.pins, state.removed))];
  // Non-empty, and every line carrying a clock-shaped column (`HH:MM`, or the `--:--` sentinel the
  // formatter answers for an unreadable stamp): a surface that drew no row would make the caller's
  // `for (…)` sweep pass on nothing, and a header line alone would satisfy a `some` without a time in it.
  // The sentinel passes this floor on purpose — refusing it here would pre-empt the `--:--` assertion below,
  // which is the one that says which stamp was unreadable.
  if (lines.length === 0 || lines.some((line) => !/[0-9]{2}:[0-9]{2}|--:--/.test(line))) {
    throw new Error(`drawnClocks() drew no clock column: ${JSON.stringify(lines)}`);
  }
  return lines;
}

/**
 * The degenerate sweep `drawn` exists to refuse, produced on purpose: the same rebuild, with the surfaces
 * asked to draw an empty view. That is what a surface that dropped every pin looks like from the helper's
 * side — header lines for a state that holds pins, and no row — and it is the shape the caller's
 * `for (const text of drawn(…))` would otherwise sweep as a PASS on nothing. `rail = false` drops the rail
 * altogether, which is the shape the line-count floor catches rather than the marker check.
 */
function drawnHidingRows(state: PinState, rail = true, railRows = 0): string[] {
  if (!isPinState(state)) throw new Error("drawn() was handed a state no reader would accept");
  const result = reconstruct([customEntry(state)], []);
  // The view the rail is asked to draw: none of the pins, or only the first `railRows` of them. Either way
  // the rebuild still holds every pin, which is the mismatch the helper refuses.
  const hidden = view(result.view.pins.slice(0, railRows));
  const lines = [
    ...(rail ? [renderList(hidden, 5), renderPinsText(hidden)] : []),
    ...renderRailLines(hidden, 20, { maxLines: RAIL_BUDGET, style: plainStyle }),
  ];
  const pins = result.state.pins;
  if (pins.length > 0 && lines.length < 1 + Math.min(pins.length, RAIL_BUDGET - 1)) {
    throw new Error(
      `drawn() drew ${lines.length} line(s) for ${pins.length} pin(s): the sweep would pass on nothing`,
    );
  }
  for (const pin of pins) {
    if (lines.some((line) => line.includes(`#${pin.id}`))) continue;
    throw new Error(`drawn() drew no #${pin.id}: the sweep would pass on a pin nobody shows`);
  }
  return lines;
}

/**
 * Snapshots that carry a pin and are refused anyway — a `nextId` that does not clear it, a uid the guard
 * will not address, a level nothing draws, a `group` or option cleaned to nothing, and a payload whose
 * fields are all inherited. Each is the shape `reconstruct` skips rather than reads.
 */
function refusedShapes(): PinState[] {
  return [
    { v: 1, pins: [pin(1, "a")], nextId: 0, removed: [] },
    { v: 1, pins: [{ ...pin(1, "a"), uid: "" }], nextId: 2, removed: [] },
    { v: 1, pins: [{ ...pin(1, "a"), level: "shout" as never }], nextId: 2, removed: [] },
    { v: 1, pins: [{ ...pin(1, "a"), group: "" }], nextId: 2, removed: [] },
    { v: 1, pins: [{ ...pin(1, "a"), options: ["ok", ""] }], nextId: 2, removed: [] },
    Object.create({ v: 1, pins: [pin(1, "a")], nextId: 2, removed: [] }) as PinState,
  ];
}
