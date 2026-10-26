/**
 * The hostile bytes a pin can carry, and the sweep that says a drawn line is free of them.
 *
 * Shared by `panel-lines.test.ts` (the builder) and `integration-panel.test.ts` (a whole session),
 * which are the two places that can put them on screen. The sanitizer is what removes them from a
 * pin; these files prove the panel's own wrapping, padding and theming do not put any back.
 */

/** The escapes pi-tui itself recognises, so a pin that survives them would be parsed as input. */
export const ESC = String.fromCharCode(0x1b);
export const BEL = String.fromCharCode(0x07);
export const ST = `${ESC}\\`;
export const KITTY = `${ESC}[?u`;
export const DCS8 = `${ESC}P8`;

/** Every escape and control a hostile pin can carry, each before its own marker. */
export const HOSTILE = [
  "deploy",
  `${ESC}]52;c;AAAA${BEL}A`,
  `${ESC}]8;;https://evil${ST}B`,
  `${ESC}[2JC`,
  `${ESC}]8;;${ST}D`,
  `${ESC}_pi:c${BEL}E`,
  `${KITTY}${ST}F`,
  `${DCS8}G`,
  `H${String.fromCharCode(0x202e)}`,
  `I${String.fromCharCode(0xdc00)}`,
  "failed",
].join("");

/** A lone low surrogate, which is what a cut through a surrogate pair leaves behind. */
export const LONE_SURROGATE = String.fromCharCode(0xdc00);
/** A trailing string, so a cut has something to cut. */
export const TAIL = "tail";
/** Right-to-left override: reorders the row it is drawn into. */
export const RLO = String.fromCharCode(0x202e);

/** The code points a drawn line must never carry. */
export function offenders(text: string): string[] {
  const bad: string[] = [];
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        i += 1;
        continue;
      }
      bad.push(`lone surrogate 0x${code.toString(16)}`);
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      bad.push(`lone surrogate 0x${code.toString(16)}`);
    } else if (code === 0x1b) bad.push("ESC 0x1b");
    else if (code >= 0x80 && code <= 0x9f) bad.push(`C1 0x${code.toString(16)}`);
    else if (code === 0x202e) bad.push("U+202E");
  }
  return bad;
}
