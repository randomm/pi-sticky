/**
 * The edge trim of `cleanPinText` on the one input shape every other sanitizer test left uncovered:
 * a digit at the start or the end of a pin's text.
 *
 * The class that spells "edge whitespace" is built at runtime from numeric code points, and one of
 * those numbers is CR — 0x0d. Written as the *number* rather than the character, the class contains
 * the characters "1" and "3", so every field lost a digit per pass: `cleanPinText("Plan 3")` answered
 * `"Plan"`, and a text made of nothing but digits answered `""`, which the reducer then refused as
 * missing text and `session-entries.ts` dropped along with the whole `options` key. These are the
 * assertions that fail while that interpolation is wrong, at all three depths a pin text is cleaned
 * (the tool's budget, the reducer's re-clean, and a rebuild that has no config to read a budget from).
 *
 * The reverse failure gets its own test: a fix that stopped trimming a break member to buy the digits
 * back. No break member is visible to a behavioural sweep on its own — the control pass folds all five
 * to LF before the trim runs — so that one reads the class in `src/sanitize.ts` the running trim builds.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

import { EDGE_CHARACTERS, cleanPinText, sanitizePinText } from "../src/sanitize.ts";
import { cp } from "./session-entries-hostile.ts";

/** The source of the module whose trim runs, read once for the class assertions below. */
const SANITIZE_SOURCE = readFileSync(join(import.meta.dir, "..", "src", "sanitize.ts"), "utf8");

/**
 * The edge class spelled here rather than imported: a member dropped from the module's source is absent
 * from `EDGE_CHARACTERS` too, so comparing the two lists is the only way to notice a member that went
 * missing from both the class and the behavioural test that would have covered it. The lists alone are not
 * enough — the control pass folds every member to LF before the trim runs, so the pipeline answers "Plan"
 * with a member gone from the class — hence the source assertions below.
 */
const MEMBERS: readonly [string, string, string, string, string] = [
  "\n",
  "\r",
  cp(0x85),
  cp(0x2028),
  cp(0x2029),
];
/** The two shapes `\\s` alone trims; the control pass deletes both, so `EDGE` never has to reach them. */
const VT = cp(0x0b);
const FF = cp(0x0c);

/** One whole line of `src/sanitize.ts`, anchored at both ends, matched as written. */
function sourceLine(line: string): RegExp {
  return new RegExp(`^${line.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "mu");
}

/** `EDGE` is the exported members joined and nothing else: an interpolated number is the CR bug back. */
const EDGE_MEMBERS = sourceLine('const EDGE = `[\\\\s${EDGE_CHARACTERS.join("")}]`;');
/** `TRIM_EDGE` anchors that class at both ends of the text, globally. */
const TRIM_EDGE_ANCHORS = sourceLine(
  'const TRIM_EDGE = new RegExp(`^(?:${EDGE})+|(?:(?:${EDGE})+$)`, "g");',
);
/** Each member is one code point, built by `String.fromCodePoint` — never written as a literal. */
const MEMBER_BINDINGS = [
  /^const LF_CHAR = String\.fromCodePoint\(LF\);$/mu,
  /^const CR_CHAR = String\.fromCodePoint\(CR\);$/mu,
  /^const NEL = String\.fromCodePoint\(0x85\);$/mu,
  /^const LINE_SEP = String\.fromCodePoint\(0x2028\);$/mu,
  /^const PARA_SEP = String\.fromCodePoint\(0x2029\);$/mu,
];

const NL = cp(0x0a);
const CR = cp(0x0d);
const TAB = cp(0x09);
/** Every shape the edge class has to trim, so a fix cannot trade one of them for the digits. */
const EDGES = [`   ${TAB}`, NL, CR, `${CR}${NL}`, cp(0x85), cp(0x2028), cp(0x2029)];
/** Text with a digit at one edge, both edges, or as its whole content. */
const DIGITED = [
  "Plan 3",
  "Step 13",
  "1st",
  "3 items",
  "3 1 1",
  "Release 1.3",
  "v1",
  "1.2.3",
  "1",
  "3",
  "13",
  "31",
  "111",
  "333",
];

/** Lower-case hex of a one-code-point string, for the labels of the member sweeps. */
function hex(ch: string): string {
  return (ch.codePointAt(0) ?? 0).toString(16);
}

describe("cleanPinText trims edges and keeps digits", () => {
  test("every edge shape goes, on both sides, whatever the text ends in", () => {
    for (const edge of EDGES) {
      expect(cleanPinText(`${edge}Plan 3${edge}`)).toBe("Plan 3");
      expect(cleanPinText(`${edge}Ship 1${edge}`)).toBe("Ship 1");
    }
    // The whole edge class is spelled from runtime code points, so a fix that dropped a member to stop
    // trimming digits would still pass a digit-only assertion: CR, NEL and the two U+202x are asserted
    // on their own, at the edge of text whose last character is a digit.
    expect(cleanPinText(`${CR}Plan${CR}`)).toBe("Plan");
    expect(cleanPinText(`${cp(0x85)}Plan${cp(0x85)}`)).toBe("Plan");
    expect(cleanPinText(`${cp(0x2028)}Plan${cp(0x2029)}`)).toBe("Plan");
    expect(cleanPinText(`Step 1${cp(0x2028)}`)).toBe("Step 1");
  });

  test("the edge class still holds every break member, not just the digits", () => {
    // A behavioural sweep cannot single out any one member: the control pass folds CR, NEL and the two
    // U+202x to LF before the trim runs, so `cleanPinText` keeps answering "Plan" with a member gone from
    // `EDGE`. The class is therefore asserted twice over — as the exported list this file names, and as
    // the lines the module that runs the trim actually contains.
    expect(EDGE_CHARACTERS).toEqual(MEMBERS);
    // Frozen, and a fixed-length tuple: the class is joined once at module load, so a member pushed onto
    // the exported array afterwards would change no trim and leave the list claiming a rule no run obeys.
    expect(Object.isFrozen(EDGE_CHARACTERS)).toBe(true);
    expect(EDGE_MEMBERS.test(SANITIZE_SOURCE), "EDGE joins EDGE_CHARACTERS and nothing else").toBe(
      true,
    );
    expect(TRIM_EDGE_ANCHORS.test(SANITIZE_SOURCE), "TRIM_EDGE anchors EDGE at both ends").toBe(
      true,
    );
    for (const binding of MEMBER_BINDINGS) {
      expect(binding.test(SANITIZE_SOURCE), `bound by code point: ${binding.source}`).toBe(true);
    }
    for (const ch of MEMBERS) {
      const code = `0x${hex(ch)}`;
      expect(ch.length, `member ${code}`).toBe(1);
      // And each one really is trimmable, alone and beside a digit, on both sides.
      expect(cleanPinText(`${ch}Plan${ch}`), `both edges of ${code}`).toBe("Plan");
      expect(cleanPinText(`${ch}Step 1${ch}`), `digit-edged ${code}`).toBe("Step 1");
    }
    // The `\\s` half of the class, which is written as an escape rather than built from a code point.
    // VT and FF are not swept here: the control pass deletes both before the trim runs, so they pass with
    // or without the class — their own test below says who removes them.
    for (const ch of [" ", TAB]) {
      expect(cleanPinText(`Plan${ch}`), `trailing ${JSON.stringify(ch)}`).toBe("Plan");
      expect(cleanPinText(`${ch}Plan 3`), `leading ${JSON.stringify(ch)}`).toBe("Plan 3");
    }
  });

  test("VT and FF go to the control pass, not to the edge trim", () => {
    // Both are whitespace to `\\s`, so the sweep above would stay green with either of them removed from
    // the class — they are not members of it. They are asserted here for what they are: C0 controls, which
    // `stripControls` drops before a single edge is examined, digits beside them intact.
    for (const ch of [VT, FF]) {
      const code = `0x${hex(ch)}`;
      expect(cleanPinText(`Ship 1${ch}`), `trailing ${code}`).toBe("Ship 1");
      expect(cleanPinText(`${ch}Plan 3`), `leading ${code}`).toBe("Plan 3");
      expect(cleanPinText(`a${ch}b`), `${code} between text`).toBe("ab");
    }
  });

  test("a digit at either edge, or a string of nothing but digits, is text and stays", () => {
    for (const text of DIGITED) expect(cleanPinText(text)).toBe(text);
  });

  test("the digits survive a second and third clean, which is what the reducer and rebuild do", () => {
    // The tool cleans, the reducer cleans what it stores, and `reconstruct` cleans the snapshot it read
    // back out of the session file: a trim that fired once per application would shave one digit per
    // pass, so a fixed point is the claim and not the first pass alone.
    for (const text of DIGITED) {
      const once = cleanPinText(text);
      expect(cleanPinText(once)).toBe(once);
      expect(cleanPinText(cleanPinText(once))).toBe(once);
    }
  });

  test("a break between two digit-edged runs still collapses to two breaks and keeps both digits", () => {
    // Four breaks in the middle of digit-bearing text: the collapse and the trim both have to fire
    // without taking a digit with them.
    expect(cleanPinText(`${CR}Plan 3${CR}${NL}${NL}${NL}${NL}Step 13${CR}`)).toBe(
      `Plan 3${NL}${NL}Step 13`,
    );
  });

  test("the budget path keeps the digits too, since the tool's text is cleaned there", () => {
    for (const text of DIGITED) {
      expect(sanitizePinText(text, 400)).toEqual({ text, truncated: false });
    }
  });

  test("a digit at the edge of padded text survives both the trim and the cut", () => {
    // 399 `a` plus the digit is exactly the budget, so whether the text is cut is decided by the trim
    // alone: an edge class that ate the trailing digit would report a string that fits and never flag it.
    const tail = `${"a".repeat(399)}3`;
    expect(sanitizePinText(`  ${tail}  `, 400)).toEqual({ text: tail, truncated: false });
    const leading = `1${"a".repeat(399)}`;
    expect(sanitizePinText(`\t${leading}\n`, 400)).toEqual({ text: leading, truncated: false });
  });
});
