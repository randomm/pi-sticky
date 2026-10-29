/**
 * The escape-sequence fixtures both `test/escape.test.ts` and `test/escape-non-sgr.test.ts` drive.
 *
 * The two files ask two different questions of one scanner (`escape-scan.ts`): what `stripSequences`
 * removes from untrusted pin text, and what `stripNonSgr`/`containsNonSgr` allow on a *drawn* line once
 * the panel's own SGR policy is in force (#70). The table of classes below is the shared half of that —
 * one list, so a class cannot be tested on one pass and quietly missed on the other.
 *
 * Controls are built at runtime. A literal escape sequence written into a source file is rewritten on its
 * way in, and a comparison against a rewritten literal passes or fails by accident.
 */

export const cp = (...codes: number[]): string => String.fromCodePoint(...codes);
export const ESC = cp(0x1b);
export const BEL = cp(0x07);
export const BS = cp(0x5c); // backslash, the second half of ST
export const CAN = cp(0x18);
export const SUB = cp(0x1a);
export const ST8 = cp(0x9c); // 8-bit STRING TERMINATOR
export const CSI8 = cp(0x9b);
export const OSC8 = cp(0x9d);
export const DCS8 = cp(0x90);
export const SOS8 = cp(0x98);
export const PM8 = cp(0x9e);
export const APC8 = cp(0x9f);
/** ST written the only way this file can: ESC then a backslash. */
export const ST = `${ESC}${BS}`;

/** `ESC [` + parameters, spelled from code points. */
export const csi = (parameters: string): string => `${ESC}[${parameters}`;
export const SGR_RED = csi("31m");
export const SGR_TRUE_COLOUR = csi("38;2;12;34;56m");
export const SGR_RESET = csi("0m");

/** The refused sequence of each class, padded with the text that must survive around it. */
export const pad = (sequence: string): string => `a${sequence}b`;

/** Non-SGR sequences of every class the panel's hostile sweeps name. */
export const NON_SGR: ReadonlyArray<readonly [string, string]> = [
  ["cursor position", csi("1;1H")],
  ["erase display", csi("2J")],
  ["erase in line", csi("K")],
  ["private mode", csi("?25l")],
  ["OSC 8 hyperlink", `${ESC}]8;;https://evil${ST}`],
  ["OSC 52 clipboard", `${ESC}]52;c;AAAA${BEL}`],
  ["OSC 2 title", `${ESC}]2;owned${BEL}`],
  ["DCS", `${ESC}Pq payload${ST}`],
  ["8-bit DCS", `${DCS8}q payload${BEL}`],
  ["APC", `${ESC}_pi:c${BEL}`],
  ["8-bit APC", `${APC8}opaque${BEL}`],
  ["SOS", `${SOS8}secret${BEL}`],
  ["PM", `${PM8}private${BEL}`],
  ["Kitty image prefix", `${ESC}Gf=100,a=I${ST}`],
  ["two-character ESC", `${ESC}M`],
  ["C1 control", cp(0x80)],
];

/** Is `sequence` one of the bare C1 controls rather than an ESC-led or 8-bit-introduced sequence? */
export function isC1(sequence: string): boolean {
  const code = sequence.charCodeAt(0);
  return sequence.length === 1 && code >= 0x80 && code <= 0x9f;
}
