/**
 * `cleanPinText` tested on its own: the same passes as `sanitizePinText` without the grapheme
 * budget, which is the half that `reconstruct` and `applyAction` depend on and the half a budget
 * assertion cannot reach — whatever maxChars a test picked would be a number those callers never
 * used, and a cut would hide whether a pass kept or dropped what it was given.
 *
 * Idempotence is the other thing pinned here. The tool cleans with the budget and the reducer runs
 * the whole pipeline again over the text it then stores, and `reconstruct` runs it a third time over
 * a snapshot read out of a session file; a pass that changed anything on a second application would
 * change what the user sees between one rebuild and the next.
 *
 * The pass-isolating cases each name the pass they aim at, but every assertion is on the whole
 * output: the passes are ordered on purpose (see the header of src/sanitize.ts), so an input aimed at
 * one of them necessarily travels through the others, and `test/sanitize-order.test.ts` is what pins
 * the order itself.
 *
 * Controls are built at runtime — a literal escape sequence written into a file is rewritten on its
 * way in and silently changes what the comparison matches.
 */
import { describe, expect, test } from "bun:test";

import { cleanPinText, sanitizePinText } from "../src/sanitize.ts";
import { BEL, ESC, cp } from "./session-entries-hostile.ts";

const NL = cp(0x0a);
const CR = cp(0x0d);
const TAB = cp(0x09);
/** The smallest maxChars the tool can be configured with, so the cut below is a real one. */
const MIN_MAX_CHARS = 40;
const graphemes = (text: string): string[] =>
  [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text)].map(
    ({ segment }) => segment,
  );

/** `[name, raw, cleaned]` — each carries its own hostile bytes before a marker that must survive. */
const CASES: [string, string, string][] = [
  [
    "escape bytes from four introducer classes",
    `ab${ESC}]52;c;AAAA${BEL}cd${ESC}[31me${ESC}Pq${BEL}fg`,
    "abcdefg",
  ],
  ["C0, DEL and C1 controls", `a${cp(0)}b${BEL}c${cp(8)}d${cp(31)}e${cp(127)}g`, "abcdeg"],
  [
    "every line-break shape, with a run of breaks collapsed",
    `a${CR}b${TAB}c${NL}${NL}${NL}${NL}d${cp(0x85)}e`,
    `a${NL}b c${NL}${NL}d${NL}e`,
  ],
  [
    "bidi, zero-width and format characters",
    `a${cp(0x202e)}b${cp(0x2066)}c${cp(0x200b)}d${cp(0x200c)}e${cp(0x2060)}f${cp(0xfeff)}g`,
    "abcdefg",
  ],
  [
    "a lone surrogate dropped and a valid pair kept",
    `a${String.fromCharCode(0xd800)}b${cp(0x1f600)}`,
    `ab${cp(0x1f600)}`,
  ],
  [
    "runaway combining marks of two classes",
    `e${cp(0x301, 0x301, 0x301, 0x301, 0x301, 0x301)}x${cp(0x20e3, 0x20e3, 0x20e3, 0x20e3, 0x20e3, 0x20e3)}`,
    `e${cp(0x301, 0x301, 0x301, 0x301)}x${cp(0x20e3, 0x20e3, 0x20e3, 0x20e3)}`,
  ],
  [
    "digits at both edges and a run of breaks padded with a digit",
    `${CR}Plan 3${CR}${NL}${NL}Step 13${NL}${cp(0x85)}1st${NL}3${TAB}`,
    `Plan 3${NL}${NL}Step 13${NL}${NL}1st${NL}3`,
  ],
];

// The digit-edged cases themselves — every edge shape, every digit position, and the repeated clean
// the reducer and `reconstruct` perform — live in `sanitize-digit-edge.test.ts`, the file that fails
// while the edge class carries the characters "1" and "3".

describe("cleanPinText applies every pass and no budget", () => {
  test.each(CASES)("%s cleans to exactly the expected text", (_name, raw, expected) => {
    expect(cleanPinText(raw)).toBe(expected);
  });

  test("text longer than a budget is left whole, and cut at the smallest configurable budget", () => {
    // 40 is the smallest maxChars the tool can be configured with (the clamp in src/config.ts), so
    // the cut below is a budget a real caller sets rather than a number invented for the assertion.
    const raw = `   ${"keep".repeat(30)}${TAB}${NL}`;
    const whole = cleanPinText(raw);
    expect(whole).toBe("keep".repeat(30));
    expect(graphemes(whole).length).toBe(120);
    expect(sanitizePinText(raw, MIN_MAX_CHARS)).toEqual({
      text: `${whole.slice(0, MIN_MAX_CHARS - 1)}${cp(0x2026)}`,
      truncated: true,
    });
  });

  test("the budget keeps a prefix of what cleanPinText returned, not a rewrite of it", () => {
    // `reconstruct` shows the whole cleaned pin and the tool shows the cut: the two must agree about
    // the characters present in both, which is only true if the budget is a suffix-free cut.
    const raw = `a${ESC}[31m${"long".repeat(40)}${BEL}`;
    const whole = cleanPinText(raw);
    expect(whole).toBe(`a${"long".repeat(40)}`);
    expect(sanitizePinText(raw, MIN_MAX_CHARS).text).toBe(`${whole.slice(0, 39)}${cp(0x2026)}`);
  });

  test("no control, escape or U+202x survives without a budget to catch it", () => {
    for (const [, raw] of CASES) {
      const text = cleanPinText(raw);
      for (let i = 0; i < text.length; i++) {
        const code = text.charCodeAt(i);
        const printable = code === 0x0a || (code >= 0x20 && code <= 0x7e) || code >= 0xa0;
        expect(printable).toBe(true);
        // U+2028 and U+2029 are >= 0xa0, so `printable` alone cannot catch them: only the newline
        // fold can, and this is the half of the claim the budget-level sweep cannot make.
        expect(code === 0x2028 || code === 0x2029).toBe(false);
      }
    }
  });
});

describe("cleanPinText is idempotent", () => {
  test.each(CASES)("%s comes back unchanged when cleaned twice", (_name, raw) => {
    const once = cleanPinText(raw);
    expect(cleanPinText(once)).toBe(once);
  });

  test("the shapes the budget tests build are fixed points too", () => {
    const cases: string[] = [
      "",
      `   ${TAB}${NL}`,
      cp(0x1f468, 0x200d, 0x1f469, 0x200d, 0x1f467),
      cp(0x2764, 0xfe0f).repeat(3),
      cp(0x1f1e6, 0xe0061, 0xe0062, 0xe007f),
      `x${cp(0x300, 0x301, 0x301, 0x301, 0x301, 0x301)}`,
      `a${cp(0x2028)}b${cp(0x2029)}c`,
      `${ESC}]0;t${ESC}[31mx`,
      `a${ESC}Mb`,
      `abc${ESC}`,
    ];
    for (const raw of cases) {
      const once = cleanPinText(raw);
      expect(cleanPinText(once)).toBe(once);
    }
    // Idempotence has to hold for output the *budget* produced as well: the reducer re-cleans the
    // string the tool cut, so an ellipsis may not start a second cut or be dropped as a format mark.
    const cut = sanitizePinText("long ".repeat(200), MIN_MAX_CHARS).text;
    expect(cleanPinText(cut)).toBe(cut);
  });

  test("re-cleaning text the reducer already stored changes nothing", () => {
    const stored = cleanPinText(`de${cp(0x200b)}ploy${BEL}${ESC}[2J`);
    expect(stored).toBe("deploy");
    expect(cleanPinText(cleanPinText(stored))).toBe(stored);
  });
});

describe("cleanPinText isolates each pass by its input", () => {
  test("stripControls: tab, CR, NEL and the two U+202x all reach the newline fold", () => {
    expect(cleanPinText(`a${TAB}b${CR}c${cp(0x85)}d${cp(0x2028)}e${cp(0x2029)}f`)).toBe(
      `a b${NL}c${NL}d${NL}e${NL}f`,
    );
  });

  test("stripControls: three breaks become two and only the edges are trimmed", () => {
    expect(cleanPinText(`${NL}${NL}${NL}a${NL}${NL}${NL}${NL}b${NL}${NL}`)).toBe(`a${NL}${NL}b`);
  });

  test("dropInvisible: every format character goes outside an emoji cluster", () => {
    expect(
      cleanPinText(`a${cp(0x200b)}b${cp(0x200c)}c${cp(0x200d)}d${cp(0x2060)}e${cp(0xfeff)}f`),
    ).toBe("abcdef");
    expect(cleanPinText(`a${cp(0x202e)}b${cp(0x2066)}c${cp(0x61c)}d`)).toBe("abcd");
  });

  test("dropInvisible: the emoji exception is decided by the base, so VS16 on a letter goes", () => {
    expect(cleanPinText(`${cp(0x2764, 0xfe0f)}a${cp(0xfe0f)}b${cp(0x200d)}c`)).toBe(
      `${cp(0x2764, 0xfe0f)}abc`,
    );
    expect(cleanPinText(cp(0x1f468, 0x200d, 0x1f469))).toBe(cp(0x1f468, 0x200d, 0x1f469));
  });

  test("dropInvisible: the whole tag block goes, including the code points that are not Cf", () => {
    // U+E0000-U+E007F is only partly \p{Cf}, so without the explicit range the tail of a flag lives on.
    expect(cleanPinText(`${cp(0x1f1e6)}${cp(0xe0061, 0xe0062, 0xe007f)}`)).toBe(cp(0x1f1e6));
    expect(cleanPinText(`x${cp(0xe0000)}${cp(0xe007f)}y`)).toBe("xy");
  });

  test("capMarks: two clusters get two independent budgets", () => {
    // Six marks on each of two bases. A counter shared by the string would cap it at four in total
    // and gut the second cluster, which is not what "per grapheme" promises.
    const capped = cp(0x301, 0x301, 0x301, 0x301);
    const six = cp(0x301, 0x301, 0x301, 0x301, 0x301, 0x301);
    expect(cleanPinText(`e${six}x${six}`)).toBe(`e${capped}x${capped}`);
  });

  test("dropLoneSurrogates: a pair is kept whole and half a pair never survives", () => {
    for (const raw of [
      String.fromCharCode(0xd800),
      String.fromCharCode(0xdc00),
      `a${String.fromCharCode(0xd83d)}b`,
      `${cp(0x1f600)}${String.fromCharCode(0xdfff)}`,
    ]) {
      const text = cleanPinText(raw);
      for (let i = 0; i < text.length; i++) {
        const code = text.charCodeAt(i);
        if (code >= 0xd800 && code <= 0xdbff) {
          expect(text.charCodeAt(i + 1) >= 0xdc00 && text.charCodeAt(i + 1) <= 0xdfff).toBe(true);
          i += 1;
        } else {
          expect(code >= 0xdc00 && code <= 0xdfff).toBe(false);
        }
      }
    }
    expect(cleanPinText(`${cp(0x1f600)}${String.fromCharCode(0xdfff)}`)).toBe(cp(0x1f600));
  });

  test("the escape pass runs before the printable test, so an introducer is never kept as text", () => {
    // The 8-bit introducers sit inside the printable range the control pass keeps, so a scanner that
    // dispatched on "is this kept" rather than "is this an introducer" would keep them as text.
    // CSI alone keeps its payload when it reaches no final byte, so it is driven separately below.
    for (const code of [0x9d, 0x90, 0x98, 0x9e, 0x9f]) {
      const cleaned = cleanPinText(`a${cp(code)}payload${BEL}b`);
      expect(cleaned).toBe("ab");
      expect(cleaned).not.toInclude(cp(code));
    }
    expect(cleanPinText(`a${cp(0x9b)}31m`)).toBe("a");
    expect(cleanPinText(`a${cp(0x9b)}31m${BEL}z`)).toBe("az");
  });

  test("an emoji cluster needs no budget to stay whole: family, hearts and a flag survive intact", () => {
    // The same three shapes the budget tests cut; here nothing is cut, so what is pinned is that the
    // passes leave a joined family, a VS16 heart and a flag base exactly as they came in.
    expect(cleanPinText(cp(0x1f468, 0x200d, 0x1f469, 0x200d, 0x1f467))).toBe(
      cp(0x1f468, 0x200d, 0x1f469, 0x200d, 0x1f467),
    );
    expect(cleanPinText(cp(0x2764, 0xfe0f).repeat(3))).toBe(cp(0x2764, 0xfe0f).repeat(3));
    expect(cleanPinText(cp(0x1f1e6, 0xe0061, 0xe0062, 0xe007f))).toBe(cp(0x1f1e6));
  });
});
