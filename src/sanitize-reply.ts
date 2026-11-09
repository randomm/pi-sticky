/**
 * The one cut a recorded reply passes: `cleanPinText` (`sanitize.ts`) and then a two-ceiling trim that
 * always leaves the ellipsis at the end when anything was removed.
 *
 * The reply is the only piece of *user*-authored text the extension stores and hands back to the model,
 * and it is stored out of the model's reach — the recorded projection is rebuilt from session entries
 * long after the submission. So it is cleaned, and it is bounded, and the bound is the reply's own
 * (`MAX_REPLY_UNITS` / `MAX_REPLY_GRAPHEMES`, `bounds.ts`) rather than a pin's: a pin's text is refused
 * when it is too long because a model can rewrite it, and a reply is cut because the user cannot.
 *
 * Two ceilings, counted separately, because neither implies the other: the mark cap in `sanitize.ts`
 * counts `\p{M}` only, so an emoji cluster's joiners and skin-tone modifiers are uncapped and one
 * surviving grapheme can be tens of UTF-16 units wide (`test/pin-fields-bounds.test.ts` builds exactly
 * that shape). The cut therefore reserves one grapheme — and its units — for the ellipsis before it
 * measures either ceiling, so the retained text plus U+2026 satisfies both, whatever was cut.
 *
 * The `''` case answers `undefined` rather than an empty string, so a caller writes *no key* rather than
 * one that reads as a reply with content. A value that is not a string answers `undefined` for the same
 * reason: it reaches here out of a session entry, where the shape guard vouches for the *entry*, not for a
 * `text` that is a number or an object.
 */
import { MAX_REPLY_GRAPHEMES, MAX_REPLY_UNITS } from "./bounds.ts";
import { cleanPinText } from "./sanitize.ts";

/** Horizontal ellipsis, U+2026 — the same byte the pin budget's cut leaves behind. */
const ELLIPSIS = String.fromCodePoint(0x2026);

const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/** The clusters of `text`, in order. */
function clusters(text: string): string[] {
  return [...segmenter.segment(text)].map(({ segment }) => segment);
}

/**
 * `text` held inside both ceilings by cutting clusters from the end, with the ellipsis *inside* the
 * budget rather than after it: one grapheme and its units are reserved for U+2026 first, so a cut that
 * fills the unit ceiling does not overshoot it by the ellipsis's own width. Text that already fits both
 * comes back untouched — the ellipsis is the mark of a cut and nothing else.
 */
function cut(text: string): string {
  const kept = clusters(text);
  if (text.length <= MAX_REPLY_UNITS && kept.length <= MAX_REPLY_GRAPHEMES) return text;
  const ellipsisUnits = ELLIPSIS.length;
  let taken = "";
  let count = 0;
  for (const cluster of kept) {
    if (count + 1 > MAX_REPLY_GRAPHEMES - 1) break;
    if (taken.length + cluster.length + ellipsisUnits > MAX_REPLY_UNITS) break;
    taken += cluster;
    count += 1;
  }
  return taken + ELLIPSIS;
}

/**
 * The reply text as the entry may record it: cleaned, then held inside both reply ceilings, or `undefined`
 * when there is nothing to record. Never throws, never returns `""`.
 */
export function sanitizeReplyText(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const cleaned = cleanPinText(raw);
  if (cleaned === "") return undefined;
  return cut(cleaned);
}
