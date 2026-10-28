/**
 * The model-facing row of a pin: the one line a pin becomes in `renderList` and in `/pins`.
 *
 * Two spellings of the same pin, and the difference is who reads it. The model's row is exactly one line —
 * every field folded, nothing it carries allowed to start a new line — because `src/tool.ts`'s guidelines
 * tell the model to trust a line that reads like a pin row or like a user reply, and the post-compaction
 * reminder interpolates the same rows. The user's `/pins` row keeps its own line breaks and re-indents them,
 * because a transcript line is not a channel the model reads back.
 *
 * Both spellings carry the same three v2 fields, in the same positions, so a user who reads
 * `(group: Now) … (options: Passed on | Not yet) (compact)` on screen recognises what the model was told:
 *
 * ```text
 * #4 [warning] (group: Now) Fix the gate (options: Pass | Block) (compact)
 * ```
 *
 * `group` sits after the level and before the text, and `options` and `compact` come last, after the reply
 * note. Group and every option go through the fold before they reach the row: they were cleaned and
 * bounded when they were stored (`pin-fields.ts`), but the row is one line by this module's own promise, not
 * by whatever the pass order of another module left behind. `/pins` spells the same fields differently — the
 * options on their own indented line, and no `compact` at all — which is `pinsTextRow`'s header.
 *
 * The fold is `foldBreaks` (`escape.ts`) taken directly rather than `toOneLine` (`render.ts`): this module is
 * one of `render.ts`'s own dependencies, and reaching back into its caller for a one-line re-export of a
 * function that sits below both is the value-level cycle `test/panel-import-cycle.test.ts` exists to catch.
 */
import { foldBreaks } from "./escape.ts";
import { formatLocalTime } from "./time.ts";
import type { ViewPin } from "./types.ts";

/** Continuation indent for a pin text that carries line breaks (the `/pins` surface only). */
const CONTINUATION = "   ";

/** ` (group: Now)` — the section the model filed the pin under, or nothing. */
function groupPart(pin: ViewPin): string {
  return pin.group === undefined ? "" : ` (group: ${foldBreaks(pin.group)})`;
}

/** ` (options: Pass | Block)` — the actions the model offered, in the order it named them, or nothing. */
function optionsPart(pin: ViewPin): string {
  const options = pin.options;
  if (options === undefined || options.length === 0) return "";
  return ` (options: ${options.map((option) => foldBreaks(option)).join(" | ")})`;
}

/** ` (compact)` — the pin the model marked to be read in one line, or nothing. */
function compactPart(pin: ViewPin): string {
  return pin.compact === true ? " (compact)" : "";
}

/**
 * The `/pins` options line: `options: 1) Passed on  2) Not yet`, indented under the text column, or nothing.
 *
 * Numbered the way the user answers them — the panel's options row prints the same digits beside the same
 * keycaps — and separated by two spaces so a label with a space inside cannot read as two entries. Nothing
 * here is markup: `/pins` is a transcript line and a leading `#` must always mean a pin id.
 */
function pinsOptionsLine(pin: ViewPin): string {
  const options = pin.options;
  if (options === undefined || options.length === 0) return "";
  const entries = options.map((option, index) => `${index + 1}) ${foldBreaks(option)}`);
  return `\n${CONTINUATION}options: ${entries.join("  ")}`;
}

/** The reply note a replied pin carries on both surfaces, or nothing. */
function repliedSuffix(pin: ViewPin): string {
  if (pin.repliedAt === undefined) return "";
  return ` (replied by the user at ${formatLocalTime(pin.repliedAt)})`;
}

/**
 * The model's row: `#<id> [<level>] (group: <g>) <text> (replied …) (options: <a> | <b>) (compact)`.
 *
 * One line, whatever any field carries — the text, the group and each option are folded, and the suffix
 * interpolates `formatLocalTime`, which is already ASCII `HH:MM` or `--:--`.
 */
export function modelRow(pin: ViewPin): string {
  return `#${pin.id} [${pin.level}]${groupPart(pin)} ${foldBreaks(pin.text)}${repliedSuffix(pin)}${optionsPart(pin)}${compactPart(pin)}`;
}

/**
 * The `/pins` row of one pin: the model's parts minus `compact`, with the local time after the level, the
 * options spelled on their own indented line, and the text's own breaks re-indented under the text column.
 *
 * `compact` is left out on purpose: it is a drawing instruction the panel obeys, and a user reading their own
 * list has no use for the flag that told the frame to spend one row rather than four. Nothing here is markup:
 * pi draws `ctx.ui.notify` text as-is, so a leading `#` always means a pin id and never a heading, and no
 * emphasis or bullet is introduced for a Markdown parser on the host side to read as structure.
 */
export function pinsTextRow(pin: ViewPin): string {
  const head = `#${pin.id} [${pin.level}]${groupPart(pin)} ${formatLocalTime(pin.createdAt)} `;
  const body = `${pin.text}${repliedSuffix(pin)}`;
  // Only breaks the sanitizer left behind (LF) survive here; the indent is applied to the whole body, so a
  // reply note is never stranded at column zero. The options line arrives already indented, having been built
  // from labels that each hold no break of their own.
  return head + body.replaceAll("\n", `\n${CONTINUATION}`) + pinsOptionsLine(pin);
}
