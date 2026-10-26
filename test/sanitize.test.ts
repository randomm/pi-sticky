import { describe, expect, test } from "bun:test";

import { MAX_MARKS_PER_GRAPHEME, sanitizePinText } from "../src/sanitize.ts";

// Controls are built at runtime: a tool layer that expands escape sequences would
// otherwise change what the test asserts without changing what it looks like.
const cp = (...codes: number[]): string => String.fromCodePoint(...codes);
const NL = cp(0x0a);
const CR = cp(0x0d);
const TAB = cp(0x09);
const ESC = cp(0x1b);
const BEL = cp(0x07);
const BS = cp(0x5c);

/** Sanitized text, the usual case. */
function clean(raw: string, maxChars = 400): string {
  return sanitizePinText(raw, maxChars).text;
}

/** `ESC` and a backslash: the string terminator. */
const ST = `${ESC}${BS}`;

describe("plain text", () => {
  test("passes through unchanged", () => {
    expect(clean("Deploy finished, ready to check.")).toBe("Deploy finished, ready to check.");
    expect(clean(`Multiline${NL}second line`)).toBe(`Multiline${NL}second line`);
  });

  test("trims surrounding whitespace", () => {
    expect(clean(`   padded${TAB}${NL}`)).toBe("padded");
  });
});

describe("terminal escapes", () => {
  test("strips CSI colour", () => {
    expect(clean(`${ESC}[31mred${ESC}[0m`)).toBe("red");
  });

  test("strips a cursor-control CSI with private-marker parameters", () => {
    expect(clean(`${ESC}[?25lhidden${ESC}[?25h`)).toBe("hidden");
  });

  test("strips OSC 52 clipboard writes", () => {
    expect(clean(`${ESC}]52;c;AAAA${BEL}after`)).toBe("after");
  });

  test("keeps the visible label of an OSC 8 link and drops the URL", () => {
    const link = `${ESC}]8;;https://evil${ST}docs${ESC}]8;;${ST}`;
    expect(clean(link)).toBe("docs");
  });

  test("an unterminated OSC dies, and a CSI placed after it dies too", () => {
    // No terminator anywhere: the OSC swallows the rest of the input, CSI included.
    expect(clean(`${ESC}]8;;evil${ESC}[31mtext`)).toBe("text");
  });

  test("a DCS string ends at 0x9C", () => {
    expect(clean(`${ESC}Psome payload${cp(0x9c)}tail`)).toBe("tail");
  });

  test("a DCS string also ends at BEL", () => {
    expect(clean(`${ESC}Psome payload${BEL}tail`)).toBe("tail");
  });

  test("terminates an unterminated string at CAN and SUB", () => {
    expect(clean(`${ESC}]0;title${cp(0x18)}tail`)).toBe("tail");
    expect(clean(`${ESC}]0;title${cp(0x1a)}tail`)).toBe("tail");
  });

  test("re-reads an ESC that opens the next sequence", () => {
    // The first OSC has no terminator of its own, so the CSI that the next ESC opens
    // swallows the rest: nothing of this input is text.
    expect(clean(`${ESC}]0;t${ESC}[31mx`)).toBe("x");
  });

  test("a CSI terminated by CAN is dropped only up to CAN", () => {
    expect(clean(`${ESC}[31${cp(0x18)}red`)).toBe("red");
  });

  test("drops a CSI with no final byte", () => {
    // `r` is 0x72, a valid CSI final, so it belongs to the sequence.
    expect(clean(`${ESC}[31;40red`)).toBe("ed");
  });

  test("strips 8-bit CSI introduced by U+009B", () => {
    expect(clean(`${cp(0x9b)}31mred`)).toBe("red");
  });

  test("strips 8-bit DCS and OSC introduced by U+0090 and U+009D", () => {
    expect(clean(`${cp(0x90)}q payload${BEL}tail`)).toBe("tail");
    expect(clean(`${cp(0x9d)}0;title${cp(0x9c)}tail`)).toBe("tail");
  });

  test("strips SOS and PM strings", () => {
    expect(clean(`${ESC}Xsecret${BEL}tail`)).toBe("tail");
    expect(clean(`${ESC}^private${cp(0x9c)}tail`)).toBe("tail");
  });

  test("pi-tui's private APC marker cannot survive", () => {
    // Unterminated APC: everything after the introducer is payload, so the trailing
    // letter goes with it. Terminated by BEL, only the marker itself goes.
    expect(clean(`a${ESC}_pi:cb`)).toBe("a");
    expect(clean(`a${ESC}_pi:c${BEL}b`)).toBe("ab");
  });

  test("a Kitty image prefix cannot survive", () => {
    expect(clean(`${ESC}Gf=100,a=I,t=f;d=AAAA${ST}visible`)).toBe("visible");
  });

  test("a two-character ESC sequence and a trailing bare ESC are dropped", () => {
    expect(clean(`a${ESC}Mb`)).toBe("ab");
    expect(clean(`abc${ESC}`)).toBe("abc");
  });

  test("a character that only looks like ST's backslash is not a terminator", () => {
    // U+015C (LATIN CAPITAL LETTER L WITH BELOW DOT) has 0x5c as its low byte. Masking
    // to 8 bits would end the OSC here and leak the rest of the URL.
    expect(clean(`${ESC}]0;url${cp(0x15c)}leak`)).toBe("");
  });
});

describe("control characters", () => {
  test("strips C0 controls, DEL and C1 controls", () => {
    // 0x68 is `h`, the CUP final byte, so a stray 8-bit CSI followed by `h` is a well-formed
    // CSI and takes the h with it. The run ends with a byte no CSI can end with, which is
    // where the introducer itself has to die.
    const raw = `a${cp(0)}b${BEL}c${cp(8)}d${cp(31)}e${cp(127)}g${cp(0x9b)}?h`;
    expect(clean(raw)).toBe("abcdeg");
  });

  test("normalises newlines and tabs and collapses three newlines to two", () => {
    expect(clean(`a${CR}${NL}b${TAB}c${NL}${NL}${NL}${NL}d`)).toBe(`a${NL}b c${NL}${NL}d`);
    expect(clean(`a${CR}b`)).toBe(`a${NL}b`);
  });

  test("a CR between two newlines is just another break", () => {
    expect(clean(`a${NL}${CR}${NL}b`)).toBe(`a${NL}${NL}b`);
  });

  test("U+0085 becomes a newline", () => {
    expect(clean(`a${cp(0x85)}b`)).toBe(`a${NL}b`);
  });

  test("U+2028 and U+2029 become newlines", () => {
    expect(clean(`a${cp(0x2028)}b${cp(0x2029)}c`)).toBe(`a${NL}b${NL}c`);
  });
});

describe("invisible and directional characters", () => {
  test("removes bidi controls", () => {
    expect(clean(`a${cp(0x202e)}b`)).toBe("ab");
    expect(clean(`a${cp(0x2066)}b`)).toBe("ab");
  });

  test("removes zero-width and format characters", () => {
    expect(clean(`a${cp(0x200b)}b`)).toBe("ab");
    expect(clean(`a${cp(0x200c)}b`)).toBe("ab");
    expect(clean(`a${cp(0x2060)}b`)).toBe("ab");
    expect(clean(`a${cp(0xfeff)}b`)).toBe("ab");
  });

  test("keeps ZWJ inside an emoji family", () => {
    const family = cp(0x1f468, 0x200d, 0x1f469, 0x200d, 0x1f467);
    expect(clean(family)).toBe(family);
  });

  test("drops ZWJ and VS16 outside an emoji sequence", () => {
    expect(clean(`a${cp(0x200d)}b`)).toBe("ab");
    expect(clean(`a${cp(0xfe0f)}b`)).toBe("ab");
  });

  test("removes the emoji tag block and keeps the flag base", () => {
    expect(clean(`${cp(0x1f1e6)}${cp(0xe0061)}${cp(0xe0062)}`)).toBe(cp(0x1f1e6));
  });
});

describe("surrogates", () => {
  test("drops lone surrogates and keeps valid pairs", () => {
    const emoji = cp(0x1f600);
    expect(clean(`a${String.fromCharCode(0xd800)}b${emoji}`)).toBe(`ab${emoji}`);
    expect(clean(`${String.fromCharCode(0xdc00)}x`)).toBe("x");
  });
});

describe("combining marks", () => {
  test("caps combining marks at four per grapheme", () => {
    const kept = clean(`e${cp(0x301, 0x301, 0x301, 0x301, 0x301, 0x301)}`);
    expect(kept.length).toBe(1 + MAX_MARKS_PER_GRAPHEME);
    expect(clean("ok")).toBe("ok");
  });

  test("the cap counts every mark class, not only nonspacing marks", () => {
    // U+20E3 (COMBINING ENCLOSING KEYCAP) is Me, not Mn: a cap that tests only /\p{Mn}/ lets an
    // unbounded run of enclosing marks through, so the budget has to count /\p{M}/ marks.
    const kept = clean(`x${cp(0x20e3, 0x20e3, 0x20e3, 0x20e3, 0x20e3, 0x20e3)}`);
    expect(kept.length).toBe(1 + MAX_MARKS_PER_GRAPHEME);
  });
});

describe("budget", () => {
  const ascii = (n: number): string => "a".repeat(n);
  // Built from numbers rather than from a source literal or a single code point: an astral
  // character written into this file does not survive being written, and a code point above the
  // BMP can come back as half of its surrogate pair. A base broken in half is not the family this
  // budget has to count as one grapheme, so each base is spelled as the pair it really is.
  const ZWJ = String.fromCharCode(0x200d);
  const base = (low: number): string => String.fromCharCode(0xd83d, low);
  const family = base(0xdc68) + ZWJ + base(0xdc69) + ZWJ + base(0xdc67);

  test("text of exactly maxChars graphemes is not cut", () => {
    const result = sanitizePinText(ascii(400), 400);
    expect(result.text).toBe(ascii(400));
    expect(result.truncated).toBe(false);
  });

  test("longer text is cut to maxChars minus the ellipsis and flagged", () => {
    const result = sanitizePinText(ascii(401), 400);
    expect(result.truncated).toBe(true);
    expect(result.text.length).toBe(400);
    expect(result.text.endsWith(cp(0x2026))).toBe(true);
    expect(result.text.startsWith(ascii(100))).toBe(true);
  });

  test("cuts on a grapheme boundary, never mid-cluster", () => {
    // Three families are three graphemes, so a budget of two has to cut, and the cut has to land
    // between clusters: a budget that stopped inside a family would leave half a surrogate pair
    // and a dangling joiner, both of which are characters on their own.
    const result = sanitizePinText(family + family + family, 2);
    expect(result.truncated).toBe(true);
    // The ellipsis is itself one of the graphemes the budget counts, so a cut keeps maxChars - 1
    // of text: the 400-character case above measures the same rule from the other side.
    expect(result.text).toBe(family + cp(0x2026));
  });

  test("counts graphemes, not UTF-16 units", () => {
    // family + aa is four graphemes, exactly the budget, and the point where a text still fits.
    const result = sanitizePinText(`${family}aa`, 4);
    expect(result.text).toBe(`${family}aa`);
    expect(result.truncated).toBe(false);
  });

  test("an empty or whitespace-only pin is empty and not truncated", () => {
    expect(sanitizePinText("", 400)).toEqual({ text: "", truncated: false });
    expect(sanitizePinText(`   ${TAB}${NL}`, 400)).toEqual({ text: "", truncated: false });
    expect(sanitizePinText(`${ESC}[31m${cp(0)}${cp(0x200b)}`, 400)).toEqual({
      text: "",
      truncated: false,
    });
  });

  test("a cut never detaches a variation selector from its base", () => {
    // Three VS16 hearts are three graphemes; a hand-rolled clusterer that counted VS16 on its own
    // would report three and refuse to cut at a budget of two. The cut keeps one heart whole.
    const heart = cp(0x2764, 0xfe0f);
    const result = sanitizePinText(heart.repeat(3), 2);
    expect(result.truncated).toBe(true);
    expect(result.text).toBe(`${heart}${cp(0x2026)}`);
  });

  test("a budget smaller than the ellipsis yields only the ellipsis", () => {
    expect(sanitizePinText(ascii(50), 1).text).toBe(cp(0x2026));
  });

  test("trimming happens before the budget, so padding cannot cost a grapheme", () => {
    const result = sanitizePinText(`  ${ascii(400)}  `, 400);
    expect(result.text).toBe(ascii(400));
    expect(result.truncated).toBe(false);
  });
});
