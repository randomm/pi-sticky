/**
 * The panel's keyboard: the two shortcut ids the extension registers, and which keystroke counts as a
 * press of the panel's two *destructive* keys.
 *
 * Split from the geometry because nothing here is a number: the registrations, the tests that fire the
 * keys and the assertions that refuse hostile input all quote these, so a rebind is one edit rather than
 * a hunt through four files.
 *
 * `d` records a dismissal that persists on the session and `Enter` rewrites the user's editor draft, so
 * recognition of both is gated on a single bare code unit *before* pi-tui's `matchesKey` is consulted.
 * Without that gate the safety of a keystroke that changes session state would rest on how strictly
 * `matchesKey`/`ansiCodeLength` recognise the escape sequence in front of the letter: pi-tui currently
 * ends a CSI only on the final bytes `m/G/K/H/J`, so an `ESC [ 1 ; 3 d` is not a `d` press today — and if
 * that set ever widens, every such payload still fails the test here and reaches nothing. Movement keys,
 * which cannot destroy anything, keep going through `matchesKey` alone so they still answer Kitty forms.
 *
 * The two ids below are the defaults only: the grammar an operator's rebind has to pass and the
 * registration itself live in `panel-shortcuts.ts`. They are stated here, next to the panel's other
 * keystrokes, and `config.ts` imports them for its fallbacks so neither default is spelled twice.
 */
import { matchesKey } from "@earendil-works/pi-tui";
import type { KeyId } from "@earendil-works/pi-tui";

/** The two shortcuts the extension registers when the operator has rebound neither, spelled once. */
export const TOGGLE_KEY: KeyId = "ctrl+alt+t";
export const FOCUS_KEY: KeyId = "ctrl+alt+p";

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
 *
 * A known narrowing, deliberate rather than accidental: under the Kitty keyboard protocol pi-tui also
 * encodes Enter as multi-unit CSI-u / SS3 payloads (`\x1b[57414u`, `\x1b[13;1u`, `\x1bOM`) which
 * `matchesKey` accepts and this refuses, so replying from the panel is legacy-CR only there. The gate is
 * the safety property — a payload long enough to be a stream is never a key press — and widening it by
 * enumerating Kitty Enter forms would trade it for a feature no terminal in this repo's test matrix uses.
 */
export function isSubmitKey(data: string): boolean {
  if (data.length > 1) return false;
  return data === "\r" || data === "\n" || matchesKey(data, "enter");
}

/** One of `keys` pressed, whatever shape the terminal sent it in. */
export function presses(data: string, keys: readonly KeyId[]): boolean {
  return keys.some((key) => matchesKey(data, key));
}
