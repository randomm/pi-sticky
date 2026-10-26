/**
 * Which keystroke counts as a press of the panel's two *destructive* keys, and nothing else.
 *
 * `d` records a dismissal that persists on the session and `Enter` rewrites the user's editor draft, so
 * recognition of both is gated on a single bare code unit *before* pi-tui's `matchesKey` is consulted.
 * Without that gate the safety of a keystroke that changes session state would rest on how strictly
 * `matchesKey`/`ansiCodeLength` recognise the escape sequence in front of the letter: pi-tui currently
 * ends a CSI only on the final bytes `m/G/K/H/J`, so an `ESC [ 1 ; 3 d` is not a `d` press today — and if
 * that set ever widens, every such payload still fails the test here and reaches nothing. Movement keys,
 * which cannot destroy anything, keep going through `matchesKey` alone so they still answer Kitty forms.
 */
import { matchesKey } from "@earendil-works/pi-tui";

/** A single ASCII letter and nothing else — the only shape a destructive key press may take. */
const BARE = /^[a-zA-Z]$/;

/** One bare code unit that is neither an escape nor a control: the only input a destructive key reads. */
function isBarePress(data: string, letter: string): boolean {
  return data.length === 1 && BARE.test(data) && data.toLowerCase() === letter;
}

/** A press of `d` or `D`: one bare letter, whatever case the terminal sent. */
export function isDismissKey(data: string): boolean {
  return isBarePress(data, "d");
}

/**
 * A press of `Enter`: a bare carriage return or line feed, or what `matchesKey` calls `enter` for a
 * single-unit payload — never a multi-unit sequence that merely ends in `\r`, which is what a paste or a
 * bracketed-paste payload is.
 */
export function isSubmitKey(data: string): boolean {
  if (data.length > 1) return false;
  return data === "\r" || data === "\n" || matchesKey(data, "enter");
}
