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

import { SGR_RESET, isSgrReset, sgrResetFor, themeBytes, themeMeasure } from "../src/escape-sgr.ts";

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

  test("a colour opened after an unterminated string is still read as open", () => {
    // The scanner hands the walk back to a bare ESC that opens a second sequence rather than swallowing the
    // run to the end of the input (the negative `length` form, `escape-scan.ts`). That resume is the only
    // path on which `opensColour` advances without deciding anything, so a colour written *after* the dead
    // string must still be named: a theme whose OSC is cut short and which then opens a background is a line
    // that bleeds past the frame's last column.
    expect(sgrResetFor(`${E}]0;pwn${csi("31m")}row`)).toBe(SGR_RESET);
    // ...and the same resume with no colour after it owes nothing: the dead string is refused bytes, and a
    // classifier that appended a reset for it would put an escape on an otherwise plain row.
    expect(sgrResetFor(`${E}]0;pwn${E}Pq payload${E}\\row`)).toBe("");
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

describe("themeBytes / themeMeasure — the half-pair drop the drawn policy owns", () => {
  // The policy is a sequence pass and a control pass, and neither is a surrogate pass: the band sits inside
  // the printable range both keep, so a lone half rode through it and reached every theme-byte surface — the
  // border's label, the tail, the closure of each row — not only the marker cell. `visibleWidth` charges a
  // half nothing, so the row still measured the width it owed while handing the terminal a character it
  // cannot draw, which is why the class is asserted at the policy itself rather than only where a cell or a
  // frame happens to sweep it.
  const high = String.fromCharCode(0xd83d);
  const low = String.fromCharCode(0xdc00);
  const emoji = "\u{1f600}";
  /** A colour the measuring form takes out and the drawn one keeps: the two differ by exactly this. */
  const COLOUR = `${E}[33m`;

  test("a half with no partner is dropped and a pair is kept whole", () => {
    // Read per policy: `themeBytes` keeps the theme's colour and `themeMeasure` takes it out too, because a
    // colour draws no column and the cut must not be counted on bytes the terminal spends nothing on.
    for (const [policy, colour] of [[themeBytes, COLOUR] as const, [themeMeasure, ""] as const]) {
      expect(policy(`${COLOUR}${high}abc`), policy.name).toBe(`${colour}abc`);
      expect(policy(`${COLOUR}${low}abc`), policy.name).toBe(`${colour}abc`);
      // Two halves in the wrong order are two orphans, not a character: neither may survive on the theory
      // that a low written before a high could be paired with it.
      expect(policy(`${COLOUR}${low}${high}x`), policy.name).toBe(`${colour}x`);
      // An astral glyph is a pair and a character, so it stays — the theme's own emoji is what the user
      // asked to see, and a filter that dropped it would silently deface every coloured frame. The pair
      // below is spelled as the two halves the theme's bytes actually carry and checked against the
      // character they decode to, so the assertion cannot be satisfied by a pass that dropped both.
      expect(policy(`${COLOUR}${emoji}`), policy.name).toContain(emoji);
      expect(policy(`${COLOUR}${high}${low}`), policy.name).toBe(
        `${colour}${String.fromCodePoint(0xd83d, 0xdc00)}`,
      );
    }
  });

  test("a half standing between a colour and the glyph costs no column and leaves no orphan", () => {
    // The shape the #70 cut branch leaked on: the half sat on the column of a colour that survived, so it is
    // asserted here that the kept form carries neither the half nor a stray introducer, and that the form the
    // cut is *counted* on agrees with the drawn one byte for byte once the colours are taken out — the pair
    // of forms `keepColours` walks together, which cannot be allowed to disagree about a half.
    const marked = `${E}[33m${high}a${low}b`;
    const kept = themeBytes(marked);
    expect(kept).toBe("\u001b[33mab");
    for (let i = 0; i < kept.length; i++) {
      const code = kept.charCodeAt(i);
      const before = kept.charCodeAt(i - 1);
      const orphan = code >= 0xdc00 && code <= 0xdfff && !(before >= 0xd800 && before <= 0xdbff);
      expect(orphan, `orphan half at ${i} of ${JSON.stringify(kept)}`).toBe(false);
    }
    expect(themeMeasure(marked)).toBe(kept.replace(new RegExp(`${E}\\[[0-9;]*m`, "g"), ""));
  });

  test("the policy is idempotent, so a caller that already ran it costs nothing", () => {
    // `closedCell` (`panel-frame.ts`) runs the policy over a form its caller has just run it over; that is
    // only safe while a second pass changes nothing. Every shape above is run twice through.
    for (const policy of [themeBytes, themeMeasure]) {
      for (const marked of [
        `${E}[33m${high}abc`,
        `${E}[33m${low}${high}x`,
        `${E}[33m${emoji}${high}`,
        `${E}[33m${emoji}${emoji}plain`,
        `${E}]0;t${String.fromCharCode(0x07)}a${E}[33mb`,
      ]) {
        const once = policy(marked);
        expect(policy(once), `${policy.name} ${JSON.stringify(marked)}`).toBe(once);
      }
    }
  });
});

describe("SGR_RESET", () => {
  test("is the canonical `ESC [ 0 m`, spelled from code points", () => {
    expect([...SGR_RESET].map((character) => character.charCodeAt(0))).toEqual([
      0x1b, 0x5b, 0x30, 0x6d,
    ]);
  });
});
