/**
 * The pin text budget: how long a pin's text may be, and the one sentence that says it is not.
 *
 * The budget is config (`PI_STICKY_MAX_CHARS`), so only the tool has it — which is why the refusal
 * lives here rather than in the reducer. The reducer's own bound (`cleanTextOrUndefined`,
 * `MAX_TEXT_UNITS`) stays the answer for callers that have no config; this module answers for the
 * caller that does.
 *
 * The cut lives in `sanitizePinText`, the pass that bounds a text to its ceiling for a caller that
 * cannot refuse; the session-file readers (`reconstruct`) run only `cleanPinText`, which cleans without
 * cutting, so no production path hands a text to the cut after the fact.
 *
 * The sentence is exported because every copy of it — the README's bullet, its env-table row and the
 * sticky-basics skill — is pinned byte-for-byte to this builder by the doc-fact tests, none of which
 * spells the number themselves.
 */
import { cleanPinText, graphemesOf } from "./sanitize.ts";

/** What the tool found when it measured one call's text against the configured budget. */
export type TextBudget = { ok: true; text: string } | { ok: false; error: string };

/**
 * The refusal for a text that is too long once it has been cleaned. `maxChars` is the configured
 * budget and `got` the grapheme count of the cleaned text, both interpolated rather than repeated
 * as literals: the number *is* what `checkTextBudget` measures against, and a copy of `400` here is
 * a second copy of it, one a config change would leave lying to the model.
 */
export function textBudgetRefusal(maxChars: number, got: number): string {
  return `text must be at most ${maxChars} characters after cleaning (got ${got})`;
}

/**
 * Clean a pin's text and measure it: the cleaned text when it fits the budget, the refusal when it
 * does not. The count is of graphemes, not UTF-16 units, so a joined family or a flag costs what the
 * user sees — one character — and text the sanitizer empties is *not* refused here: an empty text is
 * the reducer's `text is required for action "pin"` to answer, not a question about the budget.
 */
export function checkTextBudget(raw: string, maxChars: number): TextBudget {
  const text = cleanPinText(raw);
  const got = graphemesOf(text).length;
  return got > maxChars
    ? { ok: false, error: textBudgetRefusal(maxChars, got) }
    : { ok: true, text };
}
