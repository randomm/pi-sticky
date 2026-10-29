/**
 * The hostile theme `marker`s the two marker-cell files share.
 *
 * `panel-frame-marker.test.ts` asks `markerCell` its own arithmetic (the padding branch, the cut branch, the
 * controls that must not survive either); `panel-frame-marker-hostile.ts` draws the same markers through a
 * whole frame at every width. One list of shapes is the point: a shape added to one file and not the other
 * is a shape whose cell is clean and whose row is not, which is exactly the split the #70 review found.
 *
 * Every escape is spelled from code points — a literal written into a source file is rewritten on the way in,
 * and an escape assertion against a rewritten literal is vacuous whenever both sides agree by accident.
 */

/** The introducer, one colour, and the drawer's injected reset, spelled out. */
export const E = String.fromCharCode(0x1b);
export const SGR = `${E}[33m`;
export const RESET = `${E}[0m`;
export const BEL = String.fromCharCode(0x07);
export const DEL = String.fromCharCode(0x7f);
export const C1 = (code: number): string => String.fromCharCode(code);

/** The plain one-column glyph every level's marker is measured against. */
export const ONE = "!";
/** Enough visible bytes past the glyph's column to force `markerCell`'s cut branch. */
export const OVERFLOW = "AAAA";

/**
 * What the panel drew, read byte by byte and *sequence aware*: every C0 but TAB, DEL, every C1, and a
 * surrogate left without its partner. Written from the ranges themselves rather than from the classifier the
 * sweeps defer to, so a bug in that classifier cannot be certified by a scan that asked it the same question
 * it answered.
 *
 * An `ESC [ … m` is walked over whole and not named: it is the colour the theme asked for and the one
 * sequence the panel draws, so a scan that called its introducer a bare C0 would name every coloured row of
 * an ordinary frame.
 */
export function byteScan(text: string): string[] {
  const bad: string[] = [];
  const body = text.replace(new RegExp(`${E}\\[[0-9;]*m`, "g"), "");
  for (let i = 0; i < body.length; i++) {
    const code = body.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = body.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        i += 1;
        continue;
      }
      bad.push(`lone surrogate 0x${code.toString(16)}`);
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      bad.push(`lone surrogate 0x${code.toString(16)}`);
    } else if (code === 0x7f) bad.push("DEL 0x7f");
    else if (code >= 0x80 && code <= 0x9f) bad.push(`C1 0x${code.toString(16)}`);
    else if (code < 0x20 && code !== 0x09) bad.push(`C0 0x${code.toString(16)}`);
  }
  return bad;
}

/**
 * The shapes a hostile `marker` writes around the glyph it wraps. Each is one the two passes used to disagree
 * about: `stripNonSgr` is a *sequence* pass, so a byte it neither keeps nor recognises survived it, and the
 * cut branch's re-attach copied it back out of the theme's raw string under the colour of a marker that did.
 */
export const HOSTILE_MARKER: ((text: string) => string)[] = [
  // The review's shape: a colour, SO, the glyph, an 8-bit erase-screen, a BEL, an OSC 8, a reset.
  (s) => `${SGR}${C1(0x0e)}${s}${C1(0x9b)}2J${BEL}${E}]8;;x${E}\\${RESET}`,
  // C1s the scanner does not dispatch on — DCS8/SOS8/PM8/APC8 are introducers; these are not.
  (s) => `${SGR}${C1(0x90)}${s}${OVERFLOW}`,
  (s) => `${SGR}${C1(0x98)}${s}${OVERFLOW}`,
  (s) => `${SGR}${C1(0x9e)}${s}${OVERFLOW}`,
  (s) => `${SGR}${C1(0x9f)}${s}${OVERFLOW}`,
  // The same bytes after visible text, so the cell is cut and the offsets land past them.
  (s) => `${SGR}X${C1(0x90)}${s}${OVERFLOW}`,
  (s) => `${SGR}X${C1(0x9f)}${s}${OVERFLOW}`,
  // C0s that are not break shapes, and DEL, written between two colours.
  (s) => `${SGR}${C1(0x0f)}${s}${OVERFLOW}`,
  (s) => `${SGR}${C1(0x18)}${s}${OVERFLOW}`,
  (s) => `${SGR}${DEL}${s}${OVERFLOW}`,
  // A lone surrogate: the drawn policy is neither a sequence pass nor a surrogate pass, so it hands either
  // half through, and a walk that advanced by code units emitted half a pair as its own column.
  (s) => `${SGR}${C1(0xd83d)}${s}${OVERFLOW}`,
  (s) => `${SGR}${C1(0xdc00)}${s}${OVERFLOW}`,
  // Astral glyphs past the glyph's columns: the cut runs by columns, so a pair is kept or dropped whole.
  (s) => `${SGR}${"\u{1f600}".repeat(3)}${s}${OVERFLOW}`,
  // A refused sequence in front of visible bytes, so the cut runs and the offsets after it shift.
  (s) => `${SGR}${E}]0;evil${BEL}${s}${OVERFLOW}`,
  (s) => `${SGR}${E}Pq payload${E}\\${s}${OVERFLOW}`,
  (s) => `${SGR}${E}[2J${s}${OVERFLOW}`,
];
