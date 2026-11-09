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
 * `(group: Now) … (options: 1) Passed on  2) Not yet) (compact)` on screen recognises what the model was told:
 *
 * ```text
 * #4 [warning] (group: Now) Fix the gate (options: 1) Pass  2) Block) (compact)
 * ```
 *
 * Both spellings also carry the user's own last reply, between the text and the reply mark, and in the same
 * order: `… Fix the gate → ship it (replied by the user at 14:30: "ship it")`. The model's row folds the
 * reply and quotes it — the user's words must not read as a record of their own to a model that is told to
 * trust a line — while `/pins` keeps the reply's own breaks and lets the indent below take them. The mark
 * itself, `(replied by the user at HH:MM)`, is the same string on both surfaces whatever the reply holds, and
 * it appears **exactly once**: the answer is quoted and every `"` inside it is drawn as `'`, so nothing the
 * user typed can close that quote and stand outside it as the extension's own words. See `repliedSuffix`.
 *
 * `group` sits after the level and before the text, and `options` and `compact` come last, after the reply
 * note. Group and every option go through the fold before they reach the row: they were cleaned and
 * bounded when they were stored (`pin-fields.ts`), but the row is one line by this module's own promise, not
 * by whatever the pass order of another module left behind. Both surfaces number the options the way the user
 * answers them (`modelRow` and `pinsOptionsLine` share that spelling), because a label that itself contains a
 * `" | "` reads as two options to a model that is counting them — and the digit it answers with is a position.
 * The one intentional difference between the two is the shape around the numbers: the model's list is one
 * parenthesis on the row, while `/pins` spells them on their own indented line and prints no `compact` at all
 * — which is `pinsTextRow`'s header.
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

/** ` (compact)` — the pin the model marked to be read in one line, or nothing. */
function compactPart(pin: ViewPin): string {
  return pin.compact === true ? " (compact)" : "";
}

/** ` (options: 1) Pass  2) Block)` — the actions the model offered, numbered, or nothing. */
function optionsPart(pin: ViewPin): string {
  const entries = optionsEntries(pin);
  return entries === "" ? "" : ` (${entries})`;
}

/**
 * The options of one pin, numbered the way the user answers them: `options: 1) Passed on  2) Not yet`.
 *
 * Both readers take this one spelling. The model counts the entries it is being offered and answers with a
 * position, so a separator a label can contain is a miscount — the two-space join and the `n)` keycap in front
 * of each label are what keep one option reading as one. `modelRow` wraps the result in a parenthesis on the
 * row; `/pins` hands it to the indent below.
 */
function optionsEntries(pin: ViewPin): string {
  const options = pin.options;
  if (options === undefined || options.length === 0) return "";
  const entries = options.map((option, index) => `${index + 1}) ${foldBreaks(option)}`);
  return `options: ${entries.join("  ")}`;
}

/** The `/pins` options line: `options: 1) Passed on  2) Not yet`, indented under the text column, or nothing. */
function pinsOptionsLine(pin: ViewPin): string {
  const entries = optionsEntries(pin);
  return entries === "" ? "" : `\n${CONTINUATION}${entries}`;
}

/**
 * The reply note a replied pin carries on both surfaces, or nothing. `text` is the user's own words, which
 * the model's row carries inside its own quote so the model cannot read them as another record; `/pins`
 * leaves them verbatim because that surface keeps the text's own breaks and re-indents them.
 *
 * Two substitutions make the quoted answer *unambiguous* — each is the one string the row's own spelling would
 * otherwise collide with, and both are made at the row rather than in the sanitizer, so what is stored and the
 * user's own `→` copy of their words stay untouched:
 *
 * - every `"` becomes `'`: the answer is quoted with `"…"`, so a reply holding a quote would close it early and
 *   everything after it would stop reading as the user's words and start reading as the row's;
 * - every U+200B is removed and every mark is then broken with `\u00AD` (a soft hyphen): `(replied by the user
 *   at` is the one string on the row the model is told to read as the extension's own statement of when the user
 *   answered, and the row draws exactly one. The sanitizer keeps `U+200B` inside words (it strips only *edge*
 *   invisibles), so a reply can carry the mark already broken — or break it one character in — and either way
 *   reach the row looking like the extension's own sentence. Removing the invisible first is what stops a reply
 *   from pre-seeding a break or repairing one. The break the row itself inserts is therefore **not** U+200B: an
 *   invisible break would leave the quoted copy holding the extension's sentence intact for anything that
 *   ignores that one codepoint — the model among them.
 *
 * Together they mean a reply can neither open the row's quote nor say the extension's sentence inside it. Both
 * are display-only, like the fold one line up that turns a break into a space rather than letting it end the row.
 */
function repliedSuffix(pin: ViewPin, text: string): string {
  if (pin.repliedAt === undefined) return "";
  const answer = text === "" ? "" : `: "${quoteAnswer(text)}"`;
  return ` ${REPLIED_MARK} ${formatLocalTime(pin.repliedAt)}${answer})`;
}

/**
 * The mark both rows spell — the string a reply must not be able to reproduce inside its own quote, and the
 * only place its wording is written. `repliedSuffix` is built **from** it, so the two cannot drift: were one
 * reworded and not the other, the substitution below would guard a string no row ever prints. Exported for
 * `test/reply-rows.test.ts`, which holds that pairing.
 */
export const REPLIED_MARK = "(replied by the user at";

/**
 * U+200B, the one invisible the sanitizer leaves inside words — the character a reply can use to forge the mark,
 * which is why `quoteAnswer` removes every one of them before it breaks the mark.
 */
const ZERO_WIDTH = "\u200B";

/**
 * The break the row puts inside a quoted mark. A soft hyphen rather than U+200B: the point of breaking the mark
 * is that a reader of the row cannot reassemble the extension's sentence out of the user's words, and an
 * invisible break is reassembled by simply ignoring one codepoint. Exported for the row tests, which count the
 * marks a row carries **after** erasing this one and U+200B from the user's own part — the two invisibles a
 * quoted copy must not be able to hide a mark behind.
 */
export const MARK_BREAK = "\u00AD";

/**
 * The user's words as the row may quote them: no U+200B, no `\u00AD`, no `"` (it would close the row's own
 * quote) and no intact reply mark (it would read as the extension's own). See `repliedSuffix`.
 *
 * Both invisibles are removed **first**: a reply that already holds the mark broken, or broken one character
 * in, would otherwise survive as a second mark that only the invisible gives away. The row's own break is
 * stripped on the same pass as U+200B — a reply that arrived carrying it (a `ViewPin` rebuilt from a session
 * file whose text never went through `sanitizeReplyText`) would otherwise keep a mark the row has no way to
 * break, since the substitution below only ever looks for the intact string.
 */
function quoteAnswer(text: string): string {
  const bare = text.replaceAll(ZERO_WIDTH, "").replaceAll(MARK_BREAK, "");
  const broken = `(${MARK_BREAK}${REPLIED_MARK.slice(1)}`;
  return bare.replaceAll('"', "'").replaceAll(REPLIED_MARK, broken);
}

/**
 * The model's row: `#<id> [<level>] (group: <g>) <text> (replied by the user at HH:MM: "<reply>")
 * (options: 1) <a>  2) <b>) (compact)`.
 *
 * One line, whatever any field carries — the text, the group, each option and the reply are folded **by this
 * row**, in the order it spells them: `foldBreaks(pin.text)`, then `foldBreaks(reply)`, then the mark. The
 * fold cannot be left to the suffix that quotes the reply, because the fold is what removes every break shape
 * (`escape.ts`) and `formatLocalTime` inside that suffix never runs one over its argument: an unfolded reply
 * would hand a row containing a live CR to a model that is told a row is one line. The reply sits between the
 * text and the closing parenthesis of the mark, and inside a quote of its own: a row the model is told to
 * trust must not let the user's words start a record of their own, and the reply was already cut to the
 * reply's own ceilings at the write (`sanitize-reply.ts`), so a row is bounded by the pin's text plus those
 * ceilings plus the unchanged suffix.
 */
export function modelRow(pin: ViewPin): string {
  const answer = pin.reply === undefined ? "" : foldBreaks(pin.reply);
  return `#${pin.id} [${pin.level}]${groupPart(pin)} ${foldBreaks(pin.text)}${repliedSuffix(pin, answer)}${optionsPart(pin)}${compactPart(pin)}`;
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
  // Text, then the user's words, then the mark that says whose words they were — the order the model's row
  // uses too, so a user reading their own list sees the answer where the model was told to expect it.
  const body = `${pin.text}${pinsReply(pin)}${repliedSuffix(pin, pin.reply ?? "")}`;
  // Only breaks the sanitizer left behind (LF) survive here; the indent is applied to the whole body, so a
  // reply note is never stranded at column zero. The options line arrives already indented, having been built
  // from labels that each hold no break of their own.
  return head + body.replaceAll("\n", `\n${CONTINUATION}`) + pinsOptionsLine(pin);
}

/**
 * ` → ` plus the user's own words, or nothing when the pin holds none. `/pins` keeps their breaks because
 * this surface re-indents them below; a reply the sanitizer emptied falls back to the mark alone, since an
 * arrow with no words behind it would say the user answered with nothing, which is not what happened.
 */
function pinsReply(pin: ViewPin): string {
  return pin.reply === undefined || pin.reply === "" ? "" : ` \u2192 ${pin.reply}`;
}
