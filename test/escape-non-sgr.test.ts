/**
 * The drawn-line half of the escape scanner, and `stripNonSgr`/`containsNonSgr`, which is what a *theme's* bytes are drawn under (#70).
 *
 * Going through the sanitizer leaves a branch of the scanner unexercised: a stray ESC inside
 * an 8-bit string body is payload that the scanner steps over, but the sanitizer then deletes the
 * surviving control, so a sanitize-level assertion cannot tell "stepped over and dropped" from
 * "leaked". Asserting on the scanner's own output is also how a suspected coverage gap is settled:
 * every introducer, final-byte class and terminator below is driven straight into the scanner.
 *
 * The two passes share the walk in `escape-scan.ts`, so the `stripNonSgr` cases are driven over the
 * same classes as the `stripSequences` ones above: what each pass keeps and what it refuses is the
 * panel's drawn-line policy, and a class only one pass was tested on is a class nobody vouches for.
 *
 * Controls are built at runtime — a literal escape sequence written into this file is rewritten on
 * its way in and silently changes what the comparison matches.
 */ import { describe, expect, test } from "bun:test";
import { containsNonSgr, stripNonSgr, stripSequences } from "../src/escape.ts";
import {
  APC8,
  BEL,
  CSI8,
  DCS8,
  ESC,
  NON_SGR,
  OSC8,
  PM8,
  SGR_RED,
  SGR_RESET,
  SGR_TRUE_COLOUR,
  SOS8,
  cp,
  csi,
  isC1,
  pad,
} from "./escape-fixtures.ts";

describe("stripNonSgr keeps a colour", () => {
  test("an SGR closed by m survives, with its parameters intact", () => {
    expect(stripNonSgr(`${SGR_RED}red`)).toBe(`${SGR_RED}red`);
    expect(stripNonSgr(`a${SGR_TRUE_COLOUR}x${SGR_RESET}`)).toBe(
      `a${SGR_TRUE_COLOUR}x${SGR_RESET}`,
    );
  });

  test("an SGR written in its 8-bit form is refused, not kept", () => {
    // `CSI8` is still dispatched as a CSI — the walk takes the introducer, its parameters and its final
    // whole — but it is never a *kept* sequence. U+009B is a member of the printable range: `visibleWidth`
    // charges it a column, and `31m` three more, so a pass that emits what it keeps cannot draw an 8-bit
    // colour for free. The 7-bit spelling above is the only one a theme may colour a drawn line with.
    expect(stripNonSgr(`${CSI8}31mred`)).toBe("red");
    expect(containsNonSgr(`${CSI8}31mred`)).toBe(true);
    // Refused whole: neither the introducer nor its parameters come back as the text `31m`.
    expect(stripNonSgr(`${CSI8}38;2;1;2;3mred`)).toBe("red");
    // ...and a 7-bit colour is untouched alongside it, so refusing one spelling is not refusing colour.
    expect(stripNonSgr(`${CSI8}31m${SGR_RED}red`)).toBe(`${SGR_RED}red`);
  });

  test("plain text is returned byte for byte", () => {
    expect(stripNonSgr("plain text")).toBe("plain text");
    expect(stripNonSgr("")).toBe("");
  });
});

describe("stripNonSgr refuses every other sequence", () => {
  test("no non-SGR sequence, from any class, reaches the output", () => {
    for (const [name, sequence] of NON_SGR) {
      expect(stripNonSgr(pad(sequence)), name).toBe("ab");
    }
  });

  test("a lone introducer of each class is dispatched on, never emitted as text", () => {
    // The six 8-bit introducers, and a bare ESC. Each 8-bit form is itself a member of the printable
    // range above C1: a pass that decided on whether a byte *survives* would wave it through as text,
    // which is the whole reason the walk dispatches on the class instead.
    //
    // The byte after the introducer is U+00E9, spelled from its code point. It is neither a CSI
    // parameter byte (0x20-0x3f) nor a CSI final (0x40-0x7e), so the run after `CSI8` never becomes a
    // sequence and only the introducer dies — the branch this case is about. A byte in the CSI final
    // range would not do: `b` is CUU, so `CSI8` plus `b` is a *whole* refused CSI and this case would
    // exercise the closing branch while reading like it tested the unclosed one.
    const TAIL = cp(0xe9);
    // A bare ESC is the odd one: `ESC` plus *any* next byte is a two-character sequence (ESC M and its
    // kin), so the byte after it dies with the introducer and there is nothing to keep. Only ESC alone
    // at the end of the input is a sequence of one.
    expect(stripNonSgr(`a${ESC}${TAIL}`)).toBe("a");
    expect(stripNonSgr(`a${ESC}`)).toBe("a");
    // A lone 8-bit CSI is a CSI that reached no final byte, so only the introducer dies and the text
    // after it survives.
    expect(stripNonSgr(`a${CSI8}${TAIL}`)).toBe(`a${TAIL}`);
    // The other five 8-bit introducers open *string* sequences, and an unterminated string runs to the
    // end of the input: with nothing to terminate it there is no "text after it" to keep, which is the
    // difference between a CSI and a string and the reason the two branches exist.
    for (const introducer of [OSC8, DCS8, SOS8, PM8, APC8]) {
      expect(stripNonSgr(`a${introducer}${TAIL}`), `lone 8-bit ${introducer.charCodeAt(0)}`).toBe(
        "a",
      );
      // ...and with a terminator the text after the payload comes back.
      expect(
        stripNonSgr(`a${introducer}${TAIL}${BEL}keep`),
        `terminated 8-bit ${introducer.charCodeAt(0)}`,
      ).toBe("akeep");
    }
  });

  test("a colour keeps its own bytes while the refused ones around it die", () => {
    expect(stripNonSgr(`${SGR_RED}${csi("2J")}red${ESC}]0;t${BEL}`)).toBe(`${SGR_RED}red`);
  });

  test("a CSI is refused whole when it closes, and loses only its introducer when it never closes", () => {
    // `ESC [ 3 1 H` reaches a real CSI final (`H`), so the whole run was a CSI and all of it dies — the
    // cursor stays where it was. `ESC [ 3 1` then U+00E9 never reaches one, so it was never a CSI and
    // only the introducer goes, which is what stops the frame drawing the orphaned parameters as the text
    // `31`. `stripSequences` agrees on both: the two passes differ about kept *classes*, never about
    // where a sequence ends.
    const UNFORMATTED = `${ESC}[31${cp(0xe9)}`;
    expect(stripNonSgr(`a${ESC}[31Hb`)).toBe("ab");
    expect(stripSequences(`a${ESC}[31Hb`)).toBe("ab");
    expect(stripNonSgr(`a${UNFORMATTED}`)).toBe(`a31${cp(0xe9)}`);
    expect(stripSequences(`a${UNFORMATTED}`)).toBe(`a31${cp(0xe9)}`);
  });

  test("a lone C1 control is not text", () => {
    expect(stripNonSgr(`a${cp(0x85)}b`)).toBe("ab");
  });

  test("the two passes refuse the same bytes, and differ only about SGR", () => {
    // The panel's drawn-line policy rests on both passes reading one scanner: for every class that *is*
    // a sequence the two return the same string, and the only bytes they differ on are a CSI closed by
    // `m`. The one documented exception is a bare C1 control, which is not a sequence at all: it is the
    // untrusted pass's `dropControls` job, and `stripNonSgr` still refuses it (asserted above).
    for (const [name, sequence] of NON_SGR) {
      expect(stripNonSgr(pad(sequence)), name).not.toContain(sequence);
    }
    for (const [name, sequence] of NON_SGR.filter(([, seq]) => !isC1(seq))) {
      expect(stripNonSgr(pad(sequence)), name).toBe(stripSequences(pad(sequence)));
    }
    expect(stripNonSgr(`${SGR_RED}red`)).not.toBe(stripSequences(`${SGR_RED}red`));
  });
});

describe("containsNonSgr", () => {
  test("an SGR-only line carries nothing to report", () => {
    expect(containsNonSgr(`${SGR_RED}red${SGR_RESET}`)).toBe(false);
    expect(containsNonSgr("plain")).toBe(false);
    expect(containsNonSgr("")).toBe(false);
  });

  test("every refused class is reported, whatever text surrounds it", () => {
    for (const [name, sequence] of NON_SGR) {
      expect(containsNonSgr(pad(sequence)), name).toBe(true);
    }
  });

  test("a bare C0 control or DEL is reported, and TAB is not", () => {
    // The blind spot the #70 review found. `stripNonSgr` is a *sequence* pass, and a bare BEL, BS, VT, FF,
    // NUL or DEL is not a sequence: it is one of the few bytes the pass leaves exactly where it stood. A
    // classifier that asked only "does this carry a refused sequence" therefore certified a drawn line
    // carrying one as clean, which is how a theme that writes a CR between its two colours got a row that
    // redraws its own column past a sweep sworn to catch it.
    //
    // The range is `dropControls`' keep-set inverted, not a `< 0x20` bound: 0x0e-0x1f are controls too, and
    // a sweep that stopped at the wrong end of C0 is the same blind spot one byte lower.
    for (const code of [0x00, 0x01, 0x07, 0x08, 0x0e, 0x17, 0x1f, 0x7f]) {
      const control = cp(code);
      expect(containsNonSgr(control), `bare 0x${code.toString(16)}`).toBe(true);
      // The byte the drawn-line sweep is for: a control sitting *after* a kept colour, which is where the
      // re-attaching walk used to copy it back out and where a sequence-only classifier saw nothing.
      expect(
        containsNonSgr(`${SGR_RED}a${control}b`),
        `0x${code.toString(16)} inside a colour`,
      ).toBe(true);
      // `stripNonSgr` is the *sequence* pass and leaves these bytes where they stood — the pass that
      // removes them is `dropControls`, run after it. Pinned so the two are never collapsed into one.
      expect(stripNonSgr(`${SGR_RED}a${control}b`), `strip keeps 0x${code.toString(16)}`).toBe(
        `${SGR_RED}a${control}b`,
      );
    }
    // TAB is the control every drawn surface keeps (`dropControls`, and `foldBreaks` leaves it alone for
    // the same reason), so naming it would make the frame sweeps report a legitimate row.
    expect(containsNonSgr("a\tb")).toBe(false);
    // The break shapes are not the classifier's either: they are folded to a space before a row is drawn
    // (`foldBreaks`), so a row that still carries one is a row that skipped that pass, not an escape.
    expect(containsNonSgr("a b")).toBe(false);
  });

  test("an 8-bit CSI that is not a colour is reported", () => {
    // The class a byte-range guard misses: `CSI8` is printable to `visibleWidth`, so a sweep that
    // looked only for ESC and C1 bytes would call a screen clear clean. `stripSequences` removes it
    // and `stripNonSgr` refuses it, so the classifier must name it too.
    expect(containsNonSgr(`${CSI8}2J`)).toBe(true);
    expect(containsNonSgr(pad(`${CSI8}K`))).toBe(true);
  });

  test("a colour does not hide a refused sequence that follows it", () => {
    expect(containsNonSgr(`${SGR_RED}red${csi("2J")}`)).toBe(true);
  });

  test("it agrees with stripNonSgr about which lines are clean", () => {
    // One question, one classifier: a line the strip leaves untouched is exactly a line the
    // classifier calls free of non-SGR bytes, and vice versa. A drift here would make the drawn-line
    // sweep (`test/panel-hostile.ts`) weaker than the pass it claims to check.
    const lines = [
      "plain",
      `${SGR_RED}red`,
      `${CSI8}31mred`,
      ...NON_SGR.map(([, sequence]) => pad(sequence)),
      pad(`${CSI8}2J`),
      `${SGR_RED}${csi("2J")}red`,
    ];
    for (const line of lines) {
      expect(containsNonSgr(line), JSON.stringify(line)).toBe(stripNonSgr(line) !== line);
    }
  });

  test("an 8-bit colour is a line that must be rewritten, whatever `visibleWidth` makes of it", () => {
    // The agreement above, pinned for the one class a *keeping* pass cannot keep: the introducer is
    // printable to `visibleWidth`, so a classifier that trusted a byte range would call it clean and a
    // keeping pass would draw four columns of it where a colour was supposed to cost none.
    for (const line of [`${CSI8}31mred`, `${SGR_RED}${CSI8}44mx`]) {
      expect(containsNonSgr(line), JSON.stringify(line)).toBe(true);
      expect(stripNonSgr(line), JSON.stringify(line)).not.toContain(CSI8);
    }
  });
});
