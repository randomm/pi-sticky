/**
 * The escape sequence that closes a colour, and the classifier that says whether a line needs it.
 *
 * A panel is a flush-right overlay: an unclosed background from a theme's `selected`, or a faint from its
 * `dim`, would bleed onto the columns beside the frame and onto whatever pi-tui paints next. So every drawn
 * line asks `sgrResetFor` once and appends its answer — the guarantee the frame owes the screen now that a
 * theme's colour survives to it (`selectionReset`, `panel-frame.ts`).
 *
 * The decision is made by the same walk that strips the sequences (`escape-scan.ts`), not by a second parser
 * that could disagree with it about what an escape is.
 */
import { isIntroducer } from "./escape-chars.ts";
import { scanSequence } from "./escape-scan.ts";

/** `ESC [`, spelled from code points as everywhere in this corner of the codebase. */
export const SGR_PREFIX = `${String.fromCharCode(0x1b)}[`;

/** `ESC [ 0 m` — the one sequence that closes every attribute a theme may have opened. */
export const SGR_RESET = `${SGR_PREFIX}0m`;

/**
 * An SGR reset for `line` when it opened a colour and never closed it, and `""` when it did not — a line
 * that needs no reset is left exactly as it was measured, so an uncoloured frame keeps drawing no escape
 * bytes at all.
 */
export function sgrResetFor(line: string): string {
  return opensColour(line) ? SGR_RESET : "";
}

/**
 * Is the last SGR the line kept an opening rather than a reset?
 *
 * A reset is `ESC [ 0 m` (or the bare `ESC [ m`), so the walk ends there with nothing owed; anything else it
 * ends with — `ESC [ 7 m`, a `48;2;…` background — is a colour the terminal is still wearing. Sequences the
 * walk does not keep never open anything: a theme's OSC or DCS is refused before a line reaches here, and a
 * refused sequence cannot bleed.
 */
function opensColour(text: string): boolean {
  let open = false;
  let i = 0;
  while (i < text.length) {
    const code = text.charCodeAt(i);
    if (!isIntroducer(code)) {
      i += 1;
      continue;
    }
    const sequence = scanSequence(text, i, code);
    const consumed = sequence.length;
    if (consumed < 0) {
      i = 0 - consumed;
      continue;
    }
    if (sequence.kept) open = !isSgrReset(text.slice(i, i + consumed));
    i += consumed;
  }
  return open;
}

/** Is `sequence` a full SGR reset — `ESC [ m`, `ESC [ 0 m`, or the `0;0` spelling of the same thing? */
export function isSgrReset(sequence: string): boolean {
  if (!sequence.endsWith("m") || !sequence.startsWith(SGR_PREFIX)) return false;
  const params = sequence.slice(SGR_PREFIX.length, -1);
  return params === "" || /^0+(?:;0+)*$/.test(params);
}
