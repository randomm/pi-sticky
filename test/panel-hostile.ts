/**
 * The hostile bytes a pin can carry, and the sweep that says a drawn line is free of them.
 *
 * Shared by `panel-lines.test.ts` (the builder) and `integration-panel.test.ts` (a whole session),
 * which are the two places that can put them on screen. The sanitizer is what removes them from a
 * pin; these files prove the panel's own wrapping, padding and theming do not put any back.
 *
 * The file also states the terminal the panel tests draw against. A frame's height comes from
 * `panelMaxRows`, which halves the terminal it is given, so a builder test names that terminal and
 * never passes a frame's own height as one: the two are different quantities and an earlier shape let
 * a test conflate them.
 */

/**
 * The terminal rows a panel test sizes a frame against: an explicit terminal, not the height of the
 * frame it is drawing. A frame drawn at this height is `TERMINAL_ROWS / 2` rows tall.
 */
import { PANEL_MIN_FRAME_COLUMNS } from "../src/panel-geometry.ts";

export const TERMINAL_ROWS = 40;

/**
 * The smallest size at which the frame builder closes a frame at all: the overlay's own `minWidth`, spelled
 * as `PANEL_MIN_FRAME_COLUMNS` so the two cannot drift apart silently. A sweep that walks the widths names
 * this as its floor.
 */
export const MIN_FRAME_WIDTH = PANEL_MIN_FRAME_COLUMNS;

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

/**
 * Inputs that end in a key the panel owns without being that key: CSI cursor-position and cursor-back,
 * an `O`-prefixed final, an ESC-bracketed paste, OSC and APC with the letter in their string body, a `d`
 * carrying a NUL, a surrogate or surrounding spaces, and `d` glued to a CR. None is a bare press, so none
 * may dismiss or reply — see `isBarePress` in `src/panel-keys.ts`, which is consulted *before* `matchesKey`.
 */
export const HOSTILE_KEY_INPUTS = [
  `${ESC}[1;3d`,
  `${ESC}Od`,
  `${ESC}d`,
  `${LONE_SURROGATE}d`,
  "d\0",
  " d",
  " d ",
  `${ESC}[0md`,
  `${ESC}]0;d${BEL}`,
  `${ESC}_pi;d${BEL}`,
  `${ESC}[1;3D`,
  `${ESC}d\r`,
  "d\r",
  "\rd",
  `${ESC}[200~d`,
];

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
