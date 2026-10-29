/**
 * The line-end reset the drawn panel owes the screen now that a theme's colour survives to it (#70).
 *
 * The panel is a flush-right overlay: an unclosed background from a theme's `selected`, or a faint from
 * its `dim`, would bleed onto the columns beside the frame and onto whatever pi-tui paints next. So every
 * drawn line asks `sgrResetFor` once and appends its answer (`selectionReset`, `panel-frame.ts`). This is
 * that classifier's own arithmetic — which openings need a reset, which do not, and the byte-exact form of
 * the reset it adds.
 *
 * The behavioural half (a frame drawn through a theme that leaves a colour open) is
 * `panel-drawn-lines.test.ts`, which asserts the reset on the bytes the drawer produced rather than on the
 * classifier in isolation.
 *
 * Every escape is spelled from code points: a literal written into a source file is rewritten on the way
 * in, and a test that compares against a rewritten literal agrees with the helper only while both make the
 * same mistake.
 */
import { describe, expect, test } from "bun:test";

import { SGR_RESET, isSgrReset, sgrResetFor } from "../src/escape-sgr.ts";

const E = String.fromCharCode(0x1b);
const csi = (parameters: string): string => `${E}[${parameters}`;

describe("sgrResetFor", () => {
  test("a line that carries no escape is returned exactly as it came", () => {
    // The uncoloured frame is the common case and the one a naive implementation would regress: an
    // unconditional append would put a reset on every row of a plain terminal, so a panel that drew no
    // escape bytes at all would start drawing them.
    expect(sgrResetFor("plain row")).toBe("");
    expect(sgrResetFor("")).toBe("");
  });

  test("a line still wearing a colour gets the reset", () => {
    expect(sgrResetFor(`${csi("44m")}selected row`)).toBe(SGR_RESET);
    expect(sgrResetFor(`${csi("2m")}dim meta`)).toBe(SGR_RESET);
    // A true-colour background opened with `48;2;r;g;b` is the shape pi's own `selectedBg` produces.
    expect(sgrResetFor(`${csi("48;2;0;0;128m")}row`)).toBe(SGR_RESET);
  });

  test("a line whose last SGR is a reset owes nothing", () => {
    // The whole point of asking rather than always appending: a theme that closed its own colour is
    // drawn byte for byte, with no second reset paid for out of the row.
    expect(sgrResetFor(`${csi("44m")}row${SGR_RESET}`)).toBe("");
    expect(sgrResetFor(`${csi("44m")}row${csi("m")}`)).toBe("");
    expect(sgrResetFor(`${csi("0;0m")}row`)).toBe("");
  });

  test("the last SGR decides, not the first", () => {
    // Open, close, open again: the terminal is still wearing the second colour and the row still owes a
    // reset. Reading the first sequence instead would let a theme hide an unterminated colour behind a
    // reset written earlier in the same string.
    expect(sgrResetFor(`${csi("44m")}a${SGR_RESET}${csi("31m")}b`)).toBe(SGR_RESET);
    expect(sgrResetFor(`${csi("31m")}a${SGR_RESET}${csi("44m")}b${SGR_RESET}`)).toBe("");
  });

  test("a refused sequence never opens a colour, so it never asks for a reset", () => {
    // A theme's OSC or cursor move is refused before a line reaches here, and a refused sequence cannot
    // bleed. A line made only of refused bytes therefore gets no reset appended — the classifier must not
    // mistake `ESC [ 2 J` for an opening just because it starts the same way.
    expect(sgrResetFor(`${csi("2J")}row`)).toBe("");
    expect(sgrResetFor(`${E}]0;title${String.fromCharCode(0x07)}row`)).toBe("");
  });

  test("a reset before the end does not excuse a colour opened after it", () => {
    // pi-tui's cut injects a reset *and then* re-prepends the row's colours to the continuation, so the
    // bytes reaching the screen can close a colour and reopen it in the same line. The last SGR is what
    // the terminal is wearing, and a reset written mid-line must not excuse the opening after it.
    expect(sgrResetFor(`${csi("44m")}a${SGR_RESET}…${csi("44m")}b`)).toBe(SGR_RESET);
  });
});

describe("isSgrReset", () => {
  test("every spelling of a full reset is recognised", () => {
    expect(isSgrReset(SGR_RESET)).toBe(true);
    expect(isSgrReset(csi("m"))).toBe(true);
    expect(isSgrReset(csi("0m"))).toBe(true);
    expect(isSgrReset(csi("00m"))).toBe(true);
    expect(isSgrReset(csi("0;0m"))).toBe(true);
    expect(isSgrReset(csi("0;00;0m"))).toBe(true);
  });

  test("any other SGR is an opening", () => {
    for (const parameters of ["1m", "7m", "31m", "38;2;1;2;3m", "44;31m", "01m"]) {
      expect(isSgrReset(csi(parameters)), parameters).toBe(false);
    }
  });

  test("a sequence that is not an SGR at all is not a reset either", () => {
    // `isSgrReset` is only ever asked about bytes the walk kept, but the shape tests are what stop a
    // stray `m` in the middle of a string reading as a close.
    expect(isSgrReset("plain")).toBe(false);
    expect(isSgrReset("")).toBe(false);
    expect(isSgrReset(`x${SGR_RESET}`)).toBe(false);
    expect(isSgrReset(`${E}]0;0m`)).toBe(false);
  });
});

describe("SGR_RESET", () => {
  test("is the canonical `ESC [ 0 m`, spelled from code points", () => {
    expect([...SGR_RESET].map((character) => character.charCodeAt(0))).toEqual([
      0x1b, 0x5b, 0x30, 0x6d,
    ]);
  });
});
