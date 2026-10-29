/**
 * Shared shapes for the two files that test what a session file is allowed to say.
 *
 * `HOSTILE_PIN_TEXT` is one string carrying every escape class a hostile snapshot can use, each before a
 * marker letter that has to survive the sanitizer — so a leak *and* a loss both fail the sweep. It lives
 * here because both the pin-text surface (`state-untrusted.test.ts`) and the pins-v2-5 fields surface
 * (`state-untrusted-fields.test.ts`) hold their fields to the same promise the text is held to, and a
 * field cleaned on a code path the text never travels would drift the moment one file changed it.
 * `HOSTILE_OPTION` is the shape one `options` entry carries instead — see its own comment.
 *
 * Controls are built at runtime — a literal escape sequence written into a file is rewritten on its way
 * in and silently changes what the comparison matches.
 */
import { BEL, ESC, cp } from "./session-entries-hostile.ts";

const BS = cp(0x5c);
/** `ESC` and a backslash: the string terminator. */
const ST = `${ESC}${BS}`;
/** Kitty graphics prefix: ESC G plus a string payload. */
const KITTY = `${ESC}Gf=100,a=I,t=f;d=AAAA`;
/** 8-bit DCS introducer terminated by BEL: an unterminated one would swallow the tail. */
const DCS8 = `${cp(0x90)}payload${BEL}`;

export { BEL, BS, cp, DCS8, ESC, KITTY, ST };

/**
 * The hostile `options` entry: a shorter string than `HOSTILE`, because an option is cleaned to one
 * line and then compared with the others — the whole escape vocabulary here would clean to the same
 * text as `HOSTILE` and the uniqueness rule, not the escape sweep, would decide the assertion.
 */
export const HOSTILE_OPTION = `${ESC}[2JA${ESC}]8;;https://evil${ESC}${BS}B${BEL}${cp(0x202e)}C${cp(0x200b)}D${cp(0xdc00)}E`;

/** Every escape and control a hostile snapshot's pin text can carry, each before its own marker. */
export const HOSTILE_PIN_TEXT = [
  "deploy",
  `${ESC}]52;c;AAAA${BEL}A`, // OSC 52 clipboard write
  `${ESC}]8;;https://evil${ST}B`, // OSC 8 hyperlink
  `${ESC}[2JC`, // CSI erase screen
  `${ESC}]8;;${ST}D`, // closing OSC 8
  `${ESC}_pi:c${BEL}E`, // pi-tui's private APC marker
  `${KITTY}${ST}F`, // Kitty image prefix
  `${DCS8}G`, // 8-bit DCS
  `H${cp(0x202e)}`, // RIGHT-TO-LEFT OVERRIDE
  `I${String.fromCharCode(0xdc00)}`, // lone low surrogate
  "failed",
].join("");
