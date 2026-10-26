/**
 * Direct tests of the escape scanner, `stripSequences`, which sanitizePinText runs as its first
 * pass. Going through the sanitizer leaves a branch of the scanner unexercised: a stray ESC inside
 * an 8-bit string body is payload that the scanner steps over, but the sanitizer then deletes the
 * surviving control, so a sanitize-level assertion cannot tell "stepped over and dropped" from
 * "leaked". Asserting on the scanner's own output is also how a suspected coverage gap is settled:
 * every introducer, final-byte class and terminator below is driven straight into the scanner.
 *
 * Controls are built at runtime — a literal escape sequence written into this file is rewritten on
 * its way in and silently changes what the comparison matches.
 */
import { describe, expect, test } from "bun:test";
import { stripSequences } from "../src/escape.ts";

const cp = (...codes: number[]): string => String.fromCodePoint(...codes);
const ESC = cp(0x1b);
const BEL = cp(0x07);
const BS = cp(0x5c); // backslash, the second half of ST
const CAN = cp(0x18);
const SUB = cp(0x1a);
const ST8 = cp(0x9c); // 8-bit STRING TERMINATOR
const CSI8 = cp(0x9b);
const OSC8 = cp(0x9d);
const DCS8 = cp(0x90);
const SOS8 = cp(0x98);
const PM8 = cp(0x9e);
const APC8 = cp(0x9f);
/** ST written the only way this file can: ESC then a backslash. */
const ST = `${ESC}${BS}`;

describe("7-bit CSI", () => {
  test("a CSI with a final byte dies whole", () => {
    expect(stripSequences(`a${ESC}[31mred`)).toBe("ared");
  });

  test("a CSI with private-marker parameters dies whole", () => {
    expect(stripSequences(`${ESC}[?25lhidden${ESC}[?25h`)).toBe("hidden");
  });

  test("a CSI that reaches no final byte loses only the introducer", () => {
    // `r` is 0x72, a legal final, so it is consumed with the sequence; `31` without one survives.
    expect(stripSequences(`${ESC}[31`)).toBe("31");
    expect(stripSequences(`${ESC}[31;40red`)).toBe("ed");
  });

  test("a CSI that reaches no final byte because of a lone ESC loses only the introducer", () => {
    // ESC is neither a CSI byte nor a C1 control, so this run never became a CSI: only `ESC [`
    // dies and `3` survives. The scan then resumes at that ESC, which opens a fresh CSI that
    // swallows `[m` (final `m`), leaving the trailing letter.
    expect(stripSequences(`a${ESC}[3${ESC}[mb`)).toBe("a3b");
  });

  test("a CSI interrupted by a C1 control takes that control with it", () => {
    // 0x80 is neither a CSI parameter nor a final, so the attempt ends and the control dies.
    expect(stripSequences(`${ESC}[3${cp(0x80)}m`)).toBe("m");
  });
});

describe("8-bit CSI", () => {
  test("an 8-bit CSI with a final byte dies whole", () => {
    expect(stripSequences(`${CSI8}31mred`)).toBe("red");
  });

  test("an 8-bit CSI with no final byte loses only the introducer", () => {
    expect(stripSequences(`${CSI8}31`)).toBe("31");
  });

  test("an 8-bit CSI interrupted by a C1 control takes that control with it", () => {
    expect(stripSequences(`${CSI8}3${cp(0x80)}m`)).toBe("m");
  });
});

describe("string sequences", () => {
  test("an OSC terminated by BEL dies whole", () => {
    expect(stripSequences(`${ESC}]52;c;AAAA${BEL}after`)).toBe("after");
  });

  test("an OSC terminated by ESC-backslash dies whole", () => {
    expect(stripSequences(`${ESC}]0;title${ST}tail`)).toBe("tail");
  });

  test("an OSC 8 link leaves only its visible label", () => {
    const link = `${ESC}]8;;https://evil${ST}docs${ESC}]8;;${ST}`;
    expect(stripSequences(link)).toBe("docs");
  });

  test("an unterminated OSC dies at CAN, SUB and 8-bit ST, with the terminator", () => {
    expect(stripSequences(`${ESC}]0;t${CAN}tail`)).toBe("tail");
    expect(stripSequences(`${ESC}]0;t${SUB}tail`)).toBe("tail");
    expect(stripSequences(`${ESC}]0;t${ST8}tail`)).toBe("tail");
  });

  test("an unterminated OSC hands the scan back to a lone ESC that opens the next sequence", () => {
    // The ESC has no backslash after it, so it is not ST: the CSI it opens swallows the rest.
    expect(stripSequences(`${ESC}]0;t${ESC}[31mx`)).toBe("x");
  });

  test("a lone ESC that opens a two-character sequence still keeps the text after it", () => {
    // The OSC stops at the ESC; ESC M is a two-character sequence; the trailing letter survives.
    expect(stripSequences(`${ESC}]0;t${ESC}Mkeep`)).toBe("keep");
  });

  test("an unterminated string runs to the end of the input when nothing terminates it", () => {
    expect(stripSequences(`${ESC}]0;never ends here`)).toBe("");
  });

  test("a DCS ends at BEL and at 8-bit ST", () => {
    expect(stripSequences(`${ESC}Ppayload${BEL}tail`)).toBe("tail");
    expect(stripSequences(`${ESC}Ppayload${ST8}tail`)).toBe("tail");
  });

  test("SOS, PM and APC strings die with their payload", () => {
    expect(stripSequences(`${ESC}Xsecret${BEL}tail`)).toBe("tail");
    expect(stripSequences(`${ESC}^private${ST8}tail`)).toBe("tail");
    expect(stripSequences(`a${ESC}_pi:c${BEL}b`)).toBe("ab");
  });

  test("pi-tui's private APC marker cannot survive", () => {
    // Unterminated APC: everything after the introducer is payload, so the trailing letter goes.
    expect(stripSequences(`a${ESC}_pi:cb`)).toBe("a");
  });

  test("a Kitty image prefix dies with its payload", () => {
    expect(stripSequences(`${ESC}Gf=100,a=I,t=f;d=AAAA${ST}visible`)).toBe("visible");
  });
});

describe("8-bit string introducers", () => {
  test("OSC, DCS, SOS, PM and APC introduced by their C1 code points die with their payload", () => {
    expect(stripSequences(`${OSC8}0;title${BEL}tail`)).toBe("tail");
    expect(stripSequences(`${DCS8}q payload${BEL}tail`)).toBe("tail");
    expect(stripSequences(`${SOS8}secret${BEL}tail`)).toBe("tail");
    expect(stripSequences(`${PM8}private${BEL}tail`)).toBe("tail");
    expect(stripSequences(`${APC8}opaque${BEL}tail`)).toBe("tail");
  });

  test("inside an 8-bit string a stray ESC is payload the scanner steps over", () => {
    // The lone ESC inside the OSC body is not ST (no backslash), so it is swallowed with the body
    // rather than handed back to open a sequence: only a terminator ends the string. The text after
    // the BEL is the only thing that survives.
    expect(stripSequences(`${OSC8}a${ESC}b${BEL}tail`)).toBe("tail");
  });

  test("an 8-bit string with no terminator runs to the end of the input", () => {
    expect(stripSequences(`${OSC8}a${ESC}b and no terminator`)).toBe("");
  });
});

describe("bare and two-character ESC", () => {
  test("a two-character ESC sequence dies and the text after it survives", () => {
    expect(stripSequences(`a${ESC}Mb`)).toBe("ab");
  });

  test("a trailing bare ESC is a sequence of one", () => {
    expect(stripSequences(`abc${ESC}`)).toBe("abc");
  });
});

describe("text that only looks like a control", () => {
  test("a character whose low byte is a backslash is not ST", () => {
    // U+015C has 0x5c as its low byte; masking to 8 bits would end the OSC here and leak the URL.
    expect(stripSequences(`${ESC}]0;url${cp(0x15c)}leak`)).toBe("");
  });

  test("an 8-bit introducer is dispatched on, never emitted as text", () => {
    // U+009B is inside the printable C1 range; a kept-test would let it through as text.
    expect(stripSequences(`${CSI8}h`)).toBe("");
  });
});
