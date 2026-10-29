/**
 * The code points the escape scanner dispatches on, in one place so `escape.ts` (which refuses every
 * sequence) and `escape-scan.ts` (which keeps the theme's colours) decide on the same bytes.
 *
 * The six introducers have two spellings each — `ESC` plus a second byte, and the single 8-bit code — and
 * the 8-bit forms are members of the printable range above C1. A pass that *keeps* rather than strips cannot
 * dispatch on whether a byte survives: kept for its class, never for its width.
 *
 * Control characters appear as numeric code points only, as everywhere in this corner of the codebase: a
 * literal escape sequence in source is rewritten on its way into the file.
 */

/** The one code point that opens a sequence in its 7-bit form, and the six in their 8-bit form. */
export const ESC = 0x1b;
export const CSI8 = 0x9b;
export const OSC8 = 0x9d;
export const DCS8 = 0x90;
export const SOS8 = 0x98;
export const PM8 = 0x9e;
export const APC8 = 0x9f;
/** The bytes that close an unterminated string, and the two that interrupt it. */
export const BEL = 0x07;
export const ST8 = 0x9c;
export const CAN = 0x18;
export const SUB = 0x1a;

/** Is code one half of a surrogate pair? Those are not printable on their own. */
export function isSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdfff;
}

/** Is code a C1 control: neither a byte a CSI may carry nor text? */
export function isC1Control(code: number): boolean {
  return code >= 0x80 && code <= 0x9f;
}

/** Is code one of the six introducers in their 8-bit form? */
export function is8BitIntroducer(code: number): boolean {
  return (
    code === CSI8 ||
    code === OSC8 ||
    code === DCS8 ||
    code === SOS8 ||
    code === PM8 ||
    code === APC8
  );
}

/** Is code an introducer in either spelling — the only bytes a strip pass has to look at? */
export function isIntroducer(code: number): boolean {
  return code === ESC || is8BitIntroducer(code);
}
