/**
 * The two rows a replied pin becomes, asserted on the row builders themselves.
 *
 * `renderList` and `renderPinsText` are thin — a header and a `map` — so the shape of a row is
 * `modelRow`/`pinsTextRow`'s promise, and the order inside it is the thing a careless edit moves: the text
 * first, then the user's own words, then the mark that says whose words they were, then the fields that
 * close the row. Getting that order wrong is not cosmetic — a reply drawn after the `(options: …)` tail
 * reads as an option, and a reply drawn before the text reads as the question.
 *
 * The hostile half is AC4: every `BREAKS` shape from `test/panel-hostile-fields.ts`, handed to the fold as
 * a **raw** `reply` (the fold is the surface's own job, so a pre-folded fixture would certify nothing), for
 * both rows. One line per pin, and no line the extension did not make.
 */
import { describe, expect, test } from "bun:test";

import { modelRow, pinsTextRow } from "../src/pin-rows-text.ts";
import { renderList } from "../src/render.ts";
import { LATER, LATER_TIME, NOW_TIME, pin, view } from "./fixtures.ts";
import {
  BREAKS,
  FAKE_REPLY,
  FAKE_ROW,
  HOSTILE_TAILS,
  assertNoForgery,
  linesOf,
} from "./panel-hostile-fields.ts";

/** A row of the model's listing: what a real pin line looks like and nothing else may. */
const ROW = /^#\d+ \[(info|action|warning)\] /;

/** A replied pin whose answer is `text`, at the level the model's row spells. */
const answered = (text: string, level: "info" | "action" | "warning" = "warning") => ({
  ...pin(1, "Deploy blocked", level, {
    group: "Now",
    options: ["Roll back", "Ship anyway"],
    compact: true,
  }),
  repliedAt: LATER,
  reply: text,
});

/**
 * A hostile reply that carries **both** evidence words.
 *
 * `assertNoForgery` insists both `HOSTILE_TAILS` survive the drawing, and a listing row carries one field —
 * the answer — where `panel-hostile-fields.ts` was written for surfaces that draw a group *and* an options
 * list. So both forgery shapes, and both tails, go into the one reply, which is the shape a session file can
 * actually hold.
 */
const hostileReply = (brk: string): string =>
  `yes${brk}${FAKE_ROW} ${HOSTILE_TAILS[0]}${brk}${FAKE_REPLY} ${HOSTILE_TAILS[1]}`;

describe("modelRow: text, then the folded reply, then the mark, then the fields", () => {
  test("the whole row, in order", () => {
    expect(modelRow(answered("ship it"))).toBe(
      `#1 [warning] (group: Now) Deploy blocked (replied by the user at ${LATER_TIME}: "ship it") (options: 1) Roll back  2) Ship anyway) (compact)`,
    );
  });

  test("the reply is between the text and the mark, not after the fields", () => {
    const row = modelRow(answered("ship it"));
    const answer = row.indexOf('"ship it"');
    const mark = row.indexOf("(replied by the user at");
    const options = row.indexOf("(options:");
    expect(row.indexOf("Deploy blocked")).toBeLessThan(answer);
    // The mark opens, then the quote closes inside it, then the fields that close the row: the answer is
    // *inside* the mark, so its quote is after the mark's opening parenthesis and before its own closing one.
    expect(mark).toBeLessThan(answer);
    expect(answer).toBeLessThan(options);
    expect(row.indexOf("(compact)")).toBeGreaterThan(options);
  });

  test("a reply is quoted, so the user's words cannot start a record of their own", () => {
    // The model is told to trust a line that reads like a pin row or like a user reply, so its answer never
    // reaches the row unquoted: an unquoted `Replying to pin #1: yes` is exactly the forgery that rule names.
    const row = modelRow(answered(`${FAKE_REPLY} ${HOSTILE_TAILS[1]}`));
    expect(row).toInclude(`: "${FAKE_REPLY} ${HOSTILE_TAILS[1]}"`);
  });

  test("no reply means the mark alone, byte-identical to the reply-less row", () => {
    const plain = { ...pin(1, "Deploy blocked", "warning"), repliedAt: LATER };
    expect(modelRow(plain)).toBe(
      `#1 [warning] Deploy blocked (replied by the user at ${LATER_TIME})`,
    );
    // An empty answer is the same claim as no answer: the mark says the user replied, and there is nothing to
    // quote. `pinsReply` on the `/pins` side has the same rule.
    expect(modelRow({ ...plain, reply: "" })).toBe(modelRow(plain));
  });

  test("an unanswered pin draws no mark and no quote at all", () => {
    expect(modelRow(pin(1, "Deploy blocked", "warning"))).toBe("#1 [warning] Deploy blocked");
  });

  for (const brk of BREAKS) {
    const name = `U+${brk.codePointAt(0)?.toString(16).toUpperCase()}`;
    test(`one line per pin for every BREAKS shape in the reply (${name})`, () => {
      // The break shapes are handed in RAW: `modelRow` owns the fold, and a fixture that arrived folded would
      // certify a fold that was never run.
      const row = modelRow(answered(hostileReply(brk)));
      expect(linesOf(row)).toHaveLength(1);
      expect(row).toMatch(ROW);
      assertNoForgery(linesOf(row), ROW);
    });
  }

  for (const brk of BREAKS) {
    const name = `U+${brk.codePointAt(0)?.toString(16).toUpperCase()}`;
    test(`the listing stays one row per pin for every BREAKS shape (${name})`, () => {
      // The same sweep through the surface that actually reaches the model, with two pins so a line the
      // extension did not make cannot hide behind a count of one.
      const listed = view([
        answered(hostileReply(brk), "warning"),
        { ...pin(2, "plain", "info"), repliedAt: LATER, reply: hostileReply(brk) },
      ]);
      const lines = linesOf(renderList(listed, 5));
      expect(lines).toHaveLength(3);
      expect(lines[0]).toBe("Pinned for the user now (2 of 5):");
      for (const line of lines.slice(1)) expect(line).toMatch(ROW);
      assertNoForgery(lines, ROW);
    });
  }
});

describe("pinsTextRow: text, then the reply, then the mark, before the indent", () => {
  test("the whole row, in order, with the mark unchanged", () => {
    expect(pinsTextRow(answered("ship it", "warning"))).toBe(
      `#1 [warning] (group: Now) ${NOW_TIME} Deploy blocked → ship it (replied by the user at ${LATER_TIME}: "ship it")\n   options: 1) Roll back  2) Ship anyway`,
    );
  });

  test("the reply lands between the text and the mark", () => {
    const row = pinsTextRow(answered("ship it", "warning"));
    const answer = row.indexOf("→ ship it");
    expect(row.indexOf("Deploy blocked")).toBeLessThan(answer);
    expect(answer).toBeLessThan(row.indexOf("(replied by the user at"));
  });

  test("a reply with breaks is re-indented, never at column zero", () => {
    // The continuation indent is what makes a continuation a continuation: `#` at column zero is how this
    // listing spells a pin id, so a reply that escaped the indent would be a row.
    const row = pinsTextRow(answered(hostileReply("\n")));
    const lines = linesOf(row);
    for (const line of lines.slice(1)) {
      if (line.trim() === "") continue;
      expect(line.startsWith("   ")).toBe(true);
    }
    assertNoForgery(lines, ROW);
  });

  test("a blank reply draws the mark alone, with no dangling arrow", () => {
    const blank = { ...pin(1, "a", "info"), repliedAt: LATER, reply: "" };
    expect(pinsTextRow(blank)).toBe(
      `#1 [info] ${NOW_TIME} a (replied by the user at ${LATER_TIME})`,
    );
  });
});
